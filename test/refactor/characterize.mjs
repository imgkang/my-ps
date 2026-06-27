// 리팩토링 특성화(골든) 테스트 — 동작 불변 보장용 안전망.
//
//   node test/refactor/characterize.mjs --update   # 골든 베이스라인 캡처(리팩토링 전 1회)
//   node test/refactor/characterize.mjs             # 현재 동작이 골든과 일치하는지 검증
//
// 캡처 신호(시장별): 메인 리스트 innerText, 히어로 innerText, 상태 텍스트,
//   계산된 색상(--plus/--minus/--primary + 렌더된 pos/neg 색), 핵심 합계 숫자.
// price 를 시드에 박아 네트워크 없이 결정적으로 렌더된다.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { SEEDS } from './fixtures.mjs';

// playwright 는 전역 설치 → 전역 모듈 경로에서 동적 resolve (ESM은 NODE_PATH 무시)
const gRoot = execSync('npm root -g').toString().trim();
const require = createRequire(import.meta.url);
const _pw = await import(pathToFileURL(require.resolve('playwright', { paths: [gRoot] })).href);
const chromium = (_pw.chromium || (_pw.default && _pw.default.chromium));

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const GOLDEN = join(__dirname, 'golden.json');
const UPDATE = process.argv.includes('--update');

const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.svg':'image/svg+xml' };

function startServer() {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      try {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        const full = join(ROOT, p);
        const buf = await readFile(full);
        res.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream' });
        res.end(buf);
      } catch { res.writeHead(404); res.end('not found'); }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// 외부 데이터 호스트 차단(결정성). 차트 CDN은 허용.
const BLOCK = [/yahoo/i, /naver/i, /stooq/i, /finnhub/i, /growpension/i, /googleapis/i, /gstatic/i];
function shouldBlock(url) {
  if (/jsdelivr|127\.0\.0\.1|localhost/i.test(url)) return false;
  return BLOCK.some(re => re.test(url));
}

const firstId = (page, ids) => page.evaluate((ids) => {
  for (const id of ids) if (document.getElementById(id)) return id;
  return null;
}, ids);

async function capture(browser, base, seed) {
  const ctx = await browser.newContext();
  await ctx.route('**/*', (route) => shouldBlock(route.request().url()) ? route.abort() : route.continue());
  const pg = await ctx.newPage();
  const pageErrors = [];
  pg.on('pageerror', e => { pageErrors.push(e.message); console.error(`  [pageerror ${seed.url}] ${e.message}`); });
  // 로드 전 localStorage 시드
  await pg.addInitScript((store) => {
    try { localStorage.clear(); } catch {}
    for (const [k, v] of Object.entries(store)) localStorage.setItem(k, JSON.stringify(v));
  }, seed.store);

  await pg.goto(`${base}/${seed.url}`, { waitUntil: 'domcontentloaded' });

  const containerId = await firstId(pg, seed.containerIds);
  const heroId = await firstId(pg, seed.heroIds);
  // 렌더 완료 대기: 컨테이너에 텍스트가 채워질 때까지
  await pg.waitForFunction((id) => {
    const el = id && document.getElementById(id);
    return el && el.innerText && el.innerText.trim().length > 0;
  }, containerId, { timeout: 8000 }).catch(() => {});
  await pg.waitForTimeout(400); // 잔여 동기 렌더 정착

  const data = await pg.evaluate(({ containerId, heroId }) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const cs = getComputedStyle(document.documentElement);
    const vars = {
      primary: cs.getPropertyValue('--primary').trim(),
      plus: cs.getPropertyValue('--plus').trim(),
      minus: cs.getPropertyValue('--minus').trim(),
    };
    // 렌더된 pos/neg 색(클래스 접두사 무관하게 [class*=pos]/[class*=neg]에서 첫 요소)
    const pickColor = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).color : null;
    };
    const renderedColors = {
      diffPos: pickColor('.diff-positive'),
      diffNeg: pickColor('.diff-negative'),
    };
    // 테마 요소들의 계산된 색/배경 — Phase1(색상 토큰화) 회귀 탐지용.
    const themedSel = ['.summary-card', '.nk-hero', '.nk-hero-value', '.nk-hero-row',
      '.nk-hero-label', '.nk-hero-unit', '.nk-hero .diff-positive', '.nk-hero .diff-negative',
      '.pos', '.neg', '.nkw-pos', '.kdw-pos', '.nkw-neg', '.kdw-neg', 'input', '.btn-primary'];
    const themed = {};
    for (const sel of themedSel) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const c = getComputedStyle(el);
      themed[sel] = { color: c.color, bg: c.backgroundColor, bgImg: c.backgroundImage, boxShadow: c.boxShadow };
    }
    const container = containerId ? document.getElementById(containerId) : null;
    const hero = heroId ? document.getElementById(heroId) : null;
    const statusEl = document.querySelector('[id$="StatusText"]');
    return {
      vars, renderedColors, themed,
      hero: norm(hero && hero.innerText),
      status: norm(statusEl && statusEl.innerText),
      list: norm(container && container.innerText),
    };
  }, { containerId, heroId });

  await ctx.close();
  return { containerId, heroId, pageErrors, ...data };
}

// 모달 오픈 함수들을 호출해 에러/내용 검증 (모달 내부 ID 회귀 탐지)
async function captureSmoke(browser, base, seed) {
  const out = {};
  for (const fn of (seed.smoke || [])) {
    const ctx = await browser.newContext();
    await ctx.route('**/*', (route) => shouldBlock(route.request().url()) ? route.abort() : route.continue());
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(e.message));
    await pg.addInitScript((store) => { try { localStorage.clear(); } catch {} for (const [k, v] of Object.entries(store)) localStorage.setItem(k, JSON.stringify(v)); }, seed.store);
    await pg.goto(`${base}/${seed.url}`, { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(300);
    const res = await pg.evaluate((fn) => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      let called = false, err = null;
      try { if (typeof window[fn] === 'function') { window[fn](); called = true; } else err = 'not a function'; }
      catch (e) { err = String(e && e.message || e); }
      // 보이는 모달 찾기: class에 modal 포함 + 화면에 표시됨
      let text = '';
      const cands = [...document.querySelectorAll('[class*="modal"],[class*="Modal"]')]
        .filter(el => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && el.clientHeight > 0; });
      if (cands.length) text = norm(cands.map(el => el.innerText).sort((a, b) => b.length - a.length)[0]);
      return { called, err, text };
    }, fn);
    if (errs.length) res.err = (res.err ? res.err + '; ' : '') + errs.join('; ');
    out[fn] = res;
    await ctx.close();
  }
  return out;
}

function deepDiff(a, b, path = '', out = []) {
  if (typeof a !== typeof b) { out.push(`${path}: type ${typeof a} != ${typeof b}`); return out; }
  if (a && typeof a === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) deepDiff(a[k], b[k], path ? `${path}.${k}` : k, out);
    return out;
  }
  if (a !== b) out.push(`${path}:\n    golden: ${JSON.stringify(a)}\n    actual: ${JSON.stringify(b)}`);
  return out;
}

(async () => {
  const srv = await startServer();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const result = {};
  for (const [name, seed] of Object.entries(SEEDS)) {
    process.stdout.write(`캡처: ${name} (${seed.url}) ... `);
    result[name] = await capture(browser, base, seed);
    result[name].smoke = await captureSmoke(browser, base, seed);
    console.log('done');
  }
  await browser.close();
  srv.close();

  // 로드 중 런타임 에러 + 모달 스모크 에러는 무조건 실패 (누락 ID/함수 탐지)
  const errs = Object.entries(result).flatMap(([n, r]) =>
    [...(r.pageErrors || []).map(e => `${n}: ${e}`),
     ...Object.entries(r.smoke || {}).filter(([, s]) => s.err).map(([fn, s]) => `${n}.${fn}: ${s.err}`)]);
  if (errs.length) { console.error(`\n❌ 페이지 런타임 에러 ${errs.length}건:\n` + errs.map(e => '  • ' + e).join('\n')); process.exit(1); }

  if (UPDATE) {
    await mkdir(dirname(GOLDEN), { recursive: true });
    await writeFile(GOLDEN, JSON.stringify(result, null, 2) + '\n');
    console.log(`\n✅ 골든 베이스라인 저장: ${GOLDEN}`);
    return;
  }

  if (!existsSync(GOLDEN)) {
    console.error('\n❌ 골든 파일 없음. 먼저 --update 로 베이스라인을 캡처하세요.');
    process.exit(2);
  }
  const golden = JSON.parse(await readFile(GOLDEN, 'utf8'));
  // containerId/heroId 는 Phase 3에서 의도적으로 바뀌므로 비교에서 제외
  const strip = (o) => { const c = JSON.parse(JSON.stringify(o)); for (const m of Object.values(c)) { delete m.containerId; delete m.heroId; delete m.pageErrors; } return c; };
  const diffs = deepDiff(strip(golden), strip(result));
  if (diffs.length) {
    console.error(`\n❌ 동작 불일치 (${diffs.length}건):\n`);
    for (const d of diffs) console.error('  • ' + d);
    process.exit(1);
  }
  console.log('\n✅ 동작 일치 — 골든과 100% 동일 (리팩토링 안전).');
})();
