# My PM — 진행 상황 / 인수인계 (PROGRESS)

> 이 문서는 작업을 **다른 Claude Code 세션(개인 계정 등)으로 이어가기 위한 핸드오프** 용도다.
> 새 세션은 이 파일 + `server/README.md` + `CLAUDE.md` 를 먼저 읽으면 맥락을 파악할 수 있다.

작업 브랜치: **`claude/tender-knuth-0agbyw`** (저장소 `imgkang/my-ps`). main 직접 푸시 금지.
최종 클라이언트 버전: **v0.514** (index/NonK/KDeal/sw 공통).

---

## 큰 그림 (목표)
정적 PWA(GitHub Pages, localStorage + Google Drive 백업)를 **집 Windows 11 PC의 백엔드(Node/TS + Fastify + SQLite)** 로 전환하고, 최종적으로 **Capacitor로 웹·안드로이드·iOS** 단일 코드베이스 앱 + 푸시 알림까지. 외부 의존(Cloudflare Worker·Drive·corsproxy) 제거, 데이터·키·시세를 자체 백엔드로 통합.

- 프론트: `index.html`(MyPM) + iframe `NonK.html`(미국) `KDeal.html`(국내보조). 바닐라 HTML/JS 유지.
- 백엔드: `server/` (Node+TS+Fastify+SQLite). API 클라이언트: `js/api.js` (`window.MyPMApi`).
- 외부 접속: Cloudflare Tunnel (named, 고정 HTTPS).

---

## 완료된 작업
- **Phase 1–2 (백엔드 + 마이그레이션)**: `server/` 스켈레톤, SQLite, `/api/*` 라우트. Google Drive 번들(version 12)을 SQLite `data_bundle`로 1회 적재 완료(실데이터 확인).
- **Phase 3 ② 데이터 동기화** (커밋 c507458): `index.html`이 `/api/sync`로 백엔드와 왕복.
  - 기존 `buildDriveBundle()`/`_applyImportData()` 재사용. 신규 `syncPullOnStartup()`(시작 시 자동 불러오기), `backendSave()`/`backendLoad()`(수동), `scheduleBackendAutoSave()`(자동저장 토글, 기본 OFF).
  - 동기화 모달에 "🏠 집 PC 백엔드" 섹션(PIN 로그인 + 저장/불러오기 + 자동저장 체크박스). Google Drive는 백업용 유지.
  - 충돌 처리: `putBundle` 409 → 덮어쓰기(force)/불러오기. 서버 충돌규칙 `incoming <= current`(`server/src/routes/sync.ts`). `version`은 단조 증가 리비전으로 사용(스키마 12와 별개).
- **Phase 3 ③ 시세 백엔드 단일화** (커밋 1c4575d): 세 파일의 `fetchViaProxy()`를 백엔드 `/api/price?url=` 패스스루로 교체(외부 CORS 프록시·CF Worker 제거). NonK Finnhub 키 **코드에서 제거** → `/api/price/finnhub`(키는 `server/.env`). Yahoo/Stooq 폴백 유지.
- **부록 F NonK 속도 개선** (커밋 fc34db7): 백엔드 `GET /api/prices/finnhub?symbols=A,B,C` 배치(서버 병렬, 8 동시성) + Finnhub 30초 캐시. `NonK.html` `nkBatchFinnhub()`로 갱신을 1요청으로. → "이전보다 빨라짐" 확인.
- **부록 G 일부** (커밋 ebd7732): Cloudflare Tunnel 상시화 **런북**(`server/README.md`) + `server/cloudflared.example.yml` + `.gitignore`(config.yml) + **로그인 스로틀**(`server/src/auth.ts`, IP별 5분/10회 초과 시 429).

### 검증된 사실 / 환경
- 데이터 저장/열기 OK(실기기), 휴대폰 LAN 접속 OK(`192.168.86.71:3000`). NonK 속도 개선 체감 OK.
- 노트북 IPv4 `192.168.86.71`(Google Wifi, gw .86.1). 서버 `0.0.0.0:3000` 바인딩, CORS `origin:true`.
- 서버는 **cwd의 `.env`** 를 로드(`server/src/env.ts`). Windows 서비스 등록 시 **작업 디렉터리를 `server/`로** 해야 `.env`(APP_PIN/FINNHUB_KEY) 적용됨.
- Finnhub 키: 사용자가 `server/.env`에 기존 키 투입(재발급 보류 — 본인 단독 사용·저위험 판단). 단 옛 키는 git 히스토리에 잔존(향후 재발급 권장).

---

## 지금 진행 중 — Cloudflare Tunnel 상시화 (부록 G, 집 PC 작업)
사용자는 **도메인 보유**. named tunnel `https://mypm.<도메인>` → `localhost:3000` 구성 중.
상세 절차는 **`server/README.md` "Cloudflare Tunnel 상시화" 절** 참고. 요약:
1. 도메인을 Cloudflare에 추가(네임서버 변경, 1회).
2. `winget install Cloudflare.cloudflared` → `cloudflared tunnel login` → `tunnel create mypm` → `route dns mypm mypm.<도메인>`.
3. `cloudflared.example.yml` 복사·작성 → `%USERPROFILE%\.cloudflared\config.yml`.
4. `cloudflared tunnel run mypm` → 외부(휴대폰 LTE)에서 `https://mypm.<도메인>/api/health` = `{ok:true}` 확인.
5. 상시화: `cloudflared service install` + 백엔드 NSSM 서비스(AppDirectory=`server/`).
6. 휴대폰에서 앱 열고 PIN 로그인 → PWA "홈 화면에 추가".
- 보안: APP_PIN 길게. 공개 라우트(health/price/search)는 민감정보 없음, `/api/sync`는 Bearer 보호, `/server`·dotfile 차단.

---

## ✅ 집 PC 프로덕션 배포 완료 (2026-06-19, 개인 계정 세션)
부록 G(Cloudflare Tunnel 상시화)를 **집 Windows PC에서 완료**. 외부에서 고정 HTTPS 주소로 상시 접속 가능. 재부팅 후 무인 자동 가동 검증 완료(휴대폰 LTE OK).

### 환경 / 경로 (이 집 PC 기준)
- 저장소 위치: `C:\Users\강민구\mypm` (루트). 백엔드: `...\mypm\server`.
- hostname `DESKTOP-V05RLRM`, LAN IPv4 `192.168.86.113` (Google Wifi).
- Node.js v22.x, Node 실행기 `C:\Program Files\nodejs\node.exe`.
- cloudflared `C:\Program Files (x86)\cloudflared\cloudflared.exe`.

### 도메인 / 터널
- 도메인 **`growpension.com`** — Cloudflare Registrar 로 신규 구매(계정 imgkang@gmail.com, 자동 Active, 네임서버 변경 불필요).
- 외부 접속 주소: **`https://mypm.growpension.com`** (자동 HTTPS).
- named tunnel **`mypm`**, UUID `d454478b-5f3c-424c-8452-8588509a22a0`.
- 설정 파일 `C:\Users\강민구\.cloudflared\config.yml` (BOM 없는 UTF-8). 자격증명 `...\.cloudflared\<UUID>.json`, 로그인 인증서 `cert.pem` — 모두 그 폴더에 있으며 **커밋 금지**.

### 자동 실행 = Windows 작업 스케줄러 (NSSM 대신)
> NSSM 은 AhnLab Safe Transaction 이 PUP 로 오탐·차단 → **작업 스케줄러로 전환**. 둘 다 **SYSTEM 계정 + 부팅 시 실행(AtStartup) + 크래시 시 1분 후 자동 재시작(최대 3회) + 실행시간 제한 해제(PT0S)**.
- `MyPMBackend` → `node.exe dist\server.js`, 작업폴더 `...\mypm\server` (★ `.env` 가 여기서 로드됨).
- `MyPMTunnel` → `cloudflared.exe --config <config.yml 절대경로> tunnel run mypm` (SYSTEM 계정이라 `--config` 절대경로 명시 필수).
- 전원: `powercfg /change standby-timeout-ac 0` 등으로 절전/최대절전 해제(서버 상시 가동). 노트북이면 덮개 동작도 "아무 것도 안 함".

### 관리 명령 (관리자 PowerShell)
```powershell
# 상태 확인 (이름을 직접 지정 — 키워드 와일드카드 검색에서 안 걸릴 수 있음)
Get-ScheduledTask MyPMBackend,MyPMTunnel | Select TaskName,State

# 재시작
Stop-ScheduledTask MyPMBackend; Start-ScheduledTask MyPMBackend
Stop-ScheduledTask MyPMTunnel;  Start-ScheduledTask MyPMTunnel

# 코드 업데이트 반영 (webhook 미작동 시 수동)
cd C:\Users\강민구\mypm; git pull
cd server; npm run build
Stop-ScheduledTask MyPMBackend; Start-ScheduledTask MyPMBackend
```

> ⚠️ `Get-ScheduledTask | Where-Object { $_.TaskName -like "*MyPM*" }` 로 검색해도 안 보일 수 있음.
> 반드시 `Get-ScheduledTask MyPMBackend` 처럼 **이름을 직접 지정**해서 확인할 것.

#### 태스크가 응답 안 할 때 (SYSTEM 권한 프로세스 강제 종료)
```powershell
# node PID 확인
Get-Process node | Select Id, SI   # SI=0 이면 SYSTEM 권한

# 관리자 PowerShell에서 강제 종료 후 재시작
Stop-Process -Id <PID> -Force
Start-Sleep 2
Start-ScheduledTask MyPMBackend
```

### 운영 주의
- PC 전원 켜져 있어야 서비스 동작(절전 해제 적용함).
- Cloudflare 에서 `growpension.com` 자동 갱신/결제수단 확인(만료 시 접속 끊김).
- APP_PIN 충분히 길게 유지(외부 노출). Finnhub 키 등은 `.env` 에만.

---

## ✅ GitHub Webhook 자동 배포 완료 (2026-06-20, v0.527)
폴링(작업 스케줄러 반복) → **GitHub Webhook 즉시 트리거** 방식으로 전환.
`git push origin main` 하는 순간 GitHub이 서버에 신호 → 서버가 `git pull` + Cloudflare 캐시 퍼지 자동 실행.

### 구조
```
git push → GitHub Webhook → POST /api/github-webhook → git pull + CF purge → 즉시 반영
```

### server/.env 필수 항목 (추가 필요)
```
GITHUB_WEBHOOK_SECRET=<랜덤 시크릿>   # PowerShell: -join((1..32)|%{'{0:x}'-f(Get-Random -Max 16)})
CLOUDFLARE_ZONE_ID=<zone id>           # 기존 scripts/.env 에서 복사
CLOUDFLARE_API_TOKEN=<api token>       # 기존 scripts/.env 에서 복사
```
> `scripts/.env`는 이제 불필요 — `server/.env`로 통합 후 삭제 가능.

### GitHub Webhook 등록 (1회)
- GitHub → `imgkang/my-ps` → Settings → Webhooks → Add webhook
  - Payload URL: `https://mypm.growpension.com/api/github-webhook`
  - Content type: `application/json`
  - Secret: `GITHUB_WEBHOOK_SECRET` 값
  - Events: **Just the push event**

### 업데이트 반영 확인
Cloudflare purge 결과는 서버 로그에서 확인:
```
[webhook] git pull 완료: ...
[webhook] CF purge: OK
```

### scripts/auto-pull.ps1
Webhook 미설정 시 수동 폴백용으로만 유지. 평소에는 사용 안 함.
`scripts/.env`(Cloudflare 토큰)는 `server/.env`로 이전 후 삭제.

---

## ✅ 다중 사용자 + 구글 로그인 완료 (2026-06-19, v0.517)
단일(PIN) → **다중 사용자 + 구글 로그인(허용목록)** 전환 완료. localhost + 휴대폰 검증 완료.

### 백엔드
- `users`(google_sub/email/name) + `app_meta`(token_secret) 테이블 신설.
- `data_bundle`/`alerts`/`devices` 에 `user_id` 추가 → 모든 보호 라우트를 로그인 사용자로 스코프.
- 인증: `POST /api/auth/google` (구글 ID 토큰 검증 + `ALLOWED_EMAILS` 화이트리스트) → 앱 토큰(uid 서명, HMAC, 30일) 발급. `GET /api/auth/me`. PIN(`/api/auth/login`) 제거.
- 토큰 서명키는 `app_meta.token_secret` 에 영속.
- `.env` 신규: `GOOGLE_CLIENT_ID`, `ALLOWED_EMAILS`(콤마), `OWNER_EMAIL`.
- 마이그레이션: `npm run migrate` (단일→다중, DB 자동 백업, 기존 번들을 OWNER_EMAIL 계정으로 이관). import-bundle 도 OWNER_EMAIL 대상.
- 구글 OAuth 웹 클라이언트 ID: `27411403852-...apps.googleusercontent.com` (Google Cloud, 프로젝트 GrowPension, 테스트 사용자 = 허용 이메일). 승인된 JS 원본: `https://mypm.growpension.com`, `http://localhost:3000`.

### 프론트
- `js/api.js`: `loginGoogle(credential)`/`me()` (login(pin) 제거).
- `index.html`: 백엔드 로그인 PIN → 구글 로그인 버튼(GIS). `api-test.html` 도 구글 버튼.
- `sw.js`: `/api/*` 및 비-GET 요청 캐시 제외(동적 데이터/로그인 캐시 방지). client 자산 변경 → v0.514→0.517 + CACHE_NAME 동기화.

### 운영 메모
- 신규 사용자 추가 = `.env` `ALLOWED_EMAILS` 에 이메일 추가 + (구글 콘솔 테스트 모드면) 테스트 사용자 추가 → 백엔드 재시작.
- GitHub Pages(`imgkang.github.io`)에서도 로그인하려면 그 출처를 구글 "승인된 JS 원본"에 추가 필요(현재는 미등록 — 실제 앱은 mypm.growpension.com).
- (미구현) scheduler 의 알림 발송은 아직 사용자별 devices 조회 미연결(Phase 5).

---

## 다음 단계 (예정)
- **Phase 4 — Capacitor 안드로이드 앱**: 기존 정적 자산을 `webDir`로 래핑, `npx cap add android`, Windows+Android Studio로 APK 빌드·사이드로드. baseUrl = 터널 도메인. (Mac 불필요. iOS는 추후 Mac/클라우드.)
- **Phase 5 — 푸시 알림**: `@capacitor/push-notifications` → `/api/push/register`. 안드로이드 FCM 먼저(Firebase 프로젝트 + `google-services.json` + 서버 서비스계정 키). 백엔드 발송기/alerts 엔진 연결.
- (운영) 종목 자동 갱신 스케줄러(`scripts/update_tickers.py`), SQLite 백업.

---

## 작업 규칙 (CLAUDE.md 준수)
- 클라이언트 자산(`index.html`/`NonK.html`/`KDeal.html`) 변경 시 **patch +0.001** + `sw.js` `CACHE_NAME` 동일 버전 + CLAUDE.md "현재 버전" 동기화. (서버/문서만 바뀌면 생략.)
- 커밋·푸시는 **`claude/tender-knuth-0agbyw`** 브랜치. PR은 요청 시에만.
- 민감정보(키/토큰/PIN)는 평문 출력·커밋 금지. `.env`·`config.yml`·자격증명 JSON은 gitignore됨.
