// 스케줄러 — 종목 갱신 + 시세 폴링 기반 가격 알림.
// server.ts 에서 import 하여 활성화한다. (Phase 5 에서 APNs 발송과 연결)
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import cron from 'node-cron';
import { db } from './db.js';

// 매일 06:10 KST — update_tickers.py 실행 후 tickers.json 을 테이블로 재적재
export function startScheduler() {
  cron.schedule(
    '10 6 * * *',
    () => {
      const script = resolve(process.cwd(), '../scripts/update_tickers.py');
      const py = spawn('python', [script], { cwd: resolve(process.cwd(), '..') });
      py.on('close', (code) => {
        if (code === 0) {
          console.log('[scheduler] update_tickers.py 완료 → load-tickers 재적재 필요');
          // TODO: load-tickers 로직 재사용하여 자동 적재
        } else {
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
}

async function checkAlerts() {
  const alerts = db.prepare('SELECT * FROM alerts WHERE active = 1').all() as any[];
  if (!alerts.length) return;
  // TODO(Phase 5): 각 종목 현재가 조회 → op/threshold 충족 시 APNs 발송 후 last_fired 갱신
  // 현재가는 routes/price.ts 의 패스스루 로직을 lib 로 추출해 재사용 예정.
}
