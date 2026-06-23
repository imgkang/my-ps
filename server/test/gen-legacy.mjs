// 파리티 테스트용 "골든" 레퍼런스 생성기.
// git HEAD 의 index.html 에서 인출 투영 루프(원본 알고리즘)를 그대로 추출해
// _legacy-loop.mjs 로 감싼다. 이 원본과 server/src/compute/withdrawal.ts 포팅본을
// 동일 입력으로 돌려 결과가 일치하는지 비교한다.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// 일회성 생성기. _legacy-loop.mjs 는 커밋되어 있으므로 평소엔 실행 불필요.
// 원본 루프가 들어있던 "리팩터 직전" 커밋을 ref 로 지정해 재생성한다(기본 HEAD).
//   node test/gen-legacy.mjs <ref>
const ref = process.argv[2] || 'HEAD';
const head = execSync(`git show ${ref}:index.html`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const startMarker = '  const withdrawals = {}, balances = {}, summary = {};';
const endMarker = '  return { years, withdrawals, balances, summary, initState, allAccIds, startYear, wifeExtraIds };';
const s = head.indexOf(startMarker);
const e = head.indexOf(endMarker);
if (s === -1 || e === -1) throw new Error('markers not found in HEAD index.html');
const block = head.slice(s, e + endMarker.length);

const out = `// AUTO-GENERATED from \`git show HEAD:index.html\` by gen-legacy.mjs — do not edit.
// 원본 인출 투영 루프(검증 골든). ctx 로 전역/헬퍼를 주입받아 실행한다.
export function legacyLoop(ctx) {
  const {
    years, allAccIds, startYear, state, initState,
    r, inf, epTR, npTR, todayYear, myBY, wifeBY,
    myRTR_base, myB10, myB20, myB30, myWithdrawIds, wifeExtraSet, wifeExtraIds,
    myExtraIds, getPTR, getActiveWifeAccIds, appSettings, wp,
    myPersonCfg, wifePersonCfg,
    getMonthlyPlanYearEndValueWon, getMonthlyPlanIncrManwon, getMonthlyPlanAnseIncrManwon,
    WIFE_ACC_IDS, DC_ACC_IDS, PENSION_THRESHOLD, _wdLog,
  } = ctx;
${block}
}
`;

writeFileSync(new URL('./_legacy-loop.mjs', import.meta.url), out, 'utf8');
console.log('generated _legacy-loop.mjs (' + block.length + ' chars of original loop)');
