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

describe('RunStateStore', () => {
  it('distinguishes first, interrupted, and clean runs', async () => {
    const { file } = await fixture();
    const first = new RunStateStore(file);
    await expect(first.begin()).resolves.toEqual({
      previousRunInterrupted: false,
    });

    const afterCrash = new RunStateStore(file);
    await expect(afterCrash.begin()).resolves.toEqual({
      previousRunInterrupted: true,
    });
    await afterCrash.markClean();

    const afterClean = new RunStateStore(file);
    await expect(afterClean.begin()).resolves.toEqual({
      previousRunInterrupted: false,
    });
  });

  it('treats corrupt state conservatively and writes private files', async () => {
    const { file } = await fixture();
    await fs.promises.writeFile(file, '{bad');
    const store = new RunStateStore(file);
    await expect(store.begin()).resolves.toEqual({
      previousRunInterrupted: true,
    });
    expect((await fs.promises.stat(file)).mode & 0o777).toBe(0o600);
  });
});
