import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceStore } from './workspace-store';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map(root => fs.promises.rm(root, { recursive: true, force: true }))
  );
});

describe('WorkspaceStore', () => {
  it('persists overlapping saves in invocation order with private permissions', async () => {
    const root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'exawatt-workspace-')
    );
    roots.push(root);
    const file = path.join(root, 'workspace.json');
    const store = new WorkspaceStore(file);

    const older = store.save({ revision: 1, payload: 'x'.repeat(2_000_000) });
    const newer = store.save({ revision: 2 });
    const loaded = store.load();
    await Promise.all([older, newer]);

    await expect(loaded).resolves.toEqual({ revision: 2 });
    expect((await fs.promises.stat(file)).mode & 0o777).toBe(0o600);
    expect(
      (await fs.promises.readdir(root)).some(name => name.includes('.tmp-'))
    ).toBe(false);
  });
});
