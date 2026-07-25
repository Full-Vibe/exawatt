import { describe, expect, it } from 'vitest';
import {
  ClaudeConsumptionAdapter,
  CodexConsumptionAdapter,
  sessionIdFromClaudePath,
  sessionIdFromCodexPath,
} from '../consumption/adapters';
import {
  DECODE_MULTIPLIER,
  FALLBACK_WEIGHT,
  MODEL_WEIGHTS,
  resolveModelWeight,
  weightUsage,
} from '../consumption/model-weights';
import {
  directoryProjectResolver,
  rollupByDay,
  rollupByModel,
  rollupByProject,
  rollupBySession,
  rollupByRoadmapItem,
  rollupWorkspace,
  ownTotals,
  ownWeightedTokens,
} from '../consumption/rollup';
import { scanConsumption } from '../consumption/scan';
import type {
  ConsumptionChunk,
  ConsumptionFileRef,
  ConsumptionFileSystem,
} from '../consumption/ports';
import { localLogAssurance } from '../consumption/assurance';
import type {
  ConsumptionDelegation,
  ConsumptionSample,
  RawUsage,
} from '../consumption/types';
import { ZERO_USAGE } from '../consumption/types';
import {
  CLAUDE_FIXTURE_FILES,
  CODEX_FIXTURE_FILES,
} from './consumption-fixtures';

class MemoryFileSystem implements ConsumptionFileSystem {
  readonly reads: Array<{ path: string; fromByte: number }> = [];

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
    fromByte: number
  ): Promise<ConsumptionChunk | null> {
    const content = this.files[path];
    if (content === undefined) return null;
    this.reads.push({ path, fromByte });
    const buffer = Buffer.from(content, 'utf8');
    const slice = buffer.subarray(fromByte);
    return {
      text: slice.toString('utf8'),
      fromByte,
      toByte: fromByte + slice.length,
    };
  }
}

type SampleOverrides = Omit<Partial<ConsumptionSample>, 'usage'> & {
  usage?: Partial<RawUsage>;
};

const sample = (overrides: SampleOverrides): ConsumptionSample => {
  const source = overrides.source ?? 'claude-code';
  return {
    at: '2026-07-01T00:00:00.000Z',
    model: 'claude-sonnet-5',
    effort: null,
    providerSessionId: 'sess',
    cwd: '/w/acme',
    gitBranch: null,
    idempotencyKey: 'k',
    contextWindow: null,
    sourceFile: null,
    ...overrides,
    source,
    delegation: overrides.delegation ?? null,
    assurance: overrides.assurance ?? localLogAssurance(source),
    usage: { ...ZERO_USAGE, ...(overrides.usage ?? {}) },
  };
};

const delegation = (
  overrides: Partial<ConsumptionDelegation> = {}
): ConsumptionDelegation => ({
  agentId: 'agent-1',
  parentSessionId: 'sess',
  agentType: 'Explore',
  spawnDepth: 1,
  skill: null,
  background: false,
  parentAgentId: null,
  ...overrides,
});

describe('model weights', () => {
  it('resolves by longest matching prefix', () => {
    expect(resolveModelWeight('claude-opus-4-8').weight.tier).toBe('frontier');
    expect(resolveModelWeight('claude-haiku-4-5-20251001').weight.tier).toBe(
      'small'
    );
    expect(resolveModelWeight('gpt-5.6-sol').weight.tier).toBe('workhorse');
    expect(resolveModelWeight('gpt-5-mini').weight.tier).toBe('small');
  });

  it('falls back explicitly for unknown and null models', () => {
    expect(resolveModelWeight('llama-99-turbo')).toEqual({
      weight: FALLBACK_WEIGHT,
      explicit: false,
    });
    expect(resolveModelWeight(null).explicit).toBe(false);
  });

  it('states a basis for every entry', () => {
    for (const [id, weight] of Object.entries(MODEL_WEIGHTS)) {
      expect(weight.basis.length, id).toBeGreaterThan(20);
      expect(weight.output).toBeCloseTo(weight.input * DECODE_MULTIPLIER);
    }
  });

  it('never adds reasoning tokens on top of output tokens', () => {
    const weight = resolveModelWeight('gpt-5.5').weight;
    const withReasoning = weightUsage(
      { ...ZERO_USAGE, outputTokens: 100, reasoningTokens: 60 },
      weight
    );
    const withoutReasoning = weightUsage(
      { ...ZERO_USAGE, outputTokens: 100, reasoningTokens: 0 },
      weight
    );
    expect(withReasoning).toBe(withoutReasoning);
  });

  it('prices a cache read far below a fresh input token', () => {
    const weight = resolveModelWeight('claude-sonnet-5').weight;
    expect(weight.cacheRead).toBeLessThan(weight.input / 5);
  });
});

describe('rollups', () => {
  const samples = [
    sample({
      idempotencyKey: 'a',
      at: '2026-07-01T01:00:00.000Z',
      providerSessionId: 's1',
      cwd: '/w/acme',
      usage: { inputTokens: 100, outputTokens: 10 },
    }),
    sample({
      idempotencyKey: 'b',
      at: '2026-07-01T02:00:00.000Z',
      providerSessionId: 's1',
      cwd: '/w/acme',
      model: 'claude-opus-5',
      usage: { inputTokens: 200, outputTokens: 20 },
    }),
    sample({
      idempotencyKey: 'c',
      at: '2026-07-02T01:00:00.000Z',
      providerSessionId: 's2',
      source: 'codex',
      model: 'gpt-5.5',
      cwd: '/w/beta',
      usage: { inputTokens: 300, outputTokens: 30 },
    }),
    sample({
      idempotencyKey: 'd',
      at: '2026-07-02T02:00:00.000Z',
      providerSessionId: 's3',
      cwd: null,
      usage: { inputTokens: 400, outputTokens: 40 },
    }),
  ];

  it('groups by session and counts distinct sessions per source', () => {
    const { rollups } = rollupBySession(samples);
    expect(rollups).toHaveLength(3);
    const first = rollups.find(r => r.scope.label === 's1');
    expect(first?.samples).toBe(2);
    expect(first?.totals.inputTokens).toBe(300);
    expect(first?.sessionCount).toBe(1);
  });

  it('refuses to attribute a cwd-less sample to a project, and says so', () => {
    const { rollups, unattributedSamples, unattributedTotals } =
      rollupByProject(samples);
    expect(rollups.map(r => r.scope.label).sort()).toEqual(['acme', 'beta']);
    expect(unattributedSamples).toBe(1);
    expect(unattributedTotals.inputTokens).toBe(400);
  });

  it('accepts an injected project resolver', () => {
    const { rollups } = rollupByProject(samples, {
      projectResolver: cwd =>
        cwd.startsWith('/w/') ? { id: 'mono', label: 'monorepo' } : null,
    });
    expect(rollups).toHaveLength(1);
    expect(rollups[0].scope.label).toBe('monorepo');
    expect(rollups[0].sessionCount).toBe(2);
  });

  it('groups by UTC day', () => {
    const { rollups } = rollupByDay(samples);
    expect(rollups.map(r => r.scope.id).sort()).toEqual([
      '2026-07-01',
      '2026-07-02',
    ]);
  });

  it('reports the fallback share of weighted tokens', () => {
    const unknown = sample({
      idempotencyKey: 'x',
      model: 'some-unlisted-model',
      usage: { inputTokens: 1_000 },
    });
    const workspace = rollupWorkspace([...samples, unknown], {
      id: 'w',
      label: 'Workspace',
    });
    expect(workspace?.weightedTokensFromFallback).toBe(1_000);
    expect(workspace?.modelsWithoutWeight).toEqual(['some-unlisted-model']);
    expect(workspace?.weightedTokens).toBeGreaterThan(1_000);
  });

  it('weights a frontier model above a workhorse model for the same tokens', () => {
    const { rollups } = rollupByModel([
      sample({ idempotencyKey: 'p', model: 'claude-sonnet-5', usage: { inputTokens: 1_000 } }),
      sample({ idempotencyKey: 'q', model: 'claude-opus-5', usage: { inputTokens: 1_000 } }),
    ]);
    const sonnet = rollups.find(r => r.scope.id === 'claude-sonnet-5');
    const opus = rollups.find(r => r.scope.id === 'claude-opus-5');
    expect(sonnet?.totals.inputTokens).toBe(opus?.totals.inputTokens);
    expect(opus!.weightedTokens).toBe(sonnet!.weightedTokens * 5);
  });

  it('never claims verified assurance on a rollup', () => {
    const workspace = rollupWorkspace(samples, { id: 'w', label: 'Workspace' });
    expect(workspace?.assurance.reported.held).toBe(true);
    expect(workspace?.assurance.verified.held).toBe(false);
    expect(workspace?.assurance.reported.by).toBe('mixed');
  });

  it('leaves roadmap items unattributed without an injected link', () => {
    const { rollups, unattributedSamples } = rollupByRoadmapItem(
      samples,
      () => null
    );
    expect(rollups).toEqual([]);
    expect(unattributedSamples).toBe(samples.length);
  });

  it('honours the window filter', () => {
    const { rollups } = rollupByDay(samples, { from: '2026-07-02T00:00:00.000Z' });
    expect(rollups).toHaveLength(1);
    expect(rollups[0].scope.id).toBe('2026-07-02');
  });

  it('produces identical rollups for any input order', () => {
    const forward = rollupByProject(samples).rollups;
    const reversed = rollupByProject([...samples].reverse()).rollups;
    expect(reversed).toEqual(forward);
  });
});

describe('delegated split in rollups', () => {
  const withDelegation = [
    sample({
      idempotencyKey: 'own1',
      providerSessionId: 's1',
      usage: { inputTokens: 100, outputTokens: 10 },
    }),
    sample({
      idempotencyKey: 'del1',
      providerSessionId: 's1',
      model: 'claude-opus-5',
      usage: { inputTokens: 900, outputTokens: 90 },
      delegation: delegation({ agentId: 'agent-a', parentSessionId: 's1' }),
    }),
    sample({
      idempotencyKey: 'del2',
      providerSessionId: 's1',
      model: 'claude-opus-5',
      usage: { inputTokens: 400, outputTokens: 40 },
      delegation: delegation({
        agentId: 'agent-b',
        parentSessionId: 's1',
        agentType: 'general-purpose',
      }),
    }),
  ];

  it('reports the Session total INCLUDING delegated spend', () => {
    const { rollups } = rollupBySession(withDelegation);
    expect(rollups).toHaveLength(1);
    expect(rollups[0].totals.inputTokens).toBe(1_400);
    expect(rollups[0].samples).toBe(3);
  });

  it('separates own from delegated without reshaping the sample stream', () => {
    const [session] = rollupBySession(withDelegation).rollups;
    expect(session.delegated.samples).toBe(2);
    expect(session.delegated.totals.inputTokens).toBe(1_300);
    expect(session.delegated.agents).toBe(2);
    expect(session.delegated.agentTypes).toEqual([
      'Explore',
      'general-purpose',
    ]);
    expect(ownTotals(session).inputTokens).toBe(100);
    expect(ownWeightedTokens(session)).toBe(
      session.weightedTokens - session.delegated.weightedTokens
    );
    // Delegated spend dwarfs the parent's own here, which is the real pattern.
    expect(session.delegated.weightedTokens).toBeGreaterThan(
      ownWeightedTokens(session)
    );
  });

  it('flags a source that cannot report delegation at all', () => {
    const [codexOnly] = rollupBySession([
      sample({ idempotencyKey: 'cx', source: 'codex', providerSessionId: 'c1' }),
    ]).rollups;
    expect(codexOnly.delegationBlindSources).toEqual(['codex']);
    expect(codexOnly.delegated.samples).toBe(0);

    const [claudeOnly] = rollupBySession(withDelegation).rollups;
    expect(claudeOnly.delegationBlindSources).toEqual([]);
  });

  it('rolls delegated spend up to the Project through the parent cwd', () => {
    const { rollups } = rollupByProject(withDelegation);
    expect(rollups[0].scope.label).toBe('acme');
    expect(rollups[0].delegated.totals.inputTokens).toBe(1_300);
  });
});

describe('project resolver', () => {
  it('labels a directory by its last segment', () => {
    expect(directoryProjectResolver('/w/acme/')).toEqual({
      id: '/w/acme',
      label: 'acme',
    });
    expect(directoryProjectResolver('')).toBeNull();
  });
});

describe('session id recovery from paths', () => {
  it('reads a Claude session id from a top-level or subagent path', () => {
    expect(sessionIdFromClaudePath('/root/claude/-w-acme/abc.jsonl')).toBe('abc');
    expect(
      sessionIdFromClaudePath('/root/claude/-w-acme/abc/subagents/agent-x.jsonl')
    ).toBe('abc');
    expect(
      sessionIdFromClaudePath(
        '/root/claude/-w-acme/abc/subagents/workflows/wf_1/agent-y.jsonl'
      )
    ).toBe('abc');
  });

  it('reads a Codex session id from a rollout filename', () => {
    expect(
      sessionIdFromCodexPath('/root/codex/2026/07/24/rollout-2026-07-24T12-04-51-uuid-1.jsonl')
    ).toBe('uuid-1');
    expect(sessionIdFromCodexPath('/root/codex/nonsense.jsonl')).toBeNull();
  });
});

describe('scanConsumption', () => {
  const fs = () =>
    new MemoryFileSystem({ ...CLAUDE_FIXTURE_FILES, ...CODEX_FIXTURE_FILES });

  it('reads both sources through one injected filesystem', async () => {
    const scan = await scanConsumption(
      [
        new ClaudeConsumptionAdapter('/root/claude'),
        new CodexConsumptionAdapter('/root/codex'),
      ],
      fs()
    );
    // 6 Claude transcripts + 5 Codex rollouts. The `.meta.json` sidecar is
    // filtered out before parsing, so it is not a "file seen" for usage.
    expect(scan.diagnostics.filesSeen).toBe(11);
    expect(scan.samples.length).toBeGreaterThan(0);
    expect(new Set(scan.samples.map(s => s.source))).toEqual(
      new Set(['claude-code', 'codex'])
    );
    expect(scan.emptySources).toEqual([]);
    expect(scan.samples).toEqual(
      [...scan.samples].sort((a, b) => (a.at < b.at ? -1 : 1))
    );
  });

  it('counts damage instead of throwing on it', async () => {
    const scan = await scanConsumption(
      [
        new ClaudeConsumptionAdapter('/root/claude'),
        new CodexConsumptionAdapter('/root/codex'),
      ],
      fs()
    );
    expect(scan.diagnostics.linesUnparsable).toBe(4);
    expect(scan.diagnostics.truncatedFinalLines).toBe(2);
    expect(scan.diagnostics.filesUnreadable).toBe(0);
  });

  it('reads delegated transcripts from the nested subagents tree', async () => {
    const scan = await scanConsumption(
      [new ClaudeConsumptionAdapter('/root/claude')],
      fs()
    );
    const delegated = scan.samples.filter(s => s.delegation !== null);
    expect(delegated.length).toBe(4);
    expect(scan.diagnostics.delegatedRecords).toBe(4);
    // spawnDepth arrives from the sidecar for the run that has one, and stays
    // null for the run that does not.
    const withMeta = delegated.filter(s => s.delegation?.spawnDepth === 1);
    expect(withMeta.length).toBe(3);
    expect(scan.diagnostics.delegationMetaMissing).toBe(1);
    // The .meta.json sidecar is never parsed as a transcript.
    expect(scan.diagnostics.linesUnparsable).toBe(2);
  });

  it('keeps the request id shared by a parent turn and a fork run separate', async () => {
    const scan = await scanConsumption(
      [new ClaudeConsumptionAdapter('/root/claude')],
      fs()
    );
    const shared = scan.samples.filter(s =>
      s.idempotencyKey.includes('req_fixture_a')
    );
    expect(shared).toHaveLength(2);
    expect(shared.filter(s => s.delegation !== null)).toHaveLength(1);
  });

  it('surfaces the latest plan window and nothing for Claude', async () => {
    const scan = await scanConsumption(
      [
        new ClaudeConsumptionAdapter('/root/claude'),
        new CodexConsumptionAdapter('/root/codex'),
      ],
      fs()
    );
    expect(scan.planWindows.every(w => w.source === 'codex')).toBe(true);
    expect(scan.planWindows).toHaveLength(2);
  });

  it('reports an absent source explicitly', async () => {
    const scan = await scanConsumption(
      [new ClaudeConsumptionAdapter('/nowhere')],
      fs()
    );
    expect(scan.emptySources).toEqual(['claude-code']);
    expect(scan.samples).toEqual([]);
  });

  it('skips unchanged files on a warm scan and tails a grown one', async () => {
    const memory = fs();
    const adapters = [
      new ClaudeConsumptionAdapter('/root/claude'),
      new CodexConsumptionAdapter('/root/codex'),
    ];
    const cold = await scanConsumption(adapters, memory);
    const readsAfterCold = memory.reads.length;

    const warm = await scanConsumption(adapters, memory, {
      watermarks: cold.watermarks,
    });
    expect(memory.reads.length).toBe(readsAfterCold);
    expect(warm.samples).toEqual([]);
    expect(warm.diagnostics.bytesRead).toBe(0);
  });

  it('re-reads from byte zero when a file shrinks', async () => {
    const memory = fs();
    const adapters = [new ClaudeConsumptionAdapter('/root/claude')];
    const cold = await scanConsumption(adapters, memory);
    const path = '/root/claude/-w-acme/sess-claude-1.jsonl';
    memory.setContent(path, '{"type":"user"}\n');
    const warm = await scanConsumption(adapters, memory, {
      watermarks: cold.watermarks,
    });
    expect(memory.reads.filter(r => r.path === path).at(-1)?.fromByte).toBe(0);
    expect(warm.diagnostics.filesUnreadable).toBe(0);
  });

  it('produces the same totals cold and incrementally', async () => {
    const truncated = CLAUDE_FIXTURE_FILES[
      '/root/claude/-w-acme/sess-claude-1.jsonl'
    ];
    const half = truncated.slice(0, truncated.indexOf('\n', 200) + 1);
    const memory = new MemoryFileSystem({
      '/root/claude/-w-acme/sess-claude-1.jsonl': half,
    });
    const adapters = [new ClaudeConsumptionAdapter('/root/claude')];
    const first = await scanConsumption(adapters, memory);
    memory.setContent('/root/claude/-w-acme/sess-claude-1.jsonl', truncated);
    const second = await scanConsumption(adapters, memory, {
      watermarks: first.watermarks,
    });

    const incremental = [...first.samples, ...second.samples];
    const coldMemory = new MemoryFileSystem({
      '/root/claude/-w-acme/sess-claude-1.jsonl': truncated,
    });
    const cold = await scanConsumption(adapters, coldMemory);

    const total = (list: ConsumptionSample[]) =>
      list.reduce((sum, s) => sum + s.usage.outputTokens, 0);
    // The incremental read sees the same request twice; merging is what makes
    // the two paths agree, which is exactly why the key is idempotent.
    const { mergeSamples } = await import('../consumption/merge');
    expect(total(mergeSamples(incremental).samples)).toBe(total(cold.samples));
  });
});
