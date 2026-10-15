import { describe, expect, it } from 'vitest';
import type { PtySessionRecord } from '@exawatt/core/desktop-bridge';
import { BusDirectory } from './directory';

function session(id: string, overrides: Partial<PtySessionRecord> = {}) {
  return {
    id,
    durableSessionId: `session-${id}`,
    harness: 'claude',
    title: 'Claude Code',
    agentName: `claude-${id}`,
    projectDir: '/repo',
    projectName: 'repo',
    cwd: '/repo/packages/web',
    exited: false,
    ...overrides,
  } as PtySessionRecord;
}

describe('BusDirectory', () => {
  it('scopes an Agent to the Project its name was dealt in, not its git root', () => {
    const directory = new BusDirectory({
      list: () => [session('1'), session('2')],
      agentDirectory: () => [
        { durableSessionId: 'session-1', projectKey: '/repo/packages/web' },
        { durableSessionId: 'session-2', projectKey: '/repo' },
      ],
    });
    const scoped = directory
      .addressees()
      .map(item => [item.entry.sessionId, item.entry.projectId]);
    expect(scoped).toEqual([
      ['session-1', '/repo/packages/web'],
      ['session-2', '/repo'],
    ]);
    expect(directory.resolve('/repo/packages/web', '@claude-2')).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/another Project/),
    });
  });

  it('keeps one entry per durable Session, preferring the live process', () => {
    const directory = new BusDirectory({
      list: () => [
        session('1', { exited: true }),
        { ...session('1'), id: 'pty-9' },
      ],
    });
    expect(directory.addressees()).toHaveLength(1);
    expect(directory.addressees()[0].session.id).toBe('pty-9');
    expect(directory.byProcess('pty-9')?.entry.state).toBe('live');
  });

  it('never lists a shell tab', () => {
    const directory = new BusDirectory({
      list: () => [session('1', { harness: 'shell' })],
    });
    expect(directory.addressees()).toEqual([]);
  });
});
