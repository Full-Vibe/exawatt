/**
 * ENG-008 E5 — the incremental scan machinery: bounded chunked reads,
 * cooperative cancellation, the streaming sink, and plan-window history.
 * Fixtures are the sanitized hand-authored set; nothing here touches a real
 * corpus.
 */
import { describe, expect, it } from 'vitest';
import {
  ClaudeConsumptionAdapter,
  CodexConsumptionAdapter,
} from '../consumption/adapters';
import type {
  ConsumptionChunk,
  ConsumptionFileRef,
  ConsumptionFileSystem,
  ConsumptionScanSink,
  ConsumptionSourceAdapter,
  ConsumptionWatermark,
} from '../consumption/ports';
import { scanConsumption } from '../consumption/scan';
import { mergeSamples, totalTokens } from '../consumption/merge';
import {
  MIN_RATE_SPAN_MS,
  WindowObservationAccumulator,
  derivePlanWindowRates,
  planWindowKey,
} from '../consumption/plan-window-history';
import type { ConsumptionSample, PlanWindow } from '../consumption/types';
import type { PlanWindowObservation } from '../consumption/live-snapshot';
import {
  CLAUDE_FIXTURE_FILES,
  CODEX_FIXTURE_FILES,
} from './consumption-fixtures';

/** In-memory filesystem that HONORS `maxBytes`, so chunking really chunks. */
class BoundedMemoryFileSystem implements ConsumptionFileSystem {
  readonly reads: Array<{ path: string; fromByte: number; maxBytes?: number }> =
    [];
  /** Optional hook fired before every read — the cancellation lever. */
  onRead: (() => void) | null = null;

  constructor(private files: Record<string, string>) {}

  setContent(path: string, content: string): void {
    this.files = { ...this.files, [path]: content };
  }

  async listFiles(root: string): Promise<ConsumptionFileRef[]> {
    return Object.entries(this.files)
      .filter(([path]) => path.startsWith(root))
      .map(([path, content], index) => ({
        path,
        size: Buffer.byteLength(content, 'utf8'),
        mtimeMs: 1_000 + index,
      }));
  }

  async readFrom(
    path: string,
    fromByte: number,
    maxBytes?: number
  ): Promise<ConsumptionChunk | null> {
    this.onRead?.();
    const content = this.files[path];
    if (content === undefined) return null;
    this.reads.push({ path, fromByte, maxBytes });
    const buffer = Buffer.from(content, 'utf8');
    const upTo =
      maxBytes !== undefined && maxBytes > 0
        ? Math.min(buffer.length, fromByte + maxBytes)
        : buffer.length;
    const slice = buffer.subarray(fromByte, upTo);
    return {
      text: slice.toString('utf8'),
      fromByte,
      toByte: fromByte + slice.length,
    };
  }
}

const ALL_FIXTURES = { ...CLAUDE_FIXTURE_FILES, ...CODEX_FIXTURE_FILES };
const adapters = () => [
  new ClaudeConsumptionAdapter('/root/claude'),
  new CodexConsumptionAdapter('/root/codex'),
];

const sortedKeys = (samples: ConsumptionSample[]) =>
  samples.map(s => s.idempotencyKey).sort();
const total = (samples: ConsumptionSample[]) =>
  samples.reduce((n, s) => n + totalTokens(s.usage), 0);

describe('chunked scanning', () => {
  it('tiny chunks produce byte-for-byte the same corpus as one big read', async () => {
    const whole = await scanConsumption(
      adapters(),
      new BoundedMemoryFileSystem(ALL_FIXTURES)
    );
    const chunked = await scanConsumption(
      adapters(),
      new BoundedMemoryFileSystem(ALL_FIXTURES),
      { maxChunkBytes: 64 }
    );
    expect(sortedKeys(chunked.samples)).toEqual(sortedKeys(whole.samples));
    expect(total(chunked.samples)).toBe(total(whole.samples));
    expect(chunked.planWindows).toEqual(whole.planWindows);
    expect(chunked.diagnostics.truncatedFinalLines).toBe(
      whole.diagnostics.truncatedFinalLines
    );
    expect(chunked.diagnostics.linesUnparsable).toBe(
      whole.diagnostics.linesUnparsable
    );
    expect(chunked.watermarks).toEqual(whole.watermarks);
  });

  it('keeps byte arithmetic exact when a chunk boundary splits a multibyte character', async () => {
    const line = JSON.stringify({
      type: 'assistant',
      sessionId: 'sess-utf8',
      cwd: '/w/café-née-utf8',
      gitBranch: 'main',
      requestId: 'req_utf8_1',
      timestamp: '2026-07-05T10:00:00.000Z',
      message: {
        model: 'claude-sonnet-5',
        usage: { input_tokens: 5, output_tokens: 7 },
      },
    });
    const content = `${line}\n${line.replace('req_utf8_1', 'req_utf8_2')}\n`;
    const files = { '/root/claude/-w-x/sess-utf8.jsonl': content };
    for (const maxChunkBytes of [3, 7, 33]) {
      const fs = new BoundedMemoryFileSystem(files);
      const scan = await scanConsumption(
        [new ClaudeConsumptionAdapter('/root/claude')],
        fs,
        { maxChunkBytes }
      );
      expect(scan.samples).toHaveLength(2);
      expect(scan.samples.map(s => s.cwd)).toEqual([
        '/w/café-née-utf8',
        '/w/café-née-utf8',
      ]);
      expect(
        scan.watermarks['/root/claude/-w-x/sess-utf8.jsonl'].consumedBytes
      ).toBe(Buffer.byteLength(content, 'utf8'));
    }
  });

  it('grows the chunk for a single line longer than the bound instead of looping forever', async () => {
    const fs = new BoundedMemoryFileSystem(ALL_FIXTURES);
    const scan = await scanConsumption(adapters(), fs, { maxChunkBytes: 8 });
    const whole = await scanConsumption(
      adapters(),
      new BoundedMemoryFileSystem(ALL_FIXTURES)
    );
    expect(sortedKeys(scan.samples)).toEqual(sortedKeys(whole.samples));
  });
});

describe('cancellation', () => {
  it('an aborted pass keeps its progress and the resumed pass reads only the remainder', async () => {
    const cold = await scanConsumption(
      adapters(),
      new BoundedMemoryFileSystem(ALL_FIXTURES)
    );

    // Abort mid-corpus: flip the signal after a handful of reads.
    const fs = new BoundedMemoryFileSystem(ALL_FIXTURES);
    const signal = { aborted: false };
    let reads = 0;
    fs.onRead = () => {
      reads += 1;
      // Deep enough into the corpus that some files completed, shallow enough
      // that others were never reached.
      if (reads >= 60) signal.aborted = true;
    };
    const first = await scanConsumption(adapters(), fs, {
      maxChunkBytes: 128,
      signal,
    });
    expect(first.aborted).toBe(true);
    expect(first.samples.length).toBeLessThan(cold.samples.length);

    // Resume with the aborted pass's watermarks and no abort.
    const resumeFs = new BoundedMemoryFileSystem(ALL_FIXTURES);
    const second = await scanConsumption(adapters(), resumeFs, {
      watermarks: first.watermarks,
      maxChunkBytes: 128,
    });
    expect(second.aborted).toBe(false);
    const combined = mergeSamples([...first.samples, ...second.samples]);
    expect(sortedKeys(combined.samples)).toEqual(sortedKeys(cold.samples));
    expect(total(combined.samples)).toBe(total(cold.samples));
    // Files the aborted pass completed are skipped outright — never re-read.
    const completed = Object.values(first.watermarks)
      .filter(
        mark =>
          mark.size ===
            Buffer.byteLength(
              ALL_FIXTURES[mark.path as keyof typeof ALL_FIXTURES] ?? '',
              'utf8'
            ) && mark.consumedBytes > 0
      )
      .map(mark => mark.path);
    expect(completed.length).toBeGreaterThan(0);
    for (const path of completed) {
      expect(resumeFs.reads.some(read => read.path === path)).toBe(false);
    }
    // Chunk boundaries re-read partial tails by design (exact byte counts
    // shift with grid alignment), so the byte claim is directional: each pass
    // read strictly less than a full chunked cold scan — the first because it
    // was cut short, the second because completed files were skipped.
    const chunkedCold = await scanConsumption(
      adapters(),
      new BoundedMemoryFileSystem(ALL_FIXTURES),
      { maxChunkBytes: 128 }
    );
    expect(first.diagnostics.bytesRead).toBeLessThan(
      chunkedCold.diagnostics.bytesRead
    );
    expect(second.diagnostics.bytesRead).toBeLessThan(
      chunkedCold.diagnostics.bytesRead
    );
  });

  it('a file aborted mid-read records only its covered extent so it can never be skipped as complete', async () => {
    const path = Object.keys(CODEX_FIXTURE_FILES)[0];
    const content =
      CODEX_FIXTURE_FILES[path as keyof typeof CODEX_FIXTURE_FILES];
    const fs = new BoundedMemoryFileSystem({ [path]: content });
    const signal = { aborted: false };
    let reads = 0;
    fs.onRead = () => {
      reads += 1;
      if (reads >= 2) signal.aborted = true;
    };
    const first = await scanConsumption(
      [new CodexConsumptionAdapter('/root/codex')],
      fs,
      { maxChunkBytes: 100, signal }
    );
    const mark = first.watermarks[path];
    const fullBytes = Buffer.byteLength(content, 'utf8');
    expect(first.aborted).toBe(true);
    expect(mark.consumedBytes).toBeLessThan(fullBytes);
    expect(mark.size).toBe(mark.consumedBytes);

    const second = await scanConsumption(
      [new CodexConsumptionAdapter('/root/codex')],
      new BoundedMemoryFileSystem({ [path]: content }),
      { watermarks: first.watermarks, maxChunkBytes: 100 }
    );
    const cold = await scanConsumption(
      [new CodexConsumptionAdapter('/root/codex')],
      new BoundedMemoryFileSystem({ [path]: content })
    );
    const combined = mergeSamples([...first.samples, ...second.samples]);
    expect(sortedKeys(combined.samples)).toEqual(sortedKeys(cold.samples));
    expect(total(combined.samples)).toBe(total(cold.samples));
  });
});

describe('streaming sink', () => {
  it('streams the same corpus it would have returned, samples always before their watermark', async () => {
    const whole = await scanConsumption(
      adapters(),
      new BoundedMemoryFileSystem(ALL_FIXTURES)
    );
    const events: Array<
      | { kind: 'samples'; path: string; samples: ConsumptionSample[] }
      | { kind: 'mark'; path: string; mark: ConsumptionWatermark }
    > = [];
    const sink: ConsumptionScanSink = {
      samples: (samples, file) =>
        events.push({ kind: 'samples', path: file.path, samples }),
      planWindows: () => {},
      fileScanned: (file, mark) =>
        events.push({ kind: 'mark', path: file.path, mark }),
    };
    const streamed = await scanConsumption(
      adapters(),
      new BoundedMemoryFileSystem(ALL_FIXTURES),
      { sink, maxChunkBytes: 256 }
    );
    // Sink mode returns nothing inline.
    expect(streamed.samples).toEqual([]);
    expect(streamed.planWindows).toEqual([]);
    // But the stream carries the identical corpus.
    const streamedSamples = mergeSamples(
      events.flatMap(e => (e.kind === 'samples' ? e.samples : []))
    );
    expect(sortedKeys(streamedSamples.samples)).toEqual(
      sortedKeys(whole.samples)
    );
    // Watermarks still return, and every file's samples precede its mark.
    expect(streamed.watermarks).toEqual(whole.watermarks);
    for (const [index, event] of events.entries()) {
      if (event.kind !== 'samples') continue;
      const markAt = events.findIndex(
        e => e.kind === 'mark' && e.path === event.path
      );
      expect(markAt).toBeGreaterThan(index);
    }
  });

  it('reports progress with monotonic bytes and a final complete count', async () => {
    const seen: Array<{
      filesSeen: number;
      filesTotal: number;
      bytesRead: number;
    }> = [];
    await scanConsumption(
      [new CodexConsumptionAdapter('/root/codex')],
      new BoundedMemoryFileSystem(CODEX_FIXTURE_FILES),
      {
        onFileScanned: progress =>
          void seen.push({
            filesSeen: progress.filesSeen,
            filesTotal: progress.filesTotal,
            bytesRead: progress.bytesRead,
          }),
      }
    );
    expect(seen.length).toBeGreaterThan(0);
    const last = seen[seen.length - 1];
    expect(last.filesSeen).toBe(last.filesTotal);
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i].bytesRead).toBeGreaterThanOrEqual(seen[i - 1].bytesRead);
      expect(seen[i].filesSeen).toBeGreaterThan(seen[i - 1].filesSeen);
    }
  });
});

/* ------------------------------------------------------------------ */
/* plan-window history                                                 */
/* ------------------------------------------------------------------ */

const obs = (
  overrides: Partial<PlanWindowObservation> = {}
): PlanWindowObservation => ({
  source: 'codex',
  limitId: 'codex',
  scope: 'primary',
  windowMinutes: 300,
  usedPercent: 10,
  observedAtMs: Date.parse('2026-07-05T12:00:00.000Z'),
  ...overrides,
});

const HOUR = 3_600_000;

describe('planWindowKey', () => {
  it('separates the two scopes one limitId carries', () => {
    const primary: PlanWindow = {
      source: 'codex',
      limitId: 'codex',
      limitName: null,
      scope: 'primary',
      usedPercent: 59,
      windowMinutes: 10_080,
      resetsAt: null,
      planType: 'pro',
      observedAt: '2026-07-05T12:00:00.000Z',
      providerSessionId: 's',
    };
    const secondary: PlanWindow = {
      ...primary,
      scope: 'secondary',
      windowMinutes: 300,
    };
    expect(planWindowKey(primary)).not.toBe(planWindowKey(secondary));
  });
});

describe('WindowObservationAccumulator', () => {
  it('keeps at most one observation per bucket per slot and reports retention', () => {
    const acc = new WindowObservationAccumulator({ slotMs: 60_000 });
    const first = obs({ observedAtMs: 0, usedPercent: 1 });
    const sameSlotLater = obs({ observedAtMs: 30_000, usedPercent: 2 });
    const nextSlot = obs({ observedAtMs: 61_000, usedPercent: 3 });
    expect(acc.addObservation(first)).not.toBeNull();
    expect(acc.addObservation(sameSlotLater)).not.toBeNull(); // replaces
    expect(acc.addObservation(nextSlot)).not.toBeNull();
    const list = acc.list();
    expect(list).toHaveLength(2);
    expect(list.map(o => o.usedPercent)).toEqual([2, 3]);
  });

  it('prunes beyond the horizon, anchored at the newest observation — not a clock', () => {
    const acc = new WindowObservationAccumulator({
      slotMs: 60_000,
      horizonMs: 10 * 60_000,
    });
    acc.addObservation(obs({ observedAtMs: 0, usedPercent: 1 }));
    acc.addObservation(obs({ observedAtMs: 20 * 60_000, usedPercent: 5 }));
    expect(acc.list().map(o => o.usedPercent)).toEqual([5]);
    // Too-old arrivals are rejected outright.
    expect(
      acc.addObservation(obs({ observedAtMs: 60_000, usedPercent: 2 }))
    ).toBeNull();
  });

  it('rejects degenerate windows', () => {
    const acc = new WindowObservationAccumulator();
    expect(acc.addObservation(obs({ windowMinutes: 0 }))).toBeNull();
    expect(acc.list()).toEqual([]);
  });
});

describe('derivePlanWindowRates', () => {
  it('derives percent per hour over the observed span', () => {
    const at = Date.parse('2026-07-05T12:00:00.000Z');
    const rates = derivePlanWindowRates([
      obs({ observedAtMs: at, usedPercent: 40 }),
      obs({ observedAtMs: at + 2 * HOUR, usedPercent: 58.8 }),
    ]);
    expect(rates[planWindowKey(obs())]).toBeCloseTo(9.4, 5);
  });

  it('never computes a pace across a reset', () => {
    const at = Date.parse('2026-07-05T12:00:00.000Z');
    const rates = derivePlanWindowRates([
      obs({ observedAtMs: at, usedPercent: 90 }),
      // reset: percent drops
      obs({ observedAtMs: at + HOUR, usedPercent: 2 }),
      obs({ observedAtMs: at + 2 * HOUR, usedPercent: 7 }),
    ]);
    expect(rates[planWindowKey(obs())]).toBeCloseTo(5, 5);
  });

  it('is absent — never zero — when a pace cannot be observed', () => {
    const at = Date.parse('2026-07-05T12:00:00.000Z');
    // Single observation.
    expect(derivePlanWindowRates([obs({ observedAtMs: at })])).toEqual({});
    // Two observations closer than the minimum span.
    expect(
      derivePlanWindowRates([
        obs({ observedAtMs: at, usedPercent: 1 }),
        obs({ observedAtMs: at + MIN_RATE_SPAN_MS - 1, usedPercent: 2 }),
      ])
    ).toEqual({});
  });

  it('reports a genuinely flat window as the real pace 0', () => {
    const at = Date.parse('2026-07-05T12:00:00.000Z');
    const rates = derivePlanWindowRates([
      obs({ observedAtMs: at, usedPercent: 33 }),
      obs({ observedAtMs: at + HOUR, usedPercent: 33 }),
    ]);
    expect(rates[planWindowKey(obs())]).toBe(0);
  });

  it('ignores observations older than one window length behind the newest', () => {
    const at = Date.parse('2026-07-05T12:00:00.000Z');
    const windowMs = 300 * 60_000; // 5h
    const rates = derivePlanWindowRates([
      obs({ observedAtMs: at - windowMs - HOUR, usedPercent: 0 }),
      obs({ observedAtMs: at, usedPercent: 50 }),
      obs({ observedAtMs: at + HOUR, usedPercent: 60 }),
    ]);
    expect(rates[planWindowKey(obs())]).toBeCloseTo(10, 5);
  });
});

describe('scanConsumption window observations', () => {
  it('returns raw history alongside the collapsed capacity truth', async () => {
    const scan = await scanConsumption(
      [new CodexConsumptionAdapter('/root/codex')],
      new BoundedMemoryFileSystem(CODEX_FIXTURE_FILES)
    );
    expect(scan.planWindows.length).toBeGreaterThan(0);
    expect(scan.windowObservations.length).toBeGreaterThan(
      scan.planWindows.length
    );
  });

  it("combines histories beyond V8's argument ceiling without spreading them", async () => {
    const window: PlanWindow = {
      source: 'codex',
      limitId: 'codex',
      limitName: null,
      scope: 'primary',
      usedPercent: 50,
      windowMinutes: 300,
      resetsAt: null,
      planType: 'pro',
      observedAt: '2026-08-10T09:10:00.000Z',
      providerSessionId: 'stress-session',
    };
    const observations = Array<PlanWindow>(130_000).fill(window);
    const adapter: ConsumptionSourceAdapter = {
      source: 'codex',
      root: '/unused',
      scan: async () => ({
        samples: [],
        planWindows: [window],
        windowObservations: observations,
        diagnostics: {
          filesSeen: 1,
          filesUnreadable: 0,
          bytesRead: 1,
          linesRead: observations.length,
          linesUnparsable: 0,
          truncatedFinalLines: 0,
          linesWithoutUsage: 0,
          recordsWithoutSessionId: 0,
          recordsWithoutCwd: 0,
          recordsWithoutModel: 0,
          duplicatesMerged: 0,
          samplesEmitted: 0,
          planWindowsEmitted: observations.length,
          delegatedRecords: 0,
          delegationMetaMissing: 0,
        },
        watermarks: {},
        aborted: false,
      }),
    };

    const scan = await scanConsumption(
      [adapter],
      new BoundedMemoryFileSystem({})
    );

    expect(scan.windowObservations).toHaveLength(observations.length);
  });
});
