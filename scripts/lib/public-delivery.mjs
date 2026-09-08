import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { appendDeliveryMetric } from './delivery-state.mjs';
import {
  PUBLIC_PROJECTION_CONTRACT_ID,
  projectPublicHistory,
} from './public-projection.mjs';
import { PUBLIC_PROJECTION_EPOCH_PATH } from './public-projection-epoch.mjs';
import { PUBLIC_METADATA_POLICY_ID } from './public-metadata-policy.mjs';
import { readPublicMaintenanceHold } from './public-maintenance-hold.mjs';
import {
  latestPublishedPair,
  publicDeliveryPreflightBlocker,
  readSourceLock,
  recordSourceLock,
} from './public-source-lock.mjs';

/**
 * The outbound half of the two-repository mechanism: after a landing has
 * pushed the private `master`, project that exact commit's public subset and
 * fast-forward the public remote to it.
 *
 * Four properties this module exists to hold:
 *
 *   1. **Inert by default.** The public remote is a Git remote named `public`.
 *      No such remote means no projection, no output, no state — the landing
 *      is bit-for-bit the landing it was before this step existed. That is the
 *      configuration today and for as long as no public repository exists.
 *   2. **Serialized.** The caller runs this inside the FIFO delivery lock that
 *      already serializes `master` pushes, so two landings cannot race the
 *      public remote.
 *   3. **Never forced.** `projectPublicHistory` refuses a projection the
 *      public remote does not fast-forward to, and `publicPushArgs` carries no
 *      force flag. A refusal means the manifest reclassified history, which is
 *      `open-source:reseed`'s deliberate, reasoned job — never a landing's.
 *   4. **Never fatal.** The private landing is the source of truth and has
 *      already succeeded. Every failure here is recorded (`pending` or
 *      `refused`) and reported, and none of them fails the landing. The next
 *      landing's projection fast-forwards past both, because projection is a
 *      pure function of source history.
 */

const execFileAsync = promisify(execFile);

export const PUBLIC_REMOTE_NAME = 'public';
export const PUBLIC_BRANCH = 'master';
const REFUSAL =
  /(?:refusing a non-fast-forward projection|refusing public delivery|non-fast-forward|fetch first)/iu;
const UNRENDERED_SHOWN = 6;
const ENTRY_SHOWN = 3;

/**
 * The public remote's push refspec. Deliberately force-free and exported so a
 * test can assert that the landing path cannot force even by accident;
 * `scripts/open-source-reseed.mjs` is the only path that may.
 */
export function publicPushArgs({ url, branch = PUBLIC_BRANCH }) {
  return ['push', '--quiet', url, `refs/heads/${branch}:refs/heads/${branch}`];
}

export async function resolvePublicRemote(root) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['remote', 'get-url', PUBLIC_REMOTE_NAME],
      { cwd: root }
    );
    const url = stdout.trim();
    return url ? { name: PUBLIC_REMOTE_NAME, url } : null;
  } catch {
    return null;
  }
}

async function readPublicRemoteTip(root, remote, branch = PUBLIC_BRANCH) {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-remote', remote.url, `refs/heads/${branch}`],
    { cwd: root, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }
  );
  const line = stdout.trim();
  return line === '' ? null : line.split(/\s/u)[0];
}

async function assertReseedEpochTransition(root, records, integratedSha) {
  const reseed = records.at(-1);
  if (reseed?.status !== 'reseeded' || !reseed.epochUpdateOwed) return null;
  const { stdout: countOutput } = await execFileAsync(
    'git',
    ['rev-list', '--count', `${reseed.privateSha}..${integratedSha}`],
    { cwd: root }
  );
  const { stdout: pathsOutput } = await execFileAsync(
    'git',
    ['diff', '--name-only', '-z', reseed.privateSha, integratedSha, '--'],
    { cwd: root, encoding: 'buffer' }
  );
  const paths = pathsOutput.toString('utf8').split('\0').filter(Boolean);
  if (
    countOutput.trim() !== '1' ||
    paths.length !== 1 ||
    paths[0] !== PUBLIC_PROJECTION_EPOCH_PATH
  ) {
    throw new Error(
      '[public-delivery] the sanitized reseed is epoch-update-owed: the next ' +
        `landing must be one private-only commit changing only ${PUBLIC_PROJECTION_EPOCH_PATH}`
    );
  }
  let candidateEpoch;
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['show', `${integratedSha}:${PUBLIC_PROJECTION_EPOCH_PATH}`],
      { cwd: root }
    );
    candidateEpoch = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `[public-delivery] cannot read the owed epoch update: ${error.message}`
    );
  }
  const expectedEpoch = reseed.epochUpdate;
  if (
    !expectedEpoch ||
    JSON.stringify(Object.keys(candidateEpoch).sort()) !==
      JSON.stringify(Object.keys(expectedEpoch).sort()) ||
    Object.keys(expectedEpoch).some(
      key => candidateEpoch[key] !== expectedEpoch[key]
    )
  ) {
    throw new Error(
      '[public-delivery] the tracked epoch does not exactly match the payload ' +
        'recorded by open-source:reseed'
    );
  }
  return reseed;
}

export async function preparePublicMaintenanceHold(
  root,
  { integratedSha } = {}
) {
  const hold = await readPublicMaintenanceHold(root);
  if (!hold) return null;
  const remote = await resolvePublicRemote(root);
  if (!remote) {
    throw new Error(
      '[public-maintenance] active hold requires a public remote'
    );
  }
  if (hold.publicRepository && hold.publicRepository !== remote.url) {
    throw new Error(
      `[public-maintenance] held public repository was ${hold.publicRepository}, ` +
        `but the configured remote is ${remote.url}; refusing private integration`
    );
  }
  const observed = await readPublicRemoteTip(root, remote);
  if (observed !== hold.expectedPublicSha) {
    throw new Error(
      `[public-maintenance] held public tip moved from ${hold.expectedPublicSha} ` +
        `to ${observed ?? '<empty>'}; refusing private integration`
    );
  }
  return {
    state: 'held',
    privateSha: integratedSha,
    publicSha: null,
    previousPublicSha: observed,
    publicRepository: remote.url,
    reason: hold.reason,
    metadataPolicyId: PUBLIC_METADATA_POLICY_ID,
    projectionContractId: PUBLIC_PROJECTION_CONTRACT_ID,
    startedAt: Date.now(),
  };
}

export function describeProjection(summary) {
  if (summary.state !== 'published') return null;
  const detail = [
    `${summary.outputCount} paths`,
    `${summary.renderedVariants} rendered variants`,
  ].join(', ');
  return (
    `public ${summary.publicSha.slice(0, 12)} ← ` +
    `${summary.privateSha.slice(0, 12)} (${detail})` +
    (summary.changed ? '' : ' — unchanged')
  );
}

export function describeUnrendered(summary) {
  const outputs = summary.unrenderedOutputs ?? [];
  if (outputs.length === 0) return null;
  const shown = outputs.slice(0, UNRENDERED_SHOWN).join(', ');
  const rest = outputs.length - UNRENDERED_SHOWN;
  return (
    `the public repository did not receive ${outputs.length} generated ` +
    `outputs: ${shown}${rest > 0 ? `, and ${rest} more` : ''}`
  );
}

/**
 * A rendered path does not always enter public history at its first source
 * revision: it enters where every remaining revision renders. That boundary is
 * a fact about the public repository an operator would otherwise have to find
 * by diffing it, so the landing says it.
 *
 * The paths named first are the ones whose entry MOVED — where a revision the
 * projector could have rendered was held back because a later one could not.
 * That is the shape a shared document takes when an edit removes the
 * public-variant directives it carries, and it is the case worth a human's
 * attention; a path that simply predates its recipe is ordinary.
 */
export function describeEntryBoundaries(summary) {
  const boundaries = summary.entryBoundaries ?? [];
  if (boundaries.length === 0) return null;
  const moved = boundaries.filter(boundary => boundary.renderableSkipped > 0);
  const named = moved.length > 0 ? moved : boundaries;
  const shown = named
    .slice(0, ENTRY_SHOWN)
    .map(
      boundary =>
        `${boundary.path} enters at ${boundary.entryCommit.slice(0, 12)}, ` +
        `${boundary.skippedRevisions} earlier revisions do not carry it` +
        (boundary.renderableSkipped > 0
          ? ` (${boundary.renderableSkipped} of them render, held back by ` +
            `${boundary.lastUnrenderableCommit.slice(0, 12)})`
          : '')
    )
    .join('; ');
  const rest = named.length - Math.min(named.length, ENTRY_SHOWN);
  return (
    `${boundaries.length} rendered paths enter public history after their ` +
    `first source revision: ${shown}${rest > 0 ? `, and ${rest} more` : ''}`
  );
}

/**
 * Projects `integratedSha` and fast-forwards the public remote to it.
 *
 * Returns `{ state }` where state is `inert` (no public remote configured),
 * `published`, `pending` (the pair is recorded and the push did not happen),
 * or `refused` (the projection is not a fast-forward; a reseed is owed). It
 * never throws: a landing that already integrated must not be reported as a
 * failure because a derived repository could not be updated.
 */
export async function preparePublicProjection(
  root,
  { integratedSha, resumeFrom: requestedResume = undefined } = {}
) {
  const remote = await resolvePublicRemote(root);
  if (!remote) return { state: 'inert' };

  const startedAt = Date.now();
  const parent = await mkdtemp(path.join(tmpdir(), 'exawatt-public-delivery-'));
  // A credential prompt inside the delivery lock would stall every waiting
  // landing, so the projection's Git operations fail instead of asking.
  const previousPrompt = process.env.GIT_TERMINAL_PROMPT;
  process.env.GIT_TERMINAL_PROMPT = '0';
  try {
    const sourceLock = await readSourceLock(root);
    const epochTransition = await assertReseedEpochTransition(
      root,
      sourceLock,
      integratedSha
    );
    const projection = await projectPublicHistory({
      sourceRepo: root,
      sourceSha: integratedSha,
      destination: path.join(parent, 'public'),
      fastForwardFrom: { repository: remote.url, ref: PUBLIC_BRANCH },
      resumeFrom:
        requestedResume === undefined
          ? latestPublishedPair(sourceLock)
          : requestedResume,
    });
    if (
      epochTransition &&
      (projection.publicSha !== epochTransition.publicSha ||
        projection.emittedCommits !== 0)
    ) {
      throw new Error(
        '[public-delivery] the owed epoch update changed public history; it ' +
          'must project to the exact reseeded tip'
      );
    }
    return {
      state: 'prepared',
      parent,
      remote,
      projection,
      startedAt,
      privateSha: projection.sourceSha,
      publicSha: projection.publicSha,
      previousPublicSha: projection.existingPublicSha,
      changed: projection.existingPublicSha !== projection.publicSha,
      outputCount: projection.outputCount,
      renderedVariants: projection.renderedVariants,
      skippedRevisions: projection.skippedRevisions,
      entryBoundaries: projection.entryBoundaries,
      unrenderedOutputs: projection.unrenderedOutputs.map(
        output => output.path
      ),
      metadataPolicyId: projection.metadataPolicyId,
      projectionContractId: projection.projectionContractId,
    };
  } catch (error) {
    await rm(parent, { recursive: true, force: true });
    throw error;
  } finally {
    if (previousPrompt === undefined) delete process.env.GIT_TERMINAL_PROMPT;
    else process.env.GIT_TERMINAL_PROMPT = previousPrompt;
  }
}

/**
 * Drains a transient split before another private commit may integrate. A
 * deterministic refusal is a hard latch for the reviewed recovery/reseed
 * path; a pending push is retried for the exact already-integrated private
 * master and must publish before the new candidate is considered.
 */
export async function repairPublicProjectionBlocker(
  root,
  { integratedSha, log = console.log, warn = console.warn } = {}
) {
  const remote = await resolvePublicRemote(root);
  if (!remote) return { state: 'clear' };
  const records = await readSourceLock(root);
  const blocker = publicDeliveryPreflightBlocker(records);
  if (blocker?.status === 'reseed-intent') {
    throw new Error(
      `[public-delivery] public projection is latched after ${blocker.status} ` +
        `for ${blocker.privateSha}; repair the contract or complete ` +
        'the reviewed open-source:reseed recovery before another private landing'
    );
  }
  const effectivePair = latestPublishedPair(records);
  const remoteTip = await readPublicRemoteTip(root, remote);
  if (
    !blocker &&
    effectivePair?.privateSha === integratedSha &&
    effectivePair.publicSha === remoteTip
  ) {
    return { state: 'clear' };
  }
  const resumeFrom =
    effectivePair?.publicSha === remoteTip ? effectivePair : null;
  const repair = await projectToPublicRemote(root, {
    integratedSha,
    resumeFrom,
    log,
    warn,
  });
  if (repair.state !== 'published') {
    if (repair.state === 'refused') {
      throw new Error(
        '[public-delivery] deterministic public catch-up refusal latched ' +
          'private master before the new candidate'
      );
    }
    throw new Error(
      '[public-delivery] pending public projection catch-up did not publish; ' +
        'private master remains latched before the new candidate'
    );
  }
  return repair;
}

export async function discardPreparedPublicProjection(prepared) {
  if (prepared?.state !== 'prepared') return;
  await rm(prepared.parent, { recursive: true, force: true });
}

async function recordProjectionSummary(
  root,
  summary,
  { log = console.log, warn = console.warn, record = recordSourceLock } = {}
) {
  summary.durationMs = Date.now() - (summary.startedAt ?? Date.now());
  summary.publicRepository = summary.publicRepository ?? summary.remote?.url;
  try {
    await record(root, {
      status: summary.state,
      privateSha: summary.privateSha,
      publicSha: summary.publicSha ?? null,
      publicRepository: summary.publicRepository,
      metadataPolicyId: summary.metadataPolicyId ?? PUBLIC_METADATA_POLICY_ID,
      projectionContractId:
        summary.projectionContractId ?? PUBLIC_PROJECTION_CONTRACT_ID,
      ...(summary.state === 'published'
        ? {
            previousPublicSha: summary.previousPublicSha,
            changed: summary.changed,
            outputCount: summary.outputCount,
            renderedVariants: summary.renderedVariants,
            skippedRevisions: summary.skippedRevisions,
            entryBoundaries: summary.entryBoundaries,
            unrenderedOutputs: summary.unrenderedOutputs,
          }
        : { reason: summary.reason }),
    });
    summary.recorded = true;
  } catch (error) {
    summary.recorded = false;
    warn(`[public-delivery] the source lock was not written: ${error.message}`);
  }
  await appendDeliveryMetric(root, 'public_projection', {
    state: summary.state,
    privateSha: summary.privateSha,
    publicSha: summary.publicSha ?? null,
    durationMs: summary.durationMs,
  }).catch(() => {});

  if (summary.state === 'published') {
    log(`[public-delivery] ${describeProjection(summary)}`);
    const entries = describeEntryBoundaries(summary);
    if (entries) log(`[public-delivery] ${entries}`);
    const unrendered = describeUnrendered(summary);
    if (unrendered) log(`[public-delivery] ${unrendered}`);
  } else if (summary.state === 'refused') {
    warn(
      '[public-delivery] the public remote is not an ancestor of this ' +
        'projection, so nothing was pushed and nothing was forced. Repair ' +
        'the projection contract; use open-source:reseed only when reviewed ' +
        `public history must be rewritten. ${summary.reason}`
    );
  } else if (summary.state === 'held') {
    warn(
      '[public-delivery] public maintenance hold remains active; private ' +
        `${summary.privateSha} is recorded as owed and no public ref moved`
    );
  } else {
    warn(
      '[public-delivery] the private landing is integrated and the public ' +
        `projection did not publish (recorded public=pending): ${summary.reason}`
    );
  }
  return summary;
}

export async function recordPublicProjectionFailure(
  root,
  {
    privateSha,
    error,
    log = console.log,
    warn = console.warn,
    record = recordSourceLock,
  }
) {
  const message = String(error?.stderr ?? error?.message ?? error).trim();
  return recordProjectionSummary(
    root,
    {
      state: REFUSAL.test(message) ? 'refused' : 'pending',
      privateSha,
      publicSha: null,
      publicRepository: (await resolvePublicRemote(root))?.url ?? null,
      startedAt: Date.now(),
      reason: message,
    },
    { log, warn, record }
  );
}

export async function publishPreparedPublicProjection(
  root,
  prepared,
  {
    log = console.log,
    warn = console.warn,
    record = recordSourceLock,
    readTip = readPublicRemoteTip,
    push = async preparedProjection =>
      execFileAsync(
        'git',
        publicPushArgs({ url: preparedProjection.remote.url }),
        {
          cwd: preparedProjection.projection.destination,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        }
      ),
  } = {}
) {
  if (prepared?.state === 'inert') return prepared;
  if (prepared?.state === 'held') {
    return recordProjectionSummary(root, prepared, { log, warn, record });
  }
  if (prepared?.state !== 'prepared') {
    throw new Error('[public-delivery] expected a prepared projection');
  }
  let summary;
  try {
    const beforePush = await readTip(
      prepared.projection.destination,
      prepared.remote
    );
    if (beforePush !== prepared.previousPublicSha) {
      throw new Error(
        `refusing public delivery because remote ${PUBLIC_BRANCH} moved from ` +
          `${prepared.previousPublicSha ?? '<empty>'} to ${beforePush ?? '<empty>'} after preflight`
      );
    }
    if (prepared.changed) {
      try {
        await push(prepared);
      } catch (error) {
        const afterError = await readTip(
          prepared.projection.destination,
          prepared.remote
        ).catch(() => null);
        if (afterError !== prepared.publicSha) throw error;
      }
    }
    const afterPush = await readTip(
      prepared.projection.destination,
      prepared.remote
    );
    if (afterPush !== prepared.publicSha) {
      throw new Error(
        `refusing public delivery because remote ${PUBLIC_BRANCH} is ` +
          `${afterPush ?? '<empty>'}, not prepared ${prepared.publicSha}`
      );
    }
    summary = {
      state: 'published',
      startedAt: prepared.startedAt,
      privateSha: prepared.privateSha,
      publicSha: prepared.publicSha,
      previousPublicSha: prepared.previousPublicSha,
      changed: prepared.changed,
      outputCount: prepared.outputCount,
      renderedVariants: prepared.renderedVariants,
      skippedRevisions: prepared.skippedRevisions,
      entryBoundaries: prepared.entryBoundaries,
      unrenderedOutputs: prepared.unrenderedOutputs,
      metadataPolicyId: prepared.metadataPolicyId,
      projectionContractId: prepared.projectionContractId,
      publicRepository: prepared.remote.url,
    };
  } catch (error) {
    const message = String(error?.stderr ?? error?.message ?? error).trim();
    summary = {
      state: REFUSAL.test(message) ? 'refused' : 'pending',
      privateSha: prepared.privateSha,
      publicSha: prepared.publicSha,
      publicRepository: prepared.remote.url,
      startedAt: prepared.startedAt,
      reason: message,
      metadataPolicyId: prepared.metadataPolicyId,
      projectionContractId: prepared.projectionContractId,
    };
  } finally {
    await discardPreparedPublicProjection(prepared);
  }
  return recordProjectionSummary(root, summary, { log, warn, record });
}

export async function projectToPublicRemote(
  root,
  {
    integratedSha,
    resumeFrom = undefined,
    log = console.log,
    warn = console.warn,
  } = {}
) {
  let prepared;
  try {
    prepared = await preparePublicProjection(root, {
      integratedSha,
      resumeFrom,
    });
  } catch (error) {
    return recordPublicProjectionFailure(root, {
      privateSha: integratedSha,
      error,
      log,
      warn,
    });
  }
  return publishPreparedPublicProjection(root, prepared, { log, warn });
}
