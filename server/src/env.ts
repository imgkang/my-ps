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

export const env = {
  PORT: Number(process.env.PORT ?? 3000),
  APP_PIN: process.env.APP_PIN ?? '',
  FINNHUB_KEY: process.env.FINNHUB_KEY ?? '',
  DB_PATH: process.env.DB_PATH ?? './data/mypm.db',
  // 프론트 정적 파일 서빙(로컬 테스트용 단일 출처). 'false' 면 API 전용.
  SERVE_STATIC: (process.env.SERVE_STATIC ?? 'true') !== 'false',
  // iOS 푸시 (APNs)
  APNS_KEY_PATH: process.env.APNS_KEY_PATH ?? '',
  APNS_KEY_ID: process.env.APNS_KEY_ID ?? '',
  APNS_TEAM_ID: process.env.APNS_TEAM_ID ?? '',
  APNS_BUNDLE_ID: process.env.APNS_BUNDLE_ID ?? '',
  APNS_ENV: process.env.APNS_ENV ?? 'development',
  // Android 푸시 (FCM) — Firebase 서비스 계정 키 JSON 경로
  FCM_SERVICE_ACCOUNT_PATH: process.env.FCM_SERVICE_ACCOUNT_PATH ?? '',
};

if (!env.APP_PIN) {
  console.warn('[env] ⚠️  APP_PIN 이 설정되지 않았습니다. .env 를 확인하세요.');
}
