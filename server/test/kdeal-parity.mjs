// KDeal 파생 파리티 — KDeal.html 클라 계산(골든) vs 서버 computeKdDerived 일치 검증.
//   사전: npm run build (dist 생성)
import { computeKdDerived } from '../dist/compute/kdeal.js';

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

// ── 골든: KDeal.html 의 kdXirrCalc / kdCalcXIRR / kdTotalDeposited / 계좌평가 그대로 ──
function kdXirrCalc(cashflows) {
  if (!cashflows || cashflows.length < 2) return null;
  const t0 = cashflows[0].date.getTime();
  const days = cashflows.map(cf => (cf.date.getTime() - t0) / 86400000);
  const amounts = cashflows.map(cf => cf.amount);
  const hasPos = amounts.some(a => a > 0);
  const hasNeg = amounts.some(a => a < 0);
  if (!hasPos || !hasNeg) return null;
  let rate = 0.1;
  for (let iter = 0; iter < 200; iter++) {
    let npv = 0, dnpv = 0;
    for (let i = 0; i < amounts.length; i++) {
      const t = days[i] / 365;
      const factor = Math.pow(1 + rate, t);
      npv  += amounts[i] / factor;
      dnpv -= amounts[i] * t / (factor * (1 + rate));
    }
    if (Math.abs(npv) < 1e-6) break;
    if (Math.abs(dnpv) < 1e-15) break;
    const delta = npv / dnpv;
    rate -= delta;
    if (rate <= -1) rate = -0.9999;
    if (Math.abs(delta) < 1e-9) break;
  }
  if (!isFinite(rate) || rate <= -1) return null;
  let finalNpv = 0;
  for (let i = 0; i < amounts.length; i++) finalNpv += amounts[i] / Math.pow(1 + rate, days[i] / 365);
  if (Math.abs(finalNpv) > 1e-3) return null;
  if (Math.abs(rate) > 99.99) return null;
  return rate;
}
function kdTotalDeposited(txns, accId = null, accIds = null) {
  let t = txns;
  if (accId) t = t.filter(x => x.accId === accId);
  else if (accIds) t = t.filter(x => accIds.includes(x.accId));
  return t.reduce((s, x) => s + (x.type === 'withdraw' ? -Number(x.amount) : Number(x.amount)), 0);
}
function kdCalcXIRR(txnsAll, totalCurrentValue, accId = null, accIds = null) {
  let txns = txnsAll;
  if (accId) txns = txns.filter(t => t.accId === accId);
  else if (accIds) txns = txns.filter(t => accIds.includes(t.accId));
  if (!txns.length || totalCurrentValue <= 0) return null;
  const sorted = txns.slice().sort((a, b) => a.date.localeCompare(b.date));
  const cashflows = sorted.map(t => ({ date: new Date(t.date), amount: t.type === 'withdraw' ? Number(t.amount) : -Number(t.amount) }));
  cashflows.push({ date: NOW, amount: totalCurrentValue });
  return kdXirrCalc(cashflows);
}
function accVal(accId, holdings, cash) {
  let total = 0;
  for (const h of holdings) {
    const a = h.accounts && h.accounts[accId];
    const qty = a ? Number(a.qty) || 0 : 0;
    if (qty > 0) total += qty * (Number(h.price) || 0);
  }
  return total + (Number(cash[accId]) || 0);
}
function goldenKd(kd) {
  const holdings = kd.holdings || [], cash = kd.cash || {}, txns = (kd.deposits && kd.deposits.transactions) || [];
  const activeIds = (kd.accounts || []).filter(a => a && a.active !== false && a.id).map(a => a.id);
  const accounts = {};
  let totalValue = 0;
  for (const id of activeIds) {
    const value = accVal(id, holdings, cash);
    accounts[id] = { value, deposited: kdTotalDeposited(txns, id), xirr: kdCalcXIRR(txns, value, id) };
    totalValue += value;
  }
  return {
    accounts,
    totals: { totalValue, totalDeposited: kdTotalDeposited(txns, null, activeIds), xirr: kdCalcXIRR(txns, totalValue, null, activeIds) },
  };
}

const H = (code, price, accs) => ({ code, name: code, price, accounts: accs });
const tx = (accId, date, amount, type) => ({ accId, date, amount, type: type || 'deposit' });
const ACC = (id, active = true) => ({ id, name: id, active });

const fixtures = [
  {
    name: 'A 단일계좌',
    kd: {
      accounts: [ACC('acc1')],
      holdings: [H('005930', 71000, { acc1: { qty: 120, avgPrice: 60000 } })],
      cash: { acc1: 2_300_000 },
      deposits: { transactions: [tx('acc1', '2022-02-10', 5_000_000), tx('acc1', '2023-05-01', 3_000_000)] },
    },
  },
  {
    name: 'B 다계좌 + 출금',
    kd: {
      accounts: [ACC('ds'), ACC('nk1'), ACC('off', false)],
      holdings: [
        H('035720', 50000, { ds: { qty: 40 }, nk1: { qty: 20 } }),
        H('000660', 180000, { ds: { qty: 10 }, off: { qty: 99 } }),
      ],
      cash: { ds: 1_000_000, nk1: 250_000, off: 9_999 },
      deposits: { transactions: [
        tx('ds', '2021-01-05', 8_000_000), tx('nk1', '2022-03-01', 3_000_000),
        tx('ds', '2024-06-01', 1_000_000, 'withdraw'), tx('off', '2020-01-01', 5_000_000),
      ] },
    },
  },
  {
    name: 'C 입출금 없음(XIRR null)',
    kd: { accounts: [ACC('acc1')], holdings: [H('005930', 70000, { acc1: { qty: 10 } })], cash: {}, deposits: { transactions: [] } },
  },
  { name: 'D 빈 데이터', kd: {} },
];

let failed = 0;
for (const { name, kd } of fixtures) {
  const wire = JSON.parse(JSON.stringify(kd));
  const port = computeKdDerived(wire, { now: NOW });
  const gold = goldenKd(kd);
  const diffs = diff(gold, port);
  if (diffs.length === 0) console.log(`✅ ${name}: 일치`);
  else { failed++; console.log(`❌ ${name}: ${diffs.length}개 불일치`); for (const d of diffs.slice(0, 10)) console.log('   ' + d); }
}
if (failed) { console.error(`\nKDeal 파리티 실패: ${failed}/${fixtures.length}`); process.exit(1); }
console.log(`\nKDeal 파리티 통과: ${fixtures.length}/${fixtures.length} ✅`);
