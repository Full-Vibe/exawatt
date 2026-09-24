import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FIXTURE_IDENTITY, git } from './lib/hermetic-git.mjs';

/**
 * BUG-047: `pnpm test:run` was red on every machine in the building because one
 * unconditional test depended on ambient environment nobody sets.
 *
 * The mechanism is narrow and worth naming, because it is the only way the
 * vitest suite can acquire an ambient dependency at all: a test spawns a
 * REPOSITORY SCRIPT and hands the child `{ ...process.env }`. The child then
 * inherits whatever the author's shell happens to carry. The day a script
 * starts refusing without a variable — `8f53d3f3` made the Supabase publisher
 * require `EXAWATT_DISTRIBUTION_CONFIG_JSON` at module load — the suite fails
 * for everyone who does not have it, which here was everyone.
 *
 * So the rule is: a suite test that runs a repository script STATES the child's
 * environment. Not because inheritance is untidy, but because writing the
 * environment down is what makes the author see the input the child requires,
 * at the moment they can still supply it as a fixture. Skipping is not the
 * alternative — this repository has recorded that disease four times (BUG-010,
 * BUG-011, BUG-014, BUG-043).
 *
 * This is deliberately not a general `process.env` lint. Tests that set and
 * restore their OWN process's variables are fine, and a test that spawns a
 * shell or an agent harness genuinely wants the real environment. Only a
 * repository script under `scripts/` is covered, because only that pair —
 * repo test, repo script — is a contract both sides of which we own.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * `scripts/*.test.mjs` are node:test files run by `test:agent-delivery`, not
 * part of the vitest suite, and they legitimately drive scripts through the
 * shell. Everything else here is build output or vendored code.
 */
const PRUNED = new Set([
  '.git',
  '.next',
  '.exawatt-build',
  'node_modules',
  'dist',
  'dist-electron',
  'release',
  'scripts',
  'coverage',
]);

const SUITE_TEST_FILE = /\.(?:test|spec)\.tsx?$/;
const REPOSITORY_SCRIPT = /scripts\/[A-Za-z0-9_./-]+\.(?:cjs|mjs)/;
const CHILD_PROCESS_CALL =
  /\b(?:execFileSync|execFile|execSync|spawnSync|spawn)\(/;
const AMBIENT_SPREAD = /\.\.\.\s*process\.env\b/;
const EXPLICIT_CHILD_ENV = /\benv:\s*\{/;

async function suiteTestFiles(directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (PRUNED.has(entry.name)) continue;
      found.push(...(await suiteTestFiles(absolute)));
    } else if (SUITE_TEST_FILE.test(entry.name)) {
      found.push(absolute);
    }
  }
  return found;
}

async function testsThatRunRepositoryScripts() {
  const files = await suiteTestFiles();
  const running = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (REPOSITORY_SCRIPT.test(source) && CHILD_PROCESS_CALL.test(source)) {
      running.push({ relative: path.relative(root, file), source });
    }
  }
  return running.sort((a, b) => a.relative.localeCompare(b.relative));
}

test('a suite test that runs a repository script states the child environment', async () => {
  const [files, running] = await Promise.all([
    suiteTestFiles(),
    testsThatRunRepositoryScripts(),
  ]);

  // Without this the rule rots into a vacuous pass the moment the discovery
  // walk stops finding anything — the shape of BUG-010/011/014/043.
  assert.ok(files.length > 0, 'the suite-test discovery walk is broken');
  if (running.length === 0) {
    const disposition = JSON.parse(
      await readFile(
        path.join(root, 'scripts/open-source-paths.manifest.json'),
        'utf8'
      )
    );
    assert.deepEqual(
      disposition.recipes,
      {},
      'only the projected public tree may omit every private script-spawning suite test'
    );
    return;
  }

  for (const { relative, source } of running) {
    assert.doesNotMatch(
      source,
      AMBIENT_SPREAD,
      `${relative} spreads process.env into a repository script. Pass the ` +
        'variables the script needs explicitly, and supply any required ' +
        'contract as a fixture, so the suite does not depend on the shell.'
    );
    assert.match(
      source,
      EXPLICIT_CHILD_ENV,
      `${relative} runs a repository script without stating the child's env. ` +
        'Pass `env: { ... }` — `env: {}` if the script needs nothing — so a ' +
        'new required variable is visible here rather than red on someone ' +
        "else's machine."
    );
  }
});

/**
 * BUG-160: CI went red on a fixture that committed in a clone of a repository
 * whose identity had been configured only on the original. It passed on the
 * operator's machine because git read his global configuration, and where that
 * had nothing, guessed a name from his account; the CI runner has neither.
 *
 * The rule: test code never spawns `git` itself. It goes through
 * `scripts/lib/hermetic-git.mjs`, which reads no host configuration, states an
 * identity, pins the default branch, and never guesses. Unlike the rule above,
 * this one covers `scripts/` too, because that is where the git fixtures live,
 * and fixture modules as well as test files.
 *
 * This is a tripwire over source text, not a proof: a command name hidden in a
 * variable passes it. It catches the shape every fixture in this repository
 * was written in, which is the shape the next one will copy.
 */
const TEST_CODE =
  /(?:\.(?:test|spec)\.(?:[cm]?js|tsx?)|\.test-support\.(?:[cm]?js|tsx?)|-fixture\.mjs)$/;
const DIRECT_GIT_SPAWN =
  /[\w$]\s*\(\s*(['"`])git\1\s*,|\b(?:exec|execSync)\s*\(\s*['"`]git\s/;
const HERMETIC_HELPER =
  /from '(?:\.\.?\/)+(?:scripts\/)?lib\/hermetic-git\.mjs'/;
const PRUNED_FOR_GIT = new Set([...PRUNED].filter(name => name !== 'scripts'));

async function testCodeFiles(directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (PRUNED_FOR_GIT.has(entry.name)) continue;
      found.push(...(await testCodeFiles(absolute)));
    } else if (TEST_CODE.test(entry.name)) {
      found.push(absolute);
    }
  }
  return found.sort();
}

test('test code runs git only through the hermetic helper', async () => {
  const files = await testCodeFiles();
  const sources = await Promise.all(
    files.map(async file => ({
      relative: path.relative(root, file),
      source: await readFile(file, 'utf8'),
    }))
  );

  // Vacuity guards: a walk that finds nothing, or finds no helper user, would
  // pass this rule forever while proving nothing.
  assert.ok(
    sources.some(({ relative }) => relative.startsWith('scripts/')),
    'the test-code walk no longer reaches scripts/'
  );
  assert.ok(
    sources.some(({ source }) => HERMETIC_HELPER.test(source)),
    'no test imports scripts/lib/hermetic-git.mjs; the discovery is broken'
  );

  const offenders = sources
    .filter(({ source }) => DIRECT_GIT_SPAWN.test(source))
    .map(({ relative }) => relative);
  assert.deepEqual(
    offenders,
    [],
    "these files spawn git directly, so they read the host's global git " +
      'configuration and identity and can pass here while failing on CI. ' +
      'Use git/gitAsync/gitBytes from scripts/lib/hermetic-git.mjs, and ' +
      'hermeticGitEnv() for a child script that runs git.'
  );
});

test('the hermetic helper ignores a hostile host configuration and never guesses an identity', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'exawatt-hermetic-git-'));
  try {
    // Everything a host could carry that would make a fixture behave
    // differently from CI: an identity, a default branch, mandatory signing
    // with a signer that always fails, a hooks path whose hook always fails,
    // and global excludes.
    const home = path.join(parent, 'home');
    const hooks = path.join(home, 'hooks');
    mkdirSync(path.join(home, '.config', 'git'), { recursive: true });
    mkdirSync(hooks, { recursive: true });
    writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n');
    chmodSync(path.join(hooks, 'pre-commit'), 0o755);
    const hostile = [
      '[user]',
      '\tname = Host Leak',
      '\temail = leak@host.invalid',
      '[init]',
      '\tdefaultBranch = host-branch',
      '[commit]',
      '\tgpgSign = true',
      '[gpg]',
      '\tprogram = false',
      '[core]',
      `\thooksPath = ${hooks}`,
      '',
    ].join('\n');
    writeFileSync(path.join(home, '.gitconfig'), hostile);
    writeFileSync(path.join(home, '.config', 'git', 'config'), hostile);
    writeFileSync(path.join(home, '.config', 'git', 'ignore'), 'hidden.txt\n');
    const host = { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') };

    const repository = path.join(parent, 'repository');
    git(parent, ['init', '--quiet', repository], host);
    writeFileSync(path.join(repository, 'hidden.txt'), 'tracked\n');
    git(repository, ['add', '--all'], host);
    git(repository, ['commit', '--quiet', '-m', 'fixture'], host);

    assert.equal(git(repository, ['branch', '--show-current'], host), 'master');
    assert.equal(
      git(repository, ['log', '-1', '--format=%an <%ae>'], host),
      `${FIXTURE_IDENTITY.GIT_AUTHOR_NAME} <${FIXTURE_IDENTITY.GIT_AUTHOR_EMAIL}>`
    );
    assert.equal(git(repository, ['ls-files'], host), 'hidden.txt');
    assert.equal(git(repository, ['log', '-1', '--format=%G?'], host), 'N');

    // A fixture that states no identity must fail on this machine exactly as
    // it fails on a runner whose account has no name, instead of git guessing
    // one from the operator's account record.
    assert.throws(
      () =>
        git(repository, ['var', 'GIT_AUTHOR_IDENT'], {
          ...host,
          GIT_AUTHOR_NAME: undefined,
          GIT_AUTHOR_EMAIL: undefined,
          EMAIL: undefined,
        }),
      /auto-detection is disabled/u
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
