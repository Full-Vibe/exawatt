/**
 * Consumption UI view-model (ENG-008).
 *
 * The single shape every Consumption component renders, and the only place
 * `@exawatt/core`'s Consumption contract is translated for display. Two
 * producers feed it and both go through this file:
 *
 *   - `/usage` — the production surface, fed by `demo-source.ts`, which
 *     emits real `ConsumptionSample`s and rolls them up with core's own
 *     `rollupBy*`. Live wiring later swaps the sample producer and nothing
 *     downstream changes.
 *   - the ambient chrome meter (`./meter/`), which reads the same
 *     `ConsumptionSourceView`s through `use-tenant-consumption`.
 *   (The `/hud-gallery/consumption-lab` fixture workbench was the second
 *   producer until it retired on 2026-08-03 — its subject shipped as `/usage`.)
 *
 * TWO TRANSLATIONS MATTER, and both exist because the display shape and the
 * measurement shape are honestly different:
 *
 * 1. `DisplayUsage` segments are DISJOINT so they can be stacked. Core's
 *    `RawUsage.reasoningTokens` is a SUBSET of `outputTokens`; here `output`
 *    excludes reasoning and the two segments sum to generated tokens. Adding
 *    core's fields naively would double-count every Codex turn.
 * 2. `reasoning: null` means the SOURCE CANNOT REPORT IT, which is a different
 *    fact from a reported zero. Core states that as a capability
 *    (`SOURCE_CAPABILITIES[source].reasoningTokens`), so the translation reads
 *    the capability rather than testing the number for zero.
 *
 * Pure data and pure functions: no React, no DOM. Components import from here;
 * this file imports nothing from them.
 */
import {
  SOURCE_CAPABILITIES,
  planWindowKey,
  type ConsumptionRollup,
  type ConsumptionSourceId,
  type PlanWindow,
  type RawUsage as CoreRawUsage,
} from '@exawatt/core';

const HOUR_MS = 3_600_000;

export type Harness = ConsumptionSourceId;

export const HARNESS_LABEL: Record<Harness, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
};

/**
 * Disjoint raw-unit segments for one scope. `null` on any unit means the
 * harness does not report that unit at all. Never coerce it to 0.
 */
export interface DisplayUsage {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  /** Generated tokens EXCLUDING reasoning, so the segments can be stacked. */
  output: number;
  /** Generated reasoning tokens. null when no source in scope reports them. */
  reasoning: number | null;
}

export const ZERO_USAGE: DisplayUsage = {
  input: 0,
  cacheWrite: 0,
  cacheRead: 0,
  output: 0,
  reasoning: null,
};

/** Total raw tokens. Safe to sum because the segments are disjoint. */
export function rawTotal(u: DisplayUsage): number {
  return u.input + u.cacheWrite + u.cacheRead + u.output + (u.reasoning ?? 0);
}

export function addUsage(a: DisplayUsage, b: DisplayUsage): DisplayUsage {
  return {
    input: a.input + b.input,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheRead: a.cacheRead + b.cacheRead,
    output: a.output + b.output,
    // null + null stays null: an aggregate over harnesses that never report
    // reasoning must not present a fabricated zero.
    reasoning:
      a.reasoning === null && b.reasoning === null
        ? null
        : (a.reasoning ?? 0) + (b.reasoning ?? 0),
  };
}

export function sumUsage(list: DisplayUsage[]): DisplayUsage {
  return list.reduce(addUsage, ZERO_USAGE);
}

/**
 * Core `RawUsage` -> `DisplayUsage`, using the sources actually present in the
 * scope to decide whether "reasoning" is reportable at all.
 */
export function displayUsage(
  totals: CoreRawUsage,
  sources: readonly ConsumptionSourceId[]
): DisplayUsage {
  const reportsReasoning = sources.some(
    s => SOURCE_CAPABILITIES[s].reasoningTokens
  );
  return {
    input: totals.inputTokens,
    cacheWrite: totals.cacheWriteTokens,
    cacheRead: totals.cacheReadTokens,
    output: Math.max(0, totals.outputTokens - totals.reasoningTokens),
    reasoning: reportsReasoning ? totals.reasoningTokens : null,
  };
}

/* ------------------------------------------------------------------ */
/* capacity                                                            */
/* ------------------------------------------------------------------ */

/**
 * Freshness of a reported plan window. The corpus scan recovered windows from
 * four months ago sitting beside a live one; a meter that renders a stale
 * window at 1% is lying quietly (see `consumption-spine.md` §4).
 */
export type WindowFreshness = 'live' | 'stale' | 'expired';

/** One reported plan window, projected for display. */
export interface CapacityWindowView {
  /**
   * UNIQUE window-bucket key (provider limitId + scope + window length via
   * core's `planWindowKey`), not the provider's raw limitId: one real
   * limitId carries both a primary and a secondary window, and a collapsed
   * key is how a window disappears or two rows read as the headline.
   */
  limitId: string;
  label: string;
  usedPercent: number;
  windowMinutes: number;
  resetsAtMs: number;
  /** Observed rate at which this window is being consumed, %/hour. */
  burnPercentPerHour: number;
  /** When Exawatt last saw this window state. Omitted by hand-authored fixtures. */
  observedAtMs?: number;
  /**
   * True for a window reported by the vendor's own account endpoint
   * (ENG-038): PLAN truth — it meters everything on the plan, claude.ai chat
   * included, and is never agent-attributable. Surfaces say so once, per
   * source, in one line.
   */
  planLevel?: boolean;
}

/**
 * `live` while the observation is inside the window it describes, `expired`
 * once the window's own reset instant has passed, `stale` when the observation
 * is older than the window it claims to describe.
 */
export function windowFreshness(
  w: CapacityWindowView,
  nowMs: number
): WindowFreshness {
  if (nowMs > w.resetsAtMs) return 'expired';
  if (w.observedAtMs === undefined) return 'live';
  const age = nowMs - w.observedAtMs;
  return age > w.windowMinutes * 60_000 ? 'stale' : 'live';
}

/** Projected window position at reset if the observed pace holds. */
export function projectWindow(w: CapacityWindowView, nowMs: number) {
  const msToReset = Math.max(0, w.resetsAtMs - nowMs);
  const hoursToReset = msToReset / HOUR_MS;
  const projectedPercent = w.usedPercent + w.burnPercentPerHour * hoursToReset;
  const hoursToExhaust =
    w.burnPercentPerHour > 0
      ? (100 - w.usedPercent) / w.burnPercentPerHour
      : Infinity;
  return {
    msToReset,
    hoursToReset,
    projectedPercent,
    hoursToExhaust,
    msToExhaust: hoursToExhaust * HOUR_MS,
    exhaustsBeforeReset: projectedPercent > 100,
  };
}

/**
 * A harness as the capacity surfaces see it. `windows: []` means the harness
 * reports no plan data anywhere on disk — rendered as an empty hatched channel,
 * never as 0%.
 */
export interface ConsumptionSourceView {
  key: string;
  harness: Harness;
  label: string;
  /** Codex reports plan_type; Claude Code reports nothing. */
  planType: string | null;
  credits: number | null;
  windows: CapacityWindowView[];
  /** Always known — observed in the logs regardless of plan reporting. */
  observedTokens5h: number;
  observedSessions: number;
  /**
   * Share of `observedTokens5h` spent by delegated runs. `null` where the
   * harness keeps no delegation record — unavailable, not zero.
   */
  observedDelegatedShare: number | null;
  /** Recent throughput samples, newest last, normalized 0..1. */
  burn: number[];
  /** Why this source has no windows, in the harness's own terms. */
  unreportedReason?: string;
}

/**
 * `PlanWindow` (core) -> `CapacityWindowView`. Returns null for the degenerate
 * records the corpus actually contains — `windowMinutes: 0` and a missing reset
 * instant are both unusable, and dividing by them is how a meter starts lying.
 */
export function capacityWindowFromPlan(
  plan: PlanWindow,
  burnPercentPerHour: number
): CapacityWindowView | null {
  if (plan.windowMinutes <= 0) return null;
  if (!plan.resetsAt) return null;
  const resetsAtMs = Date.parse(plan.resetsAt);
  if (Number.isNaN(resetsAtMs)) return null;
  return {
    limitId: planWindowKey(plan),
    // The provider's own window name wins when it carries one — it is the
    // only thing that can tell two same-length windows apart (Claude's
    // weekly all-models beside weekly Fable; Codex's model-scoped weeklies).
    label: plan.limitName ?? planWindowLabel(plan.windowMinutes),
    usedPercent: plan.usedPercent,
    windowMinutes: plan.windowMinutes,
    resetsAtMs,
    burnPercentPerHour,
    observedAtMs: Date.parse(plan.observedAt),
    ...(plan.origin === 'provider-account' ? { planLevel: true } : {}),
  };
}

/** The one display name for a plan window length — every view reads this. */
export function planWindowLabel(windowMinutes: number): string {
  if (windowMinutes % 10_080 === 0) {
    const weeks = windowMinutes / 10_080;
    return weeks === 1 ? 'Weekly window' : `${weeks}-week window`;
  }
  if (windowMinutes % 1440 === 0) {
    const days = windowMinutes / 1440;
    return days === 1 ? 'Daily window' : `${days}-day window`;
  }
  const hours = Math.round(windowMinutes / 60);
  return hours >= 1 ? `${hours}-hour window` : `${windowMinutes}-minute window`;
}

/* ------------------------------------------------------------------ */
/* rollup helpers                                                      */
/* ------------------------------------------------------------------ */

/** A scope's own (non-delegated) usage, as disjoint display segments. */
export function ownDisplayUsage(rollup: ConsumptionRollup): DisplayUsage {
  const total = displayUsage(rollup.totals, rollup.sources);
  const delegated = displayUsage(rollup.delegated.totals, rollup.sources);
  return {
    input: total.input - delegated.input,
    cacheWrite: total.cacheWrite - delegated.cacheWrite,
    cacheRead: total.cacheRead - delegated.cacheRead,
    output: total.output - delegated.output,
    reasoning:
      total.reasoning === null
        ? null
        : total.reasoning - (delegated.reasoning ?? 0),
  };
}

/**
 * Delegated share of a rollup's weighted burn, or null when no source in the
 * rollup can record delegation at all.
 *
 * A rollup whose sources are ALL delegation-blind returns null (unavailable).
 * A rollup with a mix returns the share and the caller must disclose that some
 * of it is unmeasured — `delegationBlindSources` carries that fact.
 */
export function delegatedWeighted(rollup: ConsumptionRollup): number | null {
  const capable = rollup.sources.some(s => SOURCE_CAPABILITIES[s].delegation);
  return capable ? rollup.delegated.weightedTokens : null;
}

export function delegatedShare(rollup: ConsumptionRollup): number | null {
  const capable = rollup.sources.some(s => SOURCE_CAPABILITIES[s].delegation);
  if (!capable) return null;
  if (rollup.weightedTokens <= 0) return 0;
  return rollup.delegated.weightedTokens / rollup.weightedTokens;
}

/* ------------------------------------------------------------------ */
/* intervention rate (ENG-026 N2)                                      */
/* ------------------------------------------------------------------ */

/**
 * One Session's intervention record. An intervention is an OPERATOR MESSAGE
 * AFTER LAUNCH — the launch instruction is direction, everything after it is
 * a human stepping in. The count is real and cheaply countable: the ENG-023
 * harness event channel already receives `UserPromptSubmit` for Claude Code,
 * and Codex rollouts record every user turn, so no new telemetry exists for
 * this number.
 *
 * The count deliberately cannot tell desired steering from a gap the agent
 * could not cross. It is therefore an UPPER BOUND on "where you had to
 * intervene", and every surface rendering it must say so.
 */
export interface InterventionRow {
  sessionId: string;
  title: string;
  harness: Harness;
  /** Operator messages after launch. 0 is a real, meaningful zero. */
  interventions: number;
  /** Wall-clock span the Session was active, ms. */
  activeMs: number;
  /** Raw tokens the Session consumed, delegated children included. */
  rawTokens: number;
}

export interface InterventionStats {
  sessions: number;
  interventions: number;
  /** Mean interventions per Session. */
  perSession: number;
  /** Interventions per active hour across the scope. */
  perActiveHour: number;
  /** Interventions per 100k raw tokens across the scope. */
  per100kTokens: number;
  /** Raw tokens of agent work per single human touch. Infinity when zero. */
  tokensPerIntervention: number;
  /** Sessions that ran launch-to-finish with no intervention at all. */
  untouchedSessions: number;
  untouchedShare: number;
}

export function interventionStats(
  rows: readonly InterventionRow[]
): InterventionStats {
  const sessions = rows.length;
  const interventions = rows.reduce((n, r) => n + r.interventions, 0);
  const activeHours = rows.reduce((n, r) => n + r.activeMs / HOUR_MS, 0);
  const rawTokens = rows.reduce((n, r) => n + r.rawTokens, 0);
  const untouchedSessions = rows.filter(r => r.interventions === 0).length;
  return {
    sessions,
    interventions,
    perSession: sessions > 0 ? interventions / sessions : 0,
    perActiveHour: activeHours > 0 ? interventions / activeHours : 0,
    per100kTokens: rawTokens > 0 ? interventions / (rawTokens / 100_000) : 0,
    tokensPerIntervention:
      interventions > 0 ? rawTokens / interventions : Infinity,
    untouchedSessions,
    untouchedShare: sessions > 0 ? untouchedSessions / sessions : 0,
  };
}
