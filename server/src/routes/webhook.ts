// GitHub Webhook — main 브랜치 push 시 git pull + (서버 소스 변경 시) 빌드·재시작 + CF 캐시 퍼지
//   POST /api/github-webhook  (GitHub HMAC 서명 검증)
//   GET  /api/update?token=<UPDATE_TOKEN>  (원격 수동 트리거)
import type { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { exec } from 'node:child_process';
import { resolve } from 'node:path';
import { env } from '../env.js';

const repoRoot = resolve(process.cwd(), '..');
const serverDir = resolve(repoRoot, 'server');

function purgeCF(log: (s: string) => void, errLog: (s: string) => void) {
  const { CLOUDFLARE_ZONE_ID: zoneId, CLOUDFLARE_API_TOKEN: cfToken } = env;
  if (!zoneId || !cfToken) return;
  fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
    body: '{"purge_everything":true}',
  })
    .then(r => r.json() as Promise<{ success: boolean; errors: unknown[] }>)
    .then(r => log(`[deploy] CF purge: ${r.success ? 'OK' : JSON.stringify(r.errors)}`))
    .catch(e => errLog('[deploy] CF purge 오류: ' + e.message));
}

export function gitPullAndPurge(log: (msg: string) => void, errLog: (msg: string) => void) {
  exec(`git -C "${repoRoot}" pull origin main`, (pullErr, stdout) => {
    if (pullErr) { errLog('[deploy] git pull 실패: ' + pullErr.message); return; }
    const pullMsg = stdout.trim();
    log('[deploy] git pull 완료:\n' + pullMsg);

    if (pullMsg.includes('Already up to date')) {
      purgeCF(log, errLog);
      return;
    }

    // pull 로 새 커밋이 반영됐을 때 server/src 변경 여부 확인 (ORIG_HEAD = pull 이전 HEAD)
    exec(`git -C "${repoRoot}" diff ORIG_HEAD HEAD --name-only`, (_e, diffOut) => {
      const changed = (diffOut ?? '').split('\n').filter(Boolean);
      const serverChanged = changed.some(f => f.startsWith('server/src/') || f === 'server/package.json');

      purgeCF(log, errLog);

      if (!serverChanged) return;

      log('[deploy] 서버 소스 변경 감지 → npm run build');
      exec('npm run build', { cwd: serverDir }, (buildErr, _out, buildStderr) => {
        if (buildErr) {
          errLog('[deploy] 빌드 실패 — 재시작 생략:\n' + buildStderr.trim());
          return;
        }
        log('[deploy] 빌드 완료 → 3초 후 재시작');
        // CF purge 및 응답 전송이 완료될 시간을 확보한 뒤 재시작
        setTimeout(() => {
          log('[deploy] 재시작 (exit 1) → Task Scheduler 재기동');
          process.exit(1);
        }, 3000);
      });
    });
  });
}

export default async function webhookRoutes(app: FastifyInstance) {
  // HMAC 검증에 rawBody가 필요 — 이 스코프에서만 Buffer로 파싱 (다른 라우트에 영향 없음)
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  // ── GitHub Webhook (자동) ──
  app.post('/api/github-webhook', async (req, reply) => {
    const rawBody = req.body as Buffer;

    // 시그니처 검증 (GITHUB_WEBHOOK_SECRET 설정 시)
    if (env.GITHUB_WEBHOOK_SECRET) {
      const sig = req.headers['x-hub-signature-256'] as string | undefined;
      const expected = 'sha256=' + createHmac('sha256', env.GITHUB_WEBHOOK_SECRET).update(rawBody).digest('hex');
      const sigBuf = Buffer.from(sig ?? '');
      const expBuf = Buffer.from(expected);
      const valid = sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
      if (!valid) return reply.code(401).send({ error: 'invalid signature' });
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    if (payload.ref !== 'refs/heads/main') {
      return { ok: true, action: 'skipped', ref: payload.ref };
    }

    reply.send({ ok: true, action: 'pulling' });
    gitPullAndPurge(s => app.log.info(s), s => app.log.error(s));
  });

  // ── 수동 원격 업데이트 (GET /api/update?token=...) ──
  app.get('/api/update', async (req, reply) => {
    if (!env.UPDATE_TOKEN) return reply.code(403).send({ error: 'UPDATE_TOKEN not configured' });
    const { token } = req.query as { token?: string };
    if (!token || token !== env.UPDATE_TOKEN) return reply.code(401).send({ error: 'invalid token' });

    reply.send({ ok: true, action: 'pulling', ts: new Date().toISOString() });
    gitPullAndPurge(s => app.log.info(s), s => app.log.error(s));
  });

  // ── git 상태 진단 (GET /api/git-status?token=...) ──
  app.get('/api/git-status', async (req, reply) => {
    if (!env.UPDATE_TOKEN) return reply.code(403).send({ error: 'UPDATE_TOKEN not configured' });
    const { token } = req.query as { token?: string };
    if (!token || token !== env.UPDATE_TOKEN) return reply.code(401).send({ error: 'invalid token' });

    const run = (cmd: string) => new Promise<string>((res) =>
      exec(cmd, (_e, stdout, stderr) => res((stdout || stderr || '').trim()))
    );
    const [head, remote, remoteUrl, status] = await Promise.all([
      run(`git -C "${repoRoot}" rev-parse --short HEAD`),
      run(`git -C "${repoRoot}" rev-parse --short origin/main 2>/dev/null || echo fetch_needed`),
      run(`git -C "${repoRoot}" remote get-url origin`),
      run(`git -C "${repoRoot}" status --short`),
    ]);
    reply.send({ head, remote, remoteUrl, status: status || 'clean', ts: new Date().toISOString() });
  });
}
