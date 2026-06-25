// 로그인 허용 이메일(화이트리스트) 관리 — DB(allowed_emails) 기반.
//
// 기존에는 .env 의 ALLOWED_EMAILS 만 사용했으나(추가 시 서버 재시작 필요),
// 이제 DB 테이블로 관리해 관리자 화면에서 실시간 추가/삭제할 수 있다.
// 서버 시작 시 .env 의 ALLOWED_EMAILS + OWNER_EMAIL 을 테이블로 시딩(있으면 무시)해
// 기존 설정이 그대로 이어지고, 소유자가 목록에서 빠질 일이 없도록 한다.
import { db } from './db.js';
import { env } from './env.js';

export type AllowedEmail = {
  email: string;
  note: string | null;
  added_at: string;
  signed_up: boolean; // 실제로 로그인(가입)해 users 에 존재하는지
};

function norm(email: string): string {
  return email.trim().toLowerCase();
}

// 서버 시작 시 1회 — .env 값과 소유자 이메일을 테이블로 옮긴다(이미 있으면 유지).
export function seedAllowedEmails(): void {
  const now = new Date().toISOString();
  const ins = db.prepare(
    'INSERT OR IGNORE INTO allowed_emails (email, note, added_at) VALUES (?, ?, ?)'
  );
  const seed = new Set<string>(env.ALLOWED_EMAILS);
  if (env.OWNER_EMAIL) seed.add(env.OWNER_EMAIL);
  const tx = db.transaction(() => {
    for (const e of seed) ins.run(e, '.env 에서 이관', now);
  });
  tx();
}

// 로그인 허용 여부 — DB 조회. 소유자는 항상 허용(안전장치).
export function isEmailAllowed(email: string): boolean {
  const e = norm(email);
  if (env.OWNER_EMAIL && e === env.OWNER_EMAIL) return true;
  const row = db.prepare('SELECT 1 FROM allowed_emails WHERE email = ?').get(e);
  return !!row;
}

// 허용목록 전체 — 가입(로그인) 여부 포함, 추가된 순서대로.
export function listAllowedEmails(): AllowedEmail[] {
  const rows = db
    .prepare(
      `SELECT a.email, a.note, a.added_at,
              CASE WHEN u.id IS NOT NULL THEN 1 ELSE 0 END AS signed_up
         FROM allowed_emails a
         LEFT JOIN users u ON u.email = a.email
        ORDER BY a.added_at ASC`
    )
    .all() as { email: string; note: string | null; added_at: string; signed_up: number }[];
  return rows.map((r) => ({ ...r, signed_up: !!r.signed_up }));
}

// 이메일 추가. 형식 검증 후 삽입. 반환: 새로 추가됐으면 true, 이미 있었으면 false.
export function addAllowedEmail(email: string, note?: string | null): boolean {
  const e = norm(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
    throw new Error('invalid email');
  }
  const info = db
    .prepare('INSERT OR IGNORE INTO allowed_emails (email, note, added_at) VALUES (?, ?, ?)')
    .run(e, note?.trim() || null, new Date().toISOString());
  return info.changes > 0;
}

// 이메일 제거. 소유자 이메일은 보호(삭제 거부). 반환: 삭제됐으면 true.
export function removeAllowedEmail(email: string): boolean {
  const e = norm(email);
  if (env.OWNER_EMAIL && e === env.OWNER_EMAIL) {
    throw new Error('cannot remove owner');
  }
  const info = db.prepare('DELETE FROM allowed_emails WHERE email = ?').run(e);
  return info.changes > 0;
}
