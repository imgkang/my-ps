// 가족여행 앱 「경비」 탭 — 소유자(OWNER_EMAIL) 전용 지출 기록 API. (기존 trip.html 경비 페이지를 옮긴 것)
//   GET    /trip/api/expenses              → { items, rates, rateAt }
//   PUT    /trip/api/expenses/items/:id    → 지출 추가/수정 (id 는 클라이언트 생성 — 오프라인·중복 전송에도 안전)
//   DELETE /trip/api/expenses/items/:id
//   POST   /trip/api/expenses/import       → { items } 합치기 (같은 id 는 건너뜀, 덮어쓰기 없음)
//   PUT    /trip/api/expenses/rates        → { AUD, USD, rateAt }
// 소유자가 아니면 403. 상태 변경은 Origin 확인.
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { db } from './db.js';
import { env } from './env.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS trip_expenses (
    id         TEXT PRIMARY KEY,
    date       TEXT NOT NULL,      -- YYYY-MM-DD
    cat        TEXT NOT NULL,
    memo       TEXT NOT NULL DEFAULT '',
    pay        TEXT NOT NULL DEFAULT '',
    cur        TEXT NOT NULL,      -- AUD | KRW | USD
    amount     REAL NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trip_expense_settings (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    aud     REAL NOT NULL,
    usd     REAL NOT NULL,
    rate_at TEXT NOT NULL DEFAULT ''
  );
`);

export const EXPENSE_CATS = ['flight', 'trans', 'stay', 'food', 'tour', 'gift', 'etc'] as const;
export const EXPENSE_CURS = ['AUD', 'KRW', 'USD'] as const;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_IMPORT = 5000;
const DEFAULT_RATES = { AUD: 900, USD: 1380 };

export const isOwnerEmail = (email: string) => !!env.OWNER_EMAIL && email.toLowerCase() === env.OWNER_EMAIL;

type Item = { id: string; date: string; cat: string; memo: string; pay: string; cur: string; amount: number };

const ctrl = (s: string) => s.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, '').trim();

// 항목 검증·정리. 반환: 정리된 항목 또는 오류 문구.
export function cleanExpense(id: unknown, x: any): Item | string {
  if (typeof id !== 'string' || !ID_RE.test(id)) return 'bad id';
  if (!x || typeof x !== 'object') return 'bad body';
  const amount = typeof x.amount === 'string' ? Number(x.amount) : x.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 1e10) return 'bad amount';
  if (typeof x.date !== 'string' || !DATE_RE.test(x.date)) return 'bad date';
  const cat = (EXPENSE_CATS as readonly string[]).includes(x.cat) ? x.cat : 'etc';
  if (!(EXPENSE_CURS as readonly string[]).includes(x.cur)) return 'bad cur';
  return {
    id, date: x.date, cat, cur: x.cur, amount: Math.round(amount * 100) / 100,
    memo: ctrl(String(x.memo ?? '')).slice(0, 200), pay: ctrl(String(x.pay ?? '')).slice(0, 40),
  };
}

function getRates() {
  const r = db.prepare('SELECT aud, usd, rate_at FROM trip_expense_settings WHERE id = 1').get() as
    | { aud: number; usd: number; rate_at: string } | undefined;
  return r ? { rates: { AUD: r.aud, USD: r.usd }, rateAt: r.rate_at } : { rates: { ...DEFAULT_RATES }, rateAt: '' };
}
const listItems = () =>
  db.prepare('SELECT id, date, cat, memo, pay, cur, amount FROM trip_expenses ORDER BY date ASC, created_at ASC').all() as Item[];

const upsert = db.prepare(`
  INSERT INTO trip_expenses (id, date, cat, memo, pay, cur, amount, created_at, updated_at)
  VALUES (@id, @date, @cat, @memo, @pay, @cur, @amount, @now, @now)
  ON CONFLICT(id) DO UPDATE SET date = excluded.date, cat = excluded.cat, memo = excluded.memo,
    pay = excluded.pay, cur = excluded.cur, amount = excluded.amount, updated_at = excluded.updated_at`);
const insertIgnore = db.prepare(`
  INSERT OR IGNORE INTO trip_expenses (id, date, cat, memo, pay, cur, amount, created_at, updated_at)
  VALUES (@id, @date, @cat, @memo, @pay, @cur, @amount, @now, @now)`);

export function registerExpenseRoutes(
  app: FastifyInstance,
  api: string,
  h: { requireTripAuth: preHandlerHookHandler; requireSameOrigin: preHandlerHookHandler; email: (req: FastifyRequest) => string }
) {
  const requireOwner = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isOwnerEmail(h.email(req))) return reply.code(403).send({ error: 'owner only' });
  };
  const read = [h.requireTripAuth, requireOwner];
  const write = [h.requireSameOrigin, h.requireTripAuth, requireOwner];

  app.get(`${api}/expenses`, { preHandler: read }, async () => ({ items: listItems(), ...getRates() }));

  app.put(`${api}/expenses/items/:id`, { preHandler: write, bodyLimit: 8 * 1024 }, async (req, reply) => {
    const it = cleanExpense((req.params as any).id, req.body);
    if (typeof it === 'string') return reply.code(400).send({ error: it });
    upsert.run({ ...it, now: Date.now() });
    return it;
  });

  app.delete(`${api}/expenses/items/:id`, { preHandler: write }, async (req, reply) => {
    const id = (req.params as any).id;
    if (typeof id !== 'string' || !ID_RE.test(id)) return reply.code(400).send({ error: 'bad id' });
    const removed = db.prepare('DELETE FROM trip_expenses WHERE id = ?').run(id).changes > 0;
    return { ok: true, removed };
  });

  app.post(`${api}/expenses/import`, { preHandler: write, bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
    const arr = (req.body as any)?.items;
    if (!Array.isArray(arr)) return reply.code(400).send({ error: 'items must be array' });
    if (arr.length > MAX_IMPORT) return reply.code(413).send({ error: 'too many items' });
    let added = 0, skipped = 0, invalid = 0;
    const now = Date.now();
    db.transaction(() => {
      for (const x of arr) {
        const it = cleanExpense(x?.id, x);
        if (typeof it === 'string') { invalid++; continue; }
        if (insertIgnore.run({ ...it, now }).changes) added++; else skipped++;
      }
    })();
    return { added, skipped, invalid, items: listItems() };
  });

  app.put(`${api}/expenses/rates`, { preHandler: write, bodyLimit: 2 * 1024 }, async (req, reply) => {
    const b = (req.body ?? {}) as any;
    const aud = Number(b.AUD), usd = Number(b.USD);
    const ok = (n: number) => Number.isFinite(n) && n > 0 && n < 1e6;
    if (!ok(aud) || !ok(usd)) return reply.code(400).send({ error: 'bad rates' });
    const rateAt = ctrl(String(b.rateAt ?? '')).slice(0, 60);
    db.prepare(
      `INSERT INTO trip_expense_settings (id, aud, usd, rate_at) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET aud = excluded.aud, usd = excluded.usd, rate_at = excluded.rate_at`
    ).run(Math.round(aud * 100) / 100, Math.round(usd * 100) / 100, rateAt);
    return getRates();
  });
}
