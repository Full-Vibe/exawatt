import { describe, expect, it, vi } from 'vitest';
import { createSessionPauser } from './session-pause';
import type { PtySessionInfo } from './session-manager';

function fixture() {
  const sessions = new Map<string, PtySessionInfo>(
    ['one', 'two'].map(durableSessionId => [
      durableSessionId,
      {
        durableSessionId,
        id: `runtime-${durableSessionId}`,
        harness: 'claude',
        exited: false,
        harnessSessionId: `conversation-${durableSessionId}`,
      } as PtySessionInfo,
    ])
  );
  const active = new Set<string>();
  const stop = vi.fn(async (id: string) => {
    const session = [...sessions.values()].find(item => item.id === id)!;
    session.exited = true;
  });
  const release = vi.fn();
  const prepare = vi.fn(async (id: string) => ({
    stop: () => stop(id),
    release,
  }));
  const pause = createSessionPauser({
    session: id => sessions.get(id),
    active: id => active.has(id),
    prepare,
  });
  return { sessions, active, stop, pause, prepare, release };
}

describe('Project pause boundary', () => {
  it('requires confirmation for the entire batch before stopping any member', async () => {
    const f = fixture();
    f.active.add('runtime-two');
    expect(await f.pause(['one', 'two'])).toEqual({
      kind: 'needs-confirmation',
      activeSessionIds: ['two'],
    });
    expect(f.stop).not.toHaveBeenCalled();
    const result = await f.pause(['one', 'two'], true);
    expect(result).toEqual({
      kind: 'completed',
      results: ['one', 'two'].map(durableSessionId => ({
        durableSessionId,
        status: 'paused',
      })),
    });
  });
  it('pauses idle members without confirmation and deduplicates selection', async () => {
    const f = fixture();
    await f.pause(['one', 'one']);
    expect(f.stop).toHaveBeenCalledTimes(1);
    expect(f.sessions.get('two')?.exited).toBe(false);
  });
  it('settles the whole batch before stopping any member and releases locks on confirmation', async () => {
    const f = fixture();
    let finish!: () => void;
    const settled = new Promise<void>(resolve => {
      finish = resolve;
    });
    f.prepare.mockImplementationOnce(async id => {
      await settled;
      f.active.add('runtime-one');
      return { stop: () => f.stop(id), release: f.release };
    });
    const result = f.pause(['one', 'two']);
    await Promise.resolve();
    expect(f.stop).not.toHaveBeenCalled();
    finish();
    expect(await result).toEqual({
      kind: 'needs-confirmation',
      activeSessionIds: ['one'],
    });
    expect(f.stop).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledTimes(2);
  });
  it('does not stop a replacement incarnation using stale selection', async () => {
    const f = fixture();
    f.prepare.mockImplementationOnce(async id => {
      f.sessions.set('one', { ...f.sessions.get('one')!, id: 'replacement' });
      return { stop: () => f.stop(id), release: f.release };
    });
    expect(await f.pause(['one'], true)).toMatchObject({
      kind: 'completed',
      results: [{ status: 'failed' }],
    });
  });
  it('reports per-member outcomes without treating shells, remote or missing identities as paused', async () => {
    const f = fixture();
    f.sessions.get('one')!.harness = 'shell';
    f.sessions.get('two')!.exited = true;
    expect(await f.pause(['one', 'two', 'remote'])).toMatchObject({
      kind: 'completed',
      results: [
        { status: 'unsupported' },
        { status: 'already-paused' },
        { status: 'unsupported' },
      ],
    });
    expect(f.stop).not.toHaveBeenCalled();
  });
  it('isolates failures and preserves successful member results', async () => {
    const f = fixture();
    f.stop.mockRejectedValueOnce(new Error('No saved identity'));
    expect(await f.pause(['one', 'two'])).toMatchObject({
      kind: 'completed',
      results: [
        { status: 'failed', error: 'No saved identity' },
        { status: 'paused' },
      ],
    });
  });
});
