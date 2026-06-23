// 인출 시뮬레이션 파리티 테스트.
//   원본(legacyLoop, git HEAD 추출) vs 포팅본(simulateWithdrawal, dist) 를
//   동일 입력으로 실행해 결과가 일치하는지 검증한다.
//
// 사전조건: `npm run build` 로 dist 생성 + `node test/gen-legacy.mjs` 로 골든 생성.
// 실행:     `npm run test:parity`  (둘 다 자동 수행)
import { simulateWithdrawal } from '../dist/compute/withdrawal.js';
import { legacyLoop } from './_legacy-loop.mjs';
import { fixtures, inputToCtx } from './fixtures.mjs';

const EPS = 1e-6;

// 깊은 비교 (숫자는 상대오차 허용). 차이 경로를 모아 반환.
function diff(a, b, path = '', acc = []) {
  if (typeof a === 'number' && typeof b === 'number') {
    const d = Math.abs(a - b);
    const rel = d / (Math.max(Math.abs(a), Math.abs(b)) || 1);
    if (d > EPS && rel > EPS) acc.push(`${path}: ${a} != ${b}`);
    return acc;
  }
  if (a === null || b === null || typeof a !== 'object') {
    if (a !== b) acc.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
    return acc;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) diff(a[k], b[k], path ? `${path}.${k}` : k, acc);
  return acc;
}

let failed = 0;
for (const { name, input } of fixtures) {
  // JSON 왕복: 클라이언트가 실제로 직렬화해 보내는 형태를 재현(숫자키→문자열 등).
  const wire = JSON.parse(JSON.stringify(input));
  const port = simulateWithdrawal(wire);
  const legacy = legacyLoop(inputToCtx(input));
  // debug 필드는 비교 대상에서 제외(포팅본에만 존재).
  delete port.debug;
  const diffs = diff(legacy, port);
  if (diffs.length === 0) {
    console.log(`✅ ${name}: 일치 (${input.years.length}년)`);
  } else {
    failed++;
    console.log(`❌ ${name}: ${diffs.length}개 불일치`);
    for (const d of diffs.slice(0, 12)) console.log('   ' + d);
    if (diffs.length > 12) console.log(`   ... 외 ${diffs.length - 12}개`);
  }
}

if (failed) {
  console.error(`\n파리티 실패: ${failed}/${fixtures.length} 픽스처 불일치`);
  process.exit(1);
}
console.log(`\n파리티 통과: ${fixtures.length}/${fixtures.length} 픽스처 모두 일치 ✅`);
