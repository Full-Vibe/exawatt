import { describe, expect, it } from 'vitest';
import {
  gapPhrase,
  healthLine,
  planLabel,
  resetPhrase,
  usageOverview,
  whenPhrase,
  type UsageOverview,
} from './accounts';
import {
  SCENARIO_NOW_MS,
  SCENARIO_TIME_ZONE,
  USAGE_SCENARIOS,
  advanceScenario,
  scenarioOverview,
  usageScenario,
  type UsageScenario,
} from './usage-scenarios';

const HOUR = 3_600_000;
const tz = { timeZone: SCENARIO_TIME_ZONE };

const account = (o: UsageOverview, key: string) => o.accounts.find(a => a.key === key);

/** A scenario with one account's read failing, its figures untouched. */
function withFailedRead(s: UsageScenario, source: string): UsageScenario {
  return {
    ...s,
    accounts: s.accounts.map(a =>
      a.source === source ? { ...a, status: 'unavailable' as const } : a
    ),
  };
}

describe('every scenario, through the production path', () => {
  for (const scenario of USAGE_SCENARIOS) {
    describe(scenario.id, () => {
      const o = scenarioOverview(scenario);

      it('names a headline whenever a live meter runs out, and never otherwise', () => {
        const alarming = o.accounts.some(a =>
          a.meters.some(
            m => m.live && (m.forecast?.kind === 'runs-out' || m.forecast?.kind === 'spent')
          )
        );
        if (alarming) expect(o.headline?.tone).toBe('hot');
        else expect(o.headline?.tone ?? 'calm').toBe('calm');
      });

      it('binds the chrome meter to a live meter of a listed account', () => {
        if (!o.binding) return;
        expect(o.binding.meter.live).toBe(true);
        expect(account(o, o.binding.accountKey)).toBeDefined();
      });

      it('keeps every label free of em dashes (operator copy rule)', () => {
        for (const a of o.accounts) {
          for (const text of [a.name, a.plan ?? '', ...a.meters.map(m => m.label)]) {
            expect(text).not.toContain('—');
          }
        }
        expect(o.headline?.text ?? '').not.toContain('—');
      });
    });
  }
});

describe('what runs out first, when, and before which reset', () => {
  it('headlines Codex running out tomorrow morning, days before its reset', () => {
    const o = scenarioOverview(usageScenario('runs-out-before-reset'));
    expect(o.headline).toMatchObject({ tone: 'hot', accountKey: 'codex', meterKey: expect.stringContaining('codex') });
    const week = account(o, 'codex')!.meters[0];
    expect(week.forecast?.kind).toBe('runs-out');
    const at = week.forecast?.kind === "runs-out" ? week.forecast.atMs : 0;
    // 78% used, 1.635%/h, read four minutes ago: about thirteen hours left.
    expect((at - SCENARIO_NOW_MS) / HOUR).toBeGreaterThan(12.5);
    expect((at - SCENARIO_NOW_MS) / HOUR).toBeLessThan(14);
    expect(at).toBeLessThan(week.resetsAtMs);
  });

  it('moves the headline to Claude once a banked reset restarts the Codex week', () => {
    const o = scenarioOverview(usageScenario('after-a-reset'));
    expect(o.headline?.accountKey).toBe('claude-code');
    expect(account(o, 'codex')!.resets?.available).toBe(3);
  });

  it('a spent window outranks one that is merely on course to run out', () => {
    const o = scenarioOverview(usageScenario('limit-reached'));
    expect(o.binding?.accountKey).toBe('claude-code');
    expect(o.binding?.meter.forecast?.kind).toBe('spent');
    expect(o.headline?.tone).toBe('hot');
  });

  it('says a banked reset is about to lapse when nothing runs out', () => {
    const o = scenarioOverview(usageScenario('comfortable'));
    expect(o.headline).toMatchObject({ tone: 'calm', accountKey: 'codex', meterKey: null });
  });

  it('says nothing above the cards when there is nothing to say', () => {
    expect(scenarioOverview(usageScenario('first-run')).headline).toBeNull();
    expect(scenarioOverview(usageScenario('first-run')).accounts).toEqual([]);
  });
});

describe('absence and failure stay visible', () => {
  it('shows a Claude card that says why it cannot be read, with its local tokens', () => {
    const claude = account(scenarioOverview(usageScenario('claude-not-readable')), 'claude-code')!;
    expect(claude.health).toBe('unreadable');
    expect(claude.failure).toBe('no-plan');
    expect(claude.meters).toEqual([]);
    expect(claude.observedTokens).toBeGreaterThan(0);
  });

  it('says which thing went wrong, one sentence per cause, with no figure invented', () => {
    const causes = ['not-installed', 'no-plan', 'timed-out', 'exited', 'unrecognized'] as const;
    const lines = causes.map(failure => {
      const s = usageScenario('claude-not-readable');
      const read: UsageScenario = {
        ...s,
        accounts: s.accounts.map(a => (a.source === 'claude-code' ? { ...a, failure } : a)),
      };
      const claude = account(scenarioOverview(read), 'claude-code')!;
      expect(claude.failure).toBe(failure);
      expect(claude.meters).toEqual([]);
      return healthLine(claude, SCENARIO_NOW_MS)!;
    });
    // Every cause reads as "couldn't read" plus its own reason.
    for (const line of lines) expect(line).toMatch(/^Couldn't read plan limits\./u);
    expect(new Set(lines).size).toBe(causes.length);
    // A read that fails for a reason the source cannot name still says so.
    const unnamed = account(
      scenarioOverview(withFailedRead(usageScenario('claude-read-failing'), 'claude-code')),
      'claude-code'
    )!;
    expect(healthLine({ ...unnamed, failure: null }, SCENARIO_NOW_MS)).toBe(
      'Not read recently. Figures are from the last read.'
    );
  });

  it('keeps a failing read on screen at its true age', () => {
    const s = usageScenario('claude-read-failing');
    const claude = account(scenarioOverview(s), 'claude-code')!;
    expect(claude.health).toBe('stale');
    expect(claude.asOfMs).toBe(SCENARIO_NOW_MS - 26 * HOUR);
    // The session that read described has reset since; only the week remains.
    expect(claude.meters.map(m => m.label)).not.toContain('Current session');
    expect(claude.meters.map(m => m.label)).toContain('This week');
  });

  it('counts a source with no plan limits instead of drawing a bar', () => {
    const grok = account(scenarioOverview(usageScenario('unmetered-source')), 'grok')!;
    expect(grok.health).toBe('unmetered');
    expect(grok.meters).toEqual([]);
    expect(grok.observedTokens).toBe(48_200_000);
  });

  it('hides a harness nobody used and nothing can read', () => {
    const o = scenarioOverview(usageScenario('runs-out-before-reset'));
    expect(account(o, 'grok')).toBeUndefined();
  });

  it('reports absent resets as unknown, never as none', () => {
    const o = scenarioOverview(usageScenario('runs-out-before-reset'));
    expect(account(o, 'claude-code')!.resets).toBeNull();
    const none = scenarioOverview(usageScenario('limit-reached'));
    expect(account(none, 'codex')!.resets).toEqual({ available: 0, next: null });
  });
});

describe('losing a read never makes the page calmer', () => {
  for (const scenario of USAGE_SCENARIOS) {
    for (const source of ['claude-code', 'codex'] as const) {
      it(`${scenario.id}: failing the ${source} read keeps the headline`, () => {
        const before = scenarioOverview(scenario).headline;
        const after = scenarioOverview(withFailedRead(scenario, source)).headline;
        if (before?.tone === 'hot') {
          expect(after?.tone).toBe('hot');
          expect(after?.accountKey).toBe(before.accountKey);
        }
      });
    }
  }
});

describe('the simulator', () => {
  const base = usageScenario('runs-out-before-reset');

  it('burns forward at the observed rate', () => {
    const later = advanceScenario(base, 10);
    const codex = later.planWindows.find(w => w.source === 'codex')!;
    expect(codex.usedPercent).toBeCloseTo(78 + 1.635 * (10 + 4 / 60), 0);
    expect(Date.parse(codex.observedAt)).toBe(SCENARIO_NOW_MS + 10 * HOUR);
  });

  it('rolls a window over at its reset and restarts it from zero', () => {
    const later = advanceScenario(base, 2);
    const session = later.planWindows.find(w => w.limitId === 'claude-session')!;
    expect(session.usedPercent).toBeLessThan(11);
    expect(Date.parse(session.resetsAt!)).toBeGreaterThan(SCENARIO_NOW_MS + 2 * HOUR);
  });

  it('caps a window at its limit and lets banked resets lapse at expiry', () => {
    const later = scenarioOverview(advanceScenario(base, 130));
    expect(account(later, 'codex')!.resets?.available).toBe(2);
    expect(scenarioOverview(advanceScenario(base, 24)).binding?.meter.forecast?.kind).toBe('spent');
  });

  it('scales the burn with the multiplier', () => {
    const doubled = advanceScenario(base, 1, 2);
    const single = advanceScenario(base, 1, 1);
    const used = (s: UsageScenario) => s.planWindows.find(w => w.limitId === 'claude-weekly-all')!.usedPercent;
    expect(used(doubled) - 44).toBeCloseTo(2 * (used(single) - 44), 0);
  });

  it('gives a failing read no new reading', () => {
    const failing = usageScenario('claude-read-failing');
    const later = advanceScenario(failing, 5);
    expect(later.planWindows.filter(w => w.source === 'claude-code')).toEqual(
      failing.planWindows.filter(w => w.source === 'claude-code')
    );
  });
});

describe('wall-clock phrasing, in the operator zone', () => {
  // Tuesday 6:40 PM in Los Angeles.
  const now = SCENARIO_NOW_MS;

  it('names today, tonight, tomorrow and a weekday by the local calendar', () => {
    expect(whenPhrase(now + 40 * 60_000, now, tz)).toBe('in 40 min');
    expect(whenPhrase(now + 4 * HOUR, now, tz)).toBe('tonight around 11 PM');
    expect(whenPhrase(now + 13.3 * HOUR, now, tz)).toBe('tomorrow around 8 AM');
    expect(whenPhrase(now + 52 * HOUR, now, tz)).toBe('Thursday around 11 PM');
    expect(whenPhrase(now + 52 * HOUR, now, tz, true, true)).toBe('Thu around 11 PM');
  });

  it('states a reset instant exactly', () => {
    expect(resetPhrase(now + 30 * 60_000, now, tz)).toBe('7:10 PM');
    expect(resetPhrase(Date.parse('2026-10-05T09:00:00.000Z'), now, tz)).toBe('Mon 2:00 AM');
  });

  it('rounds a span the way a person says it', () => {
    expect(gapPhrase(40 * 60_000)).toBe('40 min');
    expect(gapPhrase(5 * HOUR)).toBe('5 hours');
    expect(gapPhrase(24 * HOUR * 1.1)).toBe('26 hours');
    expect(gapPhrase(24 * HOUR * 4.4)).toBe('4½ days');
    expect(gapPhrase(24 * HOUR * 2)).toBe('2 days');
  });
});

describe('planLabel', () => {
  it('reads the tier from the vendor tier id', () => {
    expect(planLabel('max', 'default_claude_max_20x')).toBe('Max 20x');
    expect(planLabel('pro', null)).toBe('Pro');
    expect(planLabel('self_serve_business_usage_based', null)).toBe(
      'Self Serve Business Usage Based'
    );
    expect(planLabel(null, 'default_claude_max_5x')).toBeNull();
  });
});

describe('usageOverview input', () => {
  it('orders accounts by the source registry, not by arrival', () => {
    const o = scenarioOverview(usageScenario('unmetered-source'));
    expect(o.accounts.map(a => a.key)).toEqual(['claude-code', 'codex', 'grok']);
  });

  it('is a pure function of its input', () => {
    const view = { nowMs: SCENARIO_NOW_MS, windowLabel: 'seven days', sources: [], samples: [] };
    expect(usageOverview(view)).toEqual(usageOverview(view));
  });
});
