import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  UnhandledRejectionTrace,
  installUnhandledRejectionTrace,
  uninstallUnhandledRejectionTrace,
} from './unhandled-rejection-trace';

/**
 * The operator's constraint on standing instrumentation, applied to the
 * rejection trace exactly as `main-thread-stall-trace.test.ts` applies it to
 * the stall trace: bounded, rate limited, and unable to break the process it
 * watches. The clock is injected, so no test waits on real time.
 */

interface Recorded {
  event: string;
  fields: Record<string, unknown>;
}

function harness(
  overrides: Partial<ConstructorParameters<typeof UnhandledRejectionTrace>[0]> = {}
) {
  let now = 1_000_000;
  const events: Recorded[] = [];
  const warnings: string[] = [];
  const trace = new UnhandledRejectionTrace({
    record: (event, fields = {}) => {
      events.push({ event, fields });
    },
    now: () => now,
    warn: message => {
      warnings.push(message);
    },
    ...overrides,
  });
  return {
    trace,
    events,
    warnings,
    advance(ms: number) {
      now += ms;
    },
  };
}

afterEach(() => {
  uninstallUnhandledRejectionTrace();
});

describe('UnhandledRejectionTrace', () => {
  it('records the rejection with its name, message, and a bounded stack', () => {
    const h = harness();
    const reason = new TypeError("Cannot read properties of null (reading 'type')");

    h.trace.handle(reason);

    expect(h.events).toHaveLength(1);
    expect(h.events[0]!.event).toBe('main.unhandled-rejection');
    expect(h.events[0]!.fields).toMatchObject({
      name: 'TypeError',
      message: "Cannot read properties of null (reading 'type')",
    });
    const stack = h.events[0]!.fields.stack;
    expect(typeof stack).toBe('string');
    expect((stack as string).split('\n').length).toBeLessThanOrEqual(12);
    // The console keeps the line Node would have printed itself.
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]).toContain('unhandled promise rejection');
  });

  it('describes a reason that is not an Error without throwing', () => {
    const h = harness();
    h.trace.handle(undefined);
    h.trace.handle(null);
    h.trace.handle('a bare string');
    h.trace.handle({ code: 'EFOO' });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    h.trace.handle(circular);

    expect(h.events.map(event => event.event)).toEqual(
      new Array(5).fill('main.unhandled-rejection')
    );
    expect(h.events[2]!.fields).toMatchObject({ message: 'a bare string' });
    expect(h.events[3]!.fields).toMatchObject({ message: '{"code":"EFOO"}' });
    expect(h.trace.isDisabled).toBe(false);
  });

  it('writes at most the per-minute budget, then one suppressed line per window', () => {
    const h = harness({ maxRecordsPerMinute: 3 });
    for (let index = 0; index < 10; index += 1) {
      h.trace.handle(new Error(`burst ${index}`));
    }
    expect(h.events.map(event => event.event)).toEqual([
      'main.unhandled-rejection',
      'main.unhandled-rejection',
      'main.unhandled-rejection',
    ]);

    // The window turns over: the suppressed count is written once, and the
    // budget is fresh.
    h.advance(60_000);
    h.trace.handle(new Error('next window'));
    expect(h.events.map(event => event.event)).toEqual([
      'main.unhandled-rejection',
      'main.unhandled-rejection',
      'main.unhandled-rejection',
      'main.unhandled-rejection.suppressed',
      'main.unhandled-rejection',
    ]);
    expect(h.events[3]!.fields).toMatchObject({ count: 7 });
  });

  it('stops for the run after the per-run budget, announcing it once', () => {
    const h = harness({ maxRecordsPerMinute: 100, maxRecordsPerRun: 2 });
    for (let index = 0; index < 5; index += 1) {
      h.trace.handle(new Error(`run ${index}`));
    }
    h.advance(120_000);
    h.trace.handle(new Error('much later'));

    expect(h.events.map(event => event.event)).toEqual([
      'main.unhandled-rejection',
      'main.unhandled-rejection',
      'main.unhandled-rejection.exhausted',
    ]);
  });

  it('fails closed when the recorder throws, and never throws itself', () => {
    let calls = 0;
    const h = harness({
      record: () => {
        calls += 1;
        throw new Error('disk full');
      },
    });

    expect(() => h.trace.handle(new Error('first'))).not.toThrow();
    expect(h.trace.isDisabled).toBe(true);
    expect(() => h.trace.handle(new Error('second'))).not.toThrow();
    // Disabled means disabled: the recorder is not asked again.
    expect(calls).toBe(1);
  });

  it('fails closed when the console itself throws', () => {
    const h = harness({
      warn: () => {
        throw new Error('no console');
      },
    });
    expect(() => h.trace.handle(new Error('first'))).not.toThrow();
    expect(h.trace.isDisabled).toBe(true);
  });
});

describe('installUnhandledRejectionTrace', () => {
  it('attaches one listener, replaces it on reinstall, and detaches cleanly', () => {
    const target = new EventEmitter() as unknown as NodeJS.Process;
    const first = harness();
    const second = harness();

    installUnhandledRejectionTrace(first.trace, target);
    installUnhandledRejectionTrace(second.trace, target);
    expect(target.listenerCount('unhandledRejection')).toBe(1);

    target.emit('unhandledRejection', new Error('escaped'));
    expect(first.events).toHaveLength(0);
    expect(second.events).toHaveLength(1);

    uninstallUnhandledRejectionTrace();
    expect(target.listenerCount('unhandledRejection')).toBe(0);
    target.emit('unhandledRejection', new Error('after'));
    expect(second.events).toHaveLength(1);
  });
});
