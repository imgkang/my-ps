// 종목 마스터 적재 — tickers.json (update_tickers.py 산출물)을 SQLite tickers 테이블로 적재.
//   사용법: npm run load-tickers -- <path/to/tickers.json>
//   (인자 생략 시 ../tickers.json 시도)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../db.js';

const path = process.argv[2] ?? resolve(process.cwd(), '../tickers.json');
const data = JSON.parse(readFileSync(path, 'utf8'));
const items: any[] = data.items ?? [];
if (!items.length) {
  console.error('❌ items 가 비어있습니다:', path);
  process.exit(1);
}

const insert = db.prepare(
  `INSERT INTO tickers (t, n, k, e, c, y) VALUES (@t, @n, @k, @e, @c, @y)
   ON CONFLICT(t, c) DO UPDATE SET n=excluded.n, k=excluded.k, e=excluded.e, y=excluded.y`
);
const tx = db.transaction((rows: any[]) => {
  for (const r of rows) {
    insert.run({ t: r.t, n: r.n ?? null, k: r.k ?? null, e: r.e ?? null, c: r.c, y: r.y ?? null });
  }
});
tx(items);

const count = (db.prepare('SELECT count(*) AS n FROM tickers').get() as { n: number }).n;
console.log(`✅ 종목 적재 완료 — 입력 ${items.length}건, 테이블 총 ${count}건 (version ${data.version})`);
