import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { watchInstalledBuild } from './installed-build';

let dir: string;
let statePath: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'installed-build-'));
  statePath = path.join(dir, 'update-state.json');
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function windows() {
  const sent: unknown[][] = [];
  const open = {
    isDestroyed: () => false,
    webContents: { send: (...args: unknown[]) => sent.push(args) },
  };
  const closed = {
    isDestroyed: () => true,
    webContents: { send: () => sent.push(['to a destroyed window']) },
  };
  return { sent, all: () => [open, closed] };
}

describe('watchInstalledBuild', () => {
  it('tells every open window when a different build is installed', async () => {
    fs.writeFileSync(statePath, JSON.stringify({ installedSha: 'newer' }));
    const { sent, all } = windows();

    const watch = watchInstalledBuild({
      statePath,
      currentSha: 'running',
      allWindows: all,
    });
    await watch.check();
    watch.stop();

    expect(sent[0]).toEqual([
      'app:update-ready',
      { currentSha: 'running', installedSha: 'newer' },
    ]);
    expect(sent).not.toContainEqual(['to a destroyed window']);
  });

  it('stays quiet when the installed build is the running one, or nothing is recorded', async () => {
    const { sent, all } = windows();
    const absent = watchInstalledBuild({
      statePath,
      currentSha: 'running',
      allWindows: all,
    });
    await absent.check();
    absent.stop();

    fs.writeFileSync(statePath, JSON.stringify({ installedSha: 'running' }));
    const same = watchInstalledBuild({
      statePath,
      currentSha: 'running',
      allWindows: all,
    });
    await same.check();
    same.stop();

    fs.writeFileSync(statePath, '{not json');
    const unreadable = watchInstalledBuild({
      statePath,
      currentSha: 'running',
      allWindows: all,
    });
    await unreadable.check();
    unreadable.stop();

    expect(sent).toEqual([]);
  });
});
