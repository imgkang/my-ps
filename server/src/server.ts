// My PM 백엔드 진입점 — Fastify 앱 구성 및 라우트 등록.
import './env.js';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './env.js';
import './db.js';
import { seedAllowedEmails } from './allowlist.js';
import authRoutes from './auth.js';
import priceRoutes from './routes/price.js';
import syncRoutes from './routes/sync.js';
import searchRoutes from './routes/search.js';
import pushRoutes from './routes/push.js';
import webhookRoutes from './routes/webhook.js';
import adminRoutes from './routes/admin.js';
import computeRoutes from './routes/compute.js';
import derivedRoutes from './routes/derived.js';
import eventsRoutes from './routes/events.js';
import { startScheduler } from './scheduler.js';
import { recordRequest } from './metrics.js';
import { recordBenchAndNotify } from './bench/index.js';

// 잡히지 않은 예외 — 로그 남기고 종료 (Task Scheduler 가 재시작)
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
  process.exit(1);
});

// .env ALLOWED_EMAILS + OWNER_EMAIL 을 DB 허용목록으로 시딩(기존 설정 이관, 1회).
seedAllowedEmails();

const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 }); // 번들이 클 수 있어 25MB

// 모든 요청 카운트
app.addHook('onRequest', async (req) => { recordRequest(req.routeOptions?.url ?? req.url); });

// Capacitor WebView(capacitor://localhost / ionic://) 및 로컬 개발 허용
await app.register(cors, { origin: true });

app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));

await app.register(authRoutes);
await app.register(priceRoutes);
await app.register(syncRoutes);
await app.register(searchRoutes);
await app.register(pushRoutes);
await app.register(webhookRoutes);
await app.register(adminRoutes);
await app.register(computeRoutes);
await app.register(derivedRoutes);
await app.register(eventsRoutes);

// 프론트 정적 서빙 (로컬 테스트용 단일 출처). API 라우트 등록 뒤에 둔다.
// 보안 가드: server/(=.env·DB), .git, dotfile 은 절대 서빙하지 않는다.
if (env.SERVE_STATIC) {
  const fastifyStatic = (await import('@fastify/static')).default;
  await app.register(fastifyStatic, {
    root: resolve(process.cwd(), '..'), // 저장소 루트(index.html 등)
    prefix: '/',
    index: ['index.html'],
    allowedPath: (pathName: string) => {
      const p = pathName.toLowerCase();
      if (p === '/server' || p.startsWith('/server/')) return false; // .env·DB 차단
      if (p.startsWith('/.')) return false; // /.git, /.env 등 dotpath 차단
      if (p.split('/').some((seg) => seg.startsWith('.'))) return false; // 중첩 dotfile 차단
      return true;
    },
  });
}

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`My PM 백엔드 실행 중 — http://0.0.0.0:${env.PORT} [v0.601]`);
  startScheduler();
  // 배포(서버 소스 변경→재시작) 후 1회 성과측정·푸시. 같은 sha 면 내부에서 스킵.
  recordBenchAndNotify((s) => app.log.info(s), (s) => app.log.error(s));
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
