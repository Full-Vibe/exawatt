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

export const SOURCE_LOCK_SCHEMA_VERSION = 1;
export const SOURCE_LOCK_FILE = 'public-source-lock.jsonl';

/**
 * `published` — the pair reached the public remote.
 * `pending`   — the private landing is integrated and the public push did not
 *               happen (network, outage, a missing projector dependency). The
 *               next landing's projection fast-forwards past both, so nothing
 *               needs replay.
 * `refused`   — the projection is not a fast-forward of the public remote.
 *               Only `open-source:reseed` can resolve it, and it is the only
 *               path that may force.
 * `reseeded`  — a deliberate, reasoned non-fast-forward publication.
 */
export const SOURCE_LOCK_STATUSES = new Set([
  'published',
  'pending',
  'refused',
  'reseeded',
]);

const SHA = /^[0-9a-f]{40}$/u;

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
  if (entry.status === 'published' && entry.publicSha === null) {
    throw new Error('[public-source-lock] a published pair needs a publicSha');
  }
  if (
    (entry.status === 'refused' || entry.status === 'reseeded') &&
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
