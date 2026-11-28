/* 가족여행 앱 「여기로 집합」 — 서버가 앱 화면에 끼워 넣는 스크립트(비공개 index.html 수정 없이 동작).
 * - 장소 탭 맨 위: 진행 중인 집합 요청을 강조 카드(지도·길찾기·완료/취소)로, 없으면 「지금 내 위치로 집합 요청」 버튼
 * - 진행 중이면 장소 탭 버튼에 빨간 점
 * - 서버 API: api/rally (조회 15초마다), POST api/rally, POST api/rally/:id/done|cancel
 * 개인정보·비밀값 없음(로그인 쿠키로 API 호출만 함). */
(function () {
  'use strict';
  if (window.__rallyLoaded) return; window.__rallyLoaded = true;
  var API = (window.TRIP_CONFIG && window.TRIP_CONFIG.apiBase) || 'api';
  var me = null, active = null, timer = null, busy = false, lastSig = '';

  var css = document.createElement('style');
  css.textContent = [
    '.rl-box{display:flex;flex-direction:column;gap:10px}',
    '.rl-ask{display:flex;align-items:center;gap:10px;background:var(--surface,#fff);border:1px dashed var(--accent,#0f6b4f);border-radius:12px;padding:10px 12px}',
    '.rl-ask p{margin:0;flex:1;font-size:13px;color:var(--muted,#5b6f6b)}',
    '.rl-on{background:var(--gold-soft,#fbf1d6);border:2px solid var(--gold,#e3a91b);border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;box-shadow:0 0 0 4px color-mix(in srgb,var(--gold,#e3a91b) 18%,transparent)}',
    '.rl-hd{display:flex;align-items:center;gap:8px;font-family:var(--font-display,serif);font-size:19px;color:var(--ink,#15302b)}',
    '.rl-dot{width:10px;height:10px;border-radius:50%;background:#e5484d;box-shadow:0 0 0 0 rgba(229,72,77,.6);animation:rlp 1.6s infinite;flex:none}',
    '@keyframes rlp{0%{box-shadow:0 0 0 0 rgba(229,72,77,.55)}70%{box-shadow:0 0 0 10px rgba(229,72,77,0)}100%{box-shadow:0 0 0 0 rgba(229,72,77,0)}}',
    '@media (prefers-reduced-motion: reduce){.rl-dot{animation:none}}',
    '.rl-meta{font-size:14px;color:var(--ink,#15302b)}.rl-meta b{font-size:16px}.rl-sub{font-size:12px;color:var(--muted,#5b6f6b)}',
    '.rl-map{width:100%;height:190px;border:0;border-radius:10px;background:var(--bg,#eef3f2)}',
    '.rl-row{display:flex;gap:6px;flex-wrap:wrap}',
    '.rl-btn{border:1px solid var(--line,#d9e2e0);background:var(--surface,#fff);color:var(--ink,#15302b);border-radius:999px;padding:7px 13px;font:inherit;font-size:13px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;gap:4px;cursor:pointer}',
    '.rl-btn.go{background:var(--accent,#0f6b4f);border-color:var(--accent,#0f6b4f);color:var(--accent-ink,#fff)}',
    '.rl-btn.warn{color:#b42318}',
    '.rl-btn:disabled{opacity:.5}',
    '.rl-badge{position:relative}.rl-badge::after{content:"";position:absolute;top:6px;right:calc(50% - 18px);width:9px;height:9px;border-radius:50%;background:#e5484d;border:2px solid var(--surface,#fff)}',
    '.rl-sheet-bg{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center;z-index:40}',
    '.rl-sheet{background:var(--surface,#fff);color:var(--ink,#15302b);width:100%;max-width:520px;border-radius:16px 16px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:10px;max-height:90%;overflow-y:auto}',
    '.rl-sheet h3{margin:0;font-family:var(--font-display,serif);font-size:18px}',
    '.rl-f{display:flex;flex-direction:column;gap:3px}.rl-f label{font-size:12px;color:var(--muted,#5b6f6b)}',
    '.rl-f input{border:1px solid var(--line,#d9e2e0);border-radius:8px;padding:9px 10px;background:var(--bg,#f3f6f6);color:var(--ink,#15302b);font:inherit}',
    '.rl-toast{position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom));transform:translateX(-50%);background:#111827;color:#fff;border-radius:20px;padding:9px 16px;z-index:50;max-width:90%;width:max-content;font-size:14px}'
  ].join('');
  document.head.appendChild(css);

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function toast(t, ms) { var n = el('div', 'rl-toast', t); n.setAttribute('role', 'status'); document.body.appendChild(n); setTimeout(function () { n.remove(); }, ms || 2600); }
  function req(path, opts) {
    opts = opts || {};
    var h = { 'Accept': 'application/json' }; if (opts.body) h['Content-Type'] = 'application/json';
    return fetch(API + path, { method: opts.method || 'GET', credentials: 'same-origin', headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; } return j; }); });
  }
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var mapsQ = function (a) { return a.lat.toFixed(6) + ',' + a.lng.toFixed(6); };
  var embed = function (lat, lng) { return 'https://maps.google.com/maps?q=' + lat.toFixed(6) + ',' + lng.toFixed(6) + '&z=17&output=embed'; };
  function ago(ms) { var m = Math.max(0, Math.round((Date.now() - ms) / 60000)); return m < 1 ? '방금' : m < 60 ? m + '분 전' : Math.floor(m / 60) + '시간 ' + (m % 60) + '분 전'; }
  function nick() { try { return localStorage.getItem('syd27-nick') || ''; } catch (_) { return ''; } }

  function host() {
    var v = document.getElementById('v-places') || document.querySelector('section[aria-label="장소"],section[aria-label="집합장소"]') || document.getElementById('main');
    if (!v) return null;
    var b = document.getElementById('rl-box');
    if (!b) { b = el('div', 'rl-box'); b.id = 'rl-box'; v.insertBefore(b, v.firstChild); }
    return b;
  }
  function placesTab() { return document.querySelector('nav.tabs button[data-v="places"]'); }

  function render() {
    var box = host(); if (!box) return;
    var sig = JSON.stringify(active) + '|' + (me && me.id);
    if (sig === lastSig && box.childNodes.length) { var a0 = box.querySelector('.rl-ago'); if (a0 && active) a0.textContent = ago(active.createdAt); return; }
    lastSig = sig; box.textContent = '';
    var tab = placesTab(); if (tab) tab.classList.toggle('rl-badge', !!active);
    if (!active) {
      var ask = el('div', 'rl-ask');
      ask.appendChild(el('p', '', '일행과 흩어졌나요? 지금 내 위치를 집합 장소로 알릴 수 있어요.'));
      var go = el('button', 'rl-btn go', '📍 여기로 집합'); go.type = 'button'; go.onclick = openSheet; ask.appendChild(go);
      box.appendChild(ask); return;
    }
    var a = active, card = el('div', 'rl-on'); card.setAttribute('role', 'alert');
    var hd = el('div', 'rl-hd'); hd.appendChild(el('span', 'rl-dot')); hd.appendChild(el('span', '', '여기로 집합')); card.appendChild(hd);
    var meta = el('div', 'rl-meta');
    if (a.tm) { meta.appendChild(el('b', '', a.tm + '까지')); meta.appendChild(document.createTextNode(' ')); }
    meta.appendChild(document.createTextNode(a.memo || '요청한 사람의 현재 위치'));
    card.appendChild(meta);
    var sub = el('div', 'rl-sub'); sub.appendChild(document.createTextNode(a.byName + '님 요청 · ')); sub.appendChild(el('span', 'rl-ago', ago(a.createdAt)));
    if (a.acc) sub.appendChild(document.createTextNode(' · 위치 오차 약 ' + a.acc + 'm')); card.appendChild(sub);
    var fr = el('iframe', 'rl-map'); fr.src = embed(a.lat, a.lng); fr.loading = 'lazy'; fr.title = '집합 위치 지도'; fr.referrerPolicy = 'no-referrer-when-downgrade'; card.appendChild(fr);
    var row = el('div', 'rl-row');
    var m = el('a', 'rl-btn', '📍 구글지도'); m.href = 'https://www.google.com/maps/search/?api=1&query=' + mapsQ(a); m.target = '_blank'; m.rel = 'noopener'; row.appendChild(m);
    var d = el('a', 'rl-btn go', '↗ 길찾기(도보)'); d.href = 'https://www.google.com/maps/dir/?api=1&destination=' + mapsQ(a) + '&travelmode=walking'; d.target = '_blank'; d.rel = 'noopener'; row.appendChild(d);
    var mine = me && (String(me.id) === String(a.byUid) || me.isOwner);
    if (mine) {
      var ok = el('button', 'rl-btn', '✅ 집합 완료'); ok.type = 'button'; ok.onclick = function () { finish('done'); }; row.appendChild(ok);
      var cx = el('button', 'rl-btn warn', '취소'); cx.type = 'button'; cx.onclick = function () { finish('cancel'); }; row.appendChild(cx);
    }
    card.appendChild(row);
    if (mine) card.appendChild(el('div', 'rl-sub', '「집합 완료」를 누르면 이 표시는 사라지고, 일정에 「여기서 집합」(시간·메모·위치)이 자동으로 기록돼요.'));
    box.appendChild(card);
  }

  function load() {
    return req('/rally').then(function (j) { active = j.active || null; render(); }).catch(function (e) { if (e.status === 401) stop(); });
  }
  function stop() { clearTimeout(timer); timer = null; }
  function loop() { stop(); timer = setTimeout(function () { load().then(loop, loop); }, document.hidden ? 60000 : 15000); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { load(); loop(); } });

  function finish(kind) {
    if (!active || busy) return;
    var q = kind === 'done' ? '집합 완료로 표시할까요?\n이 표시는 사라지고 일정에 「여기서 집합」이 기록돼요.' : '집합 요청을 취소할까요? (일정에는 기록하지 않아요)';
    if (!confirm(q)) return;
    busy = true;
    req('/rally/' + encodeURIComponent(active.id) + '/' + kind, { method: 'POST' }).then(function (j) {
      active = j.active || null; lastSig = ''; render();
      if (kind === 'cancel') { toast('집합 요청을 취소했어요'); return; }
      var s = j.schedule || {};
      if (s.itemId) { toast('집합 완료 · 일정에 「여기서 집합」을 기록했어요', 2200); setTimeout(function () { location.reload(); }, 1600); }
      else toast('집합 완료 · ' + (s.skipped || '일정 기록은 건너뛰었어요'), 4500);
    }).catch(function (e) { toast(e.message || '처리하지 못했어요'); load(); }).then(function () { busy = false; });
  }

  function openSheet() {
    if (!navigator.geolocation) { toast('이 기기에서는 위치를 쓸 수 없어요'); return; }
    var bg = el('div', 'rl-sheet-bg'), sh = el('div', 'rl-sheet'); bg.appendChild(sh);
    bg.addEventListener('click', function (e) { if (e.target === bg) bg.remove(); });
    sh.appendChild(el('h3', '', '📍 여기로 집합'));
    var st = el('div', 'rl-sub', '현재 위치를 찾는 중…'); sh.appendChild(st);
    var fr = el('iframe', 'rl-map'); fr.title = '내 위치 지도'; fr.hidden = true; sh.appendChild(fr);
    var now = new Date(Date.now() + 15 * 60000); now.setMinutes(Math.ceil(now.getMinutes() / 5) * 5, 0, 0);
    var f1 = el('div', 'rl-f'), l1 = el('label', '', '집합 시각 (비우면 「지금」)'), tm = el('input'); tm.type = 'time'; tm.value = pad(now.getHours()) + ':' + pad(now.getMinutes()); l1.htmlFor = tm.id = 'rl-tm'; f1.appendChild(l1); f1.appendChild(tm); sh.appendChild(f1);
    var f2 = el('div', 'rl-f'), l2 = el('label', '', '메모 (어디서·무엇 앞에서)'), memo = el('input'); memo.maxLength = 80; memo.placeholder = '예: 서큘러 키 스타벅스 앞'; l2.htmlFor = memo.id = 'rl-memo'; f2.appendChild(l2); f2.appendChild(memo); sh.appendChild(f2);
    var row = el('div', 'rl-row'), send = el('button', 'rl-btn go', '이 위치로 집합 알리기'), no = el('button', 'rl-btn', '닫기');
    send.type = no.type = 'button'; send.disabled = true; no.onclick = function () { bg.remove(); };
    row.appendChild(send); row.appendChild(no); sh.appendChild(row);
    if (active) sh.appendChild(el('div', 'rl-sub', '지금 진행 중인 집합 요청은 새 요청으로 바뀌어요.'));
    document.body.appendChild(bg);
    var pos = null;
    navigator.geolocation.getCurrentPosition(function (p) {
      pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0) };
      st.textContent = '현재 위치 (오차 약 ' + pos.acc + 'm) — 이 위치를 모두에게 알려요.';
      fr.src = embed(pos.lat, pos.lng); fr.hidden = false; send.disabled = false;
    }, function (err) {
      st.textContent = err && err.code === 1 ? '위치 권한이 꺼져 있어요. 휴대폰 설정에서 이 브라우저(또는 앱)의 위치 권한을 허용해 주세요.' : '현재 위치를 찾지 못했어요. 잠시 후 다시 시도해 주세요.';
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    send.onclick = function () {
      if (!pos || busy) return; busy = true; send.disabled = true;
      req('/rally', { method: 'POST', body: { lat: pos.lat, lng: pos.lng, acc: pos.acc, tm: tm.value || '', memo: memo.value.trim(), nick: nick() } })
        .then(function (j) { active = j.active; lastSig = ''; render(); bg.remove(); toast('집합 위치를 알렸어요 (채팅에도 남겼어요)'); })
        .catch(function (e) { toast(e.message || '보내지 못했어요'); send.disabled = false; })
        .then(function () { busy = false; });
    };
  }

  req('/me').then(function (j) { me = j; }).catch(function () {}).then(function () { load(); loop(); });
  // 장소 탭이 다시 그려져도 카드가 유지되게(앱이 장소 목록을 새로 그릴 때)
  var mo = new MutationObserver(function () { if (!document.getElementById('rl-box')) { lastSig = ''; render(); } });
  var v = document.getElementById('v-places') || document.getElementById('main'); if (v) mo.observe(v, { childList: true });
})();
