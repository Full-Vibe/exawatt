import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { transientAllocation } from './cost.test-support';
import { createDiagnosticsLog } from './diagnostics-log';
import {
  MainThreadStallTrace,
  STALL_LOG_MAX_BYTES,
  beginMainThreadActivity,
  endMainThreadActivity,
  installMainThreadStallTrace,
  uninstallMainThreadStallTrace,
} from './main-thread-stall-trace';

const dirs: string[] = [];

afterEach(async () => {
  uninstallMainThreadStallTrace();
  for (const dir of dirs.splice(0)) {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-stall-'));
  dirs.push(dir);
  return dir;
}

interface Recorded {
  event: string;
  fields: Record<string, unknown>;
}

/** A trace whose clock the test owns, so no test waits on real time. */
function harness(
  overrides: Partial<ConstructorParameters<typeof MainThreadStallTrace>[0]> = {}
) {
  let now = 1_000_000;
  const events: Recorded[] = [];
  const trace = new MainThreadStallTrace({
    record: (event, fields = {}) => {
      events.push({ event, fields });
    },
    now: () => now,
    sampleMs: 500,
    thresholdMs: 1_000,
    ...overrides,
  });
  // Arm the clocks, then drop the real interval: every test below drives
  // `sample()` on its own clock. That the interval itself detects a real block
  // is proved separately, with real timers, at the end of this file.
  trace.start();
  trace.stop();
  return {
    trace,
    events,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('detection', () => {
  it('records nothing while the loop is serviced on time', () => {
    const h = harness();
    for (let i = 0; i < 100; i += 1) {
      h.advance(500);
      h.trace.sample();
    }
    expect(h.events).toEqual([]);
  });

  it('records lateness beyond the threshold as a stall', () => {
    const h = harness();
    h.advance(500);
    h.trace.sample();
    h.advance(4_500); // 4s late for a 500ms heartbeat
    h.trace.sample();
    expect(h.events).toHaveLength(1);
    expect(h.events[0].event).toBe('main.stall');
    expect(h.events[0].fields.stallMs).toBe(4_000);
  });

  it('ignores lateness under the threshold, which is ordinary jitter', () => {
    const h = harness();
    h.advance(500);
    h.trace.sample();
    h.advance(1_400);
    h.trace.sample();
    expect(h.events).toEqual([]);
  });
});

describe('what was running', () => {
  it('names work that was still open when the loop resumed', () => {
    const h = harness();
    h.advance(500);
    h.trace.sample();
    const token = h.trace.begin('pty:create');
    h.advance(4_500);
    h.trace.sample();
    h.trace.end(token);
    expect(h.events[0].fields.inFlight).toEqual([
      { label: 'pty:create', openMs: 4_500 },
    ]);
  });

  it('names work that STARTED AND FINISHED inside the blocked window', () => {
    // The case a naive in-flight snapshot misses entirely: a handler that
    // blocks synchronously has already closed by the time the late timer runs.
    const h = harness();
    h.advance(500);
    h.trace.sample();
    const token = h.trace.begin('pty:retained-history');
    h.advance(3_900);
    h.trace.end(token);
    h.advance(600);
    h.trace.sample();
    expect(h.events[0].fields.inFlight).toEqual([]);
    expect(h.events[0].fields.during).toEqual([
      { label: 'pty:retained-history', ms: 3_900 },
    ]);
  });

  it('leaves both lists empty when the blocker was not IPC, which is itself a finding', () => {
    const h = harness();
    h.advance(500);
    h.trace.sample();
    h.advance(4_500);
    h.trace.sample();
    expect(h.events[0].fields.inFlight).toEqual([]);
    expect(h.events[0].fields.during).toEqual([]);
  });

  it('does not report work that closed before the blocked window', () => {
    const h = harness();
    const old = h.trace.begin('app:settings');
    h.advance(10);
    h.trace.end(old);
    h.advance(490);
    h.trace.sample();
    h.advance(4_500);
    h.trace.sample();
    expect(h.events[0].fields.during).toEqual([]);
  });

  it('caps how many activities one record can name', () => {
    const h = harness({ maxReportedActivities: 3 });
    h.advance(500);
    h.trace.sample();
    for (let i = 0; i < 40; i += 1) h.trace.begin(`channel:${i}`);
    h.advance(4_500);
    h.trace.sample();
    expect((h.events[0].fields.inFlight as unknown[]).length).toBe(3);
    expect(h.events[0].fields.openCount).toBe(40);
  });
});

describe('it can never run away', () => {
  it('rate limits to a fixed number of records per minute', () => {
    const h = harness({ maxRecordsPerMinute: 3 });
    // Ten stalls inside one minute of simulated time.
    for (let i = 0; i < 10; i += 1) {
      h.advance(500);
      h.trace.sample();
      h.advance(2_500);
      h.trace.sample();
    }
    const stalls = h.events.filter(e => e.event === 'main.stall');
    const suppressed = h.events.filter(
      e => e.event === 'main.stall.suppressed'
    );
    expect(stalls).toHaveLength(3);
    // One line says the recorder went quiet, then silence for the window.
    expect(suppressed).toHaveLength(1);
  });

  it('reopens the budget on the next minute, so a later stall is not lost', () => {
    const h = harness({ maxRecordsPerMinute: 1 });
    h.advance(500);
    h.trace.sample();
    h.advance(4_500);
    h.trace.sample();
    h.advance(500);
    h.trace.sample();
    h.advance(4_500);
    h.trace.sample();
    expect(h.events.filter(e => e.event === 'main.stall')).toHaveLength(1);

    h.advance(60_000);
    h.trace.sample();
    h.advance(500);
    h.trace.sample();
    h.advance(4_500);
    h.trace.sample();
    expect(h.events.filter(e => e.event === 'main.stall')).toHaveLength(2);
  });

  it('goes permanently silent after a per-run ceiling', () => {
    const h = harness({ maxRecordsPerMinute: 1_000, maxRecordsPerRun: 5 });
    for (let i = 0; i < 50; i += 1) {
      h.advance(500);
      h.trace.sample();
      h.advance(4_500);
      h.trace.sample();
    }
    expect(h.events.filter(e => e.event === 'main.stall')).toHaveLength(5);
    expect(
      h.events.filter(e => e.event === 'main.stall.exhausted')
    ).toHaveLength(1);
    // And it stops detecting too, so the cost returns to zero.
    expect(h.trace.isDisabled).toBe(true);
  });

  it('has a hard disk ceiling, proved by writing far past it', () => {
    const dir = tempDir();
    const logPath = path.join(dir, 'main.jsonl');
    const record = createDiagnosticsLog(logPath, STALL_LOG_MAX_BYTES);
    const trace = new MainThreadStallTrace({
      record,
      sampleMs: 1,
      thresholdMs: 1,
      maxRecordsPerMinute: Number.MAX_SAFE_INTEGER,
      maxRecordsPerRun: Number.MAX_SAFE_INTEGER,
      now: (() => {
        let t = 0;
        return () => (t += 10_000);
      })(),
    });
    trace.start();
    trace.stop();
    for (let i = 0; i < 4_000; i += 1) trace.sample();

    const total = fs
      .readdirSync(dir)
      .map(name => fs.statSync(path.join(dir, name)).size)
      .reduce((sum, size) => sum + size, 0);
    // One live file plus one rotated generation, each capped.
    expect(total).toBeLessThanOrEqual(2 * STALL_LOG_MAX_BYTES + 4_096);
    expect(fs.readdirSync(dir).sort()).toEqual(['main.jsonl', 'main.jsonl.1']);
  });

  it('disables itself silently when the recorder throws', () => {
    const trace = new MainThreadStallTrace({
      record: () => {
        throw new Error('disk is gone');
      },
      sampleMs: 500,
      thresholdMs: 1_000,
      now: (() => {
        let t = 0;
        return () => (t += 5_000);
      })(),
    });
    trace.start();
    expect(() => trace.sample()).not.toThrow();
    expect(trace.isDisabled).toBe(true);
    // And it stays inert rather than retrying into the same failure.
    expect(() => trace.sample()).not.toThrow();
    expect(trace.begin('pty:create')).toBe(0);
  });

  it('is inert, not throwing, when no trace is installed', () => {
    uninstallMainThreadStallTrace();
    expect(beginMainThreadActivity('pty:create')).toBe(0);
    expect(() => endMainThreadActivity(0)).not.toThrow();
  });

  it('holds no memory proportional to how much work has run', () => {
    const h = harness({ historySize: 8 });
    for (let i = 0; i < 10_000; i += 1) {
      const token = h.trace.begin(`channel:${i}`);
      h.advance(1);
      h.trace.end(token);
    }
    h.advance(500);
    h.trace.sample();
    h.advance(4_500);
    h.trace.sample();
    // The ring is the only retained history, and it is fixed size.
    expect((h.events[0].fields.during as unknown[]).length).toBeLessThanOrEqual(
      8
    );
    expect(h.events[0].fields.openCount).toBe(0);
  });
});

describe('steady-state cost', () => {
  it('does no work worth measuring when nothing is wrong', () => {
    // The whole steady state is: one timer callback per sample doing a
    // subtraction, and a Map write/delete per IPC call. The sampler must not
    // grow real work — capturing a stack, snapshotting the open Map, or
    // formatting a message per sample would all make the trace cost more than
    // the stalls it exists to find.
    //
    // Read as bytes rather than as the nanoseconds it used to be. Every shape
    // that regression can take builds something per call, so allocation states
    // the claim directly, and unlike a nanosecond budget it is the same number
    // whether or not three other agent worktrees own the cores (BUG-057).
    const trace = new MainThreadStallTrace({ record: () => {} });
    installMainThreadStallTrace(trace);

    const SAMPLES = 200_000;
    const sampling = transientAllocation(() => {
      for (let i = 0; i < SAMPLES; i += 1) trace.sample();
    });

    const CALLS = 200_000;
    const calling = transientAllocation(() => {
      for (let i = 0; i < CALLS; i += 1) {
        endMainThreadActivity(beginMainThreadActivity('pty:list'));
      }
    });

    // A subtraction allocates nothing at all; the budget is slack for the
    // worker's own background garbage, not a per-sample allowance.
    expect(sampling.bytes).toBeLessThan(SAMPLES * 2);
    // One short-lived Map entry per call, measured at ~330 bytes and budgeted
    // at four times that. A sampler that captured a stack per call would be
    // several kilobytes and would not fit under it.
    expect(calling.bytes).toBeLessThan(CALLS * 1_024);
  });
});

describe('against a real blocked event loop', () => {
  it('catches a genuine synchronous block and names the work that caused it', async () => {
    const events: Array<{ event: string; fields: Record<string, unknown> }> =
      [];
    const trace = new MainThreadStallTrace({
      record: (event, fields = {}) => events.push({ event, fields }),
      sampleMs: 10,
      thresholdMs: 120,
    });
    installMainThreadStallTrace(trace);

    // Real timers, real Date.now, a real busy-wait — no simulated clock.
    await new Promise(resolve => setTimeout(resolve, 40));
    const token = beginMainThreadActivity('pty:create');
    const until = Date.now() + 400;
    while (Date.now() < until) {
      // Block the loop exactly the way a synchronous main-process defect does.
    }
    endMainThreadActivity(token);
    await new Promise(resolve => setTimeout(resolve, 60));

    // A host running several agent worktrees at once starves this process
    // before the busy-wait too, and that starvation is itself a stall the
    // trace correctly reports — so the FIRST recorded stall is not reliably
    // the one this test caused (BUG-057). The claim is that the trace names
    // the work that was open across a block, so find the stall that spans the
    // block and read it. A trace that stopped attributing work still fails,
    // because then no stall names it at all.
    const stalls = events.filter(e => e.event === 'main.stall');
    expect(stalls.length).toBeGreaterThanOrEqual(1);
    const attributed = stalls.filter(stall =>
      (stall.fields.during as Array<{ label: string }>).some(
        entry => entry.label === 'pty:create'
      )
    );
    expect(attributed).toHaveLength(1);
    expect(attributed[0].fields.stallMs as number).toBeGreaterThan(200);
  });
});
