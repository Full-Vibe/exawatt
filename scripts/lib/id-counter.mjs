import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { peekOriginMaster } from './conflict-probe.mjs';
import { acquireDirectoryLock } from './delivery-lock.mjs';
import { listTickets, TERMINAL_TICKET_STATUSES } from './delivery-queue.mjs';
import {
  deliveryStateRoot,
  readJson,
  writeJsonAtomic,
} from './delivery-state.mjs';

/**
 * One counter for the ids the engineering logs allocate (BUG-203).
 *
 * In 4 of September's 13 same-anchor insertion conflicts both sides had taken
 * the same BUG, D, incident or decision number, and two incidents still
 * share `0023`. "Take the next free id" read from the docs is a race every
 * concurrent session loses to the one that lands first.
 *
 * `pnpm id:next <kind>` allocates atomically under the common git directory,
 * like `next-ticket.json`: the short lock is held only while the counter
 * advances. Each allocation is at least one past the highest id on origin's
 * `master` and in every ticket still in the queue, so a counter that is
 * missing, stale, or bypassed by a hand-picked id can never hand out an id
 * that already exists there.
 */

const execFileAsync = promisify(execFile);

export const ID_KINDS = Object.freeze({
  BUG: { format: n => `BUG-${n}` },
  D: { format: n => `D${n}` },
  incident: { format: n => String(n).padStart(4, '0') },
  decision: { format: n => String(n).padStart(4, '0') },
});

async function git(root, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim();
}

/** `git grep -o` over several commits; no match is an empty list, not an error. */
async function grepAll(
  root,
  pattern,
  commits,
  pathspecs,
  { word = false } = {}
) {
  try {
    return (
      await git(root, [
        'grep',
        '-h',
        '-o',
        '-I',
        ...(word ? ['-w'] : []),
        '-E',
        pattern,
        ...commits,
        '--',
        ...pathspecs,
      ])
    )
      .split('\n')
      .filter(Boolean);
  } catch (error) {
    if (error?.code === 1) return [];
    throw error;
  }
}

async function numberedFiles(root, commits, directory) {
  const numbers = [];
  for (const commit of commits) {
    const names = await git(root, [
      'ls-tree',
      '--name-only',
      `${commit}:${directory}`,
    ]).catch(() => '');
    for (const name of names.split('\n')) {
      const match = /^(\d{4})-/u.exec(name);
      if (match) numbers.push(Number(match[1]));
    }
  }
  return numbers;
}

/** The highest id of `kind` any of `commits` carries, or 0. */
async function highestId(root, kind, commits) {
  let numbers;
  if (kind === 'BUG') {
    numbers = (await grepAll(root, 'BUG-[0-9]+', commits, ['.'])).map(match =>
      Number(match.slice(4))
    );
  } else if (kind === 'D') {
    numbers = (
      await grepAll(
        root,
        'D[0-9]{1,3}',
        commits,
        ['docs/engineering/roadmap.md', 'docs/engineering/projects'],
        { word: true }
      )
    ).map(match => Number(match.slice(1)));
  } else if (kind === 'incident') {
    numbers = await numberedFiles(root, commits, 'docs/engineering/incidents');
  } else if (kind === 'decision') {
    numbers = await numberedFiles(root, commits, 'docs/engineering/decisions');
  } else {
    throw new Error(
      `unknown id kind ${kind}; use one of ${Object.keys(ID_KINDS).join(', ')}`
    );
  }
  return numbers.reduce((highest, number) => Math.max(highest, number), 0);
}

/**
 * The commits whose ids are already taken: origin's `master` (read fresh when
 * the network allows, without touching the shared remote-tracking ref) and
 * every attempt still in the queue.
 */
async function takenCommits(root, { fetch = true } = {}) {
  let master = null;
  let fresh = false;
  if (fetch) {
    try {
      master = await peekOriginMaster(root);
      fresh = true;
    } catch {
      master = null;
    }
  }
  master ??= await git(root, ['rev-parse', '--verify', 'origin/master']);
  const inFlight = (await listTickets(root))
    .filter(ticket => !TERMINAL_TICKET_STATUSES.has(ticket.status))
    .map(ticket => ticket.attemptSha)
    .filter(Boolean);
  const present = [];
  for (const sha of inFlight) {
    try {
      await git(root, ['cat-file', '-e', `${sha}^{commit}`]);
      present.push(sha);
    } catch {
      // An attempt this clone never fetched cannot be read; its ids are
      // still protected by the counter itself.
    }
  }
  return { commits: [...new Set([master, ...present])], fresh };
}

/**
 * Allocates the next `count` ids of `kind`. Returns the formatted ids, the
 * number the counter now holds, and whether origin's master was read fresh.
 */
export async function allocateIds(
  root,
  kind,
  { count = 1, fetch = true } = {}
) {
  if (!ID_KINDS[kind]) {
    throw new Error(
      `unknown id kind ${kind}; use one of ${Object.keys(ID_KINDS).join(', ')}`
    );
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('--count must be a positive integer');
  }
  const { commits, fresh } = await takenCommits(root, { fetch });
  const stateRoot = await deliveryStateRoot(root);
  const lock = await acquireDirectoryLock(
    path.join(stateRoot, 'id-counter.lock'),
    {
      description: 'id counter',
      timeoutMs: 30_000,
      pollMs: 20,
      log() {},
    }
  );
  try {
    // Read inside the lock: a concurrent allocation may have advanced it.
    const counterPath = path.join(stateRoot, 'next-id.json');
    const counter = await readJson(counterPath, {});
    const seed = (await highestId(root, kind, commits)) + 1;
    const first = Math.max(counter[kind] ?? 0, seed);
    const next = first + count;
    await writeJsonAtomic(counterPath, {
      ...counter,
      [kind]: next,
      updatedAt: new Date().toISOString(),
    });
    return {
      ids: Array.from({ length: count }, (_, index) =>
        ID_KINDS[kind].format(first + index)
      ),
      next,
      fresh,
    };
  } finally {
    await lock.release();
  }
}
