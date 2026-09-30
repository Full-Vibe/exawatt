/**
 * Derivations for the Usage Analytics tab (ENG-008 E15).
 *
 * Pure data and pure functions over the one `DemoConsumption` view-model:
 * every corpus (the Personal live read, the demo week, the Demo tenant's
 * Voltaic fortnight) flows through here unchanged. Figures come off the
 * existing rollups, weighted through `@exawatt/core`'s own weight table,
 * never retyped. No React, no DOM.
 *
 * The account bars do not live here: they are `usageOverview` in
 * `@/components/consumption/accounts`, shared with the chrome meter.
 *
 * Honesty rules carried from the model layer: absent is never zero (Codex
 * delegation, provider sessions outside the fleet record), and a session
 * outside the fleet record keeps its measured figures with absent identity.
 */
import {
  SOURCE_CAPABILITIES,
  isOperatorEntrypoint,
  resolveModelWeight,
  weightUsage,
  type ConsumptionSample,
} from '@exawatt/core';
import type {
  DemoConsumption,
  DemoSessionRollup,
} from '@/components/consumption/demo-source';
import {
  HARNESS_LABEL,
  displayUsage,
  rawTotal,
  sumUsage,
  type DisplayUsage,
  type Harness,
} from '@/components/consumption/model';

const LIVE_WITHIN_MS = 45 * 60_000;

/* ------------------------------------------------------------------ */
/* samples                                                             */
/* ------------------------------------------------------------------ */

/** Operator samples indexed by provider session id (children included). */
function sampleIndex(
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

/* ------------------------------------------------------------------ */
/* the session grid — every operator session, one row each             */
/* ------------------------------------------------------------------ */

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
}

function specRows(demo: DemoConsumption): DemoSessionRollup[] {
  return [
    ...demo.roadmap.flatMap(r => r.sessions),
    ...demo.unattributedSessions,
  ];
}

export function gridRows(demo: DemoConsumption): GridRow[] {
  const index = sampleIndex(demo);
  const byKey = new Map(demo.projects.map(p => [p.project.key, p.project]));
  const rows: GridRow[] = [];
  const covered = new Set<string>();

  for (const s of specRows(demo)) {
    covered.add(s.spec.id);
    const usage = displayUsage(s.rollup.totals, s.rollup.sources);
    const project = s.spec.projectKey
      ? byKey.get(s.spec.projectKey)
      : undefined;
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
    });
  }

  // Provider sessions in the logs but outside the fleet record: measured
  // figures, absent identity — shown, never folded away.
  for (const [id, samples] of index) {
    if (covered.has(id)) continue;
    const rollup = demo.sessionsById.get(id);
    const usage = rollup
      ? displayUsage(rollup.totals, rollup.sources)
      : sumUsage(samples.map(s => displayUsage(s.usage, [s.source])));
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
          (n, s) =>
            n + weightUsage(s.usage, resolveModelWeight(s.model).weight),
          0
        ),
      agents: null,
      interventions: null,
      contextWindow:
        samples.find(x => x.contextWindow !== null)?.contextWindow ?? null,
      contextPeakTokens: null,
      compactions: null,
      live: demo.nowMs - lastAtMs < LIVE_WITHIN_MS,
    });
  }

  return rows.sort((a, b) => b.weighted - a.weighted);
}

/* ------------------------------------------------------------------ */
/* attribution pivot — rows are doors                                  */
/* ------------------------------------------------------------------ */

export type PivotKey = 'project' | 'session';

export const PIVOT_LABEL: Record<PivotKey, string> = {
  project: 'By project',
  session: 'By agent',
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

function drillOf(rows: GridRow[]): DrillSession[] {
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    sourceLabel: HARNESS_LABEL[r.source],
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
        meta: `${HARNESS_LABEL[r.source]}${r.model ? ` · ${r.model}` : ''}`,
        usage: r.usage,
        weighted: r.weighted,
        sessions: 1,
        unknown: !r.identified,
        drill: drillOf([r]),
      });
    }
  }

  return out.sort((a, b) => b.weighted - a.weighted);
}

/**
 * Why a pivot has nothing to show, stated instead of rendered as an empty
 * band or a single grey bar.
 *
 * One grey bar reads as a measurement; this says it is a missing input.
 */
export function pivotAbsenceNote(
  key: PivotKey,
  rows: PivotRow[]
): string | null {
  if (rows.length === 0) return 'Nothing to attribute in this window.';
  const onlyUnknown = rows.every(r => r.unknown);
  if (!onlyUnknown) return null;
  if (key === 'project') {
    return 'No session in this window resolves to a known Project.';
  }
  return null;
}
