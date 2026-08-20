/**
 * Machine-wide slots for heavy work (ENG-022 H15). Every concurrent agent
 * worktree politely caps ITS OWN vitest run at 25% of cores, so a dozen
 * agents oversubscribe the machine threefold and the same check that takes
 * 9 seconds alone takes 46 minutes under load (delivery metrics, 2026-08-19).
 * A bounded pool of slots — the jobserver pattern, and the multi-slot
 * generalization of the Electron eval harness's single machine lock — turns
 * that thrash into short queues: work that starts gets real cores.
 *
 * Semantics mirror the delivery lock: mkdir-as-lock with an owner file,
 * dead-PID-only reclamation, reentrancy through an inherited token so a
 * slotted parent's child commands never wait on a second slot, and a
 * deadline that proceeds UNSLOTTED with a loud warning rather than failing
 * the work — a leaked slot must never be able to stop the fleet.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';

import { commonGitDirectory, processExists } from './delivery-lock.mjs';

const SLOT_TOKEN_ENV = 'EXAWATT_MACHINE_SLOT_TOKEN';
const SLOT_COUNT_ENV = 'EXAWATT_MACHINE_SLOTS';
const OWNER_FILE = 'owner.json';
// An ownerless slot directory this old is a crashed acquisition, not a
// racing one (same grace the delivery lock uses).
const INCOMPLETE_OWNER_GRACE_MS = 5_000;

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export function defaultSlotCount(env = process.env) {
  const configured = Number.parseInt(env[SLOT_COUNT_ENV] ?? '', 10);
  if (Number.isInteger(configured) && configured >= 0) return configured;
  return Math.max(1, Math.min(3, Math.floor(availableParallelism() / 4)));
}

export async function machineSlotPaths({
  root = process.cwd(),
  slotCount,
  baseDir,
} = {}) {
  const count = slotCount ?? defaultSlotCount();
  if (baseDir) {
    return Array.from({ length: count }, (_, i) =>
      path.join(baseDir, `slot-${i}.lock`)
    );
  }
  const repositoryKey = createHash('sha256')
    .update(await commonGitDirectory(root))
    .digest('hex')
    .slice(0, 16);
  return Array.from({ length: count }, (_, i) =>
    path.join(tmpdir(), `exawatt-machine-slot-${repositoryKey}-${i}.lock`)
  );
}

async function readOwner(slotPath) {
  try {
    return JSON.parse(await readFile(path.join(slotPath, OWNER_FILE), 'utf8'));
  } catch {
    return null;
  }
}

async function slotAge(slotPath) {
  try {
    return Date.now() - (await stat(slotPath)).mtimeMs;
  } catch {
    return null;
  }
}

async function tryAcquireSlotPath(slotPath, owner) {
  try {
    await mkdir(slotPath);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    // Held — unless the holder is dead, or the acquisition crashed before
    // writing its owner. An UNREADABLE owner inside the grace window counts
    // as held: a failed read must never look like a free slot.
    const current = await readOwner(slotPath);
    if (current && processExists(current.pid)) return false;
    if (
      !current &&
      ((await slotAge(slotPath)) ?? 0) <= INCOMPLETE_OWNER_GRACE_MS
    )
      return false;
    await rm(slotPath, { recursive: true, force: true });
    try {
      await mkdir(slotPath);
    } catch {
      return false; // someone else won the reclaimed slot
    }
  }
  await writeFile(
    path.join(slotPath, OWNER_FILE),
    `${JSON.stringify(owner, null, 2)}\n`
  );
  return true;
}

async function describeHolders(slotPaths) {
  const holders = [];
  for (const slotPath of slotPaths) {
    const owner = await readOwner(slotPath);
    if (owner) holders.push(`pid ${owner.pid} (${owner.label ?? 'unlabeled'})`);
  }
  return holders.length ? holders.join(', ') : 'unreadable holders';
}

/**
 * Acquire one machine slot. Resolves with:
 *   { mode: 'acquired'|'reentrant'|'disabled'|'unslotted', waitedMs, release() }
 * 'disabled'  — EXAWATT_MACHINE_SLOTS=0 opted this machine out.
 * 'reentrant' — an ancestor process already holds a slot; its token was
 *               inherited, so this work is already budgeted.
 * 'unslotted' — the deadline passed; the work proceeds anyway, loudly.
 * release() is idempotent and safe in every mode.
 */
export async function acquireMachineSlot({
  root = process.cwd(),
  label = 'heavy work',
  log = message => console.log(message),
  env = process.env,
  slotCount,
  baseDir,
  pollMs = 500,
  deadlineMs = 20 * 60_000,
} = {}) {
  const count = slotCount ?? defaultSlotCount(env);
  if (count === 0) {
    return { mode: 'disabled', waitedMs: 0, async release() {} };
  }
  if (env[SLOT_TOKEN_ENV]) {
    return { mode: 'reentrant', waitedMs: 0, async release() {} };
  }

  // QoS, never a gate: if the pool itself cannot be resolved (not a git
  // repository, unreadable tmpdir), the work proceeds unslotted and says so.
  // The same posture as the Electron eval lock: never let locking fail a run.
  let slotPaths;
  try {
    slotPaths = await machineSlotPaths({ root, slotCount: count, baseDir });
  } catch (error) {
    log(
      `[machine-slots] slot pool unavailable (${error?.message ?? error}) — ` +
        'proceeding UNSLOTTED'
    );
    return { mode: 'unslotted', waitedMs: 0, async release() {} };
  }
  const token = randomUUID();
  const owner = {
    token,
    pid: process.pid,
    label,
    acquiredAt: new Date().toISOString(),
  };
  const startedAt = Date.now();
  let announcedWait = false;

  while (true) {
    for (const slotPath of slotPaths) {
      let won;
      try {
        won = await tryAcquireSlotPath(slotPath, owner);
      } catch (error) {
        log(
          `[machine-slots] slot pool unavailable (${error?.message ?? error}) — ` +
            'proceeding UNSLOTTED'
        );
        return {
          mode: 'unslotted',
          waitedMs: Date.now() - startedAt,
          async release() {},
        };
      }
      if (won) {
        env[SLOT_TOKEN_ENV] = token;
        let released = false;
        return {
          mode: 'acquired',
          waitedMs: Date.now() - startedAt,
          async release() {
            if (released) return;
            released = true;
            if (env[SLOT_TOKEN_ENV] === token) delete env[SLOT_TOKEN_ENV];
            const current = await readOwner(slotPath);
            if (current?.token === token) {
              await rm(slotPath, { recursive: true, force: true });
            }
          },
        };
      }
    }
    if (Date.now() - startedAt >= deadlineMs) {
      log(
        `[machine-slots] waited ${Math.round((Date.now() - startedAt) / 1000)}s ` +
          `for a slot for ${label}; all ${count} held (${await describeHolders(slotPaths)}) — ` +
          'proceeding UNSLOTTED'
      );
      return {
        mode: 'unslotted',
        waitedMs: Date.now() - startedAt,
        async release() {},
      };
    }
    if (!announcedWait) {
      log(
        `[machine-slots] all ${count} machine slots busy — ${label} is waiting ` +
          `(holders: ${await describeHolders(slotPaths)})`
      );
      announcedWait = true;
    }
    await delay(pollMs);
  }
}
