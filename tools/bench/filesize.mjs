// 성과측정 ①: 프론트엔드 파일 크기 (작을수록 좋음).
// 현재 작업트리의 프론트 HTML 크기를 기준 ref(기본 HEAD)와 비교한다.
//
// 사용:  node tools/bench/filesize.mjs [baseRef]
//   baseRef 미지정 시 HEAD 와 비교. 비교 불가하면 현재 크기만 출력.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FILES = ['index.html', 'NonK.html', 'KDeal.html'];
const baseRef = process.argv[2] || 'HEAD';

const fmt = (n) => n.toLocaleString('en-US');
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const pct = (now, base) => base ? (((now - base) / base) * 100).toFixed(2) + '%' : 'n/a';

function curBytes(f) {
  const buf = readFileSync(resolve(repoRoot, f));
  return { raw: buf.length, gz: gzipSync(buf).length };
}
function baseBytes(f) {
  try {
    const buf = execSync(`git show ${baseRef}:${f}`, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
    return { raw: buf.length, gz: gzipSync(buf).length };
  } catch {
    return null;
  }
}

console.log(`\n=== 프론트엔드 파일 크기 (기준: ${baseRef}) ===\n`);
let tNowRaw = 0, tBaseRaw = 0, tNowGz = 0, tBaseGz = 0;
for (const f of FILES) {
  const now = curBytes(f);
  const base = baseBytes(f);
  tNowRaw += now.raw; tNowGz += now.gz;
  if (base) { tBaseRaw += base.raw; tBaseGz += base.gz; }
  if (base) {
    console.log(`${f}`);
    console.log(`  원본  : ${kb(base.raw)} → ${kb(now.raw)}  (${pct(now.raw, base.raw)}, ${fmt(now.raw - base.raw)} B)`);
    console.log(`  gzip  : ${kb(base.gz)} → ${kb(now.gz)}  (${pct(now.gz, base.gz)}, ${fmt(now.gz - base.gz)} B)`);
  } else {
    console.log(`${f}: ${kb(now.raw)} (gzip ${kb(now.gz)})  [기준 비교 불가]`);
  }
}
if (tBaseRaw) {
  console.log(`\n합계`);
  console.log(`  원본  : ${kb(tBaseRaw)} → ${kb(tNowRaw)}  (${pct(tNowRaw, tBaseRaw)}, ${fmt(tNowRaw - tBaseRaw)} B)`);
  console.log(`  gzip  : ${kb(tBaseGz)} → ${kb(tNowGz)}  (${pct(tNowGz, tBaseGz)}, ${fmt(tNowGz - tBaseGz)} B)`);
}
console.log('');
