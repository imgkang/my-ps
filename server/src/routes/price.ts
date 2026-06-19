// 주가 프록시 — worker/proxy.js 로직을 그대로 포팅.
// 1) GET /api/price?url=<인코딩된 대상 URL>  : Naver/Yahoo CORS 패스스루 (기존 Worker 와 동일)
// 2) GET /api/price/finnhub?symbol=AAPL      : Finnhub 키를 서버에서 주입 (앱 번들에서 키 제거)
import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';

const ALLOWED_HOSTS = [
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'm.stock.naver.com',
  'polling.finance.naver.com',
  'ac.stock.naver.com',
  'finance.naver.com',
  'stooq.com',
];

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; status: number; body: string }>();

async function passthrough(targetUrl: URL): Promise<{ status: number; body: string }> {
  const key = targetUrl.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { status: hit.status, body: hit.body };
  }
  const isNaver = targetUrl.hostname.endsWith('naver.com');
  const res = await fetch(targetUrl.toString(), {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Accept: 'application/json, */*',
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      ...(isNaver ? { Referer: 'https://finance.naver.com/' } : {}),
    },
  });
  const body = await res.text();
  cache.set(key, { at: Date.now(), status: res.status, body });
  return { status: res.status, body };
}

// Finnhub 단일 시세 조회 (30초 캐시). 단건·배치 라우트가 공유.
async function fetchFinnhubQuote(symbol: string): Promise<{ status: number; body: string }> {
  const key = 'finnhub:' + symbol;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { status: hit.status, body: hit.body };
  }
  const url = new URL('https://finnhub.io/api/v1/quote');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('token', env.FINNHUB_KEY as string);
  const res = await fetch(url.toString());
  const body = await res.text();
  cache.set(key, { at: Date.now(), status: res.status, body });
  return { status: res.status, body };
}

// 동시성 제한 풀 — 한 번에 limit 개씩 worker 실행 (Finnhub 무료 burst 보호).
async function runPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}


export default async function priceRoutes(app: FastifyInstance) {
  // 범용 패스스루 (Naver / Yahoo / Stooq)
  app.get('/api/price', async (req, reply) => {
    const target = (req.query as any)?.url as string | undefined;
    if (!target) return reply.code(400).send({ error: 'Missing ?url= parameter' });

    let targetUrl: URL;
    try {
      targetUrl = new URL(target);
    } catch {
      return reply.code(400).send({ error: 'Invalid URL' });
    }
    if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
      return reply.code(403).send({ error: `Host not allowed: ${targetUrl.hostname}` });
    }

    try {
      const { status, body } = await passthrough(targetUrl);
      reply
        .code(status)
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Cache-Control', 'public, max-age=30');
      return body;
    } catch (err: any) {
      return reply.code(502).send({ error: 'Upstream fetch failed: ' + err.message });
    }
  });

  // Finnhub 단건 — 키를 서버에서 주입하여 클라이언트에 노출하지 않음 (30초 캐시)
  app.get('/api/price/finnhub', async (req, reply) => {
    const symbol = (req.query as any)?.symbol as string | undefined;
    if (!symbol) return reply.code(400).send({ error: 'Missing ?symbol= parameter' });
    if (!env.FINNHUB_KEY) return reply.code(503).send({ error: 'FINNHUB_KEY not configured' });

    try {
      const { status, body } = await fetchFinnhubQuote(symbol);
      reply
        .code(status)
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Cache-Control', 'public, max-age=30');
      return body;
    } catch (err: any) {
      return reply.code(502).send({ error: 'Finnhub fetch failed: ' + err.message });
    }
  });

  // Finnhub 배치 — 여러 심볼을 한 요청으로 (서버가 병렬 조회). 브라우저 출처당 연결제한 우회.
  //   GET /api/prices/finnhub?symbols=AAPL,MSFT  → { "AAPL": {c,d,dp,...}, "MSFT": {...} }
  //   (조회 실패·무데이터(c<=0) 심볼은 맵에서 생략 → 클라이언트가 종목별 폴백)
  app.get('/api/prices/finnhub', async (req, reply) => {
    if (!env.FINNHUB_KEY) return reply.code(503).send({ error: 'FINNHUB_KEY not configured' });
    const raw = (req.query as any)?.symbols as string | undefined;
    if (!raw) return reply.code(400).send({ error: 'Missing ?symbols= parameter' });

    const symbols = Array.from(
      new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))
    ).slice(0, 60);
    if (symbols.length === 0) return {};

    const out: Record<string, any> = {};
    await runPool(symbols, 8, async (symbol) => {
      try {
        const { status, body } = await fetchFinnhubQuote(symbol);
        if (status === 200) {
          const j = JSON.parse(body);
          if (j && typeof j.c === 'number' && j.c > 0) out[symbol] = j;
        }
      } catch {
        /* 개별 심볼 실패는 무시 — 클라이언트가 폴백 */
      }
    });

    reply.header('Content-Type', 'application/json; charset=utf-8');
    return out;
  });
}
