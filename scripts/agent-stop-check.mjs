#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function continues() {
  return { continue: true };
}

export function inspectDelivery({ cwd, stopHookActive = false }) {
  if (stopHookActive) return continues();

  try {
    const root = git(cwd, 'rev-parse', '--show-toplevel');
    const branch = git(root, 'branch', '--show-current');
    if (!branch.startsWith('agent/')) return continues();

    const dirty = git(root, 'status', '--porcelain');
    if (dirty) {
      return {
        decision: 'block',
        reason:
          'Delivery is incomplete: this agent worktree has uncommitted changes. Stage only your files, commit them, run the relevant checks, then use pnpm agent:land as documented in AGENTS.md.',
      };
    }

    git(root, 'rev-parse', '--verify', 'refs/remotes/origin/master');
    try {
      git(root, 'merge-base', '--is-ancestor', 'HEAD', 'origin/master');
      return continues();
    } catch {
      return {
        decision: 'block',
        reason:
          'Delivery is incomplete: the current agent commit is not reachable from the local origin/master ref. Run pnpm agent:land with the relevant --verify scripts, or refresh Git state and explain why this task is intentionally local-only.',
      };
    }
  } catch {
    return continues();
  }
}

async function readInput() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input ? JSON.parse(input) : {};
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  readInput()
    .then(input => {
      const result = inspectDelivery({
        cwd: input.cwd ?? process.cwd(),
        stopHookActive: input.stop_hook_active === true,
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch(() => {
      process.stdout.write(`${JSON.stringify(continues())}\n`);
    });
}
