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

## Cloudflare Tunnel 상시화 (외부 고정 HTTPS 접속) — Windows

고정 주소(`https://mypm.<도메인>`)로 외부에서 접속하고, 부팅 시 자동 시작시킨다.
**전제**: 도메인을 Cloudflare 에 추가(네임서버를 Cloudflare 로 변경 — 도메인 등록기관에서 1회).

```powershell
# 1) cloudflared 설치
winget install Cloudflare.cloudflared

# 2) 로그인 (브라우저에서 해당 도메인 zone 선택·승인)
cloudflared tunnel login

# 3) 터널 생성 → %USERPROFILE%\.cloudflared\<UUID>.json 자격증명 생성
cloudflared tunnel create mypm

# 4) DNS 라우팅 (mypm.<도메인> → 이 터널)
cloudflared tunnel route dns mypm mypm.<도메인>

# 5) 설정 파일 작성: cloudflared.example.yml 을 복사해 값 채우고
#    %USERPROFILE%\.cloudflared\config.yml 로 저장 (tunnel/credentials-file/hostname)

# 6) 임시 실행 후 외부에서 확인: https://mypm.<도메인>/api/health → {"ok":true}
cloudflared tunnel run mypm

# 7) cloudflared 를 Windows 서비스로 등록 (부팅 자동 시작)
cloudflared service install
```

### 백엔드도 부팅 시 자동 시작 (상시화 핵심)
백엔드가 떠 있어야 터널이 프록시한다. **NSSM** 으로 서비스 등록 권장:
```powershell
# nssm 설치(winget install nssm) 후
nssm install MyPMBackend "C:\Program Files\nodejs\node.exe" dist\server.js
nssm set MyPMBackend AppDirectory "C:\Users\<사용자>\MyPM\my-ps\server"   # ★ .env 가 이 폴더에서 로드됨
nssm set MyPMBackend Start SERVICE_AUTO_START
nssm start MyPMBackend
```
> AppDirectory(작업 디렉터리)를 **반드시 `server/` 로** 지정해야 `.env`(APP_PIN/FINNHUB_KEY 등)가 로드된다.
> 대안: 작업 스케줄러 "시스템 시작 시" 트리거 + 동작 `node dist\server.js`, "시작 위치"=server 폴더.

빌드 갱신 시: `git pull && npm run build` 후 `nssm restart MyPMBackend`.

## 보안
- `.env`, `*.p8`, `data/`, `*.db`, `config.yml`, 터널 자격증명 JSON 은 `.gitignore` 처리됨 — **커밋 금지**.
- Finnhub 키는 `.env` 에만 둔다.
- **인터넷 노출 주의**: 외부 공개 시 `/api/auth/login` 이 PIN 무차별 대입에 노출된다.
  - **APP_PIN 을 충분히 길게**(단순 4자리 금지). 로그인은 IP별 5분/10회 초과 시 자동 차단(`src/auth.ts`).
  - 공개 라우트(`/api/health`,`/api/price`,`/api/search`)는 민감정보 없음(의도된 공개). `/api/sync`(데이터)는 Bearer 토큰 필수.
  - `/server`·dotfile 은 정적 서빙에서 차단됨(`.env`·DB 비노출).

## 남은 작업 (다음 단계)
- Phase 3: 프론트(`index/NonK/KDeal.html`)의 localStorage·Drive 코드를 `/api` 호출로 교체 (`js/api.js` 신설)
- Phase 4: Capacitor 래핑 + iOS 빌드 (Mac/클라우드 필요)
- Phase 5: APNs 발송 (`src/lib/apns.ts`) + 스케줄러 알림 연결
