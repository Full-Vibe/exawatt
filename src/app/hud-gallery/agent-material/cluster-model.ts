/**
 * One Project, seven slots, for the material study (ENG-031 W15d). The
 * same FleetModel shape the homepage study renders, so the agent is judged
 * in the exact renderer that will ship it: the hero at the centre with the
 * chosen status and harness, six neighbours around it covering the other
 * signals, one ring of ground and the ghost ring beyond. No delegated
 * children: their pips and tethers read as stray lines (operator
 * 2026-10-12) and are gone from the Crust visual.
 */

import type { StatusLightState } from '@/components/status-light/protocol';
import { hexSpiral } from '../homepage-study/hex';
import type { FleetAgent, FleetModel } from '../homepage-study/fleet-model';

export const CLUSTER_SOURCES = [
  'Claude Code',
  'Codex',
  'OpenCode',
  'Grok Build',
  'OpenClaw',
] as const;

/** The neighbours' harnesses are their own: the study's harness switch
 *  changes the hero and nothing else (operator 2026-10-13: "It's confusing
 *  to me that the harness selector changes a bunch of other agents'
 *  harnesses to something unpredictable"). */
const NEIGHBOUR_SOURCE = [
  'Codex',
  'OpenClaw',
  'Claude Code',
  'Grok Build',
  'OpenCode',
  'Claude Code',
] as const;

const NEIGHBOUR_STATUS: StatusLightState[] = [
  'active',
  'needs-you',
  'result',
  'off',
  'active',
  'fault',
];

const MODEL_FOR: Record<string, string> = {
  'Claude Code': 'Fable 5.1',
  Codex: 'GPT-6',
  OpenCode: 'Sonnet 5.5',
  'Grok Build': 'Grok 5',
  OpenClaw: 'Opus 5.5',
};

const DOING: Record<StatusLightState, string> = {
  active: 'Drafting a first version',
  'needs-you': 'Needs a decision from you',
  result: 'Finished, waiting for you',
  off: 'Idle until the next turn',
  fault: 'Lost its connection',
};

const NEIGHBOUR_TASKS = [
  'Rewrite the onboarding',
  'Draft the launch post',
  'Fix checkout on Safari',
  'Cut the release',
  'Write the migration guide',
  'Record the product tour',
];

export function clusterModel(
  status: StatusLightState,
  source: string
): FleetModel {
  const rings = 3;
  const spiral = hexSpiral({ q: 0, r: 0 }, rings);
  const count = 7;
  const agents: FleetAgent[] = [];
  for (let local = 0; local < count; local += 1) {
    const tile = spiral[local];
    const agentStatus = local === 0 ? status : NEIGHBOUR_STATUS[local - 1];
    const agentSource = local === 0 ? source : NEIGHBOUR_SOURCE[local - 1];
    agents.push({
      id: local,
      project: 0,
      name: local === 0 ? 'Ship passkey sign-in' : NEIGHBOUR_TASKS[local - 1],
      doing: DOING[agentStatus],
      status: agentStatus,
      source: agentSource,
      model: MODEL_FOR[agentSource] ?? 'Fable 5.1',
      burn: 0.2 + 0.1 * local,
      minutes: 36 + 41 * local,
      tile: tile.axial,
      ring: tile.ring,
      children: 0,
    });
  }
  const tiles = spiral.map((tile, i) => ({
    axial: tile.axial,
    project: 0,
    agent: i < count ? i : -1,
    ring: tile.ring,
  }));
  return {
    projects: [
      {
        id: 0,
        name: 'Web Platform',
        center: { q: 0, r: 0 },
        capacity: spiral.length,
        rings,
        first: 0,
        count,
      },
    ],
    agents,
    tiles,
  };
}
