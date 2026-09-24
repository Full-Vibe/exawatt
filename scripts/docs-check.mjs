#!/usr/bin/env node
/**
 * `pnpm docs:check`: the landing checks a documentation change can fail, run
 * against this checkout in a few seconds (BUG-195). Stage the change first;
 * the path classification reads the index.
 *
 *   pnpm docs:check                 changes since the merge base with origin/master
 *   pnpm docs:check -- --base <rev> changes since <rev>
 *
 * `--pre-push <remote> <url>` is the versioned hook's entry point
 * (`.githooks/pre-push`, installed by `pnpm hooks:install`). It reads git's
 * pre-push lines on stdin and refuses a push to origin's master that changes
 * docs and fails these checks.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  defaultDocsBase,
  formatDocsCheckReport,
  formatPushGuardReport,
  guardDocsPush,
  parsePushUpdates,
  runDocsChecks,
  workingTreeChangedPaths,
} from './lib/docs-check.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--'))
    throw new Error(`[docs:check] ${name} requires a value`);
  return value;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function prePush(args) {
  const index = args.indexOf('--pre-push');
  const decision = await guardDocsPush({
    root: ROOT,
    remoteName: args[index + 1] ?? '',
    remoteUrl: args[index + 2] ?? '',
    updates: parsePushUpdates(await readStdin()),
  });
  process.stderr.write(formatPushGuardReport(decision));
  if (decision.verdict === 'refuse') process.exitCode = 1;
}

async function check(args) {
  const base = option(args, '--base') ?? (await defaultDocsBase(ROOT));
  const paths = await workingTreeChangedPaths(ROOT, base);
  const startedAt = Date.now();
  const results = await runDocsChecks({ root: ROOT, paths });
  const failed = results.filter(result => result.status !== 'passed');
  process.stdout.write(formatDocsCheckReport(results));
  process.stdout.write(
    `[docs:check] ${failed.length === 0 ? 'passed' : 'FAILED'}: ${paths.length} changed path(s) since ${/^[0-9a-f]{40}$/u.test(base) ? base.slice(0, 12) : base}, ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`
  );
  if (failed.length > 0) process.exitCode = 1;
}

const args = process.argv.slice(2).filter(argument => argument !== '--');
(args.includes('--pre-push') ? prePush(args) : check(args)).catch(error => {
  process.stderr.write(`[docs:check] ${error.message}\n`);
  process.exitCode = 1;
});
