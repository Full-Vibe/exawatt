#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  PUBLIC_BRANCH,
  PUBLIC_REMOTE_NAME,
  resolvePublicRemote,
} from './lib/public-delivery.mjs';

/**
 * The inbound half of the two-repository mechanism (ENG-030 WP6-D).
 *
 * An external contributor can only open a pull request against the public
 * repository, and public `master` is never merged into by a human: a merge
 * there would make the public repository diverge from the projection and break
 * the fast-forward property forever. So a contribution is PULLED, not merged.
 *
 * This command fetches the pull request's commits, refuses unless its CLA
 * check is green, applies them onto a fresh `agent/contrib-<n>` worktree of the
 * private tree with `git am --3way`, and hands off to the normal landing
 * floor. The contribution then meets exactly the floor the operator's own work
 * meets — Gate A, Gate B, type-check, tests, surface gates — and reaches the
 * public repository through the ordinary outbound projection, under the
 * contributor's own authorship, which `git am` preserves.
 */

const execFileAsync = promisify(execFile);

const CLA_CHECK = /\b(?:cla|contributor[ -]license[ -]agreement)\b/iu;
const GREEN = new Set(['SUCCESS', 'PASS', 'PASSED']);

function fail(message) {
  throw new Error(`[contribution-pull] ${message}`);
}

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim();
}

export function parseArgs(argv) {
  const options = { prNumber: null, land: false, help: false };
  for (const argument of argv) {
    if (argument === '--') continue;
    if (argument === '--land') options.land = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (/^\d+$/u.test(argument)) {
      if (options.prNumber !== null)
        fail('pass exactly one pull-request number');
      options.prNumber = Number(argument);
    } else fail(`unknown argument: ${argument}`);
  }
  return options;
}

export function usage() {
  return `Usage: pnpm contribution:pull -- <pr-number> [--land]

Applies an approved public pull request onto a fresh private agent worktree.

  <pr-number>  The pull request on the public repository.
  --land       Run the normal landing after the patches apply cleanly.
`;
}

export function parseRepositorySlug(url) {
  const match =
    /^git@[^:]+:(?<slug>[^/]+\/[^/]+?)(?:\.git)?$/u.exec(url) ??
    /^(?:https?|ssh):\/\/[^/]+\/(?<slug>[^/]+\/[^/]+?)(?:\.git)?\/?$/u.exec(
      url
    );
  if (!match)
    fail(`cannot read an owner/name slug from the public remote ${url}`);
  return match.groups.slug;
}

/**
 * The hard rule made mechanical: "CLA live before the first external merge".
 * Absence is a refusal, not a pass — a repository whose CLA bot is not running
 * yet reports no CLA check at all, which is exactly the state this must stop.
 */
export function assertClaGreen(checks, prNumber) {
  if (!Array.isArray(checks)) fail('the pull request check list is unreadable');
  const cla = checks.filter(check => CLA_CHECK.test(check?.name ?? ''));
  if (cla.length === 0) {
    fail(
      `pull request ${prNumber} has no CLA check. The CLA must be live and ` +
        'green before any external contribution is merged; nothing was fetched.'
    );
  }
  const red = cla.filter(
    check => !GREEN.has(String(check.state ?? '').toUpperCase())
  );
  if (red.length > 0) {
    fail(
      `pull request ${prNumber}'s CLA check is not green (` +
        red.map(check => `${check.name}=${check.state}`).join(', ') +
        '); nothing was fetched.'
    );
  }
  return true;
}

async function fetchChecksWithGh(prNumber, remote) {
  const slug = parseRepositorySlug(remote.url);
  try {
    const { stdout } = await execFileAsync('gh', [
      'pr',
      'checks',
      String(prNumber),
      '--repo',
      slug,
      '--json',
      'name,state',
    ]);
    return JSON.parse(stdout);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      fail('the GitHub CLI (gh) is required to read the pull request checks');
    }
    // `gh pr checks` exits non-zero when a check is red, and still prints the
    // rows, which is the answer this command needs rather than an error.
    const stdout = String(error?.stdout ?? '').trim();
    if (stdout.startsWith('[')) return JSON.parse(stdout);
    fail(`could not read pull request ${prNumber}'s checks: ${error.message}`);
  }
}

async function resolveBaseRef(root) {
  try {
    await git(root, 'remote', 'get-url', 'origin');
    await git(root, 'fetch', '--quiet', 'origin', 'master');
    return 'origin/master';
  } catch {
    await git(root, 'rev-parse', '--verify', 'master^{commit}').catch(() =>
      fail(
        'the private tree has neither origin/master nor master to branch from'
      )
    );
    return 'master';
  }
}

/**
 * Fetches, verifies, and applies one public pull request.
 *
 * `fetchChecks` is injected so the CLA gate is provable against fixtures with
 * no network and no GitHub: the rule it enforces is the interesting part, not
 * the transport.
 */
export async function pullContribution({
  root,
  prNumber,
  fetchChecks = fetchChecksWithGh,
  worktreePath = null,
  land = false,
  log = console.log,
}) {
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    fail('a pull-request number is required');
  }
  const remote = await resolvePublicRemote(root);
  if (!remote) {
    fail(
      `no ${PUBLIC_REMOTE_NAME} remote is configured, so there is no public ` +
        'repository to pull a contribution from'
    );
  }

  assertClaGreen(await fetchChecks(prNumber, remote), prNumber);

  const headRef = `refs/exawatt/contributions/${prNumber}`;
  const publicRef = 'refs/exawatt/public-master';
  await git(
    root,
    'fetch',
    '--quiet',
    '--no-tags',
    '--force',
    remote.url,
    `refs/pull/${prNumber}/head:${headRef}`,
    `refs/heads/${PUBLIC_BRANCH}:${publicRef}`
  );
  const head = await git(root, 'rev-parse', '--verify', `${headRef}^{commit}`);
  const base = await git(root, 'merge-base', publicRef, head);
  const commits = (await git(root, 'rev-list', '--reverse', `${base}..${head}`))
    .split('\n')
    .filter(Boolean);
  if (commits.length === 0) {
    fail(`pull request ${prNumber} carries no commit the public master lacks`);
  }

  const branch = `agent/contrib-${prNumber}`;
  const worktree =
    worktreePath ??
    path.join(path.dirname(root), `exawatt-contrib-${prNumber}`);
  const patchDirectory = await mkdtemp(
    path.join(tmpdir(), `exawatt-contribution-${prNumber}-`)
  );
  try {
    await git(
      root,
      'format-patch',
      '--quiet',
      '--output-directory',
      patchDirectory,
      `${base}..${head}`
    );
    const patches = (await readdir(patchDirectory))
      .filter(file => file.endsWith('.patch'))
      .sort()
      .map(file => path.join(patchDirectory, file));
    if (patches.length !== commits.length) {
      fail('the formatted patch set does not match the pull request commits');
    }

    const baseRef = await resolveBaseRef(root);
    await git(root, 'worktree', 'add', '-b', branch, worktree, baseRef).catch(
      error =>
        fail(
          `could not create the ${branch} worktree at ${worktree}: ${error.message}`
        )
    );
    try {
      await git(worktree, 'am', '--3way', ...patches);
    } catch (error) {
      await git(worktree, 'am', '--abort').catch(() => {});
      await git(root, 'worktree', 'remove', '--force', worktree).catch(
        () => {}
      );
      await git(root, 'branch', '-D', branch).catch(() => {});
      fail(
        `pull request ${prNumber} does not apply to the private tree: ` +
          String(error?.stdout ?? error?.stderr ?? error.message).trim()
      );
    }

    const applied = [];
    for (const line of (
      await git(
        worktree,
        'log',
        '--reverse',
        `--format=%H%x00%an <%ae>%x00%s`,
        `${baseRef}..HEAD`
      )
    )
      .split('\n')
      .filter(Boolean)) {
      const [sha, author, subject] = line.split('\0');
      applied.push({ sha, author, subject });
    }

    log(
      `[contribution-pull] applied ${applied.length} commit(s) from pull request ${prNumber} onto ${branch}`
    );
    for (const commit of applied) {
      log(`[contribution-pull]   ${commit.author}: ${commit.subject}`);
    }
    if (land) {
      log('[contribution-pull] handing off to the normal landing floor');
      await new Promise((resolve, reject) => {
        const child = spawn('pnpm', ['agent:land'], {
          cwd: worktree,
          stdio: 'inherit',
        });
        child.once('error', reject);
        child.once('exit', code =>
          code === 0
            ? resolve()
            : reject(new Error(`agent:land exited ${code}`))
        );
      });
    } else {
      log(
        `[contribution-pull] review it, then: cd ${worktree} && pnpm worktree:setup && pnpm agent:land`
      );
    }
    return { branch, worktree, base, head, commits: applied };
  } finally {
    await rm(patchDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || options.prNumber === null) {
    process.stdout.write(usage());
    if (options.prNumber === null && !options.help) process.exitCode = 1;
    return;
  }
  const root = await git(process.cwd(), 'rev-parse', '--show-toplevel');
  await pullContribution({
    root,
    prNumber: options.prNumber,
    land: options.land,
  });
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
