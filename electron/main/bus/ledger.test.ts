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
