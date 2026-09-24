import { execFile, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

/**
 * The one way test code runs git (BUG-160).
 *
 * `official-release-artifacts.test.mjs` committed in a CLONE of a fixture
 * repository. The fixture had configured an identity on the original; a clone
 * does not copy local configuration, so git fell back to the host. On the
 * operator's Mac it guessed a name from the account record and the test
 * passed; on the CI runner the account has no full name and git refused. The
 * machine that ran the test every day was more capable than the one that
 * judged it.
 *
 * Identity is only the first member of the class. A fixture that reads the
 * host's git configuration also reads its `init.defaultBranch`, its commit
 * signing, its hooks path, its `push.default` and `push.autoSetupRemote`, its
 * `pull.rebase`, and its global excludes, and each of those can make a
 * fixture pass on one machine and fail on another. So test git never reads the
 * host:
 *
 * - no global or system configuration file is read;
 * - identity is stated, never guessed: `user.useConfigOnly` makes a missing
 *   identity fail on the operator's machine exactly as it fails on CI;
 * - the default branch and the excludes/attributes files are pinned;
 * - a spawned git starts from a stated environment rather than `process.env`,
 *   so a `GIT_DIR` or `GIT_INDEX_FILE` exported by an enclosing hook cannot
 *   aim a fixture at the real repository.
 *
 * Importing this module also isolates the importing test PROCESS the same way
 * (see the bottom of the file): a library under test that runs git in-process,
 * and a child spawned with `{ ...process.env }`, inherit no host configuration
 * either. That half deliberately supplies no identity, because CI supplies
 * none; code that commits must be handed one, as it is on the runner.
 *
 * `scripts/suite-environment.test.mjs` enforces that test code spawns git only
 * through here.
 */

const PINNED_CONFIG = Object.freeze([
  ['user.useConfigOnly', 'true'],
  ['init.defaultBranch', 'master'],
  ['core.excludesFile', '/dev/null'],
  ['core.attributesFile', '/dev/null'],
]);

const HOST_ISOLATION = Object.freeze({
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_COUNT: String(PINNED_CONFIG.length),
  ...Object.fromEntries(
    PINNED_CONFIG.flatMap(([key, value], index) => [
      [`GIT_CONFIG_KEY_${index}`, key],
      [`GIT_CONFIG_VALUE_${index}`, value],
    ])
  ),
});

/** Variables that point git at a specific repository instead of the cwd's. */
const REPOSITORY_LOCATORS = Object.freeze([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
  'GIT_CONFIG_PARAMETERS',
]);

export const FIXTURE_IDENTITY = Object.freeze({
  GIT_AUTHOR_NAME: 'Fixture Author',
  GIT_AUTHOR_EMAIL: 'fixture@example.test',
  GIT_COMMITTER_NAME: 'Fixture Author',
  GIT_COMMITTER_EMAIL: 'fixture@example.test',
});

/**
 * The complete environment for a child that runs git in a fixture: git
 * itself, or a repository script that shells out to it. `extra` is layered
 * last, so a test states a different identity, a fixed date, or the `PATH` of
 * a fake `pnpm` there.
 */
export function hermeticGitEnv(extra = {}) {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? tmpdir(),
    TMPDIR: tmpdir(),
    LANG: 'en_US.UTF-8',
    ...HOST_ISOLATION,
    ...FIXTURE_IDENTITY,
    ...extra,
  };
}

const MAX_BUFFER = 64 * 1024 * 1024;

/** Runs git synchronously and returns its trimmed stdout. */
export function git(cwd, args, extra = {}) {
  return gitBytes(cwd, args, extra).toString('utf8').trim();
}

/** Runs git synchronously and returns its stdout untouched, for binary output. */
export function gitBytes(cwd, args, extra = {}) {
  return execFileSync('git', args, {
    cwd,
    env: hermeticGitEnv(extra),
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const execFileAsync = promisify(execFile);

/** Runs git without blocking the event loop and returns its trimmed stdout. */
export async function gitAsync(cwd, args, extra = {}) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: hermeticGitEnv(extra),
    maxBuffer: MAX_BUFFER,
  });
  return stdout.trim();
}

for (const name of REPOSITORY_LOCATORS) delete process.env[name];
Object.assign(process.env, HOST_ISOLATION);
