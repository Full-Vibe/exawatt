import type { AgentStatus } from '@exawatt/core';

export type AgentFieldRegime = 'fleet' | 'project' | 'agent';

export interface FieldAgent {
  id: string;
  name: string;
  status: AgentStatus;
  /** index of the owning Project cluster */
  cluster: number;
  /** absolute world position in the Fleet overview */
  x: number;
  y: number;
  /** optional concise goal/activity line for the readable Project regime */
  detail?: string;
  /** last activity timestamp (unix ms) — a change triggers a finite blip */
  activityAt?: number;
}

export interface ClusterInfo {
  index: number;
  /** stable id of the underlying Project / Context Group */
  id: string;
  label: string;
  cx: number;
  cy: number;
  /** bounding radius of the Fleet-overview agent disc */
  radius: number;
  count: number;
  dominant: AgentStatus;
  attention: number;
  critical: boolean;
  statLine?: string;
}

export interface FieldGroupAgent {
  id: string;
  name: string;
  status: AgentStatus;
  detail?: string;
  activityAt?: number;
}

export interface FieldGroupSpec {
  id: string;
  label: string;
  agents: FieldGroupAgent[];
  critical?: boolean;
  countOverride?: number;
  attentionOverride?: number;
  statLine?: string;
}

export interface FieldHero {
  agentId: string;
  title: string;
  reason: string;
}
