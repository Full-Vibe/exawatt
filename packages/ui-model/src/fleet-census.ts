import type {
  AgentDelegatedChild,
  AgentStatus,
  FleetState,
} from '@exawatt/core';
import { filterFleetState, type FleetFilter } from './fleet-filter';

/** Root Agent identity scopes opaque source child IDs; never resolve a bare child ID. */
export function delegatedChildKey(agentId: string, childId: string): string {
  return JSON.stringify([agentId, childId]);
}

export interface FleetCensusChild extends AgentDelegatedChild {
  key: string;
  rootAgentId: string;
}

/** Semantic population, independent of graphical budgets and camera altitude. */
export interface FleetCensus {
  childrenByAgentId: ReadonlyMap<string, readonly FleetCensusChild[]>;
  childrenByKey: ReadonlyMap<string, FleetCensusChild>;
  matchingAgentIds: ReadonlySet<string>;
  contextAgentIds: ReadonlySet<string>;
  visibleAgentIds: ReadonlySet<string>;
  matchingChildKeys: ReadonlySet<string>;
  summary: {
    agentCount: number;
    delegatedCount: number;
    matchingAgentCount: number;
    matchingDelegatedCount: number;
  };
}

/** Search and status must match the same entity. Children only assert live work. */
export function selectFleetCensus(
  state: FleetState,
  filter: FleetFilter = {}
): FleetCensus {
  const query = filter.query?.trim().toLowerCase() ?? '';
  const statuses = filter.statuses?.length
    ? new Set<AgentStatus>(filter.statuses)
    : null;
  const childrenByAgentId = new Map<string, FleetCensusChild[]>();
  const childrenByKey = new Map<string, FleetCensusChild>();
  const matchingAgentIds = new Set(
    Object.keys(filterFleetState(state, filter).agents)
  );
  const contextAgentIds = new Set<string>();
  const visibleAgentIds = new Set<string>();
  const matchingChildKeys = new Set<string>();
  for (const agent of Object.values(state.agents)) {
    const parentMatches = matchingAgentIds.has(agent.id);
    const children: FleetCensusChild[] = [];
    for (const child of agent.delegation?.children ?? []) {
      const key = delegatedChildKey(agent.id, child.id);
      if (childrenByKey.has(key)) continue;
      const member: FleetCensusChild = {
        ...child,
        key,
        rootAgentId: agent.id,
      };
      children.push(member);
      childrenByKey.set(key, member);
      if (
        (!statuses || statuses.has('working')) &&
        (!query ||
          `${child.agentType ?? ''} ${child.description ?? ''}`
            .toLowerCase()
            .includes(query))
      ) {
        matchingChildKeys.add(key);
      }
    }
    // Presence remains evidence: an absent report is not a reported empty list.
    // This transport does not prove completeness or immediate-parent lineage.
    if (agent.delegation) childrenByAgentId.set(agent.id, children);
    const childMatches = children.some(child =>
      matchingChildKeys.has(child.key)
    );
    if (parentMatches || childMatches) visibleAgentIds.add(agent.id);
    if (!parentMatches && childMatches) contextAgentIds.add(agent.id);
  }
  return {
    childrenByAgentId,
    childrenByKey,
    matchingAgentIds,
    contextAgentIds,
    visibleAgentIds,
    matchingChildKeys,
    summary: {
      agentCount: Object.keys(state.agents).length,
      delegatedCount: childrenByKey.size,
      matchingAgentCount: matchingAgentIds.size,
      matchingDelegatedCount: matchingChildKeys.size,
    },
  };
}

/** Preserve layout identity without letting hidden roster changes go stale. */
export function shareFleetCensus(
  previous: FleetCensus,
  next: FleetCensus
): FleetCensus {
  if (
    previous.summary.agentCount !== next.summary.agentCount ||
    previous.summary.delegatedCount !== next.summary.delegatedCount ||
    previous.childrenByAgentId.size !== next.childrenByAgentId.size ||
    !sameSet(previous.matchingAgentIds, next.matchingAgentIds) ||
    !sameSet(previous.contextAgentIds, next.contextAgentIds) ||
    !sameSet(previous.visibleAgentIds, next.visibleAgentIds) ||
    !sameSet(previous.matchingChildKeys, next.matchingChildKeys)
  )
    return next;
  for (const [agentId, children] of next.childrenByAgentId) {
    const before = previous.childrenByAgentId.get(agentId);
    if (!before || before.length !== children.length) return next;
    for (let index = 0; index < children.length; index++) {
      const a = before[index]!;
      const b = children[index]!;
      if (
        a.key !== b.key ||
        a.agentType !== b.agentType ||
        a.description !== b.description ||
        a.startedAt !== b.startedAt
      )
        return next;
    }
  }
  return previous;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every(key => b.has(key));
}
