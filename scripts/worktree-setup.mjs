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
import { execFileSync, execSync } from 'node:child_process';
import { nodePtyBindingPath } from './lib/native-preflight.mjs';
import { prepareWorktreeEnv } from './lib/worktree-env.mjs';

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

const env = prepareWorktreeEnv({
  root,
  mainCheckout,
  pullDevelopmentEnv: ({ cwd, target }) =>
    execFileSync(
      'vercel',
      ['env', 'pull', target, '--environment=development', '--yes'],
      { cwd, stdio: 'inherit' }
    ),
});
if (env.pullFailed) {
  say(
    'Vercel Development env refresh unavailable; using the main checkout snapshot'
  );
}
switch (env.status) {
  case 'pulled':
    say('pulled Development env from the linked Vercel project');
    break;
  case 'copied':
    say(`copied .env.local from ${mainCheckout}`);
    break;
  case 'refreshed':
    say(`refreshed .env.local from ${mainCheckout}`);
    break;
  case 'current':
  case 'main-current':
    say('.env.local is current');
    break;
  case 'missing-source':
    say(
      'no Development env available — run `pnpm env:pull` in the linked main checkout'
    );
    break;
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
