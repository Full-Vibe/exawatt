import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';

import { appendMergeGitArgs } from './append-merge.mjs';
import { firstFreePort } from './dev-server-identity.mjs';

/**
 * The merge train (ENG-039 M3, 2026-10-21).
 *
 * A front of parallel packets used to land one ticket per packet: each paid
 * the whole-repo checks, the head's re-check, its own gate runs and its own
 * dogfood build. On 2026-10-15 the coordinator did the train by hand instead:
 * packets pushed ready branches, the coordinator stacked them, landed once
 * with every gate they owed and asked for one build. This module is the
 * mechanics `agent:land --train` uses to do that itself:
 *
 * - resolve each car (an `agent/*` branch) to the commit its owner pushed,
 *   refusing a branch whose local and pushed tips disagree;
 * - stack the cars' commits in order onto the latest `origin/master` in a
 *   fresh integration worktree, refusing a textual conflict and naming both
 *   cars and the paths;
 * - find the car that turned a red stack red, by prefix bisection;
 * - map each car's commits to the commits that integrated.
 *
 * The checks, the queue and the integration are `agent-land.mjs`'s ordinary
 * worktree-lane machinery, run once on the stacked tree.
 */

const execFileAsync = promisify(execFile);

const CAR_PATTERN = /^agent\/[a-z0-9][a-z0-9._/-]*$/u;

/** One commit's identity that survives cherry-pick and rebase. */
const SIGNATURE_FORMAT = '%H%x1f%an%x1f%ad%x1f%s';

async function git(root, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim();
}

async function gitOrNull(root, args) {
  try {
    return await git(root, args);
  } catch {
    return null;
  }
}

function lines(output) {
  return output ? output.split('\n').filter(Boolean) : [];
}

/** The usage refusals a train owes before it touches anything. */
export function trainOptionsRefusal(options) {
  if (options.train.length === 0) {
    return options.landPassing
      ? '--land-passing applies only to --train.'
      : null;
  }
  const combined = [
    options.direct && '--direct',
    options.docs && '--docs',
  ].filter(Boolean);
  if (combined.length > 0) {
    return `--train cannot be combined with ${combined.join(', ')}.`;
  }
  const invalid = options.train.filter(branch => !CAR_PATTERN.test(branch));
  if (invalid.length > 0) {
    return `--train takes agent/<slug> branches; not one: ${invalid.join(', ')}.`;
  }
  const seen = new Set();
  const repeated = options.train.filter(branch => {
    if (seen.has(branch)) return true;
    seen.add(branch);
    return false;
  });
  if (repeated.length > 0) {
    return `--train names ${[...new Set(repeated)].join(', ')} more than once.`;
  }
  return null;
}

function parseSignatures(output) {
  return lines(output).map(line => {
    const [sha, author, date, subject] = line.split('\x1f');
    return { sha, signature: `${author}\x1f${date}\x1f${subject}`, subject };
  });
}

/**
 * Each car's tip and its own commits, in train order. A car's commits are
 * the ones reachable from its tip and from neither `origin/master` nor an
 * earlier car, so stacked branches never repeat a shared commit. Refuses a
 * branch with no tip, a branch whose local and pushed tips disagree, a merge
 * commit (branches land linearly) and a car with nothing of its own.
 */
export async function resolveCars(root, branches, { base }) {
  // Every car's pushed tip, into its remote-tracking ref. A branch that was
  // never pushed is not an error here; one that is neither local nor pushed
  // is refused below.
  for (const branch of branches) {
    await gitOrNull(root, [
      'fetch',
      '--quiet',
      'origin',
      `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
    ]);
  }
  const cars = [];
  for (const branch of branches) {
    const local = await gitOrNull(root, [
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/heads/${branch}^{commit}`,
    ]);
    const pushed = await gitOrNull(root, [
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/remotes/origin/${branch}^{commit}`,
    ]);
    if (!local && !pushed) {
      throw new Error(
        `train refused: ${branch} is neither a local branch nor on origin.`
      );
    }
    if (local && pushed && local !== pushed) {
      throw new Error(
        `train refused: ${branch} is ${local.slice(0, 12)} here and ${pushed.slice(0, 12)} on origin. ` +
          'Push the branch (or reset it to what its owner pushed) and run the train again.'
      );
    }
    cars.push({
      branch,
      tip: local ?? pushed,
      source: local ? 'local' : 'origin',
    });
  }
  for (const [index, car] of cars.entries()) {
    const exclude = [
      `^${base}`,
      ...cars.slice(0, index).map(earlier => `^${earlier.tip}`),
    ];
    const merges = lines(
      await git(root, ['rev-list', '--merges', car.tip, ...exclude])
    );
    if (merges.length > 0) {
      throw new Error(
        `train refused: ${car.branch} carries a merge commit (${merges[0].slice(0, 12)}). ` +
          'Rebase it onto origin/master so it is linear, push it, and run the train again.'
      );
    }
    const commits = parseSignatures(
      await git(root, [
        'log',
        '--reverse',
        '--topo-order',
        '--date=raw',
        `--format=${SIGNATURE_FORMAT}`,
        car.tip,
        ...exclude,
      ])
    );
    if (commits.length === 0) {
      throw new Error(
        `train refused: ${car.branch} has no commits beyond origin/master` +
          (index > 0 ? ' and the cars before it.' : '.')
      );
    }
    for (const commit of commits) {
      commit.paths = lines(
        await git(root, [
          'diff-tree',
          '--no-commit-id',
          '--name-only',
          '-r',
          '--root',
          commit.sha,
        ])
      );
    }
    car.commits = commits;
  }
  return cars;
}

/** A sortable, branch-safe stamp for one train. */
export function trainStamp(now = new Date()) {
  const digits = now.toISOString().replace(/[-:]/gu, '').replace('T', '-');
  return `${digits.slice(0, 15)}-${randomBytes(2).toString('hex')}`;
}

/** The main checkout: the worktree the common git directory belongs to. */
async function mainCheckout(root) {
  const common = path.resolve(
    root,
    await git(root, ['rev-parse', '--git-common-dir'])
  );
  return path.basename(common) === '.git' ? path.dirname(common) : root;
}

/**
 * A fresh integration worktree beside the main checkout, on its own
 * `agent/train-<stamp>` branch at `base`, so the ordinary worktree lane can
 * check it, queue it, rebase it and push it.
 */
export async function openIntegrationWorktree(root, { base, stamp }) {
  const main = await mainCheckout(root);
  const directory = path.join(path.dirname(main), `exawatt-train-${stamp}`);
  const branch = `agent/train-${stamp}`;
  await git(root, [
    'worktree',
    'add',
    '--quiet',
    '-b',
    branch,
    directory,
    base,
  ]);
  return {
    root: directory,
    branch,
    async remove() {
      await git(root, ['worktree', 'remove', '--force', directory]).catch(
        error => {
          console.warn(
            `[agent-land] could not remove the integration worktree ${directory}: ${error.message.split('\n')[0]}`
          );
        }
      );
      await git(root, ['branch', '-D', branch]).catch(() => {});
    },
  };
}

/** A conflict found while stacking, with what it collided with. */
class TrainConflict extends Error {
  constructor(conflict) {
    super(trainConflictMessage(conflict));
    this.conflict = conflict;
  }
}

/** The refusal a coordinator reads: both cars and every path. */
function trainConflictMessage({ car, commit, base, paths }) {
  const others = [...new Set(paths.flatMap(entry => entry.cars))];
  const against =
    others.length > 0
      ? others.join(' and ')
      : `origin/master ${base.slice(0, 12)}`;
  return [
    `train refused: ${car} conflicts with ${against} when stacked${others.length > 0 ? ' after it' : ''}.`,
    `  ${car} ${commit.sha.slice(0, 12)} ${commit.subject} conflicts on:`,
    ...paths.map(
      entry =>
        `      ${entry.path} (${entry.cars.length > 0 ? `also changed by ${entry.cars.join(', ')}` : `changed on origin/master since ${car} branched`})`
    ),
    others.length > 0
      ? `Rebase ${car} onto ${others.join(' and ')} (or put it first), push it, and run the train again.`
      : `Rebase ${car} onto origin/master, push it, and run the train again.`,
  ].join('\n');
}

/**
 * Stacks `cars` onto `base` in the integration worktree, one commit at a
 * time, with the append-only docs driver. A commit whose patch is already
 * upstream is dropped and recorded. Returns each car with the commits it
 * stacked. On a conflict, either refuses (`onConflict: 'refuse'`, the first
 * stack) or leaves that car out and continues (`'exclude'`, a restack after a
 * guilty car was removed).
 */
export async function stackCars(
  root,
  { base, cars, onConflict = 'refuse', gitArgs = appendMergeGitArgs() }
) {
  await git(root, ['reset', '--quiet', '--hard', base]);
  const stacked = [];
  const excluded = [];
  for (const car of cars) {
    const before = await git(root, ['rev-parse', 'HEAD']);
    const commits = [];
    let conflict = null;
    for (const commit of car.commits) {
      const head = await git(root, ['rev-parse', 'HEAD']);
      try {
        await execFileAsync(
          'git',
          [
            ...gitArgs,
            'cherry-pick',
            '--allow-empty',
            '--empty=drop',
            commit.sha,
          ],
          { cwd: root, maxBuffer: 16 * 1024 * 1024 }
        );
      } catch (error) {
        const unmerged = lines(
          (await gitOrNull(root, ['diff', '--name-only', '--diff-filter=U'])) ??
            ''
        );
        await gitOrNull(root, ['cherry-pick', '--abort']);
        if (unmerged.length === 0) throw error;
        conflict = {
          car: car.branch,
          commit,
          base,
          paths: unmerged.sort().map(file => ({
            path: file,
            cars: stacked
              .filter(earlier =>
                earlier.commits.some(entry => entry.paths.includes(file))
              )
              .map(earlier => earlier.branch),
          })),
        };
        break;
      }
      const after = await git(root, ['rev-parse', 'HEAD']);
      commits.push(
        after === head
          ? { ...commit, stacked: null, dropped: 'already upstream' }
          : { ...commit, stacked: after }
      );
    }
    if (conflict) {
      if (onConflict === 'refuse') throw new TrainConflict(conflict);
      await git(root, ['reset', '--quiet', '--hard', before]);
      excluded.push({
        branch: car.branch,
        reason: `conflicts on ${conflict.paths.map(entry => entry.path).join(', ')}`,
      });
      continue;
    }
    stacked.push({ ...car, commits });
  }
  return { cars: stacked, excluded };
}

/**
 * The checks one bisection step runs (BUG-311). A red train's bisection asks
 * each prefix one question, "does the check that failed fail here?", so it
 * runs that check from the prefix's own landing checks, after every check it
 * `needs` (declared on the check, in `classifyDeliveryPolicy`), in landing
 * order. The install refresh and the dev server a gate reads are not checks:
 * every landing-check run refreshes the install, and each gate's
 * `beforeCheck` makes the server serve the tree (recompiling the Electron
 * main when its sources moved). Empty when the prefix does not owe the check.
 */
export function bisectChecks(checks, id) {
  const wanted = new Set();
  const want = target => {
    const check = checks.find(entry => entry.id === target);
    if (!check || wanted.has(target)) return;
    wanted.add(target);
    for (const need of check.needs ?? []) want(need);
  };
  want(id);
  return checks.filter(check => wanted.has(check.id));
}

/**
 * The first car whose addition turns the stack red. `isRed(n)` checks the
 * stack of the first `n` cars; master (n = 0) is green and the whole stack
 * (n = count) is red, so log2(count) checks find it. Returns the 0-based
 * index of the guilty car.
 */
export async function firstRedCar(count, isRed) {
  let green = 0;
  let red = count;
  while (red - green > 1) {
    const middle = Math.floor((green + red) / 2);
    if (await isRed(middle)) red = middle;
    else green = middle;
  }
  return red - 1;
}

const ELECTRON_FACING_PREFIXES = ['electron/', 'src/', 'themes/', 'public/'];
const ELECTRON_FACING_FILES = new Set([
  'next.config.ts',
  'electron-builder.yml',
  'electron-builder.release.yml',
  'package.json',
  'pnpm-lock.yaml',
]);

/** The paths that change what the packaged app contains. Tests do not. */
export function electronFacingPaths(paths) {
  return paths.filter(
    file =>
      !/\.test\.[cm]?[jt]sx?$/u.test(file) &&
      (ELECTRON_FACING_PREFIXES.some(prefix => file.startsWith(prefix)) ||
        /^packages\/[^/]+\/src\//u.test(file) ||
        ELECTRON_FACING_FILES.has(file))
  );
}

/** Ports a train's own dev server may take when `EXA_BASE` is unset. */
const TRAIN_SERVER_PORTS = Array.from(
  { length: 100 },
  (_, index) => 7300 + index
);

/** A local origin on a free port, for the dev server the landing will own. */
export async function trainServerBase({ free } = {}) {
  const port = await firstFreePort(
    TRAIN_SERVER_PORTS,
    free ? { free } : undefined
  );
  if (port === null) {
    throw new Error(
      `train refused: its gates need a dev server and ports ${TRAIN_SERVER_PORTS[0]} to ${TRAIN_SERVER_PORTS.at(-1)} are all taken. Set EXA_BASE to a free local port.`
    );
  }
  return `http://localhost:${port}`;
}

/**
 * Each car's commits with the integrated SHA that carries it. Cherry-pick
 * and rebase keep a commit's author, author date and subject, so that
 * signature finds it; a commit the queue head's rebase dropped (its patch
 * reached master meanwhile) maps to null.
 */
export async function integratedCars(root, { cars, base, integrated }) {
  const landed = parseSignatures(
    await git(root, [
      'log',
      '--reverse',
      '--date=raw',
      `--format=${SIGNATURE_FORMAT}`,
      `${base}..${integrated}`,
    ])
  );
  const used = new Set();
  return cars.map(car => ({
    branch: car.branch,
    commits: car.commits.map(commit => {
      const index = landed.findIndex(
        (entry, position) =>
          !used.has(position) && entry.signature === commit.signature
      );
      if (index === -1) return { sha: commit.sha, integrated: null };
      used.add(index);
      return { sha: commit.sha, integrated: landed[index].sha };
    }),
  }));
}

/** The ticket's record of a car: what it was and what it brought. */
export function carEvidence(car) {
  return {
    branch: car.branch,
    tip: car.tip,
    source: car.source,
    commits: car.commits.map(commit => ({
      sha: commit.sha,
      subject: commit.subject,
      ...(commit.dropped ? { dropped: commit.dropped } : {}),
    })),
  };
}
