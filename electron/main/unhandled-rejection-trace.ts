import type { DiagnosticRecorder } from './diagnostics-log';

/**
 * Unhandled-rejection trace for the main process: standing instrumentation,
 * not a diagnostic for any one defect (BUG-146, the main-process half of
 * BUG-129).
 *
 * A `void`ed async handler that throws, a rejected `invoke` nobody awaited, a
 * frame from a Gateway that does not match the protocol: each ends as an
 * unhandled promise rejection in main, and until now that was the end of it.
 * Node prints a warning to a stdout the packaged app does not keep, no line
 * reaches `logs/main.jsonl`, and the team rule to read that log first on any
 * "I saw an error" report finds nothing. This exists so the NEXT one leaves
 * evidence. It never recovers from a rejection and never changes what the
 * rejected code does.
 *
 * It follows `main-thread-stall-trace.ts` on the operator's constraint that
 * instrumentation must "never run away or cause issues", each bullet pinned by
 * a test in `unhandled-rejection-trace.test.ts`:
 *
 * - **Bounded on disk.** Writes go through the recorder the caller passes,
 *   which is `createDiagnosticsLog` with its byte cap and single-generation
 *   rotation. Fields are clipped and redacted there before they land.
 * - **Rate limited.** At most `maxRecordsPerMinute` records, and at most
 *   `maxRecordsPerRun` for the life of the process. A loop that rejects
 *   continuously writes one `main.unhandled-rejection.suppressed` line per
 *   minute, then one `main.unhandled-rejection.exhausted` line, then nothing.
 * - **Fails closed.** Any throw from the recorder disables the trace
 *   permanently and silently. A diagnostics path that can itself throw inside
 *   `process.on('unhandledRejection')` is worse than no diagnostics.
 * - **Free when nothing is wrong.** Nothing runs until a rejection has already
 *   escaped, so the trace cannot be the reason main is slow.
 * - **Local only.** One JSONL file beside the logs D28 already writes.
 *
 * Registering a listener changes one thing about Node: with a listener
 * present it no longer prints its own warning for the rejection. The console
 * line below keeps a development terminal as informative as before.
 */

interface UnhandledRejectionTraceOptions {
  record: DiagnosticRecorder;
  maxRecordsPerMinute?: number;
  maxRecordsPerRun?: number;
  now?: () => number;
  /** Injected in tests; the real one prints the warning Node used to. */
  warn?: (message: string) => void;
}

const DEFAULTS = {
  maxRecordsPerMinute: 6,
  maxRecordsPerRun: 200,
};

const WINDOW_MS = 60_000;

/** Enough of a stack to place the rejection; the recorder clips further. */
const MAX_STACK_LINES = 12;

/**
 * The fields a record carries. Always the same shape, so a reader of the log
 * can grep one event name and get one schema.
 */
function describeReason(reason: unknown): {
  name: string | null;
  message: string | null;
  stack: string | null;
} {
  if (reason instanceof Error) {
    return {
      name: reason.name || null,
      message: reason.message || null,
      stack:
        typeof reason.stack === 'string'
          ? reason.stack.split('\n').slice(0, MAX_STACK_LINES).join('\n')
          : null,
    };
  }
  if (reason === null || reason === undefined) {
    return { name: null, message: null, stack: null };
  }
  let message: string;
  try {
    message = typeof reason === 'string' ? reason : JSON.stringify(reason);
  } catch {
    message = String(reason);
  }
  return { name: typeof reason, message, stack: null };
}

export class UnhandledRejectionTrace {
  private readonly opts: Required<
    Omit<UnhandledRejectionTraceOptions, 'record' | 'now' | 'warn'>
  > & {
    record: DiagnosticRecorder;
    now: () => number;
    warn: (message: string) => void;
  };

  private disabled = false;
  private runCount = 0;
  private windowStartedAt = 0;
  private windowCount = 0;
  private suppressedInWindow = 0;
  private exhaustedAnnounced = false;

  constructor(options: UnhandledRejectionTraceOptions) {
    this.opts = {
      record: options.record,
      maxRecordsPerMinute:
        options.maxRecordsPerMinute ?? DEFAULTS.maxRecordsPerMinute,
      maxRecordsPerRun: options.maxRecordsPerRun ?? DEFAULTS.maxRecordsPerRun,
      now: options.now ?? Date.now,
      warn:
        options.warn ??
        ((message: string) => {
          console.warn(message);
        }),
    };
  }

  /** Whether a throw has silenced this trace for the rest of the process. */
  get isDisabled(): boolean {
    return this.disabled;
  }

  /**
   * One escaped rejection. Total: it never throws, whatever `reason` is and
   * whatever the recorder does.
   */
  handle(reason: unknown): void {
    if (this.disabled) return;
    try {
      const described = describeReason(reason);
      this.opts.warn(
        `[main] unhandled promise rejection: ${described.message ?? 'no message'}`
      );
      this.recordBounded(described);
    } catch {
      // Fail closed: instrumentation that can break the process it watches
      // is worse than none.
      this.disabled = true;
    }
  }

  private recordBounded(described: {
    name: string | null;
    message: string | null;
    stack: string | null;
  }): void {
    const now = this.opts.now();
    if (now - this.windowStartedAt >= WINDOW_MS) {
      if (this.suppressedInWindow > 0) {
        this.opts.record('main.unhandled-rejection.suppressed', {
          count: this.suppressedInWindow,
          windowMs: WINDOW_MS,
        });
      }
      this.windowStartedAt = now;
      this.windowCount = 0;
      this.suppressedInWindow = 0;
    }

    if (this.runCount >= this.opts.maxRecordsPerRun) {
      if (!this.exhaustedAnnounced) {
        this.exhaustedAnnounced = true;
        this.opts.record('main.unhandled-rejection.exhausted', {
          maxRecordsPerRun: this.opts.maxRecordsPerRun,
        });
      }
      return;
    }

    if (this.windowCount >= this.opts.maxRecordsPerMinute) {
      this.suppressedInWindow += 1;
      return;
    }

    this.windowCount += 1;
    this.runCount += 1;
    this.opts.record('main.unhandled-rejection', described);
  }
}

let installed: {
  target: NodeJS.Process;
  listener: (reason: unknown) => void;
} | null = null;

/**
 * Attach one trace to the process. Idempotent per process: a second install
 * replaces the first, so a test can never leave two listeners behind.
 */
export function installUnhandledRejectionTrace(
  trace: UnhandledRejectionTrace,
  target: NodeJS.Process = process
): void {
  uninstallUnhandledRejectionTrace();
  const listener = (reason: unknown): void => {
    trace.handle(reason);
  };
  target.on('unhandledRejection', listener);
  installed = { target, listener };
}

export function uninstallUnhandledRejectionTrace(): void {
  if (!installed) return;
  installed.target.off('unhandledRejection', installed.listener);
  installed = null;
}
