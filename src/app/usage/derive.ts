/**
 * Derivations for the production `/usage` page (ENG-008).
 *
 * Pure data and pure functions over the one `DemoConsumption` view-model —
 * both corpora (the Personal demo week and the Demo tenant's Voltaic
 * fortnight) flow through here unchanged. Every figure comes off the existing
 * model/rollups, weighted through `@exawatt/core`'s own weight table, never
 * retyped. No React, no DOM.
 *
 * Descended from the ENG-008 design-options workbench
 * (`consumption-redesign/derive.ts`, retired 2026-08-03 — design record in
 * git history and the E8 milestone log); this copy is the production line.
 *
 * Honesty rules carried from the model layer:
 *   - absent is never zero (Claude Code plan windows, Codex delegation,
 *     provider sessions outside the fleet record);
 *   - pace and projection derive from reported window state, and a window's
 *     reconstructed past is labelled scaled, not measured.
 */
import {
  SOURCE_CAPABILITIES,
  isOperatorEntrypoint,
  resolveModelWeight,
  rollupByModel,
  rollupBySource,
  weightUsage,
  type ConsumptionSample,
} from '@exawatt/core';
import type {
  DemoConsumption,
  DemoSessionRollup,
} from '@/components/consumption/demo-source';
import {
  ACCOUNT_LABEL,
  displayUsage,
  planReadState,
  rawTotal,
  sourceOwnerLabel,
  sumUsage,
  unknownPlanSources,
  windowFreshness,
  type AccountSpendView,
  type ConsumptionSourceView,
  type DisplayUsage,
  type Harness,
} from '@/components/consumption/model';
import {
  fleetHasUnknownSource,
  readAllWindows,
  type MeterReading,
} from '@/components/consumption/meter/meter-model';

const LIVE_WITHIN_MS = 45 * 60_000;

/* ------------------------------------------------------------------ */
/* pace — derived once, in meter-model (the shared instrument)         */
/* ------------------------------------------------------------------ */

/**
 * The page renders the SAME reading the chrome meter renders: one derivation
 * (`readWindowPace`), one even-pace band (`PACE_EVEN_BAND`), one freshness
 * discipline (live windows only — a four-month-old window must never
 * headline the page any more than the meter).
 */
export type WindowPace = MeterReading;

/**
 * Every LIVE reported window across every source, tightest first.
 *
 * Each reading carries whether the FLEET holds an unknown source, so the
 * opportunity voice is silenced on a partial picture — the page and the
 * chrome meter gate on the identical fact (`fleetHasUnknownSource`).
 */
export function allPaces(demo: DemoConsumption): WindowPace[] {
  const unknown = fleetHasUnknownSource(demo.sources, demo.nowMs);
  return demo.sources
    .flatMap(s => readAllWindows(s, demo.nowMs, unknown))
    .sort((a, b) => b.usedPercent - a.usedPercent);
}

/**
 * Sources with no live window — rendered absent, never 0%. Three different
 * causes live here and the Headroom band tells them apart through
 * `planReadState`: a capability fact, an off switch, or a failed read.
 */
export function silentSources(demo: DemoConsumption): ConsumptionSourceView[] {
  return demo.sources.filter(
    s => !s.windows.some(w => windowFreshness(w, demo.nowMs) === 'live')
  );
}

/** Sources whose true plan position nobody can currently see. */
export function unknownSources(demo: DemoConsumption): ConsumptionSourceView[] {
  return unknownPlanSources(demo.sources, demo.nowMs);
}

/**
 * The Headroom band's partial-verdict line: names the sources the verdict on
 * screen does NOT cover. Null when it covers everything.
 */
export function unknownVerdictNote(
  demo: DemoConsumption
): string | null {
  const unknown = unknownSources(demo);
  if (unknown.length === 0) return null;
  const names = unknown.map(sourceOwnerLabel);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const allOff = unknown.every(s => planReadState(s, demo.nowMs) === 'off');
  return allOff
    ? `${list} ${names.length === 1 ? 'is' : 'are'} turned off — this verdict covers the sources that reported.`
    : `${list} ${names.length === 1 ? 'is' : 'are'} not readable — this verdict covers the sources that reported.`;
}

/** Vendor-account plan-credit spend, per source that reports it (ENG-038). */
export interface PlanCreditRow {
  key: Harness;
  /** The ACCOUNT's name, never the harness's — this is account truth. */
  label: string;
  spend: AccountSpendView;
}

export function planCreditRows(demo: DemoConsumption): PlanCreditRow[] {
  const out: PlanCreditRow[] = [];
  for (const source of demo.sources) {
    const spend = source.accountRead?.spend;
    if (!spend) continue;
    out.push({
      key: source.harness,
      label: ACCOUNT_LABEL[source.harness],
      spend,
    });
  }
  return out;
}

/**
 * Windows that are genuinely overheating: spent, projected to exhaust before
 * their reset, or running hot. The Heat band renders exactly this list — the
 * page's only alarm state, in the consumption channel's hot color.
 */
export function heatWindows(paces: WindowPace[]): WindowPace[] {
  return paces.filter(
    p => p.exhaustsBeforeReset || p.state === 'hot' || p.state === 'exhausted'
  );
}

/* ------------------------------------------------------------------ */
/* spend — modelled dollars, stated basis                              */
/* ------------------------------------------------------------------ */

export interface SpendView {
  /** Operator-session weighted tokens over the corpus window. */
  operatorWeighted: number;
  /** Per-source split of `operatorWeighted`, largest first. */
  bySource: Array<{ key: Harness; label: string; weighted: number }>;
  /** Machine-invoked overhead (entrypoint-separated), weighted. */
  overheadWeighted: number;
}

export function spendView(demo: DemoConsumption, rows: GridRow[]): SpendView {
  const bySource = new Map<Harness, number>();
  let operatorWeighted = 0;
  for (const r of rows) {
    operatorWeighted += r.weighted;
    bySource.set(r.source, (bySource.get(r.source) ?? 0) + r.weighted);
  }
  return {
    operatorWeighted,
    bySource: [...bySource.entries()]
      .map(([key, weighted]) => ({
        key,
        label: SOURCE_LABEL[key] ?? key,
        weighted,
      }))
      .sort((a, b) => b.weighted - a.weighted),
    overheadWeighted: demo.overhead.rollup?.weightedTokens ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* samples                                                             */
/* ------------------------------------------------------------------ */

export function operatorSamples(demo: DemoConsumption): ConsumptionSample[] {
  return demo.samples.filter(s => isOperatorEntrypoint(s.entrypoint));
}

/** Operator samples indexed by provider session id (children included). */
export function sampleIndex(
  demo: DemoConsumption
): Map<string, ConsumptionSample[]> {
  const out = new Map<string, ConsumptionSample[]>();
  for (const s of demo.samples) {
    if (!isOperatorEntrypoint(s.entrypoint)) continue;
    const list = out.get(s.providerSessionId);
    if (list) list.push(s);
    else out.set(s.providerSessionId, [s]);
  }
  return out;
}

/** Weighted burn across one Session's own span, normalized 0..1. */
function sessionSpark(
  samples: ConsumptionSample[],
  fromMs: number,
  toMs: number,
  buckets = 14
): number[] {
  const span = Math.max(1, toMs - fromMs);
  const values = new Array<number>(buckets).fill(0);
  for (const s of samples) {
    const at = Date.parse(s.at);
    const i = Math.max(
      0,
      Math.min(buckets - 1, Math.floor(((at - fromMs) / span) * buckets))
    );
    values[i] += weightUsage(s.usage, resolveModelWeight(s.model).weight);
  }
  const peak = Math.max(...values, 1);
  return values.map(v => v / peak);
}

/**
 * A window's position over its own span, reconstructed from observed burn and
 * SCALED so the last point equals the harness's reported percent. The chart
 * rendering this must carry the "scaled to reported" label — the shape is
 * measured, the y-axis anchor is the harness's own figure.
 */
export function windowTimeline(
  pace: WindowPace,
  samples: ConsumptionSample[],
  nowMs: number,
  points = 48
): Array<{ t: number; pct: number }> {
  const startMs = pace.window.resetsAtMs - pace.window.windowMinutes * 60_000;
  const spanMs = Math.max(1, nowMs - startMs);
  const step = spanMs / (points - 1);
  const cumulative = new Array<number>(points).fill(0);
  for (const s of samples) {
    if (s.source !== pace.source.harness) continue;
    const at = Date.parse(s.at);
    if (at < startMs || at > nowMs) continue;
    const i = Math.min(points - 1, Math.floor((at - startMs) / step));
    cumulative[i] += weightUsage(s.usage, resolveModelWeight(s.model).weight);
  }
  for (let i = 1; i < points; i += 1) cumulative[i] += cumulative[i - 1];
  const total = cumulative[points - 1];
  return cumulative.map((v, i) => ({
    t: startMs + i * step,
    pct:
      total > 0
        ? (v / total) * pace.window.usedPercent
        : (i / (points - 1)) * pace.window.usedPercent,
  }));
}

/* ------------------------------------------------------------------ */
/* the session grid — every operator session, one row each             */
/* ------------------------------------------------------------------ */

export const SOURCE_LABEL: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
};

/**
 * One operator session as the grid renders it. `identified: false` marks a
 * provider session present in the local logs but absent from the fleet
 * record (Voltaic's fourteen-day history) — its figures are measured from
 * samples; its title, interventions, and delegation are honestly absent.
 */
export interface GridRow {
  id: string;
  title: string;
  identified: boolean;
  source: Harness;
  model: string | null;
  /** Primary model plus any delegated-run models, for the model pivot. */
  models: string[];
  projectKey: string | null;
  projectName: string | null;
  /** Project identity color — identity only, rendered as a thin tick. */
  identityColor?: string;
  startedAtMs: number;
  lastAtMs: number;
  usage: DisplayUsage;
  raw: number;
  weighted: number;
  /** Delegated agents booked to this session; null = no record kept. */
  agents: number | null;
  /** Operator messages after launch; null = no session record for this id. */
  interventions: number | null;
  /** Model context window in tokens; null where the source reports none. */
  contextWindow: number | null;
  /** Peak context footprint in tokens; null = not recorded (never zero). */
  contextPeakTokens: number | null;
  /** Context compactions during the run; null = not recorded. */
  compactions: number | null;
  live: boolean;
  spark: number[];
}

function specRows(demo: DemoConsumption): DemoSessionRollup[] {
  return [...demo.roadmap.flatMap(r => r.sessions), ...demo.unattributedSessions];
}

export function gridRows(demo: DemoConsumption): GridRow[] {
  const index = sampleIndex(demo);
  const byKey = new Map(demo.projects.map(p => [p.project.key, p.project]));
  const rows: GridRow[] = [];
  const covered = new Set<string>();

  for (const s of specRows(demo)) {
    covered.add(s.spec.id);
    const usage = displayUsage(s.rollup.totals, s.rollup.sources);
    const project = s.spec.projectKey ? byKey.get(s.spec.projectKey) : undefined;
    const capable = SOURCE_CAPABILITIES[s.spec.source].delegation;
    const samples = index.get(s.spec.id) ?? [];
    rows.push({
      id: s.spec.id,
      title: s.spec.title,
      identified: true,
      source: s.spec.source,
      model: s.spec.model,
      models: [s.spec.model, ...s.spec.delegated.map(d => d.model)],
      projectKey: s.spec.projectKey ?? null,
      projectName: project?.name ?? null,
      identityColor: project?.color,
      startedAtMs: s.spec.startedAtMs,
      lastAtMs: s.spec.lastAtMs,
      usage,
      raw: rawTotal(usage),
      weighted: s.rollup.weightedTokens,
      agents: capable ? s.rollup.delegated.agents : null,
      interventions: s.spec.interventions,
      contextWindow:
        samples.find(x => x.contextWindow !== null)?.contextWindow ?? null,
      contextPeakTokens: s.spec.contextPeakTokens ?? null,
      compactions: s.spec.compactions ?? null,
      live: demo.nowMs - s.spec.lastAtMs < LIVE_WITHIN_MS,
      spark: sessionSpark(samples, s.spec.startedAtMs, s.spec.lastAtMs),
    });
  }

  // Provider sessions in the logs but outside the fleet record: measured
  // figures, absent identity — shown, never folded away.
  for (const [id, samples] of index) {
    if (covered.has(id)) continue;
    const rollup = demo.sessionsById.get(id);
    const usage = rollup
      ? displayUsage(rollup.totals, rollup.sources)
      : sumUsage(
          samples.map(s =>
            displayUsage(s.usage, [s.source])
          )
        );
    const times = samples.map(s => Date.parse(s.at));
    const startedAtMs = Math.min(...times);
    const lastAtMs = Math.max(...times);
    const source = samples[0].source;
    const cwd = samples.find(s => s.cwd !== null)?.cwd ?? null;
    // The corpus's own worktree-aware resolution — the same attribution the
    // Project rollups used, so an outside-record row and the Project pivot
    // can never disagree about where a launch directory belongs.
    const resolved = cwd ? demo.resolveProject(cwd) : null;
    const project = resolved ? byKey.get(resolved.id) : undefined;
    const models = [
      ...new Set(samples.flatMap(s => (s.model ? [s.model] : []))),
    ];
    rows.push({
      id,
      title: `Session ${id.slice(0, 8)}`,
      identified: false,
      source,
      model: models[0] ?? null,
      models,
      projectKey: project?.key ?? null,
      projectName: project?.name ?? null,
      identityColor: project?.color,
      startedAtMs,
      lastAtMs,
      usage,
      raw: rawTotal(usage),
      weighted:
        rollup?.weightedTokens ??
        samples.reduce(
          (n, s) => n + weightUsage(s.usage, resolveModelWeight(s.model).weight),
          0
        ),
      agents: null,
      interventions: null,
      contextWindow:
        samples.find(x => x.contextWindow !== null)?.contextWindow ?? null,
      contextPeakTokens: null,
      compactions: null,
      live: demo.nowMs - lastAtMs < LIVE_WITHIN_MS,
      spark: sessionSpark(samples, startedAtMs, lastAtMs),
    });
  }

  return rows.sort((a, b) => b.weighted - a.weighted);
}

/* ------------------------------------------------------------------ */
/* attribution pivot — rows are doors                                  */
/* ------------------------------------------------------------------ */

export type PivotKey = 'project' | 'session' | 'model' | 'source' | 'roadmap';

export const PIVOT_LABEL: Record<PivotKey, string> = {
  project: 'Project',
  session: 'Session',
  model: 'Model',
  source: 'Source',
  roadmap: 'Roadmap item',
};

/** A session listed behind a pivot row — what the drill panel shows. */
export interface DrillSession {
  id: string;
  title: string;
  sourceLabel: string;
  model: string | null;
  weighted: number;
  raw: number;
  agents: number | null;
  interventions: number | null;
  /** Context-window pressure: window size, peak footprint, compactions.
   *  null = not recorded by the source — rendered absent, never zero. */
  contextWindow: number | null;
  contextPeakTokens: number | null;
  compactions: number | null;
  liveNow: boolean;
}

export interface PivotRow {
  id: string;
  label: string;
  meta?: string;
  /** Project identity color — identity only, rendered as a thin tick. */
  identity?: string;
  usage: DisplayUsage;
  weighted: number;
  sessions: number;
  /** True for the no-attribution rows: rendered neutral, never in the ramp. */
  unknown?: boolean;
  drill: DrillSession[];
}

export function drillOf(rows: GridRow[]): DrillSession[] {
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    sourceLabel: SOURCE_LABEL[r.source] ?? r.source,
    model: r.model,
    weighted: r.weighted,
    raw: r.raw,
    agents: r.agents,
    interventions: r.interventions,
    contextWindow: r.contextWindow,
    contextPeakTokens: r.contextPeakTokens,
    compactions: r.compactions,
    liveNow: r.live,
  }));
}

function bucket(
  id: string,
  label: string,
  meta: string,
  rows: GridRow[]
): PivotRow {
  return {
    id,
    label,
    meta,
    usage: sumUsage(rows.map(r => r.usage)),
    weighted: rows.reduce((n, r) => n + r.weighted, 0),
    sessions: rows.length,
    unknown: true,
    drill: drillOf(rows),
  };
}

export function pivotRows(
  demo: DemoConsumption,
  key: PivotKey,
  rows: GridRow[]
): PivotRow[] {
  const out: PivotRow[] = [];

  if (key === 'project') {
    for (const { project, rollup } of demo.projects) {
      if (!rollup) continue;
      const mine = rows.filter(r => r.projectKey === project.key);
      out.push({
        id: project.key,
        label: project.name,
        meta: project.dir,
        identity: project.color,
        usage: displayUsage(rollup.totals, rollup.sources),
        weighted: rollup.weightedTokens,
        sessions: rollup.sessionCount,
        drill: drillOf(mine),
      });
    }
    const none = rows.filter(r => r.projectKey === null);
    if (none.length > 0) {
      out.push(
        bucket(
          'no-project',
          'No Project',
          'launch directory outside every known Project root',
          none
        )
      );
    }
  }

  if (key === 'session') {
    for (const r of rows) {
      out.push({
        id: r.id,
        label: r.title,
        meta: `${SOURCE_LABEL[r.source] ?? r.source}${r.model ? ` · ${r.model}` : ''}`,
        usage: r.usage,
        weighted: r.weighted,
        sessions: 1,
        unknown: !r.identified,
        drill: drillOf([r]),
      });
    }
  }

  if (key === 'model' || key === 'source') {
    const operator = operatorSamples(demo);
    const result =
      key === 'model' ? rollupByModel(operator) : rollupBySource(operator);
    for (const rollup of result.rollups) {
      const id = rollup.scope.id;
      const mine = rows.filter(r =>
        key === 'source' ? r.source === id : r.models.includes(id)
      );
      out.push({
        id,
        label:
          key === 'source'
            ? (SOURCE_LABEL[id] ?? rollup.scope.label)
            : rollup.scope.label,
        usage: displayUsage(rollup.totals, rollup.sources),
        weighted: rollup.weightedTokens,
        sessions: rollup.sessionCount,
        drill: drillOf(mine),
      });
    }
  }

  if (key === 'roadmap') {
    const rowById = new Map(rows.map(r => [r.id, r]));
    const linked = new Set<string>();
    for (const item of demo.roadmap) {
      for (const s of item.sessions) linked.add(s.spec.id);
      if (!item.rollup) continue;
      out.push({
        id: item.item.id,
        label: `${item.item.id} · ${item.item.title}`,
        meta:
          item.inferredWeighted > 0
            ? 'part inferred from branch or title'
            : 'declared at launch',
        usage: displayUsage(item.rollup.totals, item.rollup.sources),
        weighted: item.rollup.weightedTokens,
        sessions: item.sessions.length,
        drill: drillOf(
          item.sessions.flatMap(s => {
            const r = rowById.get(s.spec.id);
            return r ? [r] : [];
          })
        ),
      });
    }
    const unlinked = rows.filter(r => !linked.has(r.id));
    if (unlinked.length > 0) {
      out.push(
        bucket(
          'unattributed',
          'Not attributed',
          'no declared or inferred roadmap link',
          unlinked
        )
      );
    }
  }

  return out.sort((a, b) => b.weighted - a.weighted);
}

/* ------------------------------------------------------------------ */
/* diagnostics — one quiet row                                         */
/* ------------------------------------------------------------------ */

export type DiagnosticState = 'steady' | 'watch' | 'not-recorded';

export interface Diagnostic {
  key: string;
  label: string;
  value: string;
  state: DiagnosticState;
  /** Short reading, production voice — rendered as a tooltip, not prose. */
  hint: string;
  /** 0..1 for the mini bar; omitted when the figure is not a share. */
  share?: number;
}

const rate1 = (n: number) => (n >= 10 ? Math.round(n).toString() : n.toFixed(1));

/** Corpus window as the short qualifier the tile labels carry. */
const WINDOW_SHORT: Record<string, string> = {
  'seven days': '7d',
  'fourteen days': '14d',
};

export function diagnostics(demo: DemoConsumption): Diagnostic[] {
  // Every tile states its window, the way the delegated tile always did:
  // corpus-window figures carry the corpus window, the 5h figure carries 5h.
  const win = WINDOW_SHORT[demo.windowLabel] ?? demo.windowLabel;
  const usage = displayUsage(demo.workspace.totals, demo.workspace.sources);
  const raw = rawTotal(usage);
  const prompt = usage.input + usage.cacheWrite + usage.cacheRead;
  const missShare = prompt > 0 ? (usage.input + usage.cacheWrite) / prompt : 0;
  const reread = usage.cacheWrite > 0 ? usage.cacheRead / usage.cacheWrite : 0;
  const generated = usage.output + (usage.reasoning ?? 0);
  const reasoningShare =
    usage.reasoning !== null && generated > 0
      ? usage.reasoning / generated
      : null;
  const claude = demo.sources.find(s => s.harness === 'claude-code');
  const delegated = claude?.observedDelegatedShare ?? null;
  const overheadRaw = demo.overhead.rollup
    ? rawTotal(
        displayUsage(demo.overhead.rollup.totals, demo.overhead.rollup.sources)
      )
    : 0;
  const overheadShare = overheadRaw / Math.max(1, overheadRaw + raw);
  const iv = demo.interventions.total;

  const out: Diagnostic[] = [
    {
      key: 'cache-miss',
      label: `Cache-miss share · ${win}`,
      value: `${Math.round(missShare * 100)}%`,
      state: missShare > 0.2 ? 'watch' : 'steady',
      hint:
        missShare > 0.2
          ? 'fresh context is being rebuilt — check for cold restarts'
          : 'prompts are mostly served from cache',
      share: missShare,
    },
    {
      key: 'reread',
      label: `Cache re-read · ${win}`,
      value: `${reread.toFixed(1)}× per write`,
      state: 'steady',
      hint: 'every cached write is re-read this many times',
    },
  ];
  if (reasoningShare !== null) {
    out.push({
      key: 'reasoning',
      label: `Reasoning share · ${win}`,
      value: `${Math.round(reasoningShare * 100)}%`,
      state: reasoningShare > 0.75 ? 'watch' : 'steady',
      hint:
        reasoningShare > 0.75
          ? 'of generated tokens — effort setting may be above the task'
          : 'of generated tokens — within the usual band for this effort mix',
      share: reasoningShare,
    });
  }
  out.push(
    delegated === null
      ? {
          key: 'delegated',
          label: 'Delegated share · 5h',
          value: 'not recorded',
          state: 'not-recorded',
          hint: 'this harness keeps no delegation record',
        }
      : {
          key: 'delegated',
          label: 'Delegated share · 5h',
          value: `${Math.round(delegated * 100)}%`,
          state: 'steady',
          hint: 'of Claude Code burn — children are booked against their parent Session',
          share: delegated,
        }
  );
  out.push(
    iv.sessions === 0
      ? {
          // No session in scope carries an intervention record (the live
          // read until the snapshot carries counts): absent, never zero.
          key: 'interventions',
          label: `Intervention rate · ${win}`,
          value: 'not recorded',
          state: 'not-recorded',
          hint: 'no session in this window carries an intervention record',
        }
      : {
          key: 'interventions',
          label: `Intervention rate · ${win}`,
          value: `${rate1(iv.perSession)} per Session`,
          state: 'steady',
          hint: `${iv.interventions} operator messages after launch across ${iv.sessions} Sessions · ${rate1(iv.perActiveHour)} per active hour · ${iv.untouchedSessions} Sessions ran untouched · an upper bound: steering and a stuck agent arrive the same way`,
          share: iv.sessions > 0 ? 1 - iv.untouchedShare : undefined,
        }
  );
  out.push({
    key: 'overhead',
    label: `Exawatt overhead · ${win}`,
    value: `${(overheadShare * 100).toFixed(1)}% of raw`,
    state: 'steady',
    hint: `${demo.overhead.sessionCount} machine-invoked calls, separated by entrypoint, never booked to a Project`,
    share: overheadShare,
  });
  return out;
}
