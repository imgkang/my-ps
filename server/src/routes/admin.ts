// 관리자 API — 서버 상태 조회 및 재시작
// 모든 엔드포인트는 UPDATE_TOKEN 으로 보호됨.
import type { FastifyInstance } from 'fastify';
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { exec } from 'node:child_process';
import { env } from '../env.js';
import { db } from '../db.js';
import { metrics } from '../metrics.js';
import { restartSelf } from './webhook.js';
import { listAllowedEmails, addAllowedEmail, removeAllowedEmail } from '../allowlist.js';
import { runBench, storeSnapshot, latestSnapshot, history, withDeltas, frontendCompare } from '../bench/index.js';

// 큰 로그 파일에서 끝부분 maxBytes 만 읽어온다 (전체 로딩 방지).
function tailBytes(path: string, maxBytes: number): string {
  const st = statSync(path);
  const start = Math.max(0, st.size - maxBytes);
  const len = st.size - start;
  if (len <= 0) return '';
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, start);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

// pino JSON 한 줄 → 화면용 객체. JSON 이 아니면(예: Node 크래시 스택) 원문 그대로.
function parseLine(line: string): { time: string | null; level: number | null; msg: string; raw: string } {
  try {
    const o = JSON.parse(line);
    if (typeof o === 'object' && o) {
      return {
        time: typeof o.time === 'number' ? new Date(o.time).toISOString() : null,
        level: typeof o.level === 'number' ? o.level : null,
        msg: o.msg ?? o.err?.message ?? '',
        raw: line,
      };
    }
  } catch { /* JSON 아님 */ }
  return { time: null, level: null, msg: line, raw: line };
}

function checkToken(req: any, reply: any): boolean {
  if (!env.UPDATE_TOKEN) { reply.code(403).send({ error: 'UPDATE_TOKEN not configured' }); return false; }
  const token = (req.query as any).token ?? (req.headers['x-admin-token'] as string);
  if (!token || token !== env.UPDATE_TOKEN) { reply.code(401).send({ error: 'invalid token' }); return false; }
  return true;
}

function uptimeHuman(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [d && `${d}일`, h && `${h}시간`, m && `${m}분`, `${sec}초`].filter(Boolean).join(' ');
}

function readAppVersion(): string {
  const swPath = resolve(process.cwd(), '../sw.js');
  if (!existsSync(swPath)) return 'unknown';
  try {
    const content = readFileSync(swPath, 'utf8');
    const m = content.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : 'unknown';
  } catch { return 'unknown'; }
}

function getTaskStates(): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    exec(
      'powershell -NoProfile -Command "Get-ScheduledTask MyPMBackend,MyPMTunnel | Select-Object TaskName,State | ConvertTo-Json"',
      (_err, stdout) => {
        try {
          const raw = JSON.parse(stdout.trim());
          const arr = Array.isArray(raw) ? raw : [raw];
          const result: Record<string, string> = {};
          for (const t of arr) result[t.TaskName] = t.State;
          resolve(result);
        } catch { resolve({}); }
      }
    );
  });
}

export default async function adminRoutes(app: FastifyInstance) {

  // GET /api/admin/status?token=...
  app.get('/api/admin/status', async (req, reply) => {
    if (!checkToken(req, reply)) return;

    const now = Date.now();
    const uptimeMs = now - metrics.startedAt;
    const mem = process.memoryUsage();
    const last1h = metrics.recentTs.length; // recentTs 는 항상 1시간 이내만 보관
    const last5m = metrics.recentTs.filter(t => t >= now - 300_000).length;

    const userCount = (db.prepare('SELECT COUNT(*) as n FROM users').get() as any).n as number;
    const deviceCount = (db.prepare('SELECT COUNT(*) as n FROM devices').get() as any).n as number;
    const alertCount = (db.prepare('SELECT COUNT(*) as n FROM alerts WHERE active=1').get() as any).n as number;
    const bundleCount = (db.prepare('SELECT COUNT(*) as n FROM data_bundle').get() as any).n as number;

    const tasks = await getTaskStates();

    return {
      ok: true,
      uptime_ms: uptimeMs,
      uptime_human: uptimeHuman(uptimeMs),
      started_at: new Date(metrics.startedAt).toISOString(),
      app_version: readAppVersion(),
      memory: {
        rss_mb: +(mem.rss / 1024 / 1024).toFixed(1),
        heap_used_mb: +(mem.heapUsed / 1024 / 1024).toFixed(1),
        heap_total_mb: +(mem.heapTotal / 1024 / 1024).toFixed(1),
      },
      requests: {
        total: metrics.total,
        last_5m: last5m,
        last_1h: last1h,
        last_at: metrics.lastAt ? new Date(metrics.lastAt).toISOString() : null,
        by_route: metrics.byRoute,
      },
      db: {
        users: userCount,
        devices: deviceCount,
        active_alerts: alertCount,
        data_bundles: bundleCount,
      },
      tasks,
      ts: new Date().toISOString(),
    };
  });

  // GET /api/admin/derived?token=...
  //   사용자별 data_bundle 버전 vs 파생(derived) 버전·pricedAt·총액·XIRR 진단(서버 진실값).
  //   "편집 후 갱신했는데 XIRR 이 안 바뀐다" 류를 admin 화면에서 바로 확인하기 위함.
  app.get('/api/admin/derived', async (req, reply) => {
    if (!checkToken(req, reply)) return;
    const rows = db.prepare(`
      SELECT u.id AS user_id, u.email,
             b.version AS bundle_version, b.updated_at AS bundle_updated_at,
             d.data_version AS derived_version, d.priced_at AS priced_at,
             d.json AS derived_json, d.updated_at AS derived_updated_at
      FROM users u
      LEFT JOIN data_bundle b ON b.user_id = u.id
      LEFT JOIN derived d     ON d.user_id = u.id
      ORDER BY u.id
    `).all() as any[];
    const users = rows.map((r) => {
      let totals: any = null, kdXirr: number | null = null;
      try {
        const j = JSON.parse(r.derived_json || '{}');
        totals = j.totals || null;
        kdXirr = j.kd && j.kd.totals ? j.kd.totals.xirr : null;
      } catch { /* ignore */ }
      return {
        email: r.email,
        bundle_version: r.bundle_version ?? null,
        bundle_updated_at: r.bundle_updated_at ?? null,
        derived_version: r.derived_version ?? null,
        priced_at: r.priced_at ?? null,
        derived_updated_at: r.derived_updated_at ?? null,
        synced: r.bundle_version != null && r.derived_version != null
                && Number(r.bundle_version) === Number(r.derived_version),
        totals, // { totalValue, totalCash, totalPrincipal, xirr }
        kd_xirr: kdXirr,
      };
    });
    return { ok: true, users, ts: new Date().toISOString() };
  });

  // GET /api/admin/logs?token=...&lines=N&errorsOnly=1
  //   server.log 의 끝부분을 읽어 최근 N줄(또는 오류/경고만) 반환.
  app.get('/api/admin/logs', async (req, reply) => {
    if (!checkToken(req, reply)) return;
    const q = req.query as { lines?: string; errorsOnly?: string };
    const n = Math.min(Math.max(parseInt(q.lines ?? '120', 10) || 120, 1), 1000);
    const errorsOnly = q.errorsOnly === '1' || q.errorsOnly === 'true';

    const logPath = resolve(process.cwd(), env.LOG_PATH);
    if (!existsSync(logPath)) {
      return { ok: true, count: 0, lines: [], note: 'server.log 가 아직 없습니다 (Task Scheduler 로그 리다이렉트 확인).' };
    }

    try {
      // 오류만 볼 때는 요청 로그 노이즈 사이에서 찾아야 하므로 더 많이 읽는다.
      const text = tailBytes(logPath, errorsOnly ? 2 * 1024 * 1024 : 256 * 1024);
      let lines = text.split(/\r?\n/).filter(Boolean).map(parseLine);
      if (errorsOnly) {
        // level>=40(warn/error/fatal) 또는 JSON 이 아닌 줄(크래시 스택 등)만
        lines = lines.filter((l) => (l.level != null && l.level >= 40) || l.level == null);
      }
      lines = lines.slice(-n);
      return { ok: true, count: lines.length, errorsOnly, lines };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  // GET /api/admin/bench?token=...[&run=1][&base=<gitref>][&n=20]
  //   성과측정 결과 조회. run=1 이면 즉석 측정·저장. base 지정 시 해당 ref 대비 프론트 크기 비교.
  app.get('/api/admin/bench', async (req, reply) => {
    if (!checkToken(req, reply)) return;
    const q = req.query as { run?: string; base?: string; n?: string };
    const n = Math.min(Math.max(parseInt(q.n ?? '20', 10) || 20, 1), 100);

    let latest = latestSnapshot();
    let ran = false;
    if (q.run === '1' || q.run === 'true') {
      latest = await runBench();
      storeSnapshot(latest);
      ran = true;
    }
    const hist = history(n);
    const prev = hist.find((h) => latest && h.sha !== latest.sha) ?? hist[1] ?? null;
    return {
      ok: true,
      ran,
      latest: latest ? withDeltas(latest, prev) : null,
      baseCompare: q.base ? frontendCompare(q.base) : undefined,
      history: hist,
    };
  });

  // POST /api/admin/restart?token=...  — 독립 프로세스(restartSelf)로 태스크 재시작.
  // (webhook 자동배포와 동일 방식: exit 1 + Task Scheduler 실패-재시작 정책에 의존하지 않아 신뢰성↑)
  app.post('/api/admin/restart', async (req, reply) => {
    if (!checkToken(req, reply)) return;
    reply.send({ ok: true, message: '재시작 중... 약 10초 후 복구됩니다.' });
    app.log.warn('[admin] 관리자 요청으로 재시작 (독립 프로세스)');
    restartSelf(s => app.log.info(s), s => app.log.error(s));
  });

  // POST /api/admin/restart-task?token=...  — Task Scheduler 태스크 재시작 (cloudflared 포함)
  app.post('/api/admin/restart-task', async (req, reply) => {
    if (!checkToken(req, reply)) return;
    const { task } = req.query as { task?: string };
    const allowed = ['MyPMBackend', 'MyPMTunnel'];
    if (!task || !allowed.includes(task)) {
      return reply.code(400).send({ error: `task must be one of: ${allowed.join(', ')}` });
    }
    reply.send({ ok: true, message: `${task} 재시작 중...` });
    exec(
      `powershell -NoProfile -Command "Stop-ScheduledTask ${task}; Start-ScheduledTask ${task}"`,
      (err) => { if (err) app.log.error(`[admin] ${task} 재시작 실패: ${err.message}`); }
    );
  });

  // ── 로그인 허용목록(테스터 관리) ──
  // GET /api/admin/allowlist?token=...  — 허용 이메일 목록(가입 여부 포함)
  app.get('/api/admin/allowlist', async (req, reply) => {
    if (!checkToken(req, reply)) return;
    return { emails: listAllowedEmails(), owner: env.OWNER_EMAIL || null };
  });

  // POST /api/admin/allowlist?token=...  body: { email, note? }  — 이메일 추가
  app.post('/api/admin/allowlist', async (req, reply) => {
    if (!checkToken(req, reply)) return;
    const { email, note } = (req.body ?? {}) as { email?: string; note?: string };
    if (!email || !email.trim()) return reply.code(400).send({ error: 'missing email' });
    try {
      const added = addAllowedEmail(email, note);
      app.log.info(`[admin] 허용목록 추가: ${email.trim().toLowerCase()} (신규=${added})`);
      return { ok: true, added };
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message === 'invalid email' ? '이메일 형식이 올바르지 않습니다' : '추가 실패' });
    }
  });

  // DELETE /api/admin/allowlist?token=...&email=...  — 이메일 제거(소유자 제외)
  app.delete('/api/admin/allowlist', async (req, reply) => {
    if (!checkToken(req, reply)) return;
    const email = (req.query as any).email as string | undefined;
    if (!email || !email.trim()) return reply.code(400).send({ error: 'missing email' });
    try {
      const removed = removeAllowedEmail(email);
      app.log.info(`[admin] 허용목록 삭제: ${email.trim().toLowerCase()} (삭제됨=${removed})`);
      return { ok: true, removed };
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message === 'cannot remove owner' ? '소유자 이메일은 삭제할 수 없습니다' : '삭제 실패' });
    }
  });
}
