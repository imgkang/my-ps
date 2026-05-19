// MyPM Service Worker
const CACHE_NAME = 'mypm-v0.369';

const BASE = '/my-ps/';

const ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'stock-db.js',
  BASE + 'js/ticker-search.js',
  BASE + 'tickers.json',
  BASE + 'manifest.json',
  BASE + 'icon.svg',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

// 설치: 핵심 파일을 캐시에 저장 (개별 add로 일부 누락 허용 — tickers.json 등이 아직 없을 수 있음)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(
        ASSETS.map(url => cache.add(url).catch(() => null))
      ))
      .then(() => self.skipWaiting())
  );
});

// 활성화: 이전 버전 캐시 삭제 후 모든 탭 강제 리로드
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(c => { try { c.navigate(c.url); } catch(_) {} }))
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
