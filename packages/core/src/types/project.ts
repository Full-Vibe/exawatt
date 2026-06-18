/**
 * Project / Context Group — a RESOLVABLE grouping LENS over agents.
 *
 * This is NOT a structural parent of Agent. Agents are grouped on demand by a
 * grouping rule (currently their `project` string). `clusterId` is the stable
 * key for the resolved group; `kind` records which rule produced it so future
 * rules slot in without changing consumers. The planned Initiative->Agent
 * hierarchy is orthogonal and may later surface as a non-authoritative
 * projection via `kind: 'initiative'` — it must never become a stored parent here.
 */

import type { AgentStatus } from './agent';

export type ContextGroupKind =
  | 'project' // grouped by ExawattAgent.project string (the only rule wired in V0.1)
  | 'initiative' // future: non-authoritative projection of an Initiative
  | 'repository' // future
  | 'customer' // future
  | 'context-signal' // future
  | 'semantic' // future
  | 'manual'; // future: explicit operator grouping

export interface ProjectSummary {
  agentCount: number;
  /** working + reviewing */
  activeCount: number;
  /** blocked + error */
  blockedCount: number;
  /** idle + complete */
  idleCount: number;
  /** sum of agent costRate ($/hr) */
  costRate: number;
  /** cumulative USD; mirrors FleetMetrics.costByProject[label] */
  totalCost: number;
  /** 0..1 attention pressure; blockers weighted heavily, computed in resolver */
  attentionPressure: number;
  /** worst agent status in the cluster, for the boundary tint */
  dominantStatus: AgentStatus;
}

/** A resolved grouping LENS over agents — derived, never stored. */
export interface ContextGroup {
  /** Stable id within the active rule, e.g. `project:OpenClaw Local Parity`. */
  clusterId: string;
  /** Which grouping rule produced this group. Always 'project' in V0.1. */
  kind: ContextGroupKind;
  /** Human-facing label (the project string in V0.1). */
  label: string;
  /** Agent ids in this group, status-priority sorted (see resolver). */
  agentIds: string[];
  /** Aggregate pressure/health for at-a-glance reading. */
  summary: ProjectSummary;
}

/** In V0.1 a ContextGroup of kind 'project' is presented in UI as a Project. */
export type Project = ContextGroup;

export interface ResolveContextGroupsOptions {
  /** Active grouping rule. Only 'project' is implemented in V0.1. */
  kind?: ContextGroupKind;
  /** Label for agents with no value under the active rule. Default 'Unassigned'. */
  ungroupedLabel?: string;
}
