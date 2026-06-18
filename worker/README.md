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

## Finnhub 키를 secret 으로 설정 (NonK 미국 주식 시세용)

Finnhub API 키는 HTML/저장소에 넣지 않고 **Worker secret(암호화 환경변수)** 으로만 보관한다.
Worker 가 `?finnhub=<TICKER>` 요청을 받으면 secret 의 키를 붙여 Finnhub 에 대신 호출한다.
따라서 키는 저장소·HTML·브라우저 어디에도 노출되지 않는다.

### 방법 A — 대시보드
1. Workers & Pages → `my-ps-proxy` → **Settings** → **Variables and Secrets**
2. **Add** → 이름 `FINNHUB_KEY`, 값에 새 키 붙여넣기, **Encrypt(Secret)** 선택 → Save
3. 변경된 `proxy.js` 코드를 편집기에 붙여넣고 **Deploy**

### 방법 B — Wrangler CLI
```bash
cd worker/
wrangler secret put FINNHUB_KEY     # 프롬프트에 새 키 붙여넣기 (저장소엔 안 남음)
wrangler deploy                     # 수정된 proxy.js 배포
```

> 설정 전이라도 NonK 는 Yahoo/Stooq 폴백으로 시세를 가져오므로 앱이 깨지지 않는다.
> 동작 확인: `https://my-ps-proxy.imgkang.workers.dev/?finnhub=AAPL` → `{"c":...,"d":...,"dp":...}`

## 무료 플랜 한도

| 항목 | 무료 한도 |
|------|-----------|
| 요청 수 | 100,000 req/일 |
| CPU 시간 | 10ms/요청 |
| 가격 | 무료 |

주식 앱 특성상 수십~수백 req/일 수준이므로 무료로 충분합니다.
