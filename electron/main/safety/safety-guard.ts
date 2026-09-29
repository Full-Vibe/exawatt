import { execFile, type ExecFileException } from 'child_process';
import os from 'os';
import {
  isSafetyControlEnabled,
  type SafetyControlSettings,
  type SafetyControlsRead,
} from '@exawatt/core';
import type { DiagnosticRecorder } from '../diagnostics-log';
import type { HarnessGuard } from '../harness-events/channel';
import {
  ListingFailure,
  processKillGuardVerdict,
  type Listing,
  type ListingTool,
  type ProcessKillGuardDependencies,
} from './process-kill-guard';

/** Each read-only listing gets this long. They run side by side, so a whole
 *  check fits well inside the hook's own timeout, past which the harness
 *  proceeds without an answer. */
const LISTING_TIMEOUT_MS = 1_500;

/** The system copies, never whatever `pgrep` is first on PATH: the dry run
 *  must answer with the macOS semantics the refusal text describes. */
const LISTING_PATHS: Record<ListingTool, string> = {
  pgrep: '/usr/bin/pgrep',
  killall: '/usr/bin/killall',
  ps: '/bin/ps',
};

/**
 * Runs a listing to completion. A nonzero exit is the tool's own answer
 * (pgrep's "no match" is 1) and resolves; a listing that timed out, could
 * not start, or overflowed rejects, because it answered nothing.
 */
export function runListing(
  tool: ListingTool,
  args: readonly string[]
): Promise<Listing> {
  return new Promise((resolve, reject) => {
    execFile(
      LISTING_PATHS[tool],
      [...args],
      { timeout: LISTING_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error: ExecFileException | null, stdout, stderr) => {
        const out = typeof stdout === 'string' ? stdout : '';
        const err = typeof stderr === 'string' ? stderr : '';
        if (!error) return resolve({ stdout: out, stderr: err, exitCode: 0 });
        if (typeof error.code === 'number' && !error.killed && !error.signal) {
          return resolve({ stdout: out, stderr: err, exitCode: error.code });
        }
        reject(new ListingFailure(listingFailureCause(tool, error)));
      }
    );
  });
}

function listingFailureCause(tool: ListingTool, error: ExecFileException) {
  if (error.killed || error.signal) {
    return `${tool} did not answer within ${LISTING_TIMEOUT_MS / 1000}s`;
  }
  if (error.code === 'ENOENT') return `${tool} is missing`;
  return `${tool} failed (${String(error.code ?? error.message)})`;
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
 * The controls enforcement reads (ENG-044). A settings file that cannot be
 * read right now is not a file that says "off": enforcement keeps the last
 * choice read in this run, and answers null when it has none, so each caller
 * decides with that absence in view. Every change between readable and
 * unreadable is recorded as `safety.undecided`.
 */
export function enforcedSafetyControls(deps: {
  read: () => SafetyControlsRead;
  record: DiagnosticRecorder;
}): () => SafetyControlSettings | null {
  let lastRead: SafetyControlSettings | null = null;
  let unreadable = false;
  return () => {
    const result = deps.read();
    if (result.status === 'ready') {
      lastRead = result.controls;
      unreadable = false;
      return result.controls;
    }
    if (!unreadable) {
      unreadable = true;
      deps.record('safety.undecided', {
        cause: 'settings-unreadable',
        using: lastRead ? 'last-read-this-run' : 'none',
      });
    }
    return lastRead;
  };
}

/**
 * The guard the harness channel answers safety-control hooks with (ENG-044).
 *
 * It reads the operator's settings at decision time, so switching a control
 * OFF takes effect at once even for agents launched while it was on; switching
 * it ON reaches agents launched after, because the launch is what carries the
 * hook. When the settings cannot be read and nothing was read earlier in this
 * run, the hook's own existence is the evidence: a launch carries it only
 * while the operator has the control on, so the guard keeps judging.
 *
 * Every refusal is recorded as `safety.denied`, and every command it could
 * not judge as `safety.undecided`, which is the audit trail an operator (or a
 * future managed Workspace) reads back.
 */
export function createSafetyGuard(deps: {
  /** The operator's controls, or null when they cannot be read. */
  controls: () => SafetyControlSettings | null;
  /** Processes no agent command may take down. */
  protectedPids: () => ReadonlySet<number>;
  /** The root process of a live Session, by Session id. */
  sessionRootPid: (sessionId: string) => number | null;
  record: DiagnosticRecorder;
  run?: ProcessKillGuardDependencies['run'];
  home?: string;
}): HarnessGuard {
  const run = deps.run ?? runListing;
  const home = deps.home ?? os.homedir();
  return async (sessionId, payload) => {
    const controls = deps.controls();
    if (controls && !isSafetyControlEnabled(controls, 'processKillGuard')) {
      return null;
    }
    const command = bashCommandOf(payload);
    if (!command) return null;
    let verdict;
    try {
      verdict = await processKillGuardVerdict(command, {
        run,
        protectedPids: deps.protectedPids(),
        sessionRootPid: deps.sessionRootPid(sessionId),
        home,
      });
    } catch {
      verdict = {
        refusal:
          "Exawatt's process-kill safety control could not check this " +
          'command, so it did not run. Run it again. If the check keeps ' +
          'failing, stop the process by its port listener (`lsof ' +
          '-tiTCP:<port> -sTCP:LISTEN | xargs kill`) or by a PID you recorded.',
        undecided: [
          { invocation: 'command', cause: 'the check itself failed' },
        ],
      };
    }
    for (const { cause } of verdict.undecided) {
      deps.record('safety.undecided', {
        control: 'processKillGuard',
        session: sessionId,
        cause,
        outcome: verdict.refusal ? 'refused' : 'allowed',
      });
    }
    if (!verdict.refusal) return null;
    deps.record('safety.denied', {
      control: 'processKillGuard',
      session: sessionId,
      reason: verdict.refusal,
    });
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: verdict.refusal,
      },
    };
  };
}
