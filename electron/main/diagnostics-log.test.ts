import { describe, expect, it } from 'vitest';
import {
  boundDiagnosticRecorder,
  boundDiagnosticRecorderPerFamily,
  type DiagnosticFields,
} from './diagnostics-log';

function sink() {
  const lines: Array<{ event: string; fields: DiagnosticFields }> = [];
  return {
    lines,
    record: (event: string, fields: DiagnosticFields = {}) => {
      lines.push({ event, fields });
    },
    events: () => lines.map(line => line.event),
  };
}

/** A timer the test fires by hand: nothing waits on the host's clock. */
function manualSchedule() {
  const pending: Array<{ flush: () => void; ms: number }> = [];
  return {
    pending,
    schedule: (flush: () => void, ms: number) => {
      const entry = { flush, ms };
      pending.push(entry);
      return () => {
        pending.splice(pending.indexOf(entry), 1);
      };
    },
    fire: () => pending.splice(0).forEach(entry => entry.flush()),
  };
}

describe('boundDiagnosticRecorder', () => {
  it('caps records per minute and says how many it dropped when that minute ends', () => {
    let clock = 0;
    const out = sink();
    const timer = manualSchedule();
    const record = boundDiagnosticRecorder(out.record, {
      perMinute: 2,
      perRun: 10,
      now: () => clock,
      schedule: timer.schedule,
    });
    clock = 60_000;
    record('x');
    record('x');
    clock += 1_000;
    record('x');
    record('x');
    record('x');
    expect(out.events()).toEqual(['x', 'x']);
    expect(timer.pending.map(entry => entry.ms)).toEqual([59_000]);

    timer.fire();

    expect(out.lines[2]).toEqual({
      event: 'x.suppressed',
      fields: { suppressed: 3, perMinute: 2 },
    });
  });

  it('writes the count when the next minute begins, if that comes first', () => {
    let clock = 60_000;
    const out = sink();
    const timer = manualSchedule();
    const record = boundDiagnosticRecorder(out.record, {
      perMinute: 1,
      perRun: 10,
      now: () => clock,
      schedule: timer.schedule,
    });
    record('x', { n: 1 });
    record('x', { n: 2 });
    clock += 60_000;
    record('x', { n: 3 });

    expect(out.lines).toEqual([
      { event: 'x', fields: { n: 1 } },
      { event: 'x.suppressed', fields: { suppressed: 1, perMinute: 1 } },
      { event: 'x', fields: { n: 3 } },
    ]);
    // The minute's own timer was cancelled: the count is written once.
    expect(timer.pending).toEqual([]);
  });

  it('stops for the run with one exhaustion line', () => {
    let clock = 60_000;
    const out = sink();
    const record = boundDiagnosticRecorder(out.record, {
      perMinute: 10,
      perRun: 2,
      now: () => clock,
      schedule: manualSchedule().schedule,
    });
    record('x');
    record('x');
    record('x');
    clock += 60_000;
    record('x');

    expect(out.lines).toEqual([
      { event: 'x', fields: {} },
      { event: 'x', fields: {} },
      { event: 'x.exhausted', fields: { perRun: 2 } },
    ]);
  });
});

describe('boundDiagnosticRecorderPerFamily', () => {
  it('gives each event family its own budget, so one crash loop cannot silence another', () => {
    const out = sink();
    const timer = manualSchedule();
    const record = boundDiagnosticRecorderPerFamily(out.record, {
      perMinute: 2,
      perRun: 100,
      now: () => 60_000,
      schedule: timer.schedule,
    });
    for (let i = 0; i < 50; i += 1) record('child.gone', { i });
    record('renderer.gone', { action: 'reload' });
    record('renderer.recovery-choice', { choice: 'reload' });
    record('renderer-server.exited', { action: 'restart' });

    timer.fire();

    expect(out.events()).toEqual([
      'child.gone',
      'child.gone',
      'renderer.gone',
      'renderer.recovery-choice',
      'renderer-server.exited',
      'child.suppressed',
    ]);
    expect(out.lines[out.lines.length - 1].fields).toEqual({
      suppressed: 48,
      perMinute: 2,
    });
  });
});
