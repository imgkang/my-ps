// 스케줄러 — 종목 갱신 + 시세 폴링 기반 가격 알림 + 자동 배포 polling.
// server.ts 에서 import 하여 활성화한다. (Phase 5 에서 APNs 발송과 연결)
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import cron from 'node-cron';
import { db } from './db.js';
import { env } from './env.js';
import { gitPullAndPurge } from './routes/webhook.js';
import { recomputeWithLivePrices, recordWeeklySnapshot } from './derived-store.js';

const execAsync = promisify(exec);
const repoRoot = resolve(process.cwd(), '..');

// python 실행 파일 후보 목록.
//  1) .env 의 PYTHON_BIN(절대경로)이 있으면 최우선.
//  2) win32 는 py 런처(C:\Windows\py.exe — SYSTEM PATH 에 존재)를 먼저 시도.
//     작업 스케줄러가 SYSTEM 계정으로 돌 때 사용자 PATH 의 python 을 못 찾는 문제를 우회한다.
function pythonCandidates(): string[] {
  const list: string[] = [];
  if (env.PYTHON_BIN) list.push(env.PYTHON_BIN);
  if (process.platform === 'win32') list.push('py', 'python', 'python3');
  else list.push('python3', 'python');
  return list;
}

// 후보를 순서대로 시도하며 파이썬 스크립트를 실행한다. ENOENT(실행파일 없음)면 다음 후보로 폴백.
function spawnPython(args: string[], opts: { cwd: string }): void {
  const candidates = pythonCandidates();
  const tryAt = (i: number): void => {
    if (i >= candidates.length) {
      console.error(
        '[scheduler] python 실행 파일을 찾을 수 없습니다. .env 의 PYTHON_BIN 에 절대경로를 지정하세요.',
      );
      return;
    }
    const cmd = candidates[i];
    const py = spawn(cmd, args, opts);
    py.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        tryAt(i + 1); // 다음 후보로 폴백
        return;
      }
      console.error(`[scheduler] update_tickers.py 실행 오류 (${cmd}):`, err.message);
    });
    py.on('close', (code) => {
      if (code === 0) {
        console.log(`[scheduler] update_tickers.py 완료 (${cmd}) → load-tickers 재적재 필요`);
        // TODO: load-tickers 로직 재사용하여 자동 적재
      } else if (code !== null) {
        console.error(`[scheduler] update_tickers.py 실패 (${cmd}) code`, code);
      }
    });
  };
  tryAt(0);
}

// 5분마다 origin/main과 HEAD를 비교 → 차이 있으면 git pull + CF purge
async function autoDeploy() {
  try {
    await execAsync(`git -C "${repoRoot}" fetch origin main`);
    const { stdout: local } = await execAsync(`git -C "${repoRoot}" rev-parse HEAD`);
    const { stdout: remote } = await execAsync(`git -C "${repoRoot}" rev-parse origin/main`);
    if (local.trim() === remote.trim()) return; // 이미 최신
    console.log(`[auto-deploy] 새 커밋 감지 ${local.trim().slice(0,7)} → ${remote.trim().slice(0,7)}, git pull 시작`);
    gitPullAndPurge(s => console.log(s), s => console.error(s));
  } catch (e: any) {
    console.error('[auto-deploy] 오류:', e.message);
  }
}

export function startScheduler() {
  // 5분마다 자동 배포 polling
  cron.schedule('*/5 * * * *', () => autoDeploy().catch(e => console.error('[auto-deploy]', e)));

  // tickers.json 은 이미 GitHub Actions(.github/workflows/update-tickers.yml)가
  // 매일 06:00 KST 에 생성·커밋하고, 위 auto-deploy 가 그 커밋을 pull 하므로
  // 로컬에서 update_tickers.py 를 돌릴 필요가 없다(중복). 따라서 로컬 실행은
  // opt-in: .env 의 PYTHON_BIN(FinanceDataReader 가 설치된 python 절대경로)이
  // 지정된 경우에만 매일 06:10 KST 에 백업으로 실행한다. 미지정 시 건너뛴다.
  if (env.PYTHON_BIN) {
    cron.schedule(
      '10 6 * * *',
      () => {
        const script = resolve(process.cwd(), '../scripts/update_tickers.py');
        spawnPython([script], { cwd: resolve(process.cwd(), '..') });
      },
      { timezone: 'Asia/Seoul' }
    );
    console.log(`[scheduler] 로컬 티커 갱신 활성 (PYTHON_BIN=${env.PYTHON_BIN}) — 매일 06:10 KST`);
  } else {
    console.log('[scheduler] 로컬 티커 갱신 비활성 (PYTHON_BIN 미설정) — tickers.json 은 GitHub Actions 가 갱신');
  }

  // 장중(평일 09:00~15:40 KST) 2분마다 시세 폴링 → 알림 조건 확인
  cron.schedule(
    '*/2 9-15 * * 1-5',
    () => checkAlerts().catch((e) => console.error('[scheduler] alert error', e)),
    { timezone: 'Asia/Seoul' }
  );

  // 국내장(평일 09:00~15:40 KST) 2분마다 → KR 시세로 선계산.
  cron.schedule(
    '*/2 9-15 * * 1-5',
    () => recomputeAllDerived(['kr']).catch((e) => console.error('[scheduler] KR derived tick error', e)),
    { timezone: 'Asia/Seoul' }
  );

  // 미국장 2분마다 → US 시세(Finnhub)로 선계산. 미국 정규장 09:30~16:00 ET 는
  // KST 로 대략 22:30~06:00(서머타임/표준시에 따라 ±1h). 여유 있게 22~23시(월~금) +
  // 00~06시(화~토, 미국 기준 전일 야간)를 커버한다. KR 종가는 캐시로 유지되므로 함께 반영됨.
  cron.schedule(
    '*/2 22,23 * * 1-5',
    () => recomputeAllDerived(['us']).catch((e) => console.error('[scheduler] US derived tick error', e)),
    { timezone: 'Asia/Seoul' }
  );
  cron.schedule(
    '*/2 0-6 * * 2-6',
    () => recomputeAllDerived(['us']).catch((e) => console.error('[scheduler] US derived tick error', e)),
    { timezone: 'Asia/Seoul' }
  );

  // 자동 계좌기록(주 1회) — 마감 후 1회 스냅샷을 account_snapshots 에 적재.
  //   KR(mypm/kd): 금 15:50 KST(국내 종가 후).  NonK(nk): 토 06:30 KST(미국 금요일 종가 후).
  cron.schedule(
    '50 15 * * 5',
    () => recordWeeklyAll(['kr'], ['mypm', 'kd']).catch((e) => console.error('[weekly snapshot KR]', e)),
    { timezone: 'Asia/Seoul' }
  );
  cron.schedule(
    '30 6 * * 6',
    () => recordWeeklyAll(['us'], ['nk']).catch((e) => console.error('[weekly snapshot US]', e)),
    { timezone: 'Asia/Seoul' }
  );
}

// KST 기준 오늘 날짜 'YYYY-MM-DD'.
function kstDay(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

// 번들이 있는 모든 사용자에 대해 주간 스냅샷 1건씩 기록.
async function recordWeeklyAll(
  markets: Array<'kr' | 'us'>,
  apps: Array<'mypm' | 'kd' | 'nk'>,
): Promise<void> {
  const day = kstDay();
  const users = db.prepare('SELECT user_id FROM data_bundle').all() as { user_id: number }[];
  for (const u of users) {
    try { await recordWeeklySnapshot(u.user_id, day, { markets, apps }); }
    catch (e: any) { console.error('[weekly snapshot] user', u.user_id, e?.message); }
  }
}

// 번들이 있는 모든 사용자의 파생상태를 라이브 시세로 재계산·저장.
async function recomputeAllDerived(markets: Array<'kr' | 'us'>) {
  const users = db.prepare('SELECT user_id FROM data_bundle').all() as { user_id: number }[];
  for (const u of users) {
    try { await recomputeWithLivePrices(u.user_id, markets); }
    catch (e: any) { console.error('[derived tick] user', u.user_id, e?.message); }
  }
}

async function checkAlerts() {
  const alerts = db.prepare('SELECT * FROM alerts WHERE active = 1').all() as any[];
  if (!alerts.length) return;
  // TODO(Phase 5): 각 종목 현재가 조회 → op/threshold 충족 시 알림 발송 후 last_fired 갱신.
  //   - 현재가: routes/price.ts 의 패스스루 로직을 lib 로 추출해 재사용 예정.
  //   - 발송: lib/push.ts 의 broadcastPush(devices, payload) 로 등록된 모든 디바이스에 전송
  //     (플랫폼별 APNs/FCM 분기는 sendPush 가 처리). 예:
  //       const devices = db.prepare('SELECT token, platform FROM devices').all();
  //       await broadcastPush(devices, { title, body });
}
