#!/usr/bin/env node
// Generated for the public repository by the "public-dogfood-tooling" recipe.

import { execFile, spawn } from 'node:child_process';
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { acquireInstallationLock } from './lib/delivery-lock.mjs';
import {
  commitStagedApp,
  recoverAtomicDogfoodSwap,
  recoverLegacyDogfoodSwap,
} from './lib/dogfood-install-transaction.mjs';
import { createGitBuildSnapshot } from './lib/git-build-snapshot.mjs';
import { atomicSwapPaths } from './lib/macos-atomic-swap.mjs';
import {
  evaluateAppCodeIdentity,
  hasStableSignerIdentity,
  inspectCodeSignature,
  resolveDeveloperIdIdentity,
  teamIdentifierFromIdentityName,
} from './lib/macos-code-signing.mjs';
import {
  requireOfficialPackagedApp,
  resolvePackagedApp,
} from './lib/packaged-app.mjs';
import { dogfoodInstallLayout } from './lib/dogfood-install-identity.mjs';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const requireOfficial = process.env.EXAWATT_REQUIRE_OFFICIAL_DOGFOOD === '1';
const packaged = requireOfficial
  ? await requireOfficialPackagedApp({
      root,
      appPathOverride: undefined,
      purpose: 'Operator dogfood',
    })
  : await resolvePackagedApp({ root, appPathOverride: undefined });
const installDir = process.env.EXAWATT_INSTALL_DIR ?? '/Applications';
const { target, staging, statePath } = dogfoodInstallLayout(packaged, {
  installDir,
  homeDirectory: homedir(),
  updateStateOverride: process.env.EXAWATT_UPDATE_STATE,
});

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function run(command, args, cwd, env = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.once('error', reject);
    child.once('exit', code =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))
    );
  });
}

async function assertSourceCheckout(sourceSha, explicitSource) {
  if (explicitSource) return;
  const currentSha = await git(root, 'rev-parse', 'HEAD');
  if (currentSha !== sourceSha) {
    throw new Error(
      `Master moved from ${sourceSha} to ${currentSha} during dogfood delivery. The immutable artifact was not installed; rerun from current master.`
    );
  }
  const dirty = await git(root, 'status', '--porcelain');
  if (dirty && process.env.EXAWATT_ALLOW_DIRTY !== '1') {
    throw new Error(
      'Dogfood delivery source became dirty before installation.'
    );
  }
}

async function assertStillRequested(sourceSha) {
  const requestPath = process.env.EXAWATT_DOGFOOD_REQUEST_STATE;
  if (!requestPath) return;
  const request = JSON.parse(await readFile(requestPath, 'utf8'));
  if (request.desiredSha !== sourceSha) {
    throw new Error(
      `Dogfood ${sourceSha} was superseded by ${request.desiredSha}; the stale artifact was not installed.`
    );
  }
}

async function writeInstallState(buildInfo, identity) {
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryState = `${statePath}.${process.pid}.tmp`;
  try {
    await writeFile(
      temporaryState,
      `${JSON.stringify(
        {
          installedSha: buildInfo.sha,
          installedAt: new Date().toISOString(),
          signingIdentifier: identity.identifier,
          signingTeamIdentifier: identity.teamIdentifier,
        },
        null,
        2
      )}\n`
    );
    await rename(temporaryState, statePath);
  } finally {
    await rm(temporaryState, { force: true });
  }
}

let installationLock = null;
let snapshot = null;
let preserveStaging = false;
let operationError = null;

try {
  installationLock = await acquireInstallationLock(target);
  const explicitSource = process.env.EXAWATT_DOGFOOD_SOURCE_SHA;
  const branch = await git(root, 'branch', '--show-current');
  if (
    !explicitSource &&
    branch !== 'master' &&
    process.env.EXAWATT_ALLOW_NON_MASTER !== '1'
  ) {
    throw new Error(
      `Dogfood installs must come from master; current branch is ${branch}.`
    );
  }
  const dirty = await git(root, 'status', '--porcelain');
  if (!explicitSource && dirty && process.env.EXAWATT_ALLOW_DIRTY !== '1') {
    throw new Error('Dogfood installs require a completely clean worktree.');
  }
  const sourceSha = explicitSource ?? (await git(root, 'rev-parse', 'HEAD'));
  const signingIdentity = await resolveDeveloperIdIdentity();
  const signingTeamIdentifier = teamIdentifierFromIdentityName(
    signingIdentity.name
  );
  if (!signingTeamIdentifier) {
    throw new Error('The selected signing identity has no Team identifier.');
  }
  const previousIdentifier =
    process.env.EXAWATT_DOGFOOD_ALLOWED_PREVIOUS_IDENTIFIER;
  const allowedPreviousIdentities = previousIdentifier
    ? [
        {
          identifier: previousIdentifier,
          teamIdentifier: signingTeamIdentifier,
        },
      ]
    : [];

  await mkdir(installDir, { recursive: true });
  await recoverLegacyDogfoodSwap({ installDir, target });
  const recovery = await recoverAtomicDogfoodSwap({
    staging,
    target,
    verify: async candidate => {
      try {
        return await evaluateAppCodeIdentity(candidate, {
          expectedIdentifier: packaged.identity.appId,
          expectedTeamIdentifier: signingTeamIdentifier,
        });
      } catch (currentError) {
        for (const previous of allowedPreviousIdentities) {
          try {
            return await evaluateAppCodeIdentity(candidate, {
              expectedIdentifier: previous.identifier,
              expectedTeamIdentifier: previous.teamIdentifier,
            });
          } catch {
            // Keep checking the distributor's explicit migration set.
          }
        }
        throw currentError;
      }
    },
    atomicSwap: atomicSwapPaths,
  });
  if (recovery.recovered) {
    console.log(
      `[dogfood-install] recovered interrupted transaction: ${recovery.action}`
    );
  }
  snapshot = await createGitBuildSnapshot(root, sourceSha);
  await run(
    'pnpm',
    ['install', '--frozen-lockfile', '--prefer-offline'],
    snapshot.root
  );
  await run('pnpm', ['electron:build:dogfood'], snapshot.root, {
    EXAWATT_BUILD_SOURCE_SHA: sourceSha,
    EXAWATT_BUILD_SOURCE_BRANCH: branch || 'master',
    EXAWATT_DOGFOOD_SIGN_IDENTITY: signingIdentity.fingerprint,
    EXAWATT_EXPECTED_TEAM_IDENTIFIER: signingTeamIdentifier,
  });

  const builtApp = path.join(snapshot.root, packaged.relativeAppPath);
  const builtExecutable = path.join(
    snapshot.root,
    packaged.relativeExecutablePath
  );
  await access(builtExecutable);
  const builtIdentity = await evaluateAppCodeIdentity(builtApp, {
    expectedIdentifier: packaged.identity.appId,
    expectedTeamIdentifier: signingTeamIdentifier,
  });
  await run('pnpm', ['eval:electron:packaged'], snapshot.root, {
    EXAWATT_APP_PATH: builtExecutable,
  });

  const buildInfo = JSON.parse(
    await readFile(
      path.join(snapshot.root, 'dist-electron', 'build-info.json'),
      'utf8'
    )
  );
  if (buildInfo.sha !== sourceSha) {
    throw new Error(
      `Signed artifact records ${buildInfo.sha}; expected immutable source ${sourceSha}.`
    );
  }
  await assertSourceCheckout(sourceSha, explicitSource);
  await assertStillRequested(sourceSha);

  await rm(staging, { recursive: true, force: true });
  await execFileAsync('/usr/bin/ditto', [builtApp, staging]);
  const stagingIdentity = await evaluateAppCodeIdentity(staging, {
    expectedIdentifier: builtIdentity.identifier,
    expectedTeamIdentifier: builtIdentity.teamIdentifier,
  });
  await assertSourceCheckout(sourceSha, explicitSource);
  await assertStillRequested(sourceSha);

  const commitResult = await commitStagedApp({
    staging,
    target,
    expectedIdentity: stagingIdentity,
    // A distributor may name one retired identifier explicitly. It is pinned
    // to the selected Team; every other stable identity refuses replacement,
    // and a community build never inherits an official migration.
    allowedPreviousIdentities,
    inspectExisting: inspectCodeSignature,
    isStableIdentity: hasStableSignerIdentity,
    verifyInstalled: (installedPath, expectedIdentity) =>
      evaluateAppCodeIdentity(installedPath, {
        expectedIdentifier: expectedIdentity.identifier,
        expectedTeamIdentifier: expectedIdentity.teamIdentifier,
      }),
    atomicSwap: atomicSwapPaths,
  });

  await writeInstallState(buildInfo, stagingIdentity);
  if (commitResult.stalePreviousPath) {
    await rm(commitResult.stalePreviousPath, {
      recursive: true,
      force: true,
    }).catch(error => {
      console.warn(
        `[dogfood-install] installed successfully but could not remove the previous app at ${commitResult.stalePreviousPath}: ${error.message}`
      );
    });
  }
  console.log(
    `[dogfood-install] installed ${buildInfo.sha.slice(0, 12)} at ${target} with stable Team ${stagingIdentity.teamIdentifier}`
  );
} catch (error) {
  operationError = error;
  preserveStaging = error?.preserveStaging === true;
  throw error;
} finally {
  const cleanupErrors = [];
  if (!preserveStaging) {
    try {
      await rm(staging, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await snapshot?.cleanup();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await installationLock?.release();
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length > 0) {
    if (operationError) {
      console.error(
        `[dogfood-install] cleanup also failed: ${cleanupErrors.map(error => error.message).join('; ')}`
      );
    } else {
      throw new AggregateError(
        cleanupErrors,
        'Dogfood delivery succeeded, but transaction cleanup did not complete.'
      );
    }
  }
}
