// 푸시 — 디바이스 토큰 등록 + 가격 알림 규칙 CRUD.
// 실제 발송(APNs/FCM)은 src/lib/push.ts 의 sendPush() 가 플랫폼별로 처리한다.
import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

const VALID_PLATFORMS = new Set(['ios', 'android', 'web']);

export default async function pushRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // 디바이스 토큰 등록/갱신 (platform: ios=APNs, android=FCM)
  app.post('/api/push/register', async (req, reply) => {
    const token = (req.body as any)?.token as string | undefined;
    const platform = ((req.body as any)?.platform as string) ?? 'ios';
    if (!token) return reply.code(400).send({ error: 'missing token' });
    if (!VALID_PLATFORMS.has(platform)) {
      return reply.code(400).send({ error: `invalid platform: ${platform}` });
    }
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO devices (token, platform, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET
         platform = excluded.platform,
         updated_at = excluded.updated_at`
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
