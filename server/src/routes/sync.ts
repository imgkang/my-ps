// 데이터 동기화 — 기존 Google Drive 번들(mypm-data.json, version 12)과 동일한 형식.
//   GET  /api/sync       → { version, exportedAt, mypm, nonk, kdeal, kd, ... } 전체 반환
//   PUT  /api/sync       → 전체 번들 저장 (서버 version 보다 낮으면 거부, 충돌 방지)
//   GET  /api/sync/meta  → { version, updated_at } (가벼운 변경 확인용)
import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

type BundleRow = { version: number; json: string; updated_at: string };

export default async function syncRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/sync/meta', async () => {
    const row = db.prepare('SELECT version, updated_at FROM data_bundle WHERE id = 1').get() as BundleRow;
    return { version: row.version, updated_at: row.updated_at };
  });

  app.get('/api/sync', async (_req, reply) => {
    const row = db.prepare('SELECT version, json, updated_at FROM data_bundle WHERE id = 1').get() as BundleRow;
    reply.header('Content-Type', 'application/json; charset=utf-8');
    // json 컬럼은 이미 직렬화된 번들 그대로 반환
    return row.json;
  });

  app.put('/api/sync', async (req, reply) => {
    const body = req.body as any;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'invalid bundle' });
    }
    const incoming = Number(body.version ?? 0);
    const current = db.prepare('SELECT version FROM data_bundle WHERE id = 1').get() as { version: number };

    // 충돌 방지: 들어온 버전이 서버 버전 이하면 거부 (force=true 면 무시).
    // '이하'로 판정해야 두 기기가 같은 base 에서 동시에 같은 리비전을 보내는 경우(덮어쓰기)도 막는다.
    const force = (req.query as any)?.force === 'true';
    if (!force && incoming <= current.version) {
      return reply.code(409).send({
        error: 'stale',
        serverVersion: current.version,
        incomingVersion: incoming,
      });
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE data_bundle SET version = ?, json = ?, updated_at = ? WHERE id = 1').run(
      incoming,
      JSON.stringify(body),
      now
    );
    return { ok: true, version: incoming, updated_at: now };
  });
}
