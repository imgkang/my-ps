// 사용자 능동 참여도(Engagement) 집계 + 점수화.
//
// 신호 분리(이중 계상 방지):
//   - Depth(저장)   : 서버 PUT /api/sync 성공 시 1건 (= 데이터가 실제로 영속된 능동 수정)
//   - Intensity(시간): 클라가 보내는 포그라운드 체류초 (실제로 보고 있는 시간)
//   - Breadth(폭)   : 클라가 보내는 사용 기능(feat) 집합 + 탭/앱 전환수
//   - Frequency(빈도): activity_daily 에 행이 생긴 "활동일수"
//   - Recency(최근성): user_activity.last_active
//
// 개인정보: 입력 "내용"은 저장하지 않는다. 횟수/시간/기능명(짧은 토큰)만 집계.
import { db } from './db.js';

// 점수 가중치 (합 = 1). 사용자가 "능동적 업데이트"를 강조 → Depth 최대.
export const WEIGHTS = { D: 0.35, I: 0.25, B: 0.15, F: 0.15, R: 0.1 };

export const WINDOW_DAYS = 28; // 롤링 집계 윈도
const CAP_SAVES = 50; // 윈도 내 저장 50회 → 1.0
const CAP_FG_MIN = 600; // 윈도 내 포그라운드 600분(10h) → 1.0
const CAP_FEATS = 8; // distinct 기능 8개 → 1.0
const RECENCY_DAYS = 14; // 14일 지나면 R=0

function dayStr(d = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export interface ActivityInc {
  req?: boolean; // 인증요청 1건(패시브)
  save?: number; // 능동 저장 건수
  fgSeconds?: number; // 포그라운드 체류초
  navCount?: number; // 탭/앱 전환수
  feats?: string[]; // 사용 기능 토큰
}

// 사용자 활동 누계 + 일자 롤업 갱신. 모든 집계 진입점.
export function bumpActivity(userId: number, inc: ActivityInc): void {
  if (!userId) return;
  const now = new Date().toISOString();
  const save = Math.max(0, Math.min(Number(inc.save) || 0, 1000));
  const fg = Math.max(0, Math.min(Number(inc.fgSeconds) || 0, 86400)); // 하루 상한
  const nav = Math.max(0, Math.min(Number(inc.navCount) || 0, 10000));
  const req = inc.req ? 1 : 0;

  // 누계 테이블 (행 보장 후 증분)
  db.prepare(
    `INSERT INTO user_activity (user_id, last_active, req_count, save_count, fg_seconds, nav_count)
     VALUES (?, ?, 0, 0, 0, 0)
     ON CONFLICT(user_id) DO NOTHING`
  ).run(userId, now);
  db.prepare(
    `UPDATE user_activity
       SET last_active = ?, req_count = req_count + ?, save_count = save_count + ?,
           fg_seconds = fg_seconds + ?, nav_count = nav_count + ?
     WHERE user_id = ?`
  ).run(now, req, save, fg, nav, userId);

  // 일자 롤업은 "실제 상호작용"이 있을 때만 생성/갱신 (요청만 있는 날은 활동일로 안 침).
  const hasInteraction = save > 0 || fg > 0 || nav > 0 || (inc.feats && inc.feats.length > 0);
  if (!hasInteraction) return;

  const day = dayStr();
  db.prepare(
    `INSERT INTO activity_daily (user_id, day, saves, fg_sec, navs, feats)
     VALUES (?, ?, 0, 0, 0, '')
     ON CONFLICT(user_id, day) DO NOTHING`
  ).run(userId, day);
  db.prepare(
    `UPDATE activity_daily SET saves = saves + ?, fg_sec = fg_sec + ?, navs = navs + ?
     WHERE user_id = ? AND day = ?`
  ).run(save, fg, nav, userId, day);

  if (inc.feats && inc.feats.length) {
    const row = db
      .prepare('SELECT feats FROM activity_daily WHERE user_id = ? AND day = ?')
      .get(userId, day) as { feats: string } | undefined;
    const set = new Set((row?.feats || '').split(',').filter(Boolean));
    for (const raw of inc.feats) {
      const f = String(raw);
      if (set.size < 64 && /^[a-z0-9_:-]{1,24}$/i.test(f)) set.add(f);
    }
    db.prepare('UPDATE activity_daily SET feats = ? WHERE user_id = ? AND day = ?').run(
      [...set].join(','),
      userId,
      day
    );
  }
}

export type Tier = '휴면' | '라이트' | '액티브' | '파워유저';
function tierOf(score: number): Tier {
  if (score < 20) return '휴면';
  if (score < 45) return '라이트';
  if (score < 75) return '액티브';
  return '파워유저';
}

export interface UserScore {
  userId: number;
  email: string;
  name: string | null;
  score: number;
  tier: Tier;
  saves: number;
  fgMinutes: number;
  activeDays: number;
  navs: number;
  featCount: number;
  lastActive: string | null;
}

// 사용자별 RFDBI 점수 (롤링 windowDays). 점수 내림차순.
export function computeScores(windowDays = WINDOW_DAYS): UserScore[] {
  const cutoff = dayStr(new Date(Date.now() - windowDays * 86400_000));
  const users = db.prepare('SELECT id, email, name FROM users').all() as {
    id: number;
    email: string;
    name: string | null;
  }[];

  const out: UserScore[] = [];
  for (const u of users) {
    const rows = db
      .prepare(
        'SELECT day, saves, fg_sec, navs, feats FROM activity_daily WHERE user_id = ? AND day >= ?'
      )
      .all(u.id, cutoff) as { day: string; saves: number; fg_sec: number; navs: number; feats: string }[];
    const ua = db.prepare('SELECT last_active FROM user_activity WHERE user_id = ?').get(u.id) as
      | { last_active: string | null }
      | undefined;

    let saves = 0,
      fg = 0,
      navs = 0;
    const feats = new Set<string>();
    const activeDays = new Set<string>();
    for (const r of rows) {
      saves += r.saves;
      fg += r.fg_sec;
      navs += r.navs;
      if (r.saves || r.fg_sec || r.navs) activeDays.add(r.day);
      (r.feats || '').split(',').filter(Boolean).forEach((f) => feats.add(f));
    }

    const fgMin = fg / 60;
    const D = Math.min(saves / CAP_SAVES, 1);
    const I = Math.min(fgMin / CAP_FG_MIN, 1);
    const B = Math.min(feats.size / CAP_FEATS, 1);
    const F = Math.min(activeDays.size / windowDays, 1);
    let R = 0;
    if (ua?.last_active) {
      const ageDays = (Date.now() - Date.parse(ua.last_active)) / 86400_000;
      R = 1 - Math.min(ageDays / RECENCY_DAYS, 1);
    }
    const score = Math.round(100 * (WEIGHTS.D * D + WEIGHTS.I * I + WEIGHTS.B * B + WEIGHTS.F * F + WEIGHTS.R * R));

    out.push({
      userId: u.id,
      email: u.email,
      name: u.name,
      score,
      tier: tierOf(score),
      saves,
      fgMinutes: Math.round(fgMin),
      activeDays: activeDays.size,
      navs,
      featCount: feats.size,
      lastActive: ua?.last_active ?? null,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
