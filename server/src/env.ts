// 환경변수 로딩 — .env 파일이 있으면 읽어들인다.
// 외부 의존성 없이 Node 내장 기능만 사용.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  // Node 20.6+ 는 process.loadEnvFile 지원. 없으면 직접 파싱.
  if (typeof (process as any).loadEnvFile === 'function') {
    (process as any).loadEnvFile(envPath);
  } else {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
}

// 콤마 구분 이메일 목록 → 소문자 배열
function emailList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const env = {
  PORT: Number(process.env.PORT ?? 3000),
  FINNHUB_KEY: process.env.FINNHUB_KEY ?? '',
  DB_PATH: process.env.DB_PATH ?? './data/mypm.db',
  // 프론트 정적 파일 서빙(로컬 테스트용 단일 출처). 'false' 면 API 전용.
  SERVE_STATIC: (process.env.SERVE_STATIC ?? 'true') !== 'false',

  // ── 구글 로그인 / 다중 사용자 ──
  // 구글 OAuth 웹 클라이언트 ID (프론트 GIS 와 동일 값). 비밀 아님.
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
  // 로그인 허용 이메일 화이트리스트 (콤마 구분). 비어 있으면 아무도 로그인 불가.
  ALLOWED_EMAILS: emailList(process.env.ALLOWED_EMAILS),
  // 기존(단일 사용자) 데이터를 이관할 소유자 이메일. 마이그레이션·import 에서 사용.
  OWNER_EMAIL: (process.env.OWNER_EMAIL ?? '').trim().toLowerCase(),

  // GitHub Webhook + Cloudflare 자동 배포
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET ?? '',
  CLOUDFLARE_ZONE_ID: process.env.CLOUDFLARE_ZONE_ID ?? '',
  CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN ?? '',

  // iOS 푸시 (APNs)
  APNS_KEY_PATH: process.env.APNS_KEY_PATH ?? '',
  APNS_KEY_ID: process.env.APNS_KEY_ID ?? '',
  APNS_TEAM_ID: process.env.APNS_TEAM_ID ?? '',
  APNS_BUNDLE_ID: process.env.APNS_BUNDLE_ID ?? '',
  APNS_ENV: process.env.APNS_ENV ?? 'development',
  // Android 푸시 (FCM) — Firebase 서비스 계정 키 JSON 경로
  FCM_SERVICE_ACCOUNT_PATH: process.env.FCM_SERVICE_ACCOUNT_PATH ?? '',
};

if (!env.GOOGLE_CLIENT_ID) {
  console.warn('[env] ⚠️  GOOGLE_CLIENT_ID 가 설정되지 않았습니다 — 구글 로그인 불가. .env 를 확인하세요.');
}
if (env.ALLOWED_EMAILS.length === 0) {
  console.warn('[env] ⚠️  ALLOWED_EMAILS 가 비어 있습니다 — 아무도 로그인할 수 없습니다.');
}
