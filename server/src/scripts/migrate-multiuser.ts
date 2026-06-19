// 일회성 마이그레이션 — 단일 사용자(id=1) → 다중 사용자(user_id) 스키마 이관.
//   사용법: npm run migrate     (.env 의 OWNER_EMAIL 계정으로 기존 데이터 이관)
//
// 안전장치:
//   - 실행 전 DB 파일을 .bak-<시각> 으로 백업
//   - 트랜잭션 내에서 처리(실패 시 롤백)
//   - 이미 이관된 경우(user_id 존재) 안전하게 건너뜀
//   - db.ts 를 import 하지 않고 직접 연결(구스키마 가드에 걸리지 않도록)
import Database from 'better-sqlite3';
import { copyFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { env } from '../env.js';

const owner = env.OWNER_EMAIL;
if (!owner) {
  console.error('❌ .env 에 OWNER_EMAIL 을 설정하세요 (기존 데이터를 이 계정으로 이관).');
  process.exit(1);
}
if (!existsSync(env.DB_PATH)) {
  console.error('❌ DB 파일이 없습니다:', env.DB_PATH);
  process.exit(1);
}

// 백업
const bak = `${env.DB_PATH}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
copyFileSync(env.DB_PATH, bak);
console.log('💾 DB 백업 생성:', bak);

const db = new Database(env.DB_PATH);
db.pragma('foreign_keys = OFF');

const tableExists = (t: string): boolean =>
  !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
const hasCol = (t: string, c: string): boolean =>
  (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).some((x) => x.name === c);

const now = new Date().toISOString();

const run = db.transaction(() => {
  // users / app_meta 보장
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_sub TEXT UNIQUE, email TEXT NOT NULL UNIQUE, name TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_meta ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
  `);

  if (!db.prepare("SELECT 1 FROM app_meta WHERE key='token_secret'").get()) {
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('token_secret', ?)").run(
      randomBytes(32).toString('hex')
    );
    console.log('🔑 토큰 서명키 생성');
  }

  // 소유자 계정 확보
  let ownerRow = db.prepare('SELECT id FROM users WHERE email = ?').get(owner) as
    | { id: number }
    | undefined;
  if (!ownerRow) {
    const info = db.prepare('INSERT INTO users (email, created_at) VALUES (?, ?)').run(owner, now);
    ownerRow = { id: Number(info.lastInsertRowid) };
    console.log(`👤 소유자 계정 생성: ${owner} (id=${ownerRow.id})`);
  } else {
    console.log(`👤 소유자 계정 존재: ${owner} (id=${ownerRow.id})`);
  }
  const ownerId = ownerRow.id;

  // data_bundle 재구성 (id 기반 → user_id 기반)
  if (tableExists('data_bundle') && !hasCol('data_bundle', 'user_id')) {
    const legacy = db.prepare('SELECT version, json, updated_at FROM data_bundle WHERE id = 1').get() as
      | { version: number; json: string; updated_at: string }
      | undefined;
    db.exec('ALTER TABLE data_bundle RENAME TO data_bundle_old');
    db.exec(`
      CREATE TABLE data_bundle (
        user_id INTEGER PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 0,
        json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    if (legacy && legacy.json && legacy.json !== '{}') {
      db.prepare(
        'INSERT INTO data_bundle (user_id, version, json, updated_at) VALUES (?, ?, ?, ?)'
      ).run(ownerId, legacy.version, legacy.json, legacy.updated_at || now);
      console.log(`📦 기존 번들 이관 → ${owner} (version ${legacy.version})`);
    } else {
      console.log('📦 이관할 기존 번들 없음(빈 상태) — 건너뜀');
    }
    db.exec('DROP TABLE data_bundle_old');
  } else {
    console.log('📦 data_bundle 이미 다중 사용자 스키마 — 건너뜀');
  }

  // alerts.user_id
  if (tableExists('alerts') && !hasCol('alerts', 'user_id')) {
    db.exec('ALTER TABLE alerts ADD COLUMN user_id INTEGER');
    const n = db.prepare('UPDATE alerts SET user_id = ? WHERE user_id IS NULL').run(ownerId).changes;
    db.exec('CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id)');
    console.log(`🔔 alerts.user_id 추가 + 기존 ${n}건 이관`);
  }

  // devices.user_id
  if (tableExists('devices') && !hasCol('devices', 'user_id')) {
    db.exec('ALTER TABLE devices ADD COLUMN user_id INTEGER');
    const n = db.prepare('UPDATE devices SET user_id = ? WHERE user_id IS NULL').run(ownerId).changes;
    db.exec('CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id)');
    console.log(`📱 devices.user_id 추가 + 기존 ${n}건 이관`);
  }
});

run();
db.pragma('foreign_keys = ON');
db.close();

console.log('\n✅ 다중 사용자 마이그레이션 완료.');
console.log('   이제 `npm run build` 후 백엔드를 재시작하세요.');
console.log(`   문제가 생기면 백업(${bak})을 mypm.db 로 복원하면 됩니다.\n`);
