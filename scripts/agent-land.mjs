#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

export function parseArgs(argv) {
  const options = {
    dogfood: false,
    help: false,
    keepBranch: false,
    verify: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--dogfood') options.dogfood = true;
    else if (argument === '--keep-branch') options.keepBranch = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--verify') {
      const script = argv[index + 1];
      if (!script || script.startsWith('--')) {
        throw new Error('--verify requires a package.json script name.');
      }
      options.verify.push(script);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

export function parseWorktrees(output) {
  return output
    .trim()
    .split(/\n\n+/)
    .filter(Boolean)
    .map(block => {
      const entry = {};
      for (const line of block.split('\n')) {
        const separator = line.indexOf(' ');
        if (separator === -1) entry[line] = true;
        else entry[line.slice(0, separator)] = line.slice(separator + 1);
      }
      return entry;
    });
}

function usage() {
  return `Usage: pnpm agent:land -- --verify <package-script> [--verify <package-script> ...] [--dogfood] [--keep-branch]

Verifies and lands the current committed agent branch without a pull request.

  --verify <script>  Run a package.json script before pushing; repeat as needed.
  --dogfood          After integration, run electron:install-dogfood on clean master.
  --keep-branch      Keep the remote agent branch after successful integration.
`;
}

async function execute(command, args, cwd) {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

async function git(cwd, ...args) {
  return execute('git', args, cwd);
}

async function run(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(' ')} exited ${code}`))
    );
  });
}

async function isAncestor(cwd, ancestor, descendant) {
  try {
    await git(cwd, 'merge-base', '--is-ancestor', ancestor, descendant);
    return true;
  } catch (error) {
    if (error?.code === 1) return false;
    throw error;
  }
}

async function requireClean(cwd, label) {
  const dirty = await git(cwd, 'status', '--porcelain');
  if (dirty) {
    throw new Error(`${label} must be clean before landing.\n${dirty}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (options.verify.length === 0) {
    throw new Error('At least one --verify <package-script> is required.');
  }

  const root = await git(process.cwd(), 'rev-parse', '--show-toplevel');
  const branch = await git(root, 'branch', '--show-current');
  if (!/^agent\/[a-z0-9][a-z0-9._/-]*$/.test(branch)) {
    throw new Error(
      `agent:land must run from an agent/<slug> branch; current branch is ${branch || '(detached)'}.`
    );
  }

  await requireClean(root, 'Agent worktree');

  const packageJson = JSON.parse(
    await readFile(path.join(root, 'package.json'), 'utf8')
  );
  for (const script of options.verify) {
    if (typeof packageJson.scripts?.[script] !== 'string') {
      throw new Error(`package.json has no script named ${script}.`);
    }
    if (script === 'agent:land' || script === 'electron:install-dogfood') {
      throw new Error(`${script} cannot be used as a verification script.`);
    }
    console.log(`[agent-land] verify: pnpm run ${script}`);
    await run('pnpm', ['run', script], root);
  }
  await requireClean(root, 'Agent worktree after verification');

  await run('git', ['fetch', 'origin', 'master'], root);
  if (!(await isAncestor(root, 'origin/master', 'HEAD'))) {
    throw new Error(
      'origin/master moved. Rebase this agent branch onto origin/master, rerun verification, and land again.'
    );
  }

  const head = await git(root, 'rev-parse', 'HEAD');
  console.log(`[agent-land] push: ${branch}`);
  await run('git', ['push', '-u', 'origin', branch], root);

  console.log('[agent-land] integrate: fast-forward origin/master');
  await run('git', ['push', 'origin', 'HEAD:refs/heads/master'], root);
  await run('git', ['fetch', 'origin', 'master'], root);
  if (!(await isAncestor(root, head, 'origin/master'))) {
    throw new Error('The landed commit is not reachable from origin/master.');
  }

  const worktrees = parseWorktrees(
    await git(root, 'worktree', 'list', '--porcelain')
  );
  const master = worktrees.find(entry => entry.branch === 'refs/heads/master');
  if (!master?.worktree) {
    throw new Error(
      'No local master worktree was found. Remote integration succeeded, but local master could not be synchronized.'
    );
  }

  await requireClean(master.worktree, 'Shared master worktree');
  await run('git', ['merge', '--ff-only', 'origin/master'], master.worktree);
  const masterHead = await git(master.worktree, 'rev-parse', 'HEAD');
  const remoteHead = await git(root, 'rev-parse', 'origin/master');
  if (masterHead !== remoteHead) {
    throw new Error(
      'Local master does not match origin/master after integration.'
    );
  }

  let installed = false;
  if (options.dogfood) {
    console.log('[agent-land] install: Electron dogfood');
    await run('pnpm', ['run', 'electron:install-dogfood'], master.worktree);
    installed = true;
  }

  if (!options.keepBranch) {
    console.log(`[agent-land] cleanup remote branch: ${branch}`);
    await run('git', ['push', 'origin', '--delete', branch], root);
  }

  console.log(
    `[agent-land] STATUS implemented=${head.slice(0, 12)} verified=${options.verify.join(',')} pushed=true integrated=${remoteHead.slice(0, 12)} installed=${installed ? 'true' : 'not-requested'}`
  );
  console.log(
    `[agent-land] remove this worktree from ${master.worktree}, then delete local branch ${branch}.`
  );
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch(error => {
    console.error(
      `[agent-land] ${error instanceof Error ? error.message : error}`
    );
    process.exitCode = 1;
  });
}
