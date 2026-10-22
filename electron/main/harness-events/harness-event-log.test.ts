/**
 * BUG-102's evidence half: what a Session's process and harness did survives
 * a relaunch, in a bounded file keyed by identities that outlive a launch.
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const processes = vi.hoisted(
  () => [] as Array<{ exit: (code?: number, signal?: number) => void }>
);
vi.mock('node-pty', () => ({
  spawn: () => {
    let onExit: (event: {
      exitCode: number;
      signal?: number;
    }) => void = () => {};
    const process = {
      pid: 7000 + processes.length,
      onData: () => ({ dispose() {} }),
      onExit: (fn: typeof onExit) => {
        onExit = fn;
        return { dispose() {} };
      },
      write() {},
      resize() {},
      kill() {},
      exit: (exitCode = 0, signal?: number) => onExit({ exitCode, signal }),
    };
    processes.push(process);
    return process;
  },
}));
vi.mock('../pty/process-groups', () => ({
  stopProcessGroups: vi.fn(async () => {}),
}));
const { PtySessionManager } = await import('../pty/session-manager');
const { DelegationMonitor } = await import('./delegation-monitor');
const { attachHarnessEventLog, openHarnessEventLog } =
  await import('./harness-event-log');

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function userData() {
  const root = mkdtempSync(path.join(tmpdir(), 'exawatt-harness-log-'));
  roots.push(root);
  return root;
}

function lines(root: string) {
  return readFileSync(path.join(root, 'logs', 'harness-events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as Record<string, unknown>);
}

/** One launch of the app: a real Session owner and delegation record, wired
 *  to the log the way `pty-ipc` wires them. */
function launch(root: string) {
  const sessions = new PtySessionManager();
  const delegation = new DelegationMonitor();
  delegation.attach({ on() {} }, sessions);
  const log = attachHarnessEventLog(
    openHarnessEventLog(root),
    sessions,
    delegation
  );
  return { sessions, delegation, log };
}

describe('the harness-event log', () => {
  it('reads across a relaunch by durable Session and conversation', async () => {
    const root = userData();
    const first = launch(root);
    const { session } = await first.sessions.ensureRunning({
      harness: 'claude',
      cwd: process.cwd(),
      durableSessionId: 'wedged-session',
      resumeSessionId: 'conversation-1',
    });
    first.delegation.report(session.id, { kind: 'turn-start' });
    first.delegation.report(session.id, {
      kind: 'child-label',
      toolUseId: 'tool-1',
      agentType: 'Explore',
      description: 'Read the operator secret plan',
      at: 1,
    });
    processes.at(-1)!.exit(0, 9);

    // The relaunch: pty ids start over, and the log keeps both runs.
    const second = launch(root);
    const { session: resumed } = await second.sessions.ensureRunning({
      harness: 'claude',
      cwd: process.cwd(),
      durableSessionId: 'wedged-session',
      resumeSessionId: 'conversation-1',
    });
    expect(resumed.id).toBe(session.id);
    second.delegation.report(resumed.id, { kind: 'turn-start' });

    const written = lines(root);
    expect(written.map(line => line.event)).toEqual([
      'session.start',
      'harness.turn-start',
      'harness.child-label',
      'session.exit',
      'session.start',
      'harness.turn-start',
    ]);
    for (const line of written) {
      expect(line).toMatchObject({ durableSessionId: 'wedged-session' });
    }
    expect(written[0]).toMatchObject({
      harness: 'claude',
      harnessSessionId: 'conversation-1',
      pid: expect.any(Number),
    });
    expect(written[1]).toMatchObject({
      ownTurn: 'generating',
      blockedOn: null,
      childCount: 0,
    });
    expect(written[3]).toMatchObject({
      exitSignal: expect.stringMatching(/^SIG/),
      stopRequested: false,
      ranMs: expect.any(Number),
    });
    // Content-free: a spawn label is the operator's task in the Agent's words.
    expect(JSON.stringify(written)).not.toContain('secret plan');
    processes.at(-1)!.exit();
  });

  it('records an ask that started nothing, and an Exawatt stop as one', async () => {
    const root = userData();
    const { sessions, log } = launch(root);
    const { session } = await sessions.ensureRunning({
      harness: 'claude',
      cwd: process.cwd(),
      durableSessionId: 'asked-twice',
    });
    const again = await sessions.ensureRunning({
      harness: 'claude',
      cwd: process.cwd(),
      durableSessionId: 'asked-twice',
    });
    if (again.answer !== 'started') log.ensured(again.answer, again.session);
    const stop = sessions.stop(session.id);
    processes.at(-1)!.exit();
    await stop;
    expect(
      lines(root).map(line => [line.event, line.answer ?? line.stopRequested])
    ).toEqual([
      ['session.start', undefined],
      ['session.ensure', 'running'],
      ['session.exit', true],
    ]);
  });

  it('stays within two generations of its byte bound', async () => {
    const root = userData();
    const sessions = new PtySessionManager();
    const delegation = new DelegationMonitor();
    delegation.attach({ on() {} }, sessions);
    attachHarnessEventLog(
      openHarnessEventLog(root, { maxBytes: 4_096 }),
      sessions,
      delegation
    );
    const { session } = await sessions.ensureRunning({
      harness: 'claude',
      cwd: process.cwd(),
    });
    for (let index = 0; index < 100; index += 1)
      delegation.report(session.id, {
        kind: index % 2 ? 'turn-end' : 'turn-start',
      });
    const file = path.join(root, 'logs', 'harness-events.jsonl');
    expect(statSync(file).size).toBeLessThanOrEqual(4_096);
    expect(statSync(`${file}.1`).size).toBeLessThanOrEqual(4_096);
    processes.at(-1)!.exit();
  });

  it('a team fan-out cannot crowd out one turn boundary', async () => {
    const root = userData();
    const { sessions, delegation } = launch(root);
    const { session } = await sessions.ensureRunning({
      harness: 'claude',
      cwd: process.cwd(),
    });
    const boundaries: string[] = [];
    for (let turn = 0; turn < 40; turn += 1) {
      delegation.report(session.id, { kind: 'turn-start' });
      boundaries.push('harness.turn-start');
      for (let child = 0; child < 10; child += 1) {
        const childId = `child-${turn}-${child}`;
        delegation.report(session.id, {
          kind: 'child-start',
          childId,
          agentType: 'Explore',
          at: turn,
        });
        delegation.report(session.id, { kind: 'child-end', childId });
      }
      delegation.report(session.id, { kind: 'blocked', reason: 'permission' });
      delegation.report(session.id, {
        kind: 'unblocked',
        reason: 'permission',
      });
      delegation.report(session.id, { kind: 'turn-end' });
      boundaries.push(
        'harness.blocked',
        'harness.unblocked',
        'harness.turn-end'
      );
    }
    const events = lines(root).map(line => String(line.event));
    expect(events.filter(event => !event.startsWith('harness.child-'))).toEqual(
      ['session.start', ...boundaries]
    );
    // 800 child lines arrived; the team budget kept its own 120.
    expect(
      events.filter(event => event.startsWith('harness.child-'))
    ).toHaveLength(120);
    processes.at(-1)!.exit();
  });

  it('records every Session a quit stops, though node-pty reports none', async () => {
    const root = userData();
    const { sessions } = launch(root);
    for (const durableSessionId of ['quit-a', 'quit-b'])
      await sessions.ensureRunning({
        harness: 'claude',
        cwd: process.cwd(),
        durableSessionId,
      });
    await sessions.stopAll();
    expect(
      lines(root)
        .filter(line => line.event === 'session.exit')
        .map(line => [line.durableSessionId, line.stopRequested])
    ).toEqual([
      ['quit-a', true],
      ['quit-b', true],
    ]);
  });

  it('a harness storm cannot silence the process lifecycle', async () => {
    const root = userData();
    const { sessions, delegation } = launch(root);
    const { session } = await sessions.ensureRunning({
      harness: 'claude',
      cwd: process.cwd(),
    });
    for (let index = 0; index < 300; index += 1)
      delegation.report(session.id, { kind: 'turn-start' });
    processes.at(-1)!.exit(1);
    const events = lines(root).map(line => line.event);
    expect(events.filter(event => event === 'harness.turn-start')).toHaveLength(
      240
    );
    expect(events.at(-1)).toBe('session.exit');
  });
});
