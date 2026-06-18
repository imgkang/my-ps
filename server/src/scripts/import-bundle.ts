// 일회성 마이그레이션 — 기존 Google Drive 의 mypm-data.json (또는 앱에서 내보낸 번들)을
// SQLite data_bundle 로 적재한다.
//   사용법: npm run import -- <path/to/mypm-data.json>
//
// 안전장치: 알려진 섹션(mypm/nonk/kdeal/kd) 검증, 적재 전후 version 표시,
// 섹션별 건수 요약 출력 → 사용자가 "내 데이터가 제대로 들어갔다"를 눈으로 확인.
import { readFileSync } from 'node:fs';
import { db } from '../db.js';

const path = process.argv[2];
if (!path) {
  console.error('사용법: npm run import -- <path/to/mypm-data.json>');
  process.exit(1);
}

let bundle: any;
try {
  bundle = JSON.parse(readFileSync(path, 'utf8'));
} catch (e: any) {
  console.error('❌ 파일을 읽거나 JSON 파싱에 실패했습니다:', path, '\n  ', e?.message);
  process.exit(1);
}

// 구조 검증 — buildDriveBundle(index.html) 의 섹션 키와 동일.
const KNOWN_SECTIONS = ['mypm', 'nonk', 'kdeal', 'kd'];
if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
  console.error('❌ 번들이 객체 형태가 아닙니다. mypm-data.json 이 맞는지 확인하세요.');
  process.exit(1);
}
const present = KNOWN_SECTIONS.filter((s) => bundle[s] && typeof bundle[s] === 'object');
if (present.length === 0) {
  console.error(
    `❌ 알려진 섹션(${KNOWN_SECTIONS.join('/')})이 하나도 없습니다. mypm-data.json 이 맞는지 확인하세요.`
  );
  process.exit(1);
}

// 배열 길이를 안전하게 읽는 헬퍼 (경로: 섹션.키 또는 섹션.키.하위)
const len = (obj: any, ...keys: string[]): number => {
  let cur = obj;
  for (const k of keys) cur = cur?.[k];
  return Array.isArray(cur) ? cur.length : 0;
};

const version = Number(bundle.version ?? 0);
const prev = db.prepare('SELECT version FROM data_bundle WHERE id = 1').get() as { version: number };
const now = new Date().toISOString();

db.prepare('UPDATE data_bundle SET version = ?, json = ?, updated_at = ? WHERE id = 1').run(
  version,
  JSON.stringify(bundle),
  now
);

// 적재 요약 ----------------------------------------------------------------
console.log('\n✅ 번들 적재 완료');
console.log(`   버전: ${prev?.version ?? 0} → ${version}` + (bundle.exportedAt ? `  (내보낸 시각: ${bundle.exportedAt})` : ''));
console.log(`   섹션: ${present.join(', ')}`);
console.log('   ── 섹션별 건수 ──');
if (bundle.mypm) {
  console.log(`   MyPM  : 보유종목 ${len(bundle.mypm, 'holdings')}, 거래 ${len(bundle.mypm, 'trades')}, ` +
    `입출금 ${len(bundle.mypm, 'deposits', 'transactions') || len(bundle.mypm, 'deposits')}, ` +
    `배당 ${len(bundle.mypm, 'dividendRecords')}, 월별 ${len(bundle.mypm, 'monthlyRecords')}`);
}
if (bundle.nonk) {
  console.log(`   NonK  : 보유종목 ${len(bundle.nonk, 'holdings')}, 배당 ${len(bundle.nonk, 'dividends')}, ` +
    `월별 ${len(bundle.nonk, 'monthly')}, 관심 ${len(bundle.nonk, 'watchlist')}`);
}
if (bundle.kdeal) {
  console.log(`   KDeal : 거래 ${len(bundle.kdeal, 'trades')}, 입출금 ${len(bundle.kdeal, 'deposits')}, ` +
    `관심 ${len(bundle.kdeal, 'watchlist')}`);
}
if (bundle.kd) {
  console.log(`   KD    : 보유종목 ${len(bundle.kd, 'holdings')}, 거래 ${len(bundle.kd, 'trades')}, ` +
    `배당 ${len(bundle.kd, 'dividends')}, 계좌 ${len(bundle.kd, 'accounts')}, 관심 ${len(bundle.kd, 'watchlist')}`);
}
console.log('\n   → 테스트 페이지에서 Login → Get Bundle 로 실데이터를 확인하세요.\n');
