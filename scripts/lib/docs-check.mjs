import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import { classifyDocsChecks } from './delivery-policy.mjs';

/**
 * `pnpm docs:check` and the pre-push hook that enforces it (BUG-195).
 *
 * A small docs-only promotion may be committed straight to `master` from the
 * checkout the operator is talking to, because the answer to his question
 * should not wait for a landing. That path skipped every landing check, and
 * three times the skipped checks would have refused the change: two
 * public-variant directives the projector rejects (BUG-131) and a doubled
 * blank line that made the public roadmap render with a seam (`0cbcb226`).
 * Each time the next queued landing found it, on someone else's change.
 *
 * This runs the landing checks a documentation change can fail, taken from
 * `classifyDocsChecks` so they are the floor's own definitions, in parallel,
 * without a machine slot: it has to stay fast enough to sit in front of a
 * push.
 */

const execFileAsync = promisify(execFile);

export const PUSH_GUARD_REMOTE = 'origin';
export const PUSH_GUARD_REF = 'refs/heads/master';

/**
 * Set by `agent:land` on its final push to the SHA its floor just verified.
 * It excuses exactly that commit, so it is not a general bypass: any other
 * SHA, or no variable, runs the check.
 */
export const FLOOR_VERIFIED_ENV = 'EXAWATT_AGENT_LAND_FLOOR_SHA';

const ZERO_SHA = /^0+$/u;

/** Variables git exports to a hook that would aim a child at a fixed repo. */
const REPOSITORY_LOCATORS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_PREFIX',
];

export function isDocsPath(file) {
  return file.endsWith('.md') || file.startsWith('docs/');
}

async function git(root, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

function lines(output) {
  return output ? output.split('\n').filter(Boolean) : [];
}

/**
 * What a commit made from this checkout would change: tracked edits against
 * the base (staged or not) plus untracked, unignored files.
 */
export async function workingTreeChangedPaths(root, base) {
  const [tracked, untracked] = await Promise.all([
    git(root, ['diff', '--name-only', base]),
    git(root, ['ls-files', '--others', '--exclude-standard']),
  ]);
  return [...new Set([...lines(tracked), ...lines(untracked)])].sort();
}

export async function defaultDocsBase(root) {
  try {
    return await git(root, ['merge-base', 'HEAD', 'origin/master']);
  } catch {
    return 'HEAD';
  }
}

function childEnv(env) {
  const next = { ...env };
  for (const name of REPOSITORY_LOCATORS) delete next[name];
  return next;
}

function runCheck(root, check, env) {
  const startedAt = Date.now();
  return new Promise(resolve => {
    const chunks = [];
    const child = spawn(check.command, check.args, {
      cwd: root,
      env: childEnv(env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => chunks.push(chunk));
    const finish = (status, extra = '') =>
      resolve({
        id: check.id,
        command: [check.command, ...check.args].join(' '),
        status,
        durationMs: Date.now() - startedAt,
        output: Buffer.concat(chunks).toString('utf8') + extra,
      });
    child.once('error', error => finish('failed', `\n${error.message}\n`));
    child.once('close', code => finish(code === 0 ? 'passed' : 'failed'));
  });
}

/** Runs the docs subset of the floor for these changed paths, in parallel. */
export async function runDocsChecks({ root, paths, env = process.env }) {
  const checks = classifyDocsChecks(paths);
  return Promise.all(checks.map(check => runCheck(root, check, env)));
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** The report a person reads: every check's verdict, then each failure. */
export function formatDocsCheckReport(results) {
  const failed = results.filter(result => result.status !== 'passed');
  const out = results.map(
    result =>
      `[docs:check] ${result.status === 'passed' ? 'passed' : 'FAILED'} ${result.id} (${seconds(result.durationMs)})`
  );
  for (const result of failed) {
    out.push('', `[docs:check] ${result.id}: ${result.command}`);
    out.push(result.output.trimEnd());
  }
  return out.join('\n') + '\n';
}

export function parsePushUpdates(text) {
  return lines(text).map(line => {
    const [localRef, localSha, remoteRef, remoteSha] = line.split(' ');
    return { localRef, localSha, remoteRef, remoteSha };
  });
}

async function commitExists(root, sha) {
  try {
    await git(root, ['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** What the remote ref will change: a tree diff when its tip is known here. */
async function pushedPaths(root, update) {
  if (
    !ZERO_SHA.test(update.remoteSha) &&
    (await commitExists(root, update.remoteSha))
  ) {
    return lines(
      await git(root, [
        'diff',
        '--name-only',
        update.remoteSha,
        update.localSha,
      ])
    );
  }
  return lines(
    await git(root, [
      'log',
      '--format=',
      '--name-only',
      update.localSha,
      '--not',
      '--remotes',
    ])
  );
}

async function isGuardedRemote(root, remoteName, remoteUrl) {
  if (remoteName === PUSH_GUARD_REMOTE) return true;
  try {
    const guardedUrl = await git(root, [
      'remote',
      'get-url',
      '--push',
      PUSH_GUARD_REMOTE,
    ]);
    return guardedUrl === remoteUrl;
  } catch {
    return false;
  }
}

function refusal(reason, detail) {
  return { verdict: 'refuse', reason, detail };
}

/**
 * The pre-push decision. `skip` covers every push this hook does not own and
 * returns before any check runs; `refuse` always names what to do next.
 */
export async function guardDocsPush({
  root,
  remoteName,
  remoteUrl,
  updates,
  env = process.env,
  runChecks = runDocsChecks,
}) {
  const master = updates.filter(
    update =>
      update.remoteRef === PUSH_GUARD_REF && !ZERO_SHA.test(update.localSha)
  );
  if (master.length === 0) return { verdict: 'skip', reason: 'not-master' };
  if (!(await isGuardedRemote(root, remoteName, remoteUrl)))
    return { verdict: 'skip', reason: 'not-origin' };
  if (master.every(update => update.localSha === env[FLOOR_VERIFIED_ENV]))
    return { verdict: 'skip', reason: 'floor-verified' };

  const changed = [
    ...new Set(
      (
        await Promise.all(master.map(update => pushedPaths(root, update)))
      ).flat()
    ),
  ].sort();
  const docs = changed.filter(isDocsPath);
  if (docs.length === 0) return { verdict: 'skip', reason: 'no-docs' };

  // Every check reads the checkout, so the checkout must BE the commit being
  // pushed. A pass over different files would read as proof and prove nothing.
  const head = await git(root, ['rev-parse', 'HEAD']);
  const elsewhere = master.find(update => update.localSha !== head);
  if (elsewhere)
    return refusal('not-checked-out', {
      pushed: elsewhere.localSha,
      head,
    });
  const dirty = await git(root, [
    'status',
    '--porcelain',
    '--untracked-files=no',
  ]);
  if (dirty) return refusal('dirty-checkout', { dirty: lines(dirty) });

  const results = await runChecks({ root, paths: changed, env });
  const failed = results.filter(result => result.status !== 'passed');
  return {
    verdict: failed.length === 0 ? 'pass' : 'refuse',
    reason: failed.length === 0 ? 'checks-passed' : 'checks-failed',
    docs,
    results,
  };
}

const RECOVERY_LINE =
  '`git push --no-verify` is for the recovery path in docs/engineering/agent-delivery.md only.';

export function formatPushGuardReport(decision) {
  if (decision.verdict === 'skip') return '';
  const out = [];
  if (decision.results) {
    out.push(
      `[docs:check] this push to master changes ${decision.docs.length} doc(s)`
    );
    out.push(formatDocsCheckReport(decision.results).trimEnd());
  }
  if (decision.verdict === 'pass') return out.join('\n') + '\n';

  if (decision.reason === 'checks-failed') {
    const names = decision.results
      .filter(result => result.status !== 'passed')
      .map(result => result.id)
      .join(', ');
    out.push(
      '',
      `[docs:check] push refused: ${names} failed.`,
      'Fix the change, run `pnpm docs:check` until it passes, commit, and push again.'
    );
  } else if (decision.reason === 'not-checked-out') {
    out.push(
      `[docs:check] push refused: it sends ${decision.detail.pushed.slice(0, 12)}, but this checkout is at ${decision.detail.head.slice(0, 12)}.`,
      'docs:check reads the checked-out files, so push from a checkout of the commit you are sending.'
    );
  } else {
    out.push(
      '[docs:check] push refused: this checkout has uncommitted changes to tracked files, so a check would not read what you are pushing:',
      ...decision.detail.dirty.map(line => `  ${line}`),
      'Commit them or push from a clean agent worktree through `pnpm agent:land`.'
    );
  }
  out.push(RECOVERY_LINE);
  return out.join('\n') + '\n';
}
