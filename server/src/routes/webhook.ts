// GitHub Webhook — main 브랜치 push 시 git pull + Cloudflare 캐시 퍼지 자동 실행
//   POST /api/github-webhook
//   GitHub 설정: Content type = application/json, Secret = GITHUB_WEBHOOK_SECRET
import type { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { exec } from 'node:child_process';
import { resolve } from 'node:path';
import { env } from '../env.js';

export default async function webhookRoutes(app: FastifyInstance) {
  // HMAC 검증에 rawBody가 필요 — 이 스코프에서만 Buffer로 파싱 (다른 라우트에 영향 없음)
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

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

    // main 브랜치 push만 처리
    if (payload.ref !== 'refs/heads/main') {
      return { ok: true, action: 'skipped', ref: payload.ref };
    }

    // 응답은 즉시 반환 — pull/purge는 백그라운드 실행
    reply.send({ ok: true, action: 'pulling' });

    const repoRoot = resolve(process.cwd(), '..');
    exec(`git -C "${repoRoot}" pull origin main`, (pullErr, stdout) => {
      if (pullErr) {
        app.log.error('[webhook] git pull 실패: ' + pullErr.message);
        return;
      }
      app.log.info('[webhook] git pull 완료:\n' + stdout.trim());

      const { CLOUDFLARE_ZONE_ID: zoneId, CLOUDFLARE_API_TOKEN: cfToken } = env;
      if (!zoneId || !cfToken) return;

      fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
        body: '{"purge_everything":true}',
      })
        .then(r => r.json() as Promise<{ success: boolean; errors: unknown[] }>)
        .then(r => app.log.info(`[webhook] CF purge: ${r.success ? 'OK' : JSON.stringify(r.errors)}`))
        .catch(e => app.log.error('[webhook] CF purge 오류: ' + e.message));
    });
  });
}
