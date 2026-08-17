/**
 * ENG-008 E5 — persisted scan-state store: append/reload round-trips,
 * idempotent duplicate collapse, corruption tolerance, compaction, and the
 * write-containment half of the privacy invariant.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONSUMPTION_SAMPLE_HORIZON_MS,
  localLogAssurance,
  type ConsumptionSample,
  type ConsumptionWatermark,
  type PlanWindowObservation,
} from '@exawatt/core';
import { ConsumptionStateStore, emptyConsumptionMeta } from './state-store';

let dir: string;

beforeEach(async () => {
  dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'exa-consumption-store-')
  );
});

afterEach(async () => {
  await fs.promises.rm(dir, { recursive: true, force: true });
});

const sample = (
  key: string,
  overrides: Partial<ConsumptionSample> = {}
): ConsumptionSample => ({
  at: '2026-07-01T00:00:00.000Z',
  source: 'claude-code',
  model: 'claude-sonnet-5',
  effort: null,
  providerSessionId: 'sess-1',
  cwd: '/w/acme',
  gitBranch: 'main',
  usage: {
    inputTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 5,
    reasoningTokens: 0,
    webSearches: 0,
    webFetches: 0,
  },
  assurance: localLogAssurance('claude-code'),
  idempotencyKey: key,
  contextWindow: null,
  sourceFile: '/root/claude/x.jsonl',
  delegation: null,
  entrypoint: 'cli',
  ...overrides,
});

const mark = (
  filePath: string,
  overrides: Partial<ConsumptionWatermark> = {}
): ConsumptionWatermark => ({
  path: filePath,
  size: 100,
  mtimeMs: 1_000,
  consumedBytes: 100,
  ...overrides,
});

const observation = (
  overrides: Partial<PlanWindowObservation> = {}
): PlanWindowObservation => ({
  source: 'codex',
  limitId: 'codex',
  scope: 'primary',
  windowMinutes: 300,
  usedPercent: 50,
  observedAtMs: Date.parse('2026-07-05T12:00:00.000Z'),
  ...overrides,
});

describe('ConsumptionStateStore', () => {
  it('loads empty state from nothing without inventing history', async () => {
    const store = new ConsumptionStateStore(dir);
    const loaded = await store.load();
    expect(loaded.samples.size).toBe(0);
    expect(loaded.watermarks).toEqual({});
    expect(loaded.meta.firstScanComplete).toBe(false);
    expect(loaded.meta.lastScanAt).toBeNull();
  });

  it('round-trips samples, watermarks, observations, and meta', async () => {
    const store = new ConsumptionStateStore(dir);
    await store.append({
      samples: [sample('k1'), sample('k2')],
      observations: [observation()],
      marks: [mark('/root/claude/x.jsonl')],
    });
    const meta = {
      ...emptyConsumptionMeta(),
      lastScanAt: '2026-08-10T00:00:00.000Z',
      firstScanComplete: true,
      corpusBytes: 12_345,
      emptySources: ['codex' as const],
    };
    await store.writeMeta(meta);
    await store.flush();

    const reloaded = await new ConsumptionStateStore(dir).load();
    expect([...reloaded.samples.keys()].sort()).toEqual(['k1', 'k2']);
    // Assurance is stripped on disk (constant per source) and re-attached as
    // one shared derived instance on load.
    expect(reloaded.samples.get('k1')!.assurance).toEqual(
      localLogAssurance('claude-code')
    );
    expect(reloaded.samples.get('k1')!.assurance).toBe(
      reloaded.samples.get('k2')!.assurance
    );
    expect(reloaded.watermarks['/root/claude/x.jsonl']).toEqual(
      mark('/root/claude/x.jsonl')
    );
    expect(reloaded.observations).toEqual([observation()]);
    expect(reloaded.meta.lastScanAt).toBe('2026-08-10T00:00:00.000Z');
    expect(reloaded.meta.firstScanComplete).toBe(true);
    expect(reloaded.meta.corpusBytes).toBe(12_345);
    expect(reloaded.meta.emptySources).toEqual(['codex']);
    expect(reloaded.corruptLines).toBe(0);
  });

  it('collapses duplicate keys on load with the componentwise-max merge', async () => {
    const store = new ConsumptionStateStore(dir);
    await store.append({
      samples: [sample('k1')],
      observations: [],
      marks: [],
    });
    // A later pass re-observed the same unit of work with grown usage.
    await store.append({
      samples: [
        sample('k1', {
          usage: {
            inputTokens: 10,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 90,
            reasoningTokens: 0,
            webSearches: 0,
            webFetches: 0,
          },
        }),
      ],
      observations: [],
      marks: [],
    });
    await store.writeMeta(emptyConsumptionMeta());
    await store.flush();
    const reloaded = await new ConsumptionStateStore(dir).load();
    expect(reloaded.samples.size).toBe(1);
    expect(reloaded.samples.get('k1')!.usage.outputTokens).toBe(90);
  });

  it('last watermark per path wins across appends', async () => {
    const store = new ConsumptionStateStore(dir);
    await store.append({
      samples: [],
      observations: [],
      marks: [mark('/f', { consumedBytes: 50, size: 50 })],
    });
    await store.append({
      samples: [],
      observations: [],
      marks: [mark('/f', { consumedBytes: 120, size: 120 })],
    });
    await store.writeMeta(emptyConsumptionMeta());
    await store.flush();
    const reloaded = await new ConsumptionStateStore(dir).load();
    expect(reloaded.watermarks['/f'].consumedBytes).toBe(120);
  });

  it('skips a torn tail and other corrupt lines instead of failing the load', async () => {
    const store = new ConsumptionStateStore(dir);
    await store.append({
      samples: [sample('k1')],
      observations: [],
      marks: [mark('/f')],
    });
    await store.writeMeta(emptyConsumptionMeta());
    await store.flush();
    // Simulate a crash mid-append: a torn trailing line plus junk.
    await fs.promises.appendFile(
      path.join(dir, 'log-v1.jsonl'),
      'not json at all\n{"k":"sample","v":{"broken":true}}\n{"k":"sa'
    );
    const reloaded = await new ConsumptionStateStore(dir).load();
    expect(reloaded.samples.size).toBe(1);
    expect(reloaded.watermarks['/f']).toBeDefined();
    expect(reloaded.corruptLines).toBe(3);
  });

  it('ignores an unknown meta version outright', async () => {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      path.join(dir, 'meta-v1.json'),
      JSON.stringify({ v: 99, firstScanComplete: true })
    );
    const loaded = await new ConsumptionStateStore(dir).load();
    expect(loaded.meta.firstScanComplete).toBe(false);
  });

  it('compaction rewrites the log to live state and reload agrees', async () => {
    const store = new ConsumptionStateStore(dir);
    // Bloat: the same key appended many times.
    for (let i = 0; i < 10; i += 1) {
      await store.append({
        samples: [sample('k1'), sample(`k-${i}`)],
        observations: [observation({ observedAtMs: 1_000 + i * 900_000 })],
        marks: [mark('/f', { consumedBytes: i })],
      });
    }
    // The log is only trusted under a meta (firstScanComplete would otherwise
    // be unknown), so a load without one must come back empty.
    await store.flush();
    expect((await new ConsumptionStateStore(dir).load()).samples.size).toBe(0);
    await store.writeMeta(emptyConsumptionMeta());
    await store.flush();
    const before = await new ConsumptionStateStore(dir).load();
    const live = new Map(before.samples);
    const meta = { ...emptyConsumptionMeta(), firstScanComplete: true };
    await store.compact(
      live.values(),
      before.watermarks,
      before.observations,
      meta
    );
    await store.flush();
    const after = await new ConsumptionStateStore(dir).load();
    expect([...after.samples.keys()].sort()).toEqual([...live.keys()].sort());
    expect(after.watermarks['/f'].consumedBytes).toBe(9);
    expect(after.meta.firstScanComplete).toBe(true);
    expect(after.logBytes).toBeLessThan(before.logBytes);
  });

  it('writes only inside its own directory', async () => {
    const written = new Set<string>();
    const record = (p: unknown) => {
      if (typeof p === 'string') written.add(p);
    };
    // Spy by wrapping, so the real writes still happen.
    const realAppend = fs.promises.appendFile.bind(fs.promises);
    const realWrite = fs.promises.writeFile.bind(fs.promises);
    const realMkdir = fs.promises.mkdir.bind(fs.promises);
    const realRename = fs.promises.rename.bind(fs.promises);
    const appendSpy = vi
      .spyOn(fs.promises, 'appendFile')
      .mockImplementation(async (p, ...rest) => {
        record(p);
        return realAppend(p as never, ...(rest as [never]));
      });
    const writeSpy = vi
      .spyOn(fs.promises, 'writeFile')
      .mockImplementation(async (p, ...rest) => {
        record(p);
        return realWrite(p as never, ...(rest as [never]));
      });
    const mkdirSpy = vi
      .spyOn(fs.promises, 'mkdir')
      .mockImplementation(async (p, ...rest) => {
        record(p);
        return realMkdir(p as never, ...(rest as [never]));
      });
    const renameSpy = vi
      .spyOn(fs.promises, 'rename')
      .mockImplementation(async (from, to) => {
        record(from);
        record(to);
        return realRename(from as never, to as never);
      });
    try {
      const store = new ConsumptionStateStore(dir);
      await store.append({
        samples: [sample('k1')],
        observations: [observation()],
        marks: [mark('/f')],
      });
      await store.writeMeta(emptyConsumptionMeta());
      await store.flush();
      expect(written.size).toBeGreaterThan(0);
      for (const p of written) {
        // `mkdir` targets the directory itself; every file write is inside it.
        expect(p === dir || p.startsWith(dir + path.sep)).toBe(true);
      }
    } finally {
      appendSpy.mockRestore();
      writeSpy.mockRestore();
      mkdirSpy.mockRestore();
      renameSpy.mockRestore();
    }
  });
});

/**
 * BUG-032 — the state bound compaction always assumed it had.
 *
 * `compact()` rewrites the log FROM LIVE STATE, so a log bound is only a bound
 * while the state is bounded. It never was: on the operator's machine the file
 * reached 139.5 MB / 173,571 lines, every one of them parsed before `ready`
 * resolved at launch.
 */
describe('sample retention', () => {
  const DAY = 24 * 3_600_000;
  const newest = Date.parse('2026-08-16T00:00:00.000Z');
  const dated = (key: string, daysBack: number) =>
    sample(key, { at: new Date(newest - daysBack * DAY).toISOString() });

  it('drops samples older than the horizon while hydrating, and says so', async () => {
    const store = new ConsumptionStateStore(dir);
    await store.append({
      samples: [
        dated('recent-0', 0),
        dated('recent-1', 3),
        dated('edge', 13),
        dated('old-30', 30),
        dated('old-200', 200),
      ],
      observations: [],
      marks: [],
    });
    await store.writeMeta(emptyConsumptionMeta());
    await store.flush();

    const reloaded = await new ConsumptionStateStore(dir).load();
    expect([...reloaded.samples.keys()].sort()).toEqual([
      'edge',
      'recent-0',
      'recent-1',
    ]);
    expect(reloaded.expiredSamples).toBe(2);
  });

  it('a wider horizon keeps what the default drops — the bound is policy, not a constant', async () => {
    const store = new ConsumptionStateStore(dir);
    await store.append({
      samples: [dated('recent', 0), dated('old', 200)],
      observations: [],
      marks: [],
    });
    await store.writeMeta(emptyConsumptionMeta());
    await store.flush();

    const wide = await new ConsumptionStateStore(dir, {
      sampleHorizonMs: 365 * DAY,
    }).load();
    expect(wide.samples.size).toBe(2);
    expect(wide.expiredSamples).toBe(0);
  });

  it('compaction reclaims a log whose state shrank, not just one that grew', async () => {
    const store = new ConsumptionStateStore(dir);
    // Past the compaction slack, so the ratio rule is what decides. Each line
    // is padded to ~40 KB to reach that scale without writing 20k rows.
    const padding = 'p'.repeat(40_000);
    await store.append({
      samples: Array.from({ length: 250 }, (_unused, index) => ({
        ...dated(`old-${index}`, 90),
        cwd: padding,
      })),
      observations: [],
      marks: [],
    });
    await store.append({
      samples: [{ ...dated('recent', 0), cwd: padding }],
      observations: [],
      marks: [],
    });
    // Meta claims a huge historical compaction floor, which is exactly the
    // state that used to make `shouldCompact` answer false forever.
    await store.writeMeta({
      ...emptyConsumptionMeta(),
      compactedBytes: 500_000_000,
    });
    await store.flush();

    const reloaded = new ConsumptionStateStore(dir);
    const loaded = await reloaded.load();
    expect(loaded.samples.size).toBe(1);
    expect(loaded.retainedBytes).toBeLessThan(loaded.logBytes / 10);
    expect(reloaded.shouldCompact).toBe(true);

    await reloaded.compact(
      loaded.samples.values(),
      loaded.watermarks,
      loaded.observations,
      loaded.meta
    );
    await reloaded.flush();

    const after = await new ConsumptionStateStore(dir).load();
    expect(after.logBytes).toBeLessThan(loaded.logBytes / 10);
    expect([...after.samples.keys()]).toEqual(['recent']);
  });

  it('the log stops growing: repeated passes over old history add nothing', async () => {
    const store = new ConsumptionStateStore(dir);
    await store.append({
      samples: [dated('anchor', 0)],
      observations: [],
      marks: [],
    });
    await store.writeMeta(emptyConsumptionMeta());
    await store.flush();
    const baseline = (await new ConsumptionStateStore(dir).load()).logBytes;

    // A state store hydrated under the bound holds the anchor only, so a
    // caller replaying ancient samples through it retains nothing new.
    const reloaded = new ConsumptionStateStore(dir);
    const loaded = await reloaded.load();
    for (let index = 0; index < 200; index += 1) {
      expect(loaded.samples.add(dated(`ancient-${index}`, 120))).toBeNull();
    }
    expect(loaded.samples.size).toBe(1);
    expect(baseline).toBeGreaterThan(0);
  });

  it('states its horizon rather than inheriting wall time', () => {
    expect(CONSUMPTION_SAMPLE_HORIZON_MS).toBe(14 * DAY);
  });
});
