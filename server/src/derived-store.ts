// 파생상태 저장/조회 — data_bundle 을 읽어 computeDerived 후 derived 테이블에 보관한다.
// PUT /api/sync 훅, GET /api/derived, scheduler 시세틱(Stage B)에서 공용으로 쓴다.
//
// 시세는 세 앱(MyPM 국내 / KDeal 국내 / NonK 미국) 보유종목 전부에 대해 최신 캐시값을
// 적용한다. 캐시는 scheduler 가 시장별로 갱신하며, 조회가 막 끝난 fresh 값(opts.prices)이
// 캐시보다 우선한다. 시세가 없는 종목은 번들에 저장된 마지막 h.price 를 그대로 쓴다.
import { db } from './db.js';
import { computeDerived, type DerivedSnapshot, type PriceMap } from './compute/derived.js';
import { computeKdDerived } from './compute/kdeal.js';
import { computeNkDerived } from './compute/nonk.js';
import { fetchPrices, fetchUsPrices } from './prices.js';
import { getCachedPrices, updatePriceCache } from './price-cache.js';

export interface DerivedRow { dataVersion: number; pricedAt: string | null; updatedAt: string; data: DerivedSnapshot }

// 번들에서 국내(6자리) 코드와 미국 티커를 모은다.
// 주의: MyPM 은 코드를 h.code 에, KDeal 은 h.ticker(없으면 h.code)에 저장한다.
function collectKeys(bundle: any): { krCodes: string[]; usSymbols: string[] } {
  const krCodes: string[] = [];
  for (const h of (bundle?.mypm?.holdings || [])) if (h?.code) krCodes.push(String(h.code));
  for (const h of (bundle?.kd?.holdings || [])) {
    const k = h?.ticker ?? h?.code;
    if (k) krCodes.push(String(k));
  }
  const usSymbols: string[] = [];
  for (const h of (bundle?.nonk?.holdings || [])) if (h?.ticker) usSymbols.push(String(h.ticker));
  return { krCodes: [...new Set(krCodes)], usSymbols: [...new Set(usSymbols)] };
}

// holdings[].price/change 를 시세맵으로 덮어쓴다(있을 때만). keyFields 후보 중 먼저 맞는 키 사용.
function applyPrices(holdings: any[] | undefined, prices: PriceMap, keyFields: string[]): void {
  for (const h of holdings || []) {
    for (const kf of keyFields) {
      const k = h?.[kf];
      const p = k != null ? prices[String(k)] : undefined;
      if (p && typeof p.price === 'number') {
        h.price = p.price;
        if (typeof p.change === 'number') h.change = p.change;
        break;
      }
    }
  }
}

// 사용자의 번들을 읽어 파생상태를 재계산·저장하고 반환. 번들 없으면 null.
// opts.prices 가 주어지면(시세 틱) 그 값이 캐시보다 우선. 없으면 캐시값만 사용.
export function recomputeDerivedForUser(userId: number, opts?: { prices?: PriceMap }): DerivedRow | null {
  const row = db.prepare('SELECT version, json FROM data_bundle WHERE user_id = ?').get(userId) as
    | { version: number; json: string }
    | undefined;
  if (!row) return null;
  let bundle: any;
  try { bundle = JSON.parse(row.json); } catch { return null; }

  // 보유종목 키 → 캐시 최신가 + (있으면) fresh 조회값을 병합.
  const { krCodes, usSymbols } = collectKeys(bundle);
  const prices: PriceMap = { ...getCachedPrices([...krCodes, ...usSymbols]), ...(opts?.prices || {}) };

  // KDeal/NonK 는 compute 함수가 h.price 를 읽으므로 번들에 직접 반영. MyPM 은 prices 인자로 처리.
  applyPrices(bundle?.kd?.holdings, prices, ['ticker', 'code']);
  applyPrices(bundle?.nonk?.holdings, prices, ['ticker']);

  const snapshot = computeDerived(bundle?.mypm || {}, { prices });
  snapshot.kd = computeKdDerived(bundle?.kd || {});
  snapshot.nk = computeNkDerived(bundle?.nonk || {});
  snapshot.prices = prices; // 보유종목 최신 시세 맵 동봉(프론트 행별 즉시 표시용)

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO derived (user_id, data_version, priced_at, json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       data_version = excluded.data_version,
       priced_at = excluded.priced_at,
       json = excluded.json,
       updated_at = excluded.updated_at`
  ).run(userId, row.version, snapshot.computedAt, JSON.stringify(snapshot), now);
  return { dataVersion: row.version, pricedAt: snapshot.computedAt, updatedAt: now, data: snapshot };
}

// 라이브 시세를 받아 재계산·저장 (scheduler 시세 틱용). markets 로 조회할 시장을 제한한다
// (KR 장중엔 'kr', 미국장중엔 'us'). 받은 시세는 캐시에 병합되어 다른 시장 틱에도 유지된다.
export async function recomputeWithLivePrices(
  userId: number,
  markets: Array<'kr' | 'us'> = ['kr', 'us'],
): Promise<DerivedRow | null> {
  const row = db.prepare('SELECT json FROM data_bundle WHERE user_id = ?').get(userId) as { json: string } | undefined;
  if (!row) return null;
  let bundle: any;
  try { bundle = JSON.parse(row.json); } catch { return null; }

  const { krCodes, usSymbols } = collectKeys(bundle);
  const fresh: PriceMap = {};
  if (markets.includes('kr') && krCodes.length) Object.assign(fresh, await fetchPrices(krCodes));
  if (markets.includes('us') && usSymbols.length) Object.assign(fresh, await fetchUsPrices(usSymbols));
  updatePriceCache(fresh);

  return recomputeDerivedForUser(userId, { prices: fresh });
}

// ── 자동 계좌기록 스냅샷 (주 1회 마감 후 cron) ────────────────────────────
export interface AccountSnapshot { day: string; accounts: Record<string, number>; total: number; pricedAt: string | null }

// 라이브 시세로 재계산한 derived 에서 앱별 계좌 평가금액을 뽑아 account_snapshots 에 upsert.
//   dayStr  : KST 'YYYY-MM-DD' (cron 콜백이 전달)
//   markets : 라이브로 조회할 시장 (KR 마감 cron='kr', US 마감 cron='us')
//   apps    : 기록할 앱 (KR cron=['mypm','kd'], US cron=['nk'])
export async function recordWeeklySnapshot(
  userId: number,
  dayStr: string,
  opts?: { markets?: Array<'kr' | 'us'>; apps?: Array<'mypm' | 'kd' | 'nk'> },
): Promise<void> {
  const markets = opts?.markets ?? ['kr', 'us'];
  const apps = opts?.apps ?? ['mypm', 'kd', 'nk'];
  const row = await recomputeWithLivePrices(userId, markets);
  if (!row) return;
  const d: any = row.data;
  const now = new Date().toISOString();

  // 앱별 (계좌맵, 합계) 추출. mypm=top-level accounts, kd=d.kd, nk=d.nk.
  const sources: Record<string, { accounts: any; total: number }> = {
    mypm: { accounts: d.accounts || {}, total: d.totals?.totalValue || 0 },
    kd:   { accounts: d.kd?.accounts || {}, total: d.kd?.totals?.totalValue || 0 },
    nk:   { accounts: d.nk?.accounts || {}, total: d.nk?.totals?.totalValue || 0 },
  };

  const stmt = db.prepare(
    `INSERT INTO account_snapshots (user_id, app, day, accounts, total, priced_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, app, day) DO UPDATE SET
       accounts = excluded.accounts,
       total = excluded.total,
       priced_at = excluded.priced_at,
       updated_at = excluded.updated_at`,
  );
  for (const app of apps) {
    const src = sources[app];
    if (!src) continue;
    const valueMap: Record<string, number> = {};
    for (const [accId, ad] of Object.entries(src.accounts)) {
      valueMap[accId] = Number((ad as any)?.value) || 0;
    }
    // 보유/계좌가 전혀 없는 앱은 빈 행을 만들지 않음.
    if (!Object.keys(valueMap).length && !src.total) continue;
    stmt.run(userId, app, dayStr, JSON.stringify(valueMap), src.total, row.pricedAt, now);
  }
}

// 앱별 스냅샷 시계열 (day 오름차순).
export function getAccountSnapshots(userId: number, app: string): AccountSnapshot[] {
  const rows = db.prepare(
    'SELECT day, accounts, total, priced_at FROM account_snapshots WHERE user_id = ? AND app = ? ORDER BY day ASC',
  ).all(userId, app) as { day: string; accounts: string; total: number; priced_at: string | null }[];
  return rows.map((r) => {
    let accounts: Record<string, number> = {};
    try { accounts = JSON.parse(r.accounts) || {}; } catch { /* 손상행 무시 */ }
    return { day: r.day, accounts, total: r.total, pricedAt: r.priced_at };
  });
}

export function getDerivedForUser(userId: number): DerivedRow | null {
  const row = db.prepare('SELECT data_version, priced_at, json, updated_at FROM derived WHERE user_id = ?').get(userId) as
    | { data_version: number; priced_at: string | null; json: string; updated_at: string }
    | undefined;
  if (!row) return null;
  return { dataVersion: row.data_version, pricedAt: row.priced_at, updatedAt: row.updated_at, data: JSON.parse(row.json) };
}
