// 가족여행 앱(/trip) 로그인 허용 이메일 — DB(trip_members) 기반.
// 관리자 화면(admin.html "계정 관리")에서 MyPM 허용목록과 함께 추가/삭제한다.
// .env TRIP_MEMBER_EMAILS 는 최초 1회만 테이블로 옮긴다(이후 화면에서 지운 계정이 재시작 시 되살아나지 않도록).
// 소유자(OWNER_EMAIL)와 TRIP_ADMIN_EMAILS 는 항상 멤버·관리자이며 화면에서 끌 수 없다.
import { db } from './db.js';
import { env } from './env.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS trip_members (
    email    TEXT PRIMARY KEY,   -- 소문자 정규화
    note     TEXT,
    added_at TEXT NOT NULL
  );
`);

const norm = (e: string) => e.trim().toLowerCase();
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

(function seedOnce() {
  const flag = db.prepare("SELECT 1 FROM app_meta WHERE key = 'trip_members_seeded'").get();
  if (flag) return;
  const now = new Date().toISOString();
  const ins = db.prepare('INSERT OR IGNORE INTO trip_members (email, note, added_at) VALUES (?, ?, ?)');
  db.transaction(() => {
    for (const e of env.TRIP_MEMBER_EMAILS) ins.run(e, '.env 에서 이관', now);
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('trip_members_seeded', ?)").run(now);
  })();
})();

// 소유자(OWNER_EMAIL)는 TRIP_ADMIN_EMAILS 설정과 무관하게 항상 여행앱 관리자(=멤버).
export function isTripAdminEmail(email: string): boolean {
  const e = norm(email);
  return (!!env.OWNER_EMAIL && e === env.OWNER_EMAIL) || env.TRIP_ADMIN_EMAILS.includes(e);
}

export function isTripMemberEmail(email: string): boolean {
  const e = norm(email);
  if (isTripAdminEmail(e)) return true;
  return !!db.prepare('SELECT 1 FROM trip_members WHERE email = ?').get(e);
}

export type TripMember = { email: string; note: string | null; added_at: string };
export function listTripMembers(): TripMember[] {
  return db.prepare('SELECT email, note, added_at FROM trip_members ORDER BY added_at ASC').all() as TripMember[];
}

// 반환: 새로 추가됐으면 true
export function addTripMember(email: string, note?: string | null): boolean {
  const e = norm(email);
  if (!EMAIL_RE.test(e)) throw new Error('invalid email');
  const info = db
    .prepare('INSERT OR IGNORE INTO trip_members (email, note, added_at) VALUES (?, ?, ?)')
    .run(e, note?.trim() || null, new Date().toISOString());
  return info.changes > 0;
}

// 반환: 삭제됐으면 true. 여행앱 관리자는 삭제 불가.
export function removeTripMember(email: string): boolean {
  const e = norm(email);
  if (isTripAdminEmail(e)) throw new Error('cannot remove trip admin');
  return db.prepare('DELETE FROM trip_members WHERE email = ?').run(e).changes > 0;
}

// 여행앱에 실제 로그인한 적이 있는 이메일
export function tripSignedUpEmails(): Set<string> {
  const rows = db.prepare('SELECT DISTINCT email FROM trip_users').all() as { email: string }[];
  return new Set(rows.map((r) => r.email));
}
