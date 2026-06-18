// SQLite 초기화 및 스키마.
//
// 설계 노트: 기존 앱은 Google Drive 에 "단일 JSON 번들"(mypm-data.json, version 12)을
// 통째로 백업한다. 동기화는 이 모델을 그대로 따르는 것이 프론트 변경을 최소화하므로,
// 전체 데이터는 data_bundle 한 행에 JSON 으로 보관한다(= Drive 파일과 동일).
// 조회/질의가 필요한 영역(종목 검색, 디바이스 토큰, 가격 알림)만 정규화 테이블로 둔다.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from './env.js';

mkdirSync(dirname(env.DB_PATH), { recursive: true });

export const db = new Database(env.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- 전체 데이터 번들 (Drive 의 mypm-data.json 과 동일 구조). 단일 행(id=1).
  CREATE TABLE IF NOT EXISTS data_bundle (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    version    INTEGER NOT NULL DEFAULT 0,
    json       TEXT    NOT NULL DEFAULT '{}',
    updated_at TEXT    NOT NULL
  );

  -- 종목 마스터 (update_tickers.py 결과 적재). 클라이언트 검색 + 서버 검색 공용.
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

  -- 푸시 디바이스 토큰 (APNs)
  CREATE TABLE IF NOT EXISTS devices (
    token      TEXT PRIMARY KEY,
    platform   TEXT NOT NULL DEFAULT 'ios',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 가격 알림 규칙
  CREATE TABLE IF NOT EXISTS alerts (
    id         TEXT PRIMARY KEY,
    app        TEXT NOT NULL,          -- mypm | nonk | kd
    code       TEXT NOT NULL,          -- 종목 코드/티커
    name       TEXT,
    op         TEXT NOT NULL,          -- '>=' | '<=' (목표가 도달 방향)
    threshold  REAL NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    last_fired TEXT,
    created_at TEXT NOT NULL
  );
`);

// 번들 단일 행 보장
db.prepare(
  `INSERT OR IGNORE INTO data_bundle (id, version, json, updated_at)
   VALUES (1, 0, '{}', ?)`
).run(new Date().toISOString());

export type BundleRow = { version: number; json: string; updated_at: string };
