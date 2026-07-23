import { mkdtemp, readFile, stat } from 'fs/promises';
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
