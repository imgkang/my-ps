/* my-ps ticker master DB & client-side search.
 *
 * Loads tickers.json (≈11,000 KR/US items) once per day, persists to IndexedDB
 * for offline boot, keeps the active array in memory for sub-10ms search.
 *
 * Global API (window.TickerSearch):
 *   init({url})            - kick off load (idempotent, safe to call repeatedly)
 *   ready()                - Promise that resolves when items are in memory
 *   isReady()              - sync boolean
 *   search(q, opts)        - { country?: 'KR'|'US', limit?: number } → [item]
 *   getKoreanName(code)    - reverse lookup, '' if not found
 *   getEnglishName(ticker) - reverse lookup, '' if not found
 *   count()                - number of loaded items
 *
 * Item shape: { t: ticker, n: english_name, k: korean_name?,
 *               e: exchange, c: 'KR'|'US'|..., y: 'EQ'|'ETF'|'IDX'|... }
 */
(function (global) {
  'use strict';

  const DB_NAME = 'my-ps-tickers';
  const DB_VERSION = 1;
  const STORE_ITEMS = 'items';
  const STORE_META = 'meta';
  const STALE_MS = 24 * 60 * 60 * 1000; // 24h

  let _items = [];
  let _byTicker = new Map();
  let _ready = false;
  let _readyPromise = null;
  let _started = false;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_ITEMS)) {
          db.createObjectStore(STORE_ITEMS, { autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function dbGet(db, store, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function dbGetAll(db, store) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function dbReplaceAll(db, items, meta) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_ITEMS, STORE_META], 'readwrite');
      const items_ = tx.objectStore(STORE_ITEMS);
      const meta_ = tx.objectStore(STORE_META);
      items_.clear();
      for (const it of items) items_.add(it);
      meta_.put(meta, 'info');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  function activate(items) {
    _items = items || [];
    _byTicker = new Map();
    for (const it of _items) {
      if (!it || !it.t) continue;
      _byTicker.set(`${it.c || ''}:${it.t}`, it);
    }
    _ready = true;
  }

  async function fetchRemote(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error('tickers.json HTTP ' + r.status);
    const data = await r.json();
    if (!data || !Array.isArray(data.items)) {
      throw new Error('tickers.json malformed');
    }
    return data;
  }

  async function loadFlow(url) {
    let db = null;
    try {
      db = await openDB();
    } catch (e) {
      // IndexedDB unavailable (private mode, etc.) — go network-only.
      try {
        const data = await fetchRemote(url);
        activate(data.items);
      } catch (_) {
        activate([]);
      }
      return;
    }

    let meta = null;
    let cachedItems = [];
    try {
      meta = await dbGet(db, STORE_META, 'info');
      cachedItems = await dbGetAll(db, STORE_ITEMS);
    } catch (_) {}

    const cachedAt = meta && meta.cached_at ? meta.cached_at : 0;
    const isStale = !cachedAt || (Date.now() - cachedAt) > STALE_MS;

    // If we have cache, activate immediately for instant search.
    if (cachedItems.length) activate(cachedItems);

    // Background refresh if stale or no cache.
    if (isStale || !cachedItems.length) {
      try {
        const data = await fetchRemote(url);
        const newMeta = {
          version: data.version,
          updated_at: data.updated_at,
          count: data.count,
          cached_at: Date.now(),
        };
        await dbReplaceAll(db, data.items, newMeta);
        activate(data.items);
      } catch (e) {
        // Keep cached items active. If nothing cached either, _items stays empty.
        if (!cachedItems.length) activate([]);
      }
    }
  }

  function resolveURL(opts) {
    if (opts && opts.url) return opts.url;
    try {
      return new URL('tickers.json', document.baseURI).href;
    } catch (_) {
      return 'tickers.json';
    }
  }

  function init(opts) {
    if (_started) return _readyPromise;
    _started = true;
    const url = resolveURL(opts);
    _readyPromise = loadFlow(url).catch(() => { activate([]); });
    return _readyPromise;
  }

  function search(query, opts) {
    if (!_ready || !query) return [];
    const q = String(query).trim();
    if (!q) return [];
    const ql = q.toLowerCase();
    const country = opts && opts.country;
    const limit = (opts && opts.limit) || 10;

    const exact = [], tickerPrefix = [], namePrefix = [], substring = [];
    for (const it of _items) {
      if (country && it.c !== country) continue;
      const t = (it.t || '').toLowerCase();
      const n = (it.n || '').toLowerCase();
      // 한글명(k)에도 영문 브랜드(SOL/KODEX/TIGER 등)가 섞여 있으므로
      // 소문자로 통일 비교 — 한글은 대소문자 개념이 없어 부작용 없음.
      const k = (it.k || '').toLowerCase();
      if (t === ql) {
        exact.push(it);
      } else if (t.startsWith(ql)) {
        tickerPrefix.push(it);
      } else if (n.startsWith(ql) || (k && k.startsWith(ql))) {
        namePrefix.push(it);
      } else if (n.includes(ql) || (k && k.indexOf(ql) >= 0)) {
        substring.push(it);
      }
      if (exact.length + tickerPrefix.length >= limit * 2 &&
          exact.length + tickerPrefix.length + namePrefix.length + substring.length >= limit * 4) {
        break;
      }
    }
    return exact
      .concat(tickerPrefix, namePrefix, substring)
      .slice(0, limit);
  }

  function getKoreanName(code) {
    const it = _byTicker.get('KR:' + code);
    return (it && it.k) || '';
  }

  function getEnglishName(ticker) {
    const it = _byTicker.get('US:' + ticker);
    return (it && it.n) || '';
  }

  global.TickerSearch = {
    init,
    ready: () => _readyPromise || Promise.resolve(),
    isReady: () => _ready,
    search,
    getKoreanName,
    getEnglishName,
    count: () => _items.length,
  };
})(typeof window !== 'undefined' ? window : globalThis);
