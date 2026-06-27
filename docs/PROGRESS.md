# My PM — 진행 상황 / 인수인계 (PROGRESS)

> 이 문서는 작업을 **다른 Claude Code 세션(개인 계정 등)으로 이어가기 위한 핸드오프** 용도다.
> 새 세션은 이 파일 + `server/README.md` + `CLAUDE.md` + `docs/DEPLOY.md` 를 먼저 읽으면 맥락을 파악할 수 있다.

저장소: `imgkang/my-ps`. **브랜치·커밋·버전 규칙은 `CLAUDE.md` 가 최신 기준**(이 문서의 옛 규칙보다 우선).
최종 클라이언트 버전: **v0.644** (index/NonK/KDeal/sw 공통). 마지막 갱신: 2026-06-27.

---

## 🧭 최신 상태 요약 (2026-06-27 기준)

- **현재 버전 v0.644.** 배포 파이프라인(GitHub Webhook → 집 PC git pull + CF purge, server/src 변경 시 자동 빌드·재시작)은 v0.543~0.545 에서 완성된 상태 그대로 운영 중.
- **구글 로그인 + 다중 사용자**가 기본 인증(PIN 제거, v0.517). 이후 온보딩/iOS PWA 로그인 안정화까지 마무리됨(v0.590~0.602).
- 최근 작업 흐름은 **입력 UX 공통 모듈(`js/input-ux.js`) 전면 적용** — 자동선택·콤마 포맷·날짜/연월 피커를 세 앱에 일관 적용(v0.633~0.644). 아래 "입력 UX — 연/월 피커·자동선택 확대", "입력 UX 공통 모듈 확대" 두 섹션 참고.
- ⚠️ 이 문서 본문의 v0.543 이후 섹션들은 과거 기록. **상단 세 섹션(연/월 피커·자동선택 확대 → 공통 모듈 확대 → v0.583~0.634 보강)이 그 이후 변경의 요약**이다. 그 이전(v0.546~0.582)은 shallow clone 으로 히스토리가 잘려 상세 미기재.

---

## ✅ 입력 UX — 연/월 피커·숫자 자동선택 확대 (2026-06-27, v0.640~0.644)

> 감사 결과 연/월 입력 대부분이 `type=number`(inputmode 없음)이라 자동선택도 피커도
> 미적용이었음. **혼합 방식**(연+월 쌍=연/월 휠 피커, 단독 연도/기타 숫자=자동선택)으로
> 세 앱에 일관 적용. PR #338 머지 완료. 모든 단계 Playwright 검증, 콘솔 오류 0.

### 적용 분류
- **(A) 연/월 휠 피커** — 연도 input 에 `data-iux-ym-month="<월id>"`, 월 input 에
  `data-iux-ym-year="<년id>"` 교차 마커만 추가(type 유지 → scanDateInputs 가 런타임
  text+readonly 전환). 적용처:
  - 설정 연금 시작월 6쌍(cfg_{my,wife}{NP,GP,SP}StartYear/Month) — v0.640
  - 배당 연/월(nkDivYear/Month, kdDivYear/Month) — v0.641
  - 설정 생년월 2쌍 + 온보딩 연금행 동적 6쌍(ob_${key}_yr/mon, mkPensionRow) — v0.642
  - (기존: 온보딩 생년월 ob_my/wifeBY·BM)
- **(B) 자동선택** — index 의 type=number(inputmode 없음) 62개를 `type="text"`+inputmode
  로 전환(소수 18=decimal, 정수 44=numeric) → 기존 selector 에 편입되어 탭 시 전체선택. v0.643.
  - iOS 에서 `select()` 가 type=number 에 불안정 → 검증된 text+inputmode 패턴으로 통일.
  - 단독 연도(wdP*/qwdP*_start)도 자동선택. min/max/step/oninput/style 보존(read 는 Number/parseInt).
  - NonK/KDeal 은 배당 연/월(피커) 외 type=number 입력이 없어 변환 대상 없음.

### 동반 수정
- **fix(input-ux 휠 레이스, v0.641)**: 휠 컬럼 스냅 디바운스 타이머(110ms)가 피커
  close(_st=null) 이후 실행되며 onChange 에서 `_st.y/_st.m` 접근 → "Cannot set properties
  of null" 에러. setTimeout/click 핸들러에 `_st` null 가드 추가. (열릴 때 rAF 로 scrollTop
  설정 → scroll 이벤트 → 타이머 예약 → 빠른 열기→확정 시 발화.)
- **fix(CSS 회귀, v0.644)**: scanDateInputs 의 런타임 type 전환으로 `input[type="number"]/
  [type="date"]` 지정 CSS 가 미매칭되어 스타일이 빠지던 회귀(배당 `.records-input-top`,
  index `.rec-date-row`)를 `input[type="text"]` 도 포함하도록 확장. (`.txn-form` 류는 이미 포함.)

### 주의/한계
- **자동선택은 iOS Safari 고유 동작** — 데스크톱 Chromium 에선 type=number 도 select 되어
  차이가 안 보임. 검증은 "변환된 필드가 text+inputmode 인지 + 보이는 필드 전체선택"으로 수행.
  실기기(아이폰) 최종 확인 권장.
- type=number→text 전환 후 네이티브 min/max 입력 제한은 사라짐(값은 JS 가 Number 파싱).
  월 범위(1~12)는 휠 피커가 노출 제한으로 더 강하게 보장.

---

## ✅ 입력 UX 공통 모듈(js/input-ux.js) 확대 — Stage 1·2·3 통합 (2026-06-27, v0.635~0.639)

> "모든 입력 불편함을 공통 모듈로 개선 + 코드 재사용" 목표의 연장. '시작하기' 마법사 시범
> (v0.632~0.633) 이후, 자동선택·콤마 포맷·날짜 피커 3종을 `js/input-ux.js` 한 곳에 모아
> 세 앱에 일관 적용. 모든 단계 회귀 위험 고려해 기존 저장 로직·동작 보존, Playwright 검증(콘솔 오류 0).
> 작업 브랜치 PR #335(v0.635), #336(v0.636~0.639) 머지 완료.

### 모듈 구조 (`js/input-ux.js`)
- **Stage 1 — 탭 시 기존값 자동선택**: `focusin` 위임. `setAutoSelectSelector(sel)`. readonly/inputmode=none(날짜 마커)·일반 텍스트는 자동 제외.
- **Stage 2 — 숫자/금액 콤마 포맷**(v0.636 신설): `formatNumber(el,{mode:'int'|'dec',dec,locale})` / `readNumber` / `stripCommas` / `setNumberDefaults({locale})`. 마커 `data-iux-num`(+`data-iux-dec`,`data-iux-num-locale`) 이벤트 위임(input/focusin/focusout). 빈값/0/NaN→''.
- **Stage 3 — 커스텀 날짜 피커(달력/휠)**: 마커 `data-iux-date`(전체날짜), `data-iux-ym-month`/`data-iux-ym-year`(연·월). iOS 네이티브 차단(type=text+readonly+inputmode=none) + mousedown preventDefault 로 포커스 깜빡임 제거.

### 적용 경과
- **v0.635**(#335): 날짜 피커 열 때 입력란 포커스로 인한 깜빡임 제거(mousedown preventDefault). PROGRESS 최신화 동반.
- **v0.636 Step A**(#336): Stage 2 신설. 세 앱 중복 6개 함수(liveKRWInput/nkLiveInt/kdLiveKRW/obFmtAmt/fmt*AccInput)를 단일 구현으로 위임(이름·동작 보존, 인라인 HTML 무수정). 동작 동일성 0 mismatch.
- **v0.637 Step B**: 자동선택을 온보딩 한정 → 세 앱 전체 숫자/금액(`input[inputmode=numeric|decimal],[data-iux-num]`)으로 확대.
- **v0.638 Step C**: index 잔여 + NonK/KDeal 날짜 입력 전부(총 18개)에 `data-iux-date` 적용 → 모든 날짜가 커스텀 피커. (valueAsDate/showPicker 사용처 없음 확인 → 안전.)
- **v0.639 Step D**: 인라인 콤마제거 원시 정규식 21곳(index 1·NonK 15·KDeal 5)을 `InputUX.stripCommas(this)`로 통합. onblur/oninput 유지.

### 앱별 기본 locale (Stage 2 마커용)
- index/KDeal = `ko-KR`, NonK = `en-US` (`InputUX.setNumberDefaults` 로 지정). 기존 래퍼는 locale 명시 전달로 보존.

### 후속 후보 (보류)
- 저장 경로의 산재한 `Number(...replace(/,/g,''))` 파싱을 `InputUX.readNumber`로 통합(회귀 위험 대비 가치 낮아 보류).
- NonK/KDeal 거래 입력(nqt*/kqt*)의 onfocus+onblur 쌍을 `data-iux-num data-iux-dec` 마커로 완전 전환(현재는 stripCommas+래퍼 조합 유지).

---

## ✅ v0.583~0.634 보강 — 인증 안정화·입력 UX 공통화·컬럼 편집 (2026-06-23~27)

> v0.545 이후 ~ 현재까지의 변경을 주제별로 묶은 요약. (개별 PR 번호 병기. 세부는 각 커밋 참고.)

### 인증 / 온보딩 안정화 (v0.589~0.602, #295)
- 앱 최초 실행 시 **온보딩 자동 실행 + 구글 로그인 권유 모달**, 비로그인 시 온보딩 강제 노출(v0.590~0.595).
- **iOS PWA 구글 로그인** 안정화: GIS 를 redirect 모드로 전환, `baseUrl`/`google-redirect` 경로 수정(`/?app_token=`), 로그인 제안 모달 간소화(v0.596~0.602).
- 로그아웃/초기화 시 화면 미갱신 버그 수정, `confirm()` → 커스텀 모달 전환.
- `admin.html` 에서 **테스터(로그인 허용 이메일) 추가/삭제** 기능(#295) — `.env ALLOWED_EMAILS` 수동 편집 부담 완화.

### 설정 화면 구조 분리 (#319~321, v0.603~0.611)
- **설정 진입점을 `settings.html` 로 분리** + 앱별 복귀(진입 앱 끄면 MyPM 복귀), 진입 시 대시보드 깜빡임 제거(#319~321).
- 시작하기 배너 제거, 입출금 추가 버튼 헤더로 이동, 계좌이전 설정으로 이동 등 UI 정리(v0.603~0.605).
- 시작하기 마법사 금액 단위 **원 단위 통일** + 시나리오 자동저장/초기화 동반(v0.606~0.608).
- NonK/KDeal 내보내기·가져오기 버튼·함수 제거(v0.609), 메인설정·admin 로딩 UX 개선(v0.610~0.611).

### 입력 UX 공통화 (v0.612~0.617, v0.633~0.634) ★최근 작업★
- 종목 추가 모달 수량/단가 **레이블·placeholder·합계 정렬**(KDeal/NonK, v0.612~0.615).
- 전체 숫자/금액 입력란 **세 자리 콤마 표시** + 입력 중 실시간 콤마 포맷(v0.616~0.617).
- **`js/input-ux.js` 공통 모듈 신설**(v0.633): 입력란 자동선택 + 날짜 피커(휠/달력) 세 앱 공통화.
- iOS 날짜 입력 시 **네이티브 달력 깜빡임 제거**(v0.634): 마커 입력을 `type=text` + `inputmode=none` + `readonly` 로 전환해 네이티브 UI 원천 차단, 값은 문자열 보존. (회귀 Playwright 검증 완료.)

### 종목 리스트 컬럼 순서 편집 (#326~329)
- 종목 리스트 **컬럼 순서 드래그 편집 모달**, MyPM·NonK·KDeal **세 앱 공통 순서**(#326~327).
- 실제 터치/마우스 드래그 미동작 버그 수정(#328), 컬럼 순서를 **백업/내보내기/서버 동기화에 포함**(#329).

### 차트 / PTR / 시세 (v0.583~0.588, v0.629~0.631)
- **시세 서버 선계산 일원화**: 세 앱 라이브 시세를 서버에서 계산 → 프론트 즉시 표시(v0.583).
- NonK/KDeal **당겨서 새로고침(PTR)** iframe 동작 + 오버스크롤 바운스, 헤더 고정(v0.584~0.587).
- 추세 차트 **통합 팩토리 + 예상수익률(7%) 벤치마크선**(v0.588).
- 한국 ETF 검색/한글명 누락 수정, 한글명 대소문자 무시, SOL 코리아고배당 ETF 보강(v0.629~0.630), 종목 데이터 갱신 즉시 반영(캐시 수정, v0.631).

### 데이터 안정성 (#322, v0.622)
- **버전 업데이트 시 데이터 손상 방지**: 자동 백업/복원 + SW 완화 + 자동저장 가드(#322).
- 파일 불러오기 시 **계좌기록 날짜(일) 유실 버그 수정**(v0.622).

---

## ✅ 매일 06:10 크래시 근절 + 무중단 자동배포 + 원격 재시작 신뢰성 확보 (2026-06-22, v0.543~0.545)

전날 만든 원격 관리 대시보드(v0.533)에 이어, **반복적인 서버 다운의 진짜 원인**을 잡고 배포·재시작 파이프라인을 신뢰성 있게 완성. 모두 실기기/실서버에서 검증 완료.

### 1. 매일 06:10 크래시 — 진짜 원인 규명 (v0.543)
- `server.log` 에서 결정적 증거 확보:
  ```
  [FATAL] uncaughtException: Error: spawn python ENOENT
      syscall: 'spawn python'  path: 'python'
      spawnargs: [ '...\scripts\update_tickers.py' ]
  ```
- `scheduler.ts` 가 **매일 06:10 KST** 에 `spawn('python', [update_tickers.py])` 실행 → 집 PC 에 **Python 미설치** → `ENOENT`.
  `child.on('error')` 리스너가 없어 → `uncaughtException` → `process.exit(1)` → 서버 종료. (전날 502, 그 전 00:27 크래시도 동일 계열로 추정)
- **수정**: `scheduler.ts` 에 `py.on('error', ...)` 추가(로그만 남기고 서버 계속 실행). Windows=`python`, 그 외=`python3`. `close` 핸들러도 `code!==null` 가드.

### 2. webhook 자동 빌드·재시작 (v0.535→통합 v0.543)
- 기존 webhook 은 `git pull` + CF purge 만 → **TypeScript 서버 변경 시 수동 빌드 필요**했음.
- `routes/webhook.ts` `gitPullAndPurge()` 개선:
  - `Already up to date` 면 purge 만.
  - pull 로 새 커밋 반영 시 `git diff ORIG_HEAD HEAD --name-only` 로 **`server/src/` 또는 `server/package.json` 변경 감지** → `npm run build` 자동 실행 → 빌드 성공 시 재시작.
  - 정적 파일만 변경이면 빌드/재시작 없이 CF purge 만(다운타임 0).

### 3. 재시작 방식: exit 1 → 독립 프로세스 (v0.544) ★중요★
- **문제 발견**: `process.exit(1)` 후 Task Scheduler "실패-재시작" 정책에 의존하는 방식이
  **불안정**(서버가 `Ready`(정지)로 방치됨) + RestartInterval(1분) 지연. 실테스트에서 실제로 정지 방치 재현됨.
- **해결** — `routes/webhook.ts` `restartSelf(log, errLog)` 신설:
  ```
  cmd /c start "" /min powershell -NoProfile -WindowStyle Hidden -Command
    "Start-Sleep 2; Stop-ScheduledTask MyPMBackend; Start-Sleep 1; Start-ScheduledTask MyPMBackend"
  ```
  - 핵심: `cmd /c start` 로 powershell 을 **태스크 프로세스 트리(job object) 밖**에서 실행 →
    `Stop-ScheduledTask` 로 현재 node 가 죽어도 헬퍼는 살아남아 `Start` 까지 수행.
  - 실패-재시작 정책 비의존 → **약 10초 만에 자동 복귀, 정지 방치 없음**. 폴백으로만 `exit 1` 유지.
- 검증: 더미 커밋 push → 로그에서 `git pull → build → 재시작 헬퍼 → [v0.544]` (pid 변경) 확인. pid 32564→11556→36664 처럼 매번 정상 교체.

### 4. admin.html 재시작도 동일 방식으로 통일 (v0.545)
- `POST /api/admin/restart` 가 여전히 `process.exit(1)`(불안정) 사용 중이었음 → `restartSelf()` 재사용으로 교체
  (`webhook.ts` 에서 `export function restartSelf`, `admin.ts` 에서 import).
- admin.html 안내 문구 "약 1분" → "약 10초".
- **실기기 검증**(아이폰): 재시작 버튼 클릭 → 대시보드 가동시간 3분57초→8초, 누적 197→3건, 시작시각 갱신 = 성공.

### 운영/주의 — 이번 세션에서 배운 것
- ⚠️ **main 에 force-push 금지**. 이번에 커밋 서명 수정용 amend → force-push 했더니
  **집 PC 로컬 main 이 origin 과 갈라져 `git pull` 충돌** 발생. 복구: 집 PC 에서
  `git merge --abort; git fetch origin main; git reset --hard origin/main` (.env·data 는 gitignore 라 안전).
- Stop hook 이 커밋을 "Unverified" 로 경고하지만(서명 없음/`fe23aad` 는 GitHub squash 머지 committer),
  이메일은 `noreply@anthropic.com` 로 정상. 이 환경엔 서명 키가 없고, 고치려면 force-push 가 필요해 **의도적으로 무시**.
- 서버 시작 로그에 버전 태그를 남김: `My PM 백엔드 실행 중 — ... [v0.5xx]` (`server.ts`). 배포 확인용.

### 최종 배포 파이프라인 (완성형)
```
코드 push → GitHub Webhook → git pull
  ├─ 정적파일만 변경  → CF purge → 즉시 반영 (다운타임 0)
  └─ server/src 변경  → npm run build → restartSelf(독립 프로세스 Stop→Start)
                        → 약 10초 후 새 코드로 자동 복귀 (정지 방치 없음)
원격 수동 재시작: admin.html 버튼 → /api/admin/restart → restartSelf (동일 방식)
```
> 이제 집 PC 를 직접 만질 일이 거의 없음. 단, **과거에 force-push로 꼬였을 때만** 위 reset 절차 사용.

---

## ✅ 502 원인 규명 + 원격 관리 대시보드 완료 (2026-06-21, v0.533)

휴대폰(외부)에서 **502 Bad Gateway** 발생 → 원인 규명 + 재발 방지 + 원격 관리 도구 구축 완료.
PR #246 main 머지 완료, 집 PC `git pull`+`npm run build`+태스크 재시작 완료, 휴대폰 접속 확인 ✅.

### 502 근본 원인
- 6/21 00:27 에 Node 백엔드가 **크래시(exit code 1)**. 작업 스케줄러가 `RestartCount=3`(1분 간격)으로 3회 재시도 후 **포기** → 서버 10시간+ 다운.
- 결정적 문제: **stdout/stderr 가 어디에도 저장 안 됨** → 크래시 당시 에러 메시지 영구 소실. 00:27 의 정확한 원인은 알 수 없음(가설: AhnLab 예약검사가 node.exe 일시 차단).
- 참고: 서버는 **SYSTEM 계정**으로 동작 → 자녀가 다른 Windows 사용자로 로그인/로그아웃해도 **무관**(세션 독립). 이건 원인 아님.

### 재발 방지 조치 (집 PC)
1. **로그 캡처**: 작업 스케줄러 액션을 `cmd.exe /c "node.exe dist\server.js >> data\server.log 2>&1"` 로 변경 → 모든 출력(크래시 스택 포함) `server\data\server.log` 에 기록.
2. **RestartCount 3 → 60** 으로 상향 (장기 다운 방지).
3. 코드: `process.on('uncaughtException'|'unhandledRejection')` → `console.error` 후 `process.exit(1)` (재시작 트리거).

### 신규 — 원격 관리 대시보드
- **`admin.html`** (저장소 루트, 정적 서빙): 모바일(아이폰) 친화 다크 대시보드.
  - 접속: `https://mypm.growpension.com/admin.html`
  - 로그인 토큰 = **`server/.env` 의 `UPDATE_TOKEN`** (기존 강제업데이트 토큰 재사용).
  - **Face ID**: `<form autocomplete=on>` + hidden username + `autocomplete=current-password` → Safari 가 비번 저장 제안 → 재방문 시 Face ID 자동 입력. 토큰은 `localStorage['mypm_admin_token']` 에도 보관(자동 로그인).
  - 표시: 서버 상태/업타임/버전(sw.js CACHE_NAME), 메모리, 트래픽(누적·최근5분·1시간·라우트별 + req/min 속도 + 누적 시작시각), DB 카운트, 작업 스케줄러 상태, **서버 로그 뷰어**(색상: 회색=info/노랑=warn/빨강=error/분홍=크래시 스택, 오류만 필터 토글), 재시작 버튼.
- **백엔드 (`server/`)**:
  - `src/metrics.ts` (신규): 요청 수 인메모리 집계. `startedAt`, `total`, `recentTs`(1시간 롤링), `byRoute`, `lastAt`. `recordRequest()`.
  - `src/routes/admin.ts` (신규): 모두 `UPDATE_TOKEN` 보호(query `?token=` 또는 헤더 `x-admin-token`).
    - `GET /api/admin/status` — 상태·업타임·버전·메모리·트래픽·DB·태스크 상태.
    - `GET /api/admin/logs?lines=N&errorsOnly=1` — `server.log` 끝부분 tail(`tailBytes`), pino JSON + 비-JSON 크래시 스택 파싱(`parseLine`), 오류만 필터.
    - `POST /api/admin/restart` — `process.exit(1)`(cmd 래퍼 + 실패시 재시작 구성에선 exit 0 이면 재시작 안 됨 → **반드시 1**).
    - `POST /api/admin/restart-task?task=MyPMBackend|MyPMTunnel` — PowerShell Stop/Start.
  - `src/server.ts`: 위 핸들러 + `onRequest` 훅(`recordRequest`) + `adminRoutes` 등록.
  - `src/env.ts`: `LOG_PATH` (기본 `./data/server.log`) 추가.

### 운영 메모 / 후속 관찰
- ⚠️ 크래시 재발 시 **이제 `server\data\server.log` 에 스택이 남음** → admin.html 로그 뷰어로 원격 확인 가능. 00:27 패턴(자정 무렵 AhnLab 검사) 재현되는지 관찰 필요.
- admin.html 은 클라이언트 버전(v0.5xx) 규칙과 무관(관리 도구). 단 이번 커밋에 클라 3파일도 v0.533 으로 동반 상향됨.
- 향후 개선 후보: 로그 파일 로테이션(server.log 무한 증가 방지), admin 토큰을 UPDATE_TOKEN 과 분리, 크래시 발생 시 푸시/이메일 알림.

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

## ✅ Google 프로필 사진 + Webhook 자동 배포 완료 (2026-06-20, v0.528)
Google 로그인 시 프로필 사진 표시 (JWT 디코딩 + localStorage 저장) 완료.
폴링 방식 → GitHub Webhook 즉시 트리거 방식으로 전환.
로그아웃 시 데이터 유지/초기화 선택 옵션 추가.

### 주요 변경사항

**v0.526 (Google 프로필 사진)**
- JWT에서 프로필 이미지 URL 추출 (base64url → base64 변환 필수: `replace(/-/g, '+').replace(/_/g, '/')`)
- 사진 URL을 localStorage에 저장 → 이미 로그인된 상태에서도 설정 진입 시 자동 복원
- 로그아웃 시 localStorage에서 사진 삭제
- 헤더 텍스트 "내 자산 플랜" → "나의 연금 키우기"

**v0.527 (Git Webhook 자동 배포)**
- 서버: `POST /api/github-webhook` 엔드포인트 신설 (HMAC-SHA256 검증)
- 수신 즉시: `git pull origin main` + Cloudflare 캐시 퍼지 자동 실행
- 환경변수: `GITHUB_WEBHOOK_SECRET`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN` (모두 `server/.env`)
- GitHub Webhooks 설정: Payload URL `https://mypm.growpension.com/api/github-webhook`, "Just the push event"
- `scripts/auto-pull.ps1`은 수동 폴백용으로만 유지 (평상시 사용 안 함)

**v0.528 (로그아웃 옵션)**
- 로그아웃 확인 후 두 번째 다이얼로그: "데이터를 초기화하시겠습니까?"
  - 확인 = 초기화 (localStorage 전체 삭제, `doReset(false)` 호출 후 reload)
  - 취소 = 유지 (데이터 보존, 설정 화면만 닫기)

### 커밋 검증 (중요)
**규칙**: 커밋 후 `git show HEAD:index.html | grep APP_VERSION` 으로 실제 커밋 내용 검증.
- HEAD의 버전과 커밋 메시지의 버전이 일치해야 함.
- 이전 세션에서 v0.526이 커밋되지 않은 사건 방지.

### 집 PC 작업 스케줄러 (갱신)
- `MyPMBackend`: node.exe dist\server.js, 작업폴더 `C:\Users\강민구\mypm\server` (★ .env 로드 위치)
- `MyPMTunnel`: cloudflared tunnel run mypm
- **태스크명을 반드시 직접 지정**으로 조회: `Get-ScheduledTask MyPMBackend` (와일드카드 검색 불가)
- 재시작: `Stop-ScheduledTask MyPMBackend; Start-ScheduledTask MyPMBackend`

### 운영 요점
- push → Webhook 자동 처리 (git pull + CF purge) → 브라우저 Ctrl+Shift+R 만 하면 끝.
- Webhook 미동작 시만 수동 폴백: `git pull` + 수동 CF purge.
- 서버 코드(TypeScript) 변경 시만: `npm run build` + 태스크 재시작.

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

## 작업 규칙 (CLAUDE.md 가 최신 기준)
- 클라이언트 자산(`index.html`/`NonK.html`/`KDeal.html`) 변경 시 **patch +0.001** + `sw.js` `CACHE_NAME` 동일 버전 + CLAUDE.md "현재 버전" 동기화. (서버/문서만 바뀌면 생략.)
- **브랜치 전략**: 고정 브랜치명을 이 문서에 박아두지 말 것(과거 `claude/tender-knuth-0agbyw` 처럼 머지 후 삭제되어 stale 해짐). 매 작업의 브랜치 규칙은 **CLAUDE.md 및 세션 지시**를 따른다(보통 작업 브랜치에 커밋·푸시 후 PR, "메업"/"ㅁㅁ" 시 머지).
- 민감정보(키/토큰/PIN)는 평문 출력·커밋 금지. `.env`·`config.yml`·자격증명 JSON은 gitignore됨.
