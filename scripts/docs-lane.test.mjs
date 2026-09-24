import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { parseArgs } from './agent-land.mjs';
import {
  DIRECT_RECOVERY_ENV,
  FLOOR_VERIFIED_ENV,
  guardMasterPush,
} from './lib/docs-check.mjs';
import { docsLaneRefusal } from './lib/docs-lane.mjs';
import {
  commit,
  createQueueFixture,
  write,
} from './lib/delivery-queue-fixture.mjs';
import { git, gitOutcome } from './lib/hermetic-git.mjs';

/**
 * BUG-200: every push to master goes through the queue.
 *
 * In September 20 of 132 master commits skipped the queue. They caused 13 of
 * the 38 ticket deaths and every repeat rebase at the head; one ticket held
 * the head through three direct pushes in 25 minutes. These tests drive this
 * tree's real `agent-land.mjs` and real versioned pre-push hook against a
 * bare local origin.
 */

function tickets(fixture) {
  const queue = path.join(fixture.main, '.git', 'exawatt-delivery', 'queue');
  try {
    return readdirSync(queue)
      .filter(file => file.endsWith('.json'))
      .map(file => JSON.parse(readFileSync(path.join(queue, file), 'utf8')))
      .sort((left, right) => left.number - right.number);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

test('parses the docs lane', () => {
  assert.equal(parseArgs(['--', '--docs']).docs, true);
  assert.equal(parseArgs([]).docs, false);
});

test('the docs lane takes Markdown and docs/ only', () => {
  assert.equal(docsLaneRefusal(['AGENTS.md', 'docs/engineering/x.md']), null);
  assert.match(docsLaneRefusal([]), /nothing to land/u);
  assert.match(
    docsLaneRefusal(['docs/a.md', 'src/app.ts']),
    /documentation only[\s\S]*src\/app\.ts/u
  );
});

test('the hook excuses exactly the SHA agent:land states, never a deletion', async () => {
  const fixture = createQueueFixture('exawatt-guard-');
  try {
    const sha = git(fixture.main, ['rev-parse', 'HEAD']);
    const guard = (env, localSha = sha, remoteRef = 'refs/heads/master') =>
      guardMasterPush({
        root: fixture.main,
        remoteName: 'origin',
        remoteUrl: fixture.origin,
        updates: [
          {
            localRef: 'refs/heads/master',
            localSha,
            remoteRef,
            remoteSha: sha,
          },
        ],
        env,
      });
    assert.equal((await guard({})).verdict, 'refuse');
    assert.equal((await guard({ [FLOOR_VERIFIED_ENV]: sha })).verdict, 'skip');
    assert.equal((await guard({ [DIRECT_RECOVERY_ENV]: sha })).verdict, 'skip');
    assert.equal(
      (await guard({ [FLOOR_VERIFIED_ENV]: '1'.repeat(40) })).verdict,
      'refuse',
      'a floor signal for another commit is not a pass for this one'
    );
    assert.equal(
      (await guard({ [FLOOR_VERIFIED_ENV]: '0'.repeat(40) }, '0'.repeat(40)))
        .verdict,
      'refuse',
      'deleting master is a push to master'
    );
    assert.equal((await guard({}, sha, 'refs/heads/topic')).verdict, 'skip');
  } finally {
    fixture.cleanup();
  }
});

test('a direct push to master is refused, docs or code, and names the docs lane', () => {
  const fixture = createQueueFixture('exawatt-direct-push-');
  try {
    const before = fixture.originMaster();
    write(fixture.main, 'docs/guide.md', '# Guide\n\nA direct edit.\n');
    commit(fixture.main, 'docs: direct');
    const docs = gitOutcome(fixture.main, ['push', 'origin', 'master']);
    assert.notEqual(docs.status, 0, docs.output);
    assert.match(docs.output, /outside the delivery queue/u);
    assert.match(docs.output, /pnpm agent:land -- --docs/u);
    write(fixture.main, 'src/app.ts', 'export const app = 2;\n');
    commit(fixture.main, 'fix: direct');
    const code = gitOutcome(fixture.main, ['push', 'origin', 'master']);
    assert.notEqual(code.status, 0, code.output);
    assert.equal(fixture.originMaster(), before);
    // Every other ref is untouched by the guard.
    const topic = gitOutcome(fixture.main, [
      'push',
      'origin',
      'HEAD:refs/heads/topic',
    ]);
    assert.equal(topic.status, 0, topic.output);
  } finally {
    fixture.cleanup();
  }
});

test('the docs lane lands a docs commit from the shared checkout without disturbing it', async () => {
  const fixture = createQueueFixture('exawatt-docs-lane-');
  try {
    write(fixture.main, 'docs/guide.md', '# Guide\n\nAn operator answer.\n');
    const landed = commit(fixture.main, 'docs: operator answer', [
      'docs/guide.md',
    ]);
    // Another session's uncommitted edit in the same checkout.
    write(fixture.main, 'src/app.ts', 'export const app = "in progress";\n');
    write(fixture.main, 'notes.txt', 'untracked\n');

    const output = await fixture.land(fixture.main, ['--docs']).completion;
    assert.match(output, /\[docs:check\] passed recipe-renderers/u);
    assert.match(output, /admitted ticket 1/u);
    assert.match(output, /STATUS .*integrated=/u);
    assert.match(output, /lane=docs/u);
    assert.equal(fixture.originMaster(), landed);
    assert.equal(git(fixture.main, ['rev-parse', 'HEAD']), landed);
    assert.equal(
      readFileSync(path.join(fixture.main, 'src/app.ts'), 'utf8'),
      'export const app = "in progress";\n',
      'the shared checkout keeps its uncommitted edits'
    );
    const [ticket] = tickets(fixture);
    assert.equal(ticket.status, 'integrated');
    assert.equal(ticket.lane, 'docs');
    assert.equal(
      git(fixture.main, ['worktree', 'list', '--porcelain'])
        .split('\n')
        .filter(line => line.startsWith('worktree ')).length,
      1,
      'the temporary checkout is removed'
    );
  } finally {
    fixture.cleanup();
  }
});

test('the docs lane rebases onto a moved master and moves the checkout with it', async () => {
  const fixture = createQueueFixture('exawatt-docs-lane-rebase-');
  try {
    write(
      fixture.main,
      'docs/guide.md',
      '# Guide\n\nFirst paragraph.\n\nMine.\n'
    );
    const candidate = commit(fixture.main, 'docs: mine');
    const other = fixture.advanceMaster({ 'docs/other.md': '# Other\n' });
    write(fixture.main, 'src/app.ts', 'export const app = "dirty";\n');

    const output = await fixture.land(fixture.main, ['--docs']).completion;
    assert.match(output, /rebase onto/u);
    assert.equal(
      output.match(/passed recipe-renderers/gu).length,
      2,
      'the rebased tree is re-checked with the docs checks, not the full floor'
    );
    const integrated = fixture.originMaster();
    assert.notEqual(integrated, candidate);
    assert.equal(git(fixture.origin, ['rev-parse', `${integrated}^`]), other);
    assert.equal(git(fixture.main, ['rev-parse', 'HEAD']), integrated);
    assert.equal(
      readFileSync(path.join(fixture.main, 'src/app.ts'), 'utf8'),
      'export const app = "dirty";\n'
    );
  } finally {
    fixture.cleanup();
  }
});

test('the docs lane refuses code and a failing docs check before taking a ticket', async () => {
  const fixture = createQueueFixture('exawatt-docs-lane-refuse-');
  try {
    const before = fixture.originMaster();
    write(fixture.main, 'src/app.ts', 'export const app = 3;\n');
    commit(fixture.main, 'fix: not docs');
    const code = await fixture.land(fixture.main, ['--docs']).exit;
    assert.notEqual(code.code, 0);
    assert.match(code.output, /documentation only[\s\S]*src\/app\.ts/u);
    git(fixture.main, ['reset', '--quiet', '--hard', before]);

    write(fixture.main, 'docs/guide.md', '# Guide\n\nA SEAM.\n');
    commit(fixture.main, 'docs: seam');
    const seam = await fixture.land(fixture.main, ['--docs']).exit;
    assert.notEqual(seam.code, 0);
    assert.match(seam.output, /FAILED recipe-renderers/u);
    assert.match(seam.output, /pnpm agent:land -- --docs/u);
    assert.deepEqual(tickets(fixture), []);
    assert.equal(fixture.originMaster(), before);
  } finally {
    fixture.cleanup();
  }
});
