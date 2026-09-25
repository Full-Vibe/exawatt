import { execFile } from 'child_process';
import os from 'os';
import {
  isSafetyControlEnabled,
  type SafetyControlSettings,
} from '@exawatt/core';
import type { DiagnosticRecorder } from '../diagnostics-log';
import type { HarnessGuard } from '../harness-events/channel';
import {
  processKillGuardVerdict,
  type ProcessKillGuardDependencies,
} from './process-kill-guard';

/** Each read-only listing gets this long; the hook itself allows a few seconds
 *  and a guard that runs out answers "no decision". */
const LISTING_TIMEOUT_MS = 1_500;

/** A listing that fails (pgrep's "no match" is exit 1) is an empty listing. */
function runListing(command: string, args: readonly string[]): Promise<string> {
  return new Promise(resolve => {
    execFile(
      command,
      [...args],
      { timeout: LISTING_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (_error, stdout) => resolve(typeof stdout === 'string' ? stdout : '')
    );
  });
}

function bashCommandOf(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  if (record.tool_name !== 'Bash') return null;
  const input = record.tool_input;
  if (!input || typeof input !== 'object') return null;
  const command = (input as Record<string, unknown>).command;
  return typeof command === 'string' && command ? command : null;
}

/**
 * The guard the harness channel answers safety-control hooks with (ENG-044).
 *
 * It reads the operator's settings at decision time, so switching a control
 * OFF takes effect at once even for agents launched while it was on; switching
 * it ON reaches agents launched after, because the launch is what carries the
 * hook. Every refusal is recorded, which is the audit trail an operator (or a
 * future managed Workspace) reads back.
 */
export function createSafetyGuard(deps: {
  settings: () => SafetyControlSettings;
  /** Processes no agent command may take down. */
  protectedPids: () => ReadonlySet<number>;
  record: DiagnosticRecorder;
  run?: ProcessKillGuardDependencies['run'];
  home?: string;
}): HarnessGuard {
  const run = deps.run ?? runListing;
  const home = deps.home ?? os.homedir();
  return async (sessionId, payload) => {
    if (!isSafetyControlEnabled(deps.settings(), 'processKillGuard')) {
      return null;
    }
    const command = bashCommandOf(payload);
    if (!command) return null;
    const reason = await processKillGuardVerdict(command, {
      run,
      protectedPids: deps.protectedPids(),
      home,
    });
    if (!reason) return null;
    deps.record('safety.denied', {
      control: 'processKillGuard',
      session: sessionId,
      reason,
    });
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    };
  };
}
