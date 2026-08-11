import { describe, expect, it } from 'vitest';
import type { CapacityWindowView, ConsumptionSourceView } from '../model';
import {
  PACE_EVEN_BAND,
  classifyPace,
  closingOpportunity,
  ledgerLine,
  meterTone,
  opportunityCoach,
  opportunityOf,
  paceLabel,
  paceSentence,
  readAllWindows,
  readMeter,
  readWindowPace,
  remediationHint,
} from './meter-model';
import { METER_STATES } from './fixtures';
import {
  OPPORTUNITY_STATES,
  STUDY_NOW_MS,
} from '@/app/hud-gallery/pace-opportunity-model';
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

describe('words', () => {
  it('states the pace verdict with the point delta', () => {
    const r = readMeter([source([win({ usedPercent: 86 })])], NOW).reading!;
    expect(paceSentence(r)).toBe('ahead of even pace by 16 pts');
  });

  it('coaches only at hot and exhausted', () => {
    const warm = readMeter([source([win({ usedPercent: 71 })])], NOW).reading!;
    const hot = readMeter([source([win({ usedPercent: 86 })])], NOW).reading!;
    const spent = readMeter(
      [source([win({ usedPercent: 100 })])],
      NOW
    ).reading!;
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
    expect(states.slice(0, 4)).toEqual(['healthy', 'warm', 'hot', 'exhausted']);
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

/* ------------------------------------------------------------------ */
/* opportunity (E9) — the trigger predicate, pinned at the source      */
/* ------------------------------------------------------------------ */

/** One reading straight from the predicate's inputs, for the edge tests. */
function oppReading(
  usedPercent: number,
  windowMinutes: number,
  msToReset: number,
  burnPercentPerHour = 0.5
) {
  const w: CapacityWindowView = {
    limitId: 'test',
    label: 'test window',
    usedPercent,
    windowMinutes,
    resetsAtMs: STUDY_NOW_MS + msToReset,
    burnPercentPerHour,
  };
  return readWindowPace(source([]), w, STUDY_NOW_MS);
}

function fixtureReadings(id: string) {
  const state = OPPORTUNITY_STATES.find(s => s.id === id);
  if (!state) throw new Error(`no fixture state ${id}`);
  const out = new Map<string, ReturnType<typeof oppReading>>();
  for (const src of state.sources) {
    for (const w of src.windows) {
      out.set(w.limitId, readWindowPace(src, w, state.nowMs));
    }
  }
  return { state, out };
}

describe('opportunity trigger across the review fixtures', () => {
  it('comfortable pace: no window speaks', () => {
    const { out } = fixtureReadings('comfortable');
    for (const r of out.values()) expect(opportunityOf(r)).toBeNull();
  });

  it('mildly behind: a 12-pt deficit stays silent, 17 pts opens quietly', () => {
    const { out } = fixtureReadings('mildly-behind');
    const fiveHour = out.get('codex-primary')!;
    expect(fiveHour.pace).toBe('behind'); // the verdict says behind…
    expect(opportunityOf(fiveHour)).toBeNull(); // …but under the 15-pt floor
    const weekly = opportunityOf(out.get('codex-weekly')!);
    expect(weekly).toMatchObject({ tier: 'open', floorPts: 17, coursePts: 24 });
  });

  it('strongly behind near reset: the operator’s verbatim shape is closing', () => {
    const { out } = fixtureReadings('strongly-behind');
    expect(opportunityOf(out.get('codex-primary')!)).toBeNull();
    const weekly = opportunityOf(out.get('codex-weekly')!);
    expect(weekly).toMatchObject({
      tier: 'closing',
      freePts: 72,
      floorPts: 67,
      coursePts: 67,
    });
  });

  it('expired: the fresh window is silent and the closed cycle is the record', () => {
    const { state, out } = fixtureReadings('expired');
    for (const r of out.values()) expect(opportunityOf(r)).toBeNull();
    expect(state.lastCycle).toMatchObject({ unusedPercent: 67 });
  });

  it('dual signal: the hot window never speaks opportunity, the weekly does', () => {
    const { out } = fixtureReadings('dual-signal');
    const fiveHour = out.get('codex-primary')!;
    expect(fiveHour.state).toBe('hot');
    expect(opportunityOf(fiveHour)).toBeNull();
    const weekly = opportunityOf(out.get('codex-weekly')!);
    expect(weekly).toMatchObject({ tier: 'closing', coursePts: 53 });
  });
});

describe('opportunity trigger edges', () => {
  it('gates on the 15-pt floor', () => {
    // 60% elapsed on a 5-hour window
    expect(opportunityOf(oppReading(45, 300, 120 * MIN))).not.toBeNull(); // floor 15
    expect(opportunityOf(oppReading(46, 300, 120 * MIN))).toBeNull(); // floor 14
  });

  it('needs at least 30 minutes of runway', () => {
    expect(opportunityOf(oppReading(40, 300, 29 * MIN))).toBeNull();
    expect(opportunityOf(oppReading(40, 300, 31 * MIN))).not.toBeNull();
  });

  it('never fires on a hot window, however far behind', () => {
    // 94% elapsed on a weekly, 8 pts behind — but ≥85% used is the alarm's
    expect(opportunityOf(oppReading(86, 10_080, 600 * MIN))).toBeNull();
  });

  it('escalates to closing inside a quarter window even under the 30-pt floor', () => {
    // floor 20, reset at 20% of the window
    const r = oppReading(60, 300, 60 * MIN);
    expect(opportunityOf(r)).toMatchObject({ tier: 'closing', floorPts: 20 });
    // same floor, reset at 40% of the window: still open
    const open = oppReading(25, 300, 120 * MIN); // elapsed 60, floor 35 → closing by floor
    expect(opportunityOf(open)?.tier).toBe('closing');
    const trulyOpen = oppReading(43, 300, 126 * MIN); // elapsed 58, floor 15, reset 42%
    expect(opportunityOf(trulyOpen)).toMatchObject({ tier: 'open' });
  });
});

describe('opportunity vocabulary — the E9 metric swap', () => {
  it('the open tier re-words the pace caption as course-to-expire', () => {
    const { out } = fixtureReadings('mildly-behind');
    const weekly = out.get('codex-weekly')!;
    expect(paceSentence(weekly)).toBe('24% will expire unused at this pace');
    expect(paceLabel(weekly).text).toBe('62% free to spend');
  });

  it('the closing tier leads with free and the countdown', () => {
    const { out } = fixtureReadings('strongly-behind');
    const weekly = out.get('codex-weekly')!;
    expect(paceSentence(weekly)).toBe('72% free · expires in 9h');
    expect(paceLabel(weekly).text).toBe('72% free to spend');
    // never the alarm channel: the swapped label keeps the calm color
    expect(paceLabel(weekly).color).toBe(FLUX.calm);
  });

  it('a silent window keeps the plain pace verdict', () => {
    const { out } = fixtureReadings('mildly-behind');
    const fiveHour = out.get('codex-primary')!;
    expect(paceSentence(fiveHour)).toBe('behind even pace by 12 pts');
    expect(paceLabel(fiveHour).text).toBe('12 pts behind even pace');
  });

  it('the ledger caption states the closed cycle in one line', () => {
    expect(
      ledgerLine({ label: 'Weekly window', unusedPercent: 67, agoMs: 25 * MIN })
    ).toBe('Weekly window reset 25m ago · closed with 67% unused');
  });
});

describe('opportunity coach — hot always outranks', () => {
  const readingsOf = (id: string) => {
    const state = OPPORTUNITY_STATES.find(s => s.id === id)!;
    return state.sources.flatMap(s => readAllWindows(s, state.nowMs));
  };

  it('speaks one closing line when no alarm is live', () => {
    const coach = opportunityCoach(readingsOf('strongly-behind'));
    expect(coach).toBe(
      'Weekly window resets in 9h with 72% free — front-load the heavy runs.'
    );
  });

  it('stays silent at the open tier', () => {
    expect(opportunityCoach(readingsOf('mildly-behind'))).toBeNull();
  });

  it('dual signal: the hot window silences the coach while the row still swaps', () => {
    const readings = readingsOf('dual-signal');
    // the alarm owns the coach slot outright…
    expect(opportunityCoach(readings)).toBeNull();
    // …but the closing opportunity is still there, subordinate
    expect(closingOpportunity(readings)).not.toBeNull();
  });

  it('an exhausted window silences the coach the same way', () => {
    const spent = oppReading(100, 300, 60 * MIN);
    const behind = fixtureReadings('strongly-behind').out.get('codex-weekly')!;
    expect(opportunityCoach([spent, behind])).toBeNull();
  });
});
