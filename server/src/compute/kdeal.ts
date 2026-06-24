// KDeal(국내보조) 파생계산 — KDeal.html 의 kdCalcXIRR / kdTotalDeposited / 계좌평가를
// 서버 전용으로 이식한다(알고리즘 숨김). 번들의 kd 섹션(holdings·cash·accounts·deposits)에서 계산.
//
// XIRR 부호 규칙(클라와 동일): 입금(deposit) → 음수, 출금(withdraw) → 양수, 마지막에 현재가치(+).
// ⚠️ 이 계산식은 클라이언트로 다시 노출되어선 안 된다.
import { xirrCalc } from './derived.js';

export interface KdHoldingAcc { qty?: number; avgPrice?: number }
export interface KdHolding { code?: string; ticker?: string; price?: number; accounts?: Record<string, KdHoldingAcc> }
export interface KdTxn { accId: string; date: string; amount?: number; type?: string }
export interface KdAccount { id: string; name?: string; active?: boolean }
export interface KdData {
  holdings?: KdHolding[];
  cash?: Record<string, number>;
  accounts?: KdAccount[];
  deposits?: { transactions?: KdTxn[] };
}

export interface KdAccountDerived { value: number; deposited: number; xirr: number | null }
export interface KdDerived {
  accounts: Record<string, KdAccountDerived>;
  totals: { totalValue: number; totalDeposited: number; xirr: number | null };
}

// KDeal.html 계좌평가: 보유 qty × 시세 + 계좌 현금.
function accValue(accId: string, holdings: KdHolding[], cash: Record<string, number>): number {
  let total = 0;
  for (const h of holdings) {
    const a = h.accounts && h.accounts[accId];
    const qty = a ? Number(a.qty) || 0 : 0;
    if (qty > 0) total += qty * (Number(h.price) || 0);
  }
  total += Number(cash[accId]) || 0;
  return total;
}

// kdTotalDeposited: 입금(+)/출금(-) 합. (원금)
function depositedSum(txns: KdTxn[], pred: (t: KdTxn) => boolean): number {
  return txns.filter(pred).reduce(
    (s, t) => s + (t.type === 'withdraw' ? -(Number(t.amount) || 0) : (Number(t.amount) || 0)),
    0,
  );
}

// kdCalcXIRR: 입출금 캐시플로 + 마지막 현재가치 → 연환산 내부수익률.
function kdXirr(txns: KdTxn[], pred: (t: KdTxn) => boolean, currentValue: number, now: Date): number | null {
  const sel = txns.filter(pred);
  if (!sel.length || currentValue <= 0) return null;
  const sorted = sel.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const cashflows = sorted.map((t) => ({
    date: new Date(t.date),
    amount: t.type === 'withdraw' ? (Number(t.amount) || 0) : -(Number(t.amount) || 0),
  }));
  cashflows.push({ date: now, amount: currentValue });
  return xirrCalc(cashflows);
}

export function computeKdDerived(kd: KdData, opts?: { now?: Date }): KdDerived {
  const holdings = kd.holdings || [];
  const cash = kd.cash || {};
  const txns = kd.deposits?.transactions || [];
  const now = opts?.now || new Date();
  // 활성 계좌만 (KDeal.html: a.active !== false)
  const activeIds = (kd.accounts || [])
    .filter((a) => a && a.active !== false && a.id)
    .map((a) => a.id);

  const accounts: Record<string, KdAccountDerived> = {};
  let totalValue = 0;
  for (const accId of activeIds) {
    const value = accValue(accId, holdings, cash);
    const deposited = depositedSum(txns, (t) => t.accId === accId);
    accounts[accId] = { value, deposited, xirr: kdXirr(txns, (t) => t.accId === accId, value, now) };
    totalValue += value;
  }
  const activeSet = new Set(activeIds);
  const totalDeposited = depositedSum(txns, (t) => activeSet.has(t.accId));
  const xirr = kdXirr(txns, (t) => activeSet.has(t.accId), totalValue, now);

  return { accounts, totals: { totalValue, totalDeposited, xirr } };
}
