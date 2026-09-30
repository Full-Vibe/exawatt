import { describe, expect, it } from 'vitest';
import type { CapacityWindowView, ConsumptionSourceView } from '../model';
import {
  PACE_EVEN_BAND,
  bitesFirst,
  classifyPace,
  meterTone,
  readWindowPace,
} from './meter-model';
import { usageOverview } from '../accounts';

/** The chrome glyph's reading: the live window that bites first, as the
 *  one projection (`usageOverview`) chooses it. */
function readMeter(sources: ConsumptionSourceView[], nowMs: number) {
  const binding = usageOverview({ nowMs, windowLabel: 'seven days', sources, samples: [] }).binding;
  return { reading: binding?.meter.reading ?? null };
}
import { FLUX_CSS as FLUX } from '../flux';

const NOW = Date.parse('2026-08-02T15:20:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

function win(
  overrides: Partial<CapacityWindowView> & { usedPercent: number }
): CapacityWindowView {
  return {
    limitId: 'codex-primary',
    label: '5-hour window',
    windowMinutes: 300,
    resetsAtMs: NOW + 90 * MIN,
    burnPercentPerHour: 8,
    observedAtMs: NOW - MIN,
    ...overrides,
  };
}

function source(windows: CapacityWindowView[]): ConsumptionSourceView {
  return {
    key: 'codex',
    harness: 'codex',
    label: 'Codex',
    planType: 'pro',
    credits: null,
    windows,
    observedTokens5h: 1_000_000,
    observedSessions: 2,
    observedDelegatedShare: null,
    burn: [0.4, 0.5],
  };
}

describe('the chrome glyph reading', () => {
  it('returns a null reading when no source reports a window', () => {
    const snap = readMeter([source([])], NOW);
    expect(snap.reading).toBeNull();
  });

  it('excludes windows that are past their own reset instant', () => {
    const snap = readMeter(
      [source([win({ usedPercent: 90, resetsAtMs: NOW - MIN })])],
      NOW
    );
    expect(snap.reading).toBeNull();
  });

  it('excludes readings older than the window they describe', () => {
    const stale = win({
      usedPercent: 90,
      observedAtMs: NOW - 400 * MIN,
    });
    const snap = readMeter([source([stale])], NOW);
    expect(snap.reading).toBeNull();
  });

  it('headlines the window that runs out first, not the fullest one', () => {
    const snap = readMeter(
      [
        source([
          // 84% used but flat: lasts to its reset.
          win({
            limitId: 'codex-weekly',
            windowMinutes: 10_080,
            resetsAtMs: NOW + 54 * HOUR,
            usedPercent: 84,
            burnPercentPerHour: 0.1,
          }),
          // 60% used and burning: out in an hour, before its reset.
          win({ limitId: 'codex-primary', usedPercent: 60, burnPercentPerHour: 40 }),
        ]),
      ],
      NOW
    );
    expect(snap.reading?.window.limitId).toBe('codex-primary');
  });

  it('with nothing running out, headlines the fullest window', () => {
    const snap = readMeter(
      [
        source([
          win({ limitId: 'a', usedPercent: 40, burnPercentPerHour: 0 }),
          win({ limitId: 'b', usedPercent: 71, burnPercentPerHour: 0 }),
        ]),
      ],
      NOW
    );
    expect(snap.reading?.window.limitId).toBe('b');
  });

  it('computes even pace from window elapsed time', () => {
    // 300-minute window, resets in 90m → 70% elapsed
    const snap = readMeter([source([win({ usedPercent: 78 })])], NOW);
    expect(snap.reading?.evenPacePercent).toBeCloseTo(70, 5);
    expect(snap.reading?.paceDeltaPoints).toBeCloseTo(8, 5);
    expect(snap.reading?.pace).toBe('ahead');
  });

  it('reads within the ±5pt band as even pace', () => {
    const snap = readMeter([source([win({ usedPercent: 72 })])], NOW);
    expect(snap.reading?.pace).toBe('even');
  });
});

describe('classifyPace — the one band every surface shares', () => {
  it('is symmetric around the ±5 even band', () => {
    expect(PACE_EVEN_BAND).toBe(5);
    expect(classifyPace(0)).toBe('even');
    expect(classifyPace(PACE_EVEN_BAND)).toBe('even');
    expect(classifyPace(-PACE_EVEN_BAND)).toBe('even');
    expect(classifyPace(PACE_EVEN_BAND + 0.01)).toBe('ahead');
    expect(classifyPace(-PACE_EVEN_BAND - 0.01)).toBe('behind');
  });

  it('readWindowPace carries the shared band verdict', () => {
    // 300-minute window, resets in 90m → even pace 70%; 78% used = +8 pts
    const r = readWindowPace(source([]), win({ usedPercent: 78 }), NOW);
    expect(r.pace).toBe(classifyPace(r.paceDeltaPoints));
    expect(r.pace).toBe('ahead');
  });
});

describe('bitesFirst — which window bites first', () => {
  const read = (overrides: Partial<CapacityWindowView> & { usedPercent: number }) =>
    readWindowPace(source([]), win(overrides), NOW);

  it('puts a spent window before any window still running', () => {
    const spent = read({ usedPercent: 100, burnPercentPerHour: 0 });
    const racing = read({ usedPercent: 80, burnPercentPerHour: 60 });
    expect(bitesFirst(spent, racing)).toBeLessThan(0);
    expect(bitesFirst(racing, spent)).toBeGreaterThan(0);
  });

  it('orders running windows by their projected run-out instant', () => {
    const soon = read({ usedPercent: 50, burnPercentPerHour: 60 });
    const later = read({ usedPercent: 50, burnPercentPerHour: 40 });
    expect(bitesFirst(soon, later)).toBeLessThan(0);
  });
});

describe('projection runs from the observation instant', () => {
  it('a window read two hours ago has burned for those two hours', () => {
    const fresh = readWindowPace(
      source([]),
      win({ usedPercent: 50, burnPercentPerHour: 10, resetsAtMs: NOW + 10 * HOUR, windowMinutes: 10_080, observedAtMs: NOW }),
      NOW
    );
    const old = readWindowPace(
      source([]),
      win({ usedPercent: 50, burnPercentPerHour: 10, resetsAtMs: NOW + 10 * HOUR, windowMinutes: 10_080, observedAtMs: NOW - 2 * HOUR }),
      NOW
    );
    expect(fresh.msToExhaust).toBe(5 * HOUR);
    expect(old.msToExhaust).toBe(3 * HOUR);
  });
});

describe('state ladder', () => {
  const stateAt = (usedPercent: number, burn = 0) =>
    readMeter([source([win({ usedPercent, burnPercentPerHour: burn })])], NOW)
      .reading?.state;

  it('escalates by used percent: healthy → warm → hot → exhausted', () => {
    expect(stateAt(34)).toBe('healthy');
    expect(stateAt(71)).toBe('warm');
    expect(stateAt(86)).toBe('hot');
    expect(stateAt(100)).toBe('exhausted');
  });

  it('a pace that exhausts the window before reset is hot even under 85%', () => {
    // 70% used, 1.5h to reset, 25%/h → projected 107.5%
    expect(stateAt(70, 25)).toBe('hot');
    expect(
      readMeter(
        [source([win({ usedPercent: 70, burnPercentPerHour: 25 })])],
        NOW
      ).reading?.exhaustsBeforeReset
    ).toBe(true);
  });
});

describe('meterTone — monochrome until it matters', () => {
  it('healthy and warm stay off the consumption channel', () => {
    const healthy = meterTone(
      readMeter([source([win({ usedPercent: 34 })])], NOW).reading
    );
    const warm = meterTone(
      readMeter([source([win({ usedPercent: 71 })])], NOW).reading
    );
    expect(healthy.colored).toBe(false);
    expect(warm.colored).toBe(false);
  });

  it('hot and exhausted switch the channel on', () => {
    const hot = meterTone(
      readMeter([source([win({ usedPercent: 86 })])], NOW).reading
    );
    const spent = meterTone(
      readMeter([source([win({ usedPercent: 100 })])], NOW).reading
    );
    expect(hot.colored).toBe(true);
    expect(spent.colored).toBe(true);
    expect(spent.fill).toBe(FLUX.hot);
  });

  it('an unknown reading is the neutral unknown, never a fill', () => {
    const t = meterTone(null);
    expect(t.fill).toBe(FLUX.unknown);
    expect(t.colored).toBe(false);
  });
});
