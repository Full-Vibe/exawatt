#!/usr/bin/env node
/**
 * `pnpm hooks:install`: the repository's git integration, written once into
 * the common git config so the main checkout and every worktree share it.
 * `pnpm worktree:setup` runs it, so the settings re-assert themselves.
 *
 * - `core.hooksPath=.githooks` (BUG-195, BUG-200): each checkout runs its own
 *   tree's versioned hooks; the pre-push hook leaves `agent:land` the only
 *   writer of origin's master.
 * - `merge.exawatt-append.*` (BUG-203): the append-only docs merge driver
 *   `.gitattributes` names for the roadmap, the project docs and the
 *   incidents index. It is relative too, and falls back to git's own merge in
 *   a tree that predates it.
 */
import { execFileSync } from 'node:child_process';

import { INSTALLED_DRIVER_CONFIG } from './lib/append-merge.mjs';

const settings = [['core.hooksPath', '.githooks'], ...INSTALLED_DRIVER_CONFIG];
for (const [key, value] of settings) {
  execFileSync('git', ['config', key, value], { stdio: 'inherit' });
  console.log(`[hooks:install] ${key}=${value}`);
}
