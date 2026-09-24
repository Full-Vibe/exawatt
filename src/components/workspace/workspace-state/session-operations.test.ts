import { describe, expect, it } from 'vitest';
import { SessionOperations } from './session-operations';
import type { ObservedExit, Project, SessionTab } from './workspace-model';

const tab = (id: string): SessionTab => ({
  kind: 'session',
  id,
  durableSessionId: `durable-${id}`,
  harness: 'claude',
  title: 'Claude Code',
  titleKind: 'default',
  cwd: '/repo',
  sessionId: `pty-${id}`,
  harnessSessionId: 'conversation',
  resumeState: 'live',
  lifecycle: 'running',
  exitCode: null,
  roadmapItemId: null,
  initialTask: null,
});

const layout: Project[] = [
  {
    dir: '/repo',
    name: 'repo',
    color: '#111111',
    tabs: [tab('a'), tab('b')],
    activeTabId: 'a',
  },
];

function ledger() {
  const exits = { current: new Map<string, Record<string, ObservedExit>>() };
  return { operations: new SessionOperations(exits), exits };
}

const exit = (id: string, durableSessionId: string, exitCode = 0) => ({
  id,
  durableSessionId,
  exitCode,
  exitSignal: null,
});

describe('SessionOperations', () => {
  it('admits one operation per tab until it ends', () => {
    const { operations } = ledger();
    expect(operations.isBusy('a')).toBe(false);
    operations.begin('a');
    expect(operations.isBusy('a')).toBe(true);
    expect(operations.isBusy('b')).toBe(false);
    operations.end('a', 'durable-a');
    expect(operations.isBusy('a')).toBe(false);
  });

  it('keeps an exit that beat the reply, by incarnation, while the operation runs', () => {
    const { operations } = ledger();
    operations.begin('a');
    operations.recordExit(layout, exit('pty-old', 'durable-a', 1));
    operations.recordExit(layout, exit('pty-new', 'durable-a', 7));
    expect(operations.observedExit('durable-a', 'pty-new')).toEqual({
      exitCode: 7,
      exitSignal: null,
    });
    expect(operations.observedExit('durable-a', 'pty-old')?.exitCode).toBe(1);
  });

  it('ignores exits for Sessions with nothing in flight', () => {
    const { operations, exits } = ledger();
    operations.begin('a');
    operations.recordExit(layout, exit('pty-b', 'durable-b'));
    expect(operations.observedExit('durable-b', 'pty-b')).toBeUndefined();
    expect(exits.current.size).toBe(0);
  });

  it('spends the raced exits when the operation ends', () => {
    const { operations } = ledger();
    operations.begin('a');
    operations.recordExit(layout, exit('pty-new', 'durable-a'));
    operations.end('a', 'durable-a');
    expect(operations.observedExit('durable-a', 'pty-new')).toBeUndefined();
  });

  it('reads exits through the owner’s map, so a release there is seen here', () => {
    const { operations, exits } = ledger();
    operations.begin('a');
    operations.recordExit(layout, exit('pty-new', 'durable-a'));
    exits.current.delete('durable-a');
    expect(operations.observedExit('durable-a', 'pty-new')).toBeUndefined();
  });
});
