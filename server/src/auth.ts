// 가족 단위 공유 PIN 인증.
// 단일 가구용이므로 복잡한 세션 대신, APP_PIN 에서 결정적으로 파생한 토큰을 사용한다.
// (서버 재시작에도 토큰이 유지되어 재로그인이 불필요)
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from './env.js';

export function tokenForPin(): string {
  return createHmac('sha256', env.APP_PIN || 'unset').update('mypm-auth-v1').digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// 보호 라우트용 preHandler — Authorization: Bearer <token> 검증
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!env.APP_PIN || !token || !safeEqual(token, tokenForPin())) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    const pin = (req.body as any)?.pin as string | undefined;
    if (!env.APP_PIN) return reply.code(503).send({ error: 'APP_PIN not configured' });
    if (!pin || !safeEqual(pin, env.APP_PIN)) {
      return reply.code(401).send({ error: 'invalid pin' });
    }
    return { token: tokenForPin() };
  });
}
