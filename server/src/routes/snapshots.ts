// 자동 계좌기록 스냅샷 조회 — 서버가 주 1회 마감 후 적재한 시계열을 클라가 받아 표시만 한다.
//   GET /api/account-snapshots?app=mypm|kd|nk → { app, snapshots: [{day, accounts, total, pricedAt}] }
// 클라이언트는 읽기 전용. (적재는 scheduler 의 주간 cron → derived-store.recordWeeklySnapshot)
import type { FastifyInstance } from 'fastify';
import { requireAuth, userId } from '../auth.js';
import { getAccountSnapshots } from '../derived-store.js';

const APPS = new Set(['mypm', 'kd', 'nk']);

export default async function snapshotRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/account-snapshots', async (req) => {
    const uid = userId(req);
    const appName = String((req.query as any)?.app || 'mypm');
    if (!APPS.has(appName)) return { app: appName, snapshots: [] };
    return { app: appName, snapshots: getAccountSnapshots(uid, appName) };
  });
}
