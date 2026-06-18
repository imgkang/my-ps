// 푸시 — 디바이스 토큰 등록 + 가격 알림 규칙 CRUD.
// 실제 APNs 발송은 Phase 5 (src/lib/apns.ts) 에서 연결한다.
import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

export default async function pushRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // APNs 디바이스 토큰 등록/갱신
  app.post('/api/push/register', async (req, reply) => {
    const token = (req.body as any)?.token as string | undefined;
    const platform = ((req.body as any)?.platform as string) ?? 'ios';
    if (!token) return reply.code(400).send({ error: 'missing token' });
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO devices (token, platform, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET updated_at = excluded.updated_at`
    ).run(token, platform, now, now);
    return { ok: true };
  });

  // 가격 알림 규칙 목록/생성/삭제
  app.get('/api/push/alerts', async () => {
    return db.prepare('SELECT * FROM alerts ORDER BY created_at DESC').all();
  });

  app.post('/api/push/alerts', async (req, reply) => {
    const b = req.body as any;
    if (!b?.code || !b?.op || b?.threshold == null) {
      return reply.code(400).send({ error: 'code, op, threshold required' });
    }
    const id = b.id ?? `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(
      `INSERT INTO alerts (id, app, code, name, op, threshold, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(id, b.app ?? 'mypm', b.code, b.name ?? null, b.op, Number(b.threshold), new Date().toISOString());
    return { ok: true, id };
  });

  app.delete('/api/push/alerts/:id', async (req) => {
    db.prepare('DELETE FROM alerts WHERE id = ?').run((req.params as any).id);
    return { ok: true };
  });
}
