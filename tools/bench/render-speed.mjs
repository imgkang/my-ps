// 성과측정 ②(종단): 라이브 앱에서 인출 화면 1회 갱신에 걸리는 실제 시간.
//
// 메인스레드 동기비용은 main-thread-cost.mjs 로 측정하고, 이 스크립트는
// "트리거 → 표/그래프 렌더 완료"까지의 실제 wall-clock 과 long-task 블로킹을 잰다.
// 서버 왕복(네트워크 지연 포함)이 반영되므로, 배포 전/후 또는 구버전/신버전 URL 을
// 각각 측정해 비교한다.
//
// 사용:
//   MYPM_URL=https://mypm.growpension.com \
//   MYPM_TOKEN=<로그인 후 localStorage 의 mypm_auth_token> \
//   node tools/bench/render-speed.mjs [runs]
//
// 토큰 얻는 법: 브라우저에서 로그인 → 콘솔에 `localStorage.mypm_auth_token` 출력값 복사.
import { chromium } from 'playwright';

const URL = process.env.MYPM_URL || 'http://localhost:3000';
const TOKEN = process.env.MYPM_TOKEN || '';
const RUNS = Number(process.argv[2] || 10);

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const ctx = await browser.newContext();
const page = await ctx.newPage();

// 토큰/baseUrl 주입 (로그인 우회).
if (TOKEN) {
  await ctx.addInitScript((tok) => {
    try {
      localStorage.setItem('mypm_auth_token', tok);
      if (!localStorage.getItem('mypm_api_base')) localStorage.setItem('mypm_api_base', location.origin);
    } catch (_) {}
  }, TOKEN);
}

await page.goto(URL, { waitUntil: 'networkidle' });

// 인출 패널 진입 (앱 함수 직접 호출). 함수명이 다르면 UI 클릭으로 대체.
await page.evaluate(() => {
  if (typeof showPanel === 'function') { try { showPanel('withdrawal'); } catch (_) {} }
}).catch(() => {});

const result = await page.evaluate(async (runs) => {
  if (typeof renderWithdrawalPlan !== 'function') return { error: 'renderWithdrawalPlan 미정의 (로그인/데이터 필요)' };
  const wall = [], block = [];
  for (let i = 0; i < runs; i++) {
    let blocked = 0;
    const obs = new PerformanceObserver((list) => { for (const e of list.getEntries()) blocked += e.duration; });
    try { obs.observe({ entryTypes: ['longtask'] }); } catch (_) {}
    const t0 = performance.now();
    await renderWithdrawalPlan();
    await new Promise((r) => requestAnimationFrame(() => r())); // 페인트 1프레임 대기
    wall.push(performance.now() - t0);
    obs.disconnect();
    block.push(blocked);
  }
  return { wall, block };
}, RUNS);

await browser.close();

if (result.error) {
  console.error('측정 불가:', result.error);
  console.error('→ 로그인된 상태에서 MYPM_TOKEN 을 지정하고 데이터가 있는 계정으로 실행하세요.');
  process.exit(2);
}
console.log(`\n=== 라이브 인출 렌더 속도 (${URL}, ${RUNS}회) ===`);
console.log(`  wall-clock(트리거→페인트) median: ${median(result.wall).toFixed(1)} ms`);
console.log(`  long-task 블로킹       median: ${median(result.block).toFixed(1)} ms`);
console.log('');
