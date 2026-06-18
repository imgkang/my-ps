# My PM 백엔드 (server/)

집 Windows 11 PC에서 실행하는 백엔드. 데이터 저장(SQLite) + 주가 프록시 + 종목 검색 + 푸시 알림을 담당하며, Cloudflare Tunnel을 통해 아이폰 앱(Capacitor)이 HTTPS로 접속한다.

## 스택
- **Node.js + TypeScript + Fastify** — API 서버
- **SQLite** (`better-sqlite3`) — 데이터 저장 (localStorage + Google Drive 대체)
- **종목 갱신**: 기존 `../scripts/update_tickers.py` (Python) 재사용

## 빠른 시작 (Windows)

```bash
# 1) Node.js LTS 설치 (https://nodejs.org)
cd server
npm install

# 2) 환경변수 설정
copy .env.example .env
#   .env 를 열어 APP_PIN, FINNHUB_KEY 등을 채운다.

# 3) 종목 마스터 적재 (최초 1회)
npm run load-tickers          # ../tickers.json 자동 사용

# 4) 기존 데이터 마이그레이션 (Google Drive 의 mypm-data.json)
npm run import -- C:\경로\mypm-data.json

# 5) 개발 실행
npm run dev
#   또는 프로덕션:
npm run build && npm start
```

서버는 기본 `http://0.0.0.0:3000` 에서 실행된다.

## API 요약
| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | `/api/health` | 헬스 체크 | - |
| POST | `/api/auth/login` | `{pin}` → `{token}` | - |
| GET/PUT | `/api/sync` | 전체 데이터 번들 (Drive 형식) | Bearer |
| GET | `/api/sync/meta` | `{version, updated_at}` | Bearer |
| GET | `/api/price?url=` | Naver/Yahoo CORS 프록시 | - |
| GET | `/api/price/finnhub?symbol=` | Finnhub (키 서버 주입) | - |
| GET | `/api/search?q=&country=&limit=` | 종목 검색 | - |
| POST | `/api/push/register` | APNs 토큰 등록 | Bearer |
| GET/POST/DELETE | `/api/push/alerts` | 가격 알림 규칙 | Bearer |

인증 토큰: `Authorization: Bearer <token>` (PIN 로그인으로 발급).

## Cloudflare Tunnel (외부 접속)
```bash
# cloudflared 설치 후
cloudflared tunnel login
cloudflared tunnel create mypm
cloudflared tunnel route dns mypm mypm.<도메인>
# config.yml 에서 service: http://localhost:3000 지정 후
cloudflared tunnel run mypm
# Windows 서비스로 등록: cloudflared service install
```

## 보안
- `.env`, `*.p8`, `data/`, `*.db` 는 `.gitignore` 처리됨 — **커밋 금지**.
- Finnhub 키는 `.env` 에만 둔다. (기존 `NonK.html` 하드코딩 키는 제거 대상이며 재발급 권장)

## 남은 작업 (다음 단계)
- Phase 3: 프론트(`index/NonK/KDeal.html`)의 localStorage·Drive 코드를 `/api` 호출로 교체 (`js/api.js` 신설)
- Phase 4: Capacitor 래핑 + iOS 빌드 (Mac/클라우드 필요)
- Phase 5: APNs 발송 (`src/lib/apns.ts`) + 스케줄러 알림 연결
