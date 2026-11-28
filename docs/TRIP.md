# 가족여행 앱 (/trip) — 배포·운영 메모

`https://mypm.growpension.com/trip/` 에서 서비스. 서버 코드는 `server/src/trip.ts`.

## 버전
MyPM 과 별도로 관리한다. 기준값: `server/src/trip.ts` 의 `TRIP_VERSION` (현재 `v0.014`).
확인 방법: 로그인 화면 하단 표기, `GET /trip/api/me` 의 `version`, 모든 `/trip` 응답의 `X-Trip-Version` 헤더.
여행앱만 바뀐 배포에서는 MyPM 버전(sw.js `CACHE_NAME` 등)을 올리지 않는다.

## 왜 앱 파일이 저장소에 없나
`index.html`·`trip-data.js` 에 크루즈 예약번호·예약자명이 있고 이 저장소는 **공개**다.
앱 파일은 집 PC의 `server/private/trip/` (`.gitignore` 처리)에만 두고, 서버가 **로그인 확인 후에만** 내려준다.
웹훅 자동배포 대상이 아니다. **관리 페이지(admin.html) → 「여행앱 파일」 카드**에서 올린다(어디서든 가능, 재시작 불필요, `no-cache` 라 바로 반영).
- 일정 수정: 「내려받기」 → 편집 → 「올리기」
- 덮어쓸 때 이전 파일은 `server/private/trip/.backup/` 에 파일당 최근 5개 보관(dot 폴더라 /trip 으로 서빙 안 됨)
- 올릴 때 형식 점검: index.html 은 `<html>`+`trip-data.js` 로드, trip-data.js 는 `window.TRIP =` + places 1개 이상. 최대 1MB
- API: `GET /api/admin/trip-files`, `GET|PUT /api/admin/trip-files/{index.html|trip-data.js}` (UPDATE_TOKEN 보호, PUT body `{ content }`)
- 집 PC에서 폴더에 직접 넣어도 된다.
여행앱 **서버 코드**(`server/src/trip*.ts`)는 다른 서버 코드와 같이 main 머지 시 웹훅이 자동 빌드·재시작한다.

```
server/private/trip/
  index.html
  trip-data.js
```

## 환경변수 (`server/.env` — 값은 커밋 금지)
| 키 | 설명 |
|---|---|
| `TRIP_MEMBER_EMAILS` | (선택) 최초 1회만 DB로 이관되는 초기값. 이후 멤버는 **관리 페이지(admin.html) "계정 관리"**에서 관리 |
| `TRIP_ADMIN_EMAILS` | (선택) 추가 공지 수정 권한자. 소유자(`OWNER_EMAIL`)는 설정과 무관하게 항상 관리자. 관리자는 자동으로 멤버 |
| `TRIP_ALLOWED_ORIGINS` | POST/PUT 허용 Origin. 운영값 `https://mypm.growpension.com` 권장(비우면 Host 헤더 기준) |
| `TRIP_STATIC_DIR` | 기본 `./private/trip` (server 폴더 기준) |
| `TRIP_PLACE_KEYS` | 선택. 비우면 `trip-data.js` 의 `places` 키를 자동 추출해 대조 |
| `TRIP_COOKIE_INSECURE` | 로컬 http 테스트 전용. 운영에서는 설정하지 말 것 |

`GOOGLE_CLIENT_ID` 는 MyPM 과 같은 값을 재사용한다(승인된 JS 원본에 `https://mypm.growpension.com` 이 이미 있어야 함).

## 계정 관리 — MyPM·여행 한 화면
`admin.html` → **계정 관리** 카드. 이메일마다 **MyPM / 여행** 스위치를 켜고 끈다(즉시 적용, 재시작 불필요).
- 소유자(`OWNER_EMAIL`)는 기본으로 MyPM·여행 모두 허용 + 여행 관리자(🔒, 끌 수 없음)
- 여행을 끄면 기존 로그인 세션도 다음 요청부터 401
- API: `GET/PUT /api/admin/accounts?token=…` (body `{ email, note?, mypm?: bool, trip?: bool }`)

## 홈 화면 앱 (v0.011~)
- 이름 「시드니 여행」, 아이콘 `server/assets/trip/icon-{180,192,512}.png`(플랫 일러스트 오페라하우스, 직접 그린 그림). 다시 만들려면 `python3 server/assets/trip/make-icons.py`(Pillow).
- `/trip/manifest.webmanifest`, `/trip/icon-*.png` 는 **로그인 없이 공개**(브라우저가 쿠키 없이 가져감). 나머지 `/trip/*` 는 그대로 로그인 필요.
- 비공개 `index.html` 을 다시 올리지 않도록 서버가 앱 화면 HTML 에 manifest·아이콘·`viewport-fit=cover` 를 끼워 넣는다(`injectPwa`).
  상단 제목 왼쪽 아이콘도 같은 방식(v0.012): `<header class="top">` 의 첫 `<h1>` 앞에 `<img class="ttl-ic">` + 스타일. 구조가 바뀌어 패턴이 없으면 건너뜀.
- 아이폰 홈 화면 앱은 브라우저와 쿠키를 따로 써서 한 번 로그인해야 하고, 그 안에서 구글 팝업 로그인이 잘 안 됨 →
  홈 화면 앱일 때만 **리다이렉트 로그인**: 로그인 화면이 `trip_login=1`(Path=/api/auth) 표시를 남기고, 이미 등록된
  `/api/auth/google-redirect`(MyPM 과 공용, auth.ts)가 이 표시를 보면 g_csrf_token 확인 후 `tripLoginRedirect` 로 여행앱 세션 발급.

## 인증
- `/trip/` 비로그인 → 구글 로그인 화면. `/trip/*` 파일·`/trip/api/*` 는 401.
- 로그인 성공 시 `trip_sess` 쿠키(HttpOnly·Secure·SameSite=Lax·Path=/trip, 30일). 앱 화면을 열 때마다 재발급(30일 연장).
  - v0.010 에서 Strict → Lax: Strict 는 카톡·문자·메일 등 다른 앱 링크로 열면 쿠키가 안 가서 1~2일마다 로그인 화면이 떴음.
    Lax 는 링크로 들어오는 GET 에만 쿠키를 보내고, POST/PUT/DELETE 는 Origin 검사로 계속 차단.
  - 카톡 등 앱 안 브라우저는 쿠키를 따로 써서 로그인이 이어지지 않음 → 로그인 화면에 「Chrome/Safari에서 열기」 안내.
  - ⚠️ 로그인 화면 HTML 은 서버 템플릿 문자열 안에 있어 정규식 역슬래시가 사라진다 — `[(]` `[/]` 처럼 문자 클래스로 쓸 것.
  MyPM Bearer 토큰과 별개의 서명키(용도별 파생)라 서로 재사용 불가.
- 멤버 목록은 요청마다 DB(`trip_members`)와 대조 → 관리 페이지에서 끄면 즉시 차단.
- POST/PUT 은 Origin 확인. MyPM 서비스워커는 `/trip/` 을 캐시하지 않는다(MyPM v0.695~).

## API (프론트 상대경로 `api/`)
`GET me` · `GET messages?after=` · `POST messages` · `GET notice` · `PUT notice`(관리자) — 계약은 인계서(HANDOFF.md) 3장과 동일.
검증: uid/ts/id 서버 생성, nick 1~12자, text 1~1000자(place 는 ≤200), kind 화이트리스트, place 형식+키 대조,
본문 8KB(413), 사용자당 분당 30건(429), 응답 `Cache-Control: no-store`, 제어문자 제거.

## 일정 편집 · 예약 영수증 (v0.007~)
- 일정은 서버 DB(`trip_schedule`, 문서 1건 + rev)에 저장. 소유자가 일정 탭 「일정 편집」 → 항목 ✎ 수정 / + 항목 추가 / 날짜 제목 / ▲▼ 순서 / 새 장소 추가.
  처음 켤 때 화면의 `trip-data.js` 내용을 서버로 옮김(서버는 JS 를 실행하지 않음). 이후 `trip-data.js` 는 DB 일정이 없을 때만 쓰임.
- 동시 수정은 rev 로 막음(다른 기기에서 먼저 바뀌면 409 → 최신 일정 다시 불러옴). 가족 화면은 60초마다 갱신.
- 예약 영수증: 항목 수정 화면 「📎 영수증 추가」(PDF·JPG·PNG·WEBP·HEIC, 15MB, 항목당 10개). 파일 내용으로 형식 판별(SVG·HTML 거부).
  저장 위치 `TRIP_RECEIPT_DIR`(기본 `server/private/trip-receipts/`, git 제외). 로그인한 멤버 모두 열람, 추가·삭제는 소유자.
  항목을 지우면 그 영수증도 삭제됨. ⚠️ 영수증 파일은 DB 백업에 포함되지 않으므로 폴더를 따로 백업할 것.
- API: `GET|PUT /trip/api/schedule`, `POST /trip/api/receipts?item=`, `GET|DELETE /trip/api/receipts/:id`

## 여기로 집합 (v0.013~)
흩어진 일행을 지금 위치로 모으는 임시 공지. 서버 `server/src/trip-rally.ts`, 화면 `server/assets/trip/addons.js`(v0.014 에서 rally.js → addons.js, 공개 — 개인정보 없음, API 는 로그인 필요).
- 화면 스크립트는 서버가 앱 화면 HTML 끝에 `<script src="/trip/addons.js?v=빌드">` 로 붙임 → 비공개 index.html 수정·재업로드 없음.
  장소 탭(`#v-places`, 없으면 `#main`) 맨 위에 카드를 넣고, 진행 중이면 장소 탭 버튼에 빨간 점.
- 요청: 누구나. 휴대폰 위치(GPS) + 집합 시각 + 메모 → 채팅에 「📍 여기로 집합」 메시지 자동 기록(안 읽음 배지로 알림).
  진행 중인 요청이 있으면 새 요청으로 교체. 같은 사람 15초 안 연속 요청은 429.
- 완료·취소: 요청한 사람 또는 소유자. 완료하면 카드가 사라지고, 요청한 날(시드니 날짜)의 일정에
  「여기서 집합」 항목(시간 = 집합 시각 또는 완료 시각, 메모, 장소 = 좌표 검색어 `"위도, 경도"`)을 시간 순서 자리에 자동 추가.
  그 날짜가 일정에 없거나 일정이 아직 DB 에 없으면 기록은 건너뛰고 이유를 알려 줌. 일정 rev 가 1 올라감.
- API: `GET|POST /trip/api/rally`, `POST /trip/api/rally/:id/done|cancel`. 기록 테이블 `trip_rally`(상태 active/done/cancelled/replaced).

## 새 버전 알림 (v0.014~)
홈 화면 앱은 새로고침 버튼이 없고, 다른 앱에 다녀와도 예전 화면이 남아 있다 → 새 버전이 있으면 맨 위에 「새 버전이 있어요 · 새로고침」.
- 빌드 번호 = `TRIP_VERSION` + (비공개 index.html · trip-data.js · addons.js 수정 시각)의 해시(`buildId()`).
  서버 업데이트뿐 아니라 관리 페이지에서 index.html 을 새로 올려도 바뀐다.
- 서버가 화면에 `window.__TRIP_BUILD` 로 찍어 보내고, addons.js 가 앱으로 돌아올 때·1분마다 `/api/me` 의 `build` 와 비교.
- 「✕」는 그 화면에서만 숨김(다시 열면 다시 확인).

## 경비 탭 (소유자 전용)
기존 `trip.html` 경비 페이지를 여행앱 「경비」 탭으로 옮김(`trip.html` 은 MyPM v0.700 에서 삭제). 데이터는 서버 DB(`trip_expenses`, `trip_expense_settings`).
- 소유자(`OWNER_EMAIL`)만: `/api/me` 의 `isOwner` 가 true 일 때만 탭 표시, 서버도 그 외 403
- API (`/trip/api/expenses…`): `GET` 목록·환율 / `PUT items/:id` 추가·수정 / `DELETE items/:id` / `POST import` 합치기(같은 id 건너뜀, 덮어쓰기 없음) / `PUT rates`
- 「이 기기의 기존 경비 가져오기」: 같은 사이트라 휴대폰 브라우저에 남은 `trip.html` 데이터(localStorage `trip-sydney-2027`)를 바로 읽어 서버로 합침. 기존 데이터는 지우지 않음
  (페이지를 지워도 브라우저 저장 데이터는 남아 있어, 아직 안 옮긴 기기에서도 이 버튼으로 가져올 수 있음)
- 화면 코드는 비공개 `index.html` 안에 있음(관리 페이지에서 업로드)

## 보관 (수동 결정)
자동 삭제 없음. 여행 후 집 PC에서:
```powershell
cd C:\Users\강민구\mypm\server
npm run trip-admin -- stats
npm run trip-admin -- export            # data\trip-export-<날짜>.json
npm run trip-admin -- purge --yes       # 메시지·공지·여행앱 사용자 삭제
```
