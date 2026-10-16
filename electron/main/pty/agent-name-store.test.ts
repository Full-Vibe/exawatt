import { mkdtemp, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { AgentNameStore, isAgentNameRequest } from './agent-name-store';

async function storeFile(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-agent-names-'));
  return path.join(root, 'agent-names.json');
}

describe('AgentNameStore', () => {
  it('keeps a dealt name across a main-process restart', async () => {
    const file = await storeFile();
    const first = new AgentNameStore(file);
    await first.ensure([
      { durableSessionId: 'session-a', projectKey: '/p', harness: 'codex' },
    ]);
    const second = new AgentNameStore(file);
    const {
      records: [again],
    } = await second.ensure([
      { durableSessionId: 'session-a', projectKey: '/p', harness: 'codex' },
    ]);
    expect(again?.name).toBe('codex-1');
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
      v: 1,
      names: [{ durableSessionId: 'session-a', name: 'codex-1' }],
    });
  });

  it('never deals one name to two concurrent launches', async () => {
    const store = new AgentNameStore(await storeFile());
    const launches = await Promise.all(
      ['a', 'b', 'c'].map(id =>
        store.ensure([
          {
            durableSessionId: `session-${id}`,
            projectKey: '/p',
            harness: 'claude',
          },
        ])
      )
    );
    expect(
      launches.map(({ records: [record] }) => record?.name).sort()
    ).toEqual(['claude-1', 'claude-2', 'claude-3']);
  });

  it('persists a rename and refuses a taken name with the reason', async () => {
    const file = await storeFile();
    const store = new AgentNameStore(file);
    await store.ensure([
      { durableSessionId: 'session-a', projectKey: '/p', harness: 'claude' },
      { durableSessionId: 'session-b', projectKey: '/p', harness: 'codex' },
    ]);
    expect(await store.rename('session-a', 'codex-1')).toMatchObject({
      ok: false,
      code: 'taken',
    });
    expect(await store.rename('session-a', 'lead')).toMatchObject({ ok: true });
    await store.flush();
    const reloaded = new AgentNameStore(file);
    await reloaded.initialize();
    expect(reloaded.get('session-a')).toMatchObject({
      name: 'lead',
      origin: 'operator',
    });
  });

  it('frees the name when the Session is deleted', async () => {
    const store = new AgentNameStore(await storeFile());
    await store.ensure([
      { durableSessionId: 'session-a', projectKey: '/p', harness: 'claude' },
    ]);
    await store.delete('session-a');
    const {
      records: [next],
    } = await store.ensure([
      { durableSessionId: 'session-b', projectKey: '/p', harness: 'claude' },
    ]);
    expect(next?.name).toBe('claude-1');
  });

  it('skips requests whose ids could not be persisted', async () => {
    const store = new AgentNameStore(await storeFile());
    const answer = await store.ensure([
      { durableSessionId: '../escape', projectKey: '/p', harness: 'claude' },
      { durableSessionId: 'session-a', projectKey: '', harness: 'claude' },
    ]);
    expect(answer.records).toEqual([]);
    expect(answer.skipped.map(skip => skip.durableSessionId)).toEqual([
      '../escape',
      'session-a',
    ]);
    expect(isAgentNameRequest({ durableSessionId: 'x' })).toBe(false);
    expect(
      isAgentNameRequest({
        durableSessionId: 'x',
        projectKey: '/p',
        harness: 'claude',
        preferredName: null,
      })
    ).toBe(true);
  });
});
