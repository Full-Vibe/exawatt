import { describe, expect, it, vi } from 'vitest';
import { localLogAssurance, type ConsumptionSample } from '@exawatt/core';
import {
  planLocalOperatorStats,
  recordOperatorStatsSyncEvent,
} from './operator-stats-ipc';

// This suite runs in Node, so importing the real `electron` package would run
// its installer shim: it reads `node_modules/electron/path.txt`, and when that
// file is briefly absent — which it is every time a sibling agent worktree
// re-links Electron — it tries to DOWNLOAD Electron and then throws "Electron
// failed to install correctly". Nothing here wants the binary's path, only the
// pure logic under test, so the module is stood down rather than resolved
// (BUG-057). The four suites that need `app` already mock it with a body.
vi.mock('electron', () => ({}));

const SINCE = '2026-08-16T18:00:00.000Z';

function sample(
  at: string,
  source: ConsumptionSample['source']
): ConsumptionSample {
  return {
    at,
    source,
    model: source === 'grok' ? 'grok-code-fast-1' : 'gpt-5.6',
    effort: null,
    providerSessionId: `${source}-private-session`,
    cwd: '/private/project',
    gitBranch: 'private-branch',
    usage: {
      inputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 50,
      reasoningTokens: 10,
      webSearches: 0,
      webFetches: 0,
    },
    assurance: localLogAssurance(source),
    idempotencyKey: `${source}-${at}`,
    contextWindow: null,
    sourceFile: `/private/${source}.jsonl`,
    delegation: null,
    entrypoint: source === 'grok' ? 'grok-cli' : 'codex-tui',
  };
}

const NOW = Date.parse('2026-08-17T20:00:00.000Z');

describe('Operator stats Consumption projection', () => {
  it('plans the settled consent window and emits only V1 public sources', async () => {
    const settledSampleView = vi.fn(async () => ({
      samples: [
        sample('2026-08-16T18:10:00.000Z', 'codex'),
        sample('2026-08-16T18:20:00.000Z', 'codex'),
        sample('2026-08-16T18:15:00.000Z', 'grok'),
      ],
      completeSinceMs: Number.NEGATIVE_INFINITY,
    }));

    const plan = await planLocalOperatorStats(
      { settledSampleView },
      { since: SINCE, timezone: 'America/Los_Angeles', cursor: null },
      NOW
    );

    expect(settledSampleView).toHaveBeenCalledWith(Date.parse(SINCE));
    const days = plan.publications.flatMap(value => value.days);
    expect(days).toHaveLength(1);
    expect(days[0].sources).toEqual(['codex']);
    expect(plan.publications.flatMap(value => value.runs)).toHaveLength(1);
    expect(plan.coverage).toEqual({
      from: '2026-08-16',
      through: '2026-08-17',
    });
    expect(JSON.stringify(plan)).not.toMatch(/private|session|branch|jsonl/);
  });

  it('never covers dates the local view has pruned', async () => {
    const plan = await planLocalOperatorStats(
      {
        settledSampleView: async () => ({
          samples: [],
          completeSinceMs: Date.parse('2026-08-16T20:00:00.000Z'),
        }),
      },
      { since: SINCE, timezone: 'America/Los_Angeles', cursor: null },
      NOW
    );
    expect(plan.coverage?.from).toBe('2026-08-17');
  });
});

describe('Operator stats sync record', () => {
  it('logs a failure with its reason and persists it', () => {
    const record = vi.fn();
    const persist = vi.fn(() => ({}));
    const event = {
      kind: 'failed',
      at: '2026-09-14T07:54:00.000Z',
      failure: 'rejected',
      retryable: false,
      status: 400,
      code: 'invalid_request',
      detail: 'runs[128].elapsedMs is out of bounds',
    };

    recordOperatorStatsSyncEvent(event, record, persist);

    expect(record).toHaveBeenCalledWith('operator-stats.sync-failed', {
      failure: 'rejected',
      retryable: false,
      status: 400,
      code: 'invalid_request',
      detail: 'runs[128].elapsedMs is out of bounds',
    });
    expect(persist).toHaveBeenCalledWith(event);
  });

  it('persists a publication without logging it', () => {
    const record = vi.fn();
    const persist = vi.fn(() => ({}));

    recordOperatorStatsSyncEvent(
      {
        kind: 'published',
        at: '2026-09-24T01:00:00.000Z',
        coverage: { from: '2026-09-17', through: '2026-09-23' },
        derivation: 2,
      },
      record,
      persist
    );

    expect(record).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('refuses a malformed event from the renderer', () => {
    expect(() =>
      recordOperatorStatsSyncEvent(
        { kind: 'published', at: 'yesterday', coverage: null },
        vi.fn(),
        vi.fn(() => ({}))
      )
    ).toThrow(/Invalid operator stats sync event/);
  });
});
