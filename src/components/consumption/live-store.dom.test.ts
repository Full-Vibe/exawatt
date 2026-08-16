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

/* ------------------------------------------------------------------ */
/* BUG-016 — a bridge whose command engine is not running               */
/* ------------------------------------------------------------------ */

interface StoppedBridgeOptions {
  /** Main answers the engine channel with this phase. */
  phase?: 'starting' | 'ready' | 'paused';
  /** `consumption:snapshot` rejects, the way an unregistered channel does. */
  snapshotRejects?: boolean;
}

function installStoppedBridge(options: StoppedBridgeOptions): void {
  installFakeBridge(readySnapshot());
  const electron = (window as unknown as { electron: Record<string, unknown> })
    .electron;
  if (options.snapshotRejects) {
    (electron.consumption as { snapshot: () => Promise<unknown> }).snapshot =
      async () => {
        throw new Error("No handler registered for 'consumption:snapshot'");
      };
  }
  if (options.phase) {
    electron.commandEngine = {
      phase: async () => options.phase,
      onChanged: () => () => {},
    };
  }
}

describe('a command engine that is not running', () => {
  it('is `paused`, not `pending`, when main reports the engine paused', async () => {
    installStoppedBridge({ phase: 'paused', snapshotRejects: true });
    const off = subscribeLiveConsumption(() => {});
    await vi.waitFor(() => expect(getLiveConsumption().status).toBe('paused'));
    const state = getLiveConsumption();
    // still the LIVE side of the seam: an empty read, never demo numbers
    expect(state.view?.workspace.sessionCount).toBe(0);
    // referential stability for useSyncExternalStore
    expect(getLiveConsumption()).toBe(state);
    off();
  });

  it('is `paused` when the bridge cannot answer at all, whatever killed it', async () => {
    // No engine channel: an older main, or a scanner that died after boot.
    // The fact on screen is identical, so the state is identical.
    installStoppedBridge({ snapshotRejects: true });
    const off = subscribeLiveConsumption(() => {});
    await vi.waitFor(() => expect(getLiveConsumption().status).toBe('paused'));
    off();
  });

  it('leaves a read that succeeded alone when the engine stops afterwards', async () => {
    installStoppedBridge({ phase: 'ready' });
    const off = subscribeLiveConsumption(() => {});
    await vi.waitFor(() => expect(getLiveConsumption().status).toBe('ready'));
    // the engine dies; the pull now fails
    (
      window as unknown as {
        electron: { consumption: { snapshot: () => Promise<unknown> } };
      }
    ).electron.consumption.snapshot = async () => {
      throw new Error('engine gone');
    };
    await new Promise(resolve => setTimeout(resolve, 50));
    // numbers that were genuinely read keep their state and their own age
    expect(getLiveConsumption().status).toBe('ready');
    expect(getLiveConsumption().revision).toBe(1);
    off();
  });

  it('stays `unavailable` with no bridge — the demo corpus is honest there', () => {
    expect(getLiveConsumption().status).toBe('unavailable');
  });
});

/* ------------------------------------------------------------------ */
/* D3 — a Session is named identically on every surface                */
/* ------------------------------------------------------------------ */

interface NamingFleet {
  ptys?: unknown[];
  closed?: unknown[];
  layout?: unknown;
}

/** The same bridge, with the fleet records the naming path actually reads. */
function installNamingBridge(fleet: NamingFleet): void {
  const snapshot = readySnapshot();
  (window as unknown as { electron: unknown }).electron = {
    isElectron: true,
    consumption: {
      snapshot: async () => snapshot,
      rescan: async () => {},
      cancelScan: async () => {},
      onUpdated: () => () => {},
    },
    pty: {
      list: async () => fleet.ptys ?? [],
      closedSessions: async () => fleet.closed ?? [],
    },
    workspace: {
      load: async () => fleet.layout ?? { projects: [] },
      onChanged: () => () => {},
    },
  };
}

async function readyTitle(): Promise<string> {
  const off = subscribeLiveConsumption(() => {});
  await vi.waitFor(() => expect(getLiveConsumption().status).toBe('ready'));
  const rows = gridRows(getLiveConsumption().view!);
  off();
  expect(rows).toHaveLength(1);
  return rows[0].title;
}

const livePty = (over: Record<string, unknown> = {}) => ({
  id: 'pty-1',
  durableSessionId: 'durable-1',
  harness: 'codex',
  title: 'Codex',
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
  ...over,
});

describe('session naming', () => {
  it('prefers the context summary over an unrenamed harness title', async () => {
    // The defect verbatim: 14 of 14 rows read "Claude Code" because the
    // store took `title` raw. The Team altitude, calling the resolver on
    // the same Session, showed its real work.
    installNamingBridge({
      ptys: [
        livePty({
          contextSummary: 'Unified consumption dashboard across AI platforms',
        }),
      ],
    });
    expect(await readyTitle()).toBe(
      'Unified consumption dashboard across AI platforms'
    );
  });

  it('keeps an operator rename primary over the context summary', async () => {
    installNamingBridge({
      ptys: [
        livePty({
          title: 'gateway reconnect backoff',
          contextSummary: 'Unified consumption dashboard',
        }),
      ],
    });
    expect(await readyTitle()).toBe('gateway reconnect backoff');
  });

  it('falls back to New agent rather than printing the harness name', async () => {
    installNamingBridge({ ptys: [livePty()] });
    expect(await readyTitle()).toBe('New agent');
  });

  it("reads a closed Session's goal from the ledger", async () => {
    installNamingBridge({
      ptys: [],
      closed: [
        {
          durableSessionId: 'durable-1',
          title: 'Codex',
          titleKind: 'default',
          goal: 'ENG-004 V3.3 F7 fleet board composition',
          harness: 'codex',
          cwd: '/Users/op/Code/exawatt',
          projectDir: '/Users/op/Code/exawatt',
          projectName: 'exawatt',
          harnessSessionId: 'prov-1',
          initialTask: null,
          closedAt: NOW - HOUR,
        },
      ],
    });
    expect(await readyTitle()).toBe('ENG-004 V3.3 F7 fleet board composition');
  });

  it('reads a persisted workspace tab the same way the tab strip does', async () => {
    installNamingBridge({
      ptys: [],
      layout: {
        projects: [
          {
            dir: '/Users/op/Code/exawatt',
            name: 'exawatt',
            tabs: [
              {
                id: 'tab-1',
                durableSessionId: 'durable-1',
                harness: 'codex',
                title: 'Codex',
                titleKind: 'default',
                lifecycle: 'stopped-clean',
                contextSummary: 'Plan remote agent harness for Hetzner VPS',
              },
            ],
          },
        ],
      },
    });
    expect(await readyTitle()).toBe('Plan remote agent harness for Hetzner VPS');
  });
});

describe('provider plan accounts cross the bridge (D1/D2)', () => {
  it('carries account state onto the built view instead of dropping it', async () => {
    const snapshot = readySnapshot();
    snapshot.providerPlanAccounts = [
      {
        source: 'claude-code',
        status: 'unavailable',
        observedAt: iso(NOW - 3 * HOUR),
        planType: 'max',
        spend: {
          usedMinor: 20_160,
          limitMinor: 20_000,
          currency: 'USD',
          exponent: 2,
          percent: 100.8,
          enabled: true,
        },
      },
    ];
    (window as unknown as { electron: unknown }).electron = {
      isElectron: true,
      consumption: {
        snapshot: async () => snapshot,
        rescan: async () => {},
        cancelScan: async () => {},
        onUpdated: () => () => {},
      },
      pty: { list: async () => [], closedSessions: async () => [] },
      workspace: { load: async () => ({ projects: [] }), onChanged: () => () => {} },
    };
    const off = subscribeLiveConsumption(() => {});
    await vi.waitFor(() => expect(getLiveConsumption().status).toBe('ready'));
    const view = getLiveConsumption().view!;
    const claude = view.sources.find(s => s.harness === 'claude-code')!;
    expect(claude.accountRead?.status).toBe('unavailable');
    expect(claude.accountRead?.spend?.usedMinor).toBe(20_160);
    off();
  });
});
