// 가족여행 앱 일정 — 서버 DB 저장 + 소유자 앱 내 편집 + 예약 영수증 첨부.
//   GET    /trip/api/schedule              → { schedule|null, rev, receipts, geo }   (멤버 모두, geo = 장소 좌표 — trip-geo.ts)
//   PUT    /trip/api/schedule              → { schedule, baseRev } 전체 저장     (소유자, rev 다르면 409)
//   POST   /trip/api/receipts?item=<id>    → 영수증 업로드(본문 = 파일 그대로)    (소유자)
//   GET    /trip/api/receipts/:id          → 영수증 보기                         (멤버 모두)
//   DELETE /trip/api/receipts/:id                                               (소유자)
// 일정이 DB 에 아직 없으면 schedule=null → 프론트는 trip-data.js 를 그대로 쓰고, 소유자가 「일정 편집」을
// 처음 켤 때 화면의 trip-data.js 내용을 PUT 해서 옮긴다(서버에서 JS 를 실행하지 않음).
// 영수증 파일은 TRIP_RECEIPT_DIR(기본 ./private/trip-receipts, git 제외)에 저장, 로그인한 멤버만 열람.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { db } from './db.js';
import { env } from './env.js';
import { isOwnerEmail } from './trip-expenses.js';
import { geoFor } from './trip-geo.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS trip_schedule (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    json       TEXT NOT NULL,
    rev        INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trip_receipts (
    id         TEXT PRIMARY KEY,
    item_id    TEXT NOT NULL,
    name       TEXT NOT NULL,
    mime       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS trip_receipts_item ON trip_receipts(item_id);
`);

const RECEIPT_DIR = () => resolve(env.TRIP_RECEIPT_DIR);
const MAX_RECEIPT = 15 * 1024 * 1024;
const MAX_RECEIPTS_PER_ITEM = 10;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const PLACE_RE = /^[a-z0-9_]{1,32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UPLOAD_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/octet-stream'];

export type Place = { nm: string; q: string; ad: string };
export type SItem = { id: string; tm: string; tx: string; place?: string; meet?: boolean; st?: 'ok' | 'tbd'; note?: string };
export type Day = { date: string; w: string; ttl: string; sub: string; items: SItem[] };
// 예약·준비할 일 체크리스트 — 일정과 같은 JSON 에 저장(소유자 편집). id 는 일정 항목과 같은 공간이라 영수증도 붙일 수 있다.
export type Todo = { id: string; tx: string; due?: string; done?: boolean; note?: string };
export type Schedule = { start: string; places: Record<string, Place>; days: Day[]; todos: Todo[] };

const ctrl = (v: unknown, max: number, keepNl = false) => {
  let s = typeof v === 'string' ? v : v == null ? '' : String(v);
  s = s.replace(/\r\n?/g, '\n');
  s = keepNl ? s.replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029]/g, '') : s.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, '');
  return [...s.trim()].slice(0, max).join('');
};
const newId = (n = 8) => randomBytes(n).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, n + 2) || 'x' + Date.now().toString(36);

// 전체 일정 검증·정리. 반환: 정리된 일정 또는 오류 문구. 항목 id 가 없으면 부여(첫 이전용).
export function cleanSchedule(x: any): Schedule | string {
  if (!x || typeof x !== 'object') return 'bad schedule';
  const placesIn = x.places && typeof x.places === 'object' && !Array.isArray(x.places) ? x.places : null;
  if (!placesIn) return 'places 가 없습니다';
  const places: Record<string, Place> = {};
  for (const [k, v] of Object.entries(placesIn).slice(0, 200)) {
    if (!PLACE_RE.test(k) || !v || typeof v !== 'object') return `잘못된 장소 키: ${k}`;
    const nm = ctrl((v as any).nm, 80), q = ctrl((v as any).q, 200);
    if (!nm || !q) return `장소 ${k}: 이름·검색어가 필요합니다`;
    places[k] = { nm, q, ad: ctrl((v as any).ad, 200) };
  }
  if (!Array.isArray(x.days) || !x.days.length || x.days.length > 60) return 'days 가 없거나 너무 많습니다';
  const seen = new Set<string>();
  const days: Day[] = [];
  const dates = new Set<string>();
  for (const d of x.days) {
    if (!d || typeof d.date !== 'string' || !DATE_RE.test(d.date)) return '날짜 형식 오류';
    if (dates.has(d.date)) return `${d.date}: 같은 날짜가 두 번 있습니다`;
    dates.add(d.date);
    const items: SItem[] = [];
    for (const it of Array.isArray(d.items) ? d.items.slice(0, 60) : []) {
      if (!it || typeof it !== 'object') continue;
      let id = typeof it.id === 'string' && ID_RE.test(it.id) ? it.id : newId();
      while (seen.has(id)) id = newId();
      seen.add(id);
      const tx = ctrl(it.tx, 200);
      if (!tx) return `${d.date}: 내용이 빈 항목이 있습니다`;
      const o: SItem = { id, tm: ctrl(it.tm, 20), tx };
      if (it.place != null && it.place !== '') {
        if (typeof it.place !== 'string' || !places[it.place]) return `${d.date} "${tx}": 없는 장소 ${String(it.place).slice(0, 32)}`;
        o.place = it.place;
      }
      if (it.meet === true && o.place) o.meet = true;
      if (it.st === 'ok' || it.st === 'tbd') o.st = it.st;
      const note = ctrl(it.note, 400, true);
      if (note) o.note = note;
      items.push(o);
    }
    days.push({ date: d.date, w: ctrl(d.w, 3), ttl: ctrl(d.ttl, 80) || d.date, sub: ctrl(d.sub, 120), items });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  const todos: Todo[] = [];
  for (const t of Array.isArray(x.todos) ? x.todos.slice(0, 200) : []) {
    if (!t || typeof t !== 'object') continue;
    let id = typeof t.id === 'string' && ID_RE.test(t.id) ? t.id : newId();
    while (seen.has(id)) id = newId();
    seen.add(id);
    const tx = ctrl(t.tx, 200);
    if (!tx) return '준비할 일: 내용이 빈 항목이 있습니다';
    const o: Todo = { id, tx };
    if (typeof t.due === 'string' && DATE_RE.test(t.due)) o.due = t.due;
    if (t.done === true) o.done = true;
    const note = ctrl(t.note, 400, true);
    if (note) o.note = note;
    todos.push(o);
  }
  const start = typeof x.start === 'string' && DATE_RE.test(x.start) ? x.start : days[0].date;
  return { start, places, days, todos };
}

// 일정의 장소 좌표(지도용) — 모르는 것은 백그라운드에서 찾아 다음 조회부터 포함된다.
const geoOf = (s: Schedule | null) => (s ? geoFor(Object.values(s.places)) : {});

export function getSchedule(): { schedule: Schedule | null; rev: number } {
  const r = db.prepare('SELECT json, rev FROM trip_schedule WHERE id = 1').get() as { json: string; rev: number } | undefined;
  return r ? { schedule: JSON.parse(r.json), rev: r.rev } : { schedule: null, rev: 0 };
}
// 채팅 장소 카드 검증용 — DB 일정이 있으면 그 장소 키
export function schedulePlaceKeys(): Set<string> | null {
  const s = getSchedule().schedule;
  return s ? new Set(Object.keys(s.places)) : null;
}

type ReceiptRow = { id: string; item_id: string; name: string; mime: string; size: number; created_at: number };
function receiptsByItem(): Record<string, Omit<ReceiptRow, 'item_id'>[]> {
  const out: Record<string, Omit<ReceiptRow, 'item_id'>[]> = {};
  for (const r of db.prepare('SELECT id, item_id, name, mime, size, created_at FROM trip_receipts ORDER BY created_at').all() as ReceiptRow[]) {
    (out[r.item_id] ??= []).push({ id: r.id, name: r.name, mime: r.mime, size: r.size, created_at: r.created_at });
  }
  return out;
}

// 파일 내용으로 형식 판별(확장자·Content-Type 은 믿지 않음). SVG·HTML 등은 받지 않는다.
export function sniff(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|mif1|msf1|hevc)$/.test(buf.subarray(8, 12).toString('latin1'))) return 'image/heic';
  return null;
}
const EXT: Record<string, string> = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic' };

async function deleteReceiptFiles(ids: string[]) {
  for (const id of ids) { try { await unlink(resolve(RECEIPT_DIR(), id)); } catch { /* 이미 없음 */ } }
}

export function registerScheduleRoutes(
  app: FastifyInstance,
  api: string,
  h: { requireTripAuth: preHandlerHookHandler; requireSameOrigin: preHandlerHookHandler; email: (req: FastifyRequest) => string }
) {
  const requireOwner = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isOwnerEmail(h.email(req))) return reply.code(403).send({ error: 'owner only' });
  };
  const write = [h.requireSameOrigin, h.requireTripAuth, requireOwner];

  // 영수증 업로드 본문은 파일 그대로(Buffer) — 이 플러그인(/trip) 안에서만 적용
  app.addContentTypeParser(UPLOAD_TYPES, { parseAs: 'buffer', bodyLimit: MAX_RECEIPT }, (_req, body, done) => done(null, body));

  app.get(`${api}/schedule`, { preHandler: h.requireTripAuth }, async () => {
    const cur = getSchedule();
    return { ...cur, receipts: receiptsByItem(), geo: geoOf(cur.schedule) };
  });

  app.put(`${api}/schedule`, { preHandler: write, bodyLimit: 512 * 1024 }, async (req, reply) => {
    const b = (req.body ?? {}) as any;
    const cur = getSchedule();
    if (Number(b.baseRev) !== cur.rev) return reply.code(409).send({ error: '다른 곳에서 일정이 바뀌었습니다. 새로고침 후 다시 해 주세요.', rev: cur.rev });
    const s = cleanSchedule(b.schedule);
    if (typeof s === 'string') return reply.code(400).send({ error: s });
    const rev = cur.rev + 1;
    // 삭제된 항목에 붙어 있던 영수증 정리
    const ids = new Set([...s.days.flatMap((d) => d.items.map((i) => i.id)), ...s.todos.map((t) => t.id)]);
    const orphans = (db.prepare('SELECT id, item_id FROM trip_receipts').all() as { id: string; item_id: string }[]).filter((r) => !ids.has(r.item_id)).map((r) => r.id);
    db.transaction(() => {
      db.prepare(
        `INSERT INTO trip_schedule (id, json, rev, updated_at) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json, rev = excluded.rev, updated_at = excluded.updated_at`
      ).run(JSON.stringify(s), rev, Date.now());
      const del = db.prepare('DELETE FROM trip_receipts WHERE id = ?');
      for (const id of orphans) del.run(id);
    })();
    await deleteReceiptFiles(orphans);
    return { schedule: s, rev, receipts: receiptsByItem(), geo: geoOf(s) };
  });

  app.post(`${api}/receipts`, { preHandler: write, bodyLimit: MAX_RECEIPT }, async (req, reply) => {
    const item = (req.query as any)?.item;
    if (typeof item !== 'string' || !ID_RE.test(item)) return reply.code(400).send({ error: 'bad item' });
    const s = getSchedule().schedule;
    if (!s || !(s.days.some((d) => d.items.some((i) => i.id === item)) || (s.todos ?? []).some((t) => t.id === item)))
      return reply.code(400).send({ error: '없는 일정 항목입니다' });
    const n = (db.prepare('SELECT COUNT(*) AS c FROM trip_receipts WHERE item_id = ?').get(item) as { c: number }).c;
    if (n >= MAX_RECEIPTS_PER_ITEM) return reply.code(400).send({ error: `한 항목에 최대 ${MAX_RECEIPTS_PER_ITEM}개까지 첨부할 수 있습니다` });
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) return reply.code(400).send({ error: '파일이 비어 있습니다' });
    const mime = sniff(buf);
    if (!mime) return reply.code(415).send({ error: 'PDF 또는 사진(JPG·PNG·WEBP·HEIC)만 올릴 수 있습니다' });
    let name = 'receipt';
    try { name = decodeURIComponent(String(req.headers['x-file-name'] ?? '')) || name; } catch { /* 기본값 */ }
    name = ctrl(name.replace(/[\\/]/g, '_'), 120) || 'receipt';
    if (!/\.[A-Za-z0-9]{2,5}$/.test(name)) name += EXT[mime];
    const id = newId(12);
    await mkdir(RECEIPT_DIR(), { recursive: true });
    const tmp = resolve(RECEIPT_DIR(), `${id}.tmp`);
    await writeFile(tmp, buf);
    await rename(tmp, resolve(RECEIPT_DIR(), id));
    db.prepare('INSERT INTO trip_receipts (id, item_id, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, item, name, mime, buf.length, Date.now());
    return reply.code(201).send({ id, name, mime, size: buf.length, receipts: receiptsByItem() });
  });

  app.get(`${api}/receipts/:id`, { preHandler: h.requireTripAuth }, async (req, reply) => {
    const id = (req.params as any).id;
    if (typeof id !== 'string' || !ID_RE.test(id)) return reply.code(400).send({ error: 'bad id' });
    const r = db.prepare('SELECT name, mime FROM trip_receipts WHERE id = ?').get(id) as { name: string; mime: string } | undefined;
    if (!r) return reply.code(404).send({ error: 'not found' });
    let buf: Buffer;
    try { buf = await readFile(resolve(RECEIPT_DIR(), id)); } catch { return reply.code(404).send({ error: 'file missing' }); }
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(r.name)}`);
    return reply.type(r.mime).send(buf);
  });

  app.delete(`${api}/receipts/:id`, { preHandler: write }, async (req, reply) => {
    const id = (req.params as any).id;
    if (typeof id !== 'string' || !ID_RE.test(id)) return reply.code(400).send({ error: 'bad id' });
    const removed = db.prepare('DELETE FROM trip_receipts WHERE id = ?').run(id).changes > 0;
    if (removed) await deleteReceiptFiles([id]);
    return { ok: true, removed, receipts: receiptsByItem() };
  });
}
