// 클라이언트 참여도 이벤트 수집.
//   POST /api/events  → { fgSeconds, navCount, feats[] } 를 누계/일자 롤업에 반영.
//
// 저장(save)은 서버 PUT /api/sync 에서 집계하므로 여기서는 받지 않는다(이중 계상 방지).
// 입력 "내용"은 받지 않으며 횟수/시간/기능명(짧은 토큰)만 처리한다.
import type { FastifyInstance } from 'fastify';
import { requireAuth, userId } from '../auth.js';
import { bumpActivity } from '../engagement.js';

export default async function eventsRoutes(app: FastifyInstance) {
  app.post('/api/events', { preHandler: requireAuth }, async (req) => {
    const b = (req.body ?? {}) as any;
    const fgSeconds = Number(b.fgSeconds) || 0;
    const navCount = Number(b.navCount) || 0;
    const feats = Array.isArray(b.feats) ? b.feats.slice(0, 32).map((x: unknown) => String(x)) : [];
    bumpActivity(userId(req), { fgSeconds, navCount, feats });
    return { ok: true };
  });
}
