import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Shared fixture for the two-repository delivery tests (ENG-030 WP6-D).
 *
 * Every repository here is a local directory under the OS temp directory and
 * the "public remote" is a local bare repository. Nothing touches a network or
 * a real public repository: none exists yet, and the outbound projector, the
 * inbound contribution path, and the reseed must all be provable before one
 * does.
 *
 * The fixture manifest is deliberately shaped like the real one — a PUBLIC
 * majority, a PRIVATE overlay, one GENERATED path a recipe renders and one it
 * does not — so a test can assert what the public repository received AND what
 * it did not.
 */

export const MANIFEST_PATH = 'scripts/open-source-paths.manifest.json';
export const WORKFLOW_PATH = '.github/workflows/ci.yml';

export const FIXTURE_MANIFEST = {
  schemaVersion: 1,
  rules: [
    {
      id: 'public-root',
      classification: 'PUBLIC',
      include: ['README.md', 'package.json'],
    },
    { id: 'public-src', classification: 'PUBLIC', include: ['src/**'] },
    { id: 'public-scripts', classification: 'PUBLIC', include: ['scripts/**'] },
    {
      id: 'private-company',
      classification: 'PRIVATE',
      include: ['company/**'],
    },
  ],
  exceptions: [
    {
      path: 'src/config.private.ts',
      classification: 'PRIVATE',
      reason: 'carries operator identity',
    },
    {
      path: 'src/config.ts',
      classification: 'GENERATED',
      recipe: 'public-config',
      reason: 'identity-free public configuration',
    },
    {
      path: WORKFLOW_PATH,
      classification: 'GENERATED',
      recipe: 'public-ci',
      reason: 'public CI is secretless and least privilege',
    },
  ],
  recipes: {
    // No renderer: one recipe stays on the unrendered side so a landing report
    // is proved to NAME what the public repository did not receive.
    'public-config': {
      kind: 'render-public-launch-pages',
      inputs: ['src/config.private.ts'],
      outputs: [{ path: 'src/config.ts', mode: '100644' }],
    },
    'public-ci': {
      kind: 'render-public-ci',
      inputs: [WORKFLOW_PATH],
      outputs: [{ path: WORKFLOW_PATH, mode: '100644' }],
    },
  },
};

/** The private workflow, carrying the public-variant directives its recipe reads. */
export function fixtureWorkflow(timeout = 25) {
  return [
    'name: CI',
    '',
    'on:',
    '  push:',
    '    # exawatt:public-replace-begin the batch ref is private',
    '    branches: [ci-batches/master]',
    '    # exawatt:public-replace-with',
    '    # branches: [master]',
    '    # exawatt:public-replace-end',
    '',
    'permissions:',
    '  contents: read',
    '',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    `    timeout-minutes: ${timeout}`,
    '',
  ].join('\n');
}

const FLOOR_SCRIPTS = {
  'open-source:paths:check': 'node -e "process.exit(0)"',
  'content:scan': 'node -e "process.exit(0)"',
  'type-check': 'node -e "process.exit(0)"',
  'test:agent-delivery': 'node -e "process.exit(0)"',
  'test:related': 'node -e "process.exit(0)"',
};

export const FIXTURE_AUTHOR = {
  GIT_AUTHOR_NAME: 'Fixture Author',
  GIT_AUTHOR_EMAIL: 'fixture@example.test',
  GIT_COMMITTER_NAME: 'Fixture Author',
  GIT_COMMITTER_EMAIL: 'fixture@example.test',
};

export const FIXTURE_CONTRIBUTOR = {
  GIT_AUTHOR_NAME: 'Outside Contributor',
  GIT_AUTHOR_EMAIL: 'outside@example.test',
  GIT_COMMITTER_NAME: 'Outside Contributor',
  GIT_COMMITTER_EMAIL: 'outside@example.test',
};

/**
 * Repository scripts and Git both read ambient configuration, so the child
 * environment is stated rather than inherited (see suite-environment.test.mjs).
 */
export function gitEnv(extra = {}) {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    LANG: 'en_US.UTF-8',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    ...FIXTURE_AUTHOR,
    ...extra,
  };
}

export function git(cwd, args, extra = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: gitEnv(extra),
  }).trim();
}

export function write(root, file, contents) {
  const absolute = path.join(root, file);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

/**
 * A `pnpm` that exits zero, so a landing exercises the delivery machinery
 * rather than a package manager.
 */
export function writeFastPnpm(directory) {
  const bin = path.join(directory, 'bin');
  mkdirSync(bin, { recursive: true });
  const executable = path.join(bin, 'pnpm');
  writeFileSync(executable, '#!/bin/sh\nexit 0\n');
  chmodSync(executable, 0o755);
  return { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` };
}

/**
 * A private repository with its own bare `origin`, shaped like this one: a
 * public majority, a private overlay, and two GENERATED paths.
 */
export function createPrivateFixture(prefix = 'exawatt-two-repo-') {
  const parent = mkdtempSync(path.join(tmpdir(), prefix));
  const at = name => path.join(parent, name);
  const origin = at('origin.git');
  const root = at('private');
  git(parent, ['init', '--quiet', '--bare', '--initial-branch=master', origin]);
  git(parent, ['clone', '--quiet', origin, root]);
  git(root, ['config', 'user.name', 'Fixture Author']);
  git(root, ['config', 'user.email', 'fixture@example.test']);

  write(root, 'README.md', '# fixture\n');
  write(
    root,
    'package.json',
    `${JSON.stringify(
      { name: 'two-repository-fixture', private: true, scripts: FLOOR_SCRIPTS },
      null,
      2
    )}\n`
  );
  write(root, MANIFEST_PATH, `${JSON.stringify(FIXTURE_MANIFEST, null, 2)}\n`);
  write(root, 'src/a.ts', 'export const a = 1;\n');
  write(root, 'src/config.private.ts', 'export const operator = "op";\n');
  write(root, 'src/config.ts', 'export const operator = null;\n');
  write(root, 'company/secret.md', 'private overlay\n');
  write(root, WORKFLOW_PATH, fixtureWorkflow());
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '-m', 'root']);
  git(root, ['push', '--quiet', '-u', 'origin', 'master']);

  return {
    parent,
    origin,
    root,
    at,
    /** A bare local repository standing in for the public remote. */
    publicRemote(name = 'public.git') {
      const remote = at(name);
      git(parent, [
        'init',
        '--quiet',
        '--bare',
        '--initial-branch=master',
        remote,
      ]);
      return remote;
    },
    /** Configure the private repository's `public` remote, as an operator would. */
    configurePublicRemote(remote) {
      git(root, ['remote', 'add', 'public', remote]);
      return remote;
    },
    /** A committed agent worktree, ready for `agent:land`. */
    agentWorktree(branch, files) {
      const worktree = at(branch.replace(/\//gu, '-'));
      git(root, ['worktree', 'add', '--quiet', worktree, '-b', branch]);
      for (const [file, contents] of Object.entries(files)) {
        write(worktree, file, contents);
      }
      git(worktree, ['add', '--all']);
      git(worktree, ['commit', '--quiet', '-m', `agent: ${branch}`]);
      return worktree;
    },
    cleanup: () => rmSync(parent, { recursive: true, force: true }),
  };
}
