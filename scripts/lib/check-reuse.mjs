import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  deliveryStateRoot,
  readJson,
  writeJsonAtomic,
} from './delivery-state.mjs';

const execFileAsync = promisify(execFile);

/**
 * Landing-check result reuse (ENG-022, 2026-10-15).
 *
 * On 2026-10-15, 277 of 1,385 landing-check minutes re-ran a check that had
 * already passed on the byte-identical tree: a landing failed at a later
 * check (a load-sensitive `test:agent-delivery`, a surface gate), the author
 * resubmitted the same commit, and every check before the failure ran again.
 * A recorded pass is reused only when everything that check reads is
 * provably the same, so a reuse can never stand in for a different input:
 *
 * - the key is a SHA-256 over content hashes, never timestamps: the git tree
 *   of the exact committed HEAD, the exact command and arguments, the
 *   installed dependency lock, the Node version and platform, the worktree's
 *   real path, and the environment variables that change what a check
 *   proves;
 * - only checks listed in `REUSABLE_CHECKS` are eligible. Surface gates and
 *   evals (they read a dev server or a packaged app), checks whose output a
 *   later step consumes (`type-check` builds the core runtime the delivery
 *   suite loads; `electron:compile`; the community build), and
 *   caller-declared extras always run;
 * - only a clean worktree reuses or records, and a pass is recorded only if
 *   the worktree is still clean after the check, so a check that dirties the
 *   tree is never excused by its own earlier pass;
 * - a failed, flaked or unreadable record is a miss, never a pass.
 *
 * `EXAWATT_CHECK_REUSE=0` turns reuse off; every check then runs.
 */
const REUSE_SCHEMA = 1;
const RECORD_TTL_MS = 3 * 24 * 60 * 60_000;

/** The environment that changes what a check proves. */
const KEY_ENVIRONMENT =
  /^(?:EXAWATT_DISTRIBUTION\w*|NODE_OPTIONS|NODE_ENV|CI|TZ)$/u;

/**
 * Eligible checks. Each reads the committed tree, so the key carries the
 * whole tree: a pass is reused on the identical tree (a resubmitted or retried
 * commit), never across a rebase. Path-scoping a check's inputs is sound only
 * when the check provably reads nothing else; none of these can show that
 * today (lint and type-check are whole-program, the related Vitest selection
 * follows the import graph, and several delivery pins read the whole tree).
 */
export const REUSABLE_CHECKS = new Set([
  'open-source:paths:check',
  'content:scan',
  'lint',
  // Not `type-check`: it also builds @exawatt/core's runtime, which the
  // delivery suite after it loads, so it runs on every landing to keep that
  // runtime the tree's own.
  'test:agent-delivery',
  'delivery-pins',
  'exports:check',
  'vitest-related',
  // ENG-039's module checks: each reads only the committed tree it names.
  'lint:modules',
  'modules:check',
  'module-tests',
  'full-suite',
  'copy:check',
  'theme:check',
  'eval-handles:check',
  'scanning-tests',
  'agent-sources:check',
  'icon:check',
  'company:proof',
  'verify:community-runtime',
  'test:service-conformance',
  'recipe-renderers',
]);

async function git(root, ...args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

async function isClean(root) {
  return (
    (
      await git(root, 'status', '--porcelain', '--untracked-files=normal')
    ).trim() === ''
  );
}

async function installedLockDigest(root) {
  // pnpm's own copy of the lockfile it installed, so the key names the
  // dependencies actually on disk rather than the ones the tree asks for.
  try {
    const content = await readFile(
      path.join(root, 'node_modules', '.pnpm', 'lock.yaml')
    );
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return 'absent';
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Opens a reuse session for one landing-check run on `root`. Returns a
 * session whose `lookup` and `record` are no-ops when reuse is off or the
 * worktree is not clean.
 */
export async function openCheckReuse(root, { env = process.env } = {}) {
  const disabled = {
    async lookup() {
      return null;
    },
    async record() {},
  };
  if (env.EXAWATT_CHECK_REUSE === '0') return disabled;
  let context;
  try {
    if (!(await isClean(root))) return disabled;
    const [tree, worktree, installed, stateRoot] = await Promise.all([
      git(root, 'rev-parse', 'HEAD^{tree}').then(value => value.trim()),
      realpath(root),
      installedLockDigest(root),
      deliveryStateRoot(root),
    ]);
    context = {
      tree,
      worktree,
      installed,
      directory: path.join(stateRoot, 'check-passes'),
      environment: Object.keys(env)
        .filter(name => KEY_ENVIRONMENT.test(name))
        .sort()
        .map(name => [name, env[name]]),
    };
  } catch {
    return disabled;
  }

  const keyFor = check => {
    if (!REUSABLE_CHECKS.has(check.id)) return null;
    return sha256(
      JSON.stringify({
        schema: REUSE_SCHEMA,
        id: check.id,
        command: check.command,
        args: check.args,
        tree: context.tree,
        installed: context.installed,
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        worktree: context.worktree,
        environment: context.environment,
      })
    );
  };

  return {
    /** The recorded pass this check may reuse, or null. */
    async lookup(check) {
      try {
        const key = keyFor(check);
        if (!key) return null;
        const record = await readJson(
          path.join(context.directory, `${key}.json`)
        );
        if (record?.status !== 'passed' || record.key !== key) return null;
        return record;
      } catch {
        return null;
      }
    },
    /** Records a pass, only while the worktree is still clean. */
    async record(check, { candidateSha }) {
      try {
        const key = keyFor(check);
        if (!key || !(await isClean(root))) return;
        await writeJsonAtomic(path.join(context.directory, `${key}.json`), {
          schemaVersion: REUSE_SCHEMA,
          key,
          id: check.id,
          status: 'passed',
          candidateSha,
          tree: context.tree,
          at: new Date().toISOString(),
        });
        await pruneRecords(context.directory);
      } catch {
        // A pass that could not be recorded only costs a later re-run.
      }
    },
  };
}

let prunedAt = 0;
async function pruneRecords(directory) {
  if (Date.now() - prunedAt < 60 * 60_000) return;
  prunedAt = Date.now();
  for (const name of await readdir(directory)) {
    const file = path.join(directory, name);
    const { mtimeMs } = await stat(file).catch(() => ({ mtimeMs: Date.now() }));
    if (Date.now() - mtimeMs > RECORD_TTL_MS) await rm(file, { force: true });
  }
}
