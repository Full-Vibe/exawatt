import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  RECIPE_RENDERERS_CHECK,
  classifyDeliveryPolicy,
  classifyDocsChecks,
} from './lib/delivery-policy.mjs';
import { FLOOR_VERIFIED_ENV, guardDocsPush } from './lib/docs-check.mjs';
import { git, gitOutcome, hermeticGitEnv } from './lib/hermetic-git.mjs';

/**
 * BUG-195: a docs-only commit pushed straight to `master` skipped every
 * landing check. `0cbcb226` added one blank line before `### BUG-163` in the
 * roadmap; the public render then carried a blank-line seam, recipe-renderers
 * refused it, and every later landing failed its rebase checks on a change
 * nobody in the queue had made.
 *
 * These tests push to a local bare remote through the real versioned hook,
 * installed by the real `pnpm hooks:install`, running the real `docs:check`
 * over a clone of this tree.
 */

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('docs:check runs the floor’s own check definitions', () => {
  const paths = ['docs/engineering/roadmap.md', 'AGENTS.md'];
  const floor = new Map(
    classifyDeliveryPolicy(paths).map(check => [check.id, check])
  );
  const docs = classifyDocsChecks(paths);
  assert.deepEqual(docs.map(check => check.id).sort(), [
    'content:scan',
    'open-source:paths:check',
    'recipe-renderers',
    'roadmap-contract',
  ]);
  for (const check of docs) {
    if (check === RECIPE_RENDERERS_CHECK) continue;
    assert.deepEqual(check, floor.get(check.id), check.id);
  }
  // The floor runs the renderer contract inside `test:agent-delivery`.
  const scripts = JSON.parse(
    readFileSync(path.join(ROOT, 'package.json'), 'utf8')
  ).scripts;
  assert.ok(floor.has('test:agent-delivery'));
  assert.ok(
    scripts['test:agent-delivery']
      .split(' ')
      .includes(RECIPE_RENDERERS_CHECK.args.at(-1))
  );
  // Outside docs/engineering the roadmap contract is not owed, as on the floor.
  assert.equal(
    classifyDocsChecks(['README.md']).some(
      check => check.id === 'roadmap-contract'
    ),
    false
  );
});

/** The line `0cbcb226` doubled, or a public heading if that item has moved. */
function seamAnchor(roadmap) {
  for (const pattern of [/^### BUG-163 /mu, /^## Amendment chain$/mu]) {
    const match = pattern.exec(roadmap);
    if (match) return match.index;
  }
  throw new Error(
    'docs-check.test.mjs: no roadmap heading to seam before; name a current public heading'
  );
}

function projectedPublicTree() {
  const manifest = JSON.parse(
    readFileSync(
      path.join(ROOT, 'scripts/open-source-paths.manifest.json'),
      'utf8'
    )
  );
  return Object.keys(manifest.recipes).length === 0;
}

describe('the versioned pre-push hook', () => {
  let parent;
  let work;
  let remote;
  const roadmap = () => path.join(work, 'docs/engineering/roadmap.md');
  const env = (extra = {}) => hermeticGitEnv(extra);

  function commit(message) {
    git(work, ['add', '--all']);
    git(work, ['commit', '--quiet', '--no-verify', '-m', message]);
    return git(work, ['rev-parse', 'HEAD']);
  }

  /** Pushes master through the hook and reports what happened. */
  function push(extra = {}) {
    const result = gitOutcome(work, ['push', 'origin', 'master'], extra);
    return { ok: result.status === 0, output: result.output };
  }

  const remoteMaster = () => git(remote, ['rev-parse', 'refs/heads/master']);

  before(() => {
    parent = mkdtempSync(path.join(tmpdir(), 'exawatt-docs-push-'));
    work = path.join(parent, 'work');
    remote = path.join(parent, 'remote.git');
    // Both sides borrow this repository's objects, so neither copies history.
    git(parent, ['clone', '--quiet', '--bare', '--shared', ROOT, remote]);
    git(parent, ['clone', '--quiet', '--shared', '--no-checkout', ROOT, work]);
    git(work, [
      'checkout',
      '--quiet',
      '-B',
      'master',
      git(ROOT, ['rev-parse', 'HEAD']),
    ]);
    git(work, ['remote', 'set-url', 'origin', remote]);

    // The tree under test is this working tree, uncommitted edits included.
    const changed = [
      ...git(ROOT, ['diff', '--name-only', 'HEAD']).split('\n'),
      ...git(ROOT, ['ls-files', '--others', '--exclude-standard']).split('\n'),
    ].filter(Boolean);
    for (const file of changed) {
      const target = path.join(work, file);
      if (existsSync(path.join(ROOT, file))) {
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(path.join(ROOT, file), target);
      } else {
        rmSync(target, { force: true });
      }
    }
    if (git(work, ['status', '--porcelain'])) commit('fixture: working tree');

    const packages = path.join(ROOT, 'packages');
    for (const directory of [
      '.',
      ...readdirSync(packages).map(name => path.join('packages', name)),
    ]) {
      const modules = path.join(ROOT, directory, 'node_modules');
      if (existsSync(modules))
        symlinkSync(modules, path.join(work, directory, 'node_modules'));
    }

    git(work, ['push', '--quiet', '--force', 'origin', 'master']);
    execFileSync('pnpm', ['hooks:install'], {
      cwd: work,
      env: env(),
      stdio: 'ignore',
    });
    assert.equal(git(work, ['config', 'core.hooksPath']), '.githooks');
  });

  after(() => {
    if (parent) rmSync(parent, { recursive: true, force: true });
  });

  it('passes a clean roadmap change after running every docs check', () => {
    const text = readFileSync(roadmap(), 'utf8');
    const at = seamAnchor(text);
    writeFileSync(
      roadmap(),
      `${text.slice(0, at)}A clean fixture paragraph.\n\n${text.slice(at)}`
    );
    const sha = commit('docs: clean fixture paragraph');
    const result = push();
    assert.ok(result.ok, result.output);
    for (const id of ['recipe-renderers', 'roadmap-contract', 'content:scan'])
      assert.match(result.output, new RegExp(`passed ${id} `));
    assert.equal(remoteMaster(), sha);
  });

  it('refuses the 0cbcb226 seam and names the failing check', t => {
    if (projectedPublicTree()) {
      t.skip('the projected public tree renders no recipes, so it has no seam');
      return;
    }
    const before = remoteMaster();
    const text = readFileSync(roadmap(), 'utf8');
    const at = seamAnchor(text);
    writeFileSync(roadmap(), `${text.slice(0, at)}\n${text.slice(at)}`);
    commit('docs: queue Spatial attention keyboard request');
    // A floor signal for any other commit is not a pass for this one.
    const result = push({ [FLOOR_VERIFIED_ENV]: before });
    assert.equal(result.ok, false, result.output);
    assert.match(result.output, /FAILED recipe-renderers/);
    assert.match(result.output, /blank-line seam/);
    assert.match(result.output, /push refused: recipe-renderers failed/);
    assert.match(result.output, /pnpm docs:check/);
    assert.match(result.output, /--no-verify` is for the recovery path/);
    assert.equal(remoteMaster(), before);
  });

  it('trusts agent:land for exactly the SHA its floor verified', () => {
    const sha = git(work, ['rev-parse', 'HEAD']);
    const result = push({ [FLOOR_VERIFIED_ENV]: sha });
    assert.ok(result.ok, result.output);
    assert.doesNotMatch(result.output, /\[docs:check\]/);
    assert.equal(remoteMaster(), sha);
  });

  it('does not fire on a push that changes no docs', () => {
    // An unclassified path fails the path check, so a pass proves no check ran.
    writeFileSync(path.join(work, 'unclassified-probe.txt'), 'probe\n');
    const sha = commit('chore: non-docs change');
    const result = push();
    assert.ok(result.ok, result.output);
    assert.doesNotMatch(result.output, /\[docs:check\]/);
    assert.equal(remoteMaster(), sha);
  });

  it('refuses before any check when the checkout is not what is pushed', async () => {
    const head = git(work, ['rev-parse', 'HEAD']);
    const guard = updates =>
      guardDocsPush({
        root: work,
        remoteName: 'origin',
        remoteUrl: remote,
        updates,
        env: {},
        runChecks: () => assert.fail('no check may run'),
      });
    writeFileSync(path.join(work, 'README.md'), 'edited\n');
    const docsSha = commit('docs: readme');
    writeFileSync(path.join(work, 'README.md'), 'dirty\n');
    const dirty = await guard([
      {
        localRef: 'refs/heads/master',
        localSha: docsSha,
        remoteRef: 'refs/heads/master',
        remoteSha: head,
      },
    ]);
    assert.equal(dirty.reason, 'dirty-checkout');
    git(work, ['checkout', '--quiet', '--', 'README.md']);
    git(work, ['checkout', '--quiet', '--detach', head]);
    const elsewhere = await guard([
      {
        localRef: 'refs/heads/master',
        localSha: docsSha,
        remoteRef: 'refs/heads/master',
        remoteSha: head,
      },
    ]);
    assert.equal(elsewhere.reason, 'not-checked-out');
  });
});
