/**
 * Per-agent consumption burn for demo fixture Agents (ENG-008 attribution).
 *
 * One derivation feeds every surface: the Fleet transport maps these figures
 * into `AgentMetrics.rawTokens` / `AgentMetrics.normalizedTokens`, and the
 * Team shell reads the same function for its Session tiles — no surface owns
 * private math. Normalization goes through the canonical E3 compute proxy
 * (`consumption/model-weights.ts`), never the UI's published disclosure table.
 *
 * Delegated runs are included in every Session total (the E4 rule: delegated
 * spend rides inside the Session, split visible where a surface affords it),
 * each weighted at its OWN model — a Sonnet child under an Opus parent burns
 * at Sonnet weight.
 */

import { resolveModelWeight, weightUsage } from '../consumption/model-weights';
import type { RawUsage } from '../consumption/types';
import type { DemoFleetAgent, DemoUsageSpec } from './types';

function rawUsageOf(usage: DemoUsageSpec): RawUsage {
  return {
    inputTokens: usage.input,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    outputTokens: usage.output,
    // Subset of output (core RawUsage semantics) — never added twice.
    reasoningTokens: Math.min(usage.reasoning ?? 0, usage.output),
    webSearches: usage.webSearches ?? 0,
    webFetches: 0,
  };
}

/** Raw token total across every unit. Reasoning is a subset of output. */
function rawTotal(usage: DemoUsageSpec): number {
  return usage.input + usage.cacheRead + usage.cacheWrite + usage.output;
}

export interface DemoAgentBurn {
  /** Raw tokens across all units, own + delegated runs. */
  rawTokens: number;
  /** Model-size-weighted tokens (E3 proxy), own + delegated runs. */
  normalizedTokens: number;
}

/** One Session's burn: its own usage plus every delegated run, each at its
 *  own model weight. Deterministic — pure arithmetic over the fixture. */
export function demoAgentBurn(agent: DemoFleetAgent): DemoAgentBurn {
  let raw = rawTotal(agent.usage);
  let normalized = weightUsage(
    rawUsageOf(agent.usage),
    resolveModelWeight(agent.model).weight
  );
  for (const run of agent.delegated) {
    raw += rawTotal(run.usage);
    normalized += weightUsage(
      rawUsageOf(run.usage),
      resolveModelWeight(run.model).weight
    );
  }
  return { rawTokens: raw, normalizedTokens: Math.round(normalized) };
}
