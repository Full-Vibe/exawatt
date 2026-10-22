import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_MAX_HOURS,
  formatPublicSyncReport,
  formatWorkflowReport,
  githubRepository,
  owedSourceCommits,
  parsePublicSyncArgs,
  publicSyncVerdict,
  publicWorkflowReport,
  publicWorkflowVerdicts,
  readPublicWorkflowRuns,
} from './public-sync-check.mjs';

// BUG-131. The comparison itself (`comparePublicSnapshot`) is proved against
// real projected fixtures in public-projection.test.mjs; these pin what the
// check concludes from it.

const HOUR = 3600;
const NOW = 2_000_000_000;

function comparison(overrides = {}) {
  return {
    sourceSha: 's'.repeat(40),
    publicSha: 'p'.repeat(40),
    publicAuthorTime: NOW - 50 * HOUR,
    publicCommitTime: NOW - 48 * HOUR,
    inSync: false,
    differingPaths: ['src/a.ts'],
    ...overrides,
  };
}

/** `git log --format=%H%x00%at%x00%ct%x00%s`, newest first. */
function logLine(sha, authorTime, commitTime, subject = sha) {
  return [sha, authorTime, commitTime, subject].join('\0');
}

test('a matching tree is current whatever the clock says', () => {
  const verdict = publicSyncVerdict({
    comparison: comparison({ inSync: true, differingPaths: [] }),
    owed: [],
    now: NOW,
    maxHours: DEFAULT_MAX_HOURS,
  });
  assert.equal(verdict.status, 'current');
  assert.match(
    formatPublicSyncReport(verdict, comparison({ inSync: true }), 24)[0],
    /^\[public-sync\] current: public master pppppppppppp is the projection of ssssssssssss$/u
  );
});

test('a missing commit younger than the limit is behind; older is stalled', () => {
  const young = [{ sha: 'a'.repeat(40), commitTime: NOW - 2 * HOUR }];
  const old = [{ sha: 'b'.repeat(40), commitTime: NOW - 30 * HOUR }];
  const behind = publicSyncVerdict({
    comparison: comparison(),
    owed: young,
    now: NOW,
    maxHours: 24,
  });
  assert.equal(behind.status, 'behind');
  assert.equal(behind.ageHours, 2);
  const stalled = publicSyncVerdict({
    comparison: comparison(),
    owed: [...young, ...old],
    now: NOW,
    maxHours: 24,
  });
  assert.equal(stalled.status, 'stalled');
  assert.equal(stalled.oldest, old[0]);
  const report = formatPublicSyncReport(stalled, comparison(), 24);
  assert.match(
    report[0],
    /STALLED: 2 commits not on public master .* for 30\.0h \(limit 24h\)/u
  );
  assert.match(report.join('\n'), /bbbbbbbbbbbb/u);
  assert.match(report.join('\n'), /differs at 1 paths: src\/a\.ts/u);
});

test('a differing tree no source commit explains is diverged, not quiet', () => {
  const verdict = publicSyncVerdict({
    comparison: comparison(),
    owed: [],
    now: NOW,
    maxHours: 24,
  });
  assert.equal(verdict.status, 'diverged');
  assert.match(
    formatPublicSyncReport(verdict, comparison(), 24)[0],
    /^\[public-sync\] DIVERGED/u
  );
});

test('owed commits are the ones after the projected source commit that touch a differing path', async () => {
  const projected = logLine('p0', NOW - 50 * HOUR, NOW - 48 * HOUR);
  const history = [
    logLine('c3', NOW - 3 * HOUR, NOW - 3 * HOUR, 'public edit'),
    logLine('c2', NOW - 20 * HOUR, NOW - 20 * HOUR, 'private only'),
    logLine('c1', NOW - 40 * HOUR, NOW - 40 * HOUR, 'public edit, earlier'),
    projected,
    logLine('c0', NOW - 60 * HOUR, NOW - 60 * HOUR),
  ];
  const calls = [];
  const owed = await owedSourceCommits(comparison(), async args => {
    calls.push(args);
    return args.includes('--')
      ? [history[0], history[2], history[4]].join('\n') + '\n'
      : history.join('\n') + '\n';
  });
  assert.deepEqual(
    owed.map(commit => commit.sha),
    ['c3', 'c1']
  );
  assert.deepEqual(calls[1].slice(-2), ['--', 'src/a.ts']);
});

test('when no source commit carries the public tip times, everything newer is owed', async () => {
  const history = [
    logLine('c2', NOW - 2 * HOUR, NOW - 2 * HOUR),
    logLine('c1', NOW - 47 * HOUR, NOW - 47 * HOUR),
    logLine('c0', NOW - 49 * HOUR, NOW - 49 * HOUR),
  ];
  const owed = await owedSourceCommits(comparison(), async args =>
    args.includes('--') ? '' : history.join('\n') + '\n'
  );
  // Nothing newer touched the differing path, so the missing history falls
  // back to every commit since the public tip rather than to none.
  assert.deepEqual(
    owed.map(commit => commit.sha),
    ['c2', 'c1']
  );
});

test('arguments default to a day and refuse what they cannot use', () => {
  assert.deepEqual(parsePublicSyncArgs([]), {
    source: 'HEAD',
    maxHours: DEFAULT_MAX_HOURS,
  });
  assert.deepEqual(
    parsePublicSyncArgs([
      '--',
      '--public',
      'https://example.test/public.git',
      '--max-hours',
      '6',
    ]),
    {
      source: 'HEAD',
      maxHours: 6,
      publicRepository: 'https://example.test/public.git',
    }
  );
  assert.throws(() => parsePublicSyncArgs(['--max-hours', '0']), /positive/u);
  assert.throws(() => parsePublicSyncArgs(['--public']), /Usage/u);
  assert.throws(() => parsePublicSyncArgs(['--force', 'x']), /Usage/u);
});

// BUG-316. Runs as GitHub's REST `GET /repos/Full-Vibe/exawatt/actions/runs`
// returned them on 2026-10-22 (the fields the check reads, values verbatim):
// Secret Scan red since run 199 after a pass, a cancelled run between them,
// CI with no pass in the page, CodeQL green.
const PUBLIC_RUNS = [
  {
    id: 39778751570,
    name: 'Secret Scan',
    path: '.github/workflows/gitleaks.yml',
    workflow_id: 337625252,
    head_branch: 'master',
    head_sha: '19b534f970ae50549f4fb2f88fee93ee6e83957b',
    event: 'push',
    status: 'completed',
    conclusion: 'failure',
    run_number: 329,
    created_at: '2026-10-22T12:29:25Z',
    html_url: 'https://github.com/Full-Vibe/exawatt/actions/runs/39778751570',
  },
  {
    id: 39778751387,
    name: 'CI',
    path: '.github/workflows/ci.yml',
    workflow_id: 337625250,
    head_branch: 'master',
    head_sha: '19b534f970ae50549f4fb2f88fee93ee6e83957b',
    event: 'push',
    status: 'completed',
    conclusion: 'failure',
    run_number: 329,
    created_at: '2026-10-22T12:29:25Z',
    html_url: 'https://github.com/Full-Vibe/exawatt/actions/runs/39778751387',
  },
  {
    id: 39778751376,
    name: 'CodeQL',
    path: '.github/workflows/codeql.yml',
    workflow_id: 337625251,
    head_branch: 'master',
    head_sha: '19b534f970ae50549f4fb2f88fee93ee6e83957b',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    run_number: 338,
    created_at: '2026-10-22T12:29:25Z',
    html_url: 'https://github.com/Full-Vibe/exawatt/actions/runs/39778751376',
  },
  {
    id: 37367135412,
    name: 'Secret Scan',
    path: '.github/workflows/gitleaks.yml',
    workflow_id: 337625252,
    head_branch: 'master',
    head_sha: 'fe5fecf679d96e10a7cfc5b8638d8a4d317dc334',
    event: 'push',
    status: 'completed',
    conclusion: 'failure',
    run_number: 199,
    created_at: '2026-10-05T20:01:18Z',
    html_url: 'https://github.com/Full-Vibe/exawatt/actions/runs/37367135412',
  },
  {
    id: 37366230830,
    name: 'Secret Scan',
    path: '.github/workflows/gitleaks.yml',
    workflow_id: 337625252,
    head_branch: 'master',
    head_sha: 'fc601430fad231de089a5f464faf62ed262b195c',
    event: 'push',
    status: 'completed',
    conclusion: 'cancelled',
    run_number: 198,
    created_at: '2026-10-05T19:52:48Z',
    html_url: 'https://github.com/Full-Vibe/exawatt/actions/runs/37366230830',
  },
  {
    id: 37261980484,
    name: 'Secret Scan',
    path: '.github/workflows/gitleaks.yml',
    workflow_id: 337625252,
    head_branch: 'master',
    head_sha: '9511b7f459577ca480cf9cc61f30031fd269c7a6',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    run_number: 195,
    created_at: '2026-10-05T04:05:01Z',
    html_url: 'https://github.com/Full-Vibe/exawatt/actions/runs/37261980484',
  },
];

/** A `fetch` that answers like GitHub, recording what it was asked. */
function github(status, body, calls = []) {
  return async (url, init) => {
    calls.push({ url: new URL(url), headers: init.headers });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

test('the public repository is named from every form its remote takes', () => {
  for (const url of [
    'https://github.com/Full-Vibe/exawatt.git',
    'https://github.com/Full-Vibe/exawatt',
    'git@github.com:Full-Vibe/exawatt.git',
    'ssh://git@github.com/Full-Vibe/exawatt.git',
  ]) {
    assert.equal(githubRepository(url), 'Full-Vibe/exawatt', url);
  }
  assert.equal(githubRepository('/tmp/public.git'), undefined);
  assert.equal(githubRepository('https://example.test/a/b.git'), undefined);
});

test('the runs are read as concluded master pushes, with the token when there is one', async () => {
  const calls = [];
  const runs = await readPublicWorkflowRuns('Full-Vibe/exawatt', {
    token: 'test-token',
    request: github(200, { total_count: 6, workflow_runs: PUBLIC_RUNS }, calls),
  });
  assert.equal(runs.length, PUBLIC_RUNS.length);
  const [{ url, headers }] = calls;
  assert.equal(url.pathname, '/repos/Full-Vibe/exawatt/actions/runs');
  assert.equal(url.searchParams.get('branch'), 'master');
  assert.equal(url.searchParams.get('event'), 'push');
  assert.equal(url.searchParams.get('status'), 'completed');
  assert.equal(headers.authorization, 'Bearer test-token');
  const anonymous = [];
  await readPublicWorkflowRuns('Full-Vibe/exawatt', {
    request: github(200, { total_count: 0, workflow_runs: [] }, anonymous),
  });
  assert.equal(anonymous[0].headers.authorization, undefined);
});

test('a refused or malformed answer is an error, never an empty list', async () => {
  await assert.rejects(
    readPublicWorkflowRuns('Full-Vibe/exawatt', {
      request: github(403, { message: 'API rate limit exceeded' }),
    }),
    /GitHub answered 403/u
  );
  await assert.rejects(
    readPublicWorkflowRuns('Full-Vibe/exawatt', {
      request: github(200, { message: 'Not Found' }),
    }),
    /no workflow_runs/u
  );
});

test('each workflow is judged by its newest pass or failure and dated from its newest pass', () => {
  const verdicts = Object.fromEntries(
    publicWorkflowVerdicts(PUBLIC_RUNS).map(verdict => [verdict.name, verdict])
  );
  assert.deepEqual(Object.keys(verdicts).sort(), [
    'CI',
    'CodeQL',
    'Secret Scan',
  ]);
  assert.equal(verdicts.CodeQL.status, 'green');
  const scan = verdicts['Secret Scan'];
  assert.equal(scan.status, 'failing');
  assert.equal(scan.latest.id, 39778751570);
  // The cancelled run between them is neither a pass nor a failure.
  assert.equal(scan.failures, 2);
  assert.equal(scan.since.id, 37367135412);
  assert.equal(scan.sinceIsBound, false);
  assert.equal(verdicts.CI.status, 'failing');
  assert.equal(verdicts.CI.sinceIsBound, true);
  const report = formatWorkflowReport(Object.values(verdicts)).join('\n');
  for (const name of ['CI', 'Secret Scan']) {
    assert.match(report, new RegExp(`FAILING: ${name} `, 'u'));
  }
  assert.doesNotMatch(report, /CodeQL/u);
  assert.match(report, /actions\/runs\/39778751570/u);
});

test('only a read that finds every workflow green lets the check pass', async () => {
  const green = PUBLIC_RUNS.filter(run => run.name === 'CodeQL');
  const cases = [
    ['green', github(200, { workflow_runs: green }), true],
    ['failing', github(200, { workflow_runs: PUBLIC_RUNS }), false],
    ['empty', github(200, { workflow_runs: [] }), false],
    ['refused', github(502, { message: 'Bad Gateway' }), false],
  ];
  for (const [label, request, passes] of cases) {
    const report = await publicWorkflowReport(
      'https://github.com/Full-Vibe/exawatt.git',
      { request }
    );
    assert.equal(report.green, passes, label);
    assert.ok(report.lines.length > 0, label);
  }
  const elsewhere = await publicWorkflowReport('/tmp/public.git', {
    request: github(200, { workflow_runs: green }),
  });
  assert.equal(elsewhere.green, false);
});
