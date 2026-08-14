/**
 * Live local consumption source (ENG-008 E5) — the renderer half.
 *
 * Third producer of the one consumption view (`DemoConsumption`): real
 * `ConsumptionSample`s and `PlanWindow`s read from this machine's Claude Code
 * and Codex logs by the Electron main process (the E5 scanner), joined to the
 * fleet's own Session identity, and rolled up through the SAME
 * `buildDemoConsumption` path both demo corpora travel. Nothing downstream
 * changes — that was E4's promise and this file is where it comes due.
 *
 * E2 attribution: Session → Project → Workspace. Identity comes from main's
 * durable-Session ↔ provider-conversation index (carried on the snapshot);
 * Project grouping is cwd-keyed against the workspace's own project registry,
 * worktree-aware (`~/…/exawatt-e5-live` belongs to the `exawatt` Project).
 * A provider session with no fleet identity record renders with measured
 * figures and honestly absent identity — the E8 pattern, unchanged.
 *
 * E3 normalization: `weightedTokens` arrives pre-weighted from core's own
 * model-weight basis via the shared rollups; the stated basis on the page is
 * `NORMALIZED_BASIS_SENTENCE`, printed from core's constants. No second
 * weight table exists here.
 *
 * Honesty rules carried, not restated: absent is never zero (interventions
 * without a record are null; Claude Code has no plan window; Codex keeps no
 * delegation record), stale plan windows are deduped to the latest
 * observation and left to the meter's freshness discipline, and Exawatt's
 * own machine-invoked calls separate by entrypoint exactly as in the corpora.
 *
 * Pure data and pure functions: no React, no DOM, no IPC. The Electron
 * bridge adapter lives in `live-store.ts`; this file can be driven entirely
 * by fixtures.
 */
import {
  isOperatorEntrypoint,
  observationKey,
  planWindowKey,
  resolveModelWeight,
  weightUsage,
  type ConsumptionSample,
  type ConsumptionSourceId,
  type PlanWindow,
  type PlanWindowObservation,
  type ProviderPlanAccountState,
} from '@exawatt/core';
import { projectColor } from '@/components/workspace/project-colors';
import { planWindowLabel, type AccountReadView } from './model';
import {
  OPPORTUNITY_CLOSING_RESET_FRACTION,
  OPPORTUNITY_MIN_FLOOR_PTS,
  type ClosedCycle,
} from './meter/meter-model';
import {
  buildDemoConsumption,
  type DemoConsumption,
  type DemoProject,
  type DemoSessionSpec,
  type LinkMethod,
} from './demo-source';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The live view's corpus window. Copy that names it reads `windowLabel`. */
export const LIVE_WINDOW_DAYS = 7;
export const LIVE_WINDOW_LABEL = 'seven days';

/** Claude Code's absence of local plan data is definitive (spine §4). */
export const CLAUDE_PLAN_NOTE =
  'Claude Code keeps no plan, quota, or rate-limit record in its local files.';

/* ------------------------------------------------------------------ */
/* inputs — the neutral shape the IPC adapter fills                    */
/* ------------------------------------------------------------------ */

/** One Project from the workspace's own registry. `dir` is the key. */
export interface LiveProjectRecord {
  dir: string;
  name: string;
  /** Workspace-assigned identity color, when one exists. */
  color?: string;
}

/**
 * One fleet Session identity from main's durable-Session ↔
 * provider-conversation index. Everything optional-by-honesty is nullable:
 * a missing count is a missing record, never a zero.
 */
export interface LiveSessionIdentity {
  providerSessionId: string;
  source: ConsumptionSourceId;
  title: string;
  /** Main's worktree-aware git root for the Session, when known. */
  projectDir: string | null;
  /** Operator messages after launch; null = no record kept. */
  interventions: number | null;
  /** Peak context footprint in tokens; null/absent = not recorded. */
  contextPeakTokens?: number | null;
  /** Context compactions observed; null/absent = not recorded. */
  compactions?: number | null;
}

/** Scan state for the minimal honest captions (first read + freshness). */
export interface LiveScanView {
  phase: 'idle' | 'first-scan' | 'incremental';
  /** Present while a pass runs; null when idle. */
  progress: { filesSeen: number; filesTotal: number } | null;
  /** Instant the last completed read finished; null before the first. */
  lastScanAtMs: number | null;
  /** Until true, the samples are a PARTIAL corpus and the page says so. */
  firstScanComplete: boolean;
  /** The most recent pass was cancelled before finishing. */
  cancelled: boolean;
}

/** `ConsumptionScanState` (contract) → the caption view. */
export function liveScanView(scan: {
  phase: 'idle' | 'first-scan' | 'incremental';
  progress: { filesSeen: number; filesTotal: number; bytesRead: number } | null;
  lastScanAt: string | null;
  firstScanComplete: boolean;
  cancelled: boolean;
}): LiveScanView {
  const lastScanAtMs = scan.lastScanAt ? Date.parse(scan.lastScanAt) : null;
  return {
    phase: scan.phase,
    progress: scan.progress
      ? { filesSeen: scan.progress.filesSeen, filesTotal: scan.progress.filesTotal }
      : null,
    lastScanAtMs: Number.isNaN(lastScanAtMs ?? NaN) ? null : lastScanAtMs,
    firstScanComplete: scan.firstScanComplete,
    cancelled: scan.cancelled,
  };
}

export interface LiveConsumptionInputs {
  nowMs: number;
  samples: ConsumptionSample[];
  planWindows: PlanWindow[];
  /**
   * Main-derived observed rate per `limitId`, %/hour, from the snapshot's
   * bounded window-observation history. A limitId absent here has no
   * derivable trend yet; the builder falls back to the window's own
   * observed AVERAGE since its start (`observedBurnRate`) — a real
   * single-observation derivation, never a fabricated zero.
   */
  windowRates: Record<string, number>;
  /**
   * Bounded observed history per window bucket from the snapshot, ascending
   * by `observedAtMs`. E9's closed-cycle ledger is derived from the tail of
   * the PREVIOUS cycle; absent history simply means no ledger, never a
   * fabricated claim.
   */
  windowObservations: PlanWindowObservation[];
  identities: LiveSessionIdentity[];
  projects: LiveProjectRecord[];
  /**
   * ENG-038 — per-provider account read state from the snapshot. Absent (or
   * an empty array) means no credentialed read is configured, and each
   * source's local capability fact stands alone. A PRESENT entry is what
   * lets the page say "unknown" instead of "keeps no plan record" when the
   * read is off or failing, and is where the plan-credit spend arrives.
   */
  providerPlanAccounts?: ProviderPlanAccountState[];
}

/** Snapshot account state → the view-model's account read, one per source. */
export function accountReads(
  accounts: readonly ProviderPlanAccountState[] | undefined
): Partial<Record<ConsumptionSourceId, AccountReadView>> {
  const out: Partial<Record<ConsumptionSourceId, AccountReadView>> = {};
  for (const account of accounts ?? []) {
    const observedAtMs = account.observedAt
      ? Date.parse(account.observedAt)
      : null;
    out[account.source] = {
      status: account.status,
      observedAtMs:
        observedAtMs === null || Number.isNaN(observedAtMs)
          ? null
          : observedAtMs,
      planType: account.planType,
      spend: account.spend
        ? {
            usedMinor: account.spend.usedMinor,
            limitMinor: account.spend.limitMinor,
            currency: account.spend.currency,
            exponent: account.spend.exponent,
            percent: account.spend.percent,
            enabled: account.spend.enabled,
          }
        : null,
    };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* project resolution — cwd-keyed, worktree-aware                      */
/* ------------------------------------------------------------------ */

const stripSlash = (p: string) => (p.endsWith('/') ? p.slice(0, -1) : p);
const leaf = (p: string) => p.split('/').filter(Boolean).pop() ?? p;
const parent = (p: string) => {
  const s = stripSlash(p);
  const i = s.lastIndexOf('/');
  return i > 0 ? s.slice(0, i) : '';
};

/**
 * cwd → Project against the workspace registry. Two honest matches only:
 * inside the Project root (longest root wins), or a sibling worktree named
 * `<leaf>-…` beside it — the convention the agent workflow actually uses.
 * Anything else resolves to null and stays visibly unattributed; the data
 * never forces a guess (spine §3).
 */
export function liveProjectResolver(
  projects: readonly LiveProjectRecord[]
): (cwd: string) => { id: string; label: string } | null {
  const roots = projects
    .map(p => ({ ...p, dir: stripSlash(p.dir) }))
    .sort((a, b) => b.dir.length - a.dir.length);
  return (cwd: string) => {
    const c = stripSlash(cwd);
    for (const p of roots) {
      if (c === p.dir || c.startsWith(`${p.dir}/`)) {
        return { id: p.dir, label: p.name };
      }
    }
    for (const p of roots) {
      if (parent(c) === parent(p.dir) && leaf(c).startsWith(`${leaf(p.dir)}-`)) {
        return { id: p.dir, label: p.name };
      }
    }
    return null;
  };
}

/* ------------------------------------------------------------------ */
/* plan windows — latest observation per limit                         */
/* ------------------------------------------------------------------ */

/**
 * One window identity gets ONE record: the latest observation. The contract
 * already guarantees this (`LiveConsumptionSnapshot.planWindows` is keyed by
 * `limitId`); this normalization is defensive, because the scan CAN recover
 * months of observations per limit (spine §4) and a duplicated window card
 * is how the page starts lying. Staleness of the survivor is the meter's
 * freshness rule to judge, not ours to hide.
 */
export function latestPlanWindows(planWindows: PlanWindow[]): PlanWindow[] {
  const byBucket = new Map<string, PlanWindow>();
  for (const w of planWindows) {
    // The FULL bucket key — one limitId carries both a primary and a
    // secondary window, so limitId alone would collapse two real windows.
    const key = planWindowKey(w);
    const prev = byBucket.get(key);
    if (!prev || Date.parse(w.observedAt) > Date.parse(prev.observedAt)) {
      byBucket.set(key, w);
    }
  }
  return [...byBucket.values()];
}

/**
 * Observed average burn for a window, %/hour: the harness's own usedPercent
 * over the window time elapsed at observation. An average, not a trend —
 * labelled "%/h observed" wherever it renders.
 */
export function observedBurnRate(w: PlanWindow): number {
  if (w.windowMinutes <= 0 || !w.resetsAt) return 0;
  const windowMs = w.windowMinutes * MIN;
  const resetsAtMs = Date.parse(w.resetsAt);
  const observedAtMs = Date.parse(w.observedAt);
  if (Number.isNaN(resetsAtMs) || Number.isNaN(observedAtMs)) return 0;
  const elapsedMs = Math.min(windowMs, Math.max(0, windowMs - (resetsAtMs - observedAtMs)));
  const hours = Math.max(0.5, elapsedMs / HOUR);
  return w.usedPercent / hours;
}

/* ------------------------------------------------------------------ */
/* closed cycles — the E9 ledger's data (observed, never extrapolated) */
/* ------------------------------------------------------------------ */

/**
 * A "closed with N% unused" claim is only honest if the harness was actually
 * observed near the close — Codex reports rate limits with each response, so
 * burn near the reset always writes a fresher observation, and a final
 * observation this close to the reset IS the closing state to log fidelity.
 * Farther than this, the cycle's end went unobserved and no claim is made.
 */
const LEDGER_OBSERVATION_SLACK_MIN_MS = 30 * MIN;
const LEDGER_OBSERVATION_SLACK_FRACTION = 0.05;

/**
 * Cycles that recently closed with real headroom unspent, derived per live
 * window bucket from the previous cycle's final observation. Three gates:
 *
 *  - the current cycle is young (elapsed ≤ ¼ window — the same fraction the
 *    closing tier uses), so the ledger is news, not history;
 *  - the previous cycle's last observation sits within the slack of the
 *    reset instant (see above), so "closed with" is observed fact;
 *  - the unused share clears the opportunity floor (15 pts) — at a window's
 *    close even-pace is 100%, so unused IS the floor, and below the floor
 *    the trigger itself would never have spoken.
 */
export function liveClosedCycles(
  planWindows: readonly PlanWindow[],
  observations: readonly PlanWindowObservation[],
  nowMs: number
): ClosedCycle[] {
  const out: ClosedCycle[] = [];
  for (const w of planWindows) {
    if (w.windowMinutes <= 0 || !w.resetsAt) continue;
    const resetsAtMs = Date.parse(w.resetsAt);
    if (Number.isNaN(resetsAtMs)) continue;
    const windowMs = w.windowMinutes * MIN;
    const cycleStartMs = resetsAtMs - windowMs;
    const agoMs = nowMs - cycleStartMs;
    if (agoMs < 0) continue; // window not started (clock skew) — no claim
    if (agoMs > windowMs * OPPORTUNITY_CLOSING_RESET_FRACTION) continue;
    const key = planWindowKey(w);
    let last: PlanWindowObservation | null = null;
    for (const o of observations) {
      if (observationKey(o) !== key) continue;
      if (o.observedAtMs >= cycleStartMs) continue; // current cycle
      if (o.observedAtMs < cycleStartMs - windowMs) continue; // older cycles
      if (!last || o.observedAtMs > last.observedAtMs) last = o;
    }
    if (!last) continue;
    const slack = Math.max(
      LEDGER_OBSERVATION_SLACK_MIN_MS,
      windowMs * LEDGER_OBSERVATION_SLACK_FRACTION
    );
    if (cycleStartMs - last.observedAtMs > slack) continue;
    const unusedPercent = Math.round(100 - last.usedPercent);
    if (unusedPercent < OPPORTUNITY_MIN_FLOOR_PTS) continue;
    out.push({
      label: planWindowLabel(w.windowMinutes),
      unusedPercent,
      agoMs,
    });
  }
  return out.sort((a, b) => b.unusedPercent - a.unusedPercent);
}

/* ------------------------------------------------------------------ */
/* sparklines — recent throughput per source                           */
/* ------------------------------------------------------------------ */

const BURN_BUCKETS = 12;
const BURN_SPAN_MS = 6 * HOUR;

/** Weighted throughput over the trailing 6h, 30-min buckets, peak-normalized. */
export function sourceBurnSpark(
  samples: readonly ConsumptionSample[],
  source: ConsumptionSourceId,
  nowMs: number
): number[] {
  const values = new Array<number>(BURN_BUCKETS).fill(0);
  const from = nowMs - BURN_SPAN_MS;
  for (const s of samples) {
    if (s.source !== source) continue;
    const at = Date.parse(s.at);
    if (at < from || at > nowMs) continue;
    const i = Math.min(
      BURN_BUCKETS - 1,
      Math.floor(((at - from) / BURN_SPAN_MS) * BURN_BUCKETS)
    );
    values[i] += weightUsage(s.usage, resolveModelWeight(s.model).weight);
  }
  const peak = Math.max(...values);
  return peak > 0 ? values.map(v => v / peak) : values;
}

/* ------------------------------------------------------------------ */
/* session specs — fleet identity joined to measured samples           */
/* ------------------------------------------------------------------ */

interface UsageAcc {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  webSearches: number;
}

const zeroAcc = (): UsageAcc => ({
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  reasoning: 0,
  webSearches: 0,
});

function accumulate(acc: UsageAcc, s: ConsumptionSample): void {
  acc.input += s.usage.inputTokens;
  acc.cacheRead += s.usage.cacheReadTokens;
  acc.cacheWrite += s.usage.cacheWriteTokens;
  acc.output += s.usage.outputTokens;
  acc.reasoning += s.usage.reasoningTokens;
  acc.webSearches += s.usage.webSearches;
}

function modal(values: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (v === null) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

function liveSessionSpecs(
  identities: readonly LiveSessionIdentity[],
  samples: readonly ConsumptionSample[],
  resolve: (cwd: string) => { id: string; label: string } | null
): DemoSessionSpec[] {
  const bySession = new Map<string, ConsumptionSample[]>();
  for (const s of samples) {
    const list = bySession.get(s.providerSessionId);
    if (list) list.push(s);
    else bySession.set(s.providerSessionId, [s]);
  }

  const specs: DemoSessionSpec[] = [];
  for (const identity of identities) {
    const mine = bySession.get(identity.providerSessionId);
    if (!mine || mine.length === 0) continue; // no measured burn in window
    const own = mine.filter(s => s.delegation === null);
    const times = mine.map(s => Date.parse(s.at));
    const cwd = mine.find(s => s.cwd !== null)?.cwd ?? identity.projectDir ?? '';
    // Main's own worktree-aware root wins when it is a registered Project;
    // otherwise the registry resolver decides, and null stays unattributed.
    const resolved =
      (identity.projectDir ? resolve(identity.projectDir) : null) ??
      (cwd ? resolve(cwd) : null);

    const ownUsage = zeroAcc();
    for (const s of own) accumulate(ownUsage, s);

    const delegatedRuns = new Map<
      string,
      { agentType: string | null; models: Array<string | null>; usage: UsageAcc }
    >();
    for (const s of mine) {
      if (!s.delegation) continue;
      const run = delegatedRuns.get(s.delegation.agentId) ?? {
        agentType: s.delegation.agentType,
        models: [],
        usage: zeroAcc(),
      };
      run.models.push(s.model);
      accumulate(run.usage, s);
      delegatedRuns.set(s.delegation.agentId, run);
    }

    specs.push({
      id: identity.providerSessionId,
      source: identity.source,
      title: identity.title,
      model: modal(own.map(s => s.model)) ?? modal(mine.map(s => s.model)) ?? '',
      effort: own.find(s => s.effort !== null)?.effort ?? null,
      projectKey: resolved?.id ?? null,
      cwd,
      gitBranch: mine.find(s => s.gitBranch !== null)?.gitBranch ?? null,
      entrypoint: own.find(s => s.entrypoint !== null)?.entrypoint ?? 'cli',
      startedAtMs: Math.min(...times),
      lastAtMs: Math.max(...times),
      turns: own.length,
      interventions: identity.interventions,
      usage: {
        input: ownUsage.input,
        cacheRead: ownUsage.cacheRead,
        cacheWrite: ownUsage.cacheWrite,
        output: ownUsage.output,
        reasoning: ownUsage.reasoning,
        webSearches: ownUsage.webSearches,
      },
      ...(identity.contextPeakTokens != null
        ? { contextPeakTokens: identity.contextPeakTokens }
        : {}),
      ...(identity.compactions != null
        ? { compactions: identity.compactions }
        : {}),
      delegated: [...delegatedRuns.entries()].map(([agentId, run]) => ({
        agentId,
        agentType: run.agentType ?? 'delegated',
        model: modal(run.models) ?? '',
        usage: {
          input: run.usage.input,
          cacheRead: run.usage.cacheRead,
          cacheWrite: run.usage.cacheWrite,
          output: run.usage.output,
          reasoning: run.usage.reasoning,
        },
      })),
      // Live Session → roadmap-item links are owed to ENG-017's declaration
      // path; until then the roadmap pivot states "Not attributed" honestly.
      roadmapItemId: null,
      link: null,
    });
  }
  return specs;
}

/* ------------------------------------------------------------------ */
/* the builder                                                         */
/* ------------------------------------------------------------------ */

export function buildLiveConsumption(
  inputs: LiveConsumptionInputs
): DemoConsumption {
  const { nowMs } = inputs;
  const from = nowMs - LIVE_WINDOW_DAYS * DAY;
  const samples = inputs.samples.filter(s => {
    const at = Date.parse(s.at);
    return at >= from && at <= nowMs + MIN;
  });
  const planWindows = latestPlanWindows(inputs.planWindows);

  const projects: DemoProject[] = inputs.projects.map(p => ({
    key: stripSlash(p.dir),
    name: p.name,
    dir: stripSlash(p.dir),
    color: p.color ?? projectColor(stripSlash(p.dir)),
  }));
  const resolve = liveProjectResolver(inputs.projects);

  // Main's trend-derived rate wins; the single-observation average is the
  // honest fallback, never a fabricated zero — while a REPORTED 0 (a
  // genuinely flat window) is kept. Keys are the full window bucket
  // (`planWindowKey`), matching the contract.
  const burnRates: Record<string, number> = {};
  for (const w of planWindows) {
    const key = planWindowKey(w);
    burnRates[key] = inputs.windowRates[key] ?? observedBurnRate(w);
  }

  return buildDemoConsumption({
    nowMs,
    windowLabel: LIVE_WINDOW_LABEL,
    samples,
    planWindows,
    projects,
    roadmap: [],
    sessionSpecs: liveSessionSpecs(inputs.identities, samples, resolve),
    projectResolver: resolve,
    sessionLinks: new Map<string, { itemId: string; method: LinkMethod }>(),
    burn: {
      codex: sourceBurnSpark(samples, 'codex', nowMs),
      'claude-code': sourceBurnSpark(samples, 'claude-code', nowMs),
      grok: sourceBurnSpark(samples, 'grok', nowMs),
    },
    burnRates,
    claudePlanNote: CLAUDE_PLAN_NOTE,
    accountReads: accountReads(inputs.providerPlanAccounts),
    closedCycles: liveClosedCycles(
      planWindows,
      inputs.windowObservations,
      nowMs
    ),
  });
}
