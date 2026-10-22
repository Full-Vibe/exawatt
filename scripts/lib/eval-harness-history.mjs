// What harness history an Electron eval's app reads (BUG-315).
//
// Every eval launches with a throwaway profile, and a fresh profile's first
// usage scan reads all of the harness history under its HOME. With this Mac's
// own HOME that is the operator's whole Claude Code, Codex and Grok history:
// 10.2 GB, about 35 s of the app's main-process CPU in every launch, while
// the eval drives the app. An eval that is not about usage, Agent Sources or
// harness launches must not depend on how much history this Mac holds, so by
// default its app reads empty history roots. An eval about those passes
// `readsHarnessHistory: true` and keeps this Mac's own.
//
// An eval that gives the app a HOME of its own already reads only its own
// fixture history (a fake Codex writes its rollouts there), so it is left
// alone, as is any history root the eval names itself. The roots are the
// app's eval overrides, read by the usage scanner and the conversation
// catalog alike (`electron/main/pty/harness-homes.ts`,
// `packages/core/src/consumption/node-fs.ts`). The harnesses' own variables
// (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GROK_HOME`) are not touched: the app
// resolves those from the login shell, and a launched harness needs its real
// sign-in.

import { mkdirSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/** The app's eval overrides for each harness's history, and the directory
 *  name each gets under an empty home. */
export const HARNESS_HISTORY_ROOTS = Object.freeze({
  EXAWATT_CLAUDE_PROJECTS_ROOT: 'claude-projects',
  EXAWATT_CODEX_SESSIONS_ROOT: 'codex-sessions',
  EXAWATT_GROK_SESSIONS_ROOT: 'grok-sessions',
});

/**
 * Playwright launch options with the eval's harness history decided: empty
 * roots for an app that would read this Mac's history, unless
 * `readsHarnessHistory` is true. Returns `launchOpts` itself when nothing
 * changes.
 *
 * @param {{ env?: Record<string, string | undefined> }} launchOpts
 * @param {{ readsHarnessHistory?: boolean }} [opts]
 */
export function withEvalHistory(launchOpts, opts = {}) {
  if (opts.readsHarnessHistory === true) return launchOpts;
  const env = launchOpts.env ?? process.env;
  if (env.HOME !== undefined && env.HOME !== homedir()) return launchOpts;
  const unset = Object.keys(HARNESS_HISTORY_ROOTS).filter(
    name => env[name] === undefined
  );
  if (unset.length === 0) return launchOpts;
  const home = mkdtempSync(join(tmpdir(), 'exawatt-eval-history-'));
  const roots = {};
  for (const name of unset) {
    roots[name] = join(home, HARNESS_HISTORY_ROOTS[name]);
    mkdirSync(roots[name]);
  }
  return { ...launchOpts, env: { ...env, ...roots } };
}
