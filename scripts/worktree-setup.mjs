#!/usr/bin/env node
/**
 * One-command bootstrap for a fresh agent worktree (ENG-022). Without
 * these steps a worktree fails in misleading ways: PTY spawns die with a
 * bare "posix_spawnp failed." (node-pty's native binding is never built —
 * pnpm blocks dependency build scripts and Electron needs its own ABI),
 * official Supabase-backed routes 500 when their linked environment is absent,
 * and Electron evals can silently exercise ANOTHER checkout's dev server.
 * Community setup needs no hosted environment. Idempotent — safe to re-run.
 */
import { execFileSync, execSync } from 'node:child_process';
import { nodePtyBindingPath } from './lib/native-preflight.mjs';
import {
  findExecutableOnPath,
  prepareWorktreeEnv,
} from './lib/worktree-env.mjs';
import { runWorktreeSetup } from './lib/worktree-setup.mjs';

const root = process.cwd();
const run = command => execSync(command, { stdio: 'inherit', cwd: root });
const say = message => console.log(`[worktree-setup] ${message}`);

// the main checkout is the first entry of `git worktree list`
const mainCheckout = execSync('git worktree list --porcelain', { cwd: root })
  .toString()
  .split('\n')[0]
  .replace(/^worktree /, '')
  .trim();

const vercelExecutable = findExecutableOnPath('vercel');

runWorktreeSetup({
  platform: process.platform,
  run,
  say,
  hasNodePtyBinding: () => Boolean(nodePtyBindingPath(root)),
  prepareEnvironment: () =>
    prepareWorktreeEnv({
      root,
      mainCheckout,
      pullDevelopmentEnv: vercelExecutable
        ? ({ cwd, target }) =>
            execFileSync(
              vercelExecutable,
              ['env', 'pull', target, '--environment=development', '--yes'],
              { cwd, stdio: 'inherit' }
            )
        : undefined,
    }),
});
