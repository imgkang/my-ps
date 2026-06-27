// 리팩토링 진척 스코어보드 — LOC 총량 / 중복 줄 / 함수 재활용을 점수화.
//
//   node test/refactor/metrics.mjs --baseline   # 리팩토링 전 기준선 기록
//   node test/refactor/metrics.mjs              # 현재 측정 + 기준선 대비 진척 표시
//
// 핵심 지표
//   • Tracked LOC  : NonK.html + KDeal.html + market.css + js/market-core.js 의 코드 줄 합
//   • Duplicate LOC: 접두사/로케일 정규화 후 NonK 와 KDeal 양쪽에 동시에 존재하는 줄 수
//   • Dedup 점수   : 기준선 중복 대비 제거된 비율 (0→100)
//   • 함수 재활용  : 공유(market-core) 함수 수 / (공유 + 시장별 중복함수쌍)

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const BASELINE = join(__dirname, 'metrics-baseline.json');
const BASELINE_MODE = process.argv.includes('--baseline');

const FILES = ['NonK.html', 'KDeal.html', 'market.css', 'js/market-core.js'];

async function read(rel) {
  const p = join(ROOT, rel);
  return existsSync(p) ? await readFile(p, 'utf8') : null;
}

// nk/kd 계열 접두사 + 로케일 리터럴 제거 → 양 시장에서 "같은 코드"가 같은 문자열이 되게
function normalizeLine(line) {
  return line
    .replace(/\b(nonk|kdeal)\b/gi, '@MKT@')
    .replace(/\b(nkt|kdt|nkw|kdw|nqt|kqt)/g, '@P@')   // 2차 접두사 먼저
    .replace(/\b(nk|kd)(?=[A-Z_])/g, '@P@')           // nkFoo / kdFoo / NK_/KD_
    .replace(/\b(NK|KD)_/g, '@P@_')
    .replace(/'(en-US|ko-KR)'/g, '@LOC@')
    .replace(/\s+/g, ' ')
    .trim();
}

function codeLines(src) {
  return src.split('\n').map(l => l.trim()).filter(l => l && l !== '{' && l !== '}' && !/^\/\//.test(l));
}

function countFns(src) {
  const set = new Set();
  for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) set.add(m[1]);
  for (const m of src.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)/gm)) set.add(m[1]);
  return set;
}

async function measure() {
  const nonk = await read('NonK.html');
  const kdeal = await read('KDeal.html');
  const css = await read('market.css');
  const core = await read('js/market-core.js');

  // Tracked LOC
  const loc = {};
  let trackedTotal = 0;
  for (const f of FILES) {
    const src = await read(f);
    const n = src ? src.split('\n').length : 0;
    loc[f] = n; trackedTotal += n;
  }

  // Duplicate LOC (정규화 멀티셋 교집합)
  const bag = (src) => { const m = new Map(); for (const l of codeLines(src)) { const k = normalizeLine(l); if (k.length < 4) continue; m.set(k, (m.get(k) || 0) + 1); } return m; };
  const bn = bag(nonk), bk = bag(kdeal);
  let dupLines = 0;
  for (const [k, c] of bn) if (bk.has(k)) dupLines += Math.min(c, bk.get(k));

  // 함수 재활용
  const nonkFns = countFns(nonk), kdealFns = countFns(kdeal);
  const sharedFns = core ? countFns(core).size : 0;
  // 시장별 중복함수쌍: 접두사 제거 시 이름이 겹치는 함수 (양쪽에 동일 로직 존재 추정)
  const strip = (s) => new Set([...s].map(n => n.replace(/^(nonk|kdeal|nkt|kdt|nkw|kdw|nqt|kqt|nk|kd|NK_|KD_)/i, '')));
  const sn = strip(nonkFns), sk = strip(kdealFns);
  let dupFnPairs = 0; for (const n of sn) if (sk.has(n)) dupFnPairs++;
  const reusePct = (sharedFns + dupFnPairs) > 0 ? sharedFns / (sharedFns + dupFnPairs) * 100 : 0;

  return {
    trackedTotal, loc,
    dupLines,
    fns: { nonk: nonkFns.size, kdeal: kdealFns.size, shared: sharedFns, dupPairs: dupFnPairs },
    reusePct: +reusePct.toFixed(1),
  };
}

const pad = (s, n) => String(s).padEnd(n);
const num = (n) => n.toLocaleString('en-US');
const arrow = (delta) => delta === 0 ? '' : (delta < 0 ? `▼ ${num(-delta)}` : `▲ ${num(delta)}`);

(async () => {
  const m = await measure();
  if (BASELINE_MODE) {
    await writeFile(BASELINE, JSON.stringify(m, null, 2) + '\n');
    console.log(`✅ 메트릭 기준선 저장: ${BASELINE}`);
  }
  const base = existsSync(BASELINE) ? JSON.parse(await readFile(BASELINE, 'utf8')) : null;

  console.log('\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│  리팩토링 스코어보드                                          │');
  console.log('└─────────────────────────────────────────────────────────────┘\n');

  console.log('● Tracked LOC (NonK + KDeal + market.css + market-core.js)');
  for (const f of FILES) console.log(`    ${pad(f, 22)} ${pad(num(m.loc[f]), 8)}`);
  console.log(`    ${pad('합계', 22)} ${pad(num(m.trackedTotal), 8)} ${base ? arrow(m.trackedTotal - base.trackedTotal) : ''}`);

  console.log('\n● Duplicate LOC (NonK ↔ KDeal 정규화 후 중복 줄)');
  console.log(`    중복 줄 수            ${pad(num(m.dupLines), 8)} ${base ? arrow(m.dupLines - base.dupLines) : ''}`);
  if (base && base.dupLines > 0) {
    const dedupScore = Math.max(0, (base.dupLines - m.dupLines) / base.dupLines * 100);
    const bar = '█'.repeat(Math.round(dedupScore / 5)).padEnd(20, '░');
    console.log(`    Dedup 점수            ${bar} ${dedupScore.toFixed(1)} / 100`);
  }

  console.log('\n● 함수 재활용');
  console.log(`    NonK 정의 함수        ${num(m.fns.nonk)}`);
  console.log(`    KDeal 정의 함수       ${num(m.fns.kdeal)}`);
  console.log(`    공유(market-core)     ${num(m.fns.shared)} ${base ? arrow(m.fns.shared - base.fns.shared) : ''}`);
  console.log(`    시장별 중복함수쌍     ${num(m.fns.dupPairs)} ${base ? arrow(m.fns.dupPairs - base.fns.dupPairs) : ''}`);
  const bar2 = '█'.repeat(Math.round(m.reusePct / 5)).padEnd(20, '░');
  console.log(`    재활용률              ${bar2} ${m.reusePct} / 100`);
  console.log('');
})();
