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

  it('attention flags an alive session blocked (needs the operator)', () => {
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
  });
});

describe('sessionToAgent', () => {
  it('maps a session to an ExawattAgent (name from cwd basename, project from projectName)', () => {
    const a = sessionToAgent(snap(), 2_000, 3_000, 15_000);
    expect(a.id).toBe('pty-1');
    expect(a.name).toBe('agent-a · Claude Code');
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

  it('attention produces blockerInfo (fleet surfaces show the same truth)', () => {
    const a = sessionToAgent(
      snap({ attention: { kind: 'turn-end', since: 2_500 } }),
      2_000,
      3_000,
      15_000
    );
    expect(a.status).toBe('blocked');
    expect(a.blockerInfo).toMatchObject({
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
});
