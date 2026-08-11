import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LocalSessionsTransport,
  sessionStatus,
  sessionToAgent,
} from '../transports/local-sessions';
import type {
  LocalSessionSnapshot,
  LocalSessionsSource,
} from '../transports/local-sessions';
import { FleetManager } from '../state/fleet-manager';

const snap = (
  over: Partial<LocalSessionSnapshot> = {}
): LocalSessionSnapshot => ({
  id: 'pty-1',
  harness: 'claude',
  title: 'Claude Code',
  cwd: '/Users/x/Code/exawatt-wt/agent-a',
  projectDir: '/Users/x/Code/exawatt',
  projectName: 'exawatt',
  startedAt: 1_000,
  exited: false,
  exitCode: null,
  ...over,
});

describe('sessionStatus', () => {
  it('maps exit codes to complete/error', () => {
    expect(
      sessionStatus({ exited: true, exitCode: 0 }, 0, 10_000, 15_000)
    ).toBe('complete');
    expect(
      sessionStatus({ exited: true, exitCode: null }, 0, 10_000, 15_000)
    ).toBe('complete');
    expect(
      sessionStatus({ exited: true, exitCode: 1 }, 0, 10_000, 15_000)
    ).toBe('error');
  });

  it('maps recent output to working, quiet to idle', () => {
    expect(
      sessionStatus({ exited: false, exitCode: null }, 9_000, 10_000, 15_000)
    ).toBe('working');
    expect(
      sessionStatus({ exited: false, exitCode: null }, 1_000, 50_000, 15_000)
    ).toBe('idle');
  });

  it('lets reported Session truth outrank stale byte activity', () => {
    expect(
      sessionStatus(
        {
          exited: false,
          exitCode: null,
          harness: 'claude',
          working: false,
          engaged: true,
        },
        9_900,
        10_000,
        15_000
      )
    ).toBe('complete');
    expect(
      sessionStatus(
        {
          exited: false,
          exitCode: null,
          harness: 'claude',
          working: true,
          engaged: true,
          attention: { kind: 'turn-end', since: 9_000 },
        },
        0,
        50_000,
        15_000
      )
    ).toBe('working');
    expect(
      sessionStatus(
        {
          exited: false,
          exitCode: null,
          harness: 'shell',
          working: false,
          engaged: true,
        },
        9_900,
        10_000,
        15_000
      )
    ).toBe('idle');
  });

  it('uses reported turn and operator-gate truth before source activity', () => {
    const base = {
      exited: false,
      exitCode: null,
      harness: 'claude',
      working: false,
      engaged: true,
    };
    expect(
      sessionStatus(
        {
          ...base,
          delegation: { ownTurn: 'generating', children: [] },
        },
        0,
        50_000,
        15_000
      )
    ).toBe('working');
    expect(
      sessionStatus(
        {
          ...base,
          delegation: {
            ownTurn: 'generating',
            blockedOn: 'question',
            children: [],
          },
        },
        0,
        50_000,
        15_000
      )
    ).toBe('blocked');
  });

  it('separates an explicit human gate from a quiet result boundary', () => {
    const attention = { kind: 'bell', since: 9_500 };
    expect(
      sessionStatus(
        { exited: false, exitCode: null, attention },
        9_000,
        10_000,
        15_000
      )
    ).toBe('blocked'); // even while output is recent
    // exit always wins — a dead session is not waiting on anyone
    expect(
      sessionStatus(
        { exited: true, exitCode: 0, attention },
        9_000,
        10_000,
        15_000
      )
    ).toBe('complete');
    expect(
      sessionStatus(
        {
          exited: false,
          exitCode: null,
          attention: { kind: 'turn-end', since: 9_500 },
        },
        9_000,
        10_000,
        15_000
      )
    ).toBe('complete');
  });
});

describe('sessionToAgent', () => {
  it('maps a session to an ExawattAgent (name from cwd basename, project from projectName)', () => {
    const a = sessionToAgent(snap(), 2_000, 3_000, 15_000);
    expect(a.id).toBe('pty-1');
    expect(a.name).toBe('agent-a · Claude Code');
    expect(a.projectId).toBe('/Users/x/Code/exawatt');
    expect(a.project).toBe('exawatt');
    expect(a.status).toBe('working');
    expect(a.lastActivityAt).toBe(2_000);
    expect(a.createdAt).toBe(1_000);
    expect(a.sessionState).toBe('live');
    expect(a.goal).toContain('/Users/x/Code/exawatt-wt/agent-a');
  });

  it('preserves the stable tab reference for a stopped Session', () => {
    const a = sessionToAgent(
      snap({
        id: 'workspace:durable-2',
        sessionKey: 'tab-2',
        sessionState: 'stopped',
        exited: true,
        exitCode: null,
      }),
      0,
      3_000,
      15_000
    );
    expect(a.status).toBe('complete');
    expect(a.sessionKey).toBe('tab-2');
    expect(a.sessionState).toBe('stopped');
  });

  it('uses the micro-context summary as the goal when present', () => {
    const a = sessionToAgent(
      snap({ contextSummary: 'Fixing token refresh expiry tests' }),
      2_000,
      3_000,
      15_000
    );
    expect(a.goal).toBe('Fixing token refresh expiry tests');
    // blank summaries fall back to the descriptive default
    const b = sessionToAgent(
      snap({ contextSummary: '  ' }),
      2_000,
      3_000,
      15_000
    );
    expect(b.goal).toContain('Interactive');
  });

  it('carries live measured burn into AgentMetrics; absent stays absent (E5)', () => {
    const measured = sessionToAgent(
      snap({ rawTokens: 12_000, normalizedTokens: 8_000 }),
      2_000,
      3_000,
      15_000
    );
    expect(measured.metrics.rawTokens).toBe(12_000);
    expect(measured.metrics.normalizedTokens).toBe(8_000);
    // an unmeasured Session reports NOTHING — the burn lens omits it
    const unmeasured = sessionToAgent(snap(), 2_000, 3_000, 15_000);
    expect(unmeasured.metrics.rawTokens).toBeUndefined();
    expect(unmeasured.metrics.normalizedTokens).toBeUndefined();
  });

  it('only a human gate produces blockerInfo; quiet completion is a result', () => {
    const result = sessionToAgent(
      snap({ attention: { kind: 'turn-end', since: 2_500 } }),
      2_000,
      3_000,
      15_000
    );
    expect(result.status).toBe('complete');
    expect(result.blockerInfo).toBeUndefined();
    const gated = sessionToAgent(
      snap({ attention: { kind: 'bell', since: 2_500 } }),
      2_000,
      3_000,
      15_000
    );
    expect(gated.status).toBe('blocked');
    expect(gated.blockerInfo).toMatchObject({
      type: 'input_needed',
      createdAt: 2_500,
    });
    // clear flag = no blocker
    const b = sessionToAgent(snap({ attention: null }), 2_000, 3_000, 15_000);
    expect(b.status).toBe('working');
    expect(b.blockerInfo).toBeUndefined();
  });
});

describe('LocalSessionsTransport', () => {
  let now = 100_000;
  let sessions: LocalSessionSnapshot[];
  let dataHandler: ((p: { id: string }) => void) | null;
  let exitHandler: ((p: { id: string; exitCode: number }) => void) | null;
  let source: LocalSessionsSource;
  let manager: FleetManager;
  let transport: LocalSessionsTransport;

  beforeEach(() => {
    vi.useFakeTimers();
    now = 100_000;
    sessions = [snap({ startedAt: now })];
    dataHandler = null;
    exitHandler = null;
    source = {
      list: () => Promise.resolve(sessions.map(s => ({ ...s }))),
      onData: h => {
        dataHandler = h;
        return () => {
          dataHandler = null;
        };
      },
      onExit: h => {
        exitHandler = h;
        return () => {
          exitHandler = null;
        };
      },
    };
    manager = new FleetManager();
    transport = new LocalSessionsTransport(source, {
      pollMs: 5_000,
      workingWindowMs: 15_000,
      activityFlushMs: 1_000,
      now: () => now,
    });
    transport.initialize(manager);
  });

  afterEach(() => {
    transport.stop();
    vi.useRealTimers();
  });

  const flush = async () => {
    await vi.advanceTimersByTimeAsync(0);
  };

  it('lists sessions into FleetState and decays working -> idle via polling', async () => {
    transport.start();
    await flush();
    let agent = manager.getFleetState().agents['pty-1'];
    expect(agent).toBeDefined();
    expect(agent.status).toBe('working'); // startedAt == now

    // 20s of silence: next poll recomputes to idle
    now += 20_000;
    await vi.advanceTimersByTimeAsync(20_000);
    agent = manager.getFleetState().agents['pty-1'];
    expect(agent.status).toBe('idle');
  });

  it('output events flip idle back to working (coalesced)', async () => {
    transport.start();
    await flush();
    now += 20_000;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(manager.getFleetState().agents['pty-1'].status).toBe('idle');

    dataHandler?.({ id: 'pty-1' });
    await vi.advanceTimersByTimeAsync(1_000); // activity flush window
    expect(manager.getFleetState().agents['pty-1'].status).toBe('working');
  });

  it('exit marks complete/error and closed tabs are removed', async () => {
    transport.start();
    await flush();
    sessions[0] = { ...sessions[0], exited: true, exitCode: 0 };
    exitHandler?.({ id: 'pty-1', exitCode: 0 });
    await flush();
    expect(manager.getFleetState().agents['pty-1'].status).toBe('complete');

    sessions = []; // tab closed in the workspace
    await vi.advanceTimersByTimeAsync(5_000);
    expect(manager.getFleetState().agents['pty-1']).toBeUndefined();
  });

  it('new sessions appearing between polls are picked up via their first output', async () => {
    transport.start();
    await flush();
    sessions.push(
      snap({
        id: 'pty-2',
        harness: 'shell',
        title: 'Shell',
        cwd: '/tmp',
        projectDir: '/tmp',
        projectName: 'tmp',
        startedAt: now,
      })
    );
    dataHandler?.({ id: 'pty-2' });
    await flush();
    expect(manager.getFleetState().agents['pty-2']).toBeDefined();
  });

  it('attention arriving on a poll flips the agent to blocked, clearing flips back', async () => {
    transport.start();
    await flush();
    expect(manager.getFleetState().agents['pty-1'].status).toBe('working');

    sessions[0] = { ...sessions[0], attention: { kind: 'bell', since: now } };
    now += 5_000;
    await vi.advanceTimersByTimeAsync(5_000);
    const blocked = manager.getFleetState().agents['pty-1'];
    expect(blocked.status).toBe('blocked');
    expect(blocked.blockerInfo?.type).toBe('input_needed');

    sessions[0] = { ...sessions[0], attention: null };
    now += 20_000; // long past the working window
    await vi.advanceTimersByTimeAsync(20_000);
    expect(manager.getFleetState().agents['pty-1'].status).toBe('idle');
  });

  it('a quiet turn boundary becomes a ready result without entering the blocker queue', async () => {
    transport.start();
    await flush();

    sessions[0] = {
      ...sessions[0],
      attention: { kind: 'turn-end', since: now },
    };
    now += 5_000;
    await vi.advanceTimersByTimeAsync(5_000);

    const result = manager.getFleetState().agents['pty-1'];
    expect(result.status).toBe('complete');
    expect(result.blockerInfo).toBeUndefined();
  });

  it('ignores an older reconciliation that completes after a manual refresh', async () => {
    const pending: Array<(value: LocalSessionSnapshot[]) => void> = [];
    source.list = () =>
      new Promise(resolve => {
        pending.push(resolve);
      });
    transport = new LocalSessionsTransport(source, { now: () => now });
    transport.initialize(manager);
    transport.start();
    expect(pending).toHaveLength(1);

    const refresh = transport.refresh();
    expect(pending).toHaveLength(2);
    pending[1]!([
      snap({
        projectName: 'Renamed',
        projectDir: '/code/renamed',
      }),
    ]);
    await refresh;
    expect(manager.getFleetState().agents['pty-1']).toMatchObject({
      project: 'Renamed',
      projectId: '/code/renamed',
    });

    pending[0]!([snap({ projectName: 'Stale' })]);
    await flush();
    expect(manager.getFleetState().agents['pty-1']).toMatchObject({
      project: 'Renamed',
      projectId: '/code/renamed',
    });
  });
});

/**
 * Delegated work at fleet altitude (ENG-023 D3b): a Session whose team is
 * running never reads as finished, an operator gate still outranks it, and
 * the children ride the agent as labels for the board to draw.
 */
describe('delegation in the fleet projection', () => {
  const children = [
    {
      id: 'c1',
      agentType: 'Explore',
      description: 'Map the release gates',
      startedAt: 1_000,
    },
  ];

  it('reads a quiet delegating parent as working, not idle or complete', () => {
    expect(
      sessionStatus(
        { exited: false, exitCode: null, delegation: { children } },
        1_000,
        50_000,
        15_000
      )
    ).toBe('working');
    // a stale turn boundary must not settle a Session with a live team
    expect(
      sessionStatus(
        {
          exited: false,
          exitCode: null,
          attention: { kind: 'turn-end', since: 2_000 },
          delegation: { children },
        },
        1_000,
        50_000,
        15_000
      )
    ).toBe('working');
  });

  it('keeps the operator gate above delegated work', () => {
    expect(
      sessionStatus(
        {
          exited: false,
          exitCode: null,
          attention: { kind: 'bell', since: 2_000 },
          delegation: { children },
        },
        1_000,
        50_000,
        15_000
      )
    ).toBe('blocked');
  });

  it('carries children onto the agent, and absent stays absent', () => {
    const delegating = sessionToAgent(
      snap({ delegation: { children } }),
      1_000,
      2_000,
      15_000
    );
    expect(delegating.delegation?.children).toEqual(children);
    const quiet = sessionToAgent(snap(), 1_000, 2_000, 15_000);
    expect(quiet).not.toHaveProperty('delegation');
    const emptied = sessionToAgent(
      snap({ delegation: { children: [] } }),
      1_000,
      2_000,
      15_000
    );
    expect(emptied).not.toHaveProperty('delegation');
  });
});
