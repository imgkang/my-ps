// 가족여행 앱 화면 파일(index.html, trip-data.js) 관리 — admin.html "여행앱 파일" 카드에서 사용.
// 예약정보가 들어 있어 git(공개 저장소)을 거치지 않고 서버 폴더(TRIP_STATIC_DIR)에 직접 저장한다.
//  - 허용 파일명 2개만, 내용 형식 점검, 원자적 쓰기(tmp → rename)
//  - 덮어쓰기 전 기존 파일을 <폴더>/.backup/ 에 시각별로 보관(파일당 최근 5개). dot 폴더라 /trip 으로 서빙되지 않는다.
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from './env.js';
import { extractPlaceKeys } from './trip.js';

export const TRIP_FILES = ['index.html', 'trip-data.js'] as const;
export type TripFileName = (typeof TRIP_FILES)[number];
export const MAX_TRIP_FILE_BYTES = 1024 * 1024; // 1MB
const KEEP_BACKUPS = 5;

export const isTripFileName = (n: unknown): n is TripFileName =>
  typeof n === 'string' && (TRIP_FILES as readonly string[]).includes(n);

const root = () => resolve(env.TRIP_STATIC_DIR);
const backupDir = () => resolve(root(), '.backup');

export type TripFileInfo = { name: TripFileName; exists: boolean; size: number | null; mtime: string | null; backups: number };

export async function listTripFiles(): Promise<{ dir: string; dirExists: boolean; files: TripFileInfo[] }> {
  let dirExists = false;
  try { dirExists = (await stat(root())).isDirectory(); } catch { /* 없음 */ }
  let backups: string[] = [];
  try { backups = await readdir(backupDir()); } catch { /* 없음 */ }
  const files = await Promise.all(
    TRIP_FILES.map(async (name) => {
      const count = backups.filter((b) => b.startsWith(name + '.')).length;
      try {
        const st = await stat(resolve(root(), name));
        return { name, exists: st.isFile(), size: st.size, mtime: st.mtime.toISOString(), backups: count };
      } catch {
        return { name, exists: false, size: null, mtime: null, backups: count };
      }
    })
  );
  return { dir: root(), dirExists, files };
}

export async function readTripFile(name: TripFileName): Promise<string | null> {
  try { return await readFile(resolve(root(), name), 'utf8'); } catch { return null; }
}

// 내용 점검 — 다른 파일을 잘못 올리는 실수를 막는다. 반환: 오류 문구 또는 null.
export function validateTripFile(name: TripFileName, content: string): { error: string | null; info: string } {
  if (!content.trim()) return { error: '빈 파일입니다', info: '' };
  if (Buffer.byteLength(content, 'utf8') > MAX_TRIP_FILE_BYTES) return { error: '파일이 너무 큽니다(최대 1MB)', info: '' };
  if (content.includes('�')) return { error: 'UTF-8 텍스트 파일이 아닙니다', info: '' };
  if (name === 'index.html') {
    if (!/<html[\s>]/i.test(content) || !/trip-data\.js/.test(content))
      return { error: 'index.html 형식이 아닙니다(<html> 과 trip-data.js 로드가 있어야 함)', info: '' };
    return { error: null, info: '' };
  }
  if (!/window\.TRIP\s*=/.test(content)) return { error: 'trip-data.js 형식이 아닙니다(window.TRIP = … 이 있어야 함)', info: '' };
  const places = extractPlaceKeys(content).size;
  if (!places) return { error: 'places(장소 목록)를 찾지 못했습니다', info: '' };
  const days = (content.match(/\bdate\s*:\s*["']\d{4}-\d{2}-\d{2}["']/g) ?? []).length;
  return { error: null, info: `장소 ${places}곳 · 일정 ${days}일` };
}

export async function saveTripFile(name: TripFileName, content: string): Promise<{ backedUp: boolean }> {
  await mkdir(root(), { recursive: true });
  const target = resolve(root(), name);
  let backedUp = false;
  try {
    await stat(target);
    await mkdir(backupDir(), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await copyFile(target, resolve(backupDir(), `${name}.${stamp}`));
    backedUp = true;
    const olds = (await readdir(backupDir())).filter((b) => b.startsWith(name + '.')).sort();
    for (const o of olds.slice(0, Math.max(0, olds.length - KEEP_BACKUPS))) await unlink(resolve(backupDir(), o));
  } catch { /* 기존 파일 없음 */ }
  const tmp = `${target}.tmp-${process.pid}`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, target);
  return { backedUp };
}
