import { describe, expect, it } from 'vitest';
import type { ExawattAgent, FleetState } from '@exawatt/core';
import { computeAgentBurn, selectFleetBurn } from './consumption-burn';
import { selectSpatialBoardLayout } from './spatial-board';

function agent(
  id: string,
  project: string,
  burn?: { rawTokens: number; normalizedTokens: number }
): ExawattAgent {
  return {
    id,
    name: id,
    status: 'working',
    goal: 'test goal',
    projectId: project,
    project,
    sessionKey: id,
    metrics: {
      tokensIn: 0,
      tokensOut: 0,
      estimatedCost: 0,
      turnCount: 0,
      startedAt: null,
      duration: 0,
      costRate: 0,
      tokenRate: 0,
      costHistory: [],
      ...(burn ?? {}),
    },
    lastActivityAt: 0,
    createdAt: 0,
  };
}

function fleet(agents: ExawattAgent[]): FleetState {
  return {
    agents: Object.fromEntries(agents.map(a => [a.id, a])),
    metrics: {
      activeCount: 0,
      blockedCount: 0,
      idleCount: 0,
      totalCost: 0,
      totalTokens: 0,
      totalCostRate: 0,
      costByProject: {},
    },
    lastUpdated: 0,
  };
}

describe('computeAgentBurn', () => {
  it('normalizes share against the total and intensity against the max', () => {
    const view = computeAgentBurn([
      { id: 'a', rawTokens: 100, normalizedTokens: 300 },
      { id: 'b', rawTokens: 50, normalizedTokens: 100 },
    ]);
    expect(view.totalNormalizedTokens).toBe(400);
    expect(view.maxNormalizedTokens).toBe(300);
    expect(view.byAgent.get('a')).toMatchObject({
      share: 0.75,
      intensity: 1,
    });
    expect(view.byAgent.get('b')).toMatchObject({
      share: 0.25,
      intensity: 100 / 300,
    });
  });

  it('omits unreported agents rather than treating them as zero', () => {
    const view = computeAgentBurn([
      { id: 'reported', rawTokens: 10, normalizedTokens: 10 },
      { id: 'silent' },
    ]);
    expect(view.byAgent.has('silent')).toBe(false);
    expect(view.reportedCount).toBe(1);
    expect(view.unreportedCount).toBe(1);
  });

  it('is empty when nothing reports', () => {
    const view = computeAgentBurn([{ id: 'a' }, { id: 'b' }]);
    expect(view.byAgent.size).toBe(0);
    expect(view.reportedCount).toBe(0);
    expect(view.unreportedCount).toBe(2);
  });
});

describe('spatial board burn propagation', () => {
  it('attaches zone burn from reporting agents and leaves silent zones null', () => {
    const state = fleet([
      agent('a1', 'alpha', { rawTokens: 1000, normalizedTokens: 600 }),
      agent('a2', 'alpha', { rawTokens: 500, normalizedTokens: 200 }),
      agent('b1', 'beta', { rawTokens: 300, normalizedTokens: 200 }),
      agent('c1', 'gamma'), // unreported source
    ]);
    const layout = selectSpatialBoardLayout(state);
    const alpha = layout.zones.find(zone => zone.agentIds.includes('a1'))!;
    const beta = layout.zones.find(zone => zone.agentIds.includes('b1'))!;
    const gamma = layout.zones.find(zone => zone.agentIds.includes('c1'))!;
    expect(alpha.burn).toMatchObject({
      normalizedTokens: 800,
      share: 0.8,
      intensity: 1,
    });
    expect(beta.burn).toMatchObject({ normalizedTokens: 200, share: 0.2 });
    expect(beta.burn!.intensity).toBeCloseTo(0.25, 4);
    expect(gamma.burn).toBeNull();
  });

  it('carries per-agent intensity on agent pieces, null when unreported', () => {
    const state = fleet([
      agent('a1', 'alpha', { rawTokens: 1000, normalizedTokens: 500 }),
      agent('b1', 'beta', { rawTokens: 100, normalizedTokens: 100 }),
      agent('c1', 'gamma'),
    ]);
    const layout = selectSpatialBoardLayout(state);
    const byAgent = (id: string) =>
      layout.pieces.find(piece => piece.agentId === id)!;
    expect(byAgent('a1').burnIntensity).toBe(1);
    expect(byAgent('b1').burnIntensity).toBeCloseTo(0.2, 4);
    expect(byAgent('c1').burnIntensity).toBeNull();
  });

  it('selectFleetBurn reads AgentMetrics fields', () => {
    const state = fleet([
      agent('a1', 'alpha', { rawTokens: 42, normalizedTokens: 21 }),
    ]);
    const view = selectFleetBurn(state);
    expect(view.byAgent.get('a1')).toMatchObject({
      rawTokens: 42,
      normalizedTokens: 21,
      share: 1,
      intensity: 1,
    });
  });
});
