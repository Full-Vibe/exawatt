import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('serializes overlapping flushes so an older snapshot cannot win', async () => {
    const { value } = await store();
    const originalRename = fs.promises.rename.bind(fs.promises);
    let release!: () => void;
    const blocked = new Promise<void>(resolve => {
      release = resolve;
    });
    let markRenameStarted!: () => void;
    const renameStarted = new Promise<void>(resolve => {
      markRenameStarted = resolve;
    });
    let first = true;
    const rename = vi
      .spyOn(fs.promises, 'rename')
      .mockImplementation(async (...args) => {
        if (first) {
          first = false;
          markRenameStarted();
          await blocked;
        }
        return originalRename(...args);
      });
    try {
      value.queue('tab-one', { text: 'old', cursor: 3, updatedAt: 1 });
      const older = value.flush();
      await renameStarted;
      value.queue('tab-one', { text: 'new', cursor: 3, updatedAt: 2 });
      const newer = value.flush();
      release();
      await Promise.all([older, newer]);
      expect((await value.load('tab-one')).text).toBe('new');
    } finally {
      rename.mockRestore();
    }
  });

  it('orders deletion after an in-flight write and cannot resurrect history', async () => {
    const { root, value } = await store();
    const originalRename = fs.promises.rename.bind(fs.promises);
    let release!: () => void;
    const blocked = new Promise<void>(resolve => {
      release = resolve;
    });
    let markRenameStarted!: () => void;
    const renameStarted = new Promise<void>(resolve => {
      markRenameStarted = resolve;
    });
    const rename = vi
      .spyOn(fs.promises, 'rename')
      .mockImplementationOnce(async (...args) => {
        markRenameStarted();
        await blocked;
        return originalRename(...args);
      });
    try {
      value.queue('tab-one', { text: 'output', cursor: 6, updatedAt: 1 });
      const flushing = value.flush();
      await renameStarted;
      const deleting = value.delete('tab-one');
      release();
      await Promise.all([flushing, deleting]);
      expect(await fs.promises.readdir(root)).not.toContain('tab-one.json');
      expect((await value.load('tab-one')).text).toBe('');
    } finally {
      rename.mockRestore();
    }
  });

  it('journals incremental output instead of rewriting the full snapshot', async () => {
    const { root, value } = await store();
    let text = 'x'.repeat(4_000_000);
    let cursor = text.length;
    value.queue('busy', { text, cursor, updatedAt: 1 });
    await value.flush();
    const snapshot = path.join(root, 'busy.json');
    const initialMtime = (await fs.promises.stat(snapshot)).mtimeMs;

    for (let index = 0; index < 20; index += 1) {
      const delta = `${index}`.padEnd(1024, 'y');
      cursor += delta.length;
      text = (text + delta).slice(-4_000_000);
      value.queue('busy', { text, cursor, updatedAt: index + 2 });
      await value.flush();
    }

    expect((await fs.promises.stat(snapshot)).mtimeMs).toBe(initialMtime);
    expect(
      (await fs.promises.stat(path.join(root, 'busy.journal'))).size
    ).toBeLessThan(30_000);
    await expect(value.load('busy')).resolves.toMatchObject({ text, cursor });
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

// ── ENG-016 BUG-012 / incident 0008: the interaction path must not read the
// transcript, and one Session's transcript must not stall another's.
describe('history metadata and per-Session serialization', () => {
  it('describes a paused Session without parsing its transcript', async () => {
    const { value } = await store();
    await value.initialize();
    value.queue('sess-a', {
      text: 'x'.repeat(200_000),
      cursor: 200_000,
      updatedAt: 1_000,
    });
    await value.flush();

    const meta = await value.meta('sess-a');
    expect(meta.exists).toBe(true);
    expect(meta.bytes).toBeGreaterThan(100_000);
    expect(meta.updatedAt).toBeGreaterThan(0);

    expect(await value.meta('sess-never')).toEqual({
      bytes: 0,
      updatedAt: 0,
      exists: false,
    });
  });

  it('serializes per Session, so one transcript cannot block another', async () => {
    const { value } = await store();
    await value.initialize();
    value.queue('slow', {
      text: 'y'.repeat(400_000),
      cursor: 400_000,
      updatedAt: 1,
    });
    value.queue('quick', { text: 'ok', cursor: 2, updatedAt: 1 });
    await value.flush();

    const [slow, quick] = await Promise.all([
      value.load('slow'),
      value.load('quick'),
    ]);
    expect(slow.text).toHaveLength(400_000);
    expect(quick.text).toBe('ok');
  });
});
