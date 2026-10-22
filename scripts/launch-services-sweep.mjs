#!/usr/bin/env node

// `pnpm launch-services:sweep [-- --execute]`: list, and with `--execute`
// unregister, the Launch Services registrations under this repository's
// worktrees whose bundle no longer exists (BUG-305, BUG-083). Packaged evals
// forget their own bundle at teardown; this clears what launched before that,
// and whatever a deleted worktree left behind. It never touches /Applications
// or a path outside this repository's worktrees.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sweepLaunchServices } from './lib/packaged-app.mjs';

// This checkout's repository, wherever the command is run from.
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const argv = process.argv.slice(2).filter(argument => argument !== '--');
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(
    'Usage: pnpm launch-services:sweep [-- --execute]\n' +
      'Lists registrations under this repository’s worktrees whose bundle is gone;\n' +
      '--execute unregisters them.\n'
  );
  process.exit(0);
}
const unknown = argv.filter(argument => argument !== '--execute');
if (unknown.length > 0) {
  console.error(`Unknown argument: ${unknown.join(' ')}`);
  process.exit(2);
}
if (process.platform !== 'darwin') {
  console.log('Launch Services exists only on macOS; nothing to sweep.');
  process.exit(0);
}

const execute = argv.includes('--execute');
const { stale, unregistered, refused } = sweepLaunchServices({ root, execute });
const byIdentifier = new Map();
for (const bundle of stale) {
  const key = bundle.identifier ?? '(no identifier)';
  byIdentifier.set(key, (byIdentifier.get(key) ?? 0) + 1);
}
for (const bundle of execute ? unregistered : stale) {
  console.log(`${execute ? 'unregistered' : 'stale'}  ${bundle.path}`);
}
for (const bundle of refused) {
  console.error(`refused  ${bundle.path}: ${bundle.error}`);
}
console.log(
  `${stale.length} registrations whose bundle is gone` +
    (byIdentifier.size > 0
      ? ` (${[...byIdentifier].map(([id, count]) => `${count} ${id}`).join(', ')})`
      : '') +
    (execute
      ? `; ${unregistered.length} unregistered, ${refused.length} refused.`
      : '; run with -- --execute to unregister them.')
);
if (refused.length > 0) process.exitCode = 1;
