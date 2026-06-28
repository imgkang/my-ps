// 데이터 동기화 — 사용자별 번들(기존 Google Drive mypm-data.json 과 동일 형식).
//   GET  /api/sync       → 로그인 사용자의 전체 번들 반환
//   PUT  /api/sync       → 전체 번들 저장 (서버 version 보다 낮으면 거부, 충돌 방지)
//   GET  /api/sync/meta  → { version, updated_at } (가벼운 변경 확인용)
import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { requireAuth, userId } from '../auth.js';
import { recomputeDerivedForUser } from '../derived-store.js';
import { bumpActivity } from '../engagement.js';

type BundleRow = { version: number; json: string; updated_at: string | null };

export default async function syncRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/sync/meta', async (req) => {
    const row = db
      .prepare('SELECT version, updated_at FROM data_bundle WHERE user_id = ?')
      .get(userId(req)) as BundleRow | undefined;
    return row ? { version: row.version, updated_at: row.updated_at } : { version: 0, updated_at: null };
  });

  app.get('/api/sync', async (req, reply) => {
    const row = db
      .prepare('SELECT json FROM data_bundle WHERE user_id = ?')
      .get(userId(req)) as BundleRow | undefined;
    reply.header('Content-Type', 'application/json; charset=utf-8');
    // json 컬럼은 이미 직렬화된 번들 그대로 반환. 신규 사용자는 빈 객체.
    return row ? row.json : '{}';
  });

  app.put('/api/sync', async (req, reply) => {
    const uid = userId(req);
    const body = req.body as any;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'invalid bundle' });
    }
    const incoming = Number(body.version ?? 0);
    const cur = db.prepare('SELECT version FROM data_bundle WHERE user_id = ?').get(uid) as
      | { version: number }
      | undefined;

    // 충돌 방지: 들어온 버전이 서버 버전 이하면 거부 (force=true 면 무시).
    // 신규 사용자(행 없음)는 충돌 없이 첫 저장 허용.
    const force = (req.query as any)?.force === 'true';
    if (!force && cur && incoming <= cur.version) {
      return reply.code(409).send({
        error: 'stale',
        serverVersion: cur.version,
        incomingVersion: incoming,
      });
    }

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO data_bundle (user_id, version, json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         version = excluded.version,
         json = excluded.json,
         updated_at = excluded.updated_at`
    ).run(uid, incoming, JSON.stringify(body), now);

    // 능동 참여도: 실제 영속된 저장 1건 = 강한 능동 신호(Depth).
    try { bumpActivity(uid, { save: 1, feats: ['save'] }); } catch { /* 집계 실패 무시 */ }

    // 저장 직후 파생상태 선계산 → 응답에 동봉(편집 후 단일 왕복으로 최신 표시).
    let derived = null;
    try { derived = recomputeDerivedForUser(uid); } catch (e) { req.log.error(e, 'derived recompute failed'); }
    return {
      ok: true, version: incoming, updated_at: now,
      derived: derived ? { dataVersion: derived.dataVersion, pricedAt: derived.pricedAt, data: derived.data } : null,
    };
  });
}
