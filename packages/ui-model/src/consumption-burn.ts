/**
 * Fleet consumption burn view (ENG-008 attribution).
 *
 * The ONE normalization both consumption-bearing surfaces read: the Team
 * exposé tiles and the Fleet board's burn lens. Input is per-agent totals a
 * source actually reported (`AgentMetrics.rawTokens` / `normalizedTokens`,
 * fed by the Demo transport from `demoAgentBurn`; the live local transport
 * reports neither yet). Agents without reported figures stay OUT of the view
 * — unreported is absent, never zero, per consumption canon.
 *
 * Two ratios come out per agent:
 * - `share` — this agent's slice of the scope's normalized total (an honest
 *   "where did it go" figure);
 * - `intensity` — normalized against the hottest reporting agent (the color
 *   ramp / bar-length figure, so the busiest session anchors full scale).
 */

import type { ExawattAgent, FleetState } from '@exawatt/core';

export interface AgentBurnEntry {
  agentId: string;
  /** Raw tokens across all units, delegated runs included. */
  rawTokens: number;
  /** Model-size-weighted tokens (the E3 compute proxy). */
  normalizedTokens: number;
  /** Slice of the scope's normalized total, 0..1. */
  share: number;
  /** Against the hottest reporting agent in scope, 0..1. */
  intensity: number;
}

export interface FleetBurnView {
  byAgent: ReadonlyMap<string, AgentBurnEntry>;
  totalNormalizedTokens: number;
  maxNormalizedTokens: number;
  reportedCount: number;
  /** Agents in scope whose source reported no usage — omitted, not zeroed. */
  unreportedCount: number;
}

export interface AgentBurnInput {
  id: string;
  rawTokens?: number | undefined;
  normalizedTokens?: number | undefined;
}

const EMPTY: FleetBurnView = {
  byAgent: new Map(),
  totalNormalizedTokens: 0,
  maxNormalizedTokens: 0,
  reportedCount: 0,
  unreportedCount: 0,
};

/** Pure normalization over any agent scope. Order-independent. */
export function computeAgentBurn(
  agents: readonly AgentBurnInput[]
): FleetBurnView {
  const reported = agents.filter(
    agent =>
      agent.normalizedTokens !== undefined && agent.normalizedTokens >= 0
  );
  if (reported.length === 0) {
    return { ...EMPTY, unreportedCount: agents.length };
  }
  let total = 0;
  let max = 0;
  for (const agent of reported) {
    total += agent.normalizedTokens!;
    max = Math.max(max, agent.normalizedTokens!);
  }
  const byAgent = new Map<string, AgentBurnEntry>();
  for (const agent of reported) {
    const normalized = agent.normalizedTokens!;
    byAgent.set(agent.id, {
      agentId: agent.id,
      rawTokens: agent.rawTokens ?? 0,
      normalizedTokens: normalized,
      share: total > 0 ? normalized / total : 0,
      intensity: max > 0 ? normalized / max : 0,
    });
  }
  return {
    byAgent,
    totalNormalizedTokens: total,
    maxNormalizedTokens: max,
    reportedCount: reported.length,
    unreportedCount: agents.length - reported.length,
  };
}

function agentInput(agent: ExawattAgent): AgentBurnInput {
  return {
    id: agent.id,
    rawTokens: agent.metrics.rawTokens,
    normalizedTokens: agent.metrics.normalizedTokens,
  };
}

/** Burn view over a whole FleetState (the Fleet board's scope). */
export function selectFleetBurn(state: FleetState): FleetBurnView {
  return computeAgentBurn(Object.values(state.agents).map(agentInput));
}
