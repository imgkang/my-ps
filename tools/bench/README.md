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

## 원격 자동 측정 (집 PC 수동 실행 불필요)

위 ①·② 는 서버 안에서도 자동 측정된다. **배포(webhook git pull→빌드→재시작)마다
1회 측정해 SQLite `bench_runs` 에 누적**하고, 등록된 디바이스로 핵심 수치를 푸시한다.
(구현: `server/src/bench/`, 배포 훅: `server/src/routes/webhook.ts`·`server/src/server.ts`)

원격 조회 (admin 토큰):
```
GET /api/admin/bench?token=<UPDATE_TOKEN>            # 최신 스냅샷 + 직전 대비 델타 + 히스토리
GET /api/admin/bench?token=...&run=1                # 즉석 측정·저장 후 반환
GET /api/admin/bench?token=...&base=<git-ref>       # 임의 ref(예: Phase1 직전) 대비 프론트 크기 비교
```

측정 항목:
- `frontend`: index/NonK/KDeal 원본·gzip 바이트
- `timing.serverComputeMs`: 인출 투영 계산 시간(서버) — 화면 갱신 지연의 서버측 성분
- `timing.clientAssembleMs`: 클라가 동기로 하는 입력 조립 비용(메인스레드)

푸시는 APNs/FCM 자격증명이 설정된 경우에만 전송된다(미설정 시 조용히 스킵).
