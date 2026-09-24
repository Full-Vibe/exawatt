import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { git, hermeticGitEnv } from './hermetic-git.mjs';

/**
 * A real local delivery queue for the landing-queue fixtures (BUG-200..204):
 * a bare `origin`, a shared checkout of it, this tree's own `agent-land.mjs`
 * and versioned pre-push hook, and a `pnpm` that exits zero so a landing
 * exercises the queue rather than a package manager. Queue state lives in the
 * fixture's own common git directory, so nothing reaches the real queue.
 *
 * The one real check is a stand-in for the recipe-renderer contract, the docs
 * check that has refused real documentation (BUG-131, BUG-195): it fails when
 * a file under `docs/` carries the word SEAM.
 */

const LAND_SCRIPT = fileURLToPath(
  new URL('../agent-land.mjs', import.meta.url)
);
const HOOKS_PATH = fileURLToPath(new URL('../../.githooks', import.meta.url));

const FLOOR_SCRIPTS = {
  'open-source:paths:check': 'node -e "process.exit(0)"',
  'content:scan': 'node -e "process.exit(0)"',
  'type-check': 'node -e "process.exit(0)"',
  lint: 'node -e "process.exit(0)"',
  'exports:check': 'node -e "process.exit(0)"',
  'test:agent-delivery': 'node -e "process.exit(0)"',
  'test:related': 'node -e "process.exit(0)"',
};

const RECIPE_RENDERERS_STAND_IN = `import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

test('no docs file carries a seam', () => {
  for (const file of readdirSync('docs', { recursive: true })) {
    if (!String(file).endsWith('.md')) continue;
    assert.doesNotMatch(readFileSync('docs/' + file, 'utf8'), /SEAM/);
  }
});
`;

export function write(root, file, contents) {
  const absolute = path.join(root, file);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

/** Stages `files` (or everything) and commits, returning the new SHA. */
export function commit(root, message, files = null) {
  git(root, ['add', ...(files ?? ['--all'])]);
  git(root, ['commit', '--quiet', '--no-verify', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

export function createQueueFixture(
  prefix = 'exawatt-queue-',
  { scripts = {}, files = {} } = {}
) {
  const parent = mkdtempSync(path.join(tmpdir(), prefix));
  const at = name => path.join(parent, name);
  const origin = at('origin.git');
  const main = at('main');
  git(parent, ['init', '--quiet', '--bare', '--initial-branch=master', origin]);
  git(parent, ['clone', '--quiet', origin, main]);
  git(main, ['config', 'user.name', 'Fixture Author']);
  git(main, ['config', 'user.email', 'fixture@example.test']);
  write(
    main,
    'package.json',
    `${JSON.stringify(
      {
        name: 'queue-fixture',
        private: true,
        scripts: { ...FLOOR_SCRIPTS, ...scripts },
      },
      null,
      2
    )}\n`
  );
  write(main, 'scripts/recipe-renderers.test.mjs', RECIPE_RENDERERS_STAND_IN);
  write(main, 'docs/guide.md', '# Guide\n\nFirst paragraph.\n');
  write(main, 'src/app.ts', 'export const app = 1;\n');
  for (const [file, contents] of Object.entries(files)) {
    write(main, file, contents);
  }
  commit(main, 'root');
  git(main, ['push', '--quiet', '-u', 'origin', 'master']);
  // This tree's own versioned hook, as `pnpm hooks:install` installs it.
  git(main, ['config', 'core.hooksPath', HOOKS_PATH]);

  const bin = at('bin');
  mkdirSync(bin, { recursive: true });
  // A pnpm that exits zero. Optionally it logs every invocation, and fails an
  // `eval:` gate when the file standing in for its dev server is gone.
  //
  // `install` does what pnpm does to the one file install freshness reads: it
  // copies the lockfile to `node_modules/.pnpm/lock.yaml` (or fails, standing
  // in for a lockfile that does not satisfy package.json). With
  // FIXTURE_REQUIRE_FRESH_INSTALL set, every other command fails when that
  // copy differs from the lockfile, standing in for the ERR_MODULE_NOT_FOUND
  // a check meets on a tree nobody installed (BUG-219).
  writeFileSync(
    path.join(bin, 'pnpm'),
    [
      '#!/bin/sh',
      '[ -n "$FIXTURE_PNPM_LOG" ] && echo "$*" >> "$FIXTURE_PNPM_LOG"',
      'case "$*" in',
      '  "install"*)',
      '    if [ -n "$FIXTURE_INSTALL_FAILS" ]; then',
      '      echo "ERR_PNPM_OUTDATED_LOCKFILE stand-in" >&2',
      '      exit 1',
      '    fi',
      '    mkdir -p node_modules/.pnpm && cp pnpm-lock.yaml node_modules/.pnpm/lock.yaml',
      '    exit $?',
      '    ;;',
      'esac',
      'if [ -n "$FIXTURE_REQUIRE_FRESH_INSTALL" ] && [ -f pnpm-lock.yaml ] &&',
      '  ! cmp -s pnpm-lock.yaml node_modules/.pnpm/lock.yaml; then',
      '  echo "ERR_MODULE_NOT_FOUND stand-in: node_modules is not the installed form of pnpm-lock.yaml" >&2',
      '  exit 1',
      'fi',
      'case "$*" in',
      '  "run eval:"*)',
      '    if [ -n "$FIXTURE_DEV_SERVER" ] && [ ! -f "$FIXTURE_DEV_SERVER" ]; then',
      '      echo "no dev server answering at ${EXA_BASE:-(unset)}" >&2',
      '      exit 1',
      '    fi',
      '    ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n')
  );
  chmodSync(path.join(bin, 'pnpm'), 0o755);
  const env = { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` };

  return {
    parent,
    origin,
    main,
    env,
    at,
    /** A committed agent worktree, ready for `agent:land`. */
    agentWorktree(branch, files) {
      const worktree = at(branch.replace(/\//gu, '-'));
      git(main, ['worktree', 'add', '--quiet', worktree, '-b', branch]);
      for (const [file, contents] of Object.entries(files)) {
        write(worktree, file, contents);
      }
      commit(worktree, `agent: ${branch}`);
      return worktree;
    },
    /**
     * Moves origin's master the way another landing would, from a scratch
     * clone that has no hook: the queue's own final push is excused by the
     * hook, and this stands in for it.
     */
    advanceMaster(files, message = 'another landing') {
      const scratch = at(`advance-${randomUUID().slice(0, 8)}`);
      git(parent, ['clone', '--quiet', origin, scratch]);
      for (const [file, contents] of Object.entries(files)) {
        write(scratch, file, contents);
      }
      const sha = commit(scratch, message);
      git(scratch, ['push', '--quiet', 'origin', 'master']);
      rmSync(scratch, { recursive: true, force: true });
      return sha;
    },
    originMaster: () => git(origin, ['rev-parse', 'refs/heads/master']),
    land: (cwd, args = [], extra = {}) =>
      startLanding(cwd, args, { ...env, ...extra }),
    cleanup: () => rmSync(parent, { recursive: true, force: true }),
  };
}

/**
 * Runs `agent-land.mjs` in its own process group and streams its output, so
 * a test can watch a landing wait, hold, or fail while it is still running.
 */
export function startLanding(cwd, args, env) {
  let output = '';
  const ownsProcessGroup = process.platform !== 'win32';
  const child = spawn(process.execPath, [LAND_SCRIPT, ...args], {
    cwd,
    detached: ownsProcessGroup,
    env: hermeticGitEnv(env),
  });
  let settled = false;
  child.stdout.on('data', chunk => {
    output += chunk;
  });
  child.stderr.on('data', chunk => {
    output += chunk;
  });
  const exit = new Promise((resolve, reject) => {
    child.once('error', error => {
      settled = true;
      reject(error);
    });
    child.once('exit', code => {
      settled = true;
      resolve({ code, output });
    });
  });
  return {
    output: () => output,
    done: () => settled,
    exit,
    /** Resolves with the output of a successful landing; rejects otherwise. */
    get completion() {
      return exit.then(({ code }) => {
        if (code === 0) return output;
        throw new Error(`landing exited ${code}:\n${output}`);
      });
    },
    async stop() {
      if (!settled) {
        try {
          if (ownsProcessGroup && child.pid)
            process.kill(-child.pid, 'SIGTERM');
          else child.kill('SIGTERM');
        } catch (error) {
          if (error?.code !== 'ESRCH') throw error;
        }
      }
      await exit.catch(() => {});
    },
  };
}

/** A landing that has printed nothing for this long is stuck, not slow. */
const NO_PROGRESS_MS = 60_000;

/**
 * Waits until the landing's output satisfies `predicate`, bounded by the
 * landing's progress rather than by elapsed time (BUG-057): it fails when the
 * landing exits without printing it, or goes silent.
 */
export async function waitForOutput(landing, predicate) {
  let exited = false;
  landing.exit.then(
    () => {
      exited = true;
    },
    () => {
      exited = true;
    }
  );
  let seen = landing.output().length;
  let progressedAt = Date.now();
  while (!predicate(landing.output())) {
    if (exited) {
      if (predicate(landing.output())) return;
      throw new Error(
        `The landing exited before it printed what the test waited for:\n${landing.output()}`
      );
    }
    const output = landing.output();
    // Not a budget on the code under test: this watchdog separates a stuck
    // child from a slow one, and it measures SILENCE rather than work done.
    const silentForMs = Date.now() - progressedAt;
    if (output.length !== seen) {
      seen = output.length;
      progressedAt = Date.now();
    } else if (silentForMs > NO_PROGRESS_MS) {
      throw new Error(
        `The landing printed nothing for ${NO_PROGRESS_MS}ms and never reached what the test waited for:\n${output}`
      );
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

/**
 * The landing's result once it exits, under the same silence watchdog, so a
 * landing that should finish in seconds cannot hang a test instead.
 */
export async function finished(landing) {
  await waitForOutput(landing, () => landing.done());
  return landing.exit;
}
