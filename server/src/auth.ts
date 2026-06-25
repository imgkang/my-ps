// 인증 — 구글 로그인(OIDC) + 앱 자체 세션 토큰.
//
// 흐름: 프론트(Google Identity Services)가 받은 구글 ID 토큰(credential)을
//      POST /api/auth/google 로 보내면, 서버가 검증 + 허용목록(ALLOWED_EMAILS) 확인 후
//      사용자별 앱 토큰을 발급한다. 이후 보호 라우트는 Authorization: Bearer <앱토큰> 으로 접근.
//
// 앱 토큰: base64url(payload).base64url(HMAC-SHA256)  payload = { uid, exp }
//          (서명키는 DB app_meta.token_secret 에 영속 → 재시작에도 토큰 유지)
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import { env } from './env.js';
import { db, getTokenSecret } from './db.js';
import { upsertGoogleUser } from './users.js';
import { isEmailAllowed } from './allowlist.js';

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

export function signToken(uid: number): string {
  const payload = b64url(JSON.stringify({ uid, exp: Date.now() + TOKEN_TTL_MS }));
  const sig = b64url(createHmac('sha256', getTokenSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): number | null {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(createHmac('sha256', getTokenSecret()).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!obj || typeof obj.uid !== 'number' || typeof obj.exp !== 'number') return null;
    if (Date.now() > obj.exp) return null;
    return obj.uid;
  } catch {
    return null;
  }
}

// 보호 라우트용 preHandler — 검증 성공 시 req.userId 설정.
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const uid = token ? verifyToken(token) : null;
  if (!uid) return reply.code(401).send({ error: 'unauthorized' });
  // 삭제된 계정의 토큰 방지
  const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid);
  if (!exists) return reply.code(401).send({ error: 'unauthorized' });
  (req as any).userId = uid;
}

// 라우트 내에서 인증된 사용자 ID 를 꺼내는 헬퍼.
export function userId(req: FastifyRequest): number {
  return (req as any).userId as number;
}

// 인터넷 노출(Cloudflare Tunnel) 대비 — 로그인 무차별 대입 완화.
const FAIL_LIMIT = 10; // 창 내 허용 실패 횟수
const FAIL_WINDOW_MS = 5 * 60_000; // 5분
const loginFails = new Map<string, { count: number; first: number }>();

// 터널 뒤에서는 req.ip 가 로컬(127.0.0.1)이므로 Cloudflare 가 전달하는 실제 IP 를 우선 사용.
function clientKey(req: FastifyRequest): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.length) return cf;
  return req.ip;
}

let googleClient: OAuth2Client | null = null;
function getGoogleClient(): OAuth2Client {
  if (!googleClient) googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);
  return googleClient;
}

export default async function authRoutes(app: FastifyInstance) {
  // 구글 로그인 — credential(구글 ID 토큰) 검증 → 허용목록 확인 → 앱 토큰 발급.
  app.post('/api/auth/google', async (req, reply) => {
    if (!env.GOOGLE_CLIENT_ID) {
      return reply.code(503).send({ error: 'GOOGLE_CLIENT_ID not configured' });
    }

    const key = clientKey(req);
    const now = Date.now();
    const rec = loginFails.get(key);
    const inWindow = !!rec && now - rec.first < FAIL_WINDOW_MS;
    if (inWindow && rec!.count >= FAIL_LIMIT) {
      return reply.code(429).send({ error: 'too many attempts, try again later' });
    }
    const bump = () => {
      if (inWindow) rec!.count++;
      else loginFails.set(key, { count: 1, first: now });
    };

    const credential = (req.body as any)?.credential as string | undefined;
    if (!credential) return reply.code(400).send({ error: 'missing credential' });

    let payload;
    try {
      const ticket = await getGoogleClient().verifyIdToken({
        idToken: credential,
        audience: env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch {
      bump();
      return reply.code(401).send({ error: 'invalid google credential' });
    }

    if (!payload || !payload.email || !payload.email_verified || !payload.sub) {
      bump();
      return reply.code(401).send({ error: 'email not verified' });
    }

    const email = payload.email.toLowerCase();
    if (!isEmailAllowed(email)) {
      bump();
      return reply.code(403).send({ error: 'email not allowed' });
    }

    loginFails.delete(key); // 성공 시 리셋
    const user = upsertGoogleUser({ sub: payload.sub, email, name: payload.name ?? null });
    return { token: signToken(user.id), user: { email: user.email, name: user.name } };
  });

  // 현재 로그인 사용자 정보 (토큰 유효성 확인용).
  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    const row = db.prepare('SELECT email, name FROM users WHERE id = ?').get(userId(req));
    return row ?? {};
  });

  // GIS redirect 모드 — Google이 인증 후 form POST로 credential 전달
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      const params = new URLSearchParams(body as string);
      const obj: Record<string, string> = {};
      params.forEach((v, k) => { obj[k] = v; });
      done(null, obj);
    }
  );

  app.post('/api/auth/google-redirect', async (req, reply) => {
    const credential = (req.body as Record<string, string>)?.credential;
    if (!credential)
      return reply.redirect('/?login_error=' + encodeURIComponent('credential 없음'));
    if (!env.GOOGLE_CLIENT_ID)
      return reply.redirect('/?login_error=' + encodeURIComponent('서버 설정 오류'));
    let payload;
    try {
      const ticket = await getGoogleClient().verifyIdToken({
        idToken: credential, audience: env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch {
      return reply.redirect('/?login_error=' + encodeURIComponent('Google 인증 실패'));
    }
    if (!payload?.email || !payload.email_verified || !payload.sub)
      return reply.redirect('/?login_error=' + encodeURIComponent('이메일 미인증'));
    if (!isEmailAllowed(payload.email.toLowerCase()))
      return reply.redirect('/?login_error=' + encodeURIComponent('허용되지 않은 계정'));
    const user = upsertGoogleUser({ sub: payload.sub, email: payload.email.toLowerCase(), name: payload.name ?? null });
    const token = signToken(user.id);
    const base = `/?app_token=${encodeURIComponent(token)}`;
    return payload.picture
      ? reply.redirect(base + '&gp=' + encodeURIComponent(payload.picture))
      : reply.redirect(base);
  });
}
