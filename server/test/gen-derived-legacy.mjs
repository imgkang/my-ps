// 파생상태 파리티용 골든 생성기 — git HEAD 의 index.html 에서 클라 계산 함수를
// 그대로 추출해 _derived-legacy.mjs 로 감싼다. (커밋해 두면 Stage C 에서 클라 함수가
// 제거돼도 파리티 재현 가능)
//   node test/gen-derived-legacy.mjs [ref]
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const ref = process.argv[2] || 'HEAD';
const src = execSync(`git show ${ref}:index.html`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// function NAME( ... ) { ... } 를 중괄호 매칭으로 추출.
function extract(name) {
  const sig = `function ${name}(`;
  const start = src.indexOf(sig);
  if (start === -1) throw new Error('not found: ' + name);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const xirrCalc = extract('xirrCalc');
const computeAccountValue = extract('computeAccountValue');
const getAccountNetTotal = extract('getAccountNetTotal');
const getActiveAccounts = extract('getActiveAccounts');
// calcXIRR 의 현재시각 `new Date()` 만 주입 가능한 __now 로 치환(`new Date(t.date)` 는 보존).
const calcXIRR = extract('calcXIRR').replaceAll('new Date()', '__now');

const out = `// AUTO-GENERATED from \`git show HEAD:index.html\` — do not edit.
// 클라 계산 함수 verbatim 골든 (파생상태 파리티 검증용).
let holdings, cashAccounts, depositData, appSettings, __now;
const ACCOUNTS = [
  { id: 'dc', name: 'DC' }, { id: 'pension1', name: 'P1' }, { id: 'pension2', name: 'P2' },
  { id: 'irp', name: 'IRP' }, { id: 'isa', name: 'ISA' },
  { id: 'wife_dc', name: 'WDC' }, { id: 'wife_pension1', name: 'WP1' }, { id: 'wife_pension2', name: 'WP2' },
  { id: 'wife_irp', name: 'WIRP' }, { id: 'wife_isa', name: 'WISA' },
];
const MY_ACC_IDS = ['dc','pension1','pension2','irp','isa'];
const WIFE_ACC_IDS = ['wife_dc','wife_pension1','wife_pension2','wife_irp','wife_isa'];

${xirrCalc}
${computeAccountValue}
${getAccountNetTotal}
${getActiveAccounts}
${calcXIRR}

export function goldenDerived(mypm, now) {
  holdings = mypm.holdings || [];
  cashAccounts = mypm.cashAccounts || {};
  depositData = mypm.deposits || { transactions: [] };
  appSettings = mypm.appSettings || {};
  __now = now;
  const ids = getActiveAccounts().map((a) => a.id);
  const accounts = {};
  let totalValue = 0, totalCash = 0, totalPrincipal = 0;
  for (const id of ids) {
    const value = computeAccountValue(id);
    const principal = getAccountNetTotal(id);
    accounts[id] = { value, principal, xirr: calcXIRR(value, id) };
    totalValue += value; totalCash += Number(cashAccounts[id]) || 0; totalPrincipal += principal;
  }
  const xirr = calcXIRR(totalValue, null);
  return { accounts, totals: { totalValue, totalCash, totalPrincipal, xirr } };
}
`;

writeFileSync(new URL('./_derived-legacy.mjs', import.meta.url), out, 'utf8');
console.log('generated _derived-legacy.mjs');
