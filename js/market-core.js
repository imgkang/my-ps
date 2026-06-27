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

// ── 공유: 정규화 동일 + 외부 의존 없는 유틸/모달/계산 함수 (Phase 6) ──
function adjustCash(accId, delta) {
  if (!accId) return;
  ST.cash[accId] = (Number(ST.cash[accId]) || 0) + delta;
  saveCashData();
}
function divRecCodes(rec) {
  const set = new Set();
  if (rec.stocks)         for (const k of Object.keys(rec.stocks))         set.add(k);
  if (rec.stocksPerShare) for (const k of Object.keys(rec.stocksPerShare)) set.add(k);
  return [...set];
}
function applyServerPrices() {
  const covered = new Set();
  try {
    const snap = JSON.parse(localStorage.getItem('mypm_derived_v1') || 'null');
    const pm = snap && snap.data && snap.data.prices;
    if (!pm) return covered;
    ST.holdings.forEach(h => {
      const p = pm[h.ticker];
      if (p && typeof p.price === 'number' && p.price > 0) {
        h.price = p.price;
        h.change = Number(p.change) || 0;
        const prev = p.price - h.change;
        h.changeRate = prev > 0 ? (h.change / prev * 100) : 0;
        h.updatedAt = new Date().toISOString();
        covered.add(h.ticker);
      }
    });
  } catch (_) {}
  return covered;
}
function computeAccountValue(accId) {
  let total = 0;
  for (const h of ST.holdings) {
    const a = h.accounts && h.accounts[accId];
    if (a && a.qty > 0) total += a.qty * (h.price || 0);
  }
  total += Number(ST.cash[accId]) || 0;
  return total;
}
function totalDeposited(accId = null, accIds = null) {
  let txns = ST.deposits.transactions;
  if (accId) txns = txns.filter(t => t.accId === accId);
  else if (accIds) txns = txns.filter(t => accIds.includes(t.accId));
  return txns.reduce((s, t) => s + (t.type === 'withdraw' ? -Number(t.amount) : Number(t.amount)), 0);
}
function snapPricedAt() {
  try {
    const snap = JSON.parse(localStorage.getItem('mypm_derived_v1') || 'null');
    if (!snap || !snap.data || !snap.data[MarketCore.cfg.snapKey]) return null;
    const localVer = localStorage.getItem('mypm_synced_version');
    if (localVer == null || String(snap.dataVersion) !== String(localVer)) return null;
    return snap.pricedAt || null;
  } catch (_) { return null; }
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function closeCashModal() {
  document.getElementById('CashModal').classList.remove('open');
}
function closeDepositModal() {
  document.getElementById('DepositModal').classList.remove('open');
}
function closeRecordsModal() {
  document.getElementById('AccountRecordsModal').classList.remove('open');
}
async function fetchHistoricalClose(ticker, year, month) {
  const lastDay = new Date(year, month, 0);
  const period1 = Math.floor(new Date(year, month - 1, 1).getTime() / 1000);
  const period2 = Math.floor(lastDay.getTime() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${period1}&period2=${period2}`;
  const chart = JSON.parse(await fetchViaProxy(url))?.chart?.result?.[0];
  if (!chart) throw new Error('No data');
  const timestamps = chart.timestamp || [];
  const closes = chart.indicators?.quote?.[0]?.close || [];
  let bestTs = 0, bestClose = 0;
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] > 0 && timestamps[i] > bestTs) { bestTs = timestamps[i]; bestClose = closes[i]; }
  }
  if (!bestClose) throw new Error('종가 없음');
  const d = new Date(bestTs * 1000);
  return {
    price: bestClose,
    date: `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
  };
}
function closeDividendModal() {
  document.getElementById('DividendModal').classList.remove('open');
}
function toggleDivRow(code) {
  const row = document.querySelector(`#DivStockInputs tr.div-account-row[data-code-for="${code}"]`);
  if (!row) return;
  const ind = document.getElementById('DivToggle_' + code);
  const open = row.style.display === 'none';
  row.style.display = open ? 'table-row' : 'none';
  if (ind) ind.textContent = open ? '▼' : '▶';
}
function divRecIsMisc(rec) { return !!(rec && rec.misc); }
function divRecMiscTotal(rec) {
  if (!rec || !rec.misc) return 0;
  let t = 0;
  for (const v of Object.values(rec.misc.accounts || {})) t += Number(v) || 0;
  return t;
}
function closeAccountSettings() {
  document.getElementById('AccountSettingsModal').classList.remove('open');
}
function tFifoAnalysis() {
  const sorted = [...ST.trades].sort((a, b) =>
    a.date !== b.date ? a.date.localeCompare(b.date) : a.id.localeCompare(b.id));
  const openLots = {};
  const closedMap = {};

  for (const t of sorted) {
    const fee = Number(t.fee) || 0;
    if (t.type === 'buy') {
      if (!openLots[t.ticker]) openLots[t.ticker] = [];
      openLots[t.ticker].push({ id: t.id, date: t.date, price: t.price,
        qty: t.qty, remaining: t.qty, fee, name: t.name });
    } else {
      const lots = openLots[t.ticker] || [];
      let sellRemain = t.qty;
      let matchedCost = 0, matchedQty = 0, weightedDays = 0;
      while (sellRemain > 0 && lots.length > 0) {
        const lot = lots[0];
        const take = Math.min(lot.remaining, sellRemain);
        const feeAlloc = lot.qty > 0 ? (lot.fee / lot.qty) * take : 0;
        matchedCost += lot.price * take + feeAlloc;
        weightedDays += Math.max(1, Math.round((new Date(t.date) - new Date(lot.date)) / 86400000)) * take;
        matchedQty += take;
        lot.remaining -= take; sellRemain -= take;
        if (lot.remaining === 0) lots.shift();
      }
      if (matchedQty > 0) {
        const feeAlloc = t.qty > 0 ? fee * (matchedQty / t.qty) : 0;
        const sellNet = t.price * matchedQty - feeAlloc;
        const pnl = sellNet - matchedCost;
        const simpleReturn = matchedCost > 0 ? pnl / matchedCost : 0;
        const avgDays = Math.round(weightedDays / matchedQty);
        const annReturn = avgDays > 0
          ? Math.pow(Math.max(0, sellNet / matchedCost), 365 / avgDays) - 1
          : simpleReturn;
        closedMap[t.id] = { pnl, simpleReturn, annReturn, holdingDays: avgDays, qty: matchedQty };
      }
    }
  }

  const positions = [];
  for (const [ticker, lots] of Object.entries(openLots)) {
    const qty = lots.reduce((s, l) => s + l.remaining, 0);
    if (qty <= 0) continue;
    const cost = lots.reduce((s, l) => {
      const feePerShare = l.qty > 0 ? l.fee / l.qty : 0;
      return s + (l.price + feePerShare) * l.remaining;
    }, 0);
    positions.push({ ticker, name: lots[lots.length-1].name || ticker,
      qty, avgPrice: cost / qty, cost });
  }
  positions.sort((a, b) => a.ticker.localeCompare(b.ticker));
  return { positions, closedMap };
}
function tGetHeldStocksAsOf(date) {
  const sorted = [...ST.trades]
    .filter(t => t.date <= date)
    .sort((a, b) => a.date !== b.date ? a.date.localeCompare(b.date) : a.id.localeCompare(b.id));
  const openLots = {};
  for (const t of sorted) {
    if (t.type === 'buy') {
      if (!openLots[t.ticker]) openLots[t.ticker] = [];
      openLots[t.ticker].push({ qty: t.qty, remaining: t.qty, name: t.name });
    } else {
      const lots = openLots[t.ticker] || [];
      let sellRemain = t.qty;
      while (sellRemain > 0 && lots.length > 0) {
        const lot = lots[0];
        const take = Math.min(lot.remaining, sellRemain);
        lot.remaining -= take; sellRemain -= take;
        if (lot.remaining === 0) lots.shift();
      }
    }
  }
  return Object.entries(openLots)
    .map(([ticker, lots]) => {
      const qty = lots.reduce((s, l) => s + l.remaining, 0);
      return qty > 0 ? { ticker, name: lots[lots.length-1].name || ticker, qty } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}
function tHandleTradeBackdrop(e) {
  if (e.target.id === 'tTradeModal') nktCloseTradeModal();
}
function tShowAcList(listEl, items, onSelect) {
  listEl.innerHTML = '';
  if (!items.length) { listEl.classList.remove('open'); return; }
  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'mt-ac-item';
    div.innerHTML = `<span class="mt-ac-name">${item.name}</span><span class="mt-ac-code">${item.ticker}</span>`;
    div.addEventListener('mousedown', e => { e.preventDefault(); onSelect(item); });
    listEl.appendChild(div);
  });
  listEl.classList.add('open');
}

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
