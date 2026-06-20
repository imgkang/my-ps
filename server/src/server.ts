// My PM 백엔드 진입점 — Fastify 앱 구성 및 라우트 등록.
import './env.js';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './env.js';
import './db.js';
import authRoutes from './auth.js';
import priceRoutes from './routes/price.js';
import syncRoutes from './routes/sync.js';
import searchRoutes from './routes/search.js';
import pushRoutes from './routes/push.js';
import webhookRoutes from './routes/webhook.js';
import { startScheduler } from './scheduler.js';

const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 }); // 번들이 클 수 있어 25MB

// Capacitor WebView(capacitor://localhost / ionic://) 및 로컬 개발 허용
await app.register(cors, { origin: true });

app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));

await app.register(authRoutes);
await app.register(priceRoutes);
await app.register(syncRoutes);
await app.register(searchRoutes);
await app.register(pushRoutes);
await app.register(webhookRoutes);

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
  app.log.info(`My PM 백엔드 실행 중 — http://0.0.0.0:${env.PORT}`);
  startScheduler();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
