/**
 * Measurement probe for BUG-023 / BUG-024 (ENG-016, incident 0008) — a
 * diagnostic, NOT a gate. Sibling of `scripts/terminal-cost-probe.mjs`, which
 * measured the two RENDERER theories and falsified both. This one measures the
 * remaining path: what the Electron MAIN process does when a paused Agent is
 * resumed.
 *
 * Resume calls `PtySessionManager.create` → `SessionHistoryStore.load`, which
 * replays the append journal. The question the probe answers is whether replay
 * costs O(journal bytes) or O(records x retained window).
 *
 * The fixture matches the operator's real disk. His largest journals hold ten
 * to sixteen THOUSAND records, and every one of them carries
 * `retainedLength: 4_000_000` — the scrollback cap — so a per-record rebuild of
 * the retained window is ~8 MB of copying each time.
 *
 *   node scripts/transcript-replay-probe.mjs                # synthetic fixture
 *   node scripts/transcript-replay-probe.mjs --journal <path-to-*.journal>
 *
 * `--journal` reads a real journal (copied to a temp dir; the original is never
 * touched). Requires `pnpm electron:compile` first: the probe drives the
 * COMPILED store so the numbers describe shipped code, not a re-implementation.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PerformanceObserver } from 'node:perf_hooks';
import { GCProfiler } from 'node:v8';

const root = fileURLToPath(new URL('..', import.meta.url));
const compiled = path.join(
  root,
  'dist-electron/main/pty/session-history-store.js'
);
if (!fs.existsSync(compiled)) {
  console.error(`Missing ${compiled}. Run: pnpm electron:compile`);
  process.exit(1);
}
const { SessionHistoryStore } = await import(compiled);

const args = process.argv.slice(2);
const journalArgument = args.includes('--journal')
  ? args[args.indexOf('--journal') + 1]
  : null;
const RETAINED = 4_000_000;
const FLEET = Number(
  args.includes('--fleet') ? args[args.indexOf('--fleet') + 1] : 3
);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-replay-probe-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

/**
 * A journal shaped like the operator's: a saturated retained window and many
 * small deltas. 10,018 records / 476-char average delta are his real numbers
 * for `session-6162af6e`.
 */
function synthesize(id, records = 10_018, delta = 476) {
  const snapshot = path.join(dir, `${id}.json`);
  const journal = path.join(dir, `${id}.journal`);
  const seed = 'exawatt transcript line, redrawn by a harness spinner\n'.repeat(
    Math.ceil(RETAINED / 54)
  );
  let text = seed.slice(0, RETAINED);
  let cursor = RETAINED;
  fs.writeFileSync(
    snapshot,
    JSON.stringify({ v: 1, text, cursor, updatedAt: 1 })
  );
  const lines = [];
  for (let index = 0; index < records; index += 1) {
    const chunk = `\r\x1b[K working ${index} `.padEnd(delta, '.');
    const from = cursor;
    cursor += chunk.length;
    text = (text + chunk).slice(-RETAINED);
    lines.push(
      `${JSON.stringify({
        v: 1,
        fromCursor: from,
        cursor,
        retainedLength: text.length,
        text: chunk,
        updatedAt: index + 2,
      })}\n`
    );
  }
  fs.writeFileSync(journal, lines.join(''));
  return { id, records, journalBytes: fs.statSync(journal).size };
}

function adopt(id, source) {
  const snapshot = source.replace(/\.journal$/, '.json');
  fs.copyFileSync(source, path.join(dir, `${id}.journal`));
  if (fs.existsSync(snapshot)) {
    fs.copyFileSync(snapshot, path.join(dir, `${id}.json`));
  }
  const contents = fs.readFileSync(source, 'utf8');
  return {
    id,
    records: contents.split('\n').filter(Boolean).length,
    journalBytes: Buffer.byteLength(contents),
  };
}

async function measure(label, ids) {
  let pause = 0;
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) pause += entry.duration;
  });
  observer.observe({ entryTypes: ['gc'] });
  const profiler = new GCProfiler();
  profiler.start();
  const before = process.memoryUsage();
  const started = performance.now();
  const store = new SessionHistoryStore(dir, 1);
  let retained = 0;
  // Serial, exactly as `createUnlocked` resumes Agents one after another.
  for (const id of ids) retained += (await store.load(id)).text.length;
  const elapsed = performance.now() - started;
  const after = process.memoryUsage();
  const events = profiler.stop().statistics ?? [];
  observer.disconnect();
  // Bytes the collector had to reclaim ~= transient allocation volume: every
  // rebuilt window becomes garbage the moment the next record rebuilds it.
  const reclaimed = events.reduce(
    (total, event) =>
      total +
      Math.max(
        0,
        (event.beforeGC?.heapStatistics?.usedHeapSize ?? 0) -
          (event.afterGC?.heapStatistics?.usedHeapSize ?? 0)
      ),
    0
  );
  return {
    label,
    sessions: ids.length,
    retainedChars: retained,
    elapsedMs: Math.round(elapsed),
    gcEvents: events.length,
    gcPauseMs: Math.round(pause),
    gcReclaimedMB: Math.round(reclaimed / 1e6),
    peakRssMB: Math.round(after.rss / 1e6),
    rssDeltaMB: Math.round((after.rss - before.rss) / 1e6),
  };
}

const fixtures = [];
for (let index = 0; index < FLEET; index += 1) {
  const id = `probe-${index}`;
  fixtures.push(journalArgument ? adopt(id, journalArgument) : synthesize(id));
}

const single = await measure('one paused Agent resumed', [fixtures[0].id]);
const fleet = await measure(
  `${FLEET} paused Agents resumed from Team`,
  fixtures.map(fixture => fixture.id)
);

console.log(
  JSON.stringify(
    {
      fixture: {
        source: journalArgument ?? 'synthetic (operator-shaped)',
        recordsPerSession: fixtures[0].records,
        journalBytesPerSession: fixtures[0].journalBytes,
        retainedWindowChars: RETAINED,
      },
      results: [single, fleet],
    },
    null,
    2
  )
);
