// 서버측 최신 시세 캐시 — 장중 틱(scheduler)이 시장별로 갱신하고, 파생 선계산이 읽는다.
// 인메모리(서버 재시작 시 비워짐 → 다음 틱에 재적재). 목적: 한 시장이 닫혀 있어도
// 마지막으로 받은 시세를 유지해, 다른 시장 틱에서 재계산할 때 stale 한 번들 h.price 로
// 되돌아가지 않게 한다(예: KR 종가가 미국장 시간대 스냅샷에도 그대로 반영).
import type { PriceMap } from './compute/derived.js';

export interface CachedPrice { price: number; change: number; at: number }

const cache = new Map<string, CachedPrice>();

// 조회 결과 맵을 캐시에 병합(유효한 양수 가격만).
export function updatePriceCache(prices: PriceMap): void {
  const now = Date.now();
  for (const [k, v] of Object.entries(prices)) {
    if (v && typeof v.price === 'number' && v.price > 0) {
      cache.set(k, { price: v.price, change: Number(v.change) || 0, at: now });
    }
  }
}

// 주어진 키(국내 6자리 코드 / 미국 티커)들의 최신 캐시 가격을 PriceMap 으로 반환.
export function getCachedPrices(keys: string[]): PriceMap {
  const out: PriceMap = {};
  for (const k of keys) {
    const v = cache.get(k);
    if (v) out[k] = { price: v.price, change: v.change };
  }
  return out;
}
