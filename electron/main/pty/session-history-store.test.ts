import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SessionHistoryStore } from './session-history-store';
import { TranscriptWindow } from './transcript-window';

const roots: string[] = [];

async function store(): Promise<{ root: string; value: SessionHistoryStore }> {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'exawatt-history-')
  );
  roots.push(root);
  return { root, value: new SessionHistoryStore(root, 1) };
}

/** A live transcript, which is what the store now persists from. */
function live(text = '', limit = 4_000_000): TranscriptWindow {
  const window = new TranscriptWindow(limit);
  window.append(text);
  return window;
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
    value.queue('tab-one', live('prior output\n'), 42);
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

  it('keeps output produced during an in-flight flush', async () => {
    const { value } = await store();
    const window = live('one');
    value.queue('tab-one', window, 1);
    const flushing = value.flush();
    window.append('two');
    value.queue('tab-one', window, 2);
    await flushing;
    await value.flush();
    expect((await value.load('tab-one')).text).toBe('onetwo');
  });

  it('serializes overlapping flushes onto one consistent file', async () => {
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
      const window = live('old');
      value.queue('tab-one', window, 1);
      const older = value.flush();
      await renameStarted;
      window.append('new');
      value.queue('tab-one', window, 2);
      const newer = value.flush();
      release();
      await Promise.all([older, newer]);
      // The store no longer holds a copy of any Session's transcript, so a
      // stale snapshot cannot exist to win the race; ordering is all that is
      // left to prove.
      expect((await value.load('tab-one')).text).toBe('oldnew');
      expect(
        (await fs.promises.readdir(root)).some(name => name.includes('.tmp-'))
      ).toBe(false);
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
      value.queue('tab-one', live('output'), 1);
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
    const window = live('x'.repeat(4_000_000));
    value.queue('busy', window, 1);
    await value.flush();
    const snapshot = path.join(root, 'busy.json');
    const initialMtime = (await fs.promises.stat(snapshot)).mtimeMs;

    for (let index = 0; index < 20; index += 1) {
      window.append(`${index}`.padEnd(1024, 'y'));
      value.queue('busy', window, index + 2);
      await value.flush();
    }

    expect((await fs.promises.stat(snapshot)).mtimeMs).toBe(initialMtime);
    expect(
      (await fs.promises.stat(path.join(root, 'busy.journal'))).size
    ).toBeLessThan(30_000);
    await expect(value.load('busy')).resolves.toMatchObject({
      text: window.text(),
      cursor: window.cursor,
    });
  });

  it('journals every character when output arrives during a write', async () => {
    // The PTY does not stop while a journal record is being written, and the
    // store persists from the LIVE window. Anything read after the write's
    // await describes a later moment, and recording a cursor ahead of what was
    // journalled leaves a gap that replays as corrupt history.
    const { value } = await store();
    const window = live('start\n');
    value.queue('busy', window, 1);
    await value.flush();

    const original = fs.promises.appendFile.bind(fs.promises);
    const appendFile = vi
      .spyOn(fs.promises, 'appendFile')
      .mockImplementation(async (...args) => {
        const result = await original(...(args as Parameters<typeof original>));
        window.append('during the write\n');
        return result;
      });
    try {
      for (const line of ['first\n', 'second\n', 'third\n']) {
        window.append(line);
        value.queue('busy', window, 2);
        await value.flush();
      }
    } finally {
      appendFile.mockRestore();
    }
    value.queue('busy', window, 3);
    await value.flush();

    const reloaded = await value.load('busy');
    expect(reloaded.corrupt).toBe(false);
    expect(reloaded.cursor).toBe(window.cursor);
    expect(reloaded.text).toBe(window.text());
  });

  it('round-trips a long trimmed transcript through snapshot and journal', async () => {
    const { value } = await store();
    const limit = 20_000;
    const window = live('', limit);
    let seed = 20260816;
    const random = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed / 4294967296;
    };
    for (let turn = 0; turn < 200; turn += 1) {
      for (let chunk = 0; chunk < 1 + Math.floor(random() * 6); chunk += 1) {
        let data = '';
        for (let index = 0; index < 1 + Math.floor(random() * 900); index++) {
          const roll = random();
          data +=
            roll < 0.06
              ? '\n'
              : roll < 0.09
                ? '\r'
                : String.fromCharCode(32 + Math.floor(random() * 90));
        }
        window.append(data);
        value.queue('noisy', window, turn + 1);
      }
      await value.flush();
    }
    const reloaded = await value.load('noisy');
    expect(reloaded.corrupt).toBe(false);
    // Saturated and trimmed many times over: the head sits just after a
    // newline, so retention lands a little under the limit rather than on it.
    expect(window.length).toBeGreaterThan(limit - 4096);
    expect(window.length).toBeLessThanOrEqual(limit);
    expect(reloaded.cursor).toBe(window.cursor);
    expect(reloaded.text).toBe(window.text());
  });

  it('rewrites the snapshot when the live transcript is not a continuation', async () => {
    const { value } = await store();
    value.queue('tab-one', live('first run output\n'), 1);
    await value.flush();
    // A window that restarted at zero shares neither cursor nor content.
    value.queue('tab-one', live('second run\n'), 2);
    await value.flush();
    await expect(value.load('tab-one')).resolves.toMatchObject({
      text: 'second run\n',
      cursor: 11,
    });
  });

  it('isolates malformed records and deletes only the selected Session', async () => {
    const { root, value } = await store();
    await value.initialize();
    await fs.promises.writeFile(path.join(root, 'broken.json'), '{nope', {
      mode: 0o600,
    });
    value.queue('healthy', live('ok'), 1);
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
    value.queue('sess-a', live('x'.repeat(200_000)), 1_000);
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
    value.queue('slow', live('y'.repeat(400_000)), 1);
    value.queue('quick', live('ok'), 1);
    await value.flush();

    const [slow, quick] = await Promise.all([
      value.load('slow'),
      value.load('quick'),
    ]);
    expect(slow.text).toHaveLength(400_000);
    expect(quick.text).toBe('ok');
  });
});

// ── ENG-016 BUG-023, incident 0008: resume replays the journal, and replay
// must cost the journal's BYTES. The previous representation rebuilt the whole
// retained window once per record, so a chatty Session was far more expensive
// to resume than a loud one — 10,018 records at the 4 MB cap on the operator's
// own disk, which is ~80 GB of copying for one Resume.
describe('journal replay cost', () => {
  const WINDOW = 2_000_000;

  /**
   * Write a journal arithmetically. Building it by simulating the old string
   * rebuild would itself cost records x window, which is the bug.
   */
  async function journal(
    root: string,
    id: string,
    records: number,
    delta: number
  ): Promise<string> {
    const seed = 'z'.repeat(WINDOW);
    await fs.promises.writeFile(
      path.join(root, `${id}.json`),
      JSON.stringify({ v: 1, text: seed, cursor: WINDOW, updatedAt: 1 })
    );
    const lines: string[] = [];
    let cursor = WINDOW;
    let tail = '';
    for (let index = 0; index < records; index += 1) {
      const text = `${index}`.padEnd(delta, 'q').slice(0, delta);
      lines.push(
        `${JSON.stringify({
          v: 1,
          fromCursor: cursor,
          cursor: cursor + delta,
          retainedLength: WINDOW,
          text,
          updatedAt: index + 2,
        })}\n`
      );
      cursor += delta;
      tail += text;
    }
    await fs.promises.writeFile(
      path.join(root, `${id}.journal`),
      lines.join('')
    );
    return (seed + tail).slice(-WINDOW);
  }

  it('replays in time proportional to journal bytes, not records x window', async () => {
    const { root, value } = await store();
    await value.initialize();
    const bytes = 100_000;
    const expectedFew = await journal(root, 'few', 50, bytes / 50);
    const expectedMany = await journal(root, 'many', 4_000, bytes / 4_000);

    const beforeFew = performance.now();
    expect((await value.load('few')).text).toBe(expectedFew);
    const few = performance.now() - beforeFew;

    const beforeMany = performance.now();
    expect((await value.load('many')).text).toBe(expectedMany);
    const many = performance.now() - beforeMany;

    // Same delta bytes, 80x the records. The string representation copied the
    // 2 MB window per record, so `many` cost ~8 GB against `few`'s ~100 MB and
    // this ratio was ~80. Anything near 1 means replay follows the bytes.
    expect(many).toBeLessThan(Math.max(few * 8, 400));
  }, 120_000);
});
