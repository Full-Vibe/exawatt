#!/usr/bin/env node
/**
 * Print the in-flight worktree roster (ENG-022 H14): every agent branch with
 * its worktree, freshness, and merge state, so nobody redoes invisible work.
 * Advisory and read-only; exits 0 even when the roster cannot be read.
 */
import { printWorktreeRoster } from './lib/worktree-roster.mjs';

await printWorktreeRoster({
  root: process.cwd(),
  say: message => console.log(`[worktree-roster] ${message}`),
});
