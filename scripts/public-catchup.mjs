#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { acquireDeliveryLock } from './lib/delivery-lock.mjs';
import { deliveryStateRoot } from './lib/delivery-state.mjs';
import { certifyExactPublicCandidate } from './lib/exact-public-recertification.mjs';
import {
  publishPreparedPublicProjection,
  resolvePublicRemote,
} from './lib/public-delivery.mjs';
import {
  clearPublicMaintenanceHold,
  readPublicMaintenanceHold,
} from './lib/public-maintenance-hold.mjs';

const exec = promisify(execFile);
const SHA = /^[a-f0-9]{40}$/u;
async function git(root, ...args) {
  return (
    await exec('git', args, {
      cwd: root,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
  ).stdout.trim();
}
export function parseCatchupArgs(argv) {
  const options = { execute: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--execute') {
      options.execute = true;
      continue;
    }
    if (
      !['--source', '--expected-public-sha'].includes(arg) ||
      !argv[i + 1] ||
      argv[i + 1].startsWith('--')
    ) {
      throw new Error(
        'Usage: pnpm open-source:catchup -- --source <full SHA> --expected-public-sha <full SHA> [--execute]'
      );
    }
    options[arg === '--source' ? 'sourceSha' : 'expectedPublicSha'] = argv[++i];
  }
  return options;
}

/** A reviewed catch-up appends a public snapshot; it never rewrites any ref. */
export async function runPublicCatchup(root, options, overrides = {}) {
  if (
    !SHA.test(options.sourceSha ?? '') ||
    !SHA.test(options.expectedPublicSha ?? '')
  ) {
    throw new Error('Catch-up requires exact full source and public SHAs');
  }
  const deps = {
    git,
    resolveRemote: resolvePublicRemote,
    readHold: readPublicMaintenanceHold,
    clearHold: clearPublicMaintenanceHold,
    stateRoot: deliveryStateRoot,
    lock: acquireDeliveryLock,
    project: async args =>
      (await import('./lib/public-projection.mjs')).projectPublicCatchup(args),
    certify: certifyExactPublicCandidate,
    publish: publishPreparedPublicProjection,
    ...overrides,
  };
  const remote = await deps.resolveRemote(root);
  if (!remote) throw new Error('Catch-up requires a configured public remote');
  const readTip = async () =>
    (await deps.git(root, 'ls-remote', remote.url, 'refs/heads/master')).split(
      /\s/u
    )[0];
  const verifySource = async () => {
    await deps.git(root, 'fetch', '--quiet', 'origin', 'master');
    if (
      (await deps.git(root, 'rev-parse', 'origin/master^{commit}')) !==
      options.sourceSha
    ) {
      throw new Error(
        'Catch-up source is not current integrated origin/master'
      );
    }
  };
  const verifyHold = async () => {
    const hold = await deps.readHold(root);
    if (
      (await deps.resolveRemote(root))?.url !== remote.url ||
      !hold ||
      hold.expectedPublicSha !== options.expectedPublicSha ||
      hold.publicRepository !== remote.url
    ) {
      throw new Error(
        'Catch-up execution requires a matching public maintenance hold'
      );
    }
  };
  if (options.execute) {
    await verifySource();
    await verifyHold();
  }
  if ((await readTip()) !== options.expectedPublicSha)
    throw new Error('Public tip changed before catch-up');
  const parent = path.join(await deps.stateRoot(root), 'public-catchup');
  await mkdir(parent, { recursive: true });
  const attempt = await mkdtemp(path.join(parent, 'attempt-'));
  const projection = await deps.project({
    sourceRepo: root,
    sourceSha: options.sourceSha,
    destination: path.join(attempt, 'candidate'),
    fastForwardFrom: { repository: remote.url, ref: 'master' },
    expectedPublicSha: options.expectedPublicSha,
  });
  const preview = {
    sourceSha: options.sourceSha,
    previousPublicSha: options.expectedPublicSha,
    publicSha: projection.publicSha,
    planDigest: projection.planDigest,
    epochUpdate: projection.epochUpdate,
  };
  await writeFile(
    path.join(attempt, 'preview.json'),
    JSON.stringify(preview, null, 2) + '\n'
  );
  if (!options.execute) return { state: 'preview', attempt, ...preview };
  const evidence = await deps.certify({
    candidateRepo: projection.destination,
    expectedPublicSha: projection.publicSha,
    sourceSha: options.sourceSha,
    planDigest: projection.planDigest,
    projectedPaths: projection.projectedPaths,
    unrenderedOutputs: projection.unrenderedOutputs,
  });
  if (
    evidence.status !== 'passed' ||
    evidence.sourceSha !== options.sourceSha ||
    evidence.publicSha !== projection.publicSha ||
    evidence.planDigest !== projection.planDigest
  ) {
    throw new Error('Exact candidate certification did not bind this catch-up');
  }
  await writeFile(
    path.join(attempt, 'certificate.json'),
    JSON.stringify(evidence, null, 2) + '\n'
  );
  const lock = await deps.lock(root);
  try {
    await verifySource();
    await verifyHold();
    if ((await readTip()) !== options.expectedPublicSha)
      throw new Error('Public tip changed during certification');
    // Keep the hold until publication/read-back is recorded. A crash before
    // clearing it is recoverable using the recorded old/new public pair.
    const result = await deps.publish(
      root,
      {
        state: 'prepared',
        remote,
        projection,
        parent: path.join(attempt, 'disposable'),
        startedAt: Date.now(),
        privateSha: options.sourceSha,
        publicSha: projection.publicSha,
        previousPublicSha: options.expectedPublicSha,
        changed: projection.publicSha !== options.expectedPublicSha,
        outputCount: projection.outputCount,
        renderedVariants: projection.renderedVariants,
        skippedRevisions: projection.skippedRevisions,
        entryBoundaries: projection.entryBoundaries,
        unrenderedOutputs: projection.unrenderedOutputs.map(
          output => output.path
        ),
        metadataPolicyId: projection.metadataPolicyId,
        projectionContractId: projection.projectionContractId,
      },
      {
        push: prepared =>
          deps.git(
            prepared.projection.destination,
            'push',
            '--quiet',
            remote.url,
            `${projection.publicSha}:refs/heads/master`
          ),
      }
    );
    if (result.state !== 'published' || result.recorded === false) {
      throw new Error(
        'Catch-up publication/read-back was not recorded; maintenance hold retained'
      );
    }
    await deps.clearHold(root, {
      expectedPublicSha: options.expectedPublicSha,
    });
    return { state: 'published', attempt, ...preview };
  } finally {
    await lock.release();
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  runPublicCatchup(process.cwd(), parseCatchupArgs(process.argv.slice(2)))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
