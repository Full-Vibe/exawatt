import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createApplicationsPlacement,
  isOlderBuild,
  readInstalledCopy,
  watchInstalledBuild,
  type InstalledCopy,
} from './installed-build';

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

describe('the offer to move into Applications (BUG-305)', () => {
  const running = { version: '0.1.25', builtAt: '2026-10-21T12:00:00.000Z' };

  /** Electron's mover as the placement meets it: a boolean, a conflict
   *  callback it calls at most once, and a thrown error for a failed copy. */
  function mover(
    options: {
      inApplications?: boolean;
      conflict?: 'exists' | 'existsAndRunning';
      throws?: boolean;
    } = {}
  ) {
    const moves: Array<boolean | undefined> = [];
    return {
      moves,
      isInApplicationsFolder: () => options.inApplications ?? false,
      moveToApplicationsFolder: ({
        conflictHandler,
      }: {
        conflictHandler: (type: 'exists' | 'existsAndRunning') => boolean;
      }) => {
        if (options.throws) throw new Error('Failed to copy current bundle');
        if (!options.conflict) {
          moves.push(undefined);
          return true;
        }
        const proceed = conflictHandler(options.conflict);
        moves.push(proceed);
        return proceed && options.conflict === 'exists';
      },
    };
  }

  function placement(
    overrides: Partial<Parameters<typeof createApplicationsPlacement>[0]> = {}
  ) {
    const records: string[] = [];
    return {
      records,
      placement: createApplicationsPlacement({
        offered: true,
        bundlePath: '/Users/someone/Downloads/Exawatt.app',
        running,
        mover: mover(),
        installedCopy: () => 'absent',
        record: event => records.push(event),
        ...overrides,
      }),
    };
  }

  it('offers only an official build outside Applications', () => {
    expect(placement().placement.offer()).toEqual({
      location: '/Users/someone/Downloads/Exawatt.app',
    });
    expect(placement({ offered: false }).placement.offer()).toBeNull();
    expect(
      placement({ mover: mover({ inApplications: true }) }).placement.offer()
    ).toBeNull();
  });

  it('never offers to replace a newer copy, or one it cannot read', () => {
    const asked: string[] = [];
    const installed = (copy: InstalledCopy) =>
      placement({
        installedCopy: appPath => {
          asked.push(appPath);
          return copy;
        },
      }).placement.offer();
    expect(installed({ ...running, version: '0.1.24' })).not.toBeNull();
    expect(
      installed({ ...running, builtAt: '2026-10-20T12:00:00.000Z' })
    ).not.toBeNull();
    expect(installed(running)).toBeNull();
    expect(installed({ ...running, version: '0.1.30' })).toBeNull();
    expect(installed({ ...running, version: '0.2.0' })).toBeNull();
    expect(installed('unreadable')).toBeNull();
    expect(asked[0]).toBe('/Applications/Exawatt.app');
  });

  it('moves, replacing only an older copy that is not open', () => {
    const plain = mover();
    expect(placement({ mover: plain }).placement.move()).toBe('moving');

    const older = mover({ conflict: 'exists' });
    expect(placement({ mover: older }).placement.move()).toBe('moving');
    expect(older.moves).toEqual([true]);

    const open = mover({ conflict: 'existsAndRunning' });
    expect(placement({ mover: open }).placement.move()).toBe('other-copy-open');
    expect(open.moves).toEqual([false]);

    const { placement: failing, records } = placement({
      mover: mover({ throws: true }),
    });
    expect(failing.move()).toBe('failed');
    expect(records).toContain('placement.move-failed');

    const nothingToOffer = mover({ inApplications: true });
    expect(placement({ mover: nothingToOffer }).placement.move()).toBe(
      'not-moved'
    );
    expect(nothingToOffer.moves).toEqual([]);
  });

  it('compares builds by version, then by build time', () => {
    const at = (version: string, builtAt = running.builtAt) => ({
      version,
      builtAt,
    });
    expect(isOlderBuild(at('0.1.9'), at('0.1.10'))).toBe(true);
    expect(isOlderBuild(at('0.1.10'), at('0.1.9'))).toBe(false);
    expect(isOlderBuild(at('1.0.0'), at('0.9.9'))).toBe(false);
    expect(isOlderBuild(at('not a version'), at('0.1.0'))).toBe(false);
    expect(isOlderBuild(at('0.1.0', 'garbled'), at('0.1.0'))).toBe(false);
  });

  it('reads a copy that is absent, readable, or present but unreadable', () => {
    expect(readInstalledCopy(path.join(dir, 'Missing.app'))).toBe('absent');
    const bundle = path.join(dir, 'Exawatt.app');
    fs.mkdirSync(bundle);
    const files: Record<string, string> = {
      [path.join(bundle, 'Contents/Resources/app.asar/package.json')]:
        JSON.stringify({ version: '0.1.24' }),
      [path.join(
        bundle,
        'Contents/Resources/app.asar/dist-electron/build-info.json'
      )]: JSON.stringify({ builtAt: '2026-10-20T00:00:00.000Z' }),
    };
    expect(
      readInstalledCopy(bundle, file => {
        if (!(file in files)) throw new Error('ENOENT');
        return files[file];
      })
    ).toEqual({ version: '0.1.24', builtAt: '2026-10-20T00:00:00.000Z' });
    expect(readInstalledCopy(bundle)).toBe('unreadable');
  });
});
