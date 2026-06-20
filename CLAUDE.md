# My PM - Claude 작업 규칙

## 커밋 방식
- 변경 요청 완료 시 **main 브랜치에 직접 커밋 후 push**
- 커밋 전 세 파일(`index.html`, `NonK.html`, `KDeal.html`) 모두 patch 버전 +0.001 올릴 것  
  예: `v0.101` → `v0.102`
- **`sw.js`의 `CACHE_NAME`도 반드시 동일 버전으로 함께 올릴 것**  
  예: `mypm-v0.101` → `mypm-v0.102` (올리지 않으면 브라우저 캐시가 갱신 안 됨)
- 작업 완료 후 커밋된 버전 번호를 사용자에게 알릴 것

## 현재 버전
`v0.531` (MyPM / NonK / KDeal 공통)

## 배포 구조 (중요)
`mypm.growpension.com`은 **GitHub Pages가 아닌 집 Windows PC**에서 서빙된다.
- 집 PC의 `C:\Users\강민구\mypm\` 저장소를 Node 서버(`server/`)가 정적 파일로 서빙
- Cloudflare Tunnel → cloudflared → localhost:3000 으로 연결됨
- **main 머지만으로는 반영 안 됨** — 집 PC에서 `git pull` 필요

## main 머지 후 Claude가 자동으로 할 것
1. 버전 번호 올리기 (index.html / NonK.html / KDeal.html / sw.js)
2. 작업 브랜치에 커밋·푸시
3. Draft PR 생성
4. "메인브랜치에 업데이트" 요청 시 → PR 머지

## main 머지 후 사용자가 해야 할 것 (docs/DEPLOY.md 참고)
1. 집 PC에서 `git pull` (또는 자동 업데이트 설정 시 자동)
2. Cloudflare 캐시 퍼지 (선택, 즉시 반영 원할 때)
