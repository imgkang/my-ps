// 성과측정(원격 자동) — 프론트 파일크기 + 인출 계산속도를 측정해 스냅샷으로 저장.
//   - 배포(webhook/재시작) 때마다 자동 1회 측정 → bench_runs 에 누적 → 추세 조회.
//   - GET /api/admin/bench 로 원격 조회, 배포 시 푸시 알림으로 핵심 수치 전송.
//
// 측정 항목(요청한 코드기반 2종):
//   ① 프론트 파일 크기(index/NonK/KDeal, 원본+gzip)  — 작을수록 좋음
//   ② 인출 렌더 속도 = 서버 투영 계산시간 + 클라 동기 조립비용 — 빠를수록 좋음
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exec, execSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { db } from '../db.js';
import { simulateWithdrawal } from '../compute/withdrawal.js';
import { benchInputs, clientAssembleCost } from './fixtures.js';
import { broadcastPush, type PushDevice } from '../lib/push.js';

const repoRoot = resolve(process.cwd(), '..');
const FRONT = ['index.html', 'NonK.html', 'KDeal.html'];

export interface BenchSnapshot {
  sha: string;
  version: string;
  ts: string;
  frontend: { files: Record<string, { raw: number; gz: number }>; totalRaw: number; totalGz: number };
  timing: { serverComputeMs: number; clientAssembleMs: number; iterations: number };
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function frontendSizes(ref?: string) {
  const files: Record<string, { raw: number; gz: number }> = {};
  let totalRaw = 0, totalGz = 0;
  for (const f of FRONT) {
    let buf: Buffer;
    if (ref) buf = execSyncBuf(`git -C "${repoRoot}" show ${ref}:${f}`);
    else buf = readFileSync(resolve(repoRoot, f));
    const gz = gzipSync(buf).length;
    files[f] = { raw: buf.length, gz };
    totalRaw += buf.length; totalGz += gz;
  }
  return { files, totalRaw, totalGz };
}

function execSyncBuf(cmd: string): Buffer {
  // git show 결과(바이너리 안전) — 동기. 실패 시 빈 버퍼.
  try { return execSync(cmd, { maxBuffer: 64 * 1024 * 1024 }) as Buffer; } catch { return Buffer.alloc(0); }
}

function computeTiming(iterations = 150) {
  const serverMs: number[] = [], clientMs: number[] = [];
  for (const input of benchInputs) {
    for (let i = 0; i < 20; i++) { simulateWithdrawal(input); clientAssembleCost(input); } // warmup
    for (let i = 0; i < iterations; i++) {
      let t = performance.now(); simulateWithdrawal(input); serverMs.push(performance.now() - t);
      t = performance.now(); clientAssembleCost(input); clientMs.push(performance.now() - t);
    }
  }
  return {
    serverComputeMs: +median(serverMs).toFixed(4),
    clientAssembleMs: +median(clientMs).toFixed(4),
    iterations: iterations * benchInputs.length,
  };
}

function readVersion(): string {
  try {
    const m = readFileSync(resolve(repoRoot, 'sw.js'), 'utf8').match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : 'unknown';
  } catch { return 'unknown'; }
}

function gitSha(): Promise<string> {
  return new Promise((r) => exec(`git -C "${repoRoot}" rev-parse --short HEAD`, (_e, out) => r((out || '').trim() || 'unknown')));
}

export async function runBench(): Promise<BenchSnapshot> {
  const sha = await gitSha();
  return {
    sha, version: readVersion(), ts: new Date().toISOString(),
    frontend: frontendSizes(), timing: computeTiming(),
  };
}

export function storeSnapshot(snap: BenchSnapshot): void {
  db.prepare('INSERT INTO bench_runs (sha, version, ts, json) VALUES (?, ?, ?, ?)')
    .run(snap.sha, snap.version, snap.ts, JSON.stringify(snap));
}

export function latestSnapshot(): BenchSnapshot | null {
  const row = db.prepare('SELECT json FROM bench_runs ORDER BY id DESC LIMIT 1').get() as { json: string } | undefined;
  return row ? JSON.parse(row.json) : null;
}

export function history(n: number): BenchSnapshot[] {
  return (db.prepare('SELECT json FROM bench_runs ORDER BY id DESC LIMIT ?').all(n) as { json: string }[])
    .map((r) => JSON.parse(r.json));
}

// 직전 스냅샷 대비 프론트 크기/계산속도 델타(%).
export function withDeltas(snap: BenchSnapshot, prev: BenchSnapshot | null) {
  const pct = (now: number, was?: number) => (was ? +(((now - was) / was) * 100).toFixed(2) : null);
  return {
    ...snap,
    deltaVsPrev: prev ? {
      prevSha: prev.sha,
      indexRawPct: pct(snap.frontend.files['index.html']?.raw, prev.frontend.files['index.html']?.raw),
      totalRawPct: pct(snap.frontend.totalRaw, prev.frontend.totalRaw),
      totalGzPct: pct(snap.frontend.totalGz, prev.frontend.totalGz),
      serverComputeMsPct: pct(snap.timing.serverComputeMs, prev.timing.serverComputeMs),
    } : null,
  };
}

async function pushBench(snap: BenchSnapshot, prev: BenchSnapshot | null): Promise<void> {
  const devices = db.prepare('SELECT token, platform FROM devices').all() as PushDevice[];
  if (!devices.length) return;
  const idxKb = (snap.frontend.files['index.html']?.raw || 0) / 1024;
  const prevIdx = prev?.frontend?.files?.['index.html']?.raw;
  const dPct = prevIdx ? (((snap.frontend.files['index.html'].raw - prevIdx) / prevIdx) * 100).toFixed(1) + '%' : '신규';
  const body = `index.html ${idxKb.toFixed(1)}KB (Δ${dPct}) · 서버계산 ${snap.timing.serverComputeMs}ms`;
  await broadcastPush(devices, { title: `📊 ${snap.version} 성과측정`, body, data: { kind: 'bench', sha: snap.sha } });
}

// 배포/재시작 시 1회 호출. 같은 sha 면 중복 저장·푸시 생략(크래시 재시작 노이즈 방지).
export async function recordBenchAndNotify(log?: (s: string) => void, errLog?: (s: string) => void): Promise<BenchSnapshot | null> {
  try {
    const prev = latestSnapshot();
    const snap = await runBench();
    if (prev && prev.sha === snap.sha) { log?.(`[bench] sha 동일(${snap.sha}) — 측정 스킵`); return snap; }
    storeSnapshot(snap);
    log?.(`[bench] 스냅샷 저장 sha=${snap.sha} v=${snap.version} index=${(snap.frontend.files['index.html'].raw / 1024).toFixed(1)}KB serverCompute=${snap.timing.serverComputeMs}ms`);
    await pushBench(snap, prev);
    return snap;
  } catch (e: any) {
    errLog?.('[bench] 측정 실패: ' + (e?.message || e));
    return null;
  }
}

// 임의 git ref 대비 프론트 크기 비교(엔드포인트 ?base= 용).
export function frontendCompare(ref: string) {
  const cur = frontendSizes();
  const base = frontendSizes(ref);
  const pct = (now: number, was: number) => (was ? +(((now - was) / was) * 100).toFixed(2) : null);
  return {
    base: ref,
    files: Object.fromEntries(FRONT.map((f) => [f, {
      baseRaw: base.files[f].raw, curRaw: cur.files[f].raw, rawPct: pct(cur.files[f].raw, base.files[f].raw),
      baseGz: base.files[f].gz, curGz: cur.files[f].gz, gzPct: pct(cur.files[f].gz, base.files[f].gz),
    }])),
    totalRawPct: pct(cur.totalRaw, base.totalRaw),
    totalGzPct: pct(cur.totalGz, base.totalGz),
  };
}
