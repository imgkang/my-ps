// MyPM 공통 입력 UX 헬퍼 (index.html / NonK.html / KDeal.html 공유)
// 입력 방식 개선을 단계적으로 누적하는 모듈. window.InputUX 네임스페이스.
(function () {
  'use strict';
  const UX = (window.InputUX = window.InputUX || {});

  /* =========================================================================
   * Stage 1 — 탭 시 기존값 자동선택
   * 값이 있는 입력을 탭(포커스)하면 전체 선택되어 바로 덮어쓸 수 있다.
   * 첫 포커스에서만 select() 하므로, 같은 칸을 다시 탭해 커서를 옮기는 동작은 정상.
   * 문서 레벨 위임(focusin) 1개로 처리 → 필드마다 핸들러를 달 필요가 없다.
   * 적용 대상은 selector 로 제어(시범: 온보딩 → 확대: 앱 전체).
   * =======================================================================*/
  let _autoSelSelector = '[data-autoselect]';
  let _lastFocused = null;

  function _autoSelMatches(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (el.disabled || el.readOnly) return false;
    if (el.hasAttribute('data-no-autoselect')) return false;
    // 텍스트성 입력만 select() 가능 (date/checkbox/radio 등 제외)
    const t = (el.type || 'text').toLowerCase();
    if (['checkbox', 'radio', 'date', 'time', 'datetime-local', 'month', 'color', 'range', 'file'].includes(t)) return false;
    if (!el.value) return false; // 빈 칸은 선택할 게 없음
    try { return el.matches(_autoSelSelector); } catch (_) { return false; }
  }

  document.addEventListener('focusin', function (e) {
    const el = e.target;
    if (el === _lastFocused) return; // 같은 칸 재포커스(커서 이동)는 건드리지 않음
    if (!_autoSelMatches(el)) { _lastFocused = null; return; }
    _lastFocused = el;
    // 값 세팅/모바일 키보드 타이밍 이슈를 피하려 다음 틱에 선택
    setTimeout(function () {
      if (document.activeElement === el) {
        try { el.select(); } catch (_) {}
      }
    }, 0);
  });
  document.addEventListener('focusout', function (e) {
    if (e.target === _lastFocused) _lastFocused = null;
  });

  // 자동선택 대상 selector 를 지정(누적이 아니라 교체). 콤마로 여러 개 가능.
  UX.setAutoSelectSelector = function (sel) { _autoSelSelector = sel || '[data-autoselect]'; };
  // 명시적으로 한 칸 전체선택이 필요할 때.
  UX.autoSelect = function (el) { if (el) { try { el.focus(); el.select(); } catch (_) {} } };
})();

/* ===========================================================================
 * Stage 2 — 숫자/금액 콤마 포맷 (세 앱 공통)
 * 세 앱에 중복돼 있던 6개 함수(liveKRWInput/nkLiveInt/kdLiveKRW/obFmtAmt/
 * fmtAccModalInput/nkFmtAccInput/kdFmtAccInput)의 단일 구현. 두 가지 사용법:
 *   1) 직접 호출: InputUX.formatNumber(el,{mode,dec,locale}) — 기존 래퍼들이 위임.
 *   2) 마커 위임(신규/시범 화면용):
 *        <input data-iux-num>                    실시간 정수 콤마(입력 즉시)
 *        <input data-iux-num data-iux-dec="4">   소수 4자리(focus 시 콤마제거, blur 시 포맷)
 *        data-iux-num-locale="en-US"             개별 locale override
 * 빈값/0/NaN → '' (기존 동작 보존). 값만 바꾸므로 기존 input/change·저장 로직과 무관.
 * =========================================================================*/
(function () {
  'use strict';
  const UX = (window.InputUX = window.InputUX || {});
  let _numLocale = 'ko-KR';

  // 앱별 기본 locale 지정(index/KDeal=ko-KR, NonK=en-US). 마커 사용 시 기본값.
  UX.setNumberDefaults = function (opts) { if (opts && opts.locale) _numLocale = opts.locale; };

  // 정수 실시간: 숫자만 남기고 천단위 콤마. 빈값 → ''
  function _fmtInt(el, locale) {
    const d = (el.value || '').replace(/[^\d]/g, '');
    el.value = d ? Number(d).toLocaleString(locale) : '';
  }
  // 소수: parseFloat 후 maximumFractionDigits. 빈값/0/NaN → ''
  function _fmtDec(el, dec, locale) {
    const v = parseFloat((el.value || '').replace(/,/g, ''));
    el.value = (isNaN(v) || !v) ? '' : v.toLocaleString(locale, { maximumFractionDigits: dec });
  }

  // 직접 호출용(기존 래퍼들이 사용). mode:'int'(기본)|'dec'
  UX.formatNumber = function (el, opts) {
    if (!el) return;
    opts = opts || {};
    const locale = opts.locale || _numLocale;
    if (opts.mode === 'dec') _fmtDec(el, opts.dec == null ? 0 : opts.dec, locale);
    else _fmtInt(el, locale);
  };
  // 콤마 제거 후 숫자 파싱(없으면 0).
  UX.readNumber = function (el) {
    const v = parseFloat(((el && el.value) || '0').replace(/,/g, ''));
    return isNaN(v) ? 0 : v;
  };
  // onfocus 콤마 제거 통합.
  UX.stripCommas = function (el) { if (el) el.value = (el.value || '').replace(/,/g, ''); };

  // 입력 중(라이브) 천단위 콤마 — 정수부만 콤마, 소수부(dec 자리)와 타이핑 중 '.' 은 보존.
  // 정수 필드는 dec=0(또는 생략). 소수 필드는 dec=N(예: USD 가격 4, 수수료 2).
  UX.liveFormat = function (el, dec, locale) {
    if (!el) return;
    locale = locale || _numLocale;
    dec = dec || 0;
    const s = (el.value || '').replace(/[^\d.]/g, '');
    if (dec <= 0) { el.value = s ? Number(s.replace(/\./g, '')).toLocaleString(locale) : ''; return; }
    const dot = s.indexOf('.');
    const hadDot = dot !== -1;
    const intPart = hadDot ? s.slice(0, dot) : s;
    const decPart = hadDot ? s.slice(dot + 1).replace(/\./g, '').slice(0, dec) : '';
    const intOut = intPart ? Number(intPart).toLocaleString(locale) : (hadDot ? '0' : '');
    el.value = intOut + (hadDot ? '.' + decPart : '');
  };

  // ----- 마커 기반 이벤트 위임 (data-iux-num) — 동적 input 자동 커버 -----
  const _hasNum = (el) => el && el.hasAttribute && el.hasAttribute('data-iux-num');
  const _isDec = (el) => el.getAttribute('data-iux-dec') != null;
  const _loc = (el) => el.getAttribute('data-iux-num-locale') || _numLocale;
  const _decOf = (el) => _isDec(el) ? (parseInt(el.getAttribute('data-iux-dec'), 10) || 0) : 0;
  document.addEventListener('input', function (e) {           // 정수/소수 모두 입력 즉시 라이브 콤마
    const el = e.target; if (!_hasNum(el)) return;
    UX.liveFormat(el, _decOf(el), _loc(el));
  });
  document.addEventListener('focusout', function (e) {        // 소수: 포커스 아웃 시 자릿수 정규화
    const el = e.target; if (!_hasNum(el) || !_isDec(el)) return;
    _fmtDec(el, _decOf(el), _loc(el));
  });
})();

/* ===========================================================================
 * Stage 3 — 날짜 피커 (휠 + 달력)
 * - 전체 날짜(type=date): 달력 기본 + 휠 토글
 * - 연·월(년/월 number 쌍): 휠(년+월)만
 * - OS 네이티브 피커 대신 커스텀 모달 1개를 재사용. 기존 input 을 그대로 값 보관소로
 *   사용하고(readonly 로 전환) 확정 시 값 기록 + input/change 이벤트를 쏴서 기존 저장 로직과 호환.
 *
 * 적용(마커 속성):
 *   <input type="date" data-iux-date>                       → 달력+휠
 *   <input ... data-iux-ym-month="월input_id">  (년 input)  → 휠(년+월)
 *   <input ... data-iux-ym-year="년input_id">   (월 input)  → 휠(년+월)
 * =========================================================================*/
(function () {
  'use strict';
  const UX = (window.InputUX = window.InputUX || {});
  const pad2 = (n) => String(n).padStart(2, '0');
  const ITEM_H = 40;               // 휠 항목 높이(px) — CSS 와 일치해야 함
  const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m: 1~12

  let _dp = null;   // 모달 루트
  let _st = null;   // 현재 상태

  function parseYMD(v) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec((v || '').trim());
    if (!m) return null;
    return { y: +m[1], m: +m[2], d: +m[3] };
  }
  function todayYMD() { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() }; }

  function ensureDom() {
    if (_dp) return;
    const style = document.createElement('style');
    style.textContent = `
.iux-dp-bd{position:fixed;inset:0;background:rgba(0,0,0,.35);display:none;align-items:center;justify-content:center;z-index:100000;padding:20px}
.iux-dp-bd.open{display:flex}
.iux-dp{background:#fff;border-radius:20px;width:min(360px,92vw);box-shadow:0 12px 40px rgba(0,0,0,.25);overflow:hidden;font-family:inherit;-webkit-tap-highlight-color:transparent}
.iux-dp-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px 6px}
.iux-dp-title{background:none;border:none;display:flex;align-items:center;gap:5px;font-size:20px;font-weight:700;color:#2563eb;cursor:pointer;padding:4px}
.iux-dp-caret{font-size:13px;transition:transform .2s}
.iux-dp.wheel .iux-dp-caret{transform:rotate(180deg)}
.iux-dp-nav{display:flex;gap:6px}
.iux-dp-nav button{width:34px;height:34px;border:none;background:#f1f5f9;border-radius:50%;font-size:18px;cursor:pointer;color:#334155;line-height:1}
.iux-dp.wheel .iux-dp-nav{visibility:hidden}
.iux-dp.ym .iux-dp-title{pointer-events:none}
.iux-dp.ym .iux-dp-caret{display:none}
.iux-dp.ym .iux-dp-nav{display:none}
.iux-dp-cal{padding:6px 16px 10px}
.iux-dp.wheel .iux-dp-cal{display:none}
.iux-dp-dow{display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:4px}
.iux-dp-dow span{text-align:center;font-size:12px;color:#94a3b8;padding:4px 0}
.iux-dp-dow span:first-child{color:#ef4444}
.iux-dp-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.iux-dp-grid button{aspect-ratio:1;border:none;background:none;border-radius:50%;font-size:15px;cursor:pointer;color:#1e293b;padding:0}
.iux-dp-grid button:disabled{visibility:hidden}
.iux-dp-grid button.today{font-weight:700;color:#2563eb}
.iux-dp-grid button.sel{background:#2563eb;color:#fff;font-weight:700}
.iux-dp-wheel{display:none;position:relative;padding:8px 16px;gap:8px}
.iux-dp.wheel .iux-dp-wheel{display:flex}
.iux-dp-col{flex:1;height:${ITEM_H * 5}px;overflow-y:scroll;scroll-snap-type:y mandatory;text-align:center;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:${ITEM_H * 2}px 0}
.iux-dp-col::-webkit-scrollbar{display:none}
.iux-dp-col div{height:${ITEM_H}px;line-height:${ITEM_H}px;scroll-snap-align:center;font-size:18px;color:#94a3b8;cursor:pointer}
.iux-dp-col div.on{color:#0f172a;font-weight:700;font-size:21px}
.iux-dp-band{position:absolute;left:16px;right:16px;top:50%;height:${ITEM_H}px;transform:translateY(-50%);background:rgba(100,116,139,.10);border-radius:10px;pointer-events:none}
.iux-dp-foot{display:flex;align-items:center;justify-content:space-between;padding:8px 18px 16px}
.iux-dp-reset{border:none;background:#f1f5f9;color:#334155;border-radius:18px;padding:10px 20px;font-size:15px;font-weight:600;cursor:pointer}
.iux-dp-ok{border:none;background:#2563eb;color:#fff;width:46px;height:46px;border-radius:50%;font-size:22px;cursor:pointer;line-height:1}
`;
    document.head.appendChild(style);

    _dp = document.createElement('div');
    _dp.className = 'iux-dp-bd';
    _dp.innerHTML =
      '<div class="iux-dp" role="dialog" aria-modal="true">' +
        '<div class="iux-dp-head">' +
          '<button type="button" class="iux-dp-title" data-act="toggle"><span class="iux-dp-tt"></span><span class="iux-dp-caret">▾</span></button>' +
          '<div class="iux-dp-nav"><button type="button" data-act="prev" aria-label="이전 달">‹</button><button type="button" data-act="next" aria-label="다음 달">›</button></div>' +
        '</div>' +
        '<div class="iux-dp-cal"></div>' +
        '<div class="iux-dp-wheel"></div>' +
        '<div class="iux-dp-foot"><button type="button" class="iux-dp-reset" data-act="reset">재설정</button><button type="button" class="iux-dp-ok" data-act="confirm">✓</button></div>' +
      '</div>';
    document.body.appendChild(_dp);
    _dp.addEventListener('click', onDpClick);
  }

  function updateTitle() {
    const y = _st.view === 'cal' ? _st.calY : _st.y;
    const m = _st.view === 'cal' ? _st.calM : _st.m;
    _dp.querySelector('.iux-dp-tt').textContent = `${y}년 ${m}월`;
  }

  /* ----- 휠 ----- */
  function buildCol(values, selIndex, onChange) {
    const col = document.createElement('div');
    col.className = 'iux-dp-col';
    values.forEach((v, i) => { const d = document.createElement('div'); d.textContent = v.label; d.dataset.i = i; col.appendChild(d); });
    const mark = (idx) => col.querySelectorAll('div[data-i]').forEach((d) => d.classList.toggle('on', +d.dataset.i === idx));
    requestAnimationFrame(() => { col.scrollTop = selIndex * ITEM_H; mark(selIndex); });
    let t = null;
    col.addEventListener('scroll', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (!_st) return;   // 피커가 닫힌 뒤(예: commit) 늦게 도착한 스냅 타이머 무시 — _st null 가드
        let idx = Math.round(col.scrollTop / ITEM_H);
        idx = Math.max(0, Math.min(values.length - 1, idx));
        if (col.scrollTop !== idx * ITEM_H) col.scrollTop = idx * ITEM_H;
        mark(idx); onChange(idx);
      }, 110);
    });
    col.addEventListener('click', (e) => {
      const d = e.target.closest('div[data-i]'); if (!d) return;
      if (!_st) return;
      const idx = +d.dataset.i; col.scrollTop = idx * ITEM_H; mark(idx); onChange(idx);
    });
    col._mark = mark;
    return col;
  }

  function renderWheel() {
    const wheel = _dp.querySelector('.iux-dp-wheel');
    wheel.innerHTML = '';
    const band = document.createElement('div'); band.className = 'iux-dp-band'; wheel.appendChild(band);

    const years = []; for (let y = _st.minY; y <= _st.maxY; y++) years.push({ label: y + '년', val: y });
    const months = []; for (let mo = 1; mo <= 12; mo++) months.push({ label: mo + '월', val: mo });

    const yCol = buildCol(years, _st.y - _st.minY, (i) => {
      _st.y = years[i].val; clampDay();
      if (_st.mode === 'date') rebuildDayCol(wheel);
      updateTitle();
    });
    const mCol = buildCol(months, _st.m - 1, (i) => {
      _st.m = months[i].val; clampDay();
      if (_st.mode === 'date') rebuildDayCol(wheel);
      updateTitle();
    });
    wheel.appendChild(yCol); wheel.appendChild(mCol);
    if (_st.mode === 'date') wheel.appendChild(buildDayCol());
  }

  function buildDayCol() {
    const dim = daysInMonth(_st.y, _st.m);
    const days = []; for (let d = 1; d <= dim; d++) days.push({ label: d + '일', val: d });
    if (_st.d > dim) _st.d = dim;
    const col = buildCol(days, _st.d - 1, (i) => { _st.d = days[i].val; });
    col.classList.add('iux-dp-daycol');
    return col;
  }
  function rebuildDayCol(wheel) {
    const old = wheel.querySelector('.iux-dp-daycol');
    if (old) { const fresh = buildDayCol(); old.replaceWith(fresh); }
  }
  function clampDay() { const dim = daysInMonth(_st.y, _st.m); if (_st.d > dim) _st.d = dim; }

  /* ----- 달력 ----- */
  function renderCal() {
    const cal = _dp.querySelector('.iux-dp-cal');
    cal.innerHTML = '';
    const dow = document.createElement('div'); dow.className = 'iux-dp-dow';
    ['일', '월', '화', '수', '목', '금', '토'].forEach((s) => { const sp = document.createElement('span'); sp.textContent = s; dow.appendChild(sp); });
    cal.appendChild(dow);
    const grid = document.createElement('div'); grid.className = 'iux-dp-grid';
    const first = new Date(_st.calY, _st.calM - 1, 1).getDay();
    const dim = daysInMonth(_st.calY, _st.calM);
    const t = todayYMD();
    for (let i = 0; i < first; i++) { const b = document.createElement('button'); b.disabled = true; grid.appendChild(b); }
    for (let d = 1; d <= dim; d++) {
      const b = document.createElement('button'); b.textContent = d; b.dataset.d = d;
      if (t.y === _st.calY && t.m === _st.calM && t.d === d) b.classList.add('today');
      if (_st.y === _st.calY && _st.m === _st.calM && _st.d === d) b.classList.add('sel');
      grid.appendChild(b);
    }
    grid.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-d]'); if (!b) return;
      _st.y = _st.calY; _st.m = _st.calM; _st.d = +b.dataset.d;
      renderCal(); updateTitle();
    });
    cal.appendChild(grid);
  }

  function setView(v) {
    _st.view = v;
    _dp.querySelector('.iux-dp').classList.toggle('wheel', v === 'wheel');
    if (v === 'wheel') renderWheel(); else renderCal();
    updateTitle();
  }

  function onDpClick(e) {
    if (e.target === _dp) { close(); return; } // 배경 탭 = 취소
    const act = e.target.closest('[data-act]') ? e.target.closest('[data-act]').dataset.act : null;
    if (!act) return;
    if (act === 'toggle') { if (_st.mode === 'date') setView(_st.view === 'cal' ? 'wheel' : 'cal'); }
    else if (act === 'prev') { _st.calM--; if (_st.calM < 1) { _st.calM = 12; _st.calY--; } renderCal(); updateTitle(); }
    else if (act === 'next') { _st.calM++; if (_st.calM > 12) { _st.calM = 1; _st.calY++; } renderCal(); updateTitle(); }
    else if (act === 'reset') { const t = todayYMD(); _st.y = t.y; _st.m = t.m; _st.d = t.d; _st.calY = t.y; _st.calM = t.m; setView(_st.view); }
    else if (act === 'confirm') { commit(); }
  }

  function fire(el) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  function commit() {
    const tg = _st.target;
    if (tg.type === 'date') { tg.input.value = `${_st.y}-${pad2(_st.m)}-${pad2(_st.d)}`; fire(tg.input); }
    else { tg.yearEl.value = _st.y; tg.monthEl.value = _st.m; fire(tg.yearEl); fire(tg.monthEl); }
    close();
  }
  function close() { if (_dp) _dp.classList.remove('open'); _st = null; }

  function openCommon(mode) {
    ensureDom();
    _dp.querySelector('.iux-dp').classList.toggle('ym', mode === 'ym');
    setView(mode === 'ym' ? 'wheel' : 'cal');
    _dp.classList.add('open');
  }

  // 공개 API ----------------------------------------------------------------
  UX.openDateFor = function (input) {
    const cur = parseYMD(input.value) || todayYMD();
    const maxY = new Date().getFullYear() + 10;
    _st = { mode: 'date', y: cur.y, m: cur.m, d: cur.d, calY: cur.y, calM: cur.m, view: 'cal',
            minY: 1990, maxY: Math.max(maxY, cur.y), target: { type: 'date', input } };
    openCommon('date');
  };
  UX.openYMFor = function (yearEl, monthEl) {
    const y = parseInt(yearEl.value, 10) || new Date().getFullYear();
    const m = Math.min(12, Math.max(1, parseInt(monthEl.value, 10) || 1));
    _st = { mode: 'ym', y, m, d: 1, calY: y, calM: m, view: 'wheel',
            minY: 1940, maxY: 2100, target: { type: 'ym', yearEl, monthEl } };
    openCommon('ym');
  };

  // 마커가 붙은 입력을 커스텀 전용으로 전환(네이티브 피커/키보드 차단) ----------------
  // ※ iOS Safari 는 readonly 로 type=date/number 네이티브 피커를 막지 못한다(탭하면 애플 달력이
  //   먼저 떴다가 커스텀으로 바뀌는 깜빡임 발생). 그래서 type 자체를 text 로 바꿔 네이티브 UI 를
  //   원천 제거한다. 값은 문자열(YYYY-MM-DD / 숫자) 그대로 보존되어 기존 read/save 로직과 무관.
  function scanDateInputs(root) {
    (root || document).querySelectorAll('input[data-iux-date],input[data-iux-ym-month],input[data-iux-ym-year]').forEach((el) => {
      if (el._iuxRO) return;
      el._iuxRO = true;
      try { if (el.type !== 'text') el.type = 'text'; } catch (_) {}
      el.readOnly = true;
      el.setAttribute('inputmode', 'none');   // 소프트 키보드 차단
      el.setAttribute('autocomplete', 'off');
      el.style.cursor = 'pointer';
    });
  }
  UX.scanDateInputs = scanDateInputs;

  function isDateMarker(el) {
    return !!el && (el.hasAttribute('data-iux-date') || el.hasAttribute('data-iux-ym-month') || el.hasAttribute('data-iux-ym-year'));
  }

  // 포커스로 인한 깜빡임 차단 ----------------------------------------------------
  // ※ readonly 입력이라도 탭하면 포커스를 받는다. iOS Safari 는 포커스된 입력을 화면 중앙으로
  //   스크롤해 올렸다가, 곧이은 blur 로 다시 원위치로 스크롤한다(스크롤 인→아웃). 반투명 배경
  //   뒤로 이 왕복이 비쳐 "약간의 깜빡임"으로 보였다. mousedown 단계에서 preventDefault 하면
  //   포커스 자체가 발생하지 않아 스크롤 왕복이 사라진다(클릭 이벤트는 그대로 발생 → 피커 정상 오픈).
  document.addEventListener('mousedown', function (e) {
    const el = e.target.closest && e.target.closest('input');
    if (isDateMarker(el)) e.preventDefault();
  }, true);

  // 탭하면 커스텀 피커 열기 (이벤트 위임)
  document.addEventListener('click', function (e) {
    const el = e.target.closest && e.target.closest('input');
    if (!el) return;
    if (el.hasAttribute('data-iux-date')) { e.preventDefault(); el.blur(); UX.openDateFor(el); }
    else if (el.hasAttribute('data-iux-ym-month')) { e.preventDefault(); el.blur(); const mEl = document.getElementById(el.getAttribute('data-iux-ym-month')); if (mEl) UX.openYMFor(el, mEl); }
    else if (el.hasAttribute('data-iux-ym-year')) { e.preventDefault(); el.blur(); const yEl = document.getElementById(el.getAttribute('data-iux-ym-year')); if (yEl) UX.openYMFor(yEl, el); }
  }, true);

  // 초기/동적 추가 입력 모두 readonly 처리
  function init() {
    scanDateInputs(document);
    try {
      new MutationObserver((muts) => {
        for (const mu of muts) for (const n of mu.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.matches && n.matches('input[data-iux-date],input[data-iux-ym-month],input[data-iux-ym-year]')) scanDateInputs(n.parentNode || document);
          else if (n.querySelector) scanDateInputs(n);
        }
      }).observe(document.body, { childList: true, subtree: true });
    } catch (_) {}
  }
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
})();
