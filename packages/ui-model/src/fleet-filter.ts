import type { AgentStatus, ExawattAgent, FleetState } from '@exawatt/core';

export interface FleetFilter {
  /** case-insensitive substring matched against agent name / goal / project */
  query?: string;
  /** if non-empty, only agents whose status is in this set are kept */
  statuses?: AgentStatus[];
}

/**
 * Pure, deterministic narrowing of a FleetState to the agents matching a search
 * query and/or status set. Empty filter returns the original state (identity, so
 * no behavior change when unused). Fleet-wide `metrics` are preserved unchanged —
 * callers that want fleet totals read them from the unfiltered state.
 */
export function filterFleetState(
  state: FleetState,
  filter: FleetFilter = {}
): FleetState {
  const query = filter.query?.trim().toLowerCase() ?? '';
  const statuses =
    filter.statuses && filter.statuses.length
      ? new Set<AgentStatus>(filter.statuses)
      : null;
  if (!query && !statuses) return state;

  const agents: Record<string, ExawattAgent> = {};
  for (const agent of Object.values(state.agents)) {
    // A status filter selects REPORTED states. An Agent whose source said
    // nothing matches none of them, and is not quietly folded into `idle`.
    if (statuses && (agent.status === null || !statuses.has(agent.status)))
      continue;
    if (
      query &&
      !`${agent.name} ${agent.goal} ${agent.project}`
        .toLowerCase()
        .includes(query)
    ) {
      continue;
    }
    agents[agent.id] = agent;
  }
  return { ...state, agents };
}
