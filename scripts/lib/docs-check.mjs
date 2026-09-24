import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import { classifyDocsChecks } from './delivery-policy.mjs';

/**
 * `pnpm docs:check`, the docs lane's checks, and the pre-push hook (BUG-195,
 * BUG-200).
 *
 * A small docs-only promotion used to be committed straight to `master` from
 * the checkout the operator is talking to, because the answer to his question
 * should not wait for a landing. That path skipped every landing check, and
 * three times the skipped checks would have refused the change: two
 * public-variant directives the projector rejects (BUG-131) and a doubled
 * blank line that made the public roadmap render with a seam (`0cbcb226`).
 * Each time the next queued landing found it, on someone else's change.
 *
 * BUG-195 put the docs checks in front of that push. BUG-200 closed the path:
 * in September 20 of 132 `master` commits skipped the queue, and they caused
 * 13 of the 38 ticket deaths and every repeat rebase at the queue head. A
 * direct push moves the base out from under the head, however good the push
 * is. So `agent:land -- --docs` now carries a docs change through the queue
 * in seconds, and the hook refuses every other push to origin's `master`.
 *
 * The checks are the landing checks a documentation change can fail, taken
 * from `classifyDocsChecks` so they are the floor's own definitions, run in
 * parallel without a machine slot: they have to stay fast enough to sit in
 * front of an operator's answer.
 */

const execFileAsync = promisify(execFile);

const PUSH_GUARD_REMOTE = 'origin';
const PUSH_GUARD_REF = 'refs/heads/master';

/**
 * Set by `agent:land` on its final push to the SHA its floor just verified.
 * It excuses exactly that commit, so it is not a general bypass: any other
 * SHA, or no variable, is refused.
 */
export const FLOOR_VERIFIED_ENV = 'EXAWATT_AGENT_LAND_FLOOR_SHA';

/**
 * Set by the operator-only `agent:land -- --direct` recovery path, which is
 * already gated on `EXAWATT_AGENT_LAND_ALLOW_DIRECT=1`, to the one SHA it
 * pushes. Like the floor variable it excuses exactly that commit.
 */
export const DIRECT_RECOVERY_ENV = 'EXAWATT_AGENT_LAND_DIRECT_SHA';

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

/** What the docs lane may carry: Markdown anywhere, and anything under docs/. */
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
export async function runDocsChecks({
  root,
  paths,
  checks = classifyDocsChecks(paths),
  env = process.env,
}) {
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

/**
 * The pre-push decision (BUG-200). `skip` covers every push this hook does
 * not own; `refuse` covers every other push to origin's `master`, because the
 * only writer of `master` is the delivery queue. A push is excused only when
 * `agent:land` stated the exact SHA it is pushing, from its floor-verified
 * final push or from the operator-gated `--direct` recovery path.
 */
export async function guardMasterPush({
  root,
  remoteName,
  remoteUrl,
  updates,
  env = process.env,
}) {
  const master = updates.filter(update => update.remoteRef === PUSH_GUARD_REF);
  if (master.length === 0) return { verdict: 'skip', reason: 'not-master' };
  if (!(await isGuardedRemote(root, remoteName, remoteUrl)))
    return { verdict: 'skip', reason: 'not-origin' };
  const excused = update =>
    !ZERO_SHA.test(update.localSha) &&
    (update.localSha === env[FLOOR_VERIFIED_ENV] ||
      update.localSha === env[DIRECT_RECOVERY_ENV]);
  if (master.every(excused)) return { verdict: 'skip', reason: 'agent-land' };
  return {
    verdict: 'refuse',
    reason: 'not-agent-land',
    pushed: master.find(update => !excused(update)).localSha,
  };
}

const RECOVERY_LINE =
  '`git push --no-verify` is for the recovery path in docs/engineering/agent-delivery.md only.';

export function formatPushGuardReport(decision) {
  if (decision.verdict !== 'refuse') return '';
  return (
    [
      `[pre-push] push refused: ${decision.pushed.slice(0, 12)} would reach origin's master outside the delivery queue.`,
      'Only `pnpm agent:land` moves master (BUG-200), so a push never moves the base out from under the queue head.',
      '  Docs only (*.md, docs/**): commit, then `pnpm agent:land -- --docs` from this checkout.',
      '    No worktree or setup; it runs the docs checks in seconds and takes a queue ticket.',
      '  Anything else: an agent/* worktree and `pnpm agent:land`.',
      RECOVERY_LINE,
    ].join('\n') + '\n'
  );
}
