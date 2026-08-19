import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { appendDeliveryMetric } from './delivery-state.mjs';
import { projectPublicHistory } from './public-projection.mjs';
import { recordSourceLock } from './public-source-lock.mjs';

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
const REFUSAL = /refusing a non-fast-forward projection/u;
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
export async function projectToPublicRemote(
  root,
  { integratedSha, log = console.log, warn = console.warn } = {}
) {
  const remote = await resolvePublicRemote(root);
  if (!remote) return { state: 'inert' };

  const startedAt = Date.now();
  const parent = await mkdtemp(path.join(tmpdir(), 'exawatt-public-delivery-'));
  // A credential prompt inside the delivery lock would stall every waiting
  // landing, so the projection's Git operations fail instead of asking.
  const previousPrompt = process.env.GIT_TERMINAL_PROMPT;
  process.env.GIT_TERMINAL_PROMPT = '0';
  let summary = { state: 'pending', privateSha: integratedSha };
  try {
    const projection = await projectPublicHistory({
      sourceRepo: root,
      sourceSha: integratedSha,
      destination: path.join(parent, 'public'),
      fastForwardFrom: { repository: remote.url, ref: PUBLIC_BRANCH },
    });
    const changed = projection.existingPublicSha !== projection.publicSha;
    if (changed) {
      await execFileAsync('git', publicPushArgs({ url: remote.url }), {
        cwd: projection.destination,
      });
    }
    summary = {
      state: 'published',
      privateSha: projection.sourceSha,
      publicSha: projection.publicSha,
      previousPublicSha: projection.existingPublicSha,
      changed,
      outputCount: projection.outputCount,
      renderedVariants: projection.renderedVariants,
      skippedRevisions: projection.skippedRevisions,
      entryBoundaries: projection.entryBoundaries,
      unrenderedOutputs: projection.unrenderedOutputs.map(
        output => output.path
      ),
    };
  } catch (error) {
    const message = String(error?.stderr ?? error?.message ?? error).trim();
    summary = {
      state: REFUSAL.test(message) ? 'refused' : 'pending',
      privateSha: integratedSha,
      publicSha: null,
      reason: message,
    };
  } finally {
    if (previousPrompt === undefined) delete process.env.GIT_TERMINAL_PROMPT;
    else process.env.GIT_TERMINAL_PROMPT = previousPrompt;
    await rm(parent, { recursive: true, force: true });
  }

  summary.durationMs = Date.now() - startedAt;
  summary.publicRepository = remote.url;
  await recordSourceLock(root, {
    status: summary.state,
    privateSha: summary.privateSha,
    publicSha: summary.publicSha ?? null,
    publicRepository: remote.url,
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
  }).catch(error => {
    warn(`[public-delivery] the source lock was not written: ${error.message}`);
  });
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
        'projection, so nothing was pushed and nothing was forced. A ' +
        'reclassified manifest is a deliberate reseed: run ' +
        `pnpm open-source:reseed. ${summary.reason}`
    );
  } else {
    warn(
      '[public-delivery] the private landing is integrated and the public ' +
        `projection did not publish (recorded public=pending): ${summary.reason}`
    );
  }
  return summary;
}
