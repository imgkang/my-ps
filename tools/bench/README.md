# 성과측정 (프론트/백엔드 비중 재조정)

Phase별로 프론트엔드의 두 가지 성과를 측정·비교한다.

1. **프론트엔드 파일 크기** — 작을수록 좋음
2. **화면 업데이트 속도 / 메인스레드 부담** — 빠를수록 좋음

## ① 파일 크기 — `filesize.mjs`

```bash
node tools/bench/filesize.mjs            # HEAD 와 비교
node tools/bench/filesize.mjs <baseRef>  # 임의 ref 와 비교 (예: 태그/커밋)
```

index/NonK/KDeal 의 원본·gzip 크기를 기준 ref 대비 증감(%)으로 출력한다.

## ② 메인스레드 동기 계산비용 — `main-thread-cost.mjs`

```bash
cd server && npm run build && node test/gen-legacy.mjs   # 사전 준비(골든/포팅 빌드)
cd .. && node tools/bench/main-thread-cost.mjs [iterations]
```

인출 렌더 1회당 **메인스레드에서 동기 실행되는 계산** 비용을 BEFORE(원본 루프)
vs AFTER(입력 조립+직렬화)로 비교한다. 투영 알고리즘이 서버로 이동해 메인스레드를
블로킹하지 않게 된 효과(=즉각적인 UI 반응)를 정량화한다.

## ②' 라이브 종단 렌더 속도 — `render-speed.mjs` (Playwright)

```bash
MYPM_URL=https://mypm.growpension.com \
MYPM_TOKEN=<localStorage.mypm_auth_token> \
node tools/bench/render-speed.mjs [runs]
```

실제 배포본에서 "트리거→페인트" wall-clock 과 long-task 블로킹을 측정한다.
서버 왕복(네트워크 지연)까지 포함되므로 배포 후 실측·비교에 사용한다.
