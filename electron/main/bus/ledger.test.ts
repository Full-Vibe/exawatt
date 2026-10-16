import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MessageRecord } from '@exawatt/core';
import { JsonlBusStore } from './ledger';

const roots: string[] = [];
afterEach(() => {
  while (roots.length)
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function root(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-ledger-'));
  roots.push(dir);
  return dir;
}

function record(id: string, at: number, text = `message ${id}`): MessageRecord {
  const event = {
    state: 'queued' as const,
    reason: 'held',
    adapter: 'terminal-input',
    at,
  };
  return {
    id,
    projectId: '/work/app',
    from: {
      sessionId: 'session-a',
      name: 'codex-2',
      harness: 'codex',
      kind: 'agent',
    },
    to: { sessionId: 'session-b', name: 'claude-1', harness: 'claude' },
    at,
    text,
    delivery: event,
    history: [event],
  };
}

describe('JsonlBusStore', () => {
  it('reads an absent ledger as an empty one, and a written one back with its delivery history folded', async () => {
    const store = new JsonlBusStore(root());
    expect(await store.read('/work/app')).toEqual({ ok: true, records: [] });
    await store.append(record('m1', 1));
    await store.append(record('m2', 2));
    const delivered = {
      state: 'delivered' as const,
      adapter: 'terminal-input',
      at: 3,
    };
    await store.appendDelivery('/work/app', 'm1', delivered);
    const read = await store.read('/work/app');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.records.map(item => item.id)).toEqual(['m1', 'm2']);
    expect(read.records[0].delivery).toEqual(delivered);
    expect(read.records[0].history.map(event => event.state)).toEqual([
      'queued',
      'delivered',
    ]);
  });

  it('keeps one ledger per Project', async () => {
    const store = new JsonlBusStore(root());
    await store.append(record('m1', 1));
    expect(await store.read('/work/other')).toEqual({ ok: true, records: [] });
    expect(store.fileFor('/work/app')).not.toBe(store.fileFor('/work/other'));
  });

  it('fails loud on a damaged line, naming it, and never reads as empty', async () => {
    const store = new JsonlBusStore(root());
    await store.append(record('m1', 1));
    fs.appendFileSync(
      store.fileFor('/work/app'),
      '{"v":1,"type":"message","rec\n'
    );
    const read = await store.read('/work/app');
    expect(read).toEqual({
      ok: false,
      reason: expect.stringMatching(/damaged at line 2/),
    });
  });

  it('reads a torn final line (a crash mid-append) as the whole lines before it', async () => {
    const dir = root();
    const before = new JsonlBusStore(dir);
    await before.append(record('m1', 1));
    await before.append(record('m2', 2));
    const file = before.fileFor('/work/app');
    fs.appendFileSync(file, '{"v":1,"type":"message","record":{"id":"m3"');
    const read = await new JsonlBusStore(dir).read('/work/app');
    expect(read.ok && read.records.map(item => item.id)).toEqual(['m1', 'm2']);
  });

  it('repairs a torn final line on the next write: the torn bytes are kept aside, the log stays whole', async () => {
    const dir = root();
    const before = new JsonlBusStore(dir);
    await before.append(record('m1', 1));
    const file = before.fileFor('/work/app');
    const torn = '{"v":1,"type":"message","record":{"id":"m2"';
    fs.appendFileSync(file, torn);
    // The app restarts and logs again.
    const after = new JsonlBusStore(dir);
    await after.append(record('m3', 3));
    await after.appendDelivery('/work/app', 'm3', {
      state: 'delivered',
      adapter: 'terminal-input',
      at: 4,
    });
    const read = await after.read('/work/app');
    expect(read.ok && read.records.map(item => item.id)).toEqual(['m1', 'm3']);
    expect(read.ok && read.records[1].delivery.state).toBe('delivered');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    expect(lines.at(-1)).toBe('');
    expect(lines.slice(0, -1).every(line => JSON.parse(line))).toBeTruthy();
    expect(fs.readFileSync(`${file}.torn`, 'utf8')).toContain(torn);
  });

  it('ends a whole final line that only lost its newline, keeping it', async () => {
    const dir = root();
    const before = new JsonlBusStore(dir);
    await before.append(record('m1', 1));
    const file = before.fileFor('/work/app');
    fs.appendFileSync(
      file,
      JSON.stringify({ v: 1, type: 'message', record: record('m2', 2) })
    );
    const after = new JsonlBusStore(dir);
    await after.append(record('m3', 3));
    const read = await after.read('/work/app');
    expect(read.ok && read.records.map(item => item.id)).toEqual([
      'm1',
      'm2',
      'm3',
    ]);
  });

  it('prunes a ledger whose last write was torn', async () => {
    const bounds = { messages: 2, bytes: 1_000_000, lowWater: 0.5 };
    const dir = root();
    const before = new JsonlBusStore(dir, bounds);
    await before.append(record('m1', 1));
    await before.append(record('m2', 2));
    const file = before.fileFor('/work/app');
    fs.appendFileSync(file, '{"v":1,"type":"mess');
    const after = new JsonlBusStore(dir, bounds);
    await after.append(record('m3', 3));
    const read = await after.read('/work/app');
    expect(read.ok && read.records.map(item => item.id)).toEqual(['m3']);
  });

  it('prunes the oldest whole messages on write once over its count bound', async () => {
    const bounds = { messages: 8, bytes: 1_000_000, lowWater: 0.5 };
    const store = new JsonlBusStore(root(), bounds);
    for (let index = 1; index <= 9; index += 1) {
      await store.append(record(`m${index}`, index));
      await store.appendDelivery('/work/app', `m${index}`, {
        state: 'delivered',
        adapter: 'terminal-input',
        at: index + 0.5,
      });
    }
    const read = await store.read('/work/app');
    expect(read.ok && read.records.map(item => item.id)).toEqual([
      'm6',
      'm7',
      'm8',
      'm9',
    ]);
    // Each kept message kept its own delivery history, whole.
    expect(
      read.ok && read.records.every(item => item.history.length === 2)
    ).toBe(true);
    const lines = fs
      .readFileSync(store.fileFor('/work/app'), 'utf8')
      .split('\n');
    expect(lines.at(-1)).toBe('');
    expect(lines.slice(0, -1).every(line => JSON.parse(line))).toBeTruthy();
  });

  it('prunes on its byte bound too, and the file stays under it', async () => {
    const bounds = { messages: 1_000, bytes: 4_000, lowWater: 0.75 };
    const store = new JsonlBusStore(root(), bounds);
    for (let index = 1; index <= 30; index += 1)
      await store.append(record(`m${index}`, index, 'x'.repeat(200)));
    expect(fs.statSync(store.fileFor('/work/app')).size).toBeLessThanOrEqual(
      bounds.bytes
    );
    const read = await store.read('/work/app');
    expect(read.ok && read.records.at(-1)?.id).toBe('m30');
  });

  it('still fails loud on a damaged line in the middle, torn tail or not', async () => {
    const dir = root();
    const before = new JsonlBusStore(dir);
    await before.append(record('m1', 1));
    const file = before.fileFor('/work/app');
    fs.appendFileSync(file, 'not json\n');
    await before.append(record('m2', 2));
    fs.appendFileSync(file, '{"v":1,"ty');
    const read = await new JsonlBusStore(dir).read('/work/app');
    expect(read).toEqual({
      ok: false,
      reason: expect.stringMatching(/damaged at line 2/),
    });
  });

  it('never rewrites a damaged ledger to prune it', async () => {
    const bounds = { messages: 2, bytes: 1_000_000, lowWater: 0.5 };
    const store = new JsonlBusStore(root(), bounds);
    await store.append(record('m1', 1));
    fs.appendFileSync(store.fileFor('/work/app'), 'not json\n');
    await store.append(record('m2', 2));
    await store.append(record('m3', 3));
    const text = fs.readFileSync(store.fileFor('/work/app'), 'utf8');
    expect(text).toContain('not json');
    expect(text).toContain('"id":"m1"');
  });
});
