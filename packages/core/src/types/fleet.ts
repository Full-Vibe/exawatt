/**
 * Exawatt Fleet Types
 * Represents the collection of agents and their aggregate metrics
 */

import type { ExawattAgent } from './agent';

export interface FleetMetrics {
  /** working + reviewing (D40 Active). */
  activeCount: number;
  /** blocked + error — needs-attention semantics, matching the board's
   *  scope readout and zone health rails. */
  blockedCount: number;
  /** idle + complete — quietly waiting. */
  idleCount: number;
  totalCost: number;
  totalTokens: number;
  totalCostRate: number; // $/hr aggregate across all active agents
  costByProject: Record<string, number>; // project name -> cumulative cost
}

export interface FleetState {
  agents: Record<string, ExawattAgent>;
  metrics: FleetMetrics;
  lastUpdated: number; // unix ms
}
