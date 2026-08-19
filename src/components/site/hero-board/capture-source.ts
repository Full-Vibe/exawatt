/**
 * The hero board capture rig (ENG-031 W2).
 *
 * The marketing hero renders ONE frozen capture of the Demo Workspace at the
 * Fleet altitude, not a live fleet: the site must not ship the whole demo
 * fixture (`@exawatt/core`'s demo module is hundreds of kilobytes of authored
 * agents, transcripts, and roadmaps) to a first-paint-critical page.
 *
 * This module is the DERIVATION. It runs in tests and in the capture
 * regeneration path only — never in the browser bundle. `./capture.ts` is its
 * frozen output, and `./capture.test.ts` fails when the two disagree, so the
 * capture cannot silently drift away from the product's own board model.
 *
 * Honesty boundary: the capture carries the Demo Workspace stamp and the
 * synthetic-tier stamp as DATA, and `HeroBoardFrame` prints both inside the
 * hero frame, so a cropped screenshot stays honest (the Palantir rule in
 * `projects/website-overhaul.md` → "Honest scale").
 */
import {
  DEMO_WORKSPACE_NOW_MS,
  demoFleetAgents,
  demoWorkspaceAgent,
  demoWorkspaceProjectCatalog,
  type ExawattAgent,
  type FleetMetrics,
  type FleetState,
} from '@exawatt/core';
import { selectSpatialBoardLayout } from '@exawatt/ui-model';
import { AGENT_SOURCE_DECLARATIONS } from '@/generated/agent-source-declarations';
import {
  HERO_STATUS_ORDER,
  type HeroBoardCapture,
  type HeroBoardDelegation,
  type HeroBoardUnit,
  type HeroBoardZone,
} from './capture-types';

const EMPTY_METRICS: FleetMetrics = {
  activeCount: 0,
  blockedCount: 0,
  idleCount: 0,
  totalCost: 0,
  totalTokens: 0,
  totalCostRate: 0,
  costByProject: {},
};

function round(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** The Demo Workspace fleet as the product's own board model sees it. */
export function demoWorkspaceFleetState(): FleetState {
  const agents: Record<string, ExawattAgent> = {};
  for (const agent of demoFleetAgents('scale', {
    nowMs: DEMO_WORKSPACE_NOW_MS,
  })) {
    agents[agent.id] = demoWorkspaceAgent(agent);
  }
  return { agents, metrics: EMPTY_METRICS, lastUpdated: DEMO_WORKSPACE_NOW_MS };
}

/**
 * Derive the frozen hero capture. Pure and deterministic: the demo fixture is
 * versioned data on a fixed clock, and the board layout is a pure selector, so
 * two runs on two machines produce byte-identical output.
 */
/**
 * The harness that runs each Agent, named and coloured by the launcher's own
 * declaration (ENG-031 W8, corrected W13).
 *
 * THE JOIN IS NOW ON `adapterId` AND NOTHING IS TRANSLATED. Until W13 the
 * capture read `DemoFleetAgent.source`, which is a CONSUMPTION LEDGER, and
 * translated it into an adapter id through a three-entry table. That table was
 * the visible end of a conflated fixture field: the demo fleet could only ever
 * report the harnesses that happen to own a ledger, so a homepage panel naming
 * five harnesses stood over a legend that could only ever show two. The
 * fixture now carries `harness` separately (`packages/core/src/demo/types.ts`)
 * and this module reads it directly, so a widened fleet widens the legend with
 * no site-side mapping at all.
 */
export function heroSourceLabel(adapterId: string): string {
  return (
    AGENT_SOURCE_DECLARATIONS.find(entry => entry.adapterId === adapterId)
      ?.label ?? adapterId
  );
}

export function heroSourceColor(adapterId: string): string {
  return (
    AGENT_SOURCE_DECLARATIONS.find(entry => entry.adapterId === adapterId)
      ?.color ?? '#8B8B8B'
  );
}

export function buildHeroBoardCapture(): HeroBoardCapture {
  const state = demoWorkspaceFleetState();
  // The harness that runs each Agent is fixture data on the DEMO agent, not on
  // the mapped `ExawattAgent`, so the raw fleet is read once for the join.
  // Burn comes through the mapped Agent, because `normalizedTokens` is core's
  // own E3 compute proxy and the site must not re-derive it.
  const harnessByAgentId = new Map(
    demoFleetAgents('scale', { nowMs: DEMO_WORKSPACE_NOW_MS }).map(
      agent => [agent.id, agent.harness] as const
    )
  );
  // Ordinal order is the declaration order in `contracts/agent-sources.json`,
  // not alphabetical: the legend then reads in the same order the launcher
  // lists its sources, and adding a harness to the fixture cannot reshuffle
  // the colours of the ones already on the board.
  const declared = AGENT_SOURCE_DECLARATIONS.map(entry => entry.adapterId);
  const present = new Set(harnessByAgentId.values());
  const sourceIds = declared.filter(adapterId => present.has(adapterId));
  const layout = selectSpatialBoardLayout(state, {
    projects: demoWorkspaceProjectCatalog(),
  });

  const zoneIndexById = new Map<string, number>();
  const zones: HeroBoardZone[] = layout.zones.map((zone, index) => {
    zoneIndexById.set(zone.id, index);
    return {
      label: zone.label,
      x: round(zone.rect.x + zone.rect.width / 2),
      y: round(zone.rect.y + zone.rect.height / 2),
      radius: round(zone.radius),
      agentCount: zone.agentCount,
      needsAttention: zone.blockedCount > 0,
      needsYou: zone.statusCounts.blocked + zone.statusCounts.error,
    };
  });

  // `piece.summary` is the Agent's display name and `piece.label` is its
  // six-word context label — the same two strings the product's own board
  // shows. Carrying them into the capture is what lets a marketing viewer read
  // a real identity off a real unit instead of a coloured dot.
  const units: HeroBoardUnit[] = layout.pieces.map(piece => {
    const sourceId = piece.agentId
      ? harnessByAgentId.get(piece.agentId)
      : undefined;
    // The Demo corpus reports a work state for every Agent, so the frozen
    // capture never carries a unit nobody has reported. The board has a band
    // for one; this capture's ordinals do not, and inventing an ordinal here
    // would put a claim on a public surface. Fail the build instead.
    if (piece.status === null) {
      throw new Error(
        `hero capture: piece ${piece.id} has no reported work state`
      );
    }
    return {
      x: round(piece.x),
      y: round(piece.y),
      size: round(piece.size),
      status: HERO_STATUS_ORDER.indexOf(piece.status),
      zone: zoneIndexById.get(piece.projectId) ?? 0,
      name: piece.summary,
      doing: piece.label,
      source: sourceId === undefined ? 0 : sourceIds.indexOf(sourceId),
      // THE PRODUCT'S OWN BURN LENS FIGURE, not a second derivation.
      // `burnIntensity` is what the Operations Board colours its own burn lens
      // by (ENG-008): each Agent's weighted consumption against the hottest
      // reporting Agent on the board. Recomputing it here would be two burn
      // lenses that could disagree, and the whole point of the marketing board
      // is that it is the product's board.
      burn: round(piece.burnIntensity ?? 0),
    };
  });

  // Delegated children, straight out of the board model's own policy
  // (`selectSpatialDelegationUnits`, ENG-004 V3.4). Their coordinates, sizes,
  // rosette slots and lineage tethers are the product's, not the site's, so
  // the marketing board cannot draw a delegation the product would draw
  // differently. Overflow lobes carry their exact census.
  const unitIndexByPieceId = new Map(
    layout.pieces.map((piece, index) => [piece.id, index] as const)
  );
  const delegations: HeroBoardDelegation[] = layout.delegationUnits.flatMap(
    unit => {
      const parent = unitIndexByPieceId.get(unit.parentPieceId);
      if (parent === undefined) return [];
      return [
        {
          x: round(unit.x),
          y: round(unit.y),
          size: round(unit.size),
          parent,
          tether: {
            x1: round(unit.tether.x1),
            y1: round(unit.tether.y1),
            x2: round(unit.tether.x2),
            y2: round(unit.tether.y2),
          },
          type: unit.agentType,
          overflow: unit.overflowCount,
        },
      ];
    }
  );

  const statusTotals = HERO_STATUS_ORDER.map(
    status =>
      units.filter(unit => HERO_STATUS_ORDER[unit.status] === status).length
  );

  return {
    version: 1,
    source: {
      workspace: 'Voltaic Grid Systems',
      demo: true,
      synthetic: true,
      stamp: 'Demo Workspace · synthetic scale tier',
    },
    bounds: {
      x: round(layout.bounds.x),
      y: round(layout.bounds.y),
      width: round(layout.bounds.width),
      height: round(layout.bounds.height),
    },
    counts: {
      agents: layout.stats.sourceAgentCount,
      projects: layout.stats.emittedProjectCount,
      units: units.length,
      needsYou:
        statusTotals[HERO_STATUS_ORDER.indexOf('blocked')]! +
        statusTotals[HERO_STATUS_ORDER.indexOf('error')]!,
      delegating: new Set(delegations.map(child => child.parent)).size,
      delegated: delegations.reduce(
        (total, child) => total + Math.max(1, child.overflow),
        0
      ),
    },
    sources: sourceIds.map(adapterId => ({
      adapterId,
      label: heroSourceLabel(adapterId),
      color: heroSourceColor(adapterId),
    })),
    // `burnIntensity` is already normalized against the hottest reporting
    // Agent, so the ceiling is 1 by construction. Carried anyway, because a
    // capture that never reaches it says so.
    burnMax: units.reduce((most, unit) => Math.max(most, unit.burn), 0),
    zones,
    units,
    delegations,
  };
}
