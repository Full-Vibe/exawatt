import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_MAX_HOURS,
  formatPublicSyncReport,
  owedSourceCommits,
  parsePublicSyncArgs,
  publicSyncVerdict,
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
