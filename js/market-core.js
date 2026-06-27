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

// ── 공유: 함수명 통일 후 byte-identical 함수 (Phase 7) ──
function switchPage(page) {
  const mypm = document.getElementById('pageMyPM');
  const nonk = document.getElementById('pageNonK');
  const tabM = document.getElementById('tabMyPM');
  const tabN = document.getElementById('tabNonK');
  if (page === 'nonk') {
    mypm.style.display = 'none';
    nonk.style.display = '';
    tabM.classList.remove('active');
    tabN.classList.add('active');
    Render();
    RenderChart();
  } else {
    nonk.style.display = 'none';
    mypm.style.display = '';
    tabN.classList.remove('active');
    tabM.classList.add('active');
  }
}
function InitAutoRefresh() {
  if (ST.autoRefreshTimer) { clearInterval(ST.autoRefreshTimer); ST.autoRefreshTimer = null; }
  const minutes = parseInt(localStorage.getItem('autoRefreshMinutes'), 10) || 0;
  if (minutes > 0) {
    ST.autoRefreshTimer = setInterval(() => {
      if (ST.holdings.length) RefreshAll();
    }, minutes * 60 * 1000);
  }
}
function DeleteHolding(ticker) {
  if (!confirm(`${ticker} 종목을 삭제하시겠습니까?`)) return;
  ST.holdings = ST.holdings.filter(h => h.ticker !== ticker);
  saveHoldings();
  Render();
  RenderChart();
}
function CloseAccountModal() {
  document.getElementById('AccountModal').classList.remove('open');
  ST.editingTicker = null;
}
function SaveAccountQuantities() {
  const h = ST.holdings.find(x => x.ticker === ST.editingTicker);
  if (!h) return;
  if (!h.accounts) h.accounts = {};
  for (const a of ST.accounts.filter(x => x.active !== false)) {
    h.accounts[a.id] = {
      qty:      Number(document.getElementById(`AccQty_${a.id}`)?.value?.replace(/,/g,'')) || 0,
      avgPrice: Number(document.getElementById(`AccAvg_${a.id}`)?.value?.replace(/,/g,'')) || 0
    };
  }
  saveHoldings();
  CloseAccountModal();
  Render();
}
function CloseAccountDetail() {
  document.getElementById('AccountDetailModal').classList.remove('open');
  if (ST.detailChartInstance) { ST.detailChartInstance.destroy(); ST.detailChartInstance = null; }
}
function SaveCash() {
  for (const a of ST.accounts.filter(x => x.active !== false)) {
    ST.cash[a.id] = Number(document.getElementById(`CashInput_${a.id}`)?.value.replace(/,/g,'')) || 0;
  }
  saveCashData();
  closeCashModal();
  Render();
}
function OpenDepositModal() {
  RenderDepositList();
  document.getElementById('DepositModal').classList.add('open');
}
function ToggleDepositYear(year) {
  if (!ST.depositCollapsedYears) ST.depositCollapsedYears = new Set();
  if (ST.depositCollapsedYears.has(year)) ST.depositCollapsedYears.delete(year);
  else ST.depositCollapsedYears.add(year);
  RenderDepositList();
}
function CloseTxnEditor() {
  ST.editingTxnId = null;
  document.getElementById('TxnEditorModal').classList.remove('open');
}
function AddMonthlyRecord() {
  const dateVal = document.getElementById('RecDate').value;
  if (!dateVal) { alert('기록일을 선택하세요'); return; }
  const [year, month, day] = dateVal.split('-').map(Number);
  if (!year || !month || !day) { alert('날짜를 올바르게 입력하세요'); return; }
  const accounts = {};
  ST.accounts.forEach(a => { accounts[a.id] = Number(document.getElementById(`RecVal_${a.id}`)?.value.replace(/,/g,'')) || 0; });
  if (ST.editingRecordId) {
    const rec = ST.monthly.find(r => r.id === ST.editingRecordId);
    if (rec) { rec.year = year; rec.month = month; rec.day = day; rec.accounts = accounts; }
    CancelRecordEdit();
  } else {
    if (ST.monthly.some(r => r.year === year && r.month === month && (r.day || 1) === day)) {
      if (!confirm(`${year}년 ${month}월 ${day}일 기록이 이미 있습니다. 덮어쓰겠습니까?`)) return;
      ST.monthly = ST.monthly.filter(r => !(r.year === year && r.month === month && (r.day || 1) === day));
    }
    ST.monthly.push({ id: String(Date.now()), year, month, day, accounts });
  }
  saveMonthly();
  RenderRecordsList();
  RenderChart();
}
function CancelRecordEdit() {
  ST.editingRecordId = null;
  const addBtn    = document.getElementById('RecAddBtn');
  const cancelBtn = document.getElementById('RecCancelBtn');
  if (addBtn)    addBtn.textContent = '➕ 추가';
  if (cancelBtn) cancelBtn.style.display = 'none';
}
function DeleteMonthlyRecord(id) {
  const rec = ST.monthly.find(r => r.id === id);
  if (!rec || !confirm(`${rec.year}년 ${rec.month}월 기록을 삭제하시겠습니까?`)) return;
  ST.monthly = ST.monthly.filter(r => r.id !== id);
  saveMonthly();
  RenderRecordsList();
  RenderChart();
}
function OpenDividendModal() {
  const d = new Date();
  document.getElementById('DivYear').value  = d.getFullYear();
  document.getElementById('DivMonth').value = d.getMonth() + 1;
  if (window.InputUX) InputUX.scanYMChips();
  ST.editingDivId = null;
  const saveBtn = document.getElementById('DivSaveBtn');
  if (saveBtn) saveBtn.textContent = '➕ 추가';
  const cancelBtn = document.getElementById('DivCancelBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';
  RenderDivStockInputs({}, null);
  ToggleDivMiscForm(false);
  CancelDivMiscEdit();
  RenderDividendLists();
  document.getElementById('DividendModal').classList.add('open');
}
function UpdateAccQty(code, accId, val) {
  ST.divFormShares[code] = ST.divFormShares[code] || {};
  ST.divFormShares[code][accId] = Number(val) || 0;
  UpdateDivRow(code);
}
function ClearDividendInputs() {
  document.querySelectorAll('#DivStockInputs .div-ps').forEach(inp => { inp.value = ''; });
  UpdateDivTotal();
}
function DeleteDividendRecord(id) {
  const rec = ST.dividends.find(r => r.id === id);
  if (!rec) return;
  const miscLabel = rec.misc ? ` (기타: ${rec.misc.memo || ''})` : '';
  if (!confirm(`${rec.year}년 ${rec.month}월${miscLabel} 배당 기록을 삭제하시겠습니까?`)) return;
  ST.dividends = ST.dividends.filter(r => r.id !== id);
  if (ST.editingDivId === id) {
    ST.editingDivId = null;
    const saveBtn = document.getElementById('DivSaveBtn');
    if (saveBtn) saveBtn.textContent = '➕ 추가';
    const cancelBtn = document.getElementById('DivCancelBtn');
    if (cancelBtn) cancelBtn.style.display = 'none';
    ClearDividendInputs();
  }
  if (ST.divMiscEditingId === id) CancelDivMiscEdit();
  saveDividends();
  RenderDividendLists();
}
function EditDividendRecord(id) {
  const rec = ST.dividends.find(r => r.id === id);
  if (!rec) return;
  document.getElementById('DivYear').value = rec.year;
  document.getElementById('DivMonth').value = rec.month;
  if (window.InputUX) InputUX.scanYMChips();
  if (divRecIsMisc(rec)) {
    ST.editingDivId = null;
    const stockSaveBtn = document.getElementById('DivSaveBtn');
    if (stockSaveBtn) stockSaveBtn.textContent = '➕ 추가';
    const stockCancelBtn = document.getElementById('DivCancelBtn');
    if (stockCancelBtn) stockCancelBtn.style.display = 'none';
    ST.divMiscEditingId = id;
    document.getElementById('DivMiscMemo').value = rec.misc.memo || '';
    ToggleDivMiscForm(true);
    RenderDivMiscInputs(rec.misc.accounts || {});
    const saveBtn = document.getElementById('DivMiscSaveBtn');
    if (saveBtn) saveBtn.textContent = '수정 저장';
    const cancelBtn = document.getElementById('DivMiscCancelBtn');
    if (cancelBtn) cancelBtn.style.display = '';
    document.getElementById('DivMiscBody').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  ST.editingDivId = id;
  const perShareMap = (rec.stocksPerShare && Object.keys(rec.stocksPerShare).length > 0) ? rec.stocksPerShare : {};
  const sharesOverride = (rec.stocksShares && Object.keys(rec.stocksShares).length > 0) ? rec.stocksShares : null;
  RenderDivStockInputs(perShareMap, sharesOverride);
  const saveBtn = document.getElementById('DivSaveBtn');
  if (saveBtn) saveBtn.textContent = '수정 저장';
  const cancelBtn = document.getElementById('DivCancelBtn');
  if (cancelBtn) cancelBtn.style.display = '';
  const card = document.querySelector('#DividendModal .records-input-card');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function CancelDivEdit() {
  ST.editingDivId = null;
  const saveBtn = document.getElementById('DivSaveBtn');
  if (saveBtn) saveBtn.textContent = '➕ 추가';
  const cancelBtn = document.getElementById('DivCancelBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';
  RenderDivStockInputs({}, null);
}
function ToggleDivMiscForm(forceOpen) {
  const body = document.getElementById('DivMiscBody');
  const btn  = document.getElementById('DivMiscToggleBtn');
  if (!body) return;
  const shouldOpen = forceOpen !== undefined ? forceOpen : body.style.display === 'none';
  if (shouldOpen) {
    body.style.display = '';
    if (btn) btn.textContent = '접기 ▴';
    RenderDivMiscInputs();
  } else {
    body.style.display = 'none';
    if (btn) btn.textContent = '펼치기 ▾';
  }
}
function CancelDivMiscEdit() {
  ST.divMiscEditingId = null;
  const saveBtn = document.getElementById('DivMiscSaveBtn');
  if (saveBtn) saveBtn.textContent = '기타항목 추가';
  const cancelBtn = document.getElementById('DivMiscCancelBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';
  ClearDivMiscInputs();
}
function CloseDivStockEdit() {
  document.getElementById('DivStockEditPanel').style.display = 'none';
  ST.divStockEditRecId = null; ST.divStockEditTicker = null;
}
function CloseDivAccEdit() {
  document.getElementById('DivAccEditPanel').style.display = 'none';
  ST.divAccEditRecId = null; ST.divAccEditAccId = null;
}
function OpenAccountSettings() {
  RenderAccountSettingsBody();
  document.getElementById('AccountSettingsModal').classList.add('open');
}
function RenderAccountSettingsBody() {
  const body = document.getElementById('AccountSettingsBody');
  if (!body) return;

  let html = '';

  html += `<div class="nk-acc-settings-list">` + ST.accounts.map(a => {
    const isActive = a.active !== false;
    return `<div class="nk-acc-settings-row">
        <button class="nk-acc-toggle-btn${isActive ? ' active' : ''}" onclick="ToggleAccountActive('${a.id}')">${escapeHtml(a.name)}</button>
        <button class="edit-btn" onclick="RenameAccount('${a.id}')">이름변경</button>
        <button class="del-btn" onclick="DeleteAccount('${a.id}')">삭제</button>
      </div>`;
  }).join('') + `</div>`;

  html += `<div class="nk-acc-section-title" style="margin-top:12px">새 계좌 추가</div>`;
  html += `<div class="nk-acc-add-row">
    <input type="text" id="NewAccName" placeholder="계좌 이름" maxlength="20" style="padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:14px">
    <button class="btn-primary" onclick="AddAccount()">추가</button>
  </div>`;

  body.innerHTML = html;
  setTimeout(() => {
    const inp = document.getElementById('NewAccName');
    if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') AddAccount(); });
  }, 0);
}
function AddAccount() {
  const inp = document.getElementById('NewAccName');
  const name = (inp?.value || '').trim();
  if (!name) { alert('계좌 이름을 입력하세요'); return; }
  const id = 'acc_' + Date.now();
  ST.accounts.push({ id, name, active: true });
  SaveAccounts();
  RenderAccountSettingsBody();
  RenderAccountButtons();
  Render();
  RenderChart();
}
function ToggleAccountActive(id) {
  const acc = ST.accounts.find(a => a.id === id);
  if (!acc) return;
  acc.active = (acc.active === false) ? true : false;
  SaveAccounts();
  RenderAccountSettingsBody();
  RenderAccountButtons();
  Render();
  RenderChart();
}
function DeleteAccount(id) {
  const acc = ST.accounts.find(a => a.id === id);
  if (!acc) return;
  // 보유 데이터 확인
  const hasHoldings = ST.holdings.some(h => h.accounts && (h.accounts[id]?.qty || 0) > 0);
  const hasCash = (Number(ST.cash[id]) || 0) > 0;
  if (hasHoldings || hasCash) {
    alert(`'${acc.name}' 계좌에 보유 주식 또는 현금이 있어 삭제할 수 없습니다.\n먼저 해당 계좌의 보유 수량과 현금을 0으로 변경하세요.`);
    return;
  }
  if (!confirm(`'${acc.name}' 계좌를 삭제하시겠습니까?`)) return;
  ST.accounts = ST.accounts.filter(a => a.id !== id);
  SaveAccounts();
  RenderAccountSettingsBody();
  RenderAccountButtons();
  Render();
  RenderChart();
}
function OpenWatchModal() {
  ST.watchPending = null;
  document.getElementById('WatchSearch').value = '';
  document.getElementById('WatchPreview').style.display = 'none';
  const listEl = document.getElementById('WatchAcList');
  if (listEl) listEl.classList.remove('open');
  document.getElementById('WatchModal').classList.add('open');
  setTimeout(() => document.getElementById('WatchSearch').focus(), 50);
}
function CloseWatchModal() {
  document.getElementById('WatchModal').classList.remove('open');
  ST.watchPending = null;
}
function OnWatchSearchInput(val) {
  clearTimeout(ST.watchAcTimer);
  ST.watchPending = null;
  document.getElementById('WatchPreview').style.display = 'none';
  const listEl = document.getElementById('WatchAcList');
  if (!val.trim()) { listEl.classList.remove('open'); return; }
  ST.watchAcTimer = setTimeout(async () => {
    const items = await WatchFetchAutocomplete(val.trim());
    listEl.innerHTML = '';
    if (!items.length) { listEl.classList.remove('open'); return; }
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'mw-ac-item';
      div.innerHTML = `<span class="mw-ac-name">${item.name}</span><span class="mw-ac-ticker">${item.ticker}</span>`;
      div.addEventListener('mousedown', e => {
        e.preventDefault();
        ST.watchPending = item;
        document.getElementById('WatchSearch').value = item.name;
        listEl.classList.remove('open');
        const prev = document.getElementById('WatchPreview');
        prev.style.display = '';
        document.getElementById('WatchPreviewName').textContent = item.name;
        document.getElementById('WatchPreviewTicker').textContent = item.ticker;
      });
      listEl.appendChild(div);
    });
    listEl.classList.add('open');
  }, 300);
}
function DeleteWatch(ticker) {
  ST.watchlist = ST.watchlist.filter(w => w.ticker !== ticker);
  saveWatchlist();
  RenderWatchlist();
}
function tOnSellAccChange(accId) {
  const type = document.getElementById('tTradeType')?.value;
  if (type === 'sell') tUpdateSellStockOptions();

  const hintEl = document.getElementById('tSellQtyHint');
  if (!hintEl) return;
  if (type !== 'sell') { hintEl.textContent = ''; return; }
  const ticker = document.getElementById('tTradeTicker').value;
  const holding = (ST.holdings || []).find(h => h.ticker === ticker);
  if (!holding || !accId) { hintEl.textContent = ''; return; }
  const qty = holding.accounts?.[accId]?.qty || 0;
  const accName = ST.accounts.find(a => a.id === accId)?.name || accId;
  hintEl.textContent = qty > 0
    ? `${accName} 계좌: 최대 ${Number(qty).toLocaleString('en-US',{maximumFractionDigits:4})}주 보유 중`
    : '';
}
function tToggleHistory() {
  ST.historyOpen = !ST.historyOpen;
  const wrap = document.getElementById('tHistoryWrap');
  const chevron = document.getElementById('tChevron');
  if (wrap) wrap.style.display = ST.historyOpen ? '' : 'none';
  if (chevron) chevron.style.transform = ST.historyOpen ? 'rotate(90deg)' : '';
  if (ST.historyOpen) tRenderTradeHistory();
}
function tSetTradeType(type) {
  document.getElementById('tTradeType').value = type;
  document.getElementById('tTypeBuyBtn').className = 'mt-type-btn' + (type==='buy' ? ' active-buy' : '');
  document.getElementById('tTypeSellBtn').className = 'mt-type-btn' + (type==='sell' ? ' active-sell' : '');
  const sellRow = document.getElementById('tSellStockRow');
  if (sellRow) sellRow.style.display = type === 'sell' ? '' : 'none';
  const hintEl = document.getElementById('tSellQtyHint');
  if (hintEl) hintEl.textContent = '';
  if (type === 'sell') tUpdateSellStockOptions();
}
function tSetType(type) {
  document.getElementById('tBuyBtn').className  = 'trade-type-btn buy'  + (type === 'buy'  ? ' active' : '');
  document.getElementById('tSellBtn').className = 'trade-type-btn sell' + (type === 'sell' ? ' active' : '');
  document.getElementById('tType').value = type;
  document.getElementById('tCashLabel').textContent =
    type === 'buy' ? '거래 후 현금 (감소)' : '거래 후 현금 (증가)';
  tUpdatePreview();
}
function tCloseForm() {
  const multiAcc = ST.accounts.filter(a => a.active !== false).length > 1;
  if (multiAcc) {
    document.getElementById('tQuickForm').style.display = 'none';
    document.getElementById('tQuickAccList').style.display = '';
  } else {
    tCloseTradeModal();
  }
}
function tCloseTradeModal() {
  document.getElementById('tTradeModal').classList.remove('open');
  ST.editingTradeId = null;
}
function tOnNameInput(val) {
  clearTimeout(ST.nameAcTimer);
  const listEl = document.getElementById('tNameAcList');
  if (!val) { if (listEl) listEl.classList.remove('open'); return; }
  ST.nameAcTimer = setTimeout(async () => {
    const items = await tFetchAutocomplete(val);
    if (listEl) tShowAcList(listEl, items, item => {
      document.getElementById('tTradeName').value  = item.name;
      document.getElementById('tTradeTicker').value = item.ticker;
      listEl.classList.remove('open');
    });
  }, 300);
}

function DisplayDerived() {
  try {
    const snap = JSON.parse(localStorage.getItem('mypm_derived_v1') || 'null');
    const mk = snap && snap.data && snap.data[MarketCore.cfg.snapKey];
    if (!mk) return null;
    const localVer = localStorage.getItem('mypm_synced_version');
    if (localVer == null || String(snap.dataVersion) !== String(localVer)) return null;
    return mk;
  } catch (_) { return null; }
}

// ── 공유 Render (히어로/컬럼/라벨은 CFG) ──
function Render() {
  const CFG = MarketCore.cfg;
  const container = document.getElementById('HoldingsContainer');
  const statusEl  = document.getElementById('StatusText');
  if (!container) return;

  if (!ST.holdings.length) {
    const heroEl0 = document.getElementById('HeroContainer');
    if (heroEl0) heroEl0.innerHTML = `<div class="card nk-hero">
      <div class="nk-hero-value-row"><div class="nk-hero-value">${CFG.labels.heroValueZero}</div>${CFG.labels.heroUnit}</div>
      <div class="nk-hero-row"><span>-</span><span class="nk-hero-label">오늘</span></div>
      <div class="nk-hero-row"><span>-</span><span class="nk-hero-label">누적</span></div>
      <div class="nk-hero-row"><span>-</span><span class="nk-hero-label">XIRR</span></div>
    </div>`;
    container.innerHTML = `<div class="empty-state"><div class="icon">${CFG.labels.flag}</div><div>'+ 종목 추가' 버튼을 눌러 ${CFG.labels.marketName}을 추가해 주세요</div></div>
    <div class="nk-action-btns">
      <button class="btn-secondary" onclick="OpenDepositModal()">💰 계좌 입출금</button>
      <button class="btn-primary" onclick="OpenAddModal()">+ 종목 추가</button>
      <button class="btn-secondary" onclick="OpenRecordsModal()">📒 계좌 기록</button>
      <button class="btn-secondary" onclick="OpenDividendModal()">💸 배당 기록</button>
    </div>`;
    if (statusEl) statusEl.textContent = '보유종목 0개';
    RenderAccountButtons();
    return;
  }

  // Summary calculations (active accounts only)
  const _activeAccs = ST.accounts.filter(a => a.active !== false);
  let totalCost = 0, totalValue = 0, todayPnl = 0;
  for (const h of ST.holdings) {
    let hQty = 0, hCost = 0;
    for (const acc of _activeAccs) {
      const a = h.accounts && h.accounts[acc.id];
      if (a && a.qty > 0) {
        hQty += Number(a.qty);
        hCost += Number(a.qty) * Number(a.avgPrice || 0);
      }
    }
    totalCost  += hCost;
    totalValue += hQty * (h.price || 0);
    todayPnl   += hQty * (h.change || 0);
  }
  // add cash (active accounts only)
  const totalCash = _activeAccs.reduce((s, a) => s + (Number(ST.cash[a.id]) || 0), 0);
  totalValue += totalCash;
  const _activeAccIds = _activeAccs.map(a => a.id);
  const deposited  = totalDeposited(null, _activeAccIds);
  const pnl        = totalValue - deposited;
  const pnlRate    = deposited > 0 ? pnl / deposited * 100 : 0;
  const _snap    = DisplayDerived();
  const xirrRate   = (_snap && _snap.totals && typeof _snap.totals.xirr === 'number') ? _snap.totals.xirr : null;
  const xirrSign   = xirrRate != null && xirrRate >= 0 ? '+' : '';
  const xirrCls    = xirrRate != null && xirrRate >= 0 ? 'pos' : 'neg';
  const xirrText   = xirrRate != null ? xirrSign + (xirrRate * 100).toFixed(2) + '%' : '-';

  // 이번달 손익
  const _now = new Date();
  const _yr = _now.getFullYear(), _thisM = _now.getMonth() + 1;
  const prevRecs = ST.monthly.filter(r => r.year < _yr || (r.year === _yr && r.month < _thisM));
  let monthPnl = null, monthPnlRate = null;
  if (prevRecs.length) {
    const prevRec = prevRecs.sort((a, b) => b.year !== a.year ? b.year - a.year : b.month !== a.month ? b.month - a.month : (b.day || 0) - (a.day || 0))[0];
    const prevVal = _activeAccs.reduce((s, a) => s + (Number(prevRec.accounts[a.id]) || 0), 0);
    const cutoff = `${_yr}-${String(_thisM).padStart(2,'0')}-01`;
    const moDeposits = ST.deposits.transactions
      .filter(t => t.date >= cutoff && _activeAccIds.includes(t.accId))
      .reduce((s, t) => s + (t.type === 'withdraw' ? -Number(t.amount) : Number(t.amount)), 0);
    monthPnl = totalValue - prevVal - moDeposits;
    const moBase = prevVal + Math.max(0, moDeposits);
    monthPnlRate = moBase > 0 ? monthPnl / moBase * 100 : null;
  }

  // Hero card
  const tvYest = totalValue - todayPnl;
  const todayRate = tvYest > 0 ? todayPnl / tvYest * 100 : 0;
  const heroDayCls = todayPnl >= 0 ? 'diff-positive' : 'diff-negative';
  const heroDaySign = todayPnl >= 0 ? '+' : '';
  const heroDayRSign = todayRate >= 0 ? '+' : '';
  const heroPnlCls = pnl >= 0 ? 'diff-positive' : 'diff-negative';
  const heroPnlSign = pnl >= 0 ? '+' : '';
  const heroPnlRSign = pnlRate >= 0 ? '+' : '';
  const heroMoCls = monthPnl == null ? '' : monthPnl >= 0 ? 'diff-positive' : 'diff-negative';
  const heroMoSign = monthPnl != null && monthPnl >= 0 ? '+' : '';
  const heroMoRSign = monthPnlRate != null && monthPnlRate >= 0 ? '+' : '';
  const heroXirrCls = (xirrRate == null || xirrRate >= 0) ? 'diff-positive' : 'diff-negative';
  const heroEl = document.getElementById('HeroContainer');
  if (heroEl) heroEl.innerHTML = `<div class="card nk-hero">
    <div class="nk-hero-value-row"><div class="nk-hero-value">${CFG.fmt.hero(totalValue)}</div>${CFG.labels.heroUnit}</div>
    <div class="nk-hero-row ${heroDayCls}"><span>${heroDaySign}${CFG.fmt.hero(todayPnl)} (${heroDayRSign}${todayRate.toFixed(2)}%)</span><span class="nk-hero-label">${fmtHeroAsOf(snapPricedAt()) || '오늘'}</span></div>
    <div class="nk-hero-row ${heroMoCls}"><span>${monthPnl != null ? heroMoSign + CFG.fmt.hero(monthPnl) + ` (${heroMoRSign}${(monthPnlRate||0).toFixed(2)}%)` : '-'}</span><span class="nk-hero-label">${_yr}년 ${_thisM}월</span></div>
    <div class="nk-hero-row ${heroPnlCls}"><span>${deposited > 0 ? heroPnlSign + CFG.fmt.hero(pnl) + ` (${heroPnlRSign}${pnlRate.toFixed(2)}%)` : '-'}<span style="font-size:13px;font-weight:500;opacity:0.8"> · XIRR <span class="${heroXirrCls}">${xirrText}</span></span></span><span class="nk-hero-label">누적</span></div>
  </div>`;

  // Holdings table — My PM style
  const items = ST.holdings.map(h => {
    let qty = 0, cost = 0;
    const hasAccounts = h.accounts && _activeAccs.some(a => (h.accounts[a.id]?.qty || 0) > 0);
    for (const acc of _activeAccs) {
      const a = h.accounts && h.accounts[acc.id];
      if (a && a.qty > 0) { qty += Number(a.qty); cost += Number(a.qty) * Number(a.avgPrice || 0); }
    }
    const avgPrice    = qty > 0 && cost > 0 ? cost / qty : 0;
    const currentValue = qty * (h.price || 0);
    const profit      = cost > 0 ? currentValue - cost : 0;
    const profitRate  = cost > 0 ? profit / cost * 100 : null;
    return {
      ticker: h.ticker, name: h.name || '', qty, cost, avgPrice, hasCost: cost > 0, hasAccounts,
      price: h.price || 0, change: h.change || 0, changeRate: h.changeRate || 0,
      currentValue, profit, profitRate
    };
  }).sort((a, b) => b.currentValue - a.currentValue);

  let lastUpdate = '-';
  if (ST.lastRefreshTime) {
    const _mo = String(ST.lastRefreshTime.getMonth()+1).padStart(2,'0');
    const _dd = String(ST.lastRefreshTime.getDate()).padStart(2,'0');
    const hh = String(ST.lastRefreshTime.getHours()).padStart(2,'0');
    const mm = String(ST.lastRefreshTime.getMinutes()).padStart(2,'0');
    const ss = String(ST.lastRefreshTime.getSeconds()).padStart(2,'0');
    lastUpdate = `${_mo}/${_dd} ${hh}:${mm}:${ss}`;
  } else {
    const updatedAts = ST.holdings.filter(h => h.updatedAt).map(h => h.updatedAt);
    if (updatedAts.length) {
      const d = new Date(Math.max(...updatedAts.map(d => new Date(d))));
      const _mo = String(d.getMonth()+1).padStart(2,'0');
      const _dd = String(d.getDate()).padStart(2,'0');
      lastUpdate = `${_mo}/${_dd} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
    }
  }

  // ===== 종목 리스트: 저장된 컬럼 순서대로 렌더 =====
  const _cashWeight   = totalValue > 0 ? totalCash / totalValue * 100 : 0;
  const _cashAccCount = _activeAccs.filter(a => (Number(ST.cash[a.id]) || 0) > 0).length;
  const _dayCls   = todayPnl > 0 ? 'diff-positive' : (todayPnl < 0 ? 'diff-negative' : '');
  const _totPCls  = pnl >= 0 ? 'diff-positive' : 'diff-negative';
  const _totPSign = pnl >= 0 ? '+' : '';
  const colCtx = { totalCost, totalValue, totalCash, todayPnl, dayCls: _dayCls, deposited, pnl, pnlRate, totPCls: _totPCls, totPSign: _totPSign, cashWeight: _cashWeight };
  const cols = orderedCols(loadColOrder(CFG.colIds), CFG.cols);

  let tableHtml = `<div class="detail-table-wrap"><table class="detail-table">`
    + `<thead><tr><th>종목</th>${cols.map(c => `<th>${c.header}</th>`).join('')}<th></th></tr></thead><tbody>`;

  for (const it of items) {
    it._buyWeight = totalCost > 0 ? it.cost / totalCost * 100 : 0;
    it._curWeight = totalValue > 0 ? it.currentValue / totalValue * 100 : 0;
    it._diff  = it._curWeight - it._buyWeight;
    it._pCls  = it.profit >= 0 ? 'diff-positive' : 'diff-negative';
    it._dCls  = it._diff >= 0 ? 'diff-positive' : 'diff-negative';
    it._pSign = it.profit >= 0 ? '+' : '';
    it._dSign = it._diff >= 0 ? '+' : '';
    it._crCls = it.changeRate > 0 ? 'diff-positive' : (it.changeRate < 0 ? 'diff-negative' : '');
    it._chCls = it.change > 0 ? 'diff-positive' : (it.change < 0 ? 'diff-negative' : '');
    it._dayAmt = it.change * it.qty;
    tableHtml += `<tr>`
      + `<td onclick="tOpenTradeModalForTicker('${it.ticker}','${escapeHtml(it.name)}')" style="cursor:pointer"><div class="stock-name">${escapeHtml(it.name)}${it.hasAccounts ? '<span class="account-dot"></span>' : ''}</div><div class="stock-code">${it.ticker}</div></td>`
      + cols.map(c => `<td ${c.tdAttr ? c.tdAttr(it, colCtx) : ''}>${c.cell(it, colCtx)}</td>`).join('')
      + `<td style="white-space:nowrap"><button class="tbl-trade-btn" onclick="tOpenTradeModalForTicker('${it.ticker}','${escapeHtml(it.name)}')" title="거래">거래</button><button class="tbl-icon-btn" onclick="OpenAccountModal('${it.ticker}')" title="편집">✏️</button><button class="tbl-icon-btn" onclick="DeleteHolding('${it.ticker}')" title="삭제">🗑️</button></td>`
      + `</tr>`;
  }

  // 현금 행
  tableHtml += `<tr class="row-cash">`
    + `<td onclick="OpenCashModal()" class="cash-edit-cell" title="계좌별 현금 입력 (클릭)"><div class="stock-name">${CFG.labels.cashEmoji} 현금 (예수금) <span class="cash-edit-icon">✏️</span>${_cashAccCount ? '<span class="account-dot"></span>' : ''}</div><div class="stock-code">CASH${_cashAccCount ? ' · ' + _cashAccCount + '개 계좌' : ''}</div></td>`
    + cols.map(c => `<td ${c.cashAttr ? c.cashAttr(colCtx) : ''}>${c.cash ? c.cash(colCtx) : '-'}</td>`).join('')
    + `<td></td>`
    + `</tr>`;

  // 합계 행
  tableHtml += `</tbody><tfoot><tr><td>합계</td>`
    + cols.map(c => `<td ${c.footAttr ? c.footAttr(colCtx) : ''}>${c.foot ? c.foot(colCtx) : '-'}</td>`).join('')
    + `<td></td>`
    + `</tr></tfoot></table></div>`;

  container.innerHTML = tableHtml
    + `<div class="nk-action-btns">
      <button class="btn-secondary" onclick="OpenDepositModal()">💰 계좌 입출금</button>
      <button class="btn-primary" onclick="OpenAddModal()">+ 종목 추가</button>
      <button class="btn-secondary" onclick="OpenRecordsModal()">📒 계좌 기록</button>
      <button class="btn-secondary" onclick="OpenDividendModal()">💸 배당 기록</button>
    </div>`;
  if (statusEl) statusEl.textContent = '';
  RenderAccountButtons();
}

// ── 공유: 포맷터만 달랐던 렌더/업데이트 함수 (Phase 7e) ──
function RenderChart() {
  const CFG = MarketCore.cfg;
  const canvas = document.getElementById('PortfolioChart');
  const empty  = document.getElementById('ChartEmpty');
  if (!canvas) return;
  if (!ST.monthly.length) {
    canvas.style.display = 'none';
    if (empty) empty.style.display = '';
    return;
  }
  canvas.style.display = '';
  if (empty) empty.style.display = 'none';

  const sorted = [...ST.monthly].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
  const labels = sorted.map(r => `${r.year}.${String(r.month).padStart(2,'0')}`);
  const _activeForChart = ST.accounts.filter(a => a.active !== false);
  const evalVals = sorted.map(r => _activeForChart.reduce((s, a) => s + (Number(r.accounts[a.id]) || 0), 0));

  // Deposit principal: cumulative deposits up to each month (active accounts only)
  const _activeChartIds = _activeForChart.map(a => a.id);
  const txns = [...ST.deposits.transactions]
    .filter(t => _activeChartIds.includes(t.accId))
    .sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1);
  const depVals = sorted.map(r => {
    const cutoff = `${r.year}-${String(r.month).padStart(2,'0')}-31`;
    return txns.filter(t => (t.date || '') <= cutoff).reduce((s, t) => s + (t.type === 'withdraw' ? -Number(t.amount) : Number(t.amount)), 0);
  });

  if (ST.chartInstance) ST.chartInstance.destroy();
  ST.chartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '누적 입금액', data: depVals, borderColor: '#2e7d32', backgroundColor: 'rgba(46,125,50,0.15)', fill: true, tension: 0.2 },
        { label: '평가총액', data: evalVals, borderColor: '#81c784', backgroundColor: 'rgba(129,199,132,0.15)', fill: true, tension: 0.2 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { y: { ticks: { callback: v => CFG.fmt.money(v) } } } }
  });
}
function UpdateAddTotals() {
  const CFG = MarketCore.cfg;
  ST.accounts.filter(a => a.active !== false).forEach(a => {
    const qty = Number(document.getElementById(`AddQty_${a.id}`)?.value?.replace(/,/g,'')) || 0;
    const avg = Number(document.getElementById(`AddAvg_${a.id}`)?.value?.replace(/,/g,'')) || 0;
    const el = document.getElementById(`AddTotal_${a.id}`);
    if (el) el.textContent = CFG.fmt.money(qty * avg);
  });
}
function UpdateAccTotals() {
  const CFG = MarketCore.cfg;
  let totalQty = 0, totalCost = 0;
  ST.accounts.filter(a => a.active !== false).forEach(a => {
    const qty = Number(document.getElementById(`AccQty_${a.id}`)?.value?.replace(/,/g,'')) || 0;
    const avg = Number(document.getElementById(`AccAvg_${a.id}`)?.value?.replace(/,/g,'')) || 0;
    const el = document.getElementById(`AccTotal_${a.id}`);
    if (el) { el.textContent = CFG.fmt.money(qty * avg); el.classList.toggle('zero', !(qty * avg)); }
    totalQty += qty; totalCost += qty * avg;
  });
  const qEl = document.getElementById('ModalTotalQty');
  const cEl = document.getElementById('ModalTotalCost');
  if (qEl) qEl.textContent = totalQty.toLocaleString() + ' 주';
  if (cEl) cEl.textContent = CFG.fmt.money(totalCost);
}
function RenderDepositList() {
  const CFG = MarketCore.cfg;
  const grand = document.getElementById('DepositGrand');
  const totals = document.getElementById('DepositTotals');
  const list = document.getElementById('DepositList');
  if (!list) return;

  const txns = ST.deposits.transactions;
  const total = txns.reduce((s, t) => s + (t.type === 'withdraw' ? -Number(t.amount) : Number(t.amount)), 0);
  if (grand) grand.innerHTML = `<strong>순 입금액 합계: ${CFG.fmt.money(total)}</strong>`;

  if (totals) {
    totals.innerHTML = ST.accounts.filter(a => a.active !== false).map(a => {
      const v = txns.filter(t => t.accId === a.id).reduce((s, t) => s + (t.type === 'withdraw' ? -Number(t.amount) : Number(t.amount)), 0);
      return `<span>${a.name}: ${CFG.fmt.money(v)}</span>`;
    }).join('');
  }

  if (!txns.length) { list.innerHTML = '<div class="deposit-empty">입출금 내역이 없습니다.</div>'; return; }
  const sorted = [...txns].sort((a, b) => (b.date || '') < (a.date || '') ? -1 : 1);

  // 연도별 그룹핑
  const byYear = new Map();
  sorted.forEach(t => {
    const y = (t.date || '').slice(0, 4) || '미지정';
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(t);
  });
  const years = [...byYear.keys()].sort((a, b) => b.localeCompare(a));
  if (ST.depositCollapsedYears === null) {
    ST.depositCollapsedYears = new Set(years.slice(1));
  }

  list.innerHTML = years.map(y => {
    const ytx = byYear.get(y);
    const yearSum = ytx.reduce((s, t) => s + (t.type === 'withdraw' ? -Number(t.amount) : Number(t.amount)), 0);
    const sumCls = yearSum >= 0 ? 'pos' : 'neg';
    const sumStr = (yearSum >= 0 ? '+' : '−') + CFG.fmt.money(Math.abs(yearSum));
    const collapsed = ST.depositCollapsedYears.has(y);
    const chevron = collapsed ? '▶' : '▼';
    const header = `
      <div class="txn-year-hdr" onclick="ToggleDepositYear('${y}')">
        <span class="yh-chev">${chevron}</span>
        <span class="yh-year">${y}년</span>
        <span class="yh-count">${ytx.length}건</span>
        <span class="yh-sum ${sumCls}">${sumStr}</span>
      </div>`;
    if (collapsed) return header;
    const rows = ytx.map(t => {
      const accName = ST.accounts.find(a => a.id === t.accId)?.name || t.accId;
      const sign = t.type === 'withdraw' ? '-' : '+';
      return `<div class="deposit-row">
        <span>${t.date || '-'}</span>
        <span>${accName}</span>
        <span class="${t.type === 'withdraw' ? 'neg' : 'pos'}">${sign}${CFG.fmt.money(Number(t.amount))}</span>
        <span>
          <button class="edit-btn" onclick="OpenTxnEditor('${t.id}')">편집</button>
          <button class="del-btn" onclick="DeleteTxn('${t.id}')">삭제</button>
        </span>
      </div>`;
    }).join('');
    return header + rows;
  }).join('');
}
function UpdateRecTotal() {
  const CFG = MarketCore.cfg;
  const total = ST.accounts.filter(a => a.active !== false).reduce((s, a) => s + (Number(document.getElementById(`RecVal_${a.id}`)?.value.replace(/,/g,'')) || 0), 0);
  document.getElementById('RecTotal').textContent = CFG.fmt.money(total);
}
function RenderRecordsList() {
  const CFG = MarketCore.cfg;
  const header = document.getElementById('RecordsTableHeader');
  const list   = document.getElementById('RecordsList');
  if (!header || !list) return;
  if (!ST.monthly.length) {
    header.innerHTML = '';
    list.innerHTML = '<div class="records-empty">아직 기록이 없습니다.</div>';
    return;
  }
  const cols = `80px ${ST.accounts.map(() => 'minmax(80px,1fr)').join(' ')} minmax(90px,1fr) 90px`;
  header.style.gridTemplateColumns = cols;
  header.innerHTML = `<span>날짜</span>${ST.accounts.map(a=>`<span style="text-align:right">${a.name}</span>`).join('')}<span style="text-align:right">합계</span><span></span>`;
  const sorted = [...ST.monthly].sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    if (b.month !== a.month) return b.month - a.month;
    return (b.day || 1) - (a.day || 1);
  });
  list.innerHTML = sorted.map(rec => {
    const dateLabel = rec.day
      ? `${rec.year}.${String(rec.month).padStart(2,'0')}.${String(rec.day).padStart(2,'0')}`
      : `${rec.year}.${String(rec.month).padStart(2,'0')}`;
    const total = ST.accounts.reduce((s, a) => s + (Number(rec.accounts[a.id]) || 0), 0);
    const cells = ST.accounts.map(a => `<span class="amount">${CFG.fmt.money(Number(rec.accounts[a.id])||0)}</span>`).join('');
    return `<div class="records-row" style="grid-template-columns:${cols}">
      <span>${dateLabel}</span>
      ${cells}
      <span class="total">${CFG.fmt.money(total)}</span>
      <span>
        <button class="edit-btn" onclick="EditMonthlyRecord('${rec.id}')">편집</button>
        <button class="del-btn" onclick="DeleteMonthlyRecord('${rec.id}')">삭제</button>
      </span>
    </div>`;
  }).join('');
}
function RenderDividendLists() {
  const CFG = MarketCore.cfg;
  // Stock table
  const sHeader = document.getElementById('DivStockTableHeader');
  const sList   = document.getElementById('DivStockRecordsList');
  if (sHeader && sList) {
    if (!ST.dividends.length) {
      sHeader.innerHTML = ''; sList.innerHTML = '<div class="div-empty">아직 배당 기록이 없습니다.</div>';
    } else {
      const allTickers = [...new Set(ST.dividends.flatMap(r => divRecCodes(r)))];
      const cols = `80px ${allTickers.map(() => 'minmax(80px,1fr)').join(' ')} minmax(90px,1fr) 60px`;
      const spanCount = Math.max(allTickers.length, 1);
      sHeader.style.gridTemplateColumns = cols;
      sHeader.innerHTML = `<span>연/월</span>${allTickers.map(t=>`<span style="text-align:right">${t}</span>`).join('')}<span style="text-align:right">합계</span><span></span>`;
      const sorted = [...ST.dividends].sort((a,b) => b.year!==a.year?b.year-a.year:b.month-a.month);
      sList.innerHTML = sorted.map(rec => {
        const dateLabel = `${rec.year}.${String(rec.month).padStart(2,'0')}`;
        if (divRecIsMisc(rec)) {
          const total = divRecMiscTotal(rec);
          const memo = (rec.misc && rec.misc.memo) ? rec.misc.memo : '';
          return `<div class="div-record-row" style="grid-template-columns:${cols}">
            <span class="div-date-link" onclick="EditDividendRecord('${rec.id}')" title="전체 수정">${dateLabel}</span>
            <span style="grid-column: span ${spanCount};color:var(--muted,#888)">📝 ${memo}</span>
            <span class="total">${CFG.fmt.money(total)}</span>
            <span>
              <button class="edit-btn" onclick="EditDividendRecord('${rec.id}')">수정</button>
              <button class="del-btn" onclick="DeleteDividendRecord('${rec.id}')">삭제</button>
            </span>
          </div>`;
        }
        const total = allTickers.reduce((s,t) => s + DivRecAmount(rec, t), 0);
        const cells = allTickers.map(t => {
          const v = DivRecAmount(rec, t);
          if (!v) return `<span class="amount">-</span>`;
          return `<span class="amount div-cell-editable"><span>${CFG.fmt.money(v)}</span><button class="mini-edit-btn" onclick="OpenDivStockEdit('${rec.id}','${t}')">✏️</button></span>`;
        }).join('');
        return `<div class="div-record-row" style="grid-template-columns:${cols}">
          <span class="div-date-link" onclick="EditDividendRecord('${rec.id}')" title="전체 수정">${dateLabel}</span>${cells}
          <span class="total">${CFG.fmt.money(total)}</span>
          <span><button class="del-btn" onclick="DeleteDividendRecord('${rec.id}')">삭제</button></span>
        </div>`;
      }).join('');
    }
  }
  // Account table
  const aHeader = document.getElementById('DivAccTableHeader');
  const aList   = document.getElementById('DivAccRecordsList');
  if (aHeader && aList) {
    if (!ST.dividends.length) {
      aHeader.innerHTML = ''; aList.innerHTML = '<div class="div-empty">아직 배당 기록이 없습니다.</div>';
    } else {
      const cols = `80px ${ST.accounts.map(()=>'minmax(80px,1fr)').join(' ')} minmax(90px,1fr)`;
      aHeader.style.gridTemplateColumns = cols;
      aHeader.innerHTML = `<span>연/월</span>${ST.accounts.map(a=>`<span style="text-align:right">${a.name}</span>`).join('')}<span style="text-align:right">합계</span>`;
      const sorted = [...ST.dividends].sort((a,b) => b.year!==a.year?b.year-a.year:b.month-a.month);
      aList.innerHTML = sorted.map(rec => {
        const total = ST.accounts.reduce((s,a)=>s+(Number(rec.accounts[a.id])||0),0);
        const isMisc = divRecIsMisc(rec);
        const cells = ST.accounts.map(a => {
          const v = Number(rec.accounts[a.id]) || 0;
          if (!v) return `<span class="amount">-</span>`;
          if (isMisc) return `<span class="amount">${CFG.fmt.money(v)}</span>`;
          return `<span class="amount div-cell-editable"><span>${CFG.fmt.money(v)}</span><button class="mini-edit-btn" onclick="OpenDivAccEdit('${rec.id}','${a.id}')">✏️</button></span>`;
        }).join('');
        const miscPrefix = isMisc
          ? `<small title="${(rec.misc.memo||'').replace(/"/g,'&quot;')}" style="color:var(--muted,#888)">📝 </small>`
          : '';
        return `<div class="div-record-row" style="grid-template-columns:${cols}">
          <span class="div-date-link" onclick="EditDividendRecord('${rec.id}')" title="전체 수정">${miscPrefix}${rec.year}.${String(rec.month).padStart(2,'0')}</span>${cells}
          <span class="total">${CFG.fmt.money(total)}</span>
        </div>`;
      }).join('');
    }
  }
}

// ── 공유 (Phase 7f): 계좌버튼/입력포맷 ──
function RenderAccountButtons() {
  const CFG = MarketCore.cfg;
  const grid = document.getElementById('AccountButtonsGrid');
  if (!grid) return;
  const active = ST.accounts.filter(a => a.active !== false);
  grid.innerHTML = active.map(a => {
    const val = computeAccountValue(a.id);
    return `<button class="btn-account-view" onclick="OpenAccountDetail('${a.id}')">💼 ${a.name}<span class="acc-value">${CFG.fmt.acctValue(val)}</span></button>`;
  }).join('');
}
function FmtAccInput(el, dec) { InputUX.formatNumber(el, { mode: 'dec', dec: dec, locale: MarketCore.cfg.locale }); }

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
