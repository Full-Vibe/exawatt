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
        {
          durableSessionId: 'session-1',
          projectKey: '/repo/packages/web',
          harness: 'claude',
          name: 'claude-1',
        },
        {
          durableSessionId: 'session-2',
          projectKey: '/repo',
          harness: 'claude',
          name: 'claude-2',
        },
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

  it("reaches the sender's only same-harness peer by its family name", () => {
    const directory = new BusDirectory({
      list: () => [session('1'), session('2')],
    });
    expect(directory.resolve('/repo', '@claude', 'session-1')).toMatchObject({
      ok: true,
      addressee: { entry: { sessionId: 'session-2' } },
    });
    expect(directory.resolve('/repo', '@claude-1', 'session-1')).toMatchObject({
      ok: false,
      reason: 'That is you',
    });
  });

  it('addresses by the name record, not a copy the live row carries', () => {
    // The live row still wears the name it launched with; main moved the
    // record to another Project and dealt it a fresh name there.
    const directory = new BusDirectory({
      list: () => [session('1'), session('2', { agentName: 'claude-1' })],
      agentDirectory: () => [
        {
          durableSessionId: 'session-1',
          projectKey: '/repo',
          harness: 'claude',
          name: 'claude-1',
        },
        {
          durableSessionId: 'session-2',
          projectKey: '/repo',
          harness: 'claude',
          name: 'claude-2',
        },
      ],
    });
    expect(directory.resolve('/repo', '@claude-2')).toMatchObject({
      ok: true,
      addressee: { entry: { sessionId: 'session-2', name: 'claude-2' } },
    });
    expect(directory.resolve('/repo', '@claude-1')).toMatchObject({
      ok: true,
      addressee: { entry: { sessionId: 'session-1' } },
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
