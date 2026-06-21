// 인메모리 요청 지표 — 서버 재시작 시 초기화됨.
const MAX_TS = 3600; // 최근 1시간 타임스탬프만 보관

export const metrics = {
  startedAt: Date.now(),
  total: 0,
  recentTs: [] as number[], // 최근 요청 Unix ms 목록 (1시간 롤링)
  byRoute: {} as Record<string, number>,
  lastAt: null as number | null,
};

export function recordRequest(routePath: string) {
  const now = Date.now();
  metrics.total++;
  metrics.lastAt = now;
  metrics.byRoute[routePath] = (metrics.byRoute[routePath] ?? 0) + 1;

  metrics.recentTs.push(now);
  // 1시간 초과 항목 제거 (배열 앞부분부터 오래된 것)
  const cutoff = now - 3600_000;
  let i = 0;
  while (i < metrics.recentTs.length && metrics.recentTs[i] < cutoff) i++;
  if (i > 0) metrics.recentTs.splice(0, i);

  // 메모리 안전: 타임스탬프 최대 MAX_TS 개만 보관
  if (metrics.recentTs.length > MAX_TS) metrics.recentTs.shift();
}
