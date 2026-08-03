import { describe, expect, it } from 'vitest';
import type { CapacityWindowView, ConsumptionSourceView } from '../model';
import {
  PACE_EVEN_BAND,
  classifyPace,
  meterTone,
  paceLabel,
  paceSentence,
  readMeter,
  readWindowPace,
  remediationHint,
} from './meter-model';
import { METER_STATES } from './fixtures';
import { FLUX } from '../flux';

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

describe('readMeter', () => {
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

  it('headlines the tightest live window across sources', () => {
    const snap = readMeter(
      [
        source([
          win({ limitId: 'codex-primary', usedPercent: 40 }),
          win({
            limitId: 'codex-weekly',
            label: 'Weekly window',
            windowMinutes: 10_080,
            resetsAtMs: NOW + 54 * HOUR,
            usedPercent: 84,
            burnPercentPerHour: 0.92,
          }),
        ]),
      ],
      NOW
    );
    expect(snap.reading?.window.limitId).toBe('codex-weekly');
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

  it('readWindowPace, paceSentence, and paceLabel all speak the same verdict', () => {
    // 300-minute window, resets in 90m → even pace 70%; 78% used = +8 pts
    const r = readWindowPace(source([]), win({ usedPercent: 78 }), NOW);
    expect(r.pace).toBe(classifyPace(r.paceDeltaPoints));
    expect(paceSentence(r)).toBe('ahead of even pace by 8 pts');
    expect(paceLabel(r).text).toBe('8 pts ahead of even pace');
  });

  it('a 4-point delta is even everywhere — no surface may re-band it', () => {
    const r = readWindowPace(source([]), win({ usedPercent: 74 }), NOW);
    expect(r.paceDeltaPoints).toBeCloseTo(4, 5);
    expect(r.pace).toBe('even');
    expect(paceLabel(r).text).toBe('on even pace');
    expect(paceSentence(r)).toBe('on even pace for this window');
  });

  it('exhaustion speaks one verb: spent', () => {
    // 70% used, 25%/h, 1.5h to reset → spent before reset
    const r = readWindowPace(
      source([]),
      win({ usedPercent: 70, burnPercentPerHour: 25 }),
      NOW
    );
    expect(r.exhaustsBeforeReset).toBe(true);
    expect(paceLabel(r).text).toMatch(/^spent in /);
    expect(paceLabel(r).text).not.toContain('exhausts');
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
    expect(readMeter([source([win({ usedPercent: 70, burnPercentPerHour: 25 })])], NOW).reading?.exhaustsBeforeReset).toBe(true);
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

describe('words', () => {
  it('states the pace verdict with the point delta', () => {
    const r = readMeter([source([win({ usedPercent: 86 })])], NOW).reading!;
    expect(paceSentence(r)).toBe('ahead of even pace by 16 pts');
  });

  it('coaches only at hot and exhausted', () => {
    const warm = readMeter([source([win({ usedPercent: 71 })])], NOW).reading!;
    const hot = readMeter([source([win({ usedPercent: 86 })])], NOW).reading!;
    const spent = readMeter([source([win({ usedPercent: 100 })])], NOW)
      .reading!;
    expect(remediationHint(warm)).toBeNull();
    expect(remediationHint(hot)).toBeTruthy();
    expect(remediationHint(spent)).toMatch(/resets|reset/i);
  });
});

describe('gallery fixtures', () => {
  it('cover the full escalation ladder in order', () => {
    const states = METER_STATES.map(
      s => readMeter(s.sources, s.nowMs).reading?.state
    );
    expect(states.slice(0, 4)).toEqual([
      'healthy',
      'warm',
      'hot',
      'exhausted',
    ]);
  });

  it('the hot fixture is ahead of even pace, per the operator spec', () => {
    const hot = METER_STATES.find(s => s.id === 'hot')!;
    const r = readMeter(hot.sources, hot.nowMs).reading!;
    expect(r.usedPercent).toBe(86);
    expect(r.pace).toBe('ahead');
  });

  it('the demo corpus state headlines a real reported window', () => {
    const demo = METER_STATES.find(s => s.id === 'demo-corpus')!;
    const r = readMeter(demo.sources, demo.nowMs).reading;
    expect(r).not.toBeNull();
    expect(r!.usedPercent).toBeGreaterThan(0);
  });
});
