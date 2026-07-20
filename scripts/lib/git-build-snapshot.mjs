import { execFile } from 'node:child_process';
import { access, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const localEnvironmentFiles = [
  '.env.local',
  '.env.production.local',
  '.env.development.local',
  '.env.test.local',
];

async function pathExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

export async function createGitBuildSnapshot(root, sourceSha) {
  const container = await mkdtemp(
    path.join(tmpdir(), 'exawatt-dogfood-source-')
  );
  const snapshotRoot = path.join(container, 'source');
  let registered = false;
  try {
    await execFileAsync(
      'git',
      ['worktree', 'add', '--detach', snapshotRoot, sourceSha],
      { cwd: root, maxBuffer: 4 * 1024 * 1024 }
    );
    registered = true;

    for (const filename of localEnvironmentFiles) {
      const source = path.join(root, filename);
      if (await pathExists(source)) {
        await symlink(source, path.join(snapshotRoot, filename));
      }
    }

    return {
      root: snapshotRoot,
      sourceSha,
      async cleanup() {
        if (registered) {
          try {
            await execFileAsync(
              'git',
              ['worktree', 'remove', '--force', snapshotRoot],
              { cwd: root, maxBuffer: 4 * 1024 * 1024 }
            );
            registered = false;
          } catch (removalError) {
            await rm(container, { recursive: true, force: true });
            try {
              await execFileAsync('git', ['worktree', 'prune'], { cwd: root });
              registered = false;
            } catch (pruneError) {
              throw new AggregateError(
                [removalError, pruneError],
                `Could not remove or prune the immutable build snapshot at ${snapshotRoot}.`
              );
            }
          }
        }
        await rm(container, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (registered) {
      try {
        await execFileAsync(
          'git',
          ['worktree', 'remove', '--force', snapshotRoot],
          { cwd: root }
        );
      } catch {
        await rm(container, { recursive: true, force: true });
        await execFileAsync('git', ['worktree', 'prune'], { cwd: root }).catch(
          () => {}
        );
      }
    }
    await rm(container, { recursive: true, force: true });
    throw error;
  }
}
