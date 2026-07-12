import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SessionHistoryStore } from './session-history-store';

const roots: string[] = [];

async function store(): Promise<{ root: string; value: SessionHistoryStore }> {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'exawatt-history-')
  );
  roots.push(root);
  return { root, value: new SessionHistoryStore(root, 1) };
}

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map(root => fs.promises.rm(root, { recursive: true, force: true }))
  );
});

describe('SessionHistoryStore', () => {
  it('atomically persists a versioned snapshot with private permissions', async () => {
    const { root, value } = await store();
    value.queue('tab-one', {
      text: 'prior output\n',
      cursor: 13,
      updatedAt: 42,
    });
    await value.flush();

    await expect(value.load('tab-one')).resolves.toEqual({
      text: 'prior output\n',
      cursor: 13,
      updatedAt: 42,
      corrupt: false,
    });
    expect((await fs.promises.stat(root)).mode & 0o777).toBe(0o700);
    expect(
      (await fs.promises.stat(path.join(root, 'tab-one.json'))).mode & 0o777
    ).toBe(0o600);
    expect(
      (await fs.promises.readdir(root)).some(name => name.includes('.tmp-'))
    ).toBe(false);
  });

  it('keeps the newest snapshot queued during an in-flight flush', async () => {
    const { value } = await store();
    value.queue('tab-one', { text: 'one', cursor: 3, updatedAt: 1 });
    const flushing = value.flush();
    value.queue('tab-one', { text: 'two', cursor: 3, updatedAt: 2 });
    await flushing;
    await value.flush();
    expect((await value.load('tab-one')).text).toBe('two');
  });

  it('isolates malformed records and deletes only the selected Session', async () => {
    const { root, value } = await store();
    await value.initialize();
    await fs.promises.writeFile(path.join(root, 'broken.json'), '{nope', {
      mode: 0o600,
    });
    value.queue('healthy', { text: 'ok', cursor: 2, updatedAt: 1 });
    await value.flush();

    expect((await value.load('broken')).corrupt).toBe(true);
    expect((await value.load('healthy')).text).toBe('ok');
    await value.delete('healthy');
    expect((await value.load('healthy')).text).toBe('');
    expect((await value.load('broken')).corrupt).toBe(true);
  });

  it('rejects path-like Session IDs', async () => {
    const { value } = await store();
    await expect(value.load('../escape')).rejects.toThrow(
      'Invalid durable Session ID'
    );
  });
});
