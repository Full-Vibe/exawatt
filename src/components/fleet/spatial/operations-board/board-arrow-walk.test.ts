import { describe, expect, it } from 'vitest';
import type { ExawattAgent, FleetState } from '@exawatt/core';
import {
  selectSpatialBoardLayout,
  type SpatialBoardLayout,
  type SpatialSelectionDirection,
} from '@exawatt/ui-model';
import { boardArrowStep } from './board-arrow-walk';

function agent(id: string, project: string): ExawattAgent {
  return {
    id,
    name: `Agent ${id}`,
    status: 'idle',
    goal: `Work assigned to ${id}`,
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
    },
    lastActivityAt: 0,
    createdAt: 0,
  };
}

const FLEET: FleetState = {
  agents: Object.fromEntries(
    ['Alpha', 'Beta', 'Gamma', 'Delta'].flatMap(project =>
      [0, 1, 2].map(member => {
        const item = agent(`${project}-${member}`, project);
        return [item.id, item] as const;
      })
    )
  ),
  metrics: {
    activeCount: 0,
    blockedCount: 0,
    idleCount: 12,
    totalCost: 0,
    totalTokens: 0,
    totalCostRate: 0,
    costByProject: {},
  },
  lastUpdated: 1,
};

const DIRECTIONS: SpatialSelectionDirection[] = ['left', 'right', 'up', 'down'];

function projectOf(layout: SpatialBoardLayout, agentId: string) {
  return layout.pieces.find(piece => piece.agentId === agentId)!.projectId;
}

/** Every (Agent, direction) at Project altitude whose plain walk leaves the
 *  focused Project. */
function crossings() {
  const found: Array<{
    layout: SpatialBoardLayout;
    from: string;
    direction: SpatialSelectionDirection;
  }> = [];
  const base = selectSpatialBoardLayout(FLEET);
  for (const zone of base.zones) {
    for (const from of zone.agentIds) {
      const layout = selectSpatialBoardLayout(FLEET, {
        altitude: 'project',
        focusedProjectId: zone.id,
        selectedAgentId: from,
      });
      for (const direction of DIRECTIONS) {
        const { target } = boardArrowStep({
          layout,
          units: [],
          selectedTarget: { kind: 'agent', agentId: from },
          direction,
          extend: false,
        });
        if (
          target?.kind === 'agent' &&
          projectOf(layout, target.agentId) !== zone.id
        ) {
          found.push({ layout, from, direction });
        }
      }
    }
  }
  return found;
}

describe('boardArrowStep', () => {
  it('lets a plain arrow walk into the next Project (navigation)', () => {
    expect(crossings().length).toBeGreaterThan(0);
  });

  it('never carries an extending walk, or its working set, out of the focused Project', () => {
    for (const { layout, from, direction } of crossings()) {
      const step = boardArrowStep({
        layout,
        units: [],
        selectedTarget: { kind: 'agent', agentId: from },
        direction,
        extend: true,
      });
      const focused = layout.focusedProjectId;
      expect(step.target?.kind).toBe('agent');
      if (step.target?.kind === 'agent') {
        expect(projectOf(layout, step.target.agentId)).toBe(focused);
      }
      for (const id of step.extend ?? []) {
        expect(projectOf(layout, id), `${from} ${direction}`).toBe(focused);
      }
    }
  });

  it('extends across Projects at Fleet altitude, where no Project holds focus', () => {
    const layout = selectSpatialBoardLayout(FLEET);
    const projects = new Set<string>();
    let target = boardArrowStep({
      layout,
      units: [],
      selectedTarget: null,
      direction: 'right',
      extend: true,
    }).target;
    for (let step = 0; step < 12 && target?.kind === 'agent'; step++) {
      projects.add(projectOf(layout, target.agentId));
      target = boardArrowStep({
        layout,
        units: [],
        selectedTarget: target,
        direction: 'right',
        extend: true,
      }).target;
    }
    expect(projects.size).toBeGreaterThan(1);
  });
});
