// 시드니 2027 가족여행 앱 — 인증 뒤 정적 서빙 + 채팅·공지 API.
//
// 경로: 모두 TRIP_BASE(기본 /trip) 아래. 프론트는 상대경로 `api/` 를 호출한다.
//   GET  /trip/                  → 로그인 상태면 앱(index.html), 아니면 로그인 페이지
//   GET  /trip/<file>            → TRIP_STATIC_DIR 의 파일 (비로그인 401)
//   POST /trip/api/auth/google   → 구글 ID 토큰 검증 + TRIP 멤버 확인 → HttpOnly 쿠키 발급
//   POST /trip/api/auth/logout
//   GET  /trip/api/me
//   GET  /trip/api/messages?after=<id>
//   POST /trip/api/messages
//   GET  /trip/api/notice
//   PUT  /trip/api/notice        (관리자만)
//
// 보안 설계:
//  - 앱 파일(예약번호 포함)은 공개 저장소에 두지 않는다. TRIP_STATIC_DIR(기본
//    server/private/trip, .gitignore 처리)에서만 읽는다.
//  - 세션은 MyPM 의 Bearer 토큰과 분리된 HttpOnly·SameSite=Lax 쿠키(Path=/trip).
//    (Strict 였을 때 카톡·문자·메일 등 다른 앱의 링크로 열면 쿠키가 안 가서 매번 로그인 화면이 떴음.
//     Lax 는 링크로 들어오는 GET 에만 쿠키를 보내고, 상태 변경 요청은 아래 Origin 검사로 계속 막는다.)
//    서명키는 기존 token_secret 에서 용도별로 파생(HMAC) — 토큰 상호 재사용 불가.
//  - 멤버 목록은 DB(trip_members — admin.html 계정 관리), 관리자는 환경변수(TRIP_ADMIN_EMAILS). 하드코딩 없음.
//    요청마다 현재 목록과 대조하므로 목록에서 빼고 재시작하면 즉시 차단된다.
//  - 상태 변경(POST/PUT)은 Origin 헤더를 자기 출처와 대조(CSRF 방어, SameSite 와 이중).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import { env } from './env.js';
import { db, getTokenSecret } from './db.js';
import { isTripAdminEmail, isTripMemberEmail } from './trip-members.js';
import { registerExpenseRoutes, isOwnerEmail } from './trip-expenses.js';
import { registerScheduleRoutes, schedulePlaceKeys } from './trip-schedule.js';
import { registerRallyRoutes } from './trip-rally.js';

// 여행앱 버전 — MyPM(v0.xxx)과 별개로 관리한다. 여행앱 서버 코드를 바꿀 때마다 +0.001.
// (MyPM 버전·sw.js CACHE_NAME 은 MyPM 파일이 바뀔 때만 올린다)
export const TRIP_VERSION = 'v0.013';

const BASE = env.TRIP_BASE;
const COOKIE = 'trip_sess';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일
const REFRESH_BELOW_MS = 10 * 24 * 60 * 60 * 1000; // 남은 기간 10일 미만이면 재발급
const MAX_PAGE = 300;
const RATE_LIMIT = 30; // 사용자당 분당 메시지
const RATE_WINDOW_MS = 60_000;
const BODY_LIMIT = 8 * 1024;

// ── 스키마 ──
db.exec(`
  CREATE TABLE IF NOT EXISTS trip_users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    google_sub TEXT NOT NULL UNIQUE,
    email      TEXT NOT NULL,
    name       TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trip_messages (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    uid   TEXT NOT NULL,
    nick  TEXT NOT NULL,
    kind  TEXT NOT NULL,
    text  TEXT NOT NULL,
    place TEXT,
    ts    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trip_notice (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    text       TEXT NOT NULL,
    ts         INTEGER NOT NULL,
    updated_by TEXT
  );
`);

type TripUser = { id: number; google_sub: string; email: string; name: string | null };

// ── 멤버/관리자 판별 — 멤버는 DB(trip_members, 관리자 화면에서 관리), 관리자는 환경변수 ──
const isAdminEmail = isTripAdminEmail;
const isMemberEmail = isTripMemberEmail;

// ── 세션 쿠키 ──
function sessionKey(): Buffer {
  return createHmac('sha256', getTokenSecret()).update('trip-session-v1').digest();
}
function signSession(uid: number): string {
  const payload = Buffer.from(JSON.stringify({ u: uid, exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  const sig = createHmac('sha256', sessionKey()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifySession(token: string): { uid: number; exp: number } | null {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const a = Buffer.from(token.slice(dot + 1));
  const b = Buffer.from(createHmac('sha256', sessionKey()).update(payload).digest('base64url'));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const o = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof o?.u !== 'number' || typeof o?.exp !== 'number' || Date.now() > o.exp) return null;
    return { uid: o.u, exp: o.exp };
  } catch {
    return null;
  }
}
function readCookie(req: FastifyRequest, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
function setSessionCookie(reply: FastifyReply, value: string, maxAgeSec: number) {
  const attrs = [`${COOKIE}=${value}`, `Path=${BASE}`, 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (!env.TRIP_COOKIE_INSECURE) attrs.push('Secure');
  reply.header('Set-Cookie', attrs.join('; '));
}

// 현재 세션 사용자 (없거나 멤버에서 빠졌으면 null).
function currentUser(req: FastifyRequest): { user: TripUser; exp: number } | null {
  const tok = readCookie(req, COOKIE);
  const s = tok ? verifySession(tok) : null;
  if (!s) return null;
  const user = db.prepare('SELECT id, google_sub, email, name FROM trip_users WHERE id = ?').get(s.uid) as
    | TripUser
    | undefined;
  if (!user || !isMemberEmail(user.email)) return null;
  return { user, exp: s.exp };
}

async function requireTripAuth(req: FastifyRequest, reply: FastifyReply) {
  noStore(reply);
  const cur = currentUser(req);
  if (!cur) return reply.code(401).send({ error: 'unauthorized' });
  (req as any).tripUser = cur.user;
  // 슬라이딩 세션: 만료 임박 시 재발급
  if (cur.exp - Date.now() < REFRESH_BELOW_MS) {
    setSessionCookie(reply, signSession(cur.user.id), SESSION_TTL_MS / 1000);
  }
}
function tripUser(req: FastifyRequest): TripUser {
  return (req as any).tripUser as TripUser;
}

// ── CSRF: Origin 대조 ──
function expectedOrigins(req: FastifyRequest): string[] {
  if (env.TRIP_ALLOWED_ORIGINS.length) return env.TRIP_ALLOWED_ORIGINS;
  const host = req.headers.host;
  return host ? [`https://${host}`, `http://${host}`] : [];
}
async function requireSameOrigin(req: FastifyRequest, reply: FastifyReply) {
  const origin = req.headers.origin;
  if (!origin || !expectedOrigins(req).includes(origin)) {
    noStore(reply);
    return reply.code(403).send({ error: 'bad origin' });
  }
}

function noStore(reply: FastifyReply) {
  reply.header('Cache-Control', 'no-store');
}
function securityHeaders(reply: FastifyReply) {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'same-origin');
  reply.header('X-Frame-Options', 'DENY');
}

// ── 입력 정리/검증 ──
// 제어문자 제거 (allowNewline=true 면 \n, \t 는 유지). \r\n → \n.
function clean(s: string, allowNewline: boolean): string {
  const t = s.replace(/\r\n?/g, '\n');
  return allowNewline
    ? t.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029]/g, '')
    : t.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, '');
}
const len = (s: string) => [...s].length; // 코드포인트 기준(이모지 1자)
const PLACE_RE = /^[a-z0-9_]{1,32}$/;

// trip-data.js 의 places 키 목록 — 파일 mtime 이 바뀌면 다시 읽는다.
// 실행하지 않고 정규식으로만 추출한다. 추출 실패(0개)면 형식 검증만 한다.
let placeCache: { mtime: number; keys: Set<string> } | null = null;
async function knownPlaces(): Promise<Set<string> | null> {
  if (env.TRIP_PLACE_KEYS.length) return new Set(env.TRIP_PLACE_KEYS);
  const fromDb = schedulePlaceKeys(); // 일정이 DB 로 옮겨졌으면 그 장소 목록
  if (fromDb) return fromDb.size ? fromDb : null;
  const file = resolve(env.TRIP_STATIC_DIR, 'trip-data.js');
  try {
    const st = await stat(file);
    if (placeCache && placeCache.mtime === st.mtimeMs) return placeCache.keys.size ? placeCache.keys : null;
    const src = await readFile(file, 'utf8');
    const keys = extractPlaceKeys(src);
    placeCache = { mtime: st.mtimeMs, keys };
    return keys.size ? keys : null;
  } catch {
    return null;
  }
}
// `places: { key: {...}, key2: {...} }` 의 최상위 키만 추출(중괄호 깊이 추적).
export function extractPlaceKeys(src: string): Set<string> {
  const keys = new Set<string>();
  const m = /\bplaces\s*[:=]\s*\{/.exec(src);
  if (!m) return keys;
  let i = m.index + m[0].length;
  let depth = 1;
  let quote: string | null = null;
  let token = '';
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      else if (depth === 1) token += c;
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
      if (depth === 1) token = '';
    } else if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (depth === 1) {
      if (c === ':') {
        const k = token.trim();
        if (PLACE_RE.test(k)) keys.add(k);
        token = '';
      } else if (c === ',') token = '';
      else if (/[A-Za-z0-9_$\s]/.test(c)) token += c;
    }
    i++;
  }
  return keys;
}

// ── 속도 제한 (메모리, 사용자별 최근 1분 타임스탬프) ──
const sent = new Map<number, number[]>();
function rateLimited(uid: number): boolean {
  const now = Date.now();
  const arr = (sent.get(uid) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_LIMIT) {
    sent.set(uid, arr);
    return true;
  }
  arr.push(now);
  sent.set(uid, arr);
  return false;
}

type MessageRow = { id: number; uid: string; nick: string; kind: string; text: string; place: string | null; ts: number };
function toMessage(r: MessageRow) {
  const m: Record<string, unknown> = { id: r.id, uid: r.uid, nick: r.nick, kind: r.kind, text: r.text, ts: r.ts };
  if (r.place) m.place = r.place;
  return m;
}

// ── 정적 파일 ──
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
function resolveStatic(rel: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const segs = decoded.split('/').filter(Boolean);
  if (segs.some((s) => s.startsWith('.') || s.includes('\\'))) return null; // dotfile·상위경로·역슬래시 차단
  const root = resolve(env.TRIP_STATIC_DIR);
  const full = resolve(root, ...segs);
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

// ── 홈 화면 앱(아이콘·이름) ──
// 아이콘·manifest 는 브라우저가 쿠키 없이 가져가므로 로그인 없이 공개한다(개인정보 없음).
const APP_NAME = '시드니 가족여행 2027', APP_SHORT = '시드니 여행', THEME = '#0f6b4f';
const ASSET_DIR = resolve(process.cwd(), 'assets', 'trip');
const ICON_SIZES = ['180', '192', '512'];
export function pwaHead(): string {
  return `<link rel="manifest" href="${BASE}/manifest.webmanifest">
<link rel="apple-touch-icon" href="${BASE}/icon-180.png">
<link rel="icon" type="image/png" sizes="192x192" href="${BASE}/icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${APP_SHORT}">
<meta name="application-name" content="${APP_SHORT}">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="theme-color" content="${THEME}">`;
}
// 앱 화면(index.html)에 홈 화면 앱 설정을 끼워 넣는다 — 비공개 index.html 을 다시 올리지 않아도 되게.
function injectPwa(html: string): string {
  let out = html;
  if (!/rel=["']manifest["']/i.test(out)) out = out.replace(/<\/head>/i, pwaHead() + '\n</head>');
  out = out.replace(/<meta name="viewport" content="([^"]*)">/i, (m, c) => (/viewport-fit/.test(c) ? m : `<meta name="viewport" content="${c}, viewport-fit=cover">`));
  // 상단 제목 왼쪽에 앱 아이콘 — 비공개 index.html 의 <header class="top"> 첫 <h1> 앞에 끼움(이미 있으면 건너뜀).
  // 패턴이 없으면(화면 구조가 바뀌면) 아무것도 안 함.
  if (!/class="ttl-ic"/.test(out)) {
    const before = out;
    out = out.replace(/(<header class="top">\s*)<h1([^>]*)>/i, `$1<h1$2><img class="ttl-ic" src="${BASE}/icon-192.png" alt="" width="36" height="36">`);
    if (out !== before) out = out.replace(/<\/head>/i, `<style>header.top h1{display:flex;align-items:center;gap:10px}header.top h1 .ttl-ic{width:36px;height:36px;border-radius:10px;flex:none;box-shadow:0 1px 3px rgba(0,0,0,.25)}</style>\n</head>`);
  }
  // 「여기로 집합」 스크립트(server/assets/trip/rally.js) — 앱 화면 끝에 붙임
  if (!out.includes(`${BASE}/rally.js`)) out = out.replace(/<\/body>/i, `<script src="${BASE}/rally.js?v=${TRIP_VERSION}" defer></script>\n</body>`);
  return out;
}
const manifest = () => JSON.stringify({
  name: APP_NAME, short_name: APP_SHORT, lang: 'ko', start_url: `${BASE}/`, scope: `${BASE}/`, display: 'standalone',
  background_color: '#f3f6f6', theme_color: THEME,
  icons: [
    { src: `${BASE}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: `${BASE}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
});

// 홈 화면 앱(아이폰)에서 구글 '리다이렉트' 로그인으로 돌아왔을 때 — auth.ts 의 /api/auth/google-redirect 가 호출.
// (홈 화면 앱은 브라우저와 쿠키를 따로 쓰고 팝업 로그인이 잘 안 되므로, 이미 등록된 리다이렉트 주소를 함께 쓴다)
export function tripLoginRedirect(p: { sub: string; email: string; name?: string | null }, reply: FastifyReply) {
  const clear = 'trip_login=; Path=/api/auth; Max-Age=0; SameSite=None; Secure';
  const fail = (msg: string) => reply.header('Set-Cookie', clear).redirect(`${BASE}/?login_error=` + encodeURIComponent(msg));
  const email = p.email.toLowerCase();
  if (!isMemberEmail(email)) return fail('초대되지 않은 계정입니다. 관리자에게 문의하세요.');
  const id = upsertTripUser(p.sub, email, p.name ?? null);
  const attrs = [`${COOKIE}=${signSession(id)}`, `Path=${BASE}`, 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_TTL_MS / 1000}`];
  if (!env.TRIP_COOKIE_INSECURE) attrs.push('Secure');
  reply.header('Set-Cookie', [attrs.join('; '), clear]);
  return reply.redirect(`${BASE}/`);
}
function upsertTripUser(sub: string, email: string, name: string | null): number {
  db.prepare(
    `INSERT INTO trip_users (google_sub, email, name, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = COALESCE(excluded.name, trip_users.name)`
  ).run(sub, email, name, Date.now());
  return (db.prepare('SELECT id FROM trip_users WHERE google_sub = ?').get(sub) as { id: number }).id;
}

function loginPage(): string {
  const cid = JSON.stringify(env.GOOGLE_CLIENT_ID).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<title>가족여행 로그인</title>
${pwaHead()}
<style>
:root{--bg:#f5f6f8;--card:#fff;--text:#111827;--sub:#6b7280;--accent:#0f766e;--err:#dc2626}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--card:#111a2b;--text:#e5e7eb;--sub:#9ca3af;--accent:#2dd4bf;--err:#f87171}}
html,body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
main{max-width:360px;margin:18vh auto 0;padding:0 16px;text-align:center}
.card{background:var(--card);border-radius:16px;padding:28px 20px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:20px;margin:0 0 6px}p{color:var(--sub);font-size:14px;margin:0 0 20px}
#btn{display:flex;justify-content:center;min-height:44px}#msg{color:var(--err);font-size:13px;margin-top:14px;min-height:18px}
.ver{color:var(--sub);font-size:11px;margin-top:16px;opacity:.7}
#inapp{display:none;background:#fef3c7;color:#92400e;border-radius:12px;padding:12px;margin:0 0 16px;font-size:13px;line-height:1.5;text-align:left}
#inapp a{display:block;margin-top:8px;text-align:center;background:var(--accent);color:#fff;border-radius:8px;padding:9px;text-decoration:none;font-weight:600}
</style></head><body><main><div class="card">
<h1>시드니 2027 가족여행</h1><p>가족 구글 계정으로 로그인하세요</p>
<div id="inapp">카카오톡 등 앱 안의 브라우저에서는 로그인이 유지되지 않거나 구글 로그인이 막힐 수 있어요. Chrome(아이폰은 Safari)에서 열어 주세요.<a id="inapp-go" href="#">Chrome에서 열기</a></div>
<div id="btn"></div><div id="msg"></div></div><div class="ver">${TRIP_VERSION}</div></main>
<script src="https://accounts.google.com/gsi/client" async defer onload="init()"></script>
<script>
var CID=${cid};
function show(t){document.getElementById('msg').textContent=t}
/* 앱 안 브라우저(카톡·네이버·인스타·페북·라인 등)는 쿠키를 따로 써서 Chrome 로그인이 이어지지 않음 → 바깥 브라우저로 안내 */
(function(){
  var ua=navigator.userAgent||'', inapp=/KAKAOTALK|NAVER[(]inapp|Instagram|FBAN|FBAV|Line[/]|DaumApps|everytimeApp|; wv[)]/i.test(ua); /* 서버 템플릿 문자열 안이라 역슬래시 대신 [ ] 사용 */
  if(!inapp) return;
  var url=location.href, go=document.getElementById('inapp-go');
  if(/KAKAOTALK/i.test(ua)) go.href='kakaotalk://web/openExternal?url='+encodeURIComponent(url);
  else if(/Android/i.test(ua)) go.href='intent://'+url.replace(/^https?:[/][/]/,'')+'#Intent;scheme=https;package=com.android.chrome;end';
  else go.style.display='none';
  if(/iPhone|iPad/i.test(ua)) go.textContent='Safari에서 열기';
  document.getElementById('inapp').style.display='block';
})();
var STANDALONE=(window.navigator.standalone===true)||(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches);
(function(){ var e=new URLSearchParams(location.search).get('login_error'); if(e) show(e); })();
function init(){
  if(!CID){show('서버 설정 오류(GOOGLE_CLIENT_ID)');return}
  if(STANDALONE){
    /* 홈 화면 앱: 팝업 대신 페이지 이동 로그인. 돌아오는 곳(/api/auth/google-redirect)이 이 표시를 보고 여행앱 로그인으로 처리 */
    document.cookie='trip_login=1; Path=/api/auth; Max-Age=600; SameSite=None; Secure';
    google.accounts.id.initialize({client_id:CID,ux_mode:'redirect',login_uri:location.origin+'/api/auth/google-redirect'});
  } else {
    document.cookie='trip_login=; Path=/api/auth; Max-Age=0; SameSite=None; Secure';
    google.accounts.id.initialize({client_id:CID,callback:onCred,ux_mode:'popup'});
  }
  google.accounts.id.renderButton(document.getElementById('btn'),{theme:'outline',size:'large',text:'signin_with',locale:'ko'});
}
function onCred(r){
  show('확인 중…');
  fetch('api/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential:r.credential}),credentials:'same-origin'})
  .then(function(res){
    if(res.ok){location.replace(location.pathname.replace(/[^/]*$/,''));return}
    show(res.status===403?'초대되지 않은 계정입니다. 관리자에게 문의하세요.':res.status===429?'잠시 후 다시 시도하세요.':'로그인 실패 ('+res.status+')');
  }).catch(function(){show('네트워크 오류')});
}
</script></body></html>`;
}

// ── 로그인 실패 제한 ──
const loginFails = new Map<string, { count: number; first: number }>();
function clientKey(req: FastifyRequest): string {
  const cf = req.headers['cf-connecting-ip'];
  return typeof cf === 'string' && cf ? cf : req.ip;
}

let googleClient: OAuth2Client | null = null;

export default async function tripRoutes(app: FastifyInstance) {
  const api = `${BASE}/api`;

  // 이 플러그인(캡슐화) 라우트 전체 기본값 — 413 등 프레임워크 오류 응답에도 적용된다.
  // 정적 파일 성공 응답만 아래에서 'private, no-cache' 로 덮어쓴다.
  app.addHook('onRequest', async (_req, reply) => {
    noStore(reply);
    securityHeaders(reply);
    reply.header('X-Trip-Version', TRIP_VERSION);
  });

  // ── 인증 ──
  app.post(`${api}/auth/google`, { preHandler: requireSameOrigin, bodyLimit: BODY_LIMIT }, async (req, reply) => {
    noStore(reply);
    if (!env.GOOGLE_CLIENT_ID) return reply.code(503).send({ error: 'GOOGLE_CLIENT_ID not configured' });
    const key = clientKey(req);
    const now = Date.now();
    const rec = loginFails.get(key);
    const inWindow = !!rec && now - rec.first < 5 * 60_000;
    if (inWindow && rec!.count >= 10) return reply.code(429).send({ error: 'too many attempts' });
    const bump = () => (inWindow ? rec!.count++ : loginFails.set(key, { count: 1, first: now }));

    const credential = (req.body as any)?.credential;
    if (typeof credential !== 'string' || !credential) return reply.code(400).send({ error: 'missing credential' });
    let p;
    try {
      googleClient ??= new OAuth2Client(env.GOOGLE_CLIENT_ID);
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID });
      p = ticket.getPayload();
    } catch {
      bump();
      return reply.code(401).send({ error: 'invalid credential' });
    }
    if (!p?.sub || !p.email || !p.email_verified) {
      bump();
      return reply.code(401).send({ error: 'email not verified' });
    }
    const email = p.email.toLowerCase();
    if (!isMemberEmail(email)) {
      bump();
      return reply.code(403).send({ error: 'not a trip member' });
    }
    loginFails.delete(key);
    setSessionCookie(reply, signSession(upsertTripUser(p.sub, email, p.name ?? null)), SESSION_TTL_MS / 1000);
    return { ok: true };
  });

  app.post(`${api}/auth/logout`, { preHandler: requireSameOrigin }, async (_req, reply) => {
    noStore(reply);
    setSessionCookie(reply, '', 0);
    return { ok: true };
  });

  // ── 사용자 ──
  app.get(`${api}/me`, { preHandler: requireTripAuth }, async (req) => {
    const u = tripUser(req);
    const admin = isAdminEmail(u.email);
    return { id: String(u.id), displayName: u.name ?? undefined, isAdmin: admin, isOwner: isOwnerEmail(u.email), canWrite: true, version: TRIP_VERSION };
  });

  // ── 메시지 ──
  app.get(`${api}/messages`, { preHandler: requireTripAuth }, async (req, reply) => {
    const raw = (req.query as any)?.after;
    const after = raw === undefined || raw === '' ? 0 : Number(raw);
    if (!Number.isSafeInteger(after) || after < 0) return reply.code(400).send({ error: 'bad after' });
    const rows = db
      .prepare('SELECT id, uid, nick, kind, text, place, ts FROM trip_messages WHERE id > ? ORDER BY id ASC LIMIT ?')
      .all(after, MAX_PAGE) as MessageRow[];
    return { messages: rows.map(toMessage) };
  });

  app.post(
    `${api}/messages`,
    { preHandler: [requireSameOrigin, requireTripAuth], bodyLimit: BODY_LIMIT },
    async (req, reply) => {
      const u = tripUser(req);
      const b = req.body as any;
      if (!b || typeof b !== 'object' || Array.isArray(b)) return reply.code(400).send({ error: 'bad body' });
      // uid / ts / id 는 본문 값을 무시하고 서버가 정한다.
      const nick = typeof b.nick === 'string' ? clean(b.nick, false).trim() : '';
      if (len(nick) < 1 || len(nick) > 12) return reply.code(400).send({ error: 'bad nick' });
      const kind = b.kind;
      if (kind !== 'text' && kind !== 'place') return reply.code(400).send({ error: 'bad kind' });
      const text = typeof b.text === 'string' ? clean(b.text, kind === 'text').trim() : '';
      let place: string | null = null;
      if (kind === 'text') {
        if (len(text) < 1 || len(text) > 1000) return reply.code(400).send({ error: 'bad text' });
      } else {
        if (len(text) > 200) return reply.code(400).send({ error: 'bad text' });
        if (typeof b.place !== 'string' || !PLACE_RE.test(b.place)) return reply.code(400).send({ error: 'bad place' });
        const known = await knownPlaces();
        if (known && !known.has(b.place)) return reply.code(400).send({ error: 'unknown place' });
        place = b.place;
      }
      if (rateLimited(u.id)) return reply.code(429).send({ error: 'rate limited' });
      const ts = Date.now();
      const uid = String(u.id);
      const info = db
        .prepare('INSERT INTO trip_messages (uid, nick, kind, text, place, ts) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uid, nick, kind, text, place, ts);
      return reply
        .code(201)
        .send(toMessage({ id: Number(info.lastInsertRowid), uid, nick, kind, text, place, ts }));
    }
  );

  // ── 공지 ──
  const getNotice = () => {
    const r = db.prepare('SELECT text, ts, updated_by FROM trip_notice WHERE id = 1').get() as
      | { text: string; ts: number; updated_by: string | null }
      | undefined;
    return r ? { text: r.text, ts: r.ts, updatedBy: r.updated_by ?? undefined } : { text: '', ts: 0 };
  };
  app.get(`${api}/notice`, { preHandler: requireTripAuth }, async () => getNotice());

  app.put(
    `${api}/notice`,
    { preHandler: [requireSameOrigin, requireTripAuth], bodyLimit: BODY_LIMIT },
    async (req, reply) => {
      const u = tripUser(req);
      if (!isAdminEmail(u.email)) return reply.code(403).send({ error: 'admin only' });
      const b = req.body as any;
      const text = typeof b?.text === 'string' ? clean(b.text, true).trim() : null;
      if (text === null || len(text) > 2000) return reply.code(400).send({ error: 'bad text' });
      const by = u.name ?? String(u.id);
      db.prepare(
        `INSERT INTO trip_notice (id, text, ts, updated_by) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET text = excluded.text, ts = excluded.ts, updated_by = excluded.updated_by`
      ).run(text, Date.now(), by);
      return getNotice();
    }
  );

  // 알 수 없는 API 경로는 정적 처리로 흘리지 않는다.
  // ── 일정·영수증 ──
  registerScheduleRoutes(app, api, { requireTripAuth, requireSameOrigin, email: (req) => tripUser(req).email });
  // ── 여기로 집합 ──
  registerRallyRoutes(app, api, { requireTripAuth, requireSameOrigin, user: (req) => tripUser(req) });

  // ── 경비 (소유자 전용) ──
  registerExpenseRoutes(app, api, { requireTripAuth, requireSameOrigin, email: (req) => tripUser(req).email });

  app.all(`${api}/*`, async (_req, reply) => {
    noStore(reply);
    return reply.code(404).send({ error: 'not found' });
  });

  // ── 정적 파일 (로그인 뒤) ──
  app.get(BASE, async (_req, reply) => reply.redirect(`${BASE}/`, 301));
  app.get(`${BASE}/manifest.webmanifest`, async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.type('application/manifest+json; charset=utf-8').send(manifest());
  });
  // 앱 화면에 끼워 넣는 기능 스크립트(개인정보 없음 — API 는 로그인 쿠키로만 동작)
  app.get(`${BASE}/rally.js`, async (_req, reply) => {
    try {
      const buf = await readFile(resolve(ASSET_DIR, 'rally.js'));
      reply.header('Cache-Control', 'no-cache');
      return reply.type('text/javascript; charset=utf-8').send(buf);
    } catch { return reply.code(404).send('not found'); }
  });
  app.get(`${BASE}/icon-:size.png`, async (req, reply) => {
    const size = (req.params as any).size;
    if (!ICON_SIZES.includes(size)) return reply.code(404).send('not found');
    try {
      const buf = await readFile(resolve(ASSET_DIR, `icon-${size}.png`));
      reply.header('Cache-Control', 'public, max-age=86400');
      return reply.type('image/png').send(buf);
    } catch { return reply.code(404).send('not found'); }
  });
  app.get(`${BASE}/*`, async (req, reply) => {
    securityHeaders(reply);
    const rel = (req.params as any)['*'] as string;
    const wantsPage = rel === '' || rel.endsWith('/') || rel.endsWith('.html') || !extname(rel);
    const cur = currentUser(req);
    if (!cur) {
      noStore(reply);
      if (wantsPage) return reply.code(200).type('text/html; charset=utf-8').send(loginPage());
      return reply.code(401).type('text/plain; charset=utf-8').send('unauthorized');
    }
    // 앱 페이지를 못 찾으면: 관리자에게는 진단 화면, 그 외에는 안내 문구(서버 경로 비노출)
    const notFound = async () => {
      noStore(reply);
      if (!wantsPage) return reply.code(404).type('text/plain; charset=utf-8').send('not found');
      const body = isAdminEmail(cur.user.email) ? await missingPage(rel) : missingPageMember();
      return reply.code(404).type('text/html; charset=utf-8').send(body);
    };
    let full = resolveStatic(rel === '' || rel.endsWith('/') ? `${rel}index.html` : rel);
    if (!full) return notFound();
    try {
      let st = await stat(full);
      if (st.isDirectory()) {
        full = resolve(full, 'index.html');
        st = await stat(full);
      }
      if (!st.isFile()) return notFound();
      const type = MIME[extname(full).toLowerCase()];
      if (!type) return notFound();
      // private: Cloudflare 등 공유 캐시 저장 금지 / no-cache: 일정 수정 즉시 반영
      reply.header('Cache-Control', 'private, no-cache');
      // 앱 화면을 열 때마다 세션 쿠키를 새로 발급 — 30일 만료가 매번 연장되고, 예전(Strict) 쿠키도 Lax 로 바뀐다.
      if (type.startsWith('text/html')) setSessionCookie(reply, signSession(cur.user.id), SESSION_TTL_MS / 1000);
      if (type.startsWith('text/html')) return reply.type(type).send(injectPwa((await readFile(full)).toString('utf8')));
      return reply.type(type).send(await readFile(full));
    } catch {
      return notFound();
    }
  });
}

// ── 앱 파일 누락 안내 ──
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
function simplePage(title: string, inner: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>:root{--bg:#f5f6f8;--card:#fff;--text:#111827;--sub:#6b7280;--ok:#15803d;--err:#dc2626;--code:#f1f5f9}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--card:#111a2b;--text:#e5e7eb;--sub:#9ca3af;--ok:#4ade80;--err:#f87171;--code:#1e293b}}
body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;font-size:15px;line-height:1.55}
main{max-width:560px;margin:8vh auto;padding:0 16px}.card{background:var(--card);border-radius:14px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:18px;margin:0 0 8px}p{margin:8px 0;color:var(--sub)}code{background:var(--code);border-radius:6px;padding:2px 6px;word-break:break-all;font-size:13px}
ul{padding-left:18px;margin:8px 0}.ok{color:var(--ok)}.no{color:var(--err)}.ver{color:var(--sub);font-size:11px;text-align:center;margin-top:14px}</style>
</head><body><main><div class="card">${inner}</div><div class="ver">${TRIP_VERSION}</div></main></body></html>`;
}
function missingPageMember(): string {
  return simplePage('준비 중', '<h1>여행앱을 준비 중이에요</h1><p>로그인은 됐어요. 관리자가 앱 파일을 올리면 바로 열립니다.</p>');
}
async function missingPage(rel: string): Promise<string> {
  const root = resolve(env.TRIP_STATIC_DIR);
  let rootOk = false;
  let listing: string[] = [];
  try {
    rootOk = (await stat(root)).isDirectory();
    if (rootOk) listing = (await readdir(root)).filter((n) => !n.startsWith('.')).slice(0, 30);
  } catch { /* 폴더 없음 */ }
  const need = ['index.html', 'trip-data.js'];
  const items = need
    .map((n) => `<li class="${listing.includes(n) ? 'ok' : 'no'}">${listing.includes(n) ? '✓' : '✗'} <code>${n}</code></li>`)
    .join('');
  const others = listing.filter((n) => !need.includes(n));
  return simplePage(
    '앱 파일 없음',
    `<h1>앱 파일을 찾지 못했어요 (관리자에게만 보이는 화면)</h1>
<p>로그인은 정상입니다. 요청 경로: <code>/trip/${esc(rel)}</code></p>
<p>서버가 읽는 폴더 (<code>TRIP_STATIC_DIR</code>):<br><code>${esc(root)}</code> — ${rootOk ? '<span class="ok">폴더 있음</span>' : '<span class="no">폴더 없음</span>'}</p>
<ul>${items}</ul>
${others.length ? `<p>폴더에 있는 다른 파일: ${others.map((n) => `<code>${esc(n)}</code>`).join(' ')}<br>파일 이름이 정확히 <code>index.html</code>·<code>trip-data.js</code> 인지 확인하세요 (예: <code>index.html.html</code>, 앞에 붙은 접두어).</p>` : ''}
<p><b>관리 페이지(admin.html) → 「여행앱 파일」 카드</b>에서 올리거나, 위 폴더에 두 파일을 직접 넣고 새로고침하면 됩니다. 서버 재시작은 필요 없어요.</p>`
  );
}
