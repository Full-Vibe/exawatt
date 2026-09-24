import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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
import { FLOOR_VERIFIED_ENV } from './lib/docs-check.mjs';
import { git, gitOutcome, hermeticGitEnv } from './lib/hermetic-git.mjs';

/**
 * BUG-195: a docs-only commit pushed straight to `master` skipped every
 * landing check. `0cbcb226` added one blank line before `### BUG-163` in the
 * roadmap; the public render then carried a blank-line seam, recipe-renderers
 * refused it, and every later landing failed its rebase checks on a change
 * nobody in the queue had made.
 *
 * BUG-200 closed the path: docs land through `agent:land -- --docs`, which
 * runs these checks, and the hook refuses every other push to master.
 *
 * These tests run the real `docs:check` over a clone of this tree, and push
 * to a local bare remote through the real versioned hook installed by the
 * real `pnpm hooks:install`. `scripts/docs-lane.test.mjs` drives the lane.
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

  /** Runs this tree's `docs:check` against the clone's committed change. */
  function docsCheck() {
    const result = spawnSync(
      process.execPath,
      [path.join(work, 'scripts/docs-check.mjs'), '--base', 'HEAD~1'],
      { cwd: work, env: env(), encoding: 'utf8' }
    );
    return {
      ok: result.status === 0,
      output: `${result.stdout}${result.stderr}`,
    };
  }

  it('passes a clean roadmap change after running every docs check', () => {
    const text = readFileSync(roadmap(), 'utf8');
    const at = seamAnchor(text);
    writeFileSync(
      roadmap(),
      `${text.slice(0, at)}A clean fixture paragraph.\n\n${text.slice(at)}`
    );
    commit('docs: clean fixture paragraph');
    const result = docsCheck();
    assert.ok(result.ok, result.output);
    for (const id of ['recipe-renderers', 'roadmap-contract', 'content:scan'])
      assert.match(result.output, new RegExp(`passed ${id} `));
  });

  it('refuses the 0cbcb226 seam and names the failing check', t => {
    if (projectedPublicTree()) {
      t.skip('the projected public tree renders no recipes, so it has no seam');
      return;
    }
    const text = readFileSync(roadmap(), 'utf8');
    const at = seamAnchor(text);
    writeFileSync(roadmap(), `${text.slice(0, at)}\n${text.slice(at)}`);
    commit('docs: queue Spatial attention keyboard request');
    const result = docsCheck();
    assert.equal(result.ok, false, result.output);
    assert.match(result.output, /FAILED recipe-renderers/);
    // The authoring lint's own finding, at the line this test doubled: the
    // renderer unit tests' expected messages also say "blank-line seam", so
    // only the path and line prove the lint ran over this commit (BUG-196).
    const line = text.slice(0, at).split('\n').length - 1;
    assert.match(
      result.output,
      new RegExp(
        `docs/engineering/roadmap\\.md line ${line} has two blank lines in a row`
      )
    );
    git(work, ['reset', '--quiet', '--hard', 'HEAD~1']);
  });

  it('refuses a direct docs push and names the docs lane', () => {
    const before = remoteMaster();
    const result = push();
    assert.equal(result.ok, false, result.output);
    assert.match(result.output, /outside the delivery queue/);
    assert.match(result.output, /pnpm agent:land -- --docs/);
    assert.match(result.output, /--no-verify` is for the recovery path/);
    // A floor signal for any other commit is not a pass for this one.
    const other = push({ [FLOOR_VERIFIED_ENV]: before });
    assert.equal(other.ok, false, other.output);
    assert.equal(remoteMaster(), before);
  });

  it('trusts agent:land for exactly the SHA its floor verified', () => {
    const sha = git(work, ['rev-parse', 'HEAD']);
    const result = push({ [FLOOR_VERIFIED_ENV]: sha });
    assert.ok(result.ok, result.output);
    assert.doesNotMatch(result.output, /push refused/);
    assert.equal(remoteMaster(), sha);
  });

  it('refuses a direct push that changes no docs as well', () => {
    const before = remoteMaster();
    writeFileSync(path.join(work, 'unclassified-probe.txt'), 'probe\n');
    commit('chore: non-docs change');
    const result = push();
    assert.equal(result.ok, false, result.output);
    assert.match(result.output, /outside the delivery queue/);
    assert.equal(remoteMaster(), before);
  });
});
