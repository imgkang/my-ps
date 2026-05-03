# Cloudflare Worker 배포 가이드

## 방법 A — 대시보드 (가장 쉬움, 5분)

1. https://cloudflare.com 가입 (무료)
2. 왼쪽 메뉴 **Workers & Pages** → **Create**
3. **Create Worker** 클릭
4. 기본 코드를 모두 지우고 `proxy.js` 내용을 붙여넣기
5. **Deploy** 클릭
6. 배포 완료 후 표시되는 URL 복사  
   예: `https://mypm-proxy.yourname.workers.dev`
7. `KDeal.html` 과 `NonK.html` 상단의 설정값 업데이트:
   ```javascript
   const CF_WORKER = 'https://mypm-proxy.yourname.workers.dev';
   ```

## 방법 B — Wrangler CLI

```bash
npm install -g wrangler
wrangler login
cd worker/
wrangler deploy
```

## 무료 플랜 한도

| 항목 | 무료 한도 |
|------|-----------|
| 요청 수 | 100,000 req/일 |
| CPU 시간 | 10ms/요청 |
| 가격 | 무료 |

주식 앱 특성상 수십~수백 req/일 수준이므로 무료로 충분합니다.
