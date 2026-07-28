import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HookSettingsStore } from './hook-settings-store';

/**
 * The injected settings file (ENG-023 D1). It carries a live channel token, so
 * its location and permissions are part of the security story, not incidental.
 */

let root: string;
let store: HookSettingsStore;

beforeEach(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'exawatt-hooks-'));
  store = new HookSettingsStore(path.join(root, 'harness-events'));
  await store.initialize();
});

afterEach(async () => {
  await fs.promises.rm(root, { recursive: true, force: true });
});

describe('HookSettingsStore', () => {
  it('writes owner-only, inside Exawatt state, never the user harness config', async () => {
    const target = await store.write('pty-1', '{"hooks":{}}');
    expect(target).toBe(path.join(root, 'harness-events', 'pty-1.json'));
    expect(await fs.promises.readFile(target!, 'utf8')).toBe('{"hooks":{}}');
    const mode = (await fs.promises.stat(target!)).mode & 0o777;
    expect(mode).toBe(0o600);
    // nothing may be written outside the store's own directory
    expect(await fs.promises.readdir(root)).toEqual(['harness-events']);
  });

  it('rewrites a reused id and keeps owner-only permissions', async () => {
    const first = await store.write('pty-1', '{"a":1}');
    await fs.promises.chmod(first!, 0o644);
    const second = await store.write('pty-1', '{"b":2}');
    expect(second).toBe(first);
    expect(await fs.promises.readFile(second!, 'utf8')).toBe('{"b":2}');
    expect((await fs.promises.stat(second!)).mode & 0o777).toBe(0o600);
  });

  it('removes a launch file, and removing twice is fine', async () => {
    const target = await store.write('pty-1', '{}');
    await store.remove('pty-1');
    await store.remove('pty-1');
    expect(fs.existsSync(target!)).toBe(false);
  });

  it('sweeps residue from a previous run', async () => {
    // Old tokens are already meaningless — the channel mints fresh ones and
    // binds a fresh port — so leaving them on disk is pure residue.
    await store.write('pty-1', '{}');
    await store.write('pty-2', '{}');
    const next = new HookSettingsStore(path.join(root, 'harness-events'));
    await next.initialize();
    expect(
      await fs.promises.readdir(path.join(root, 'harness-events'))
    ).toEqual([]);
  });

  it('refuses a session id that could escape the directory', async () => {
    expect(await store.write('../escape', '{}')).toBeNull();
    expect(await store.write('a/b', '{}')).toBeNull();
    expect(await store.write('', '{}')).toBeNull();
    expect(
      await fs.promises.readdir(path.join(root, 'harness-events'))
    ).toEqual([]);
  });

  it('returns null instead of throwing when the write cannot happen', async () => {
    const blocked = new HookSettingsStore(path.join(root, 'missing', 'deep'));
    // no initialize(): the directory does not exist, so the launch simply
    // proceeds unsubscribed rather than failing
    expect(await blocked.write('pty-1', '{}')).toBeNull();
  });
});
