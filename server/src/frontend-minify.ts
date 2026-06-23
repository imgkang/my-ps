// 프론트 HTML minify 서빙 — 소스(index/NonK/KDeal.html)는 읽기 쉬운 상태로 두고,
// 브라우저에는 압축본을 보낸다(전송 크기↓). 파일 mtime 기준 캐시 → 배포로 파일이
// 바뀌면 자동 재압축. html-minifier-terser 미설치/실패 시 원본을 그대로 서빙(무중단).
//
// 안전 설정: 전역 함수 이름 보존(mangle.toplevel=false, keep_fnames) — 인라인
// onclick="fn()" 이 전역 함수명을 직접 부르므로 이름을 바꾸지 않는다.
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '..');
export const FRONT_FILES = ['index.html', 'NonK.html', 'KDeal.html'] as const;
const FILE_SET = new Set<string>(FRONT_FILES);

const MIN_OPTS = {
  collapseWhitespace: true,
  removeComments: true,
  minifyCSS: true,
  minifyJS: {
    compress: { drop_console: false },
    mangle: { toplevel: false, keep_fnames: true },
    format: { comments: false },
  },
};

// 변수 지정자 동적 import — 미설치 패키지를 리터럴로 import 하면 TS 컴파일이 막히므로.
async function dynImport(pkg: string): Promise<any> {
  return import(pkg);
}

// undefined=미시도, null=불가(미설치), fn=사용가능
let minifyFn: ((html: string, opts: unknown) => Promise<string>) | null | undefined;

async function getMinify() {
  if (minifyFn !== undefined) return minifyFn;
  try {
    const m: any = await dynImport('html-minifier-terser');
    minifyFn = m.minify;
  } catch {
    minifyFn = null;
    console.warn('[minify] html-minifier-terser 미설치 — 원본 서빙');
  }
  return minifyFn;
}

async function buildMinified(path: string): Promise<string> {
  const raw = await readFile(path, 'utf8');
  const minify = await getMinify();
  if (!minify) return raw;
  try {
    return await minify(raw, MIN_OPTS);
  } catch (e: any) {
    console.warn('[minify] 실패, 원본 서빙:', path, e?.message);
    return raw;
  }
}

const cache = new Map<string, { mtimeMs: number; html: Promise<string> }>();

export async function getFrontendHtml(file: string): Promise<string> {
  if (!FILE_SET.has(file)) throw new Error('frontend 파일 아님: ' + file);
  const path = resolve(repoRoot, file);
  const { mtimeMs } = await stat(path);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.html;
  const html = buildMinified(path);
  cache.set(file, { mtimeMs, html });
  return html;
}

// 첫 요청 지연 제거용 사전 워밍업(백그라운드).
export function warmFrontendCache(): void {
  for (const f of FRONT_FILES) getFrontendHtml(f).catch(() => {});
}

// 측정용: 파일별 원본/서빙(압축) 바이트.
export async function frontendServedSizes(): Promise<Record<string, { source: number; served: number }>> {
  const out: Record<string, { source: number; served: number }> = {};
  for (const f of FRONT_FILES) {
    const raw = await readFile(resolve(repoRoot, f), 'utf8');
    const served = await getFrontendHtml(f);
    out[f] = { source: Buffer.byteLength(raw), served: Buffer.byteLength(served) };
  }
  return out;
}
