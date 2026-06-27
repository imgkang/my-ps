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
