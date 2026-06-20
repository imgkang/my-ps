// 푸시 발송 추상화 — iOS(APNs) / Android(FCM) 플랫폼 분기.
//
// 설계 원칙:
//  - SDK(apns2 / firebase-admin)와 자격증명은 "갖춰졌을 때만" 동적 로드한다.
//    → 의존성 미설치/키 미설정 상태에서도 서버는 정상 부팅되며, 발송만 건너뛴다.
//  - 거짓 성공을 만들지 않는다. 보낼 수 없으면 { ok:false, skipped:true, reason } 을 반환.
//
// 자격증명(.p8 / 서비스 계정 JSON)은 env 로만 주입하며 소스/커밋에 포함하지 않는다.
import { env } from '../env.js';

export interface PushDevice {
  token: string;
  platform: string; // 'ios' | 'android' | 'web'
}

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
}

// 동적 import 시 TypeScript 모듈 해석을 피하기 위해 변수 지정자를 사용한다
// (미설치 패키지를 리터럴로 import 하면 컴파일 에러가 나므로).
async function dynImport(pkg: string): Promise<any> {
  return import(pkg);
}

// ───────────────────────── iOS (APNs) ─────────────────────────
let apnsClient: any | null = null;
let apnsTried = false;

async function getApns(): Promise<any | null> {
  if (apnsClient) return apnsClient;
  if (apnsTried) return null; // 한 번 실패하면 매번 재시도하지 않음
  apnsTried = true;

  if (!env.APNS_KEY_PATH || !env.APNS_KEY_ID || !env.APNS_TEAM_ID) {
    return null; // 자격증명 미설정
  }
  try {
    const { readFileSync } = await dynImport('node:fs');
    const { ApnsClient } = await dynImport('apns2'); // 미설치 시 catch
    apnsClient = new ApnsClient({
      team: env.APNS_TEAM_ID,
      keyId: env.APNS_KEY_ID,
      signingKey: readFileSync(env.APNS_KEY_PATH, 'utf8'),
      defaultTopic: env.APNS_BUNDLE_ID,
      host: env.APNS_ENV === 'production' ? 'api.push.apple.com' : undefined,
    });
    return apnsClient;
  } catch (e: any) {
    console.warn('[push] APNs 초기화 실패(미설치/설정오류):', e?.message);
    return null;
  }
}

async function sendApns(device: PushDevice, payload: PushPayload): Promise<PushResult> {
  const client = await getApns();
  if (!client) return { ok: false, skipped: true, reason: 'APNs 미구성(apns2 미설치 또는 .p8 키 미설정)' };
  try {
    const { Notification } = await dynImport('apns2');
    await client.send(
      new Notification(device.token, {
        alert: { title: payload.title, body: payload.body },
        data: payload.data,
      })
    );
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: 'APNs 발송 실패: ' + e?.message };
  }
}

// ───────────────────────── Android (FCM) ─────────────────────────
let fcmMessaging: any | null = null;
let fcmTried = false;

async function getFcm(): Promise<any | null> {
  if (fcmMessaging) return fcmMessaging;
  if (fcmTried) return null;
  fcmTried = true;

  if (!env.FCM_SERVICE_ACCOUNT_PATH) return null; // 서비스 계정 키 미설정
  try {
    const { readFileSync } = await dynImport('node:fs');
    const admin = (await dynImport('firebase-admin')).default ?? (await dynImport('firebase-admin'));
    const serviceAccount = JSON.parse(readFileSync(env.FCM_SERVICE_ACCOUNT_PATH, 'utf8'));
    if (!admin.apps?.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    fcmMessaging = admin.messaging();
    return fcmMessaging;
  } catch (e: any) {
    console.warn('[push] FCM 초기화 실패(미설치/설정오류):', e?.message);
    return null;
  }
}

async function sendFcm(device: PushDevice, payload: PushPayload): Promise<PushResult> {
  const messaging = await getFcm();
  if (!messaging) return { ok: false, skipped: true, reason: 'FCM 미구성(firebase-admin 미설치 또는 서비스 계정 키 미설정)' };
  try {
    await messaging.send({
      token: device.token,
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: 'FCM 발송 실패: ' + e?.message };
  }
}

// ───────────────────────── 통합 진입점 ─────────────────────────
export async function sendPush(device: PushDevice, payload: PushPayload): Promise<PushResult> {
  switch (device.platform) {
    case 'ios':
      return sendApns(device, payload);
    case 'android':
      return sendFcm(device, payload);
    default:
      // 웹은 별도 푸시 채널(Web Push)이 필요하므로 현재는 미지원으로 명시.
      return { ok: false, skipped: true, reason: `푸시 미지원 플랫폼: ${device.platform}` };
  }
}

// 등록된 모든 디바이스로 발송하고 결과를 집계한다.
export async function broadcastPush(
  devices: PushDevice[],
  payload: PushPayload
): Promise<{ sent: number; skipped: number; failed: number }> {
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const d of devices) {
    const r = await sendPush(d, payload);
    if (r.ok) sent++;
    else if (r.skipped) skipped++;
    else failed++;
  }
  return { sent, skipped, failed };
}
