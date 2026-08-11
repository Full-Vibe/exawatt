/**
 * ENG-008 E5 — the live store against a faked preload bridge: unavailable
 * without the bridge (the web fallback path), ready with joined fleet
 * identity once a snapshot lands, and revision-gated refetching so stale
 * notifications never cause a pull.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  emptyLiveConsumptionSnapshot,
  localLogAssurance,
  type ConsumptionSample,
  type ConsumptionUpdatedEvent,
  type LiveConsumptionSnapshot,
} from '@exawatt/core';
import { gridRows } from '@/app/usage/derive';
import {
  getLiveConsumption,
  resetLiveConsumptionForTests,
  subscribeLiveConsumption,
} from './live-store';

const NOW = Date.now();
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function codexSample(providerSessionId: string, atMs: number): ConsumptionSample {
  return {
    at: iso(atMs),
    source: 'codex',
    model: 'gpt-5.3-codex',
    effort: null,
    providerSessionId,
    cwd: '/Users/op/Code/exawatt',
    gitBranch: null,
    usage: {
      inputTokens: 1_000,
      cacheReadTokens: 40_000,
      cacheWriteTokens: 4_000,
      outputTokens: 2_500,
      reasoningTokens: 1_500,
      webSearches: 0,
      webFetches: 0,
    },
    assurance: localLogAssurance('codex'),
    idempotencyKey: `${providerSessionId}:${atMs}`,
    contextWindow: 272_000,
    sourceFile: null,
    delegation: null,
    entrypoint: 'codex-tui',
  };
}

function readySnapshot(): LiveConsumptionSnapshot {
  const snapshot = emptyLiveConsumptionSnapshot(NOW);
  snapshot.scanState = {
    phase: 'idle',
    progress: null,
    lastScanAt: iso(NOW - 2 * 60_000),
    corpusBytes: 1_000,
    firstScanComplete: true,
    revision: 1,
    cancelled: false,
  };
  snapshot.samples = [
    codexSample('prov-1', NOW - 2 * HOUR),
    codexSample('prov-1', NOW - 1 * HOUR),
  ];
  snapshot.sessionIdentities = [
    {
      source: 'codex',
      providerSessionId: 'prov-1',
      durableSessionId: 'durable-1',
      cwd: '/Users/op/Code/exawatt',
    },
  ];
  return snapshot;
}

interface FakeBridge {
  snapshotCalls: number;
  pushUpdate: (event: ConsumptionUpdatedEvent) => void;
}

function installFakeBridge(snapshot: LiveConsumptionSnapshot): FakeBridge {
  const fake: FakeBridge = { snapshotCalls: 0, pushUpdate: () => {} };
  const handlers = new Set<(event: ConsumptionUpdatedEvent) => void>();
  fake.pushUpdate = event => {
    for (const h of handlers) h(event);
  };
  (window as unknown as { electron: unknown }).electron = {
    isElectron: true,
    consumption: {
      snapshot: async () => {
        fake.snapshotCalls += 1;
        return snapshot;
      },
      rescan: async () => {},
      cancelScan: async () => {},
      onUpdated: (handler: (event: ConsumptionUpdatedEvent) => void) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    },
    pty: {
      list: async () => [
        {
          id: 'pty-1',
          durableSessionId: 'durable-1',
          harness: 'codex',
          title: 'worktree bootstrap',
          cwd: '/Users/op/Code/exawatt',
          projectDir: '/Users/op/Code/exawatt',
          projectName: 'exawatt',
          cols: 80,
          rows: 24,
          startedAt: NOW - 3 * HOUR,
          exited: false,
          exitCode: null,
          lastDataAt: NOW,
          harnessSessionId: 'prov-1',
        },
      ],
      closedSessions: async () => [],
    },
    workspace: {
      load: async () => ({
        projects: [
          {
            dir: '/Users/op/Code/exawatt',
            name: 'exawatt',
            color: '#19E6FF',
            tabs: [],
          },
        ],
      }),
      onChanged: () => () => {},
    },
  };
  return fake;
}

afterEach(() => {
  resetLiveConsumptionForTests();
  delete (window as unknown as { electron?: unknown }).electron;
});

describe('live store', () => {
  it('is permanently unavailable without the bridge (web fallback path)', () => {
    const a = getLiveConsumption();
    expect(a.status).toBe('unavailable');
    expect(a.view).toBeNull();
    // referential stability for useSyncExternalStore
    expect(getLiveConsumption()).toBe(a);
  });

  it('serves an honest empty pending view, then the joined live view', async () => {
    const fake = installFakeBridge(readySnapshot());
    const off = subscribeLiveConsumption(() => {});
    // synchronously: a pending EMPTY live view — never demo numbers
    const before = getLiveConsumption();
    expect(before.status === 'pending' || before.status === 'ready').toBe(true);
    if (before.status === 'pending') {
      expect(before.view?.workspace.sessionCount).toBe(0);
    }
    await vi.waitFor(() =>
      expect(getLiveConsumption().status).toBe('ready')
    );
    const state = getLiveConsumption();
    // fleet identity joined: the session carries its workspace title
    const rows = gridRows(state.view!);
    expect(rows).toHaveLength(1);
    expect(rows[0].identified).toBe(true);
    expect(rows[0].title).toBe('worktree bootstrap');
    expect(rows[0].projectName).toBe('exawatt');
    // burn is exported for the entity carriers by provider id
    expect(state.burnByProviderId.get('prov-1')?.rawTokens).toBeGreaterThan(0);
    expect(state.scan?.firstScanComplete).toBe(true);
    expect(fake.snapshotCalls).toBe(1);
    off();
  });

  it('never applies a snapshot older than the one on screen', async () => {
    const newer = readySnapshot();
    newer.scanState = { ...newer.scanState, revision: 5 };
    const fake = installFakeBridge(newer);
    const off = subscribeLiveConsumption(() => {});
    await vi.waitFor(() => expect(getLiveConsumption().status).toBe('ready'));
    expect(getLiveConsumption().revision).toBe(5);
    const applied = getLiveConsumption();

    // a regressed server response (older revision) must be dropped
    const older = emptyLiveConsumptionSnapshot(NOW);
    older.scanState = { ...older.scanState, revision: 3 };
    (
      window as unknown as {
        electron: { consumption: { snapshot: () => Promise<unknown> } };
      }
    ).electron.consumption.snapshot = async () => {
      fake.snapshotCalls += 1;
      return older;
    };
    fake.pushUpdate({ revision: 6, scanState: older.scanState });
    await vi.waitFor(() => expect(fake.snapshotCalls).toBe(2));
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(getLiveConsumption()).toBe(applied);
    expect(getLiveConsumption().revision).toBe(5);
    off();
  });

  it('refetches only when the revision advances', async () => {
    const fake = installFakeBridge(readySnapshot());
    const off = subscribeLiveConsumption(() => {});
    await vi.waitFor(() =>
      expect(getLiveConsumption().status).toBe('ready')
    );
    expect(fake.snapshotCalls).toBe(1);

    // stale revision: no pull
    fake.pushUpdate({
      revision: 1,
      scanState: readySnapshot().scanState,
    });
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(fake.snapshotCalls).toBe(1);

    // advancing revision: exactly one debounced pull
    fake.pushUpdate({
      revision: 2,
      scanState: { ...readySnapshot().scanState, revision: 2 },
    });
    await vi.waitFor(() => expect(fake.snapshotCalls).toBe(2));
    off();
  });
});
