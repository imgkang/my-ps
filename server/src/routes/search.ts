// 종목 검색 — SQLite tickers 테이블 기반.
//   GET /api/search?q=삼성&country=KR&limit=10  → 랭킹된 검색 결과
//   GET /api/tickers/count                       → 적재된 종목 수 (헬스 체크용)
// (클라이언트는 기존 js/ticker-search.js 로 tickers.json 을 받아 자체 검색도 가능)
import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';

type Row = { t: string; n: string | null; k: string | null; e: string | null; c: string; y: string | null };

export default async function searchRoutes(app: FastifyInstance) {
  app.get('/api/search', async (req, reply) => {
    const q = String((req.query as any)?.q ?? '').trim();
    const country = (req.query as any)?.country as string | undefined;
    const limit = Math.min(Number((req.query as any)?.limit ?? 10) || 10, 50);
    if (!q) return reply.send([]);

    const ql = q.toLowerCase();
    const like = `%${ql}%`;
    const params: any[] = [like, like, like];
    let sql = `SELECT t, n, k, e, c, y FROM tickers
               WHERE lower(t) LIKE ? OR lower(n) LIKE ? OR lower(k) LIKE ?`;
    if (country) {
      sql += ' AND c = ?';
      params.push(country);
    }
    sql += ' LIMIT 500';
    const rows = db.prepare(sql).all(...params) as Row[];

    // ticker-search.js 와 동일한 랭킹: 정확 일치 → 티커 접두 → 이름 접두 → 부분 일치
    const rank = (r: Row): number => {
      const t = r.t.toLowerCase();
      const n = (r.n ?? '').toLowerCase();
      const k = (r.k ?? '').toLowerCase();
      if (t === ql) return 0;
      if (t.startsWith(ql)) return 1;
      if (n.startsWith(ql) || k.startsWith(ql)) return 2;
      return 3;
    };
    rows.sort((a, b) => rank(a) - rank(b) || a.t.localeCompare(b.t));
    return rows.slice(0, limit);
  });

  app.get('/api/tickers/count', async () => {
    const r = db.prepare('SELECT count(*) AS n FROM tickers').get() as { n: number };
    return { count: r.n };
  });
}
