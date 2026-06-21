// 관리자 API — 서버 상태 조회 및 재시작
// 모든 엔드포인트는 UPDATE_TOKEN 으로 보호됨.
import type { FastifyInstance } from 'fastify';
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { exec } from 'node:child_process';
import { env } from '../env.js';
import { db } from '../db.js';
import { metrics } from '../metrics.js';

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

  // POST /api/admin/restart?token=...  — 의도적으로 비정상 종료(exit 1)하여
  // Task Scheduler 의 "실패 시 재시작" 정책으로 재기동시킨다.
  // (cmd 래퍼 + 실패 시 재시작 구성에서는 exit 0(정상)이면 재시작되지 않으므로 1로 종료)
  app.post('/api/admin/restart', async (req, reply) => {
    if (!checkToken(req, reply)) return;
    reply.send({ ok: true, message: '재시작 중... 약 1분 후 복구됩니다.' });
    setTimeout(() => {
      app.log.warn('[admin] 관리자 요청으로 의도적 종료(exit 1) → Task Scheduler 재시작 트리거');
      process.exit(1);
    }, 200);
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
}
