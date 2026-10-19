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

const nothingLeft = { heldState: null, installFailure: null };

describe('RunStateStore', () => {
  it('distinguishes first, interrupted, and clean runs', async () => {
    const { file } = await fixture();
    const first = new RunStateStore(file);
    await expect(first.begin()).resolves.toEqual({
      previousRunInterrupted: false,
      ...nothingLeft,
    });

    const afterCrash = new RunStateStore(file);
    await expect(afterCrash.begin()).resolves.toEqual({
      previousRunInterrupted: true,
      ...nothingLeft,
    });
    await afterCrash.markClean('quit');

    const afterClean = new RunStateStore(file);
    await expect(afterClean.begin()).resolves.toEqual({
      previousRunInterrupted: false,
      ...nothingLeft,
    });
  });

  it('treats corrupt state conservatively and writes private files', async () => {
    const { file } = await fixture();
    await fs.promises.writeFile(file, '{bad');
    const store = new RunStateStore(file);
    await expect(store.begin()).resolves.toEqual({
      previousRunInterrupted: true,
      ...nothingLeft,
    });
    expect((await fs.promises.stat(file)).mode & 0o777).toBe(0o600);
  });

  // BUG-260: the operator's place survives a restart, once.
  it('hands held state to the launch after a clean restart, and only once', async () => {
    const { file } = await fixture();
    const held = { navigation: '/fleet/spatial' };
    const restarting = new RunStateStore(file);
    await restarting.begin();
    await restarting.recordHeldState(held);
    await restarting.markClean('restart');

    const relaunched = new RunStateStore(file);
    expect((await relaunched.begin()).heldState).toEqual(held);
    await relaunched.markClean('update');
    expect((await new RunStateStore(file).begin()).heldState).toBeNull();
  });

  it('restores no held state after a quit, a cancelled restart, or a crash', async () => {
    const { file } = await fixture();
    const cancelled = new RunStateStore(file);
    await cancelled.begin();
    // The restart that captured this was cancelled; the run later quit.
    await cancelled.recordHeldState({ navigation: '/settings' });
    await cancelled.markClean('quit');
    expect((await new RunStateStore(file).begin()).heldState).toBeNull();

    const crashed = new RunStateStore(file);
    await crashed.begin();
    await crashed.recordHeldState({ navigation: '/settings' });
    expect((await new RunStateStore(file).begin()).heldState).toBeNull();
  });

  // BUG-286: a failed install relaunches the current version, which shows why.
  it('carries an install failure to the next launch', async () => {
    const { file } = await fixture();
    const failed = new RunStateStore(file);
    await failed.begin();
    await failed.markClean('update');
    const failure = {
      fromVersion: '0.1.20',
      toVersion: '0.1.21',
      reason: 'Code signature did not pass validation',
    };
    await failed.recordInstallFailure(failure);

    expect((await new RunStateStore(file).begin()).installFailure).toEqual(
      failure
    );
  });
});
