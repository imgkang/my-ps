// 파생상태 파리티 — 클라 계산(골든) vs 서버 computeDerived 가 동일 입력에서 일치하는지.
//   사전: npm run build  (dist 생성),  node test/gen-derived-legacy.mjs (골든; 커밋돼 있음)
import { computeDerived } from '../dist/compute/derived.js';
import { goldenDerived } from './_derived-legacy.mjs';

const EPS = 1e-6;
const NOW = new Date('2026-06-24T00:00:00Z');

function diff(a, b, path = '', acc = []) {
  if (typeof a === 'number' && typeof b === 'number') {
    const d = Math.abs(a - b), rel = d / (Math.max(Math.abs(a), Math.abs(b)) || 1);
    if (d > EPS && rel > EPS) acc.push(`${path}: ${a} != ${b}`);
    return acc;
  }
  if (a === null || b === null || typeof a !== 'object') {
    if (a !== b) acc.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
    return acc;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], path ? `${path}.${k}` : k, acc);
  return acc;
}

const H = (code, price, accs) => ({ code, name: code, price, accounts: accs });
const tx = (accId, date, amount, anse) => ({ accId, date, amount, ...(anse ? { anse } : {}) });

const fixtures = [
  {
    name: 'A 단일계좌',
    mypm: {
      appSettings: { my: { activeAccIds: ['pension1'] } },
      holdings: [H('005930', 70000, { pension1: { qty: 100, avgPrice: 60000 } })],
      cashAccounts: { pension1: 1_500_000 },
      deposits: { transactions: [tx('pension1', '2022-01-10', 5_000_000), tx('pension1', '2023-03-15', 3_000_000)] },
    },
  },
  {
    name: 'B 다계좌+현금',
    mypm: {
      appSettings: { my: { activeAccIds: ['dc', 'pension1', 'isa'] } },
      holdings: [
        H('005930', 70000, { pension1: { qty: 50 }, isa: { qty: 30 } }),
        H('AAPL', 200000, { dc: { qty: 10 }, isa: { qty: 5 } }),
      ],
      cashAccounts: { dc: 2_000_000, pension1: 500_000, isa: 0 },
      deposits: { transactions: [
        tx('dc', '2020-05-01', 10_000_000), tx('pension1', '2021-06-01', 4_000_000),
        tx('isa', '2022-07-01', 2_000_000), tx('dc', '2024-01-01', -1_000_000),
      ] },
    },
  },
  {
    name: 'C 배우자계좌',
    mypm: {
      appSettings: { hasWife: true, my: { activeAccIds: ['pension1'] }, wife: { activeAccIds: ['wife_pension1', 'wife_isa'] } },
      holdings: [
        H('005930', 70000, { pension1: { qty: 20 }, wife_pension1: { qty: 40 } }),
        H('069500', 35000, { wife_isa: { qty: 100 } }),
      ],
      cashAccounts: { pension1: 300_000, wife_pension1: 1_000_000, wife_isa: 250_000 },
      deposits: { transactions: [
        tx('pension1', '2021-01-01', 3_000_000), tx('wife_pension1', '2021-02-01', 5_000_000, 5_000_000),
        tx('wife_isa', '2023-01-01', 4_000_000),
      ] },
    },
  },
  {
    name: 'D 추가계좌(extra)',
    mypm: {
      appSettings: { my: { activeAccIds: ['dc'], extraAccounts: [{ id: 'wdcons_my_1', name: '통합', active: true }] } },
      holdings: [H('AAPL', 200000, { dc: { qty: 8 }, wdcons_my_1: { qty: 12 } })],
      cashAccounts: { dc: 1_000_000, wdcons_my_1: 3_000_000 },
      deposits: { transactions: [tx('dc', '2019-01-01', 6_000_000), tx('wdcons_my_1', '2020-01-01', 8_000_000)] },
    },
  },
  { name: 'E 신규(빈 데이터)', mypm: {} },
];

let failed = 0;
for (const { name, mypm } of fixtures) {
  const wire = JSON.parse(JSON.stringify(mypm));
  const port = computeDerived(wire, { now: NOW });
  delete port.computedAt;
  const gold = goldenDerived(mypm, NOW);
  const diffs = diff(gold, port);
  if (diffs.length === 0) console.log(`✅ ${name}: 일치`);
  else { failed++; console.log(`❌ ${name}: ${diffs.length}개 불일치`); for (const d of diffs.slice(0, 10)) console.log('   ' + d); }
}
if (failed) { console.error(`\n파리티 실패: ${failed}/${fixtures.length}`); process.exit(1); }
console.log(`\n파리티 통과: ${fixtures.length}/${fixtures.length} ✅`);
