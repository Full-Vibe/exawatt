import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  INSTALLED_DRIVER_CONFIG,
  appendMergeGitArgs,
  collidingIds,
  idsIn,
  mergeAppendOnly,
  parseHunks,
  splitLines,
} from './lib/append-merge.mjs';
import { probeRebase } from './lib/conflict-probe.mjs';
import {
  commit,
  createQueueFixture,
  finished,
  write,
} from './lib/delivery-queue-fixture.mjs';
import { git, gitOutcome, hermeticGitEnv } from './lib/hermetic-git.mjs';
import { allocateTicket } from './lib/delivery-queue.mjs';
import { allocateIds } from './lib/id-counter.mjs';

/**
 * BUG-203: an append-only merge driver for the engineering logs, and one id
 * counter. 13 of September's 20 rebase-conflict deaths were two pure
 * insertions at the same spot in a doc, and in 4 of those both sides had
 * taken the same BUG, D, incident or decision number.
 */

const ROADMAP = 'docs/engineering/roadmap.md';
const ID_NEXT = fileURLToPath(new URL('./id-next.mjs', import.meta.url));
const execFileAsync = promisify(execFile);

const BASE = [
  '# Roadmap',
  '',
  '## Backlog',
  '',
  '### BUG-1 First',
  '',
  'Status: done · ENG-1 · found 2026-09-01.',
  '',
  '## Amendment chain',
  '',
  '| Amended | Amended by |',
  '',
].join('\n');

function entry(id, title) {
  return `### ${id} ${title}\n\nStatus: bug · ENG-022 · found 2026-09-24.\n\n`;
}

function insertBefore(text, anchor, insert) {
  const at = text.indexOf(anchor);
  assert.ok(at >= 0, anchor);
  return text.slice(0, at) + insert + text.slice(at);
}

/** A tiny repository whose roadmap merges with the driver, like this one. */
function driverRepository(fixture) {
  const root = fixture.main;
  write(
    root,
    '.gitattributes',
    `${ROADMAP} merge=exawatt-append\ndocs/engineering/projects/*.md merge=exawatt-append\n`
  );
  write(root, ROADMAP, BASE);
  commit(root, 'roadmap');
  return root;
}

function branchWith(root, name, from, files) {
  git(root, ['checkout', '--quiet', '-b', name, from]);
  for (const [file, contents] of Object.entries(files))
    write(root, file, contents);
  const sha = commit(root, name);
  git(root, ['checkout', '--quiet', 'master']);
  return sha;
}

/** Rebases `branch` onto `onto` with the driver, as the queue head does. */
function rebase(root, branch, onto, args = appendMergeGitArgs()) {
  git(root, ['checkout', '--quiet', branch]);
  const outcome = gitOutcome(root, [...args, 'rebase', onto]);
  const text = readFileSync(path.join(root, ROADMAP), 'utf8');
  if (outcome.status !== 0) git(root, ['rebase', '--abort']);
  git(root, ['checkout', '--quiet', 'master']);
  return { ok: outcome.status === 0, output: outcome.output, text };
}

test('hunks come from the diff headers and the side text, not the diff body', () => {
  const side = splitLines('a\nX\nb\nc\n');
  assert.deepEqual(parseHunks('@@ -1,0 +2 @@\n+X\n', side), [
    { start: 1, end: 1, lines: ['X\n'] },
  ]);
  assert.deepEqual(parseHunks('@@ -3 +4,0 @@\n-d\n', side), [
    { start: 2, end: 3, lines: [] },
  ]);
});

test('ids an entry introduces are compared across sides, never ids the base carries', () => {
  assert.deepEqual(
    [
      ...idsIn(
        'BUG-12, FIX-3, D74, incident `0028`, decisions/0044-x.md',
        ROADMAP
      ),
    ].sort(),
    ['BUG 12', 'D 74', 'FIX 3', 'decision 0044', 'incident 0028']
  );
  assert.deepEqual(
    [
      ...idsIn(
        '- [`0029-x.md`](0029-x.md) — see decision `0030`',
        'docs/engineering/incidents/README.md'
      ),
    ].sort(),
    ['decision 0030', 'incident 0029']
  );
  const hunk = text => [{ start: 0, end: 0, lines: [text] }];
  assert.deepEqual(
    collidingIds({
      base: 'BUG-1',
      oursHunks: hunk('BUG-1 and BUG-2'),
      theirsHunks: hunk('BUG-1 and BUG-2'),
      filePath: ROADMAP,
    }),
    ['BUG 2']
  );
});

test('two pure insertions at one anchor keep both, ours first; an overlap stays a conflict', () => {
  const at = BASE.indexOf('## Amendment chain');
  const ours = insertBefore(BASE, '## Amendment chain', entry('BUG-2', 'Ours'));
  const theirs = insertBefore(
    BASE,
    '## Amendment chain',
    entry('BUG-3', 'Theirs')
  );
  const hunk = text => [
    {
      start: splitLines(BASE.slice(0, at)).length,
      end: splitLines(BASE.slice(0, at)).length,
      lines: splitLines(text),
    },
  ];
  assert.equal(
    mergeAppendOnly({
      base: BASE,
      oursHunks: hunk(entry('BUG-2', 'Ours')),
      theirsHunks: hunk(entry('BUG-3', 'Theirs')),
    }).merged,
    insertBefore(ours, '## Amendment chain', entry('BUG-3', 'Theirs'))
  );
  assert.ok(theirs.includes('BUG-3'));
  assert.match(
    mergeAppendOnly({
      base: BASE,
      oursHunks: [{ start: 4, end: 5, lines: ['### BUG-1 Renamed\n'] }],
      theirsHunks: [{ start: 4, end: 5, lines: ['### BUG-1 Other\n'] }],
    }).refused,
    /more than an insertion/u
  );
  assert.ok(
    mergeAppendOnly({
      base: BASE,
      oursHunks: [{ start: 8, end: 8, lines: ['new\n'] }],
      theirsHunks: [{ start: 8, end: 9, lines: ['## Changed chain\n'] }],
    }).refused,
    'an insertion against an edit of its anchor is not an append'
  );
  assert.ok(
    mergeAppendOnly({
      base: BASE,
      oursHunks: [{ start: 8, end: 9, lines: ['## Changed chain\n'] }],
      theirsHunks: [{ start: 8, end: 8, lines: ['new\n'] }],
    }).refused,
    'nor is an edit of the anchor against an insertion'
  );
});

test('a rebase with the driver: same-anchor entries merge, a duplicate id and a real overlap stay conflicts', () => {
  const fixture = createQueueFixture('exawatt-append-rebase-');
  try {
    const root = driverRepository(fixture);
    const base = git(root, ['rev-parse', 'HEAD']);
    const anchor = '## Amendment chain';
    const add = (id, title) => ({
      [ROADMAP]: insertBefore(BASE, anchor, entry(id, title)),
    });
    const master = branchWith(root, 'upstream', base, add('BUG-2', 'Upstream'));

    // Without the driver git refuses the pure insertion; with it, both stay.
    assert.equal(
      rebase(
        root,
        branchWith(root, 'plain', base, add('BUG-3', 'Mine')),
        master,
        []
      ).ok,
      false
    );
    const merged = rebase(
      root,
      branchWith(root, 'mine', base, add('BUG-3', 'Mine')),
      master
    );
    assert.ok(merged.ok, merged.output);
    assert.equal(
      merged.text,
      insertBefore(
        insertBefore(BASE, anchor, entry('BUG-2', 'Upstream')),
        anchor,
        entry('BUG-3', 'Mine')
      )
    );
    assert.doesNotMatch(merged.text, /<<<<<<<|>>>>>>>/u);

    const duplicate = rebase(
      root,
      branchWith(root, 'dup', base, add('BUG-2', 'Also two')),
      master
    );
    assert.equal(duplicate.ok, false);
    assert.match(duplicate.output, /both sides introduce BUG 2/u);
    assert.match(
      duplicate.text,
      /<<<<<<< /u,
      'git’s markers are left in place'
    );

    const overlap = rebase(
      root,
      branchWith(root, 'overlap', base, {
        [ROADMAP]: BASE.replace('### BUG-1 First', '### BUG-1 First, renamed'),
      }),
      branchWith(root, 'upstream-edit', base, {
        [ROADMAP]: BASE.replace('### BUG-1 First', '### BUG-1 First, edited'),
      })
    );
    assert.equal(overlap.ok, false);
    assert.match(overlap.text, /<<<<<<< /u);
  } finally {
    fixture.cleanup();
  }
});

test('the conflict probe reaches the same verdicts through the driver', async () => {
  const fixture = createQueueFixture('exawatt-append-probe-');
  try {
    const root = driverRepository(fixture);
    const base = git(root, ['rev-parse', 'HEAD']);
    const anchor = '## Amendment chain';
    const add = (id, title) => ({
      [ROADMAP]: insertBefore(BASE, anchor, entry(id, title)),
    });
    const master = branchWith(root, 'upstream', base, add('BUG-2', 'Upstream'));
    const probe = sha =>
      probeRebase(root, {
        sha,
        onto: master,
        gitArgs: [`--attr-source=${master}`, ...appendMergeGitArgs()],
      });
    assert.deepEqual(
      await probe(branchWith(root, 'mine', base, add('BUG-3', 'Mine'))),
      { clean: true }
    );
    assert.deepEqual(
      (await probe(branchWith(root, 'dup', base, add('BUG-2', 'Also two'))))
        .paths,
      [ROADMAP]
    );
  } finally {
    fixture.cleanup();
  }
});

test('the installed command falls back to git’s own merge where the driver is absent', () => {
  const fixture = createQueueFixture('exawatt-append-fallback-');
  try {
    const root = driverRepository(fixture);
    for (const [key, value] of INSTALLED_DRIVER_CONFIG) {
      git(root, ['config', key, value]);
    }
    const base = git(root, ['rev-parse', 'HEAD']);
    const anchor = '## Amendment chain';
    const master = branchWith(root, 'upstream', base, {
      [ROADMAP]: insertBefore(BASE, anchor, entry('BUG-2', 'Upstream')),
    });
    // This fixture tree has no scripts/merge-append-docs.mjs, as a checkout
    // older than the driver would not: the conflict must keep its markers.
    const result = rebase(
      root,
      branchWith(root, 'mine', base, {
        [ROADMAP]: insertBefore(BASE, anchor, entry('BUG-3', 'Mine')),
      }),
      master,
      []
    );
    assert.equal(result.ok, false);
    assert.match(result.text, /<<<<<<< [\s\S]*=======[\s\S]*>>>>>>> /u);
  } finally {
    fixture.cleanup();
  }
});

function tickets(root) {
  const queue = path.join(root, '.git', 'exawatt-delivery', 'queue');
  return readdirSync(queue)
    .filter(file => file.endsWith('.json'))
    .map(file => JSON.parse(readFileSync(path.join(queue, file), 'utf8')))
    .sort((left, right) => left.number - right.number);
}

test('two tickets appending backlog entries at one anchor both land through the queue', async () => {
  const fixture = createQueueFixture('exawatt-append-queue-');
  try {
    const root = driverRepository(fixture);
    git(root, ['push', '--quiet', '--no-verify', 'origin', 'master']);
    const anchor = '## Amendment chain';
    const first = fixture.agentWorktree('agent/entry-one', {
      [ROADMAP]: insertBefore(BASE, anchor, entry('BUG-2', 'One')),
    });
    const second = fixture.agentWorktree('agent/entry-two', {
      [ROADMAP]: insertBefore(BASE, anchor, entry('BUG-3', 'Two')),
    });
    // Written against the same base, and taking the id the second one took.
    const duplicate = fixture.agentWorktree('agent/entry-dup', {
      [ROADMAP]: insertBefore(BASE, anchor, entry('BUG-3', 'Again')),
    });
    const env = { EXAWATT_AGENT_LAND_PROBE_SECONDS: '0.2' };
    assert.equal((await finished(fixture.land(first, [], env))).code, 0);
    const landed = await finished(fixture.land(second, [], env));
    assert.equal(landed.code, 0, landed.output);
    assert.match(landed.output, /rebase onto/u);
    assert.match(landed.output, /kept both insertions/u);
    const text = git(fixture.origin, ['show', `master:${ROADMAP}`]);
    assert.ok(
      text.includes(
        `${entry('BUG-2', 'One')}${entry('BUG-3', 'Two')}${anchor}`
      ),
      text
    );

    const refused = await finished(fixture.land(duplicate, [], env));
    assert.notEqual(refused.code, 0, refused.output);
    assert.match(refused.output, /would conflict when rebased/u);
    assert.match(refused.output, new RegExp(`\\n  ${ROADMAP}`, 'u'));
    assert.deepEqual(
      tickets(root).map(ticket => ticket.status),
      ['integrated', 'integrated']
    );
  } finally {
    fixture.cleanup();
  }
});

test('id:next allocates past origin/master and the queue, once each, under concurrency', async () => {
  const fixture = createQueueFixture('exawatt-id-next-');
  try {
    const root = fixture.main;
    write(root, ROADMAP, `${BASE}\n### BUG-7 Seven\n\nD3 landed.\n`);
    write(root, 'docs/engineering/incidents/0002-two.md', '# two\n');
    write(root, 'docs/engineering/decisions/0005-five.md', '# five\n');
    commit(root, 'ids');
    git(root, ['push', '--quiet', '--no-verify', 'origin', 'master']);

    const next = async kind => (await allocateIds(root, kind)).ids[0];
    assert.equal(await next('BUG'), 'BUG-8');
    assert.equal(await next('BUG'), 'BUG-9');
    assert.equal(await next('D'), 'D4');
    assert.equal(await next('incident'), '0003');
    assert.equal(await next('decision'), '0006');

    // A hand-picked id that reached master still moves the counter past it.
    write(root, 'docs/engineering/projects/p.md', '# P\n\nBUG-20 by hand.\n');
    commit(root, 'hand-picked');
    git(root, ['push', '--quiet', '--no-verify', 'origin', 'master']);
    assert.equal(await next('BUG'), 'BUG-21');

    const outputs = await Promise.all(
      Array.from({ length: 8 }, () =>
        execFileAsync(process.execPath, [ID_NEXT, 'BUG'], {
          cwd: root,
          env: hermeticGitEnv(),
        })
      )
    );
    const ids = outputs.map(output => output.stdout.trim());
    assert.equal(new Set(ids).size, 8, ids.join(' '));
    assert.deepEqual(
      ids.map(id => Number(id.slice(4))).sort((a, b) => a - b),
      [22, 23, 24, 25, 26, 27, 28, 29]
    );

    // An id taken by a ticket still in the queue is taken too.
    git(root, ['checkout', '--quiet', '-b', 'agent/in-flight']);
    write(root, ROADMAP, `${BASE}\n### BUG-40 In flight\n`);
    const inFlight = commit(root, 'in flight');
    git(root, ['checkout', '--quiet', 'master']);
    await allocateTicket(root, {
      branch: 'agent/in-flight',
      baseSha: inFlight,
      candidateSha: inFlight,
      attemptSha: inFlight,
      attemptRef: 'refs/heads/agent-attempts/in-flight',
    });
    assert.equal(await next('BUG'), 'BUG-41');
  } finally {
    fixture.cleanup();
  }
});
