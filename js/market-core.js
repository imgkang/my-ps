// market-core.js — NonK / KDeal 공통 코어
// 두 시장(미국/한국) 앱이 공유하는 시장-무관 로직 + 부트스트랩.
// classic <script> 로 로드되어 아래 함수/상수는 전역(또는 전역 lexical)으로 노출된다.
// 시장별 차이는 각 HTML 이 정의하는 MARKET_CONFIG 로 주입 → MarketCore.init(cfg).

// ── 공유 상수 (전역 lexical; 인라인 스크립트에서 참조) ──
const COL_ORDER_KEY = 'mypm_col_order_v1';
const YAHOO_HOSTS = ['query2.finance.yahoo.com', 'query1.finance.yahoo.com'];

// ── 컬럼 순서 (세 앱 공유 — MyPM 설정에서 편집, NonK/KDeal 읽기 전용 동일 적용) ──
function orderedCols(savedOrder, COLS) {
  const byId = new Map(COLS.map(c => [c.id, c]));
  const out = [], seen = new Set();
  for (const id of (savedOrder || [])) {
    if (byId.has(id) && !seen.has(id)) { out.push(byId.get(id)); seen.add(id); }
  }
  for (const c of COLS) if (!seen.has(c.id)) out.push(c);
  return out;
}
function loadColOrder(DEFAULT_IDS) {
  try { const r = JSON.parse(localStorage.getItem(COL_ORDER_KEY)); return Array.isArray(r) ? r : DEFAULT_IDS.slice(); }
  catch(_) { return DEFAULT_IDS.slice(); }
}

// ── 서버 계산 시각 → "MM/DD HH:MM" (히어로 '오늘' 라벨용) ──
function fmtHeroAsOf(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  const p = (n) => ('0' + n).slice(-2);
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── 백엔드 /api/price 프록시 패스스루 ──
async function fetchWithTimeout(url, ms = 9000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(tid);
    return res;
  } catch(e) { clearTimeout(tid); throw e; }
}
async function fetchViaProxy(targetUrl) {
  const base = (window.MyPMApi && MyPMApi.getBaseUrl()) || '';
  const res = await fetchWithTimeout(base + '/api/price?url=' + encodeURIComponent(targetUrl));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  if (!text || text.length < 10) throw new Error('빈 응답');
  return text;
}

// ── 영속 상태 load/save (시장 공통; 키는 MarketCore.cfg.storageKeys, 상태는 ST) ──
function _K(name) { return MarketCore.cfg.storageKeys[name]; }
function loadHoldings()  { try { return JSON.parse(localStorage.getItem(_K('holdings'))) || []; } catch(e) { return []; } }
function saveHoldings()  { localStorage.setItem(_K('holdings'), JSON.stringify(ST.holdings)); }
function loadCash()      { try { return JSON.parse(localStorage.getItem(_K('cash'))) || {}; } catch(e) { return {}; } }
function saveCashData()  { localStorage.setItem(_K('cash'), JSON.stringify(ST.cash)); }
function loadDeposits()  { try { return JSON.parse(localStorage.getItem(_K('deposits'))) || { transactions: [] }; } catch(e) { return { transactions: [] }; } }
function saveDeposits()  { localStorage.setItem(_K('deposits'), JSON.stringify(ST.deposits)); }
function loadMonthly()   { try { return JSON.parse(localStorage.getItem(_K('monthly'))) || []; } catch(e) { return []; } }
function saveMonthly()   { localStorage.setItem(_K('monthly'), JSON.stringify(ST.monthly)); }
function loadDividends() {
  try {
    const arr = JSON.parse(localStorage.getItem(_K('dividends'))) || [];
    if (!Array.isArray(arr)) return [];
    return arr.map(r => ({
      id: String(r.id || (Date.now() + Math.random())),
      year: parseInt(r.year, 10) || 0,
      month: parseInt(r.month, 10) || 0,
      stocks:         (r.stocks         && typeof r.stocks         === 'object') ? r.stocks         : {},
      stocksPerShare: (r.stocksPerShare && typeof r.stocksPerShare === 'object') ? r.stocksPerShare : {},
      stocksShares:   (r.stocksShares   && typeof r.stocksShares   === 'object') ? r.stocksShares   : {},
      accounts:       (r.accounts       && typeof r.accounts       === 'object') ? r.accounts       : {}
    })).filter(r => r.year > 0 && r.month >= 1 && r.month <= 12);
  } catch(e) { return []; }
}
function saveDividends() { localStorage.setItem(_K('dividends'), JSON.stringify(ST.dividends)); }
function loadWatchlist() { try { return JSON.parse(localStorage.getItem(_K('watchlist'))) || []; } catch(_) { return []; } }
function saveWatchlist() { localStorage.setItem(_K('watchlist'), JSON.stringify(ST.watchlist)); }

// ── 부트스트랩 ──
// 각 HTML 은 MARKET_CONFIG 를 정의한 뒤 MarketCore.init(MARKET_CONFIG) 호출.
// cfg: { market, version, locale, storageKeys, labels, ... }
const MarketCore = {
  cfg: null,
  state: {},   // 영속 상태(accounts/holdings/cash/deposits/monthly/dividends/watchlist/trades)
  init(cfg) {
    this.cfg = cfg;
    if (window.InputUX) {
      InputUX.setNumberDefaults({ locale: cfg.locale });        // Stage 2: 기본 숫자 locale
      // Stage 1: 숫자/금액 입력 탭 시 기존값 자동선택
      InputUX.setAutoSelectSelector('input[inputmode=numeric], input[inputmode=decimal], [data-iux-num]');
    }
    if (window.TickerSearch) window.TickerSearch.init();
    // 설정에 따른 네비/줌 가시성 적용
    document.addEventListener('DOMContentLoaded', () => {
      try {
        const s = JSON.parse(localStorage.getItem('pension_app_settings_v1')) || {};
        if (s.showNonK  === false) document.querySelectorAll('a[href="NonK.html"]').forEach(e => e.style.display = 'none');
        if (s.showKDeal === false) document.querySelectorAll('a[href="KDeal.html"]').forEach(e => e.style.display = 'none');
        if (s.allowZoom === false) {
          const m = document.querySelector('meta[name="viewport"]');
          if (m) m.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
        }
      } catch(_) {}
    });
  }
};
window.MarketCore = MarketCore;
// 전역 단축 참조 — 인라인 스크립트와 공유 함수가 동일 상태 객체를 가리킨다.
var ST = MarketCore.state;
