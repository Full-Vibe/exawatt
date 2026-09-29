import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { SessionIdentityStore } from './session-identity-store';

describe('SessionIdentityStore', () => {
  it('atomically preserves exact identities across main-process restarts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'exawatt-identities-'));
    const file = path.join(root, 'session-identities.json');
    const first = new SessionIdentityStore(file);
    await first.initialize();
    await first.remember({
      durableSessionId: 'session-one',
      harness: 'codex',
      harnessSessionId: 'provider-one',
      cwd: '/project',
    });

    const second = new SessionIdentityStore(file);
    await second.initialize();
    expect(second.get('session-one')).toMatchObject({
      durableSessionId: 'session-one',
      harness: 'codex',
      harnessSessionId: 'provider-one',
      cwd: '/project',
    });
    expect(JSON.parse(await readFile(file, 'utf8')).v).toBe(1);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('serializes overlapping writes and deletes without resurrecting entries', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'exawatt-identities-'));
    const file = path.join(root, 'session-identities.json');
    const store = new SessionIdentityStore(file);
    await Promise.all([
      store.remember({
        durableSessionId: 'session-one',
        harness: 'codex',
        harnessSessionId: 'provider-one',
        cwd: '/project',
      }),
      store.remember({
        durableSessionId: 'session-two',
        harness: 'claude',
        harnessSessionId: 'provider-two',
        cwd: '/project',
      }),
    ]);
    await store.delete('session-one');
    await store.flush();

    const reloaded = new SessionIdentityStore(file);
    await reloaded.initialize();
    expect(reloaded.get('session-one')).toBeNull();
    expect(reloaded.get('session-two')?.harnessSessionId).toBe('provider-two');
  });
});

describe('SessionIdentityStore persistence failures (BUG-247)', () => {
  const identity = (durableSessionId: string, harnessSessionId: string) => ({
    durableSessionId,
    harness: 'codex' as const,
    harnessSessionId,
    cwd: '/project',
  });

  async function seeded(...ids: string[]): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'exawatt-identities-'));
    const file = path.join(root, 'session-identities.json');
    const store = new SessionIdentityStore(file);
    for (const id of ids) await store.remember(identity(id, `provider-${id}`));
    return file;
  }

  it('never writes over a file it cannot read, and merges into it once it can', async () => {
    const file = await seeded('kept', 'deleted');
    const saved = await readFile(file);
    await chmod(file, 0o000);
    try {
      const store = new SessionIdentityStore(file);
      await store.initialize();
      expect(store.list()).toEqual([]);
      await store.remember(identity('added', 'provider-added'));
      await store.delete('deleted');
      await store.flush();
      await chmod(file, 0o600);
      expect(await readFile(file)).toEqual(saved);

      // The next access reads again and writes the merge.
      await store.flush();
      const reloaded = new SessionIdentityStore(file);
      await reloaded.initialize();
      expect(
        reloaded
          .list()
          .map(record => record.durableSessionId)
          .sort()
      ).toEqual(['added', 'kept']);
    } finally {
      await chmod(file, 0o600);
    }
  });

  it.each([
    ['unparsable JSON', '{"v":1,"identities":['],
    ['an unknown version', JSON.stringify({ v: 2, identities: [] })],
    [
      'a record this build cannot read',
      JSON.stringify({
        v: 1,
        identities: [
          { ...identity('future', 'provider-future'), harness: 'x' },
        ],
      }),
    ],
  ])('sets %s aside with its bytes and starts fresh', async (_label, text) => {
    const root = await mkdtemp(path.join(tmpdir(), 'exawatt-identities-'));
    const file = path.join(root, 'session-identities.json');
    await writeFile(file, text);
    const store = new SessionIdentityStore(file);
    await store.initialize();
    expect(store.list()).toEqual([]);
    const [aside] = (await readdir(root)).filter(name =>
      name.startsWith('session-identities.json.corrupt-')
    );
    expect(aside).toBeDefined();
    expect(await readFile(path.join(root, aside), 'utf8')).toBe(text);
    expect((await stat(path.join(root, aside))).mode & 0o777).toBe(0o600);

    await store.remember(identity('fresh', 'provider-fresh'));
    expect(JSON.parse(await readFile(file, 'utf8')).identities).toHaveLength(1);
  });

  it('starts empty from a missing file and writes nothing until a change', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'exawatt-identities-'));
    const store = new SessionIdentityStore(
      path.join(root, 'session-identities.json')
    );
    await store.initialize();
    await store.flush();
    expect(store.list()).toEqual([]);
    expect(await readdir(root)).toEqual([]);
  });
});
