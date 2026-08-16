// Packaging step: write the Electron main process's runtime dependency
// snapshot and stamp the build. Runs immediately before electron-builder in
// every packaging flow; `electron:compile` discards what it writes, so no dev
// launch ever inherits it (see `lib/electron-runtime-deps.mjs`, BUG-016).
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { stageRuntimeDependencies } from './lib/electron-runtime-deps.mjs';

const execFileAsync = promisify(execFile);

const root = process.cwd();
const staged = await stageRuntimeDependencies(root);

const { stdout: shaOutput } = await execFileAsync(
  'git',
  ['rev-parse', 'HEAD'],
  {
    cwd: root,
  }
);
const { stdout: branchOutput } = await execFileAsync(
  'git',
  ['branch', '--show-current'],
  { cwd: root }
);
const actualSha = shaOutput.trim();
const expectedSha = process.env.EXAWATT_BUILD_SOURCE_SHA;
if (expectedSha && actualSha !== expectedSha) {
  throw new Error(
    `Immutable build snapshot moved from ${expectedSha} to ${actualSha}.`
  );
}
await writeFile(
  path.join(root, 'dist-electron', 'build-info.json'),
  `${JSON.stringify(
    {
      sha: actualSha,
      branch: process.env.EXAWATT_BUILD_SOURCE_BRANCH ?? branchOutput.trim(),
      builtAt: new Date().toISOString(),
      delivery:
        process.env.EXAWATT_RELEASE_CHANNEL === 'signed' ? 'signed' : 'dogfood',
    },
    null,
    2
  )}\n`
);

console.log(`[electron-main] staged ${staged.size} runtime packages`);
