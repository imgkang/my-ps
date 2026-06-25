// 서버측 시세 수집 — MyPM/KDeal(국내, 6자리 코드)은 Naver, NonK(미국 티커)는 Finnhub.
// 시세 틱마다 derived 선계산에 사용. 실패한 코드는 생략(클라/번들의 마지막 h.price 유지).
import type { PriceMap } from './compute/derived.js';
import { env } from './env.js';

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

// ── 미국 시세 (Finnhub) — NonK 보유 티커용. routes/price.ts 의 quote 파싱과 동일.
// Finnhub quote 응답: { c: 현재가, d: 전일대비, dp: 등락률, ... }. c<=0 이면 무데이터로 간주.
const FINNHUB_QUOTE = 'https://finnhub.io/api/v1/quote';

async function fetchFinnhub(symbol: string): Promise<{ price: number; change: number } | null> {
  if (!env.FINNHUB_KEY) return null;
  try {
    const url = new URL(FINNHUB_QUOTE);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('token', env.FINNHUB_KEY);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const j = JSON.parse(await res.text());
    if (j && typeof j.c === 'number' && j.c > 0) {
      return { price: j.c, change: Number(j.d) || 0 };
    }
    return null;
  } catch {
    return null;
  }
}

// 미국 티커(영문/숫자/점/하이픈)만 조회. 실패·무데이터는 생략.
export async function fetchUsPrices(symbols: string[]): Promise<PriceMap> {
  const uniq = [...new Set(symbols.filter((s) => /^[A-Za-z0-9.\-]{1,10}$/.test(s)))];
  const out: PriceMap = {};
  await runPool(uniq, 8, async (sym) => {
    const r = await fetchFinnhub(sym);
    if (r) out[sym] = { price: r.price, change: r.change };
  });
  return out;
}
