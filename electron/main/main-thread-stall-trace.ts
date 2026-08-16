import type { DiagnosticRecorder } from './diagnostics-log';

/**
 * Main-thread stall trace: standing instrumentation, not a diagnostic for any
 * one defect.
 *
 * A macOS beachball means one thing — a process is not servicing its run loop —
 * and when it is Electron's MAIN process the whole app freezes, every window
 * and every IPC reply. Exawatt has now had two such stalls found by hand, each
 * costing a full investigation because nothing recorded what the main thread
 * was doing while it was blocked. This exists so the NEXT one self-diagnoses
 * without anyone being present to attach a profiler. It never fixes a stall and
 * is deliberately not sized around any particular one.
 *
 * ## How it detects
 *
 * A `setInterval` at `sampleMs` is itself a probe: if the loop stops being
 * serviced, the callback runs late by exactly the amount the loop was blocked.
 * Lateness beyond `thresholdMs` is a stall.
 *
 * ## How it knows what was running
 *
 * `handleTrusted` is already the single door every renderer→main IPC call goes
 * through, so one wrapper there names every unit of renderer-driven work. Two
 * views are kept, because a stall can end either way:
 *
 * - `inFlight` — work still open when the loop resumed (an async handler that
 *   blocked before settling).
 * - `during` — work that STARTED OR ENDED inside the blocked window. A handler
 *   that blocks synchronously and returns has already closed by the time the
 *   late timer fires, so `inFlight` alone would report nothing.
 *
 * An empty pair is itself a finding: the blocker was not renderer-driven IPC.
 *
 * ## The operator's constraint: "make sure it never runs away or causes issues"
 *
 * Treated as a hard design requirement, each bullet pinned by a test in
 * `main-thread-stall-trace.test.ts`:
 *
 * - **Bounded on disk.** Writes go through `createDiagnosticsLog`, which
 *   rotates a single generation at a byte cap. The caller passes
 *   `STALL_LOG_MAX_BYTES`, so the ceiling is two files of that size.
 * - **Rate limited.** At most `maxRecordsPerMinute` records, and at most
 *   `maxRecordsPerRun` for the life of the process. A machine that stalls
 *   continuously writes one `main.stall.suppressed` line per minute, then one
 *   `main.stall.exhausted` line, then nothing.
 * - **Free when nothing is wrong.** The steady state is one timer callback per
 *   `sampleMs` doing a subtraction, plus a Map write/delete per IPC call. No
 *   allocation per sample, no I/O, no work proportional to fleet size.
 *   Measured on an M-series Mac, 2026-08-16: **46 ns per sample** — about
 *   92 ns of main-thread time per second at the 500 ms default — and **134 ns
 *   per IPC call** for the begin/end pair.
 * - **Never blocks the main thread.** Nothing is written unless a stall was
 *   already detected — the recorder cannot be the reason the app is slow,
 *   because it only writes after the app was already stopped.
 * - **Fails closed.** Any throw from the recorder or the sampler disables the
 *   trace permanently and silently. Instrumentation that can break the app it
 *   watches is worse than no instrumentation.
 * - **Local only.** One JSONL file beside the logs OS1.6 already writes. No
 *   network, no upload, no background service.
 */

/** Byte cap for `stall.jsonl`; rotation keeps one prior generation. */
export const STALL_LOG_MAX_BYTES = 262_144;

export interface StallTraceOptions {
  record: DiagnosticRecorder;
  /** Heartbeat period. */
  sampleMs?: number;
  /** Lateness that counts as a stall. */
  thresholdMs?: number;
  maxRecordsPerMinute?: number;
  maxRecordsPerRun?: number;
  /** Completed-activity ring size. */
  historySize?: number;
  /** Activities reported per record, before the log's own array cap. */
  maxReportedActivities?: number;
  now?: () => number;
}

interface OpenActivity {
  label: string;
  startedAt: number;
}

interface ClosedActivity {
  label: string;
  startedAt: number;
  endedAt: number;
}

const DEFAULTS = {
  sampleMs: 500,
  thresholdMs: 1_000,
  maxRecordsPerMinute: 6,
  maxRecordsPerRun: 200,
  historySize: 64,
  maxReportedActivities: 12,
};

export class MainThreadStallTrace {
  private readonly opts: Required<Omit<StallTraceOptions, 'record' | 'now'>> & {
    record: DiagnosticRecorder;
    now: () => number;
  };

  private disabled = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickAt = 0;
  private startedAt = 0;

  private nextToken = 1;
  private readonly open = new Map<number, OpenActivity>();

  /** Fixed-size ring; never grows, never allocates after construction. */
  private readonly history: Array<ClosedActivity | null>;
  private historyAt = 0;

  private windowStartedAt = 0;
  private windowCount = 0;
  private runCount = 0;
  private suppressionNoted = false;

  constructor(options: StallTraceOptions) {
    this.opts = {
      record: options.record,
      now: options.now ?? Date.now,
      sampleMs: options.sampleMs ?? DEFAULTS.sampleMs,
      thresholdMs: options.thresholdMs ?? DEFAULTS.thresholdMs,
      maxRecordsPerMinute:
        options.maxRecordsPerMinute ?? DEFAULTS.maxRecordsPerMinute,
      maxRecordsPerRun: options.maxRecordsPerRun ?? DEFAULTS.maxRecordsPerRun,
      historySize: options.historySize ?? DEFAULTS.historySize,
      maxReportedActivities:
        options.maxReportedActivities ?? DEFAULTS.maxReportedActivities,
    };
    this.history = new Array<ClosedActivity | null>(
      Math.max(1, this.opts.historySize)
    ).fill(null);
  }

  get isDisabled(): boolean {
    return this.disabled;
  }

  start(): void {
    if (this.disabled || this.timer) return;
    const now = this.opts.now();
    this.startedAt = now;
    this.lastTickAt = now;
    this.windowStartedAt = now;
    try {
      this.timer = setInterval(() => this.sample(), this.opts.sampleMs);
      // The trace must never be the reason the process stays alive.
      (this.timer as { unref?: () => void }).unref?.();
    } catch {
      this.failClosed();
    }
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Open an activity. Returns a token to pass to `end`, or 0 when the trace is
   * off — callers must treat 0 as "nothing to close" rather than branching.
   */
  begin(label: string): number {
    if (this.disabled) return 0;
    const token = this.nextToken++;
    this.open.set(token, { label, startedAt: this.opts.now() });
    return token;
  }

  end(token: number): void {
    if (token === 0 || this.disabled) return;
    const entry = this.open.get(token);
    if (!entry) return;
    this.open.delete(token);
    this.history[this.historyAt] = {
      label: entry.label,
      startedAt: entry.startedAt,
      endedAt: this.opts.now(),
    };
    this.historyAt = (this.historyAt + 1) % this.history.length;
  }

  /** Run one heartbeat. Exposed so tests drive time instead of waiting on it. */
  sample(): void {
    if (this.disabled) return;
    const now = this.opts.now();
    const expected = this.lastTickAt + this.opts.sampleMs;
    const stallMs = now - expected;
    const windowStart = this.lastTickAt;
    this.lastTickAt = now;
    if (stallMs < this.opts.thresholdMs) return;
    try {
      this.recordStall(stallMs, windowStart, now);
    } catch {
      this.failClosed();
    }
  }

  private recordStall(stallMs: number, windowStart: number, now: number): void {
    if (this.runCount >= this.opts.maxRecordsPerRun) {
      if (!this.suppressionNoted) {
        this.suppressionNoted = true;
        this.opts.record('main.stall.exhausted', {
          limit: this.opts.maxRecordsPerRun,
        });
        // Permanently silent from here: a machine that stalls forever must not
        // write forever. Detection stops too, so the cost returns to zero.
        this.failClosed();
      }
      return;
    }
    if (now - this.windowStartedAt >= 60_000) {
      this.windowStartedAt = now;
      this.windowCount = 0;
      this.suppressionNoted = false;
    }
    if (this.windowCount >= this.opts.maxRecordsPerMinute) {
      if (!this.suppressionNoted) {
        this.suppressionNoted = true;
        this.opts.record('main.stall.suppressed', {
          perMinute: this.opts.maxRecordsPerMinute,
          stallMs: Math.round(stallMs),
        });
      }
      return;
    }
    this.windowCount += 1;
    this.runCount += 1;

    const cap = this.opts.maxReportedActivities;
    const inFlight = Array.from(this.open.values())
      .sort((a, b) => a.startedAt - b.startedAt)
      .slice(0, cap)
      .map(entry => ({
        label: entry.label,
        openMs: Math.round(now - entry.startedAt),
      }));
    const during: Array<{ label: string; ms: number }> = [];
    for (const entry of this.history) {
      if (!entry) continue;
      if (entry.endedAt < windowStart) continue;
      during.push({
        label: entry.label,
        ms: Math.round(entry.endedAt - entry.startedAt),
      });
    }
    during.sort((a, b) => b.ms - a.ms);

    this.opts.record('main.stall', {
      stallMs: Math.round(stallMs),
      thresholdMs: this.opts.thresholdMs,
      uptimeMs: Math.round(now - this.startedAt),
      inFlight,
      during: during.slice(0, cap),
      openCount: this.open.size,
      rssMb: readRssMb(),
    });
  }

  private failClosed(): void {
    this.disabled = true;
    this.open.clear();
    this.stop();
  }
}

function readRssMb(): number | null {
  try {
    // `memoryUsage.rss()` is the cheap variant: one syscall, no object with
    // heap statistics behind it.
    return Math.round(process.memoryUsage.rss() / (1024 * 1024));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Process-wide instance. `handleTrusted` needs to reach the trace      */
/* without every IPC module taking a dependency on main.ts's wiring.    */
/* ------------------------------------------------------------------ */

let active: MainThreadStallTrace | null = null;

export function installMainThreadStallTrace(
  trace: MainThreadStallTrace
): MainThreadStallTrace {
  active?.stop();
  active = trace;
  trace.start();
  return trace;
}

export function uninstallMainThreadStallTrace(): void {
  active?.stop();
  active = null;
}

/** Zero when no trace is installed, which is the normal state in tests. */
export function beginMainThreadActivity(label: string): number {
  return active ? active.begin(label) : 0;
}

export function endMainThreadActivity(token: number): void {
  if (token !== 0) active?.end(token);
}
