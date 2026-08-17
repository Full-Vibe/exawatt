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
import {
  HERO_STATUS_ORDER,
  type HeroBoardCapture,
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
export function buildHeroBoardCapture(): HeroBoardCapture {
  const state = demoWorkspaceFleetState();
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
  const units: HeroBoardUnit[] = layout.pieces.map(piece => ({
    x: round(piece.x),
    y: round(piece.y),
    size: round(piece.size),
    status: HERO_STATUS_ORDER.indexOf(piece.status),
    zone: zoneIndexById.get(piece.projectId) ?? 0,
    name: piece.summary,
    doing: piece.label,
  }));

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
    },
    zones,
    units,
  };
}
