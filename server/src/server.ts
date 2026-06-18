// My PM 백엔드 진입점 — Fastify 앱 구성 및 라우트 등록.
import './env.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './env.js';
import './db.js';
import authRoutes from './auth.js';
import priceRoutes from './routes/price.js';
import syncRoutes from './routes/sync.js';
import searchRoutes from './routes/search.js';
import pushRoutes from './routes/push.js';

const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 }); // 번들이 클 수 있어 25MB

// Capacitor WebView(capacitor://localhost / ionic://) 및 로컬 개발 허용
await app.register(cors, { origin: true });

app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));

await app.register(authRoutes);
await app.register(priceRoutes);
await app.register(syncRoutes);
await app.register(searchRoutes);
await app.register(pushRoutes);

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`My PM 백엔드 실행 중 — http://0.0.0.0:${env.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
