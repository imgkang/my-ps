// 서버측 시세 수집 — MyPM(국내주식, 6자리 코드) 기준. index.html fetchNaverPrice 와 동일 파싱.
// 시세 틱마다 derived 선계산에 사용. 실패한 코드는 생략(클라/번들의 마지막 h.price 유지).
import type { PriceMap } from './compute/derived.js';

const NAVER_BASIC = (code: string) => `https://m.stock.naver.com/api/stock/${code}/basic`;

// Naver basic 응답에서 종가/등락 파싱 (fetchNaverPrice 와 동일 규칙). 테스트를 위해 분리.
export function parseNaverBasic(json: any): { price: number; change: number } | null {
  const price = parseFloat(String(json?.closePrice ?? '').replace(/,/g, ''));
  if (!price) return null;
  const change = parseFloat(String(json?.compareToPreviousClosePrice ?? '0').replace(/,/g, ''));
  return { price, change: isFinite(change) ? change : 0 };
}

async function fetchNaver(code: string): Promise<{ price: number; change: number } | null> {
  try {
    const res = await fetch(NAVER_BASIC(code), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'application/json, */*',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        Referer: 'https://finance.naver.com/',
      },
    });
    if (!res.ok) return null;
    return parseNaverBasic(JSON.parse(await res.text()));
  } catch {
    return null;
  }
}

// 동시성 제한 풀 (price.ts 와 동일 패턴).
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const run = async () => { while (next < items.length) await worker(items[next++]); };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

// 6자리 국내 코드만 조회. 비국내/실패는 생략.
export async function fetchPrices(codes: string[]): Promise<PriceMap> {
  const uniq = [...new Set(codes.filter((c) => /^\d{6}$/.test(c)))];
  const out: PriceMap = {};
  await runPool(uniq, 6, async (code) => {
    const r = await fetchNaver(code);
    if (r) out[code] = { price: r.price, change: r.change };
  });
  return out;
}
