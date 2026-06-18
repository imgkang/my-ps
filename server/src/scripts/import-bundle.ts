// 일회성 마이그레이션 — 기존 Google Drive 의 mypm-data.json (또는 앱에서 내보낸 번들)을
// SQLite data_bundle 로 적재한다.
//   사용법: npm run import -- <path/to/mypm-data.json>
import { readFileSync } from 'node:fs';
import { db } from '../db.js';

const path = process.argv[2];
if (!path) {
  console.error('사용법: npm run import -- <path/to/mypm-data.json>');
  process.exit(1);
}

const raw = readFileSync(path, 'utf8');
let bundle: any;
try {
  bundle = JSON.parse(raw);
} catch {
  console.error('❌ JSON 파싱 실패:', path);
  process.exit(1);
}

const version = Number(bundle.version ?? 0);
const now = new Date().toISOString();
db.prepare('UPDATE data_bundle SET version = ?, json = ?, updated_at = ? WHERE id = 1').run(
  version,
  JSON.stringify(bundle),
  now
);

const keys = Object.keys(bundle).filter((k) => k !== 'version' && k !== 'exportedAt');
console.log(`✅ 번들 적재 완료 — version ${version}, 섹션: ${keys.join(', ')}`);
