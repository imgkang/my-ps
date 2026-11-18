// 가족여행 앱 — 장소 좌표 캐시(일정 탭 「날짜별 이동선」 지도용).
// 장소의 구글지도 검색어(q)로 OpenStreetMap Nominatim 에서 좌표를 한 번만 찾아 DB 에 저장한다.
//  - 일정 JSON 은 건드리지 않는다(rev 충돌 없음). GET /trip/api/schedule 응답에 geo: { [q]: [lat, lng] } 로 붙는다.
//  - 검색어가 "-33.85, 151.21" 처럼 좌표면 조회 없이 그 값을 쓴다(지오코딩이 틀린 장소를 바로잡는 방법).
//  - Nominatim 이용 정책: 초당 1건 이하, 식별 가능한 User-Agent, 결과 캐시. 실패는 하루 뒤 재시도.
import { db } from './db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS trip_geo (
    q          TEXT PRIMARY KEY,
    lat        REAL,
    lng        REAL,
    checked_at INTEGER NOT NULL
  );
`);

const RETRY_MS = 24 * 60 * 60 * 1000;
const GAP_MS = 1100;
const UA = 'MyPM-trip-planner/1.0 (family trip app; low volume)';
const COORD_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

type Row = { q: string; lat: number | null; lng: number | null; checked_at: number };

export function parseCoord(q: string): [number, number] | null {
  const m = COORD_RE.exec(q);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
}

// Nominatim 은 "Wharf 6 Circular Quay" 같은 긴 검색어를 못 찾는 일이 많다 → 검색어·주소를 차례로 줄여 가며 시도.
// (괄호 설명 제거 → 앞 쉼표 구간 제거 → 앞 단어 제거, 최대 6개. 지도는 「간략」 용도라 근처 좌표면 충분)
export function candidates(q: string, ad = ''): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    s = (s || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '');
    if (s.length >= 3 && !out.includes(s)) out.push(s);
  };
  for (const src of [q, ad]) {
    add(src);
    const parts = (src || '').split(',').map((x) => x.trim()).filter(Boolean);
    for (let i = 1; i < parts.length; i++) if (parts.slice(i).join(' ').split(' ').length >= 2) add(parts.slice(i).join(', '));
  }
  const words = (q || '').replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  for (let i = 1; i <= words.length - 2; i++) add(words.slice(i).join(' '));
  return out.slice(0, 6);
}

// 장소 목록 → 이미 아는 좌표(키 = 검색어 q). 모르는 것은 백그라운드 조회를 건다(응답을 기다리지 않음).
export function geoFor(places: { q: string; ad?: string }[]): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  const now = Date.now();
  const sel = db.prepare('SELECT q, lat, lng, checked_at FROM trip_geo WHERE q = ?');
  for (const p of places) {
    const q = p.q;
    if (out[q]) continue;
    const c = parseCoord(q);
    if (c) { out[q] = c; continue; }
    const r = sel.get(q) as Row | undefined;
    if (r && r.lat != null && r.lng != null) out[q] = [r.lat, r.lng];
    else if (!r || now - r.checked_at > RETRY_MS) enqueue(q, p.ad ?? '');
  }
  return out;
}

const queue: { q: string; ad: string }[] = [];
let running = false;
function enqueue(q: string, ad: string) {
  if (!queue.some((x) => x.q === q)) queue.push({ q, ad });
  if (!running) void drain();
}
async function lookup(s: string): Promise<[number, number] | null> {
  await new Promise((r) => setTimeout(r, GAP_MS)); // 초당 1건 이하
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(s);
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const j = (await res.json()) as Array<{ lat: string; lon: string }>;
    const lat = Number(j[0]?.lat), lng = Number(j[0]?.lon);
    return j[0] && Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
  } catch {
    return null; // 네트워크 오류 → 하루 뒤 재시도
  }
}
async function drain() {
  running = true;
  try {
    while (queue.length) {
      const { q, ad } = queue.shift()!;
      let hit: [number, number] | null = null;
      for (const s of candidates(q, ad)) if ((hit = await lookup(s))) break;
      const [lat, lng] = hit ?? [null, null];
      db.prepare(
        `INSERT INTO trip_geo (q, lat, lng, checked_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(q) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, checked_at = excluded.checked_at`
      ).run(q, lat, lng, Date.now());
    }
  } finally {
    running = false;
  }
}
