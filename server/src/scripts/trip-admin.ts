// 가족여행 채팅 보관 관리 (수동). 자동 삭제는 하지 않는다.
//   npm run trip-admin -- export [파일경로]   메시지·공지를 JSON 으로 내보내기 (기본 ./data/trip-export-<날짜>.json)
//   npm run trip-admin -- purge --yes         메시지·공지·여행앱 사용자 전부 삭제 (먼저 export 권장)
//   npm run trip-admin -- stats               건수만 출력
import '../env.js';
import { writeFileSync } from 'node:fs';
import { db } from '../db.js';

const [cmd, arg] = process.argv.slice(2);
const has = (t: string) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);

if (!has('trip_messages')) {
  console.log('trip 테이블이 아직 없습니다(서버를 한 번 실행하면 생성됨).');
  process.exit(0);
}

if (cmd === 'stats') {
  const n = (t: string) => (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
  console.log({ messages: n('trip_messages'), users: n('trip_users'), notice: n('trip_notice') });
} else if (cmd === 'export') {
  const out = arg ?? `./data/trip-export-${new Date().toISOString().slice(0, 10)}.json`;
  const data = {
    exportedAt: new Date().toISOString(),
    messages: db.prepare('SELECT id, uid, nick, kind, text, place, ts FROM trip_messages ORDER BY id').all(),
    notice: db.prepare('SELECT text, ts, updated_by FROM trip_notice WHERE id = 1').get() ?? null,
  };
  writeFileSync(out, JSON.stringify(data, null, 2), 'utf8');
  console.log(`내보냄: ${out} (메시지 ${data.messages.length}건)`);
} else if (cmd === 'purge') {
  if (arg !== '--yes') {
    console.log('정말 삭제하려면: npm run trip-admin -- purge --yes');
    process.exit(1);
  }
  db.transaction(() => {
    db.exec('DELETE FROM trip_messages; DELETE FROM trip_notice; DELETE FROM trip_users;');
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('trip_messages','trip_users')");
  })();
  console.log('여행앱 데이터를 삭제했습니다.');
} else {
  console.log('사용법: npm run trip-admin -- <stats|export [경로]|purge --yes>');
}
