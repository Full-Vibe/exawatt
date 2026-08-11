/**
 * ENG-008 E5 — live view-model mapping. Everything here is the honest-path
 * contract: attribution rolls through the workspace's own registry
 * (worktree-aware), fleet identity joins without invention, absent stays
 * absent (interventions, plan records, out-of-registry directories), the
 * freshness discipline holds on live windows, and the meter and the page
 * read the SAME tightest window from the same built view.
 */
import { describe, expect, it } from 'vitest';
import {
  localLogAssurance,
  planWindowKey,
  type ConsumptionSample,
  type ConsumptionSourceId,
  type PlanWindow,
} from '@exawatt/core';
import { readMeter } from './meter/meter-model';
import { allPaces, diagnostics, gridRows } from '@/app/usage/derive';
import {
  CLAUDE_PLAN_NOTE,
  buildLiveConsumption,
  latestPlanWindows,
  liveProjectResolver,
  liveScanView,
  observedBurnRate,
  sourceBurnSpark,
  type LiveConsumptionInputs,
  type LiveSessionIdentity,
} from './live-source';

const NOW = Date.parse('2026-08-10T18:00:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();

const EXA = '/Users/op/Code/exawatt';
const SITE = '/Users/op/Code/site';

function sample(
  overrides: Partial<ConsumptionSample> & {
    providerSessionId: string;
    source: ConsumptionSourceId;
  }
): ConsumptionSample {
  return {
    at: iso(NOW - 2 * HOUR),
    model: overrides.source === 'codex' ? 'gpt-5.3-codex' : 'claude-opus-5',
    effort: null,
    cwd: EXA,
    gitBranch: null,
    usage: {
      inputTokens: 1_000,
      cacheReadTokens: 50_000,
      cacheWriteTokens: 5_000,
      outputTokens: 2_000,
      reasoningTokens: overrides.source === 'codex' ? 1_200 : 0,
      webSearches: 0,
      webFetches: 0,
    },
    assurance: localLogAssurance(overrides.source),
    idempotencyKey: `${overrides.providerSessionId}:${overrides.at ?? 'x'}:${Math.random()}`,
    contextWindow: overrides.source === 'codex' ? 272_000 : null,
    sourceFile: null,
    delegation: null,
    entrypoint: overrides.source === 'codex' ? 'codex-tui' : 'cli',
    ...overrides,
  };
}

function planWindow(
  overrides: Partial<PlanWindow> & { limitId: string }
): PlanWindow {
  return {
    source: 'codex',
    limitName: null,
    scope: 'primary',
    usedPercent: 60,
    windowMinutes: 300,
    resetsAt: iso(NOW + 90 * MIN),
    planType: 'pro',
    observedAt: iso(NOW - MIN),
    providerSessionId: 'codex-1',
    ...overrides,
  };
}

function identity(
  overrides: Partial<LiveSessionIdentity> & { providerSessionId: string }
): LiveSessionIdentity {
  return {
    source: 'codex',
    title: 'gateway reconnect backoff',
    projectDir: EXA,
    interventions: null,
    ...overrides,
  };
}

function inputs(over: Partial<LiveConsumptionInputs> = {}): LiveConsumptionInputs {
  return {
    nowMs: NOW,
    samples: [],
    planWindows: [],
    windowRates: {},
    identities: [],
    projects: [
      { dir: EXA, name: 'exawatt', color: '#19E6FF' },
      { dir: SITE, name: 'site' },
    ],
    ...over,
  };
}

describe('liveProjectResolver — cwd-keyed, worktree-aware (E2)', () => {
  const resolve = liveProjectResolver([
    { dir: EXA, name: 'exawatt' },
    { dir: SITE, name: 'site' },
  ]);

  it('matches the root, subdirectories, and sibling worktrees', () => {
    expect(resolve(EXA)?.label).toBe('exawatt');
    expect(resolve(`${EXA}/packages/core`)?.label).toBe('exawatt');
    // the agent-workflow convention: ../exawatt-e5-live beside the root
    expect(resolve('/Users/op/Code/exawatt-e5-live')?.label).toBe('exawatt');
  });

  it('never guesses: unknown directories resolve to null', () => {
    expect(resolve('/private/tmp/scratch')).toBeNull();
    // a sibling that does not follow the `<leaf>-` worktree convention
    expect(resolve('/Users/op/Code/exawattish')).toBeNull();
  });

  it('prefers the longest (most specific) root', () => {
    const nested = liveProjectResolver([
      { dir: '/repos/mono', name: 'mono' },
      { dir: '/repos/mono/apps/web', name: 'web' },
    ]);
    expect(nested('/repos/mono/apps/web/src')?.label).toBe('web');
    expect(nested('/repos/mono/packages/x')?.label).toBe('mono');
  });
});

describe('plan windows — latest observation, honest rates (E1/E3 seams)', () => {
  it('keeps only the latest observation per window bucket', () => {
    const old = planWindow({
      limitId: 'codex-weekly',
      usedPercent: 10,
      observedAt: iso(NOW - 90 * 24 * HOUR),
    });
    const current = planWindow({
      limitId: 'codex-weekly',
      usedPercent: 84,
      observedAt: iso(NOW - MIN),
    });
    const survivors = latestPlanWindows([old, current]);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].usedPercent).toBe(84);
  });

  it('never collapses two windows that share one limitId (primary + secondary)', () => {
    const fiveHour = planWindow({
      limitId: 'codex',
      scope: 'primary',
      windowMinutes: 300,
    });
    const weekly = planWindow({
      limitId: 'codex',
      scope: 'secondary',
      windowMinutes: 10_080,
      resetsAt: iso(NOW + 2 * 24 * HOUR),
    });
    expect(latestPlanWindows([fiveHour, weekly])).toHaveLength(2);
    // …and the view keys them uniquely, so React rows and the popover's
    // headline match can never conflate them
    const view = buildLiveConsumption(
      inputs({ planWindows: [fiveHour, weekly] })
    );
    const codex = view.sources.find(s => s.harness === 'codex')!;
    expect(new Set(codex.windows.map(w => w.limitId)).size).toBe(2);
  });

  it('derives the observed average rate from a single observation', () => {
    // 5h window observed 2.5h in (reset 2.5h away) at 50% → 20 %/h
    const w = planWindow({
      limitId: 'codex-primary',
      usedPercent: 50,
      windowMinutes: 300,
      resetsAt: iso(NOW + 150 * MIN),
      observedAt: iso(NOW),
    });
    expect(observedBurnRate(w)).toBeCloseTo(20, 5);
  });

  it("prefers main's trend-derived rate over the average fallback", () => {
    const w = planWindow({ limitId: 'codex-primary' });
    const view = buildLiveConsumption(
      inputs({
        planWindows: [w],
        // the contract keys rates by the full window bucket, never limitId
        windowRates: { [planWindowKey(w)]: 3.7 },
      })
    );
    const codex = view.sources.find(s => s.harness === 'codex')!;
    expect(codex.windows[0].burnPercentPerHour).toBeCloseTo(3.7, 5);
  });

  it('reports the plan’s own type, never an assumed tier', () => {
    const view = buildLiveConsumption(
      inputs({
        planWindows: [planWindow({ limitId: 'codex-primary', planType: 'plus' })],
      })
    );
    expect(view.sources.find(s => s.harness === 'codex')?.planType).toBe('plus');
  });
});

describe('the built view — attribution, identity, honest absence', () => {
  const primaryWindow = planWindow({ limitId: 'codex-primary', usedPercent: 68 });
  const weeklyWindow = planWindow({
    limitId: 'codex-weekly',
    usedPercent: 84,
    scope: 'secondary',
    windowMinutes: 10_080,
    resetsAt: iso(NOW + 2 * 24 * HOUR),
  });
  // a stale survivor: observation far older than the window it describes
  const ancientWindow = planWindow({
    limitId: 'codex-ancient',
    usedPercent: 97,
    windowMinutes: 300,
    resetsAt: iso(NOW + 4 * HOUR),
    observedAt: iso(NOW - 60 * 24 * HOUR),
  });
  const liveInputs = inputs({
    samples: [
      // identified codex session, run from a WORKTREE of exawatt
      sample({
        providerSessionId: 'codex-1',
        source: 'codex',
        cwd: '/Users/op/Code/exawatt-e5-live',
        at: iso(NOW - 3 * HOUR),
      }),
      sample({
        providerSessionId: 'codex-1',
        source: 'codex',
        cwd: '/Users/op/Code/exawatt-e5-live',
        at: iso(NOW - 2 * HOUR),
      }),
      // provider session OUTSIDE the fleet record, resolvable directory
      sample({
        providerSessionId: 'claude-orphan',
        source: 'claude-code',
        cwd: `${SITE}/app`,
        at: iso(NOW - 5 * HOUR),
      }),
      // Exawatt's own machine-invoked summarizer — separated, never folded in
      sample({
        providerSessionId: 'sdk-call-1',
        source: 'claude-code',
        entrypoint: 'sdk-cli',
        model: 'claude-haiku-5',
        at: iso(NOW - HOUR),
      }),
      // outside the seven-day window — must not appear anywhere
      sample({
        providerSessionId: 'ancient',
        source: 'codex',
        at: iso(NOW - 9 * 24 * HOUR),
      }),
    ],
    planWindows: [primaryWindow, weeklyWindow, ancientWindow],
    identities: [
      identity({ providerSessionId: 'codex-1', title: 'worktree bootstrap' }),
      // an index row whose session produced no samples in the window
      identity({ providerSessionId: 'codex-idle', title: 'idle session' }),
    ],
  });
  const view = buildLiveConsumption(liveInputs);

  it('rolls Session → Project → Workspace through the registry (E2)', () => {
    const exa = view.projects.find(p => p.project.name === 'exawatt');
    expect(exa?.rollup).not.toBeNull();
    // the worktree session's burn books to the exawatt Project
    expect(exa!.rollup!.sessionCount).toBe(1);
    const site = view.projects.find(p => p.project.name === 'site');
    expect(site?.rollup?.sessionCount).toBe(1);
    // workspace totals cover operator sessions only
    expect(view.workspace.sessionCount).toBe(2);
  });

  it('joins fleet identity and leaves the rest honestly absent (E8 pattern)', () => {
    const rows = gridRows(view);
    const identified = rows.find(r => r.id === 'codex-1');
    expect(identified?.identified).toBe(true);
    expect(identified?.title).toBe('worktree bootstrap');
    // interventions unrecorded in contract v1: null, never zero
    expect(identified?.interventions).toBeNull();
    const orphan = rows.find(r => r.id === 'claude-orphan');
    expect(orphan?.identified).toBe(false);
    expect(orphan?.title).toBe('Session claude-o');
    // the outside-record row still resolves its Project via the registry
    expect(orphan?.projectName).toBe('site');
    // machine-invoked overhead is separated, never a grid row
    expect(rows.find(r => r.id === 'sdk-call-1')).toBeUndefined();
    expect(view.overhead.sessionCount).toBe(1);
    // out-of-window samples exist nowhere
    expect(rows.find(r => r.id === 'ancient')).toBeUndefined();
  });

  it('excludes unrecorded sessions from the intervention rate', () => {
    expect(view.interventions.rows).toHaveLength(0);
    // …and the diagnostics tile states the absence, never a 0.0 rate
    const tile = diagnostics(view).find(d => d.key === 'interventions');
    expect(tile?.value).toBe('not recorded');
    expect(tile?.state).toBe('not-recorded');
    const counted = buildLiveConsumption({
      ...liveInputs,
      identities: [
        identity({
          providerSessionId: 'codex-1',
          title: 'worktree bootstrap',
          interventions: 2,
        }),
      ],
    });
    expect(counted.interventions.rows).toHaveLength(1);
    expect(counted.interventions.total.interventions).toBe(2);
  });

  it('applies the freshness discipline: a stale window can never headline', () => {
    const paces = allPaces(view);
    expect(paces.map(p => p.window.limitId)).toEqual([
      planWindowKey(weeklyWindow),
      planWindowKey(primaryWindow),
    ]);
    // …but the stale record is not hidden from the source's window list
    const codex = view.sources.find(s => s.harness === 'codex')!;
    expect(codex.windows.map(w => w.limitId)).toContain(
      planWindowKey(ancientWindow)
    );
  });

  it('meter == page: both read the same tightest live window (the invariant)', () => {
    const meter = readMeter(view.sources, view.nowMs);
    const pagePaces = allPaces(view);
    expect(meter.reading).not.toBeNull();
    expect(meter.reading!.window.limitId).toBe(pagePaces[0].window.limitId);
    expect(meter.reading!.usedPercent).toBe(pagePaces[0].usedPercent);
    expect(meter.reading!.pace).toBe(pagePaces[0].pace);
  });

  it('keeps Claude Code’s plan absence explicit', () => {
    const claude = view.sources.find(s => s.harness === 'claude-code')!;
    expect(claude.windows).toHaveLength(0);
    expect(claude.planType).toBeNull();
    expect(claude.unreportedReason).toBe(CLAUDE_PLAN_NOTE);
  });
});

describe('the empty corpus — a fresh machine, absent-never-zero', () => {
  const view = buildLiveConsumption(inputs());

  it('renders absence, not fabricated zeros', () => {
    expect(view.workspace.sessionCount).toBe(0);
    expect(view.samples).toHaveLength(0);
    expect(gridRows(view)).toHaveLength(0);
    expect(allPaces(view)).toHaveLength(0);
    expect(readMeter(view.sources, view.nowMs).reading).toBeNull();
    // both sources exist as absent channels, never 0% windows
    expect(view.sources.map(s => s.harness).sort()).toEqual([
      'claude-code',
      'codex',
    ]);
    for (const s of view.sources) expect(s.windows).toHaveLength(0);
  });
});

describe('sourceBurnSpark — recent throughput, peak-normalized', () => {
  it('buckets the trailing six hours and normalizes to the peak', () => {
    const spark = sourceBurnSpark(
      [
        sample({ providerSessionId: 'a', source: 'codex', at: iso(NOW - 5 * HOUR) }),
        sample({ providerSessionId: 'a', source: 'codex', at: iso(NOW - 10 * MIN) }),
        sample({ providerSessionId: 'a', source: 'codex', at: iso(NOW - 12 * MIN) }),
      ],
      'codex',
      NOW
    );
    expect(spark).toHaveLength(12);
    expect(Math.max(...spark)).toBe(1);
    expect(spark[11]).toBe(1); // the double-sample bucket is the peak
  });

  it('yields all zeros — not NaN — when nothing burned', () => {
    const spark = sourceBurnSpark([], 'codex', NOW);
    expect(spark.every(v => v === 0)).toBe(true);
  });
});

describe('liveScanView — the caption mapping', () => {
  it('maps a running first scan with progress', () => {
    const scan = liveScanView({
      phase: 'first-scan',
      progress: { filesSeen: 120, filesTotal: 2_800, bytesRead: 5 },
      lastScanAt: null,
      firstScanComplete: false,
      cancelled: false,
    });
    expect(scan.phase).toBe('first-scan');
    expect(scan.progress).toEqual({ filesSeen: 120, filesTotal: 2_800 });
    expect(scan.lastScanAtMs).toBeNull();
  });

  it('parses lastScanAt and preserves the partial-read flag', () => {
    const scan = liveScanView({
      phase: 'idle',
      progress: null,
      lastScanAt: iso(NOW - 3 * MIN),
      firstScanComplete: true,
      cancelled: false,
    });
    expect(scan.lastScanAtMs).toBe(NOW - 3 * MIN);
    expect(scan.firstScanComplete).toBe(true);
  });
});
