// Packaging step: write the Electron main process's runtime dependency
// snapshot and stamp the build. Runs immediately before electron-builder in
// every packaging flow; `electron:compile` discards what it writes, so no dev
// launch ever inherits it (see `lib/electron-runtime-deps.mjs`, BUG-016).
//
// What it stages is the declared production dependency closure and nothing
// else (BUG-030). The size printed below is the payload every user downloads
// and every update transfers, so it belongs in the build log.
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import {
  snapshotRoot,
  stageRuntimeDependencies,
} from './lib/electron-runtime-deps.mjs';

async function payloadBytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    total += entry.isDirectory()
      ? await payloadBytes(child)
      : (await stat(child)).size;
  }
  return total;
}

const execFileAsync = promisify(execFile);

const root = process.cwd();
const packageMode = process.argv.includes('--package');
const distributionRoot = path.join(root, '.exawatt-build');
const distributionJson = await readFile(
  path.join(distributionRoot, 'distribution.json'),
  'utf8'
);
const distributionDigest = (
  await readFile(path.join(distributionRoot, 'distribution.sha256'), 'utf8')
).trim();
let rendererCompositionDigest = null;
if (packageMode) {
  const rendererDistributionDigest = (
    await readFile(
      path.join(root, 'dist-renderer-archive', 'distribution.sha256'),
      'utf8'
    )
  ).trim();
  rendererCompositionDigest = (
    await readFile(
      path.join(root, 'dist-renderer-archive', 'renderer.composition.sha256'),
      'utf8'
    )
  ).trim();
  if (distributionDigest !== rendererDistributionDigest) {
    throw new Error(
      `Electron distribution mismatch: main ${distributionDigest}, renderer ${rendererDistributionDigest}`
    );
  }
}
const staged = await stageRuntimeDependencies(root);
await writeFile(
  path.join(root, 'dist-electron', 'distribution.json'),
  distributionJson
);
await writeFile(
  path.join(root, 'dist-electron', 'distribution.sha256'),
  `${distributionDigest}\n`
);

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
      distributionDigest,
      rendererCompositionDigest,
    },
    null,
    2
  )}\n`
);

const bytes = await payloadBytes(snapshotRoot(root));
console.log(
  `[electron-main] staged ${staged.size} runtime packages, ` +
    `${(bytes / 1024 / 1024).toFixed(1)} MB`
);
