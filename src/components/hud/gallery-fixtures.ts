import type { FleetMetrics } from '@exawatt/core';
import type { FleetAgentView } from '@exawatt/ui-model';

/** Handcrafted fixtures so HUD blocks render in isolation without a live fleet. */

function agent(p: Partial<FleetAgentView> & { id: string; name: string }): FleetAgentView {
  return {
    status: 'working',
    goal: '',
    project: 'OpenClaw Local Parity',
    sessionKey: p.id,
    lastActivityAt: 0,
    cost: 0,
    costRate: 0,
    tokenRate: 0,
    // rawTokens deliberately absent: the fixture source reports no usage,
    // and absent is never zero (10d5be7's hardcoded 0 reverted with the
    // field's restored optionality).
    turnCount: 0,
    activityCount: 0,
    hasHeartbeat: false,
    needsOperator: false,
    active: true,
    statusRank: 2,
    ...p,
  };
}

export const FIXTURE_AGENTS: FleetAgentView[] = [
  agent({
    id: 'demo-gamma',
    name: 'Competitor pricing research',
    status: 'blocked',
    goal: 'Research competitor pricing, compile a report with recommendations',
    cost: 1.02,
    costRate: 0.84,
    tokenRate: 0,
    turnCount: 0,
    needsOperator: true,
    active: false,
    statusRank: 0,
    blockerTitle: 'Stripe API keys required',
    blockerDescription: 'Cannot proceed with payment integration without live keys',
  }),
  agent({
    id: 'demo-eta',
    name: 'Merge open PRs',
    status: 'reviewing',
    goal: 'Review and merge 12 open PRs, resolve conflicts',
    cost: 0.41,
    costRate: 0.3,
    turnCount: 14,
    active: true,
    statusRank: 1,
  }),
  agent({
    id: 'demo-alpha',
    name: 'Onboarding analytics',
    status: 'working',
    goal: 'Improve onboarding flow and add analytics tracking',
    cost: 0.77,
    costRate: 0.55,
    turnCount: 6,
  }),
  agent({
    id: 'demo-beta',
    name: 'TypeScript cleanup',
    status: 'idle',
    goal: 'Audit and fix all TypeScript errors in the legacy module',
    active: false,
    statusRank: 4,
  }),
  agent({
    id: 'demo-delta',
    name: 'Schema migration',
    status: 'complete',
    goal: 'Migrate database schema to support multi-tenancy',
    cost: 1.9,
    active: false,
    statusRank: 3,
  }),
  agent({
    id: 'demo-err',
    name: 'iOS build',
    status: 'error',
    goal: 'Resolve CocoaPods dependency conflicts causing build failures',
    active: false,
    statusRank: 0,
  }),
];

export const FIXTURE_METRICS: FleetMetrics = {
  activeCount: 3,
  blockedCount: 2,
  idleCount: 3,
  totalCost: 8.71,
  totalTokens: 184000,
  totalCostRate: 2.4,
  costByProject: {
    'OpenClaw Local Parity': 4.2,
    'Exawatt Demo Polish': 2.6,
    'Investor Pipeline Research': 1.9,
  },
};
