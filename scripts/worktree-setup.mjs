#!/usr/bin/env node
/**
 * One-command bootstrap for a fresh agent worktree (ENG-022). Without
 * these steps a worktree fails in misleading ways: PTY spawns die with a
 * bare "posix_spawnp failed." (node-pty's native binding is never built —
 * pnpm blocks dependency build scripts and Electron needs its own ABI),
 * Supabase-backed routes 500 (untracked .env.local does not follow
 * worktrees), and Electron evals can silently exercise ANOTHER checkout's
 * dev server. Idempotent — safe to re-run.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { nodePtyBindingPath } from './lib/native-preflight.mjs';

const root = process.cwd();
const run = command => execSync(command, { stdio: 'inherit', cwd: root });
const say = message => console.log(`[worktree-setup] ${message}`);

// the main checkout is the first entry of `git worktree list`
const mainCheckout = execSync('git worktree list --porcelain', { cwd: root })
  .toString()
  .split('\n')[0]
  .replace(/^worktree /, '')
  .trim();

say('pnpm install');
run('pnpm install --prefer-offline');

if (!existsSync(path.join(root, '.env.local'))) {
  const source = path.join(mainCheckout, '.env.local');
  if (mainCheckout !== root && existsSync(source)) {
    copyFileSync(source, path.join(root, '.env.local'));
    say(`copied .env.local from ${mainCheckout}`);
  } else {
    say('no .env.local to copy — Supabase-backed routes will 500 in dev');
  }
}

if (nodePtyBindingPath(root)) {
  say('node-pty binding present');
} else {
  say('node-pty native binding missing — rebuilding for Electron');
  run('pnpm electron:rebuild');
}

say('compiling Electron main');
run('pnpm electron:compile');

say(`ready. Electron evals must run against THIS tree's dev server:
  pnpm dev -p <free-port>
  EXA_BASE=http://localhost:<free-port> pnpm eval:...
The eval harness cross-checks /api/dev-identity and refuses a dev server
that serves a different checkout.`);
