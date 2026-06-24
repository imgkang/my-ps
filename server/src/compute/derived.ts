// 파생상태(derived state) 계산 — 서버 전용(독점 로직). 클라의 계산 함수들을 TS로 이식.
//
// 입력: 동기화된 번들의 MyPM 슬라이스(bundle.mypm). holdings 에 마지막 시세(h.price)가
//       포함되어 있어, 라이브 시세 없이도 클라와 동일 결과를 낸다(Stage A). 라이브 시세
//       재계산(Stage B)은 prices 맵으로 h.price 를 덮어써 동일 함수를 재사용한다.
//
// ⚠️ 이 계산식은 클라이언트로 노출되어선 안 된다(알고리즘 숨김 목적).

// index.html 의 계좌 상수와 동일해야 한다.
const MY_ACC_IDS = ['dc', 'pension1', 'pension2', 'irp', 'isa'];
const WIFE_ACC_IDS = ['wife_dc', 'wife_pension1', 'wife_pension2', 'wife_irp', 'wife_isa'];

export interface Holding {
  code: string;
  name?: string;
  price?: number;
  change?: number;
  accounts?: Record<string, { qty?: number; avgPrice?: number }>;
}
export interface Txn { accId: string; date: string; amount?: number; anse?: number }
export interface MyPMData {
  holdings?: Holding[];
  cashAccounts?: Record<string, number>;
  deposits?: { transactions?: Txn[] };
  appSettings?: any;
}
export interface PriceMap { [code: string]: { price?: number; change?: number } }

export interface AccountDerived { value: number; principal: number; xirr: number | null }
export interface DerivedSnapshot {
  accounts: Record<string, AccountDerived>;
  totals: { totalValue: number; totalCash: number; totalPrincipal: number; xirr: number | null };
  computedAt: string;
}

// ── 활성 계좌 id (index.html getActiveAccounts 와 동일 규칙) ──
export function activeAccountIds(appSettings: any): string[] {
  const s = appSettings || {};
  const myActive: string[] = s.my?.activeAccIds || MY_ACC_IDS;
  const ids = MY_ACC_IDS.filter((id) => myActive.includes(id));
  for (const e of (s.my?.extraAccounts || [])) if (e?.active !== false && e?.id) ids.push(e.id);
  if (s.hasWife) {
    const wifeActive: string[] = s.wife?.activeAccIds || WIFE_ACC_IDS;
    for (const id of WIFE_ACC_IDS) if (wifeActive.includes(id)) ids.push(id);
    for (const e of (s.wife?.extraAccounts || [])) if (e?.active !== false && e?.id) ids.push(e.id);
  }
  return ids;
}

// ── XIRR (index.html xirrCalc 정확 이식) ──
export function xirrCalc(cashflows: { date: Date; amount: number }[]): number | null {
  if (!cashflows || cashflows.length < 2) return null;
  const t0 = cashflows[0].date.getTime();
  const days = cashflows.map((cf) => (cf.date.getTime() - t0) / 86400000);
  const amounts = cashflows.map((cf) => cf.amount);
  const hasPos = amounts.some((a) => a > 0);
  const hasNeg = amounts.some((a) => a < 0);
  if (!hasPos || !hasNeg) return null;

  let rate = 0.1;
  for (let iter = 0; iter < 200; iter++) {
    let npv = 0, dnpv = 0;
    for (let i = 0; i < amounts.length; i++) {
      const t = days[i] / 365;
      const factor = Math.pow(1 + rate, t);
      npv += amounts[i] / factor;
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

// index.html calcXIRR 이식. accId=null 이면 활성계좌 전체.
function calcXIRR(
  txns: Txn[], activeIds: Set<string>, totalCurrentValue: number, accId: string | null, now: Date,
): number | null {
  const sel = accId
    ? txns.filter((t) => t.accId === accId)
    : txns.filter((t) => activeIds.has(t.accId));
  if (!sel.length || totalCurrentValue <= 0) return null;
  const sorted = sel.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const cashflows = sorted.map((t) => ({ date: new Date(t.date), amount: -(Number(t.amount) || 0) }));
  cashflows.push({ date: now, amount: totalCurrentValue });
  return xirrCalc(cashflows);
}

// index.html computeAccountValue 이식 (h.price = 시세). prices 가 있으면 우선 사용.
function accountValue(accId: string, holdings: Holding[], cashAccounts: Record<string, number>, prices?: PriceMap): number {
  let total = 0;
  for (const h of holdings) {
    const a = h.accounts && h.accounts[accId];
    const qty = a ? Number(a.qty) || 0 : 0;
    if (qty > 0) {
      const px = prices?.[h.code]?.price;
      total += qty * (px != null ? px : (h.price || 0));
    }
  }
  total += Number(cashAccounts[accId]) || 0;
  return total;
}

// index.html getAccountNetTotal 이식.
function accountNetTotal(accId: string, txns: Txn[]): number {
  return txns.filter((t) => t.accId === accId).reduce((s, t) => s + (Number(t.amount) || 0), 0);
}

export function computeDerived(mypm: MyPMData, opts?: { prices?: PriceMap; now?: Date }): DerivedSnapshot {
  const holdings = mypm.holdings || [];
  const cashAccounts = mypm.cashAccounts || {};
  const txns = mypm.deposits?.transactions || [];
  const now = opts?.now || new Date();
  const prices = opts?.prices;

  const ids = activeAccountIds(mypm.appSettings);
  const activeSet = new Set(ids);

  const accounts: Record<string, AccountDerived> = {};
  let totalValue = 0, totalCash = 0, totalPrincipal = 0;
  for (const accId of ids) {
    const value = accountValue(accId, holdings, cashAccounts, prices);
    const principal = accountNetTotal(accId, txns);
    accounts[accId] = { value, principal, xirr: calcXIRR(txns, activeSet, value, accId, now) };
    totalValue += value;
    totalCash += Number(cashAccounts[accId]) || 0;
    totalPrincipal += principal;
  }
  const xirr = calcXIRR(txns, activeSet, totalValue, null, now);

  return {
    accounts,
    totals: { totalValue, totalCash, totalPrincipal, xirr },
    computedAt: now.toISOString(),
  };
}
