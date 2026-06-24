// 파생상태 저장/조회 — data_bundle 을 읽어 computeDerived 후 derived 테이블에 보관한다.
// PUT /api/sync 훅, GET /api/derived, scheduler 시세틱(Stage B)에서 공용으로 쓴다.
import { db } from './db.js';
import { computeDerived, type DerivedSnapshot, type PriceMap } from './compute/derived.js';
import { fetchPrices } from './prices.js';

export interface DerivedRow { dataVersion: number; pricedAt: string | null; updatedAt: string; data: DerivedSnapshot }

// 사용자의 번들을 읽어 파생상태를 재계산·저장하고 반환. 번들 없으면 null.
export function recomputeDerivedForUser(userId: number, opts?: { prices?: PriceMap }): DerivedRow | null {
  const row = db.prepare('SELECT version, json FROM data_bundle WHERE user_id = ?').get(userId) as
    | { version: number; json: string }
    | undefined;
  if (!row) return null;
  let bundle: any;
  try { bundle = JSON.parse(row.json); } catch { return null; }
  const snapshot = computeDerived(bundle?.mypm || {}, { prices: opts?.prices });
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

// 라이브 시세를 받아 재계산·저장 (scheduler 시세 틱용). 번들의 보유종목 코드로 시세 조회.
export async function recomputeWithLivePrices(userId: number): Promise<DerivedRow | null> {
  const row = db.prepare('SELECT json FROM data_bundle WHERE user_id = ?').get(userId) as { json: string } | undefined;
  if (!row) return null;
  let bundle: any;
  try { bundle = JSON.parse(row.json); } catch { return null; }
  const codes: string[] = (bundle?.mypm?.holdings || []).map((h: any) => h?.code).filter(Boolean);
  const prices = codes.length ? await fetchPrices(codes) : undefined;
  return recomputeDerivedForUser(userId, { prices });
}

export function getDerivedForUser(userId: number): DerivedRow | null {
  const row = db.prepare('SELECT data_version, priced_at, json, updated_at FROM derived WHERE user_id = ?').get(userId) as
    | { data_version: number; priced_at: string | null; json: string; updated_at: string }
    | undefined;
  if (!row) return null;
  return { dataVersion: row.data_version, pricedAt: row.priced_at, updatedAt: row.updated_at, data: JSON.parse(row.json) };
}
