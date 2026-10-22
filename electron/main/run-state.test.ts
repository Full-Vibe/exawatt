import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RunStateStore } from './run-state';

const roots: string[] = [];

async function fixture(): Promise<{ file: string; root: string }> {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'exawatt-run-')
  );
  roots.push(root);
  return { root, file: path.join(root, 'run-state.json') };
}

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map(root => fs.promises.rm(root, { recursive: true, force: true }))
  );
});

const VERSION = '0.2.0';
const nothingLeft = { heldState: null, installFailure: null };
const after = { kind: 'recorded', version: VERSION } as const;

describe('RunStateStore', () => {
  it('distinguishes first, interrupted, and clean runs', async () => {
    const { file } = await fixture();
    const first = new RunStateStore(file, VERSION);
    await expect(first.begin()).resolves.toEqual({
      previousRunInterrupted: false,
      ...nothingLeft,
      previousVersion: { kind: 'none' },
    });

    const afterCrash = new RunStateStore(file, VERSION);
    await expect(afterCrash.begin()).resolves.toEqual({
      previousRunInterrupted: true,
      ...nothingLeft,
      previousVersion: after,
    });
    await afterCrash.markClean('quit');

    const afterClean = new RunStateStore(file, VERSION);
    await expect(afterClean.begin()).resolves.toEqual({
      previousRunInterrupted: false,
      ...nothingLeft,
      previousVersion: after,
    });
  });

  it('treats corrupt state conservatively and writes private files', async () => {
    const { file } = await fixture();
    await fs.promises.writeFile(file, '{bad');
    const store = new RunStateStore(file, VERSION);
    await expect(store.begin()).resolves.toEqual({
      previousRunInterrupted: true,
      ...nothingLeft,
      previousVersion: { kind: 'unrecorded' },
    });
    expect((await fs.promises.stat(file)).mode & 0o777).toBe(0o600);
  });

  // BUG-260: the operator's place survives a restart, once.
  it('hands held state to the launch after a clean restart, and only once', async () => {
    const { file } = await fixture();
    const held = { navigation: '/fleet/spatial' };
    const restarting = new RunStateStore(file, VERSION);
    await restarting.begin();
    await restarting.recordHeldState(held);
    await restarting.markClean('restart');

    const relaunched = new RunStateStore(file, VERSION);
    expect((await relaunched.begin()).heldState).toEqual(held);
    await relaunched.markClean('update');
    expect(
      (await new RunStateStore(file, VERSION).begin()).heldState
    ).toBeNull();
  });

  it('restores no held state after a quit, a cancelled restart, or a crash', async () => {
    const { file } = await fixture();
    const cancelled = new RunStateStore(file, VERSION);
    await cancelled.begin();
    // The restart that captured this was cancelled; the run later quit.
    await cancelled.recordHeldState({ navigation: '/settings' });
    await cancelled.markClean('quit');
    expect(
      (await new RunStateStore(file, VERSION).begin()).heldState
    ).toBeNull();

    const crashed = new RunStateStore(file, VERSION);
    await crashed.begin();
    await crashed.recordHeldState({ navigation: '/settings' });
    expect(
      (await new RunStateStore(file, VERSION).begin()).heldState
    ).toBeNull();
  });

  // BUG-286: a failed install relaunches the current version, which shows why.
  it('carries an install failure to the next launch', async () => {
    const { file } = await fixture();
    const failed = new RunStateStore(file, VERSION);
    await failed.begin();
    await failed.markClean('update');
    const failure = {
      fromVersion: '0.1.20',
      toVersion: '0.1.21',
      reason: 'Code signature did not pass validation',
    };
    await failed.recordInstallFailure(failure);

    expect(
      (await new RunStateStore(file, VERSION).begin()).installFailure
    ).toEqual(failure);
  });

  // ENG-031 W28: the next launch knows it started on a new version.
  it('tells the next launch which version ran before it', async () => {
    const { file } = await fixture();
    await new RunStateStore(file, '0.1.9').begin();
    const updated = new RunStateStore(file, VERSION);
    expect((await updated.begin()).previousVersion).toEqual({
      kind: 'recorded',
      version: '0.1.9',
    });
    await updated.markClean('update');
    expect(
      (await new RunStateStore(file, VERSION).begin()).previousVersion
    ).toEqual(after);
  });

  it('reads a record from a build that kept no version as unrecorded', async () => {
    const { file } = await fixture();
    await fs.promises.writeFile(
      file,
      JSON.stringify({
        v: 1,
        runId: 'old',
        pid: 1,
        startedAt: 0,
        clean: true,
        exit: 'update',
      })
    );
    expect(
      (await new RunStateStore(file, VERSION).begin()).previousVersion
    ).toEqual({ kind: 'unrecorded' });
  });
});
