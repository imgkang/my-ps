// 시드 데이터로 NonK/KDeal 렌더 화면 스크린샷 (UI 변경 시각 확인용).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { SEEDS } from './fixtures.mjs';
const gRoot = execSync('npm root -g').toString().trim();
const require = createRequire(import.meta.url);
const _pw = await import(pathToFileURL(require.resolve('playwright', { paths: [gRoot] })).href);
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const ROOT = join(__dirname, '..', '..');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml' };
const srv = createServer(async (req,res)=>{try{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/index.html';const b=await readFile(join(ROOT,p));res.writeHead(200,{'Content-Type':MIME[extname(p)]||'application/octet-stream'});res.end(b);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>srv.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${srv.address().port}`;
const BLOCK=[/yahoo/i,/naver/i,/stooq/i,/finnhub/i,/growpension/i,/googleapis/i,/gstatic/i];
const browser=await chromium.launch({headless:true});
for(const [name,seed] of Object.entries(SEEDS)){
  const ctx=await browser.newContext({viewport:{width:430,height:1400},deviceScaleFactor:2});
  await ctx.route('**/*',r=>BLOCK.some(re=>re.test(r.request().url()))&&!/jsdelivr|127\.0\.0\.1/.test(r.request().url())?r.abort():r.continue());
  const pg=await ctx.newPage();
  await pg.addInitScript((store)=>{try{localStorage.clear()}catch{};for(const[k,v]of Object.entries(store))localStorage.setItem(k,JSON.stringify(v));},seed.store);
  await pg.goto(`${base}/${seed.url}`,{waitUntil:'domcontentloaded'});
  await pg.waitForTimeout(800);
  const out=join(OUT,`shot-${name}.png`);
  await pg.screenshot({path:out,fullPage:true});
  console.log('saved '+out);
  await ctx.close();
}
await browser.close();srv.close();
