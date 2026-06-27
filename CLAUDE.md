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
- 작업 완료 후 커밋된 버전 번호를 사용자에게 알릴 것

## 현재 버전
`v0.648` (MyPM / NonK / KDeal 공통)

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
- Webhook 미동작 등 폴백 절차는 docs/DEPLOY.md 참고
- ⚠️ `server/src/` TypeScript 변경 시에만 집 PC에서 수동 빌드·재시작 필요
