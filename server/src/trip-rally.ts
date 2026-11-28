// 가족여행 앱 「여기로 집합」 — 흩어진 일행을 지금 위치로 모으는 임시 공지.
//   GET  /trip/api/rally               → { active: Rally|null }                     (멤버 모두)
//   POST /trip/api/rally               → { lat, lng, acc?, tm?, memo?, nick? } 새 집합 요청 (멤버 모두)
//                                          · 진행 중인 요청이 있으면 'replaced' 로 끝내고 새로 만든다
//                                          · 채팅에 「📍 여기로 집합」 메시지를 자동으로 남겨 모두에게 알림(안 읽음 배지)
//   POST /trip/api/rally/:id/done      → 집합 완료: 요청을 닫고 일정에 「여기서 집합」 항목(시간·메모·위치)을 자동 추가
//   POST /trip/api/rally/:id/cancel    → 취소(일정에 기록하지 않음)
// 완료·취소는 요청한 사람 또는 소유자만. 위치는 장소 검색어를 "위도, 경도" 로 저장 → 지도·길찾기·이동선에 그대로 쓰임.
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { db } from './db.js';
import { isOwnerEmail } from './trip-expenses.js';
import { cleanSchedule, getSchedule, type SItem } from './trip-schedule.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS trip_rally (
    id         TEXT PRIMARY KEY,
    lat        REAL NOT NULL,
    lng        REAL NOT NULL,
    acc        REAL,
    tm         TEXT NOT NULL DEFAULT '',
    memo       TEXT NOT NULL DEFAULT '',
    by_uid     TEXT NOT NULL,
    by_name    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status     TEXT NOT NULL,          -- active | done | cancelled | replaced
    ended_at   INTEGER,
    sched_item TEXT                    -- 완료 시 일정에 추가된 항목 id
  );
`);

const TZ = 'Australia/Sydney';
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const TM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ctrl = (v: unknown, max: number) =>
  [...String(v ?? '').replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, '').trim()].slice(0, max).join('');

function sydParts(ms: number) {
  const o: Record<string, string> = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
  return { date: `${o.year}-${o.month}-${o.day}`, hm: `${o.hour === '24' ? '00' : o.hour}:${o.minute}` };
}

type Row = { id: string; lat: number; lng: number; acc: number | null; tm: string; memo: string; by_uid: string; by_name: string; created_at: number; status: string };
const getActive = () =>
  (db.prepare("SELECT id, lat, lng, acc, tm, memo, by_uid, by_name, created_at, status FROM trip_rally WHERE status = 'active' ORDER BY created_at DESC LIMIT 1").get() as Row | undefined) ?? null;
const view = (r: Row | null) => (r ? { id: r.id, lat: r.lat, lng: r.lng, acc: r.acc, tm: r.tm, memo: r.memo, byUid: r.by_uid, byName: r.by_name, createdAt: r.created_at } : null);

// 완료한 집합을 일정에 기록. 반환: 추가된 항목 정보 또는 건너뛴 이유.
export function addRallyToSchedule(r: Row, doneAt: number): { date: string; itemId: string } | { skipped: string } {
  const cur = getSchedule();
  if (!cur.schedule) return { skipped: '일정이 아직 서버에 없어 일정 기록은 건너뛰었어요' };
  const s = JSON.parse(JSON.stringify(cur.schedule));
  const { date } = sydParts(r.created_at);
  const day = s.days.find((d: any) => d.date === date);
  if (!day) return { skipped: `${date}은(는) 일정에 없는 날짜라 일정 기록은 건너뛰었어요` };
  const tm = r.tm || sydParts(doneAt).hm;
  // 장소: 검색어를 좌표로 → 지도·길찾기·이동선 지도가 그대로 사용
  let key = `meet_${date.replace(/-/g, '').slice(4)}_${tm.replace(':', '')}`.toLowerCase();
  for (let n = 2; s.places[key]; n++) key = `${key.slice(0, 26)}_${n}`;
  s.places[key] = { nm: r.memo ? `집합 지점 · ${r.memo}`.slice(0, 80) : `집합 지점 (${tm})`, q: `${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}`, ad: '여기로 집합 요청 위치' };
  const item: SItem = { id: 'rally' + r.id.slice(0, 12), tm, tx: '여기서 집합', place: key, meet: true, note: [r.memo, `${r.by_name}님 요청`].filter(Boolean).join(' · ') };
  // 시간 순서 자리에 끼워 넣기(HH:MM 인 항목만 비교, 나머지는 뒤에)
  const idx = day.items.findIndex((x: any) => TM_RE.test(x.tm || '') && x.tm > tm);
  if (idx < 0) day.items.push(item); else day.items.splice(idx, 0, item);
  const clean = cleanSchedule(s);
  if (typeof clean === 'string') return { skipped: '일정 기록 실패: ' + clean };
  const res = db.prepare('UPDATE trip_schedule SET json = ?, rev = rev + 1, updated_at = ? WHERE id = 1 AND rev = ?').run(JSON.stringify(clean), Date.now(), cur.rev);
  if (!res.changes) return { skipped: '일정이 방금 바뀌어 기록하지 못했어요 — 다시 시도해 주세요' };
  return { date, itemId: item.id };
}

const lastCreate = new Map<string, number>();

export function registerRallyRoutes(
  app: FastifyInstance,
  api: string,
  h: { requireTripAuth: preHandlerHookHandler; requireSameOrigin: preHandlerHookHandler; user: (req: FastifyRequest) => { id: number; email: string; name: string | null } }
) {
  const write = [h.requireSameOrigin, h.requireTripAuth];
  const canEnd = (req: FastifyRequest, r: Row) => r.by_uid === String(h.user(req).id) || isOwnerEmail(h.user(req).email);

  app.get(`${api}/rally`, { preHandler: h.requireTripAuth }, async () => ({ active: view(getActive()) }));

  app.post(`${api}/rally`, { preHandler: write, bodyLimit: 4 * 1024 }, async (req, reply) => {
    const u = h.user(req), uid = String(u.id), b = (req.body ?? {}) as any;
    const lat = Number(b.lat), lng = Number(b.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return reply.code(400).send({ error: '위치가 올바르지 않아요' });
    const acc = Number.isFinite(Number(b.acc)) && Number(b.acc) >= 0 ? Math.min(Math.round(Number(b.acc)), 100000) : null;
    const tm = typeof b.tm === 'string' && TM_RE.test(b.tm) ? b.tm : '';
    const memo = ctrl(b.memo, 80);
    const name = ctrl(b.nick, 12) || ctrl(u.name, 12) || '가족';
    const now = Date.now();
    if (now - (lastCreate.get(uid) ?? 0) < 15_000) return reply.code(429).send({ error: '잠시 후 다시 보내 주세요' });
    lastCreate.set(uid, now);
    const id = randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x');
    const text = `📍 여기로 집합!${tm ? ` ${tm}까지` : ''}${memo ? ` · ${memo}` : ''}\n장소 탭에서 위치·길찾기를 확인하세요.`;
    db.transaction(() => {
      db.prepare("UPDATE trip_rally SET status = 'replaced', ended_at = ? WHERE status = 'active'").run(now);
      db.prepare("INSERT INTO trip_rally (id, lat, lng, acc, tm, memo, by_uid, by_name, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')")
        .run(id, lat, lng, acc, tm, memo, uid, name, now);
      db.prepare("INSERT INTO trip_messages (uid, nick, kind, text, place, ts) VALUES (?, ?, 'text', ?, NULL, ?)").run(uid, name, text, now);
    })();
    return reply.code(201).send({ active: view(getActive()) });
  });

  const end = (status: 'done' | 'cancelled') => async (req: FastifyRequest, reply: FastifyReply) => {
    const id = (req.params as any).id;
    if (typeof id !== 'string' || !ID_RE.test(id)) return reply.code(400).send({ error: 'bad id' });
    const r = db.prepare("SELECT id, lat, lng, acc, tm, memo, by_uid, by_name, created_at, status FROM trip_rally WHERE id = ?").get(id) as Row | undefined;
    if (!r) return reply.code(404).send({ error: '없는 집합 요청이에요' });
    if (r.status !== 'active') return reply.code(409).send({ error: '이미 끝난 집합 요청이에요', active: view(getActive()) });
    if (!canEnd(req, r)) return reply.code(403).send({ error: '요청한 사람이나 소유자만 끝낼 수 있어요' });
    const now = Date.now();
    let sched: ReturnType<typeof addRallyToSchedule> | null = null;
    if (status === 'done') sched = addRallyToSchedule(r, now);
    db.prepare('UPDATE trip_rally SET status = ?, ended_at = ?, sched_item = ? WHERE id = ?').run(status, now, sched && 'itemId' in sched ? sched.itemId : null, id);
    return { ok: true, status, schedule: sched, active: view(getActive()) };
  };
  app.post(`${api}/rally/:id/done`, { preHandler: write }, end('done'));
  app.post(`${api}/rally/:id/cancel`, { preHandler: write }, end('cancelled'));
}
