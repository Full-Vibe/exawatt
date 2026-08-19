import type { AgentStatus, AgentWorkState, ExawattAgent } from '../types/agent';
import type { FleetState } from '../types/fleet';
import type {
  ContextGroup,
  ContextGroupKind,
  ProjectSummary,
  ResolveContextGroupsOptions,
} from '../types/project';

const STATUS_RANK: Record<AgentStatus, number> = {
  blocked: 0,
  error: 0,
  reviewing: 1,
  working: 2,
  complete: 3,
  idle: 4,
};

/**
 * Where a coworker nobody has heard from sorts: after every reported state.
 *
 * The rank is an attention order, and silence asks for nothing. Ranking it
 * alongside `idle` would be the same claim by another route — it would put an
 * Agent whose source said nothing in the same breath as one reported to be
 * quietly waiting.
 */
const UNREPORTED_RANK = STATUS_RANK.idle + 1;

function rankOf(status: AgentWorkState): number {
  return status === null ? UNREPORTED_RANK : STATUS_RANK[status];
}

const GROUPING_KEY: Record<string, (a: ExawattAgent) => string> = {
  project: a => a.project,
};

function sortAgentsForCluster(a: ExawattAgent, b: ExawattAgent): number {
  const d = rankOf(a.status) - rankOf(b.status);
  if (d !== 0) return d;
  if (b.lastActivityAt !== a.lastActivityAt)
    return b.lastActivityAt - a.lastActivityAt;
  return a.name.localeCompare(b.name);
}

/**
 * Pure, deterministic. Groups agents into Context Groups by the active rule.
 * attentionPressure = clamp01((blocked*3 + reviewing*1) / (agentCount*3)).
 *
 * This is a derived LENS over `state.agents` — it is never stored on FleetState
 * and never becomes a structural parent of Agent. The same resolver feeds both
 * the DOM and 3D fleet surfaces so they cluster identically.
 */
export function resolveContextGroups(
  state: FleetState,
  options: ResolveContextGroupsOptions = {}
): ContextGroup[] {
  const kind: ContextGroupKind = options.kind ?? 'project';
  const ungrouped = options.ungroupedLabel ?? 'Unassigned';
  const keyOf = GROUPING_KEY[kind] ?? GROUPING_KEY.project!;

  const buckets = new Map<string, { label: string; agents: ExawattAgent[] }>();
  if (kind === 'project') {
    for (const project of options.projects ?? []) {
      const id = project.id.trim();
      if (!id || buckets.has(id)) continue;
      buckets.set(id, {
        label: project.label.trim() || id,
        agents: [],
      });
    }
  }
  for (const agent of Object.values(state.agents)) {
    const label = keyOf(agent)?.trim() || ungrouped;
    const id = kind === 'project' ? agent.projectId?.trim() || label : label;
    const bucket = buckets.get(id);
    if (bucket) bucket.agents.push(agent);
    else buckets.set(id, { label, agents: [agent] });
  }

  const groups: ContextGroup[] = [...buckets.entries()].map(([id, bucket]) => {
    const { label, agents } = bucket;
    const sorted = [...agents].sort(sortAgentsForCluster);
    let active = 0;
    let blocked = 0;
    let idle = 0;
    let costRate = 0;
    let totalCost = 0;
    // Null until a coworker reports something. A cluster whose sources have
    // all gone quiet has no dominant work state, and an empty cluster never
    // had one; both used to read as `idle`, which is a claim neither earned.
    let dominant: AgentWorkState = null;
    for (const a of sorted) {
      if (a.status === 'working' || a.status === 'reviewing') active++;
      else if (a.status === 'blocked' || a.status === 'error') blocked++;
      // `idle` counts Agents REPORTED to be resting. A null work state joins
      // no bucket: the counts describe what sources said, so the three of
      // them are free to sum to less than `agentCount`.
      else if (a.status !== null) idle++;
      costRate += a.metrics.costRate;
      totalCost += a.metrics.estimatedCost;
      if (rankOf(a.status) < rankOf(dominant)) dominant = a.status;
    }
    const reviewing = sorted.filter(a => a.status === 'reviewing').length;
    const denom = Math.max(1, sorted.length * 3);
    const attentionPressure = Math.min(1, (blocked * 3 + reviewing) / denom);
    const summary: ProjectSummary = {
      agentCount: sorted.length,
      activeCount: active,
      blockedCount: blocked,
      idleCount: idle,
      costRate: Number(costRate.toFixed(4)),
      totalCost: Number(totalCost.toFixed(4)),
      attentionPressure: Number(attentionPressure.toFixed(4)),
      dominantStatus: dominant,
    };
    return {
      clusterId: `${kind}:${id}`,
      kind,
      label,
      agentIds: sorted.map(a => a.id),
      summary,
    };
  });

  // Deterministic baseline order by label; ui-model re-sorts by pressure for layout.
  return groups.sort((a, b) => a.label.localeCompare(b.label));
}
