// 스케줄러 — 종목 갱신 + 시세 폴링 기반 가격 알림 + 자동 배포 polling.
// server.ts 에서 import 하여 활성화한다. (Phase 5 에서 APNs 발송과 연결)
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import cron from 'node-cron';
import { db } from './db.js';
import { gitPullAndPurge } from './routes/webhook.js';
import { recomputeWithLivePrices } from './derived-store.js';

const execAsync = promisify(exec);
const repoRoot = resolve(process.cwd(), '..');

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

// 매일 06:10 KST — update_tickers.py 실행 후 tickers.json 을 테이블로 재적재
export function startScheduler() {
  // 5분마다 자동 배포 polling
  cron.schedule('*/5 * * * *', () => autoDeploy().catch(e => console.error('[auto-deploy]', e)));

  cron.schedule(
    '10 6 * * *',
    () => {
      const script = resolve(process.cwd(), '../scripts/update_tickers.py');
      // python / python3 둘 다 없으면 ENOENT → error 이벤트로 잡지 않으면 uncaughtException
      const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
      const py = spawn(pyCmd, [script], { cwd: resolve(process.cwd(), '..') });
      py.on('error', (err) => {
        console.error(`[scheduler] update_tickers.py 실행 불가 (${pyCmd} 없음?):`, err.message);
      });
      py.on('close', (code) => {
        if (code === 0) {
          console.log('[scheduler] update_tickers.py 완료 → load-tickers 재적재 필요');
          // TODO: load-tickers 로직 재사용하여 자동 적재
        } else if (code !== null) {
          console.error('[scheduler] update_tickers.py 실패 code', code);
        }
      });
    },
    { timezone: 'Asia/Seoul' }
  );

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
