#!/usr/bin/env node
// Generated for the public repository by the "public-dogfood-tooling" recipe.

import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  teamIdentifierFromIdentityName,
  resolveDeveloperIdIdentity,
} from './lib/macos-code-signing.mjs';
import { assertPackedApp } from './release-package.mjs';

const root = process.cwd();
const execFileAsync = promisify(execFile);

async function git(...args) {
  const { stdout } = await execFileAsync('git', args, { cwd: root });
  return stdout.trim();
}

const sourceSha =
  process.env.EXAWATT_BUILD_SOURCE_SHA ?? (await git('rev-parse', 'HEAD'));

async function assertImmutableSource() {
  const currentSha = await git('rev-parse', 'HEAD');
  if (currentSha !== sourceSha) {
    throw new Error(
      `Dogfood source moved from ${sourceSha} to ${currentSha}; refusing a mixed-revision build.`
    );
  }
  const trackedChanges = await git(
    'status',
    '--porcelain',
    '--untracked-files=no'
  );
  if (trackedChanges) {
    throw new Error(
      `Dogfood source ${sourceSha} contains tracked changes; refusing a mixed-content build.\n${trackedChanges}`
    );
  }
}

async function run(command, args, env = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.once('error', reject);
    child.once('exit', code =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))
    );
  });
}

const identity = await resolveDeveloperIdIdentity();
const teamIdentifier = teamIdentifierFromIdentityName(identity.name);
console.log(
  `[dogfood-signing] using the Keychain Developer ID Application identity${teamIdentifier ? ` for Team ${teamIdentifier}` : ''}`
);

await assertImmutableSource();

await run('pnpm', ['build']);
await run('pnpm', ['electron:prepare-renderer']);
await run('pnpm', ['electron:compile']);
await run('pnpm', [
  'exec',
  'electron-builder',
  'install-app-deps',
  '--arch',
  'arm64',
]);
await run('pnpm', ['electron:prepare-main']);
await run('pnpm', ['electron:prepare-licenses']);
await run(
  'pnpm',
  [
    'exec',
    'electron-builder',
    '--mac',
    'dir',
    '--arm64',
    '--config',
    'electron-builder.dogfood.yml',
    '--config.npmRebuild=false',
  ],
  {
    CSC_NAME: identity.fingerprint,
    EXAWATT_RENDERER_SIGN_IDENTITY: identity.fingerprint,
  }
);

await assertImmutableSource();
const buildInfo = JSON.parse(
  await readFile(path.join(root, 'dist-electron', 'build-info.json'), 'utf8')
);
if (buildInfo.sha !== sourceSha) {
  throw new Error(
    `Dogfood artifact records ${buildInfo.sha}; expected immutable source ${sourceSha}.`
  );
}

// The dogfood build is the operator's daily artifact and diverges from its
// config the same way a release does (incident `0010`). It owes no update
// feed, so it gets everything else: identity, icon, and payload.
assertPackedApp(path.join(root, 'release', 'mac-arm64', 'Exawatt.app'), { root });
