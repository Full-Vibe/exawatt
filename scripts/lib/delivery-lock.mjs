import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ownerFile = 'owner.json';

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function readOwner(lockPath) {
  try {
    return JSON.parse(await readFile(path.join(lockPath, ownerFile), 'utf8'));
  } catch {
    return null;
  }
}

async function writeOwner(lockPath, owner) {
  const temporaryOwner = path.join(
    lockPath,
    `${ownerFile}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await writeFile(temporaryOwner, `${JSON.stringify(owner, null, 2)}\n`, {
      flag: 'wx',
    });
    await rename(temporaryOwner, path.join(lockPath, ownerFile));
  } finally {
    await rm(temporaryOwner, { force: true });
  }
}

/*
 * The lock directory protocol (BUG-289). Every delivery lock and machine slot
 * is a directory holding `owner.json`, and every transition of it is one
 * rename, so no other process can ever see a half-made or half-removed lock:
 *
 * - Acquire: the owner record is written into a private staging directory,
 *   which is then renamed onto the lock path. A lock path that exists with
 *   content refuses the rename, so the lock appears already owned. (An empty
 *   directory at the lock path is replaced: only the mkdir-then-write
 *   protocol this replaced, or a crash under it, ever left one.)
 * - Release: the holder renames its lock aside before deleting it. Removing
 *   it in place emptied it first, and an empty lock path is one a rename can
 *   take, so a recursive delete could remove the next holder's lock.
 * - Break: a waiter that judges a lock stale (its owner's process is gone, or
 *   it has no owner record past the grace) renames it to a tombstone named by
 *   the directory's inode, and keeps the tombstone. A second waiter that
 *   judged the same lock stale, and acted after the first had broken it and a
 *   new holder had taken the path, now renames onto that tombstone and is
 *   refused, instead of deleting the new holder's lock. A tombstone is aged
 *   from the break, never from the acquisition its directory records (a lock
 *   stale for a day would otherwise be swept by the call that broke it,
 *   reopening the race), and the breaking call never sweeps its own; others
 *   are swept a day after their break.
 *
 * Under mkdir-then-write, a holder starved between creating the directory
 * and writing its owner looked like a crashed acquisition, and a waiter
 * deleted it while the holder went on: twelve id:next callers all received
 * BUG-8 when that window was forced.
 */
const HELD_CODES = new Set(['EEXIST', 'ENOTEMPTY', 'ENOTDIR', 'EISDIR']);
const TOMBSTONE_LIFETIME_MS = 24 * 60 * 60_000;

/** Publishes `owner` at `lockPath` in one rename; false when it is held. */
async function publishLock(lockPath, owner) {
  const staging = `${lockPath}.${process.pid}.${randomUUID()}.acquiring`;
  await mkdir(staging);
  try {
    await writeFile(
      path.join(staging, ownerFile),
      `${JSON.stringify(owner, null, 2)}\n`,
      { flag: 'wx' }
    );
    await rename(staging, lockPath);
    return true;
  } catch (error) {
    if (HELD_CODES.has(error?.code)) return false;
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/**
 * The lock at `lockPath` as one directory: its inode, owner record and age.
 * `null` when there is no lock; `changed` when it was replaced mid-read, so
 * the owner read may belong to another directory.
 */
async function inspectLock(lockPath) {
  const statOrNull = target =>
    stat(target).catch(error => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
  const before = await statOrNull(lockPath);
  if (!before) return null;
  const owner = await readOwner(lockPath);
  const after = await statOrNull(lockPath);
  if (!after || after.ino !== before.ino) return { changed: true };
  return { ino: after.ino, owner, ageMs: Date.now() - after.mtimeMs };
}

/**
 * How long ago a tombstone was made. The break sets its times explicitly, and
 * the rename itself moves its ctime on the filesystems this runs on, so the
 * later of the two is the break, whatever the lock directory recorded.
 */
async function tombstoneAge(tombstone) {
  try {
    const metadata = await stat(tombstone);
    return Date.now() - Math.max(metadata.mtimeMs, metadata.ctimeMs);
  } catch {
    return null;
  }
}

async function sweepTombstones(lockPath, keep) {
  const prefix = `${path.basename(lockPath)}.broken-`;
  const directory = path.dirname(lockPath);
  const names = await readdir(directory).catch(() => []);
  for (const name of names.filter(entry => entry.startsWith(prefix))) {
    const tombstone = path.join(directory, name);
    if (tombstone === keep) continue;
    const age = await tombstoneAge(tombstone);
    if (age !== null && age > TOMBSTONE_LIFETIME_MS) {
      await rm(tombstone, { recursive: true, force: true });
    }
  }
}

/**
 * Moves a lock directory that was taken aside by mistake back to `lockPath`.
 * A failure is thrown, never swallowed: the lock it holds belongs to a live
 * holder, and leaving it aside while another process takes the path is the
 * double holder the protocol exists to prevent.
 */
async function restoreLock(aside, lockPath, why) {
  try {
    await rename(aside, lockPath);
  } catch (error) {
    throw new Error(
      `[delivery-lock] ${why}, and putting it back failed (${error?.code ?? error?.message}): the live holder's lock is at ${aside}, not ${lockPath}. Stop the waiters on ${lockPath} and move it back by hand.`,
      { cause: error }
    );
  }
}

/** Breaks the stale lock `ino`, never another one; see the protocol above. */
async function breakLock(lockPath, ino) {
  const tombstone = `${lockPath}.broken-${ino}`;
  try {
    await rename(lockPath, tombstone);
  } catch (error) {
    if (error?.code === 'ENOENT' || HELD_CODES.has(error?.code)) return;
    throw error;
  }
  const moved = await stat(tombstone).catch(() => null);
  if (moved && moved.ino !== ino) {
    // Not the lock judged stale: an ownerless one was released by a live
    // mkdir-then-write holder and the path retaken. Put it back.
    await restoreLock(
      tombstone,
      lockPath,
      `a waiter moved a lock it had not judged stale (${moved.ino}, not ${ino}) aside`
    );
    return;
  }
  const now = new Date();
  await utimes(tombstone, now, now);
  await sweepTombstones(lockPath, tombstone);
}

/** Releases the lock at `lockPath` if `token` still owns it. */
export async function releaseLock(lockPath, token) {
  const owner = await readOwner(lockPath);
  if (owner?.token !== token) return;
  const released = `${lockPath}.${process.pid}.${randomUUID()}.released`;
  try {
    await rename(lockPath, released);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if ((await readOwner(released))?.token !== token) {
    await restoreLock(
      released,
      lockPath,
      'a release moved a lock it no longer owned aside'
    );
    return;
  }
  await rm(released, { recursive: true, force: true });
}

/**
 * One acquisition attempt that never waits: publishes `owner`, breaking a
 * stale holder first. Returns `{ acquired: true }`, or the live holder.
 */
export async function tryAcquireLock(
  lockPath,
  owner,
  { incompleteOwnerGraceMs = 5_000, hooks = {} } = {}
) {
  while (true) {
    if (await publishLock(lockPath, owner)) {
      await hooks.created?.();
      return { acquired: true };
    }
    const current = await inspectLock(lockPath);
    if (!current) continue;
    if (current.changed) return { acquired: false, holder: null };
    const stale = current.owner
      ? !processExists(current.owner.pid)
      : current.ageMs > incompleteOwnerGraceMs;
    if (!stale || current.owner?.token === owner.token) {
      return { acquired: false, holder: current.owner };
    }
    await hooks.breaking?.(current.owner);
    await breakLock(lockPath, current.ino);
  }
}

export async function commonGitDirectory(root) {
  const { stdout } = await execFileAsync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: root }
  );
  return stdout.trim();
}

export async function deliveryLockPath(root) {
  const commonDirectory = await commonGitDirectory(root);
  const repositoryKey = createHash('sha256')
    .update(commonDirectory)
    .digest('hex')
    .slice(0, 16);
  return path.join(tmpdir(), `exawatt-master-delivery-${repositoryKey}.lock`);
}

export function installationLockPath(target) {
  const targetKey = createHash('sha256')
    .update(path.resolve(target))
    .digest('hex')
    .slice(0, 16);
  return path.join(tmpdir(), `exawatt-app-install-${targetKey}.lock`);
}

export async function acquireDirectoryLock(
  lockPath,
  {
    existingToken,
    timeoutMs = 10 * 60_000,
    pollMs = 250,
    incompleteOwnerGraceMs = 5_000,
    description = 'delivery transaction',
    log = console.log,
    hooks = {},
  } = {}
) {
  const startedAt = Date.now();
  const token = existingToken || randomUUID();
  const owner = {
    token,
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  };
  let announcedWait = false;

  while (true) {
    const attempt = await tryAcquireLock(lockPath, owner, {
      incompleteOwnerGraceMs,
      hooks,
    });
    if (attempt.acquired) {
      return {
        lockPath,
        token,
        reentrant: false,
        release: () => releaseLock(lockPath, token),
      };
    }
    const holder = attempt.holder;
    if (existingToken && holder?.token === existingToken) {
      await writeOwner(lockPath, {
        ...holder,
        pid: process.pid,
        delegatedAt: new Date().toISOString(),
      });
      return {
        lockPath,
        token: existingToken,
        reentrant: true,
        async release() {},
      };
    }
    await hooks.contended?.(holder);

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(
        `Timed out waiting for the ${description}${holder?.pid ? ` owned by process ${holder.pid}` : ''}.`
      );
    }
    if (!announcedWait) {
      log(`[delivery-lock] waiting for the active ${description}`);
      announcedWait = true;
    }
    await delay(pollMs);
  }
}

export async function acquireDeliveryLock(root, options = {}) {
  return acquireDirectoryLock(await deliveryLockPath(root), {
    existingToken: process.env.EXAWATT_MASTER_DELIVERY_LOCK_TOKEN,
    description: 'master delivery transaction',
    ...options,
  });
}

export async function acquireInstallationLock(target, options = {}) {
  return acquireDirectoryLock(installationLockPath(target), {
    description: `installation transaction for ${target}`,
    ...options,
  });
}
