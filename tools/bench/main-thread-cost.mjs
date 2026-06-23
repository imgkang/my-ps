// 성과측정 ②(클라이언트 부담): 인출 렌더 1회당 "메인스레드에서 동기 실행되는 계산" 비용.
//
//   BEFORE(이전): 900+줄 투영 루프가 메인스레드에서 동기 실행 → UI 블로킹.
//   AFTER(현재):  투영은 서버(await)로 이동. 클라가 동기로 하는 건
//                 적립계획 입금 스케줄 사전계산 + 입력 직렬화뿐.
//
// 동일 픽스처로 두 비용을 측정해 "메인스레드에서 제거된 작업량"을 정량화한다.
// (네트워크 왕복 등 실제 종단 시간은 tools/bench/render-speed.mjs 로 라이브 측정)
//
// 사용:  node tools/bench/main-thread-cost.mjs [iterations]
//   사전:  cd server && npm run build && node test/gen-legacy.mjs
import { performance } from 'node:perf_hooks';
import { fixtures, inputToCtx } from '../../server/test/fixtures.mjs';
import { legacyLoop } from '../../server/test/_legacy-loop.mjs';

const ITER = Number(process.argv[2] || 2000);

// AFTER 클라가 하는 동기 작업 재현: depositPlan 사전계산 + 페이로드 직렬화.
function clientAssembleCost(input) {
  const depositPlan = {};
  const dep = (id, yr) => input.depositPlan[id]?.[yr];
  for (const accId of input.allAccIds) {
    for (const yr of input.years) {
      const depositWon = dep(accId, yr)?.depositWon || 0;
      if (depositWon <= 0) continue;
      (depositPlan[accId] || (depositPlan[accId] = {}))[yr] = {
        depositWon,
        totalSimpleMw: dep(accId, yr)?.totalSimpleMw || 0,
        anseSimpleMw: dep(accId, yr)?.anseSimpleMw || 0,
      };
    }
  }
  const payload = { ...input, depositPlan };
  return JSON.stringify(payload).length; // 직렬화까지 포함(반환값은 최적화 방지용)
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

console.log(`\n=== 인출 렌더 1회당 메인스레드 동기 계산비용 (픽스처별, ${ITER}회 median) ===\n`);
let sumBefore = 0, sumAfter = 0;
for (const { name, input } of fixtures) {
  const ctx = () => inputToCtx(input);
  // 워밍업
  for (let i = 0; i < 50; i++) { legacyLoop(ctx()); clientAssembleCost(input); }

  const before = [], after = [];
  for (let i = 0; i < ITER; i++) {
    let t = performance.now(); legacyLoop(ctx()); before.push(performance.now() - t);
    t = performance.now(); clientAssembleCost(input); after.push(performance.now() - t);
  }
  const b = median(before), a = median(after);
  sumBefore += b; sumAfter += a;
  const red = b > 0 ? (((b - a) / b) * 100).toFixed(1) : '0';
  console.log(`${name}  (${input.years.length}년)`);
  console.log(`  BEFORE(루프, 메인스레드): ${b.toFixed(4)} ms`);
  console.log(`  AFTER (입력조립+직렬화) : ${a.toFixed(4)} ms`);
  console.log(`  → 메인스레드 작업 ${red}% 감소\n`);
}
const totalRed = sumBefore > 0 ? (((sumBefore - sumAfter) / sumBefore) * 100).toFixed(1) : '0';
console.log(`합계 BEFORE ${sumBefore.toFixed(3)} ms → AFTER ${sumAfter.toFixed(3)} ms  (메인스레드 ${totalRed}% 감소)`);
console.log('주: AFTER 의 투영 계산은 서버에서 await 로 처리되어 메인스레드를 블로킹하지 않음.\n');
