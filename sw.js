// MyPM Service Worker
const CACHE_NAME = 'mypm-v0.663';

const BASE = '/my-ps/';

const ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'NonK.html',
  BASE + 'KDeal.html',
  BASE + 'settings.html',
  BASE + 'stock-db.js',
  BASE + 'js/ticker-search.js',
  BASE + 'js/api.js',
  BASE + 'js/input-ux.js',
  BASE + 'js/market-core.js?v=0.663',
  BASE + 'market.css?v=0.663',
  BASE + 'tickers.json',
  BASE + 'manifest.json',
  BASE + 'icon.svg',
  // Chart.js CDN 은 런타임 fetch handler 에서 캐싱 (precache 실패 시 PWA 가 깨지는 것 방지)
];

// 설치: 핵심 파일을 캐시에 저장 (개별 add로 일부 누락 허용 — tickers.json 등이 아직 없을 수 있음)
self.addEventListener('install', event => {
  // skipWaiting() 자동 호출하지 않음 — 새 SW가 대기하다가, 페이지가 사용자 확인 +
  // 백업/저장 flush 후 SKIP_WAITING 메시지를 보낼 때만 활성화(저장 도중 강제 리로드 방지).
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(
        ASSETS.map(url => cache.add(url).catch(() => null))
      ))
  );
});

// 활성화: 이전 버전 캐시 삭제 후 모든 탭 강제 리로드
self.addEventListener('activate', event => {
  // 이전 버전 캐시만 삭제하고 제어권을 가져온다. 열린 탭을 강제로 navigate/reload 하지 않음 —
  // 저장 도중 리로드로 데이터가 깨지는 것을 막기 위해, 리로드는 페이지가 안전한 시점에 직접 수행.
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// SKIP_WAITING 메시지 처리
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// 요청 처리: 캐시 우선, 백그라운드 갱신
self.addEventListener('fetch', event => {
  // Google API / Drive 요청은 항상 네트워크로
  if (event.request.url.includes('googleapis.com') ||
      event.request.url.includes('accounts.google.com')) {
    return;
  }

  // 백엔드 API(/api/*)는 캐시하지 않고 항상 네트워크 — 동적 데이터 + POST 로그인 등.
  try { if (new URL(event.request.url).pathname.startsWith('/api/')) return; } catch (_) {}
  // GET 외(POST/PUT/DELETE)는 캐시 대상이 아니므로 그대로 네트워크.
  if (event.request.method !== 'GET') return;

  // tickers.json 은 네트워크 우선 — 종목 마스터 데이터가 갱신되면 즉시 반영.
  // (캐시 우선이면 새 ETF 등이 다음 로드까지 안 보임). 오프라인은 캐시로 폴백.
  try {
    if (new URL(event.request.url).pathname.endsWith('/tickers.json')) {
      event.respondWith(
        fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => caches.match(event.request))
      );
      return;
    }
  } catch (_) {}

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // 백그라운드에서 최신 버전 업데이트
        fetch(event.request).then(response => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, response));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
