/**
 * Usage scenarios (ENG-008 E15): named account states, and a simulator that
 * burns them forward in time.
 *
 * A scenario is written in the SNAPSHOT's own vocabulary (`PlanWindow`s,
 * observed rates, `ProviderPlanAccountState`s, local samples) and reaches the
 * screen through the production live builder (`buildLiveConsumption`) and the
 * production projection (`usageOverview`). Nothing here renders or decides
 * anything a real read would not, so a scenario that looks right in the
 * workbench looks right on the operator's machine.
 *
 * Three consumers:
 *   - `accounts.test.ts` asserts the projection's contracts over every one;
 *   - `/hud-gallery/usage-scenarios` renders the page and the chrome meter
 *     for each, with a time scrubber and a burn multiplier;
 *   - `scripts/usage-scenarios-eval.mjs` screenshots each and asserts its
 *     geometry, the landing gate for Usage surfaces.
 *
 * The shapes are drawn from real reads (2026-09-29): the operator's Claude
 * Max 20x account read, his Codex Pro `account/rateLimits/read` answer with
 * banked "Full reset" credits, and his rollout logs lagging a reset by hours.
 * Figures are representative, not his.
 */
import {
  localLogAssurance,
  planWindowKey,
  type ConsumptionSample,
  type ConsumptionSourceId,
  type PlanAccountSourceId,
  type PlanWindow,
  type ProviderPlanAccountState,
} from '@exawatt/core';
import { buildLiveConsumption } from './live-source';
import { usageOverview, type UsageOverview } from './accounts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const WEEK_MIN = 10_080;
const SESSION_MIN = 300;

/** Tuesday 29 September 2026, 6:40 PM in Los Angeles. */
export const SCENARIO_NOW_MS = Date.parse('2026-09-30T01:40:00.000Z');
export const SCENARIO_TIME_ZONE = 'America/Los_Angeles';

export interface UsageScenario {
  id: string;
  title: string;
  /** One line: the state this scenario exists to show. */
  shows: string;
  nowMs: number;
  planWindows: PlanWindow[];
  /** %/hour per `planWindowKey`, as main derives it from observed history. */
  windowRates: Record<string, number>;
  accounts: ProviderPlanAccountState[];
  /** Raw tokens measured locally per source over the view's window. */
  tokens: Partial<Record<ConsumptionSourceId, number>>;
}

/* ------------------------------------------------------------------ */
/* builders                                                            */
/* ------------------------------------------------------------------ */

const iso = (ms: number) => new Date(ms).toISOString();

interface WindowSpec {
  source: PlanAccountSourceId;
  limitId: string;
  scope?: string | null;
  minutes: number;
  used: number;
  resetsAtMs: number;
  observedAtMs: number;
  /** %/hour. */
  rate: number;
  /** The vendor's plan identity; null where the read states none (Google). */
  planType: string | null;
  origin?: PlanWindow['origin'];
}

function windows(specs: WindowSpec[]): Pick<UsageScenario, 'planWindows' | 'windowRates'> {
  const planWindows: PlanWindow[] = specs.map(w => ({
    source: w.source,
    limitId: w.limitId,
    limitName: w.scope ?? null,
    scope: 'primary',
    usedPercent: w.used,
    windowMinutes: w.minutes,
    resetsAt: iso(w.resetsAtMs),
    planType: w.planType,
    observedAt: iso(w.observedAtMs),
    providerSessionId: '',
    ...(w.origin ? { origin: w.origin } : {}),
  }));
  const windowRates: Record<string, number> = {};
  specs.forEach((w, i) => {
    windowRates[planWindowKey(planWindows[i])] = w.rate;
  });
  return { planWindows, windowRates };
}

const at = (hoursFromNow: number) => SCENARIO_NOW_MS + hoursFromNow * HOUR;

/** Claude's fixed weekly anchor: Monday 5 October, 2:00 AM Pacific. */
const CLAUDE_WEEK_RESET = Date.parse('2026-10-05T09:00:00.000Z');
/** Google's weekly groups refresh a week after first use, like Codex's; the
 *  Gemini group on the operator's machine read "3 days, 5 hours" to go. */
const GOOGLE_GEMINI_RESET = at(3 * 24 + 5);
const GOOGLE_3P_RESET = at(6 * 24 + 18);
/** Codex's rolling week, started at first use after the last reset. */
const CODEX_WEEK_RESET = Date.parse('2026-10-05T01:57:06.000Z');
const CODEX_WEEK_AFTER_RESET = Date.parse('2026-10-07T04:22:51.000Z');

function claudeAccount(
  overrides: Partial<ProviderPlanAccountState> = {}
): ProviderPlanAccountState {
  return {
    source: 'claude-code',
    status: 'ok',
    observedAt: iso(at(-2 / 60)),
    planType: 'max',
    rateLimitTier: 'default_claude_max_20x',
    spend: {
      usedMinor: 23_522,
      limitMinor: 22_000,
      currency: 'USD',
      exponent: 2,
      percent: 100,
      enabled: true,
    },
    ...overrides,
  };
}

function codexAccount(
  overrides: Partial<ProviderPlanAccountState> = {}
): ProviderPlanAccountState {
  return {
    source: 'codex',
    status: 'ok',
    observedAt: iso(at(-1 / 60)),
    planType: 'pro',
    spend: null,
    canUseReset: true,
    resets: {
      available: 4,
      credits: [
        { title: 'Full reset', expiresAt: '2026-10-04T04:18:38.000Z', grantedAt: '2026-09-04T04:18:38.000Z' },
        { title: 'Full reset', expiresAt: '2026-10-05T04:18:38.000Z', grantedAt: '2026-09-05T04:18:38.000Z' },
        { title: 'Full reset', expiresAt: '2026-10-22T20:27:24.000Z', grantedAt: '2026-09-22T20:27:24.000Z' },
        { title: 'Full reset', expiresAt: '2026-10-29T18:48:22.000Z', grantedAt: '2026-09-29T18:48:22.000Z' },
      ],
    },
    credits: { balance: 0, unlimited: false },
    ...overrides,
  };
}

/** The operator's Claude week, burning toward a Thursday-night run-out. */
function claudeWindows(observedAtMs = at(-2 / 60), week = 44, weekRate = 1.08) {
  return [
    {
      source: 'claude-code' as const,
      limitId: 'claude-session',
      minutes: SESSION_MIN,
      used: 11,
      // A session window resets five hours after it opened; a read this old
      // describes a session that has since reset.
      resetsAtMs: observedAtMs + 32 * MIN,
      observedAtMs,
      rate: 2.4,
      planType: 'max',
      origin: 'provider-account' as const,
    },
    {
      source: 'claude-code' as const,
      limitId: 'claude-weekly-all',
      minutes: WEEK_MIN,
      used: week,
      resetsAtMs: CLAUDE_WEEK_RESET,
      observedAtMs,
      rate: weekRate,
      planType: 'max',
      origin: 'provider-account' as const,
    },
    {
      source: 'claude-code' as const,
      limitId: 'claude-weekly-fable',
      scope: 'Fable',
      minutes: WEEK_MIN,
      used: 11,
      resetsAtMs: CLAUDE_WEEK_RESET,
      observedAtMs,
      rate: 0.27,
      planType: 'max',
      origin: 'provider-account' as const,
    },
  ];
}

function codexWeek(used: number, rate: number, resetsAtMs = CODEX_WEEK_RESET, observedAtMs = at(-4 / 60)) {
  return {
    source: 'codex' as const,
    limitId: 'codex',
    minutes: WEEK_MIN,
    used,
    resetsAtMs,
    observedAtMs,
    rate,
    planType: 'pro',
  };
}

/**
 * The Google account Antigravity draws on (ENG-038 slice 4), in the shape
 * `agy -p "/usage"` reported on 2026-10-05: one weekly limit per model group,
 * named for the group, no plan tier. `gemini` is percent used.
 */
function googleWindows(gemini = 38, geminiRate = 0.4, observedAtMs = at(-3 / 60)) {
  return [
    {
      source: 'antigravity' as const,
      limitId: 'gemini-weekly',
      scope: 'Gemini',
      minutes: WEEK_MIN,
      used: gemini,
      resetsAtMs: GOOGLE_GEMINI_RESET,
      observedAtMs,
      rate: geminiRate,
      planType: null,
      origin: 'provider-account' as const,
    },
    {
      source: 'antigravity' as const,
      limitId: '3p-weekly',
      scope: 'Claude and GPT',
      minutes: WEEK_MIN,
      used: 0,
      resetsAtMs: GOOGLE_3P_RESET,
      observedAtMs,
      rate: 0,
      planType: null,
      origin: 'provider-account' as const,
    },
  ];
}

function googleAccount(
  overrides: Partial<ProviderPlanAccountState> = {}
): ProviderPlanAccountState {
  return {
    source: 'antigravity',
    status: 'ok',
    observedAt: iso(at(-3 / 60)),
    planType: null,
    spend: null,
    ...overrides,
  };
}

const HEAVY_TOKENS = { 'claude-code': 1_840_000_000, codex: 612_000_000 };

/* ------------------------------------------------------------------ */
/* the scenarios                                                       */
/* ------------------------------------------------------------------ */

export const USAGE_SCENARIOS: readonly UsageScenario[] = [
  {
    id: 'runs-out-before-reset',
    title: 'Runs out before reset',
    shows: 'Codex is on course to run out tomorrow morning, days before its Sunday reset, with four banked resets.',
    nowMs: SCENARIO_NOW_MS,
    ...windows([...claudeWindows(), codexWeek(78, 1.635), ...googleWindows()]),
    accounts: [claudeAccount(), codexAccount(), googleAccount()],
    tokens: HEAVY_TOKENS,
  },
  {
    id: 'after-a-reset',
    title: 'After spending a reset',
    shows: 'A banked Codex reset restarted the week; Claude is now the account that runs out first.',
    nowMs: SCENARIO_NOW_MS,
    ...windows([...claudeWindows(), codexWeek(45, 0.9, CODEX_WEEK_AFTER_RESET)]),
    accounts: [
      claudeAccount(),
      codexAccount({
        resets: {
          available: 3,
          credits: [
            { title: 'Full reset', expiresAt: '2026-10-05T04:18:38.000Z', grantedAt: '2026-09-05T04:18:38.000Z' },
            { title: 'Full reset', expiresAt: '2026-10-22T20:27:24.000Z', grantedAt: '2026-09-22T20:27:24.000Z' },
            { title: 'Full reset', expiresAt: '2026-10-29T18:48:22.000Z', grantedAt: '2026-09-29T18:48:22.000Z' },
          ],
        },
        credits: { balance: 60_941.2, unlimited: false },
      }),
    ],
    tokens: HEAVY_TOKENS,
  },
  {
    id: 'comfortable',
    title: 'Comfortable, a reset expiring',
    shows: 'Both accounts will finish the week with room to spare, and a banked reset expires in two days.',
    nowMs: SCENARIO_NOW_MS,
    ...windows([...claudeWindows(at(-3 / 60), 21, 0.3), codexWeek(24, 0.35)]),
    accounts: [
      claudeAccount({ spend: { usedMinor: 0, limitMinor: 22_000, currency: 'USD', exponent: 2, percent: 0, enabled: true } }),
      codexAccount({
        resets: {
          available: 1,
          credits: [{ title: 'Full reset', expiresAt: iso(at(50)), grantedAt: iso(at(-24 * 28)) }],
        },
      }),
    ],
    tokens: HEAVY_TOKENS,
  },
  {
    id: 'limit-reached',
    title: 'Limit reached',
    shows: 'The Claude week is spent; the page says when it comes back.',
    nowMs: SCENARIO_NOW_MS,
    ...windows([...claudeWindows(at(-2 / 60), 100, 1.4), codexWeek(52, 0.8)]),
    accounts: [claudeAccount(), codexAccount({ resets: { available: 0, credits: [] } })],
    tokens: HEAVY_TOKENS,
  },
  {
    id: 'claude-not-readable',
    title: 'Claude not readable',
    shows: 'Claude Code is not signed in to a plan, so there is nothing to meter, while Claude does the heavy lifting.',
    nowMs: SCENARIO_NOW_MS,
    ...windows([codexWeek(78, 1.635)]),
    accounts: [
      {
        source: 'claude-code',
        status: 'unavailable',
        failure: 'no-plan',
        observedAt: null,
        planType: null,
        spend: null,
      },
      codexAccount(),
    ],
    tokens: HEAVY_TOKENS,
  },
  {
    id: 'claude-read-failing',
    title: 'Claude read failing',
    shows: 'The last Claude read was a day ago: the session it described has reset, and the week keeps its true age.',
    nowMs: SCENARIO_NOW_MS,
    ...windows([...claudeWindows(at(-26)), codexWeek(40, 0.7)]),
    accounts: [
      claudeAccount({
        status: 'unavailable',
        failure: 'timed-out',
        observedAt: iso(at(-26)),
      }),
      codexAccount({ resets: { available: 0, credits: [] } }),
    ],
    tokens: HEAVY_TOKENS,
  },
  {
    id: 'unmetered-source',
    title: 'A source with no plan limits',
    shows: 'Grok reports no plan limits, so its card counts tokens instead of drawing a bar.',
    nowMs: SCENARIO_NOW_MS,
    ...windows([...claudeWindows(at(-2 / 60), 30, 0.4), codexWeek(30, 0.4)]),
    accounts: [claudeAccount(), codexAccount({ resets: { available: 0, credits: [] } })],
    tokens: { ...HEAVY_TOKENS, grok: 48_200_000 },
  },
  {
    id: 'google-limit-reached',
    title: 'Google Gemini limit reached',
    shows:
      "Antigravity's Gemini models are spent until Thursday evening while its Claude and GPT group is untouched; Google states no plan tier, so none is shown.",
    nowMs: SCENARIO_NOW_MS,
    ...windows([
      ...claudeWindows(at(-2 / 60), 30, 0.4),
      codexWeek(30, 0.4),
      ...googleWindows(100, 0),
    ]),
    accounts: [
      claudeAccount(),
      codexAccount({ resets: { available: 0, credits: [] } }),
      googleAccount(),
    ],
    tokens: HEAVY_TOKENS,
  },
  {
    id: 'google-not-readable',
    title: 'Google not readable',
    shows:
      'Antigravity is on this machine but its usage report could not be read: the card says so, draws no bar, and never reads zero.',
    nowMs: SCENARIO_NOW_MS,
    ...windows([...claudeWindows(at(-2 / 60), 30, 0.4), codexWeek(30, 0.4)]),
    accounts: [
      claudeAccount(),
      codexAccount({ resets: { available: 0, credits: [] } }),
      googleAccount({ status: 'unavailable', failure: 'exited', observedAt: null }),
    ],
    tokens: HEAVY_TOKENS,
  },
  {
    id: 'first-run',
    title: 'First run',
    shows: 'No Agent has run yet.',
    nowMs: SCENARIO_NOW_MS,
    planWindows: [],
    windowRates: {},
    accounts: [],
    tokens: {},
  },
];

export function usageScenario(id: string | null | undefined): UsageScenario {
  return USAGE_SCENARIOS.find(s => s.id === id) ?? USAGE_SCENARIOS[0];
}

/* ------------------------------------------------------------------ */
/* the simulator — burn a scenario forward                              */
/* ------------------------------------------------------------------ */

/**
 * The scenario `hours` later, if every window keeps burning at its observed
 * rate times `burn` (2 = twice the fleet). Windows roll over at their reset
 * instant and restart from zero; reset credits past their expiry lapse; an
 * account whose read is failing gets no new reading, exactly as in life.
 */
export function advanceScenario(
  scenario: UsageScenario,
  hours: number,
  burn = 1
): UsageScenario {
  if (hours <= 0 && burn === 1) return scenario;
  const nowMs = scenario.nowMs + hours * HOUR;
  const readable = (source: PlanAccountSourceId) => {
    const account = scenario.accounts.find(a => a.source === source);
    return !account || account.status === 'ok';
  };
  const windowRates: Record<string, number> = {};
  const planWindows = scenario.planWindows.map(w => {
    const key = planWindowKey(w);
    const rate = (scenario.windowRates[key] ?? 0) * burn;
    windowRates[key] = rate;
    if (!readable(w.source) || !w.resetsAt) return w;
    let resetsAtMs = Date.parse(w.resetsAt);
    let fromMs = Date.parse(w.observedAt);
    let used = w.usedPercent;
    const windowMs = w.windowMinutes * MIN;
    while (nowMs >= resetsAtMs) {
      used = 0;
      fromMs = resetsAtMs;
      resetsAtMs += windowMs;
    }
    used = Math.min(100, used + (rate * Math.max(0, nowMs - fromMs)) / HOUR);
    return {
      ...w,
      usedPercent: Math.round(used * 10) / 10,
      resetsAt: iso(resetsAtMs),
      observedAt: iso(nowMs),
    };
  });
  const accounts = scenario.accounts.map(a => {
    if (a.status !== 'ok') return a;
    const credits = a.resets?.credits?.filter(
      c => c.expiresAt === null || Date.parse(c.expiresAt) > nowMs
    );
    return {
      ...a,
      observedAt: iso(nowMs),
      ...(a.resets
        ? {
            resets: {
              available: Math.max(
                0,
                a.resets.available -
                  ((a.resets.credits?.length ?? 0) - (credits?.length ?? 0))
              ),
              credits: credits ?? null,
            },
          }
        : {}),
    };
  });
  return { ...scenario, nowMs, planWindows, windowRates, accounts };
}

/* ------------------------------------------------------------------ */
/* the scenario, through the production path                            */
/* ------------------------------------------------------------------ */

function tokenSamples(scenario: UsageScenario): ConsumptionSample[] {
  return Object.entries(scenario.tokens).map(([source, total]) => {
    const id = source as ConsumptionSourceId;
    return {
      at: iso(scenario.nowMs - HOUR),
      source: id,
      model: null,
      effort: null,
      providerSessionId: `scenario-${id}`,
      cwd: null,
      gitBranch: null,
      usage: {
        inputTokens: Math.round((total ?? 0) * 0.02),
        cacheReadTokens: Math.round((total ?? 0) * 0.9),
        cacheWriteTokens: Math.round((total ?? 0) * 0.05),
        outputTokens: Math.round((total ?? 0) * 0.03),
        reasoningTokens: 0,
        webSearches: 0,
        webFetches: 0,
      },
      assurance: localLogAssurance(id),
      idempotencyKey: `scenario:${scenario.id}:${id}`,
      contextWindow: null,
      sourceFile: null,
      delegation: null,
      entrypoint: 'cli',
    };
  });
}

/** The scenario as the live builder sees a real snapshot. */
function scenarioConsumption(scenario: UsageScenario) {
  return buildLiveConsumption({
    nowMs: scenario.nowMs,
    samples: tokenSamples(scenario),
    planWindows: scenario.planWindows,
    windowRates: scenario.windowRates,
    identities: [],
    projects: [],
    providerPlanAccounts: scenario.accounts,
  });
}

/** The scenario as every usage surface renders it. */
export function scenarioOverview(scenario: UsageScenario): UsageOverview {
  return usageOverview(scenarioConsumption(scenario));
}
