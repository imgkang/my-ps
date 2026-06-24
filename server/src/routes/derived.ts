// 파생상태 조회 — 서버가 선계산해 둔 결과를 클라가 받아 표시만 한다.
//   GET /api/derived       → 최신 스냅샷 { dataVersion, pricedAt, data }
//   GET /api/derived/meta  → { dataVersion, pricedAt } (경량 변경확인용 폴링)
import type { FastifyInstance } from 'fastify';
import { requireAuth, userId } from '../auth.js';
import { getDerivedForUser, recomputeDerivedForUser } from '../derived-store.js';

export default async function derivedRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/derived/meta', async (req) => {
    const uid = userId(req);
    const d = getDerivedForUser(uid) || recomputeDerivedForUser(uid);
    return d ? { dataVersion: d.dataVersion, pricedAt: d.pricedAt } : { dataVersion: 0, pricedAt: null };
  });

  app.get('/api/derived', async (req) => {
    const uid = userId(req);
    // 아직 스냅샷이 없으면 즉석 계산(최초 1회). 이후엔 PUT/scheduler 가 선계산해 둠.
    const d = getDerivedForUser(uid) || recomputeDerivedForUser(uid);
    return d ? { dataVersion: d.dataVersion, pricedAt: d.pricedAt, data: d.data }
             : { dataVersion: 0, pricedAt: null, data: null };
  });
}
