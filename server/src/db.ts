// SQLite 초기화 및 스키마 (다중 사용자).
//
// 설계 노트: 전체 데이터는 사용자별 data_bundle 한 행에 JSON 으로 보관한다
// (= 기존 Google Drive mypm-data.json 과 동일 구조, 사용자별로 분리).
// 조회/질의가 필요한 영역(종목 검색, 디바이스 토큰, 가격 알림)만 정규화 테이블로 둔다.
//
// ⚠️ 기존(단일 사용자) DB 는 `npm run migrate` 로 먼저 이관해야 한다.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { env } from './env.js';

mkdirSync(dirname(env.DB_PATH), { recursive: true });

export const db = new Database(env.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- 사용자 (구글 로그인). google_sub = 구글 고유 ID.
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    google_sub TEXT UNIQUE,
    email      TEXT NOT NULL UNIQUE,
    name       TEXT,
    created_at TEXT NOT NULL
  );

  -- 서버 메타 (토큰 서명 비밀키 등 단일 키/값).
  CREATE TABLE IF NOT EXISTS app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- 사용자별 전체 데이터 번들 (Drive 의 mypm-data.json 과 동일 구조).
  CREATE TABLE IF NOT EXISTS data_bundle (
    user_id    INTEGER PRIMARY KEY,
    version    INTEGER NOT NULL DEFAULT 0,
    json       TEXT    NOT NULL DEFAULT '{}',
    updated_at TEXT    NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- 종목 마스터 (update_tickers.py 결과 적재). 클라이언트 검색 + 서버 검색 공용. (사용자 무관 공용 데이터)
  CREATE TABLE IF NOT EXISTS tickers (
    t       TEXT NOT NULL,            -- ticker/symbol
    n       TEXT,                     -- english name
    k       TEXT,                     -- korean name
    e       TEXT,                     -- exchange
    c       TEXT NOT NULL,            -- country (KR/US/...)
    y       TEXT,                     -- type (EQ/ETF/IDX/...)
    PRIMARY KEY (t, c)
  );
  CREATE INDEX IF NOT EXISTS idx_tickers_country ON tickers(c);

  -- 푸시 디바이스 토큰 (platform: ios=APNs, android=FCM, web=미지원)
  CREATE TABLE IF NOT EXISTS devices (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    platform   TEXT NOT NULL DEFAULT 'ios',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

  -- 가격 알림 규칙
  CREATE TABLE IF NOT EXISTS alerts (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    app        TEXT NOT NULL,          -- mypm | nonk | kd
    code       TEXT NOT NULL,          -- 종목 코드/티커
    name       TEXT,
    op         TEXT NOT NULL,          -- '>=' | '<=' (목표가 도달 방향)
    threshold  REAL NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    last_fired TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);

  -- 성과측정 스냅샷 (배포마다 1회 누적: 프론트 크기 + 인출 계산속도)
  CREATE TABLE IF NOT EXISTS bench_runs (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    sha     TEXT NOT NULL,
    version TEXT,
    ts      TEXT NOT NULL,
    json    TEXT NOT NULL
  );
`);

// 구(舊) 단일 사용자 스키마 감지 → 마이그레이션 유도.
// (기존 DB 에는 data_bundle 이 이미 id 기반으로 존재하므로 위 CREATE IF NOT EXISTS 가 무시됨)
const bundleCols = db.prepare('PRAGMA table_info(data_bundle)').all() as { name: string }[];
if (!bundleCols.some((c) => c.name === 'user_id')) {
  throw new Error(
    '[db] 구버전(단일 사용자) 스키마가 감지되었습니다.\n' +
      '     먼저 `npm run migrate` 를 실행해 다중 사용자 스키마로 이관하세요.'
  );
}

// 앱 토큰 서명용 비밀키 — DB 에 1회 생성·영속(서버 재시작/이전에도 토큰 유지).
export function getTokenSecret(): string {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = 'token_secret'").get() as
    | { value: string }
    | undefined;
  if (row) return row.value;
  const secret = randomBytes(32).toString('hex');
  db.prepare("INSERT INTO app_meta (key, value) VALUES ('token_secret', ?)").run(secret);
  return secret;
}

export type BundleRow = { version: number; json: string; updated_at: string };
