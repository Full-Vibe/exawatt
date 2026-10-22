#!/usr/bin/env node

// BUG-131. A projection that stops publishing says nothing: in September the
// public tip sat two days behind private `master` and nothing reported it
// until the next queued landing ran the renderer tests. This check makes that
// stall visible. It compares the public tip's tree with the projection of the
// source tip (`comparePublicSnapshot`, the catch-up's own snapshot), and when
// they differ it dates the oldest source commit the public copy is missing.
// Over the limit, it exits 1, so a scheduled run turns red and notifies.
//
// BUG-316. A copy that publishes on time can still be red where only the
// public repository runs it: Secret Scan failed every public push from
// 2026-10-05 and nothing private said so. The check also reads the public
// repository's concluded push runs on master and fails, naming the workflow,
// when any workflow's newest one failed.
//
// Usage: node scripts/public-sync-check.mjs [--public <repository>]
//          [--source <rev>] [--max-hours <n>]
//
// `--public` defaults to this checkout's `public` remote. The runs are read
// with `GH_TOKEN` or `GITHUB_TOKEN` when one is set, anonymously otherwise.

import { execFile } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { comparePublicSnapshot } from './lib/public-projection.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOUR = 3600;
const PATHS_SHOWN = 8;
export const DEFAULT_MAX_HOURS = 24;
const RECOVERY = 'docs/engineering/agent-delivery.md#reviewed-public-catch-up';

export function parsePublicSyncArgs(argv) {
  const options = { source: 'HEAD', maxHours: DEFAULT_MAX_HOURS };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--') continue;
    const value = argv[index + 1];
    if (!['--public', '--source', '--max-hours'].includes(flag) || !value) {
      throw new Error(
        'Usage: node scripts/public-sync-check.mjs [--public <repository>] [--source <rev>] [--max-hours <n>]'
      );
    }
    index += 1;
    if (flag === '--public') options.publicRepository = value;
    if (flag === '--source') options.source = value;
    if (flag === '--max-hours') {
      const hours = Number(value);
      if (!Number.isFinite(hours) || hours <= 0) {
        throw new Error('--max-hours needs a positive number');
      }
      options.maxHours = hours;
    }
  }
  return options;
}

/**
 * The verdict, from the comparison and the source commits the public copy is
 * missing (`owed`, newest first, each `{ sha, commitTime, subject }`).
 *
 * `current`: the trees match. `behind`: they differ and the oldest missing
 * commit is younger than the limit, which is a landing whose projection is
 * still in flight or a transient push failure the next landing drains.
 * `stalled`: that commit is older than the limit. `diverged`: the trees
 * differ and no source commit since the public tip explains it, so the public
 * copy is not the projection of anything the source holds.
 */
export function publicSyncVerdict({ comparison, owed, now, maxHours }) {
  if (comparison.inSync) return { status: 'current', owed: [] };
  if (owed.length === 0) return { status: 'diverged', owed };
  const oldest = owed[owed.length - 1];
  const ageHours = (now - oldest.commitTime) / HOUR;
  return {
    status: ageHours > maxHours ? 'stalled' : 'behind',
    owed,
    oldest,
    ageHours,
  };
}

const short = sha => sha.slice(0, 12);
const iso = seconds => new Date(seconds * 1000).toISOString();

export function formatPublicSyncReport(verdict, comparison, maxHours) {
  const tip = `public master ${short(comparison.publicSha)}`;
  if (verdict.status === 'current') {
    return [
      `[public-sync] current: ${tip} is the projection of ${short(comparison.sourceSha)}`,
    ];
  }
  const shown = comparison.differingPaths.slice(0, PATHS_SHOWN).join(', ');
  const more = comparison.differingPaths.length - PATHS_SHOWN;
  const paths = `  differs at ${comparison.differingPaths.length} paths: ${shown}${more > 0 ? ` (+${more} more)` : ''}`;
  if (verdict.status === 'diverged') {
    return [
      `[public-sync] DIVERGED: ${tip} is not the projection of ${short(comparison.sourceSha)}, and no source commit since ${iso(comparison.publicCommitTime)} explains it`,
      paths,
      `  Recover: ${RECOVERY}`,
    ];
  }
  const hours = verdict.ageHours.toFixed(1);
  const count = `${verdict.owed.length} commit${verdict.owed.length === 1 ? '' : 's'}`;
  const oldest = `  oldest ${short(verdict.oldest.sha)} ${iso(verdict.oldest.commitTime)} ${verdict.oldest.subject}`;
  if (verdict.status === 'behind') {
    return [
      `[public-sync] behind: ${count} not on ${tip} for ${hours}h (limit ${maxHours}h)`,
      oldest,
    ];
  }
  return [
    `[public-sync] STALLED: ${count} not on ${tip} for ${hours}h (limit ${maxHours}h)`,
    oldest,
    paths,
    '  A pending push clears on the next landing. A render refusal names its file in the landing log; fix the directive and land.',
    `  Recover a longer stall: ${RECOVERY}`,
  ];
}

// A run that was cancelled, skipped or neutral says nothing about the tree.
const RED_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'startup_failure',
  'action_required',
]);
const RUNS_READ = 100;

/** `owner/name` of a github.com repository URL, or undefined. */
export function githubRepository(url) {
  const match =
    /^(?:https:\/\/github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/u.exec(
      url.trim()
    );
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/**
 * The newest concluded push runs on `ref`, from GitHub's REST
 * `GET /repos/{repository}/actions/runs`. A refused or malformed answer
 * throws: an unread repository is never reported as a green one.
 */
export async function readPublicWorkflowRuns(
  repository,
  { ref = 'master', token, request = globalThis.fetch } = {}
) {
  const query = new URLSearchParams({
    branch: ref,
    event: 'push',
    status: 'completed',
    per_page: String(RUNS_READ),
  });
  const url = `https://api.github.com/repos/${repository}/actions/runs?${query}`;
  const response = await request(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} for ${url}`);
  }
  const body = await response.json();
  if (!Array.isArray(body?.workflow_runs)) {
    throw new Error(`GitHub's answer for ${url} carries no workflow_runs`);
  }
  return body.workflow_runs;
}

/**
 * One verdict per workflow among `runs`, judged by its newest run that
 * passed or failed. A failing workflow is dated from the oldest failure after
 * its newest pass; when the runs read hold no pass, `since` is only a bound.
 */
export function publicWorkflowVerdicts(runs) {
  const byWorkflow = new Map();
  const decisive = runs
    .filter(
      run => run.conclusion === 'success' || RED_CONCLUSIONS.has(run.conclusion)
    )
    .sort(
      (a, b) =>
        Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id
    );
  for (const run of decisive) {
    const own = byWorkflow.get(run.workflow_id) ?? [];
    own.push(run);
    byWorkflow.set(run.workflow_id, own);
  }
  return [...byWorkflow.values()]
    .map(own => {
      const latest = own[0];
      const lastGreen = own.findIndex(run => run.conclusion === 'success');
      if (lastGreen === 0)
        return { name: latest.name, status: 'green', latest };
      const red = lastGreen === -1 ? own : own.slice(0, lastGreen);
      return {
        name: latest.name,
        status: 'failing',
        latest,
        failures: red.length,
        since: red[red.length - 1],
        sinceIsBound: lastGreen === -1,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function formatWorkflowReport(verdicts) {
  if (verdicts.length === 0) {
    return [
      '[public-sync] UNREAD: no concluded push run on public master names a workflow',
    ];
  }
  const failing = verdicts.filter(verdict => verdict.status === 'failing');
  if (failing.length === 0) {
    return [
      `[public-sync] public workflows green: ${verdicts.map(verdict => verdict.name).join(', ')}`,
    ];
  }
  return failing.flatMap(verdict => {
    const runs = `${verdict.failures} run${verdict.failures === 1 ? '' : 's'}`;
    const since = verdict.sinceIsBound
      ? `red in all ${runs} read, back to ${verdict.since.created_at}`
      : `red since ${verdict.since.created_at} (${runs})`;
    return [
      `[public-sync] FAILING: ${verdict.name} on public master, ${since}`,
      `  latest ${verdict.latest.html_url} on ${short(verdict.latest.head_sha)}`,
    ];
  });
}

async function git(args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

function parseLog(stdout) {
  return stdout
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [sha, authorTime, commitTime, subject] = line.split('\0');
      return {
        sha,
        authorTime: Number(authorTime),
        commitTime: Number(commitTime),
        subject,
      };
    });
}

/**
 * The source commits the public copy is missing, newest first. The projector
 * keeps each source commit's author and committer times, so the source commit
 * the public tip was projected from is the one carrying both of its times;
 * everything after it that touched a differing path is owed. When no source
 * commit carries those times (the public tip is a catch-up snapshot), every
 * commit newer than the public tip is the fallback.
 */
export async function owedSourceCommits(comparison, readLog) {
  const history = parseLog(
    await readLog(['--first-parent', comparison.sourceSha])
  );
  const projected = history.findIndex(
    commit =>
      commit.authorTime === comparison.publicAuthorTime &&
      commit.commitTime === comparison.publicCommitTime
  );
  const since =
    projected === -1
      ? history.filter(
          commit => commit.commitTime > comparison.publicCommitTime
        )
      : history.slice(0, projected);
  if (since.length === 0) return [];
  const touching = new Set(
    parseLog(
      await readLog([
        '--first-parent',
        comparison.sourceSha,
        '--',
        ...comparison.differingPaths,
      ])
    ).map(commit => commit.sha)
  );
  const owed = since.filter(commit => touching.has(commit.sha));
  // A renderer or manifest change can move the projection without touching
  // the paths it moves; the missing history is then every commit since.
  return owed.length > 0 ? owed : since;
}

async function main() {
  const options = parsePublicSyncArgs(process.argv.slice(2));
  const publicRepository =
    options.publicRepository ??
    (await git(['remote', 'get-url', 'public']).catch(() => '')).trim();
  if (!publicRepository) {
    throw new Error('no --public repository and no `public` remote');
  }
  const comparison = await comparePublicSnapshot({
    sourceRepo: ROOT,
    sourceSha: options.source,
    publicRepository,
  });
  const owed = comparison.inSync
    ? []
    : await owedSourceCommits(comparison, args =>
        git(['log', '--format=%H%x00%at%x00%ct%x00%s', ...args])
      );
  const verdict = publicSyncVerdict({
    comparison,
    owed,
    now: Math.floor(Date.now() / 1000),
    maxHours: options.maxHours,
  });
  const lines = formatPublicSyncReport(verdict, comparison, options.maxHours);
  const workflows = await publicWorkflowReport(publicRepository, {
    token: (process.env.GH_TOKEN || process.env.GITHUB_TOKEN)?.trim(),
  });
  lines.push(...workflows.lines);
  process.stdout.write(`${lines.join('\n')}\n`);
  const summary = process.env.GITHUB_STEP_SUMMARY?.trim();
  if (summary) {
    await appendFile(summary, `\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
  }
  if (
    verdict.status === 'stalled' ||
    verdict.status === 'diverged' ||
    !workflows.green
  ) {
    process.exitCode = 1;
  }
}

/**
 * What the check says about the public repository's workflows, and whether
 * that lets it pass: only a read that found every workflow green does.
 */
export async function publicWorkflowReport(
  publicRepository,
  { token, request } = {}
) {
  const repository = githubRepository(publicRepository);
  if (!repository) {
    return {
      green: false,
      lines: [
        '[public-sync] UNREAD: the public repository is not on github.com, so its workflows were not read',
      ],
    };
  }
  try {
    const verdicts = publicWorkflowVerdicts(
      await readPublicWorkflowRuns(repository, { token, request })
    );
    return {
      green:
        verdicts.length > 0 &&
        verdicts.every(verdict => verdict.status === 'green'),
      lines: formatWorkflowReport(verdicts),
    };
  } catch (error) {
    return {
      green: false,
      lines: [`[public-sync] UNREAD: public workflow runs: ${error.message}`],
    };
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`[public-sync] FAILED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
