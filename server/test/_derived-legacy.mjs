// AUTO-GENERATED from `git show HEAD:index.html` — do not edit.
// 클라 계산 함수 verbatim 골든 (파생상태 파리티 검증용).
let holdings, cashAccounts, depositData, appSettings, __now;
const ACCOUNTS = [
  { id: 'dc', name: 'DC' }, { id: 'pension1', name: 'P1' }, { id: 'pension2', name: 'P2' },
  { id: 'irp', name: 'IRP' }, { id: 'isa', name: 'ISA' },
  { id: 'wife_dc', name: 'WDC' }, { id: 'wife_pension1', name: 'WP1' }, { id: 'wife_pension2', name: 'WP2' },
  { id: 'wife_irp', name: 'WIRP' }, { id: 'wife_isa', name: 'WISA' },
];
const MY_ACC_IDS = ['dc','pension1','pension2','irp','isa'];
const WIFE_ACC_IDS = ['wife_dc','wife_pension1','wife_pension2','wife_irp','wife_isa'];

function xirrCalc(cashflows) {
  // cashflows: [{date: Date, amount: number}]
  // 투자자 기준: 입금 → 음수, 현재가치(회수) → 양수
  if (!cashflows || cashflows.length < 2) return null;
  const t0 = cashflows[0].date.getTime();
  const days = cashflows.map(cf => (cf.date.getTime() - t0) / 86400000);
  const amounts = cashflows.map(cf => cf.amount);

  // 모든 금액이 같은 부호면 계산 불가
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
  for (let i = 0; i < amounts.length; i++) {
    finalNpv += amounts[i] / Math.pow(1 + rate, days[i] / 365);
  }
  if (Math.abs(finalNpv) > 1e-3) return null;
  if (Math.abs(rate) > 99.99) return null;
  return rate;
}
function computeAccountValue(accId) {
  let total = 0;
  for (const h of holdings) {
    const a = h.accounts && h.accounts[accId];
    if (a && a.qty > 0) total += a.qty * (h.price || 0);
  }
  total += Number(cashAccounts[accId]) || 0;
  return total;
}
function getAccountNetTotal(accId) {
  return depositData.transactions
    .filter(t => t.accId === accId)
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);
}
function getActiveAccounts() {
  const myActive = appSettings.my?.activeAccIds || MY_ACC_IDS;
  const myAccs   = ACCOUNTS.filter(a => MY_ACC_IDS.includes(a.id) && myActive.includes(a.id));
  const myExtras = (appSettings.my?.extraAccounts || [])
    .filter(e => e.active !== false)
    .map(e => ({ id: e.id, name: e.name }));
  let wifeAccs = [], wifeExtras = [];
  if (appSettings.hasWife) {
    const wifeActive = appSettings.wife?.activeAccIds || WIFE_ACC_IDS;
    wifeAccs   = ACCOUNTS.filter(a => WIFE_ACC_IDS.includes(a.id) && wifeActive.includes(a.id));
    wifeExtras = (appSettings.wife?.extraAccounts || [])
      .filter(e => e.active !== false)
      .map(e => ({ id: e.id, name: e.name }));
  }
  return [...myAccs, ...myExtras, ...wifeAccs, ...wifeExtras];
}
function calcXIRR(totalCurrentValue, accId = null) {
  const activeIds = new Set(getActiveAccounts().map(a => a.id));
  const txns = accId
    ? depositData.transactions.filter(t => t.accId === accId)
    : depositData.transactions.filter(t => activeIds.has(t.accId));
  if (!txns.length || totalCurrentValue <= 0) return null;
  const sorted = txns.slice().sort((a, b) => a.date.localeCompare(b.date));
  const cashflows = sorted.map(t => ({
    date: new Date(t.date),
    amount: -(Number(t.amount) || 0)  // 입금(+) → 투자자 관점 지출(-), 출금(-) → 회수(+)
  }));
  cashflows.push({ date: __now, amount: totalCurrentValue });
  return xirrCalc(cashflows);
}

export function goldenDerived(mypm, now) {
  holdings = mypm.holdings || [];
  cashAccounts = mypm.cashAccounts || {};
  depositData = mypm.deposits || { transactions: [] };
  appSettings = mypm.appSettings || {};
  __now = now;
  const ids = getActiveAccounts().map((a) => a.id);
  const accounts = {};
  let totalValue = 0, totalCash = 0, totalPrincipal = 0;
  for (const id of ids) {
    const value = computeAccountValue(id);
    const principal = getAccountNetTotal(id);
    accounts[id] = { value, principal, xirr: calcXIRR(value, id) };
    totalValue += value; totalCash += Number(cashAccounts[id]) || 0; totalPrincipal += principal;
  }
  const xirr = calcXIRR(totalValue, null);
  return { accounts, totals: { totalValue, totalCash, totalPrincipal, xirr } };
}
