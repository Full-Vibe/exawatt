import { describe, expect, it, vi } from 'vitest';
import { localLogAssurance, type ConsumptionSample } from '@exawatt/core';
import { scanLocalOperatorStats } from './operator-stats-ipc';

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

describe('Operator stats Consumption projection', () => {
  it('requests the settled consent window and emits only V1 public sources', async () => {
    const settledSamplesSince = vi.fn(async () => [
      sample('2026-08-16T18:10:00.000Z', 'codex'),
      sample('2026-08-16T18:20:00.000Z', 'codex'),
      sample('2026-08-16T18:15:00.000Z', 'grok'),
    ]);

    const result = await scanLocalOperatorStats(
      { settledSamplesSince },
      SINCE,
      'America/Los_Angeles'
    );

    expect(settledSamplesSince).toHaveBeenCalledWith(Date.parse(SINCE));
    expect(result.days).toHaveLength(1);
    expect(result.days[0].sources).toEqual(['codex']);
    expect(result.runs).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/private|session|branch|jsonl/);
  });
});
