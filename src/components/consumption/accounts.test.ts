import { describe, expect, it } from 'vitest';
import {
  localLogAssurance,
  resolveModelWeight,
  weightUsage,
  type ConsumptionSample,
  type ConsumptionSourceId,
} from '@exawatt/core';
import {
  BURN_WINDOW_LABEL,
  BURN_WINDOW_MS,
  forecastLine,
  healthLine,
  planLabel,
  usageOverview,
  type UsageOverview,
} from './accounts';
import { buildLiveConsumption } from './live-source';
import { modelledDollars } from './units';
import {
  SCENARIO_NOW_MS,
  USAGE_SCENARIOS,
  advanceScenario,
  scenarioOverview,
  usageScenario,
  type UsageScenario,
} from './usage-scenarios';

const HOUR = 3_600_000;

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
      });
    });
  }
});

describe('what runs out, when, and before which reset', () => {
  it('forecasts Codex running out tomorrow morning, days before its reset', () => {
    const o = scenarioOverview(usageScenario('runs-out-before-reset'));
    const week = account(o, 'codex')!.meters[0];
    expect(week.forecast?.kind).toBe('runs-out');
    const at = week.forecast?.kind === 'runs-out' ? week.forecast.atMs : 0;
    // 78% used at 1.635%/h, projected from now: about thirteen hours left.
    expect((at - SCENARIO_NOW_MS) / HOUR).toBeGreaterThan(12.5);
    expect((at - SCENARIO_NOW_MS) / HOUR).toBeLessThan(14);
    expect(at).toBeLessThan(week.resetsAtMs);
    expect(o.binding?.accountKey).toBe('codex');
  });

  it('binds the glyph to Claude once a banked reset restarts the Codex week', () => {
    const o = scenarioOverview(usageScenario('after-a-reset'));
    expect(o.binding?.accountKey).toBe('claude-code');
    expect(account(o, 'codex')!.resets?.available).toBe(3);
  });

  it('a spent window outranks one that is merely on course to run out', () => {
    const o = scenarioOverview(usageScenario('limit-reached'));
    expect(o.binding?.accountKey).toBe('claude-code');
    expect(o.binding?.meter.forecast?.kind).toBe('spent');
  });

  it('shows no account before any Agent runs', () => {
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
    expect(account(none, 'codex')!.resets).toEqual({ available: 0, canUse: false, next: null });
  });
});

describe('losing a read never makes a card calmer', () => {
  const alarms = (o: UsageOverview) =>
    o.accounts.flatMap(a =>
      a.meters
        .filter(m => m.forecast?.kind === 'runs-out' || m.forecast?.kind === 'spent')
        .map(m => `${a.key}|${m.key}`)
    );
  for (const scenario of USAGE_SCENARIOS) {
    for (const source of ['claude-code', 'codex', 'antigravity'] as const) {
      it(`${scenario.id}: failing the ${source} read keeps every run-out forecast`, () => {
        const before = alarms(scenarioOverview(scenario));
        const after = alarms(scenarioOverview(withFailedRead(scenario, source)));
        for (const alarm of before) expect(after).toContain(alarm);
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


describe('a Codex card is stale only when its figures are the failed read', () => {
  const base = usageScenario('runs-out-before-reset');
  const withCodexRead = (observedAt: string | null): UsageScenario => ({
    ...base,
    accounts: base.accounts.map(a =>
      a.source === 'codex' ? { ...a, status: 'unavailable' as const, observedAt } : a
    ),
  });

  it('reports fresh log windows when the account read never succeeded', () => {
    const codex = account(scenarioOverview(withCodexRead(null)), 'codex')!;
    expect(codex.health).toBe('reporting');
  });

  it('marks the card stale when nothing is fresher than the failed read', () => {
    const later = new Date(SCENARIO_NOW_MS).toISOString();
    const codex = account(scenarioOverview(withCodexRead(later)), 'codex')!;
    expect(codex.health).toBe('stale');
  });
});


/* ------------------------------------------------------------------ */
/* ENG-038 slice 4 — the Google account, read without a ledger          */
/* ------------------------------------------------------------------ */

describe('the Google account', () => {
  it('shows the spent Gemini group as out until its reset, and binds the glyph to it', () => {
    const o = scenarioOverview(usageScenario('google-limit-reached'));
    const google = account(o, 'antigravity')!;
    expect(google.name).toBe('Google');
    // `agy` states no plan tier: absent, never a guessed "Pro".
    expect(google.plan).toBeNull();
    // The shared meter order: same-length scoped limits read alphabetically.
    expect(google.meters.map(m => m.label)).toEqual([
      'Claude and GPT this week',
      'Gemini this week',
    ]);
    const gemini = google.meters.find(m => m.scope === 'Gemini')!;
    expect(gemini.forecast?.kind).toBe('spent');
    expect(forecastLine(gemini, SCENARIO_NOW_MS)).toBe('Out until reset');
    expect(o.binding?.accountKey).toBe('antigravity');
    expect(o.binding?.meter.key).toBe(gemini.key);
  });

  it('keeps a card whose read ran and failed, with the cause and no figure', () => {
    const google = account(scenarioOverview(usageScenario('google-not-readable')), 'antigravity')!;
    expect(google.health).toBe('unreadable');
    expect(google.failure).toBe('exited');
    expect(google.meters).toEqual([]);
    expect(google.observedTokens).toBe(0);
    expect(healthLine(google, SCENARIO_NOW_MS)).toBe(
      "Couldn't read plan limits. Antigravity stopped with an error."
    );
  });

  it('orders the account after the ledgered sources', () => {
    const o = scenarioOverview(usageScenario('google-limit-reached'));
    expect(o.accounts.map(a => a.key)).toEqual(['claude-code', 'codex', 'antigravity']);
  });

  it('has no burn entry: nothing local measures it, and unmeasured is not zero', () => {
    const o = scenarioOverview(usageScenario('runs-out-before-reset'));
    expect(account(o, 'antigravity')).toBeDefined();
    expect(o.burn.vendors.map(v => v.accountKey)).toEqual(['claude-code', 'codex']);
  });
});

/* ------------------------------------------------------------------ */
/* ENG-008 E16 — the burn line                                          */
/* ------------------------------------------------------------------ */

describe('the burn line', () => {
  const NOW = SCENARIO_NOW_MS;
  const MIN = 60_000;

  function sample(
    source: ConsumptionSourceId,
    atMs: number,
    model: string | null,
    inputTokens: number,
    outputTokens = 0
  ): ConsumptionSample {
    return {
      at: new Date(atMs).toISOString(),
      source,
      model,
      effort: null,
      providerSessionId: `${source}-session`,
      cwd: null,
      gitBranch: null,
      usage: {
        inputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens,
        reasoningTokens: 0,
        webSearches: 0,
        webFetches: 0,
      },
      assurance: localLogAssurance(source),
      idempotencyKey: `${source}:${atMs}:${inputTokens}`,
      contextWindow: null,
      sourceFile: null,
      delegation: null,
      entrypoint: 'cli',
    };
  }

  /** The production path: the scenario's accounts over these samples. */
  function overviewOver(samples: ConsumptionSample[]): UsageOverview {
    const scenario = usageScenario('runs-out-before-reset');
    return usageOverview(
      buildLiveConsumption({
        nowMs: NOW,
        samples,
        planWindows: scenario.planWindows,
        windowRates: scenario.windowRates,
        identities: [],
        projects: [],
        providerPlanAccounts: scenario.accounts,
      })
    );
  }

  it('states its window on the overview', () => {
    const o = overviewOver([]);
    expect(o.burn.windowMs).toBe(BURN_WINDOW_MS);
    expect(o.burn.windowLabel).toBe(BURN_WINDOW_LABEL);
    expect(BURN_WINDOW_MS).toBe(10 * MIN);
  });

  it('reads tokens per minute and modelled dollars per hour per vendor from the trailing window', () => {
    const claudeModel = 'claude-fable-5-1';
    const o = overviewOver([
      // Inside the window: three Claude turns and one Codex turn.
      sample('claude-code', NOW - 1 * MIN, claudeModel, 400_000),
      sample('claude-code', NOW - 5 * MIN, claudeModel, 300_000, 10_000),
      sample('claude-code', NOW - 9 * MIN - 59_000, claudeModel, 290_000),
      sample('codex', NOW - 2 * MIN, 'gpt-5.3-codex', 120_000),
      // On the window's edge and beyond it: not "now".
      sample('claude-code', NOW - BURN_WINDOW_MS, claudeModel, 5_000_000),
      sample('codex', NOW - 11 * MIN, 'gpt-5.3-codex', 5_000_000),
    ]);
    const claude = o.burn.vendors.find(v => v.accountKey === 'claude-code')!;
    const codex = o.burn.vendors.find(v => v.accountKey === 'codex')!;
    // 1,000,000 raw tokens over ten minutes.
    expect(claude.tokensPerMinute).toBe(100_000);
    expect(codex.tokensPerMinute).toBe(12_000);
    // Dollars are the stated model over the same weighted tokens, per hour.
    const weight = resolveModelWeight(claudeModel).weight;
    const weighted =
      weightUsage(sample('claude-code', NOW, claudeModel, 400_000).usage, weight) +
      weightUsage(sample('claude-code', NOW, claudeModel, 300_000, 10_000).usage, weight) +
      weightUsage(sample('claude-code', NOW, claudeModel, 290_000).usage, weight);
    expect(claude.dollarsPerHour).toBeCloseTo(modelledDollars(weighted) * 6, 6);
    expect(claude.dollarsPerHour).toBeGreaterThan(0);
  });

  it('is a projection of its vendors, never a second total', () => {
    const o = overviewOver([
      sample('claude-code', NOW - 1 * MIN, null, 600_000),
      sample('codex', NOW - 1 * MIN, null, 60_000),
      // Grok's burn earns it a card, and so an entry: the line lists exactly
      // the ledgered accounts below it, in their order.
      sample('grok', NOW - 1 * MIN, null, 7_000_000),
    ]);
    const vendors = o.burn.vendors;
    expect(vendors.map(v => v.accountKey)).toEqual(
      o.accounts.filter(a => a.harness !== 'antigravity').map(a => a.key)
    );
    expect(vendors.map(v => v.accountKey)).toEqual(['claude-code', 'codex', 'grok']);
    expect(o.burn.tokensPerMinute).toBeCloseTo(
      vendors.reduce((n, v) => n + v.tokensPerMinute, 0),
      9
    );
    expect(o.burn.dollarsPerHour).toBeCloseTo(
      vendors.reduce((n, v) => n + v.dollarsPerHour, 0),
      9
    );
    expect(o.burn.tokens).toBe(7_660_000);
  });

  it('reads a true zero when nothing has run in the window', () => {
    const o = overviewOver([sample('claude-code', NOW - 3 * 60 * MIN, null, 9_000_000)]);
    expect(o.burn.tokens).toBe(0);
    expect(o.burn.tokensPerMinute).toBe(0);
    expect(o.burn.dollarsPerHour).toBe(0);
    for (const v of o.burn.vendors) {
      expect(v.tokensPerMinute).toBe(0);
      expect(v.dollarsPerHour).toBe(0);
    }
    // Still one entry per ledgered account: a zero is stated, not hidden.
    expect(o.burn.vendors.map(v => v.accountKey)).toEqual(['claude-code', 'codex']);
  });
});
