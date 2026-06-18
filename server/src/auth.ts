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

// 인터넷 노출(Cloudflare Tunnel) 대비 — 로그인 무차별 대입 완화.
// 무의존성 인메모리 스로틀: 클라이언트별 실패 횟수를 창 단위로 집계.
const FAIL_LIMIT = 10;                 // 창 내 허용 실패 횟수
const FAIL_WINDOW_MS = 5 * 60_000;     // 5분
const loginFails = new Map<string, { count: number; first: number }>();

// 터널 뒤에서는 req.ip 가 로컬(127.0.0.1)이므로 Cloudflare 가 전달하는 실제 IP 를 우선 사용.
function clientKey(req: FastifyRequest): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.length) return cf;
  return req.ip;
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    if (!env.APP_PIN) return reply.code(503).send({ error: 'APP_PIN not configured' });

    const key = clientKey(req);
    const now = Date.now();
    const rec = loginFails.get(key);
    const inWindow = !!rec && now - rec.first < FAIL_WINDOW_MS;
    if (inWindow && rec!.count >= FAIL_LIMIT) {
      return reply.code(429).send({ error: 'too many attempts, try again later' });
    }

    const pin = (req.body as any)?.pin as string | undefined;
    if (!pin || !safeEqual(pin, env.APP_PIN)) {
      if (inWindow) rec!.count++;
      else loginFails.set(key, { count: 1, first: now });
      return reply.code(401).send({ error: 'invalid pin' });
    }

    loginFails.delete(key); // 성공 시 리셋
    return { token: tokenForPin() };
  });
}
