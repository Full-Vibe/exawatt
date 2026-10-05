import { describe, expect, it } from 'vitest';
import {
  dueUsageAlerts,
  forecastPlanWindow,
  liveUsageAlertKeys,
  observedAverageRate,
  planGapPhrase,
  planMeterLabel,
  planResetPhrase,
  planWhenPhrase,
  type PlanWindow,
} from '../consumption';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Tuesday 29 September 2026, 6:40 PM in Los Angeles. */
const NOW = Date.parse('2026-09-30T01:40:00.000Z');
const tz = { timeZone: 'America/Los_Angeles' };

describe('forecastPlanWindow', () => {
  const week = (usedPercent: number, ratePerHour: number, resetsInHours = 120) => ({
    usedPercent,
    windowMinutes: 10_080,
    resetsAtMs: NOW + resetsInHours * HOUR,
    ratePerHour,
  });

  it('says a window runs out before its reset, and when', () => {
    const f = forecastPlanWindow(week(78, 2), NOW);
    expect(f.outlook).toEqual({ kind: 'runs-out', atMs: NOW + 11 * HOUR });
    expect(f.exhaustsBeforeReset).toBe(true);
  });

  it('states the unused share only when it is worth saying', () => {
    expect(forecastPlanWindow(week(40, 0.1), NOW).outlook).toEqual({
      kind: 'left-at-reset',
      percent: 48,
    });
    expect(forecastPlanWindow(week(40, 0.45), NOW).outlook).toEqual({ kind: 'lasts' });
  });

  it('is spent at the limit, and silent while the window is too young', () => {
    expect(forecastPlanWindow(week(100, 0), NOW).outlook).toEqual({ kind: 'spent' });
    // 168h window with 167h left: under 3% elapsed.
    expect(forecastPlanWindow(week(2, 5, 167), NOW).outlook).toBeNull();
  });

  it('places even pace by elapsed time', () => {
    expect(forecastPlanWindow(week(50, 1, 84), NOW).evenPacePercent).toBeCloseTo(50, 5);
  });
});

describe('observedAverageRate', () => {
  it('is the used share over the elapsed time, never a fabricated zero', () => {
    const window = planWindow({ usedPercent: 24, resetsAt: iso(NOW + 144 * HOUR) });
    // 24 hours into a week at 24%: one point an hour.
    expect(observedAverageRate(window)).toBeCloseTo(1, 1);
  });
});

describe('planMeterLabel', () => {
  it('reads each window length the way the vendors do', () => {
    expect(planMeterLabel(300, null)).toBe('Current session');
    expect(planMeterLabel(10_080, null)).toBe('This week');
    expect(planMeterLabel(10_080, 'Fable')).toBe('Fable this week');
    expect(planMeterLabel(43_200, null)).toBe('This month');
  });
});

describe('wall-clock phrasing, in the operator zone', () => {
  it('names today, tonight, tomorrow and a weekday by the local calendar', () => {
    expect(planWhenPhrase(NOW + 40 * MIN, NOW, tz)).toBe('in 40 min');
    expect(planWhenPhrase(NOW + 4 * HOUR, NOW, tz)).toBe('tonight around 11 PM');
    expect(planWhenPhrase(NOW + 13.3 * HOUR, NOW, tz)).toBe('tomorrow around 8 AM');
    expect(planWhenPhrase(NOW + 52 * HOUR, NOW, tz)).toBe('Thursday around 11 PM');
    expect(planWhenPhrase(NOW + 52 * HOUR, NOW, tz, true, true)).toBe('Thu around 11 PM');
  });

  it('states a reset instant exactly', () => {
    expect(planResetPhrase(NOW + 30 * MIN, NOW, tz)).toBe('7:10 PM');
    expect(planResetPhrase(Date.parse('2026-10-05T09:00:00.000Z'), NOW, tz)).toBe('Mon 2:00 AM');
  });

  it('rounds a span the way a person says it', () => {
    expect(planGapPhrase(40 * MIN)).toBe('40 min');
    expect(planGapPhrase(5 * HOUR)).toBe('5 hours');
    expect(planGapPhrase(DAY * 4.4)).toBe('4½ days');
    expect(planGapPhrase(DAY * 2)).toBe('2 days');
  });
});

/* ------------------------------------------------------------------ */
/* usage alerts                                                        */
/* ------------------------------------------------------------------ */

const iso = (ms: number) => new Date(ms).toISOString();

function planWindow(over: Partial<PlanWindow> = {}): PlanWindow {
  return {
    source: 'codex',
    limitId: 'codex',
    limitName: null,
    scope: 'primary',
    usedPercent: 78,
    windowMinutes: 10_080,
    resetsAt: iso(NOW + 4 * DAY),
    planType: 'pro',
    observedAt: iso(NOW - 4 * MIN),
    providerSessionId: '',
    ...over,
  };
}

const KEY = 'codex|codex|primary|10080';

describe('dueUsageAlerts', () => {
  const lead = { leadMinutes: 60 };

  it('alerts once when a window first goes on course to run out', () => {
    const input = { planWindows: [planWindow()], windowRates: { [KEY]: 2 } };
    const [alert] = dueUsageAlerts(input, NOW, lead, new Set(), tz);
    expect(alert).toMatchObject({ source: 'codex', stage: 'on-course', title: 'Codex · This week' });
    expect(alert.body).toContain('tomorrow around');
    // Already sent: silent for the rest of the cycle.
    expect(dueUsageAlerts(input, NOW, lead, new Set(alert.keys), tz)).toEqual([]);
  });

  it('alerts again inside the lead time, and only once for both stages when first seen there', () => {
    const input = {
      planWindows: [planWindow({ usedPercent: 99 })],
      windowRates: { [KEY]: 2 },
    };
    const [late] = dueUsageAlerts(input, NOW, lead, new Set(), tz);
    expect(late.stage).toBe('soon');
    expect(late.keys).toHaveLength(2);
    expect(dueUsageAlerts(input, NOW, lead, new Set(late.keys), tz)).toEqual([]);
    // With the second alert switched off, the same window is only "on course".
    expect(dueUsageAlerts(input, NOW, { leadMinutes: null }, new Set(), tz)[0].stage).toBe(
      'on-course'
    );
  });

  it('says a spent window is out until its reset, naming free resets', () => {
    const input = {
      planWindows: [planWindow({ usedPercent: 100 })],
      windowRates: {},
      providerPlanAccounts: [
        {
          source: 'codex' as const,
          status: 'ok' as const,
          observedAt: iso(NOW),
          planType: 'pro',
          spend: null,
          resets: { available: 2, credits: null },
        },
      ],
    };
    const [alert] = dueUsageAlerts(input, NOW, lead, new Set(), tz);
    expect(alert.stage).toBe('spent');
    expect(alert.body).toContain('2 free resets');
  });

  it('never alerts from a stale or expired window, or one that lasts', () => {
    const stale = planWindow({ observedAt: iso(NOW - 8 * DAY) });
    const expired = planWindow({ resetsAt: iso(NOW - MIN), limitId: 'old' });
    const calm = planWindow({ usedPercent: 10, limitId: 'calm' });
    const input = {
      planWindows: [stale, expired, calm],
      windowRates: { [KEY]: 5, 'codex|calm|primary|10080': 0.1 },
    };
    expect(dueUsageAlerts(input, NOW, lead, new Set(), tz)).toEqual([]);
  });

  it('treats a reset a few seconds apart as the same cycle', () => {
    const first = planWindow({ resetsAt: '2026-10-05T01:57:06.000Z' });
    const jittered = planWindow({ resetsAt: '2026-10-05T01:57:08.000Z' });
    const [alert] = dueUsageAlerts(
      { planWindows: [first], windowRates: { [KEY]: 2 } },
      NOW,
      lead,
      new Set(),
      tz
    );
    expect(
      dueUsageAlerts({ planWindows: [jittered], windowRates: { [KEY]: 2 } }, NOW, lead, new Set(alert.keys), tz)
    ).toEqual([]);
  });

  it('reads the newest of two readings of one window', () => {
    const log = planWindow({ usedPercent: 78, observedAt: iso(NOW - 3 * HOUR) });
    const account = planWindow({ usedPercent: 10, observedAt: iso(NOW - MIN), origin: 'provider-account' });
    expect(
      dueUsageAlerts({ planWindows: [log, account], windowRates: { [KEY]: 0.5 } }, NOW, lead, new Set(), tz)
    ).toEqual([]);
    // The same pace on the older, fuller reading alone would run out.
    expect(
      dueUsageAlerts({ planWindows: [log], windowRates: { [KEY]: 0.5 } }, NOW, lead, new Set(), tz)
    ).toHaveLength(1);
  });
});

describe('liveUsageAlertKeys', () => {
  it('drops keys whose cycle has reset', () => {
    const keys = [`${KEY}@${NOW + DAY}#on-course`, `${KEY}@${NOW - DAY}#on-course`];
    expect(liveUsageAlertKeys(keys, NOW)).toEqual([keys[0]]);
  });
});
