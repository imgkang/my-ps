/* My PM — 백엔드 API 클라이언트 (Phase 3 데이터 계층).
 *
 * 기존 순수 클라이언트(PWA)를 프론트/백엔드 분리 구조로 옮기기 위한 클라이언트 측 진입점.
 * 집 PC의 Node.js 백엔드(Fastify, Cloudflare Tunnel 경유 HTTPS)와 통신한다.
 *
 * 설계 원칙:
 *   - baseUrl 미설정 시 모든 호출은 ApiNotConfiguredError 를 던진다.
 *     → HTML 은 이를 잡아 기존 localStorage 경로로 폴백할 수 있어 "점진적 전환"이 가능.
 *   - GET /api/sync 성공 시 번들을 localStorage 에 캐시 → 백엔드 다운/오프라인 시 캐시 반환.
 *   - PUT /api/sync 는 서버 version 보다 낮으면 409(stale) → 호출자가 병합/강제 결정.
 *   - 토큰·baseUrl 외 민감정보는 클라이언트에 두지 않는다(주가 키 등은 백엔드가 주입).
 *
 * 전역 API (window.MyPMApi):
 *   configure({ baseUrl })          - 백엔드 주소 설정(localStorage 영속). 끝 슬래시 제거.
 *   getBaseUrl()                    - 현재 baseUrl ('' 면 미설정)
 *   isConfigured()                  - baseUrl 설정 여부(boolean)
 *   login(pin)                      - PIN 으로 로그인 → 토큰 저장. {ok} 반환
 *   logout()                        - 토큰 삭제
 *   isAuthenticated()               - 토큰 보유 여부(boolean)
 *   getBundle()                     - GET /api/sync (실패 시 캐시 폴백). { bundle, fromCache } 반환
 *   getMeta()                       - GET /api/sync/meta → { version, updated_at }
 *   putBundle(bundle, { force })    - PUT /api/sync. 성공 {ok,version,updated_at} / 409 {conflict,...}
 *   getCachedBundle()               - 네트워크 없이 마지막 캐시 번들(또는 null)
 *   priceProxy(targetUrl)           - GET /api/price?url= (Naver/Yahoo 패스스루) → 파싱된 JSON
 *   finnhub(symbol)                 - GET /api/price/finnhub?symbol= → 파싱된 JSON
 *   search(q, { country, limit })   - GET /api/search → [item]
 *   tickersCount()                  - GET /api/tickers/count → { count }
 *   registerDevice(token, platform) - POST /api/push/register (platform: ios|android|web)
 *
 * 던지는 에러:
 *   ApiNotConfiguredError  - baseUrl 미설정
 *   ApiAuthError           - 401 (재로그인 필요)
 *   ApiHttpError           - 그 외 HTTP 오류 (status, body 포함)
 *   ApiOfflineError        - 네트워크 도달 실패(캐시 폴백도 불가한 경우)
 */
(function (global) {
  'use strict';

  var LS_BASE = 'mypm_api_base';
  var LS_TOKEN = 'mypm_auth_token';
  var LS_CACHE_BUNDLE = 'mypm_cache_bundle';
  var LS_CACHE_META = 'mypm_cache_bundle_meta';

  // ───────────────────────── 에러 타입 ─────────────────────────
  function makeError(name) {
    return function (message, extra) {
      var e = new Error(message || name);
      e.name = name;
      if (extra) Object.assign(e, extra);
      return e;
    };
  }
  var ApiNotConfiguredError = makeError('ApiNotConfiguredError');
  var ApiAuthError = makeError('ApiAuthError');
  var ApiHttpError = makeError('ApiHttpError');
  var ApiOfflineError = makeError('ApiOfflineError');

  // ───────────────────────── 설정/토큰 ─────────────────────────
  function lsGet(k) {
    try { return global.localStorage.getItem(k); } catch (_) { return null; }
  }
  function lsSet(k, v) {
    try { global.localStorage.setItem(k, v); } catch (_) {}
  }
  function lsDel(k) {
    try { global.localStorage.removeItem(k); } catch (_) {}
  }

  function getBaseUrl() {
    return (lsGet(LS_BASE) || '').replace(/\/+$/, '');
  }
  function isConfigured() {
    return !!getBaseUrl();
  }
  function configure(opts) {
    opts = opts || {};
    if (typeof opts.baseUrl === 'string') {
      lsSet(LS_BASE, opts.baseUrl.trim().replace(/\/+$/, ''));
    }
    return getBaseUrl();
  }
  function getToken() { return lsGet(LS_TOKEN) || ''; }
  function isAuthenticated() { return !!getToken(); }
  function logout() { lsDel(LS_TOKEN); }

  // ───────────────────────── fetch 래퍼 ─────────────────────────
  // path: '/api/...' 로 시작. opts.auth=true 면 Bearer 토큰 첨부.
  // 반환: { ok, status, data }  (data 는 JSON 파싱 결과 또는 원문)
  function request(path, opts) {
    opts = opts || {};
    var base = getBaseUrl();
    if (!base) {
      return Promise.reject(ApiNotConfiguredError('백엔드 baseUrl 이 설정되지 않았습니다'));
    }
    var headers = Object.assign({}, opts.headers || {});
    var body;
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }
    if (opts.auth) {
      var tok = getToken();
      if (!tok) return Promise.reject(ApiAuthError('로그인 토큰이 없습니다'));
      headers['Authorization'] = 'Bearer ' + tok;
    }

    return global.fetch(base + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: body,
    }).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      var parse = ct.indexOf('application/json') >= 0 ? res.json() : res.text();
      return parse.catch(function () { return null; }).then(function (data) {
        if (res.status === 401) {
          throw ApiAuthError('인증 실패(401)', { status: 401, data: data });
        }
        if (!res.ok) {
          throw ApiHttpError('HTTP ' + res.status, { status: res.status, data: data });
        }
        return { ok: true, status: res.status, data: data };
      });
    }, function (netErr) {
      // fetch reject = 네트워크 도달 실패(오프라인/터널 다운/CORS)
      throw ApiOfflineError('네트워크 도달 실패: ' + (netErr && netErr.message), { cause: netErr });
    });
  }

  // ───────────────────────── 인증 ─────────────────────────
  function login(pin) {
    return request('/api/auth/login', { method: 'POST', json: { pin: pin } })
      .then(function (r) {
        var token = r.data && r.data.token;
        if (!token) throw ApiHttpError('토큰을 받지 못했습니다', { data: r.data });
        lsSet(LS_TOKEN, token);
        return { ok: true };
      });
  }

  // ───────────────────────── 데이터 동기화 ─────────────────────────
  function getCachedBundle() {
    var raw = lsGet(LS_CACHE_BUNDLE);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function cacheBundle(bundle) {
    try {
      lsSet(LS_CACHE_BUNDLE, JSON.stringify(bundle));
      lsSet(LS_CACHE_META, JSON.stringify({
        version: bundle && bundle.version,
        cachedAt: new Date().toISOString(),
      }));
    } catch (_) {}
  }

  // GET /api/sync — 성공 시 캐시 갱신. 오프라인이면 캐시 폴백.
  function getBundle() {
    return request('/api/sync', { auth: true }).then(function (r) {
      cacheBundle(r.data);
      return { bundle: r.data, fromCache: false };
    }, function (err) {
      if (err.name === 'ApiOfflineError') {
        var cached = getCachedBundle();
        if (cached) return { bundle: cached, fromCache: true };
      }
      throw err;
    });
  }

  function getMeta() {
    return request('/api/sync/meta', { auth: true }).then(function (r) { return r.data; });
  }

  // PUT /api/sync — 409(stale) 는 throw 대신 {conflict:true,...} 로 반환해 호출자가 판단.
  function putBundle(bundle, opts) {
    opts = opts || {};
    var path = '/api/sync' + (opts.force ? '?force=true' : '');
    return request(path, { method: 'PUT', json: bundle, auth: true })
      .then(function (r) {
        cacheBundle(bundle);
        return r.data; // { ok, version, updated_at }
      }, function (err) {
        if (err.name === 'ApiHttpError' && err.status === 409) {
          return Object.assign({ conflict: true }, err.data); // { conflict, serverVersion, incomingVersion }
        }
        throw err;
      });
  }

  // ───────────────────────── 주가 프록시 ─────────────────────────
  // 기존 worker/proxy.js 호출처럼, 대상 URL 을 백엔드로 패스스루.
  function priceProxy(targetUrl) {
    var p = '/api/price?url=' + encodeURIComponent(targetUrl);
    return request(p).then(function (r) { return r.data; });
  }
  function finnhub(symbol) {
    return request('/api/price/finnhub?symbol=' + encodeURIComponent(symbol))
      .then(function (r) { return r.data; });
  }

  // ───────────────────────── 종목 검색 ─────────────────────────
  function search(q, opts) {
    opts = opts || {};
    var p = '/api/search?q=' + encodeURIComponent(q);
    if (opts.country) p += '&country=' + encodeURIComponent(opts.country);
    if (opts.limit) p += '&limit=' + encodeURIComponent(opts.limit);
    return request(p).then(function (r) { return r.data; });
  }
  function tickersCount() {
    return request('/api/tickers/count').then(function (r) { return r.data; });
  }

  // ───────────────────────── 푸시 ─────────────────────────
  function registerDevice(token, platform) {
    return request('/api/push/register', {
      method: 'POST', auth: true, json: { token: token, platform: platform || 'web' },
    }).then(function (r) { return r.data; });
  }

  global.MyPMApi = {
    // 설정/인증
    configure: configure,
    getBaseUrl: getBaseUrl,
    isConfigured: isConfigured,
    login: login,
    logout: logout,
    isAuthenticated: isAuthenticated,
    // 동기화
    getBundle: getBundle,
    getMeta: getMeta,
    putBundle: putBundle,
    getCachedBundle: getCachedBundle,
    // 주가
    priceProxy: priceProxy,
    finnhub: finnhub,
    // 검색
    search: search,
    tickersCount: tickersCount,
    // 푸시
    registerDevice: registerDevice,
    // 저수준(테스트/고급용)
    request: request,
    errors: {
      ApiNotConfiguredError: ApiNotConfiguredError,
      ApiAuthError: ApiAuthError,
      ApiHttpError: ApiHttpError,
      ApiOfflineError: ApiOfflineError,
    },
  };
})(typeof window !== 'undefined' ? window : this);
