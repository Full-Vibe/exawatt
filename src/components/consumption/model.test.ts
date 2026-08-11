import { describe, expect, it } from 'vitest';
import { SOURCE_CAPABILITIES } from '@exawatt/core';
import {
  delegatedWeighted,
  displayUsage,
  interventionStats,
  rawTotal,
  windowFreshness,
  type CapacityWindowView,
  type InterventionRow,
} from './model';
import { demoConsumption, DEMO_NOW_MS, DEMO_SESSIONS } from './demo-source';

const HOUR = 3_600_000;

describe('displayUsage', () => {
  it('splits reasoning out of output instead of adding it again', () => {
    const usage = displayUsage(
      {
        inputTokens: 100,
        cacheReadTokens: 1_000,
        cacheWriteTokens: 200,
        outputTokens: 500,
        reasoningTokens: 300,
        webSearches: 0,
        webFetches: 0,
      },
      ['codex']
    );
    expect(usage.output).toBe(200);
    expect(usage.reasoning).toBe(300);
    // segments are disjoint, so the raw total equals the source's own total
    expect(rawTotal(usage)).toBe(1_800);
  });

  it('reports reasoning as unavailable, not zero, for a source that cannot', () => {
    expect(SOURCE_CAPABILITIES['claude-code'].reasoningTokens).toBe(false);
    const usage = displayUsage(
      {
        inputTokens: 10,
        cacheReadTokens: 20,
        cacheWriteTokens: 30,
        outputTokens: 40,
        reasoningTokens: 0,
        webSearches: 0,
        webFetches: 0,
      },
      ['claude-code']
    );
    expect(usage.reasoning).toBeNull();
  });
});

describe('windowFreshness', () => {
  const base: CapacityWindowView = {
    limitId: 'primary',
    label: '5-hour window',
    usedPercent: 40,
    windowMinutes: 300,
    resetsAtMs: DEMO_NOW_MS + HOUR,
    burnPercentPerHour: 4,
    observedAtMs: DEMO_NOW_MS - 60_000,
  };

  it('is live inside the window it describes', () => {
    expect(windowFreshness(base, DEMO_NOW_MS)).toBe('live');
  });

  it('expires once its own reset instant has passed', () => {
    expect(windowFreshness(base, DEMO_NOW_MS + 2 * HOUR)).toBe('expired');
  });

  it('goes stale when the reading is older than the window', () => {
    const old = { ...base, observedAtMs: DEMO_NOW_MS - 6 * HOUR };
    expect(windowFreshness(old, DEMO_NOW_MS)).toBe('stale');
  });
});

/**
 * The demo corpus is a design artifact, and a demo that drifts away from the
 * measured corpus quietly teaches a demo audience the wrong shape. These
 * assertions pin the properties `consumption-spine.md` actually measured.
 */
describe('demo corpus stays plausible against the real corpus', () => {
  const demo = demoConsumption();

  it('is dominated by cache reads, by an order of magnitude', () => {
    const totals = demo.workspace.totals;
    expect(totals.cacheReadTokens / totals.inputTokens).toBeGreaterThan(10);
  });

  it('keeps delegated runs a material share of Claude Code burn', () => {
    // Read the same normalized figures the surface renders, so this pins the
    // number a viewer sees rather than a parallel approximation of it.
    let weighted = 0;
    let delegated = 0;
    for (const spec of DEMO_SESSIONS) {
      if (spec.source !== 'claude-code') continue;
      const rollup = demo.sessionsById.get(spec.id);
      if (!rollup) continue;
      weighted += rollup.weightedTokens;
      delegated += rollup.delegated.weightedTokens;
    }
    const share = delegated / weighted;
    // measured on the operator's corpus: 23.7% of normalized Claude tokens
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.3);
  });

  it('never claims a delegated split for a source that cannot record one', () => {
    const codexSessions = demo.roadmap
      .flatMap(r => r.sessions)
      .filter(s => s.spec.source === 'codex');
    expect(codexSessions.length).toBeGreaterThan(0);
    for (const s of codexSessions) {
      expect(delegatedWeighted(s.rollup)).toBeNull();
    }
  });

  it('reports plan windows for Codex and none at all for Claude Code', () => {
    const codex = demo.sources.find(s => s.harness === 'codex')!;
    const claude = demo.sources.find(s => s.harness === 'claude-code')!;
    expect(codex.windows.length).toBeGreaterThan(0);
    expect(claude.windows).toHaveLength(0);
    expect(claude.planType).toBeNull();
    expect(claude.unreportedReason).toBeTruthy();
  });

  it('separates Exawatt’s own harness calls from the operator workspace', () => {
    expect(demo.overhead.sessionCount).toBeGreaterThan(0);
    // many session ids, almost no tokens — the shape measured on the corpus
    expect(demo.overhead.sessionCount).toBeGreaterThan(
      demo.workspace.sessionCount
    );
    const overheadRaw = rawTotal(
      displayUsage(demo.overhead.rollup!.totals, demo.overhead.rollup!.sources)
    );
    const workspaceRaw = rawTotal(
      displayUsage(demo.workspace.totals, demo.workspace.sources)
    );
    expect(overheadRaw / workspaceRaw).toBeLessThan(0.05);
    // and no machine-invoked sample leaks into the operator rollup
    for (const project of demo.projects) {
      if (!project.rollup) continue;
      expect(project.rollup.samples).toBeLessThanOrEqual(demo.workspace.samples);
    }
  });

  it('leaves a real share of burn attributed to no roadmap item', () => {
    const total =
      demo.declaredWeighted + demo.inferredWeighted + demo.unattributedWeighted;
    const attributed =
      (demo.declaredWeighted + demo.inferredWeighted) / total;
    // a coverage figure that never dips is a coverage figure nobody checks
    expect(attributed).toBeLessThan(0.95);
    expect(attributed).toBeGreaterThan(0.6);
  });

  it('refuses to place a session launched outside every known Project root', () => {
    expect(demo.unresolvedSessions.length).toBeGreaterThan(0);
    for (const s of demo.unresolvedSessions) {
      expect(s.spec.projectKey).toBeNull();
    }
  });
});

describe('intervention rate (ENG-026 N2)', () => {
  it('computes the three cuts and the untouched share', () => {
    const rows: InterventionRow[] = [
      {
        sessionId: 'a',
        title: 'a',
        harness: 'claude-code',
        interventions: 3,
        activeMs: 2 * HOUR,
        rawTokens: 400_000,
      },
      {
        sessionId: 'b',
        title: 'b',
        harness: 'codex',
        interventions: 0,
        activeMs: 2 * HOUR,
        rawTokens: 100_000,
      },
    ];
    const stats = interventionStats(rows);
    expect(stats.sessions).toBe(2);
    expect(stats.interventions).toBe(3);
    expect(stats.perSession).toBeCloseTo(1.5);
    expect(stats.perActiveHour).toBeCloseTo(0.75);
    expect(stats.per100kTokens).toBeCloseTo(0.6);
    expect(stats.tokensPerIntervention).toBeCloseTo(500_000 / 3);
    expect(stats.untouchedSessions).toBe(1);
    expect(stats.untouchedShare).toBeCloseTo(0.5);
  });

  it('a scope with no interventions reports zero rates and an infinite tokens-per-touch, never NaN', () => {
    const stats = interventionStats([
      {
        sessionId: 'a',
        title: 'a',
        harness: 'codex',
        interventions: 0,
        activeMs: HOUR,
        rawTokens: 50_000,
      },
    ]);
    expect(stats.perSession).toBe(0);
    expect(stats.perActiveHour).toBe(0);
    expect(stats.per100kTokens).toBe(0);
    expect(stats.tokensPerIntervention).toBe(Infinity);
    expect(stats.untouchedShare).toBe(1);
  });

  const demo = demoConsumption();

  it('covers every operator Session and excludes machine-invoked overhead', () => {
    // one row per authored operator Session — the 38 summarizer calls have no
    // operator to intervene and must not flatter the rate
    expect(demo.interventions.rows.length).toBe(DEMO_SESSIONS.length);
    // authored specs always state a number (null is the live-identity case)
    const total = DEMO_SESSIONS.reduce((n, s) => n + (s.interventions ?? 0), 0);
    expect(demo.interventions.total.interventions).toBe(total);
  });

  it('keeps some Sessions genuinely untouched — the honest autonomy figure', () => {
    expect(demo.interventions.total.untouchedSessions).toBeGreaterThan(0);
    expect(demo.interventions.total.untouchedSessions).toBeLessThan(
      demo.interventions.total.sessions
    );
  });

  it('splits by harness without losing anything', () => {
    const { bySource, total } = demo.interventions;
    expect(
      bySource['claude-code'].sessions + bySource.codex.sessions
    ).toBe(total.sessions);
    expect(
      bySource['claude-code'].interventions + bySource.codex.interventions
    ).toBe(total.interventions);
  });

  it("counts a Session's delegated children in its token denominator", () => {
    const delegating = DEMO_SESSIONS.find(s => s.delegated.length > 0)!;
    const row = demo.interventions.rows.find(
      r => r.sessionId === delegating.id
    )!;
    const own =
      delegating.usage.input +
      delegating.usage.cacheRead +
      delegating.usage.cacheWrite +
      delegating.usage.output;
    expect(row.rawTokens).toBeGreaterThan(own);
  });
});
