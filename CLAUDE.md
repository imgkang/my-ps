# My PM - Claude 작업 규칙

## UI 작업 규칙
- **화면 구성(레이아웃/UI)이 바뀌면 항상 스크린샷을 먼저 보여줄 것**
  - Playwright(전역 설치) + Chromium(`/opt/pw-browsers`)으로 캡처
  - 로컬 정적 서버로 띄운 뒤 해당 화면을 캡처하여 `SendUserFile`로 전달

## 커밋 방식
- 변경 요청 완료 시 **main 브랜치에 직접 커밋 후 push**
- 커밋 전 세 파일(`index.html`, `NonK.html`, `KDeal.html`) 모두 patch 버전 +0.001 올릴 것  
  예: `v0.101` → `v0.102`
- **`sw.js`의 `CACHE_NAME`도 반드시 동일 버전으로 함께 올릴 것**  
  예: `mypm-v0.101` → `mypm-v0.102` (올리지 않으면 브라우저 캐시가 갱신 안 됨)
- **공유 자산 캐시버스팅**: `NonK.html`/`KDeal.html`의 `market-core.js?v=` 및
  `market.css?v=` 쿼리와 `sw.js` ASSETS의 동일 쿼리도 **버전과 함께 올릴 것**.
  (HTML이 `market-core.js`의 함수에 강하게 의존 — SW가 옛 버전 JS를 섞어 서빙하면
  `Render` 등이 undefined가 되어 화면이 빈 채로 멈춤. 쿼리를 올려야 항상 일치.)
- 작업 완료 후 커밋된 버전 번호를 사용자에게 알릴 것

## 현재 버전
`v0.697` (MyPM / NonK / KDeal 공통)

## 가족여행 앱(/trip) 버전 — MyPM 과 별도 관리
- 여행앱은 MyPM 과 **완전히 별개 프로그램**. 버전도 따로 매긴다.
- 현재 버전: `v0.003` — 기준값은 `server/src/trip.ts` 의 `TRIP_VERSION`
- 여행앱 변경 시 `TRIP_VERSION` 만 +0.001 (`v0.001` → `v0.002`). 프론트(`server/private/trip/`, 비공개·미커밋)에
  버전 표기가 있으면 같은 값으로 맞추도록 사용자에게 안내.
- 여행앱만 바뀐 커밋에서는 **MyPM 버전(index/NonK/KDeal/sw.js)을 올리지 않는다.**
  반대로 MyPM 파일(`sw.js` 등)을 건드리면 MyPM 버전 규칙을 따른다.
- 계정(MyPM 허용목록 + 여행 멤버)은 `admin.html` "계정 관리" 한 화면에서 관리. 소유자(`OWNER_EMAIL`)는 기본으로 둘 다 허용.
- 커밋 메시지에 `(trip v0.xxx)` 로 표기하고, 완료 후 여행앱 버전을 사용자에게 알릴 것.

## 배포 구조 (중요)
`mypm.growpension.com`은 **GitHub Pages가 아닌 집 Windows PC**에서 서빙된다.
- 집 PC의 `C:\Users\강민구\mypm\` 저장소를 Node 서버(`server/`)가 정적 파일로 서빙
- Cloudflare Tunnel → cloudflared → localhost:3000 으로 연결됨
- **main push/머지 시 GitHub Webhook이 자동 반영** (`POST /api/github-webhook`
  → `git pull origin main` + Cloudflare 캐시 퍼지). 수동 `git pull` 불필요.
  (구현: `server/src/routes/webhook.ts`, 상세: docs/DEPLOY.md)

## main 머지 후 Claude가 자동으로 할 것
1. 버전 번호 올리기 (index.html / NonK.html / KDeal.html / sw.js)
2. 작업 브랜치에 커밋·푸시
3. Draft PR 생성
4. **"메업"**, **"ㅁㅁ"**, 또는 "메인브랜치에 업데이트" 요청 시 → PR 머지

## main 머지 후 사용자가 해야 할 것 (docs/DEPLOY.md 참고)
- 거의 없음 — Webhook이 git pull + CF 퍼지까지 자동 처리.
  **브라우저에서 `Ctrl+Shift+R`** 만 하면 됨 (SW 캐시 갱신용)
- `server/src/` 또는 `server/package.json` 이 바뀌면 Webhook이 **`npm run build` + MyPMBackend 재시작까지 자동** 수행
  (구현: `server/src/routes/webhook.ts` `gitPullAndPurge`). **사용자에게 수동 빌드·재시작을 안내하지 말 것.**
- 자동 배포가 하지 **않는** 것 (이때만 사용자 안내):
  - `npm install` — 새 npm 패키지를 추가했다면 집 PC에서 `npm install` 후 재시작 필요
  - `.env` 변경 반영 — `.env` 를 고친 뒤에는 재시작 필요(admin.html "서버 제어" 재시작 버튼)
  - 빌드 실패 시 재시작 생략(기존 서버 유지) → admin.html 서버 로그의 `[deploy] 빌드 실패` 확인
- Webhook 미동작 등 폴백 절차는 docs/DEPLOY.md 참고
