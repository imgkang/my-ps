# 가족여행 앱 (/trip) — 배포·운영 메모

`https://mypm.growpension.com/trip/` 에서 서비스. 서버 코드는 `server/src/trip.ts`.

## 버전
MyPM 과 별도로 관리한다. 기준값: `server/src/trip.ts` 의 `TRIP_VERSION` (현재 `v0.001`).
확인 방법: 로그인 화면 하단 표기, `GET /trip/api/me` 의 `version`, 모든 `/trip` 응답의 `X-Trip-Version` 헤더.
여행앱만 바뀐 배포에서는 MyPM 버전(sw.js `CACHE_NAME` 등)을 올리지 않는다.

## 왜 앱 파일이 저장소에 없나
`index.html`·`trip-data.js` 에 크루즈 예약번호·예약자명이 있고 이 저장소는 **공개**다.
앱 파일은 집 PC의 `server/private/trip/` (`.gitignore` 처리)에만 두고, 서버가 **로그인 확인 후에만** 내려준다.
웹훅 자동배포 대상이 아니므로 일정 수정 시 집 PC에서 파일을 직접 고친다(재시작 불필요, `no-cache` 라 바로 반영).

```
server/private/trip/
  index.html
  trip-data.js
```

## 환경변수 (`server/.env` — 값은 커밋 금지)
| 키 | 설명 |
|---|---|
| `TRIP_MEMBER_EMAILS` | 가족 구글 계정, 콤마 구분. **MyPM 허용목록과 별개**(가족은 MyPM에 로그인 불가) |
| `TRIP_ADMIN_EMAILS` | 공지 수정 권한. 비우면 `OWNER_EMAIL`. 관리자는 자동으로 멤버 |
| `TRIP_ALLOWED_ORIGINS` | POST/PUT 허용 Origin. 운영값 `https://mypm.growpension.com` 권장(비우면 Host 헤더 기준) |
| `TRIP_STATIC_DIR` | 기본 `./private/trip` (server 폴더 기준) |
| `TRIP_PLACE_KEYS` | 선택. 비우면 `trip-data.js` 의 `places` 키를 자동 추출해 대조 |
| `TRIP_COOKIE_INSECURE` | 로컬 http 테스트 전용. 운영에서는 설정하지 말 것 |

`GOOGLE_CLIENT_ID` 는 MyPM 과 같은 값을 재사용한다(승인된 JS 원본에 `https://mypm.growpension.com` 이 이미 있어야 함).

## 인증
- `/trip/` 비로그인 → 구글 로그인 화면. `/trip/*` 파일·`/trip/api/*` 는 401.
- 로그인 성공 시 `trip_sess` 쿠키(HttpOnly·Secure·SameSite=Strict·Path=/trip, 30일 슬라이딩).
  MyPM Bearer 토큰과 별개의 서명키(용도별 파생)라 서로 재사용 불가.
- 멤버 목록은 요청마다 대조 → `.env` 에서 빼고 재시작하면 즉시 차단.
- POST/PUT 은 Origin 확인. MyPM 서비스워커는 `/trip/` 을 캐시하지 않는다(MyPM v0.695~).

## API (프론트 상대경로 `api/`)
`GET me` · `GET messages?after=` · `POST messages` · `GET notice` · `PUT notice`(관리자) — 계약은 인계서(HANDOFF.md) 3장과 동일.
검증: uid/ts/id 서버 생성, nick 1~12자, text 1~1000자(place 는 ≤200), kind 화이트리스트, place 형식+키 대조,
본문 8KB(413), 사용자당 분당 30건(429), 응답 `Cache-Control: no-store`, 제어문자 제거.

## 보관 (수동 결정)
자동 삭제 없음. 여행 후 집 PC에서:
```powershell
cd C:\Users\강민구\mypm\server
npm run trip-admin -- stats
npm run trip-admin -- export            # data\trip-export-<날짜>.json
npm run trip-admin -- purge --yes       # 메시지·공지·여행앱 사용자 삭제
```
