// NonK(해외/USD 포트폴리오) 파생계산 — NonK.html 의 nkCalcXIRR / nkTotalDeposited / 계좌평가를
// 서버 전용으로 이식한다(알고리즘 숨김). 번들의 nonk 섹션(holdings·cash·accounts·deposits)에서 계산.
// 시세는 번들에 저장된 h.price(클라가 Finnhub 로 받아둔 값)를 사용 — 서버가 직접 조회하지 않는다.
//
// XIRR 부호 규칙(클라와 동일): 입금(deposit) → 음수, 출금(withdraw) → 양수, 마지막에 현재가치(+).
// ⚠️ 이 계산식은 클라이언트로 다시 노출되어선 안 된다.
import { xirrCalc } from './derived.js';

export interface NkHoldingAcc { qty?: number; avgPrice?: number }
export interface NkHolding { ticker?: string; price?: number; accounts?: Record<string, NkHoldingAcc> }
export interface NkTxn { accId: string; date: string; amount?: number; type?: string }
export interface NkAccount { id: string; name?: string; active?: boolean }
export interface NkData {
  holdings?: NkHolding[];
  cash?: Record<string, number>;
  accounts?: NkAccount[];
  deposits?: { transactions?: NkTxn[] };
}

export interface NkAccountDerived { value: number; deposited: number; xirr: number | null }
export interface NkDerived {
  accounts: Record<string, NkAccountDerived>;
  totals: { totalValue: number; totalDeposited: number; xirr: number | null };
}

// nkComputeAccountValue: 보유 qty × 시세 + 계좌 현금.
function accValue(accId: string, holdings: NkHolding[], cash: Record<string, number>): number {
  let total = 0;
  for (const h of holdings) {
    const a = h.accounts && h.accounts[accId];
    const qty = a ? Number(a.qty) || 0 : 0;
    if (qty > 0) total += qty * (Number(h.price) || 0);
  }
  total += Number(cash[accId]) || 0;
  return total;
}

// nkTotalDeposited: 입금(+)/출금(-) 합. (원금)
function depositedSum(txns: NkTxn[], pred: (t: NkTxn) => boolean): number {
  return txns.filter(pred).reduce(
    (s, t) => s + (t.type === 'withdraw' ? -(Number(t.amount) || 0) : (Number(t.amount) || 0)),
    0,
  );
}

// nkCalcXIRR: 입출금 캐시플로 + 마지막 현재가치 → 연환산 내부수익률.
function nkXirr(txns: NkTxn[], pred: (t: NkTxn) => boolean, currentValue: number, now: Date): number | null {
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

export function computeNkDerived(nk: NkData, opts?: { now?: Date }): NkDerived {
  const holdings = nk.holdings || [];
  const cash = nk.cash || {};
  const txns = nk.deposits?.transactions || [];
  const now = opts?.now || new Date();
  // 활성 계좌만 (NonK.html: a.active !== false)
  let activeIds = (nk.accounts || [])
    .filter((a) => a && a.active !== false && a.id)
    .map((a) => a.id);
  // 폴백: NonK.html 의 기본계좌(ds/nk1 등)는 localStorage 에 저장되지 않아 번들 accounts 가 비어
  // 올 수 있다. 그럴 땐 데이터에 실제 존재하는 계좌 id(현금 키 ∪ 보유 계좌 키)로 계산한다.
  if (activeIds.length === 0) {
    const ids = new Set<string>();
    for (const k of Object.keys(cash)) ids.add(k);
    for (const h of holdings) {
      if (h.accounts) for (const k of Object.keys(h.accounts)) ids.add(k);
    }
    activeIds = [...ids];
  }

  const accounts: Record<string, NkAccountDerived> = {};
  let totalValue = 0;
  for (const accId of activeIds) {
    const value = accValue(accId, holdings, cash);
    const deposited = depositedSum(txns, (t) => t.accId === accId);
    accounts[accId] = { value, deposited, xirr: nkXirr(txns, (t) => t.accId === accId, value, now) };
    totalValue += value;
  }
  const activeSet = new Set(activeIds);
  const totalDeposited = depositedSum(txns, (t) => activeSet.has(t.accId));
  const xirr = nkXirr(txns, (t) => activeSet.has(t.accId), totalValue, now);

  return { accounts, totals: { totalValue, totalDeposited, xirr } };
}
