// Cloudflare Worker — Yahoo Finance CORS 프록시
// 배포 방법: https://github.com/imgkang/my-ps/blob/main/worker/README.md

const ALLOWED_HOSTS = [
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
];

// Worker 내부에서 30초간 캐시 (같은 종목 연속 요청 시 Yahoo 서버 부하 감소)
const CACHE_TTL = 30;

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const { searchParams } = new URL(request.url);
    const target = searchParams.get('url');

    if (!target) {
      return new Response('Missing ?url= parameter', { status: 400 });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return new Response('Invalid URL', { status: 400 });
    }

    if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
      return new Response(`Host not allowed: ${targetUrl.hostname}`, { status: 403 });
    }

    try {
      const res = await fetch(targetUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json, */*',
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        },
        cf: {
          cacheTtl: CACHE_TTL,
          cacheEverything: true,
        },
      });

      const body = await res.text();

      return new Response(body, {
        status: res.status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': `public, max-age=${CACHE_TTL}`,
        },
      });
    } catch (err) {
      return new Response('Upstream fetch failed: ' + err.message, { status: 502 });
    }
  },
};
