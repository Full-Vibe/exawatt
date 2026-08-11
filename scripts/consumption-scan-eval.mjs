#!/usr/bin/env node
/**
 * ENG-008 E5 — real-corpus scanner eval.
 *
 * Runs the ACTUAL Electron scanner service (compiled `dist-electron` build,
 * so the code measured is the code shipped) against THIS machine's real
 * `~/.claude/projects` and `~/.codex/sessions`, and reports wall clock, heap,
 * and bytes against the §5 baseline in
 * `docs/engineering/projects/consumption-spine.md`
 * (cold scan 19.3 s / ~617 MB heap delta / 2.66 GB read).
 *
 * The operator's real data is the test corpus and is READ-ONLY here: the
 * service holds no write path outside its state directory (unit-pinned), and
 * this eval keeps that state in a throwaway temp dir it deletes at the end —
 * nothing is copied out of the corpora.
 *
 * Run with:  pnpm eval:consumption-scan   (compiles electron main first)
 */
import { createRequire } from 'module';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'dist-electron', 'main', 'x.js'));

const servicePath = path.join(
  root,
  'dist-electron',
  'main',
  'consumption',
  'scanner-service.js'
);
if (!fs.existsSync(servicePath)) {
  console.error(
    '[consumption-scan-eval] dist-electron missing; run `pnpm electron:compile` first'
  );
  process.exit(1);
}
const { ConsumptionScannerService } = require(servicePath);

const BASELINE = { wallMs: 19_300, heapMB: 617, gigabytesRead: 2.66 };

const mb = bytes => bytes / (1024 * 1024);
const fmtMs = ms => `${(ms / 1000).toFixed(2)} s`;
const fmtMB = bytes => `${mb(bytes).toFixed(0)} MB`;

function gcNow() {
  if (globalThis.gc) globalThis.gc();
}

async function dirBytes(dir) {
  let total = 0;
  for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirBytes(full);
    else total += (await fs.promises.stat(full)).size;
  }
  return total;
}

class HeapWatch {
  constructor() {
    this.peak = 0;
    this.timer = setInterval(() => {
      this.peak = Math.max(this.peak, process.memoryUsage().heapUsed);
    }, 50);
    this.timer.unref();
  }
  stop() {
    clearInterval(this.timer);
    return this.peak;
  }
}

const failures = [];
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const stateDir = await fs.promises.mkdtemp(
  path.join(os.tmpdir(), 'exa-consumption-eval-')
);

try {
  /* ------------------------------------------------------------ cold */
  console.log('[consumption-scan-eval] COLD first scan (real corpus)');
  gcNow();
  const heapBefore = process.memoryUsage().heapUsed;
  const watch = new HeapWatch();
  const cold = new ConsumptionScannerService({
    stateDir,
    watch: false,
    initialDelayMs: 0,
  });
  const t0 = performance.now();
  await cold.snapshot(); // starts the background scan
  await cold.settle();
  const coldWallMs = performance.now() - t0;
  const tAssemble = performance.now();
  const snapshot = await cold.snapshot();
  const assembleMs = performance.now() - tAssemble;
  const heapPeak = watch.stop();
  gcNow();
  const heapAfter = process.memoryUsage().heapUsed;
  const DAY_MS = 24 * 3_600_000;
  const windowed = await cold.snapshot({ sinceMs: Date.now() - 35 * DAY_MS });
  await cold.dispose();

  const d = snapshot.diagnostics;
  const stateBytes = await dirBytes(stateDir);
  const payloadBytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
  const windowedPayloadBytes = Buffer.byteLength(
    JSON.stringify(windowed),
    'utf8'
  );

  console.log(`  wall clock        ${fmtMs(coldWallMs)}   (baseline inline scan: ${fmtMs(BASELINE.wallMs)})`);
  console.log(`  bytes read        ${(d.bytesRead / 1e9).toFixed(2)} GB (baseline ${BASELINE.gigabytesRead} GB)`);
  console.log(`  heap peak         ${fmtMB(heapPeak)}   (baseline delta ~${BASELINE.heapMB} MB)`);
  console.log(`  heap resident     ${fmtMB(Math.max(0, heapAfter - heapBefore))} after GC`);
  console.log(`  files / samples   ${d.filesSeen} files -> ${snapshot.samples.length} samples (${d.duplicatesMerged} duplicates merged)`);
  console.log(`  plan windows      ${snapshot.planWindows.length} live buckets, ${snapshot.discardedDegenerateWindows} degenerate discarded, ${snapshot.windowObservations.length} history points`);
  console.log(`  window rates      ${JSON.stringify(snapshot.windowRates)}`);
  console.log(`  snapshot payload  ${fmtMB(payloadBytes)} full corpus (assembled in ${assembleMs.toFixed(0)} ms) / ${fmtMB(windowedPayloadBytes)} for a 35-day sinceMs window (${windowed.samples.length} samples)`);
  console.log(`  state on disk     ${fmtMB(stateBytes)} in ${stateDir}`);

  check('first scan completed', snapshot.scanState.firstScanComplete === true);
  check(
    'corpus produced samples',
    snapshot.samples.length > 10_000,
    `${snapshot.samples.length}`
  );
  check(
    'both sources present',
    new Set(snapshot.samples.map(s => s.source)).size === 2
  );
  check(
    'capacity truth recovered (codex reports, claude absent)',
    snapshot.planWindows.length > 0 &&
      snapshot.planWindows.every(w => w.source === 'codex')
  );
  check(
    'no claude window fabricated',
    !snapshot.planWindows.some(w => w.source === 'claude-code')
  );
  // The §5 baseline held ~617 MB DURING an inline scan of a 2.66 GB corpus.
  // The claim here is different and stronger where it matters: the RESIDENT
  // set after the pass (what the app pays all day) is the merged sample map,
  // not the corpus text — it must not scale with corpus bytes. The transient
  // peak is GC-paced parser churn on a background task; it is reported and
  // loosely bounded so a regression to corpus-proportional buffering fails.
  check(
    'resident heap after the pass is the working set, not the corpus',
    mb(heapAfter - heapBefore) < 250,
    `${fmtMB(Math.max(0, heapAfter - heapBefore))} resident vs ${(d.bytesRead / 1e9).toFixed(2)} GB read`
  );
  check(
    'transient peak stays far below the corpus size',
    mb(heapPeak) < 1_024 && heapPeak < d.bytesRead / 4,
    `${fmtMB(heapPeak)} peak`
  );

  /* ------------------------------------------------------------ warm */
  console.log('[consumption-scan-eval] WARM relaunch (persisted watermarks)');
  const w0 = performance.now();
  const warm = new ConsumptionScannerService({
    stateDir,
    watch: false,
    initialDelayMs: 0,
  });
  const warmFirst = await warm.snapshot();
  const warmLoadMs = performance.now() - w0;
  const p0 = performance.now();
  await warm.settle();
  const warmPassMs = performance.now() - p0;
  const warmSnapshot = await warm.snapshot();
  await warm.dispose();

  const warmBytes =
    warmSnapshot.diagnostics.bytesRead - snapshot.diagnostics.bytesRead;
  console.log(`  state load        ${fmtMs(warmLoadMs)} to first served snapshot`);
  console.log(`  incremental pass  ${fmtMs(warmPassMs)}, ${warmBytes} bytes read`);

  check(
    'persisted state serves the corpus before any pass',
    warmFirst.scanState.firstScanComplete === true &&
      warmFirst.samples.length === snapshot.samples.length,
    `${warmFirst.samples.length} samples in ${fmtMs(warmLoadMs)}`
  );
  check(
    'incremental pass reads only changed tails',
    warmBytes < 50 * 1024 * 1024,
    `${warmBytes} bytes (an active harness may have appended during the eval)`
  );
  check(
    'incremental pass is cheap',
    warmPassMs < 5_000,
    fmtMs(warmPassMs)
  );

  /* ------------------------------------------------------ cancellation */
  console.log('[consumption-scan-eval] CANCELLATION (fresh state, real corpus)');
  const cancelDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'exa-consumption-eval-cancel-')
  );
  try {
    const cancellable = new ConsumptionScannerService({
      stateDir: cancelDir,
      watch: false,
      initialDelayMs: 0,
    });
    await cancellable.snapshot();
    await new Promise(resolve => setTimeout(resolve, 750));
    cancellable.cancelScan();
    const c0 = performance.now();
    await cancellable.settle();
    const cancelLatencyMs = performance.now() - c0;
    const partial = await cancellable.snapshot();
    await cancellable.dispose();
    console.log(`  cancel latency    ${cancelLatencyMs.toFixed(0)} ms to idle`);
    console.log(`  partial progress  ${partial.samples.length} samples retained`);
    check(
      'cancel lands quickly and keeps partial progress',
      partial.scanState.cancelled === true &&
        partial.scanState.phase === 'idle' &&
        cancelLatencyMs < 3_000,
      `${cancelLatencyMs.toFixed(0)} ms`
    );
  } finally {
    await fs.promises.rm(cancelDir, { recursive: true, force: true });
  }
} finally {
  await fs.promises.rm(stateDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`[consumption-scan-eval] ${failures.length} FAILURE(S): ${failures.join('; ')}`);
  process.exit(1);
}
console.log('[consumption-scan-eval] all checks passed');
