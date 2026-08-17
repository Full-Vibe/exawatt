/**
 * ENG-008 E5 — the incremental scanner service, end to end over a real
 * temp-dir corpus (hand-authored fixture content; never operator data):
 * first scan, persisted watermark resume, incremental tail reads,
 * parent+subagent idempotency, capacity-truth rules, cancellation, identity
 * links, and the never-writes-outside-userData privacy invariant.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeConsumptionFileSystem } from '@exawatt/core/server';
import type {
  ConsumptionChunk,
  ConsumptionFileSystem,
  ConsumptionFileRef,
  ConsumptionUpdatedEvent,
} from '@exawatt/core';
import {
  CONSUMPTION_SAMPLE_HORIZON_MS,
  CONSUMPTION_SAMPLE_MAX_HORIZON_MS,
  planWindowKey,
  totalTokens,
} from '@exawatt/core';
import {
  CLAUDE_DELEGATED_JSONL,
  CLAUDE_DELEGATED_META_JSON,
  CLAUDE_ORDINARY_JSONL,
} from '../../../packages/core/src/__tests__/consumption-fixtures';
import { ConsumptionScannerService } from './scanner-service';

/* ------------------------------------------------------------------ */
/* fixture corpus on disk                                              */
/* ------------------------------------------------------------------ */

const codexLine = (record: unknown) => JSON.stringify(record);

const codexMeta = (sessionId: string, cwd: string, at: string) =>
  codexLine({
    timestamp: at,
    type: 'session_meta',
    payload: { session_id: sessionId, cwd, originator: 'codex-tui' },
  });

const codexTurn = (at: string) =>
  codexLine({
    timestamp: at,
    type: 'turn_context',
    payload: {
      model: 'gpt-5.6-sol',
      cwd: '/w/acme',
      collaboration_mode: { settings: { reasoning_effort: 'high' } },
    },
  });

const usageBlock = ([
  input,
  cached,
  cacheWrite,
  output,
  reasoning,
  total,
]: number[]) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  cache_write_input_tokens: cacheWrite,
  output_tokens: output,
  reasoning_output_tokens: reasoning,
  total_tokens: total,
});

interface RateLimitsSpec {
  usedPercent: number;
  observedResets?: number;
  secondaryWindowMinutes?: number;
}

const rateLimits = (spec: RateLimitsSpec) => ({
  limit_id: 'codex',
  limit_name: null,
  primary: {
    used_percent: spec.usedPercent,
    window_minutes: 10_080,
    resets_at: spec.observedResets ?? 1_785_262_479,
  },
  secondary: {
    used_percent: 12.5,
    window_minutes: spec.secondaryWindowMinutes ?? 300,
    resets_at: 1_784_950_000,
  },
  plan_type: 'pro',
});

const codexTokenCount = (
  at: string,
  cumulative: number[],
  delta: number[],
  limits?: ReturnType<typeof rateLimits>
) =>
  codexLine({
    timestamp: at,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: usageBlock(cumulative),
        last_token_usage: usageBlock(delta),
        model_context_window: 272_000,
      },
      ...(limits ? { rate_limits: limits } : {}),
    },
  });

const CODEX_BASE =
  [
    codexMeta('codex-sess-live', '/w/acme', '2026-08-10T08:00:00.000Z'),
    codexTurn('2026-08-10T08:00:01.000Z'),
    codexTokenCount(
      '2026-08-10T08:10:00.000Z',
      [1_000, 600, 0, 50, 10, 1_050],
      [1_000, 600, 0, 50, 10, 1_050],
      rateLimits({ usedPercent: 40 })
    ),
    codexTokenCount(
      '2026-08-10T09:10:00.000Z',
      [3_000, 1_800, 0, 150, 30, 3_150],
      [2_000, 1_200, 0, 100, 20, 2_100],
      rateLimits({ usedPercent: 49.4 })
    ),
  ].join('\n') + '\n';

const CODEX_APPENDED =
  codexTokenCount(
    '2026-08-10T10:10:00.000Z',
    [6_000, 3_600, 0, 300, 60, 6_300],
    [3_000, 1_800, 0, 150, 30, 3_150],
    rateLimits({ usedPercent: 58.8 })
  ) + '\n';

/** A degenerate window that must be discarded, not divided by. */
const CODEX_DEGENERATE =
  [
    codexMeta('codex-sess-degen', '/w/beta', '2026-08-09T08:00:00.000Z'),
    codexTurn('2026-08-09T08:00:01.000Z'),
    codexLine({
      timestamp: '2026-08-09T08:10:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: usageBlock([500, 0, 0, 20, 0, 520]),
          last_token_usage: usageBlock([500, 0, 0, 20, 0, 520]),
          model_context_window: 272_000,
        },
        // Only a degenerate window: window_minutes 0 must be discarded and
        // counted, and must not create a window bucket.
        rate_limits: {
          limit_id: 'codex',
          limit_name: null,
          secondary: {
            used_percent: 5,
            window_minutes: 0,
            resets_at: 1_784_950_000,
          },
          plan_type: 'pro',
        },
      },
    }),
  ].join('\n') + '\n';

let root: string;
let stateDir: string;
let claudeRoot: string;
let codexRoot: string;
let services: ConsumptionScannerService[];

async function writeCorpus(): Promise<void> {
  claudeRoot = path.join(root, 'claude-projects');
  codexRoot = path.join(root, 'codex-sessions');
  const claudeSession = path.join(claudeRoot, '-w-acme');
  const subagents = path.join(claudeSession, 'sess-claude-1', 'subagents');
  await fs.promises.mkdir(subagents, { recursive: true });
  await fs.promises.mkdir(path.join(codexRoot, '2026/08/10'), {
    recursive: true,
  });
  await fs.promises.writeFile(
    path.join(claudeSession, 'sess-claude-1.jsonl'),
    CLAUDE_ORDINARY_JSONL
  );
  await fs.promises.writeFile(
    path.join(subagents, 'agent-fixture-1.jsonl'),
    CLAUDE_DELEGATED_JSONL
  );
  await fs.promises.writeFile(
    path.join(subagents, 'agent-fixture-1.meta.json'),
    CLAUDE_DELEGATED_META_JSON
  );
  await fs.promises.writeFile(
    path.join(
      codexRoot,
      '2026/08/10',
      'rollout-2026-08-10T08-00-00-codex-sess-live.jsonl'
    ),
    CODEX_BASE
  );
  await fs.promises.writeFile(
    path.join(
      codexRoot,
      '2026/08/10',
      'rollout-2026-08-09T08-00-00-codex-sess-degen.jsonl'
    ),
    CODEX_DEGENERATE
  );
}

function makeService(
  overrides: Partial<
    ConstructorParameters<typeof ConsumptionScannerService>[0]
  > = {}
): ConsumptionScannerService {
  const service = new ConsumptionScannerService({
    stateDir,
    claudeRoot,
    codexRoot,
    watch: false,
    initialDelayMs: 0,
    debounceMs: 5,
    minPassIntervalMs: 0,
    staleAfterMs: Number.POSITIVE_INFINITY,
    // The corpus fixture deliberately spans 2026-07-01 to 2026-08-10 so the
    // idempotency and capacity rules are exercised across sources. That is
    // wider than the default sample retention (BUG-032), so these tests widen
    // it explicitly; retention itself is asserted in its own test below.
    sampleHorizonMs: CONSUMPTION_SAMPLE_MAX_HORIZON_MS,
    ...overrides,
  });
  services.push(service);
  return service;
}

beforeEach(async () => {
  services = [];
  root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'exa-consumption-scan-')
  );
  stateDir = path.join(root, 'state');
  await writeCorpus();
});

afterEach(async () => {
  for (const service of services) await service.dispose();
  await fs.promises.rm(root, { recursive: true, force: true });
});

describe('first scan', () => {
  it('scans in the background, completes, and serves the merged corpus', async () => {
    const service = makeService();
    const events: ConsumptionUpdatedEvent[] = [];
    service.onUpdated(event => events.push(event));

    const initial = await service.snapshot();
    // snapshot() never blocks on scanning.
    expect(initial.scanState.firstScanComplete).toBe(false);

    await service.settle();
    const done = await service.snapshot();
    expect(done.scanState.phase).toBe('idle');
    expect(done.scanState.firstScanComplete).toBe(true);
    expect(done.scanState.lastScanAt).not.toBeNull();
    expect(done.scanState.corpusBytes).toBeGreaterThan(0);
    expect(done.scanState.cancelled).toBe(false);
    expect(events.some(e => e.scanState.phase === 'first-scan')).toBe(true);

    // Corpus-global idempotency: the parent turn and the fork run share
    // req_fixture_a and must appear once each (delegation is in the key).
    const shared = done.samples.filter(s =>
      s.idempotencyKey.includes('req_fixture_a')
    );
    expect(shared).toHaveLength(2);
    expect(shared.filter(s => s.delegation !== null)).toHaveLength(1);

    // Both sources arrived.
    expect(new Set(done.samples.map(s => s.source))).toEqual(
      new Set(['claude-code', 'codex'])
    );
  });

  it('enforces the capacity-truth rules at the snapshot boundary', async () => {
    const service = makeService();
    await service.snapshot();
    await service.settle();
    const snapshot = await service.snapshot();

    // Latest per bucket, keyed by limitId+scope+window — never by source.
    const primaries = snapshot.planWindows.filter(w => w.scope === 'primary');
    expect(primaries).toHaveLength(1);
    expect(primaries[0].usedPercent).toBe(49.4); // the latest observation
    expect(primaries[0].observedAt).toBe('2026-08-10T09:10:00.000Z');

    // Degenerate windows are discarded AND counted.
    expect(snapshot.planWindows.some(w => w.windowMinutes <= 0)).toBe(false);
    expect(snapshot.discardedDegenerateWindows).toBeGreaterThan(0);

    // Claude Code has no window record at all — absent, never zero.
    expect(snapshot.planWindows.some(w => w.source === 'claude-code')).toBe(
      false
    );

    // Pace is observable from the corpus's own history: 9.4%/h.
    const key = planWindowKey(primaries[0]);
    expect(snapshot.windowRates[key]).toBeCloseTo(9.4, 3);
    expect(snapshot.windowObservations.length).toBeGreaterThan(1);
  });

  it('bounds the sample payload when asked for a window', async () => {
    const service = makeService();
    await service.snapshot();
    await service.settle();
    const all = await service.snapshot();
    const bounded = await service.snapshot({
      sinceMs: Date.parse('2026-08-10T00:00:00.000Z'),
    });
    expect(bounded.samples.length).toBeGreaterThan(0);
    expect(bounded.samples.length).toBeLessThan(all.samples.length);
    expect(
      bounded.samples.every(
        s => Date.parse(s.at) >= Date.parse('2026-08-10T00:00:00.000Z')
      )
    ).toBe(true);
  });

  it('serves a settled samples-only projection without assembling window history', async () => {
    const service = makeService();
    const all = await service.settledSamplesSince(0);
    const recent = await service.settledSamplesSince(
      Date.parse('2026-08-10T08:30:00.000Z')
    );

    expect(all.length).toBeGreaterThan(recent.length);
    expect(recent.length).toBeGreaterThan(0);
    expect(
      recent.every(
        sample =>
          Date.parse(sample.at) >= Date.parse('2026-08-10T08:30:00.000Z')
      )
    ).toBe(true);
  });

  it('exposes the main-owned identity index, mapped to consumption sources', async () => {
    const service = makeService({
      identities: () => [
        {
          durableSessionId: 'exa-1',
          harness: 'claude',
          harnessSessionId: 'sess-claude-1',
          cwd: '/w/acme',
        },
        {
          durableSessionId: 'exa-2',
          harness: 'codex',
          harnessSessionId: 'codex-sess-live',
          cwd: '/w/acme',
        },
        {
          durableSessionId: 'exa-3',
          harness: 'opencode',
          harnessSessionId: 'oc-1',
          cwd: '/w/acme',
        },
      ],
    });
    const snapshot = await service.snapshot();
    expect(snapshot.sessionIdentities).toEqual([
      {
        source: 'claude-code',
        providerSessionId: 'sess-claude-1',
        durableSessionId: 'exa-1',
        cwd: '/w/acme',
      },
      {
        source: 'codex',
        providerSessionId: 'codex-sess-live',
        durableSessionId: 'exa-2',
        cwd: '/w/acme',
      },
    ]);
  });
});

describe('persistence and incremental passes', () => {
  it('a restarted service resumes from persisted state without re-reading the corpus', async () => {
    const first = makeService();
    await first.snapshot();
    await first.settle();
    const scanned = await first.snapshot();
    await first.dispose();

    const second = makeService();
    const warm = await second.snapshot();
    // Persisted samples are served before any pass runs.
    expect(warm.scanState.firstScanComplete).toBe(true);
    expect(warm.samples.map(s => s.idempotencyKey).sort()).toEqual(
      scanned.samples.map(s => s.idempotencyKey).sort()
    );
    // The automatic warm pass is incremental and reads nothing.
    const bytesBefore = warm.diagnostics.bytesRead;
    await second.settle();
    const after = await second.snapshot();
    expect(after.diagnostics.bytesRead).toBe(bytesBefore);
    expect(after.scanState.phase).toBe('idle');
  });

  it('an appended rollout tail is read from the watermark, not from zero', async () => {
    const service = makeService();
    await service.snapshot();
    await service.settle();
    const before = await service.snapshot();
    const codexTotal = (samples: typeof before.samples) =>
      samples
        .filter(
          s => s.source === 'codex' && s.providerSessionId === 'codex-sess-live'
        )
        .reduce((n, s) => n + totalTokens(s.usage), 0);
    expect(codexTotal(before.samples)).toBe(3_150);

    const rollout = path.join(
      codexRoot,
      '2026/08/10',
      'rollout-2026-08-10T08-00-00-codex-sess-live.jsonl'
    );
    await fs.promises.appendFile(rollout, CODEX_APPENDED);
    service.rescan();
    await service.settle();

    const after = await service.snapshot();
    // The delta telescopes: one new turn of 3,150 raw tokens.
    expect(codexTotal(after.samples)).toBe(6_300);
    // Only the appended bytes were read.
    expect(after.diagnostics.bytesRead - before.diagnostics.bytesRead).toBe(
      Buffer.byteLength(CODEX_APPENDED, 'utf8')
    );
    // Capacity truth advanced with the tail.
    const primary = after.planWindows.find(w => w.scope === 'primary');
    expect(primary?.usedPercent).toBe(58.8);
    expect(after.scanState.phase).toBe('idle');
  });
});

describe('cancellation', () => {
  /** Wraps the real filesystem with a delay per read, so a pass is slow
   *  enough to cancel deterministically. */
  class SlowFileSystem implements ConsumptionFileSystem {
    private readonly real = new NodeConsumptionFileSystem();
    constructor(private readonly delayMs: number) {}
    listFiles(dir: string): Promise<ConsumptionFileRef[]> {
      return this.real.listFiles(dir);
    }
    async readFrom(
      p: string,
      fromByte: number,
      maxBytes?: number
    ): Promise<ConsumptionChunk | null> {
      await new Promise(resolve => setTimeout(resolve, this.delayMs));
      return this.real.readFrom(p, fromByte, maxBytes);
    }
  }

  it('cancel keeps completed work, reads phase idle, and a later pass finishes the job', async () => {
    const service = makeService({ fileSystem: new SlowFileSystem(60) });
    const events: ConsumptionUpdatedEvent[] = [];
    service.onUpdated(event => events.push(event));
    await service.snapshot(); // starts the slow first scan
    await new Promise(resolve => setTimeout(resolve, 100));
    service.cancelScan();
    await service.settle();

    const cancelled = await service.snapshot();
    expect(cancelled.scanState.cancelled).toBe(true);
    expect(cancelled.scanState.phase).toBe('idle');
    expect(cancelled.scanState.firstScanComplete).toBe(false);

    service.rescan();
    await service.settle();
    const done = await service.snapshot();
    expect(done.scanState.firstScanComplete).toBe(true);
    expect(done.scanState.cancelled).toBe(false);
    const shared = done.samples.filter(s =>
      s.idempotencyKey.includes('req_fixture_a')
    );
    expect(shared).toHaveLength(2);
  });
});

describe('privacy', () => {
  it('a full scan writes only under its own state directory and mutates nothing in the corpus', async () => {
    const statBefore = new Map<string, { mtimeMs: number; size: number }>();
    const corpusFiles: string[] = [];
    for (const dir of [claudeRoot, codexRoot]) {
      const walk = async (d: string) => {
        for (const entry of await fs.promises.readdir(d, {
          withFileTypes: true,
        })) {
          const full = path.join(d, entry.name);
          if (entry.isDirectory()) await walk(full);
          else {
            corpusFiles.push(full);
            const stat = await fs.promises.stat(full);
            statBefore.set(full, { mtimeMs: stat.mtimeMs, size: stat.size });
          }
        }
      };
      await walk(dir);
    }

    const written = new Set<string>();
    const record = (p: unknown) => {
      if (typeof p === 'string') written.add(p);
    };
    const realAppend = fs.promises.appendFile.bind(fs.promises);
    const realWrite = fs.promises.writeFile.bind(fs.promises);
    const realMkdir = fs.promises.mkdir.bind(fs.promises);
    const realRename = fs.promises.rename.bind(fs.promises);
    // fs.createWriteStream cannot be spied under ESM; it is used only by log
    // compaction, whose write containment the state-store test pins.
    const spies = [
      vi
        .spyOn(fs.promises, 'appendFile')
        .mockImplementation(async (p, ...rest) => {
          record(p);
          return realAppend(p as never, ...(rest as [never]));
        }),
      vi
        .spyOn(fs.promises, 'writeFile')
        .mockImplementation(async (p, ...rest) => {
          record(p);
          return realWrite(p as never, ...(rest as [never]));
        }),
      vi.spyOn(fs.promises, 'mkdir').mockImplementation(async (p, ...rest) => {
        record(p);
        return realMkdir(p as never, ...(rest as [never]));
      }),
      vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
        record(from);
        record(to);
        return realRename(from as never, to as never);
      }),
    ];
    try {
      const service = makeService();
      await service.snapshot();
      await service.settle();
      await service.dispose();

      expect(written.size).toBeGreaterThan(0);
      for (const p of written) {
        expect(p === stateDir || p.startsWith(stateDir + path.sep)).toBe(true);
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    // The corpus itself is untouched: same sizes, same mtimes, no new files.
    for (const file of corpusFiles) {
      const stat = await fs.promises.stat(file);
      const before = statBefore.get(file)!;
      expect(stat.size).toBe(before.size);
      expect(stat.mtimeMs).toBe(before.mtimeMs);
    }
  });
});

/**
 * BUG-032 — retention is enforced where samples are WRITTEN.
 *
 * The corpus fixture spans 2026-07-01 to 2026-08-10, so a default-horizon
 * service sees the Codex half as current and the Claude half as history. That
 * split is the assertion: what falls outside the horizon never enters state,
 * and therefore never enters the log that compaction rewrites from state.
 */
describe('sample retention', () => {
  it('admits only what the horizon covers, and says how much it dropped', async () => {
    const bounded = makeService({
      sampleHorizonMs: CONSUMPTION_SAMPLE_HORIZON_MS,
    });
    await bounded.snapshot();
    await bounded.settle();
    const snapshot = await bounded.snapshot();

    // The Codex fixture (2026-08-09/10) is inside the window; the Claude
    // fixture (2026-07-01..04) is forty days behind it and is not.
    expect(new Set(snapshot.samples.map(s => s.source))).toEqual(
      new Set(['codex'])
    );
    expect(snapshot.samples.length).toBeGreaterThan(0);
  });

  it('the persisted log carries only what state retained', async () => {
    const bounded = makeService({
      sampleHorizonMs: CONSUMPTION_SAMPLE_HORIZON_MS,
    });
    await bounded.snapshot();
    await bounded.settle();
    await bounded.dispose();

    const log = await fs.promises.readFile(
      path.join(stateDir, 'log-v1.jsonl'),
      'utf8'
    );
    const samples = log
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(envelope => envelope.k === 'sample');
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every(envelope => envelope.v.source === 'codex')).toBe(true);

    // And a restart agrees: nothing outside the horizon comes back.
    const restarted = makeService({
      sampleHorizonMs: CONSUMPTION_SAMPLE_HORIZON_MS,
    });
    const after = await restarted.snapshot();
    expect(after.samples.every(sample => sample.source === 'codex')).toBe(true);
  });

  it('a widened horizon is the same service seeing more', async () => {
    const wide = makeService({
      sampleHorizonMs: CONSUMPTION_SAMPLE_MAX_HORIZON_MS,
    });
    await wide.snapshot();
    await wide.settle();
    const snapshot = await wide.snapshot();
    expect(new Set(snapshot.samples.map(s => s.source))).toEqual(
      new Set(['claude-code', 'codex'])
    );
  });
});
