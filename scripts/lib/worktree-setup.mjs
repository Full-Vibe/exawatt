/**
 * Run the required fresh-worktree bootstrap stages. The environment stage is
 * deliberately optional; dependency installation, browser identity, native
 * bindings, and Electron compilation are not.
 */
export function runWorktreeSetup({
  platform,
  run,
  prepareEnvironment,
  hasNodePtyBinding,
  say,
}) {
  say('pnpm install');
  run('pnpm install --prefer-offline');

  if (platform === 'darwin') {
    say('verifying stable signed QA browser identity');
    run('pnpm qa:browser:doctor');
  }

  const env = prepareEnvironment();
  reportEnvironmentResult(env, say);

  if (hasNodePtyBinding()) {
    say('node-pty binding present');
  } else {
    say('node-pty native binding missing — rebuilding for Electron');
    run('pnpm electron:rebuild');
  }

  say('preparing the community distribution contract');
  run('pnpm distribution:prepare');

  say('compiling Electron main');
  run('pnpm electron:compile');

  say(`ready. Electron evals must run against THIS tree's dev server:
  pnpm dev -p <free-port>
  EXA_BASE=http://localhost:<free-port> pnpm eval:...
The eval harness cross-checks /api/dev-identity and refuses a dev server
that serves a different checkout.`);

  return env;
}

export function reportEnvironmentResult(env, say) {
  switch (env.pullStatus) {
    case 'not-configured':
      say(
        'community-safe setup: no linked Vercel project; skipping optional Development env pull'
      );
      return;
    case 'cli-unavailable':
      say('Vercel CLI unavailable; optional Development env pull skipped');
      break;
    case 'failed':
      say(
        'Vercel Development env pull unavailable (access, network, or service); continuing with the linked checkout fallback when present'
      );
      break;
    case 'pulled':
      say('pulled Development env from the linked Vercel project');
      return;
  }

  switch (env.status) {
    case 'copied':
      say(`copied linked .env.local snapshot from ${env.snapshotSource}`);
      break;
    case 'refreshed':
      say(`refreshed linked .env.local snapshot from ${env.snapshotSource}`);
      break;
    case 'current':
    case 'main-current':
      say('linked .env.local snapshot is current');
      break;
    case 'missing-source':
      say(
        'no linked Development env or last-good snapshot is available; continuing without .env.local'
      );
      break;
  }
}
