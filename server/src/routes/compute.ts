// 계산 엔드포인트 — 독점 계산 로직을 서버 전용으로 숨긴다.
//   POST /api/compute/withdrawal  → 인출 시뮬레이션 (연도별 투영 결과)
//
// 프론트는 초기 잔액(initState)·스칼라 입력만 보내고, 알고리즘은 서버에만 존재한다.
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth.js';
import { simulateWithdrawal, type WithdrawalInput } from '../compute/withdrawal.js';

export default async function computeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.post('/api/compute/withdrawal', async (req, reply) => {
    const body = req.body as Partial<WithdrawalInput> | undefined;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'invalid input' });
    }
    if (!Array.isArray(body.years) || !Array.isArray(body.allAccIds) ||
        !body.initState || typeof body.initState !== 'object') {
      return reply.code(400).send({ error: 'years, allAccIds, initState required' });
    }
    try {
      return simulateWithdrawal(body as WithdrawalInput);
    } catch (e) {
      req.log.error(e, 'withdrawal simulate failed');
      return reply.code(500).send({ error: 'simulation failed' });
    }
  });
}
