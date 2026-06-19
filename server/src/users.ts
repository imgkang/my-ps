// 사용자 조회/생성 헬퍼.
import { db } from './db.js';

export type User = {
  id: number;
  google_sub: string | null;
  email: string;
  name: string | null;
};

// 구글 로그인 페이로드로 사용자를 upsert.
//  - google_sub 로 우선 조회
//  - 없으면 email 로 조회(마이그레이션으로 미리 만들어진 소유자 계정 연결)
//  - 둘 다 없으면 신규 생성
export function upsertGoogleUser(g: { sub: string; email: string; name: string | null }): User {
  const now = new Date().toISOString();

  let row = db
    .prepare('SELECT id, google_sub, email, name FROM users WHERE google_sub = ?')
    .get(g.sub) as User | undefined;

  if (!row) {
    row = db
      .prepare('SELECT id, google_sub, email, name FROM users WHERE email = ?')
      .get(g.email) as User | undefined;
    if (row) {
      // 기존(이관) 계정에 google_sub 연결 + 이름 보강
      db.prepare('UPDATE users SET google_sub = ?, name = COALESCE(?, name) WHERE id = ?').run(
        g.sub,
        g.name,
        row.id
      );
      row.google_sub = g.sub;
      if (g.name && !row.name) row.name = g.name;
    }
  }

  if (!row) {
    const info = db
      .prepare('INSERT INTO users (google_sub, email, name, created_at) VALUES (?, ?, ?, ?)')
      .run(g.sub, g.email, g.name, now);
    return { id: Number(info.lastInsertRowid), google_sub: g.sub, email: g.email, name: g.name };
  }

  return row;
}

export function userIdByEmail(email: string): number | null {
  const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase()) as
    | { id: number }
    | undefined;
  return row ? row.id : null;
}
