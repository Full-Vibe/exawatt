import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';

import { deliveryStateRoot } from './delivery-state.mjs';

/**
 * The source lock: the stored `{privateSha, publicSha}` pairs the projector
 * produced, one append-only record per projection attempt.
 *
 * It is provenance, not authority. The projection is a pure function of source
 * history, so the mapping can always be recomputed; the lock is what makes it
 * a CHECKED record — which private commit became which public commit, when,
 * against which public repository, and what the public repository did not
 * receive because a recipe has no renderer yet.
 *
 * It lives with the rest of the delivery state under the common Git directory
 * rather than as a tracked file, for one structural reason: the projector runs
 * after the private `master` push, inside the delivery lock. A tracked lock
 * file would need a commit AFTER that push — dirtying the landed tree,
 * creating an unlanded commit, and demanding a projection of its own. An
 * append-only record next to `metrics.jsonl` is shared by every worktree of
 * the clone and needs no commit.
 */

export const SOURCE_LOCK_SCHEMA_VERSION = 2;
export const SOURCE_LOCK_FILE = 'public-source-lock.jsonl';

/**
 * `published` — the pair reached the public remote.
 * `pending`   — the private landing is integrated and the public push did not
 *               happen (network, outage, a missing projector dependency). The
 *               failed source must be repaired before another integration.
 * `refused`   — the prepared projection is not a fast-forward of the public
 *               remote. New integration stays latched until a corrected
 *               projection publishes or a deliberate reseed resolves it.
 * `reseeded`  — a deliberate, reasoned non-fast-forward publication.
 * `reseed-intent` — the lease-protected destructive transition is armed (and
 *                   may already have reached the remote); delivery stays
 *                   latched until postconditions append `reseeded`.
 */
export const SOURCE_LOCK_STATUSES = new Set([
  'published',
  'pending',
  'refused',
  'held',
  'reseed-intent',
  'reseeded',
]);

const SHA = /^[0-9a-f]{40}$/u;
const BLOCKING_STATUSES = new Set(['pending', 'refused', 'reseed-intent']);

export async function sourceLockPath(root) {
  return path.join(await deliveryStateRoot(root), SOURCE_LOCK_FILE);
}

export function validateSourceLockEntry(entry) {
  if (!SOURCE_LOCK_STATUSES.has(entry?.status)) {
    throw new Error(
      `[public-source-lock] unknown status ${String(entry?.status)}`
    );
  }
  if (!SHA.test(entry.privateSha ?? '')) {
    throw new Error('[public-source-lock] privateSha must be a full commit id');
  }
  if (entry.publicSha !== null && !SHA.test(entry.publicSha ?? '')) {
    throw new Error(
      '[public-source-lock] publicSha must be a full commit id or null'
    );
  }
  if (
    (entry.status === 'published' ||
      entry.status === 'reseeded' ||
      entry.status === 'reseed-intent') &&
    entry.publicSha === null
  ) {
    throw new Error(
      `[public-source-lock] a ${entry.status} pair needs a publicSha`
    );
  }
  if (entry.schemaVersion >= 2) {
    if (
      typeof entry.metadataPolicyId !== 'string' ||
      entry.metadataPolicyId.length === 0
    ) {
      throw new Error('[public-source-lock] schema 2 needs metadataPolicyId');
    }
    if (
      typeof entry.projectionContractId !== 'string' ||
      entry.projectionContractId.length === 0
    ) {
      throw new Error(
        '[public-source-lock] schema 2 needs projectionContractId'
      );
    }
  }
  if (
    (entry.status === 'refused' ||
      entry.status === 'reseeded' ||
      entry.status === 'reseed-intent') &&
    typeof entry.reason !== 'string'
  ) {
    throw new Error(`[public-source-lock] ${entry.status} needs a reason`);
  }
  return entry;
}

export async function recordSourceLock(root, entry) {
  const record = validateSourceLockEntry({
    schemaVersion: SOURCE_LOCK_SCHEMA_VERSION,
    at: new Date().toISOString(),
    publicSha: null,
    ...entry,
  });
  await appendFile(await sourceLockPath(root), `${JSON.stringify(record)}\n`);
  return record;
}

export async function readSourceLock(root) {
  try {
    return (await readFile(await sourceLockPath(root), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

/** The most recent pair that actually reached the public repository. */
export function latestPublishedPair(records) {
  return (
    [...records]
      .reverse()
      .find(
        record => record.status === 'published' || record.status === 'reseeded'
      ) ?? null
  );
}

/**
 * The unresolved failure, if any, that must be repaired before another private
 * integration proceeds.
 *
 * Source-lock records are append-only. A trailing `pending` or `refused`
 * record therefore latches delivery, while a later `published` or `reseeded`
 * record is the explicit repair that clears it. The helper deliberately does
 * not decide whether a caller is attempting that repair or a new integration;
 * it only exposes the latch so preflight can make that policy decision.
 */
export function publicDeliveryPreflightBlocker(records) {
  const latest = records.at(-1) ?? null;
  return BLOCKING_STATUSES.has(latest?.status) ? latest : null;
}

/**
 * Classifies what the append-only source lock proves about one exact private
 * source commit.
 *
 * `healthy` is intentionally strict: the latest effective publication pair
 * must name the requested source, and no later failed delivery may be hiding
 * behind that older success. This helper does not infer Git ancestry from
 * record order. A caller asking whether a newer projection covers an ancestor
 * should resolve that ancestry first and pass the covered source SHA here.
 *
 * `blocksIntegration` is narrower than `healthy`. An unpublished or stale
 * source is eligible for a catch-up attempt; only an unresolved `pending` or
 * `refused` delivery latches new private integration until a repair publishes.
 */
export function classifySourceLockHealth(records, requestedPrivateSha) {
  if (!Array.isArray(records)) {
    throw new TypeError('[public-source-lock] records must be an array');
  }
  if (!SHA.test(requestedPrivateSha ?? '')) {
    throw new Error(
      '[public-source-lock] requestedPrivateSha must be a full commit id'
    );
  }

  const latestRecord = records.at(-1) ?? null;
  const effectivePair = latestPublishedPair(records);
  const blocker = publicDeliveryPreflightBlocker(records);

  if (blocker) {
    return {
      state: blocker.status,
      healthy: false,
      blocksIntegration: true,
      requestedPrivateSha,
      latestRecord,
      effectivePair,
    };
  }

  if (effectivePair === null) {
    return {
      state: 'unpublished',
      healthy: false,
      blocksIntegration: false,
      requestedPrivateSha,
      latestRecord,
      effectivePair: null,
    };
  }

  const healthy = effectivePair.privateSha === requestedPrivateSha;
  return {
    state: healthy ? 'healthy' : 'stale',
    healthy,
    blocksIntegration: false,
    requestedPrivateSha,
    latestRecord,
    effectivePair,
  };
}
