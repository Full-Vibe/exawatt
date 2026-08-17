/**
 * What the board EMPHASIZES while a panel is talking about it (ENG-031 W4).
 *
 * The operator's direction for the pinned board: "explanations that change as
 * [you scroll]. They kind of highlight elements or map to elements that are
 * highlighted in the graphic or in the model." A state change alone is not
 * enough — a panel that says "these are the agents waiting on you" has to make
 * those agents the only loud thing on the board while it says it.
 *
 * This module is the RESOLUTION, and it is pure: an id plus the frozen capture
 * in, per-zone and per-unit emphasis plus the subject's own name out. It holds
 * no three.js, so the panel copy and the scene read the same answer.
 *
 * Two rules it exists to keep:
 *
 * - **The emphasis names itself.** Every highlight carries a `subject` drawn
 *   from the capture, so the panel writes "Battery Dispatch, 28 agents, 5 need
 *   you" from the same record the camera flies to. Copy and camera cannot
 *   disagree, because neither one authored the name.
 * - **Needs-you emphasis follows LIVE status, not the capture.** The board's
 *   scheduler turns agents while you read; a highlight frozen at capture time
 *   would keep a green agent lit as "waiting on you" thirty seconds later.
 *   `followsStatus` tells the scene to recompute that unit's emphasis on the
 *   same transition its colour already rides.
 */
import type { HeroBoardCapture } from './capture-types';
import { HERO_STATUS_ORDER } from './capture-types';
import { heroBoardSubjects } from './hero-board-subjects';

/** What a panel can ask the board to say. */
export type HeroHighlightId =
  /** Nothing recedes. The fold's state, and the state at rest. */
  | 'whole-fleet'
  /** Every Agent waiting on a human. Follows live status. */
  | 'needs-you'
  /** One Project: the one the Team altitude frames. */
  | 'one-project'
  /** One Agent: the one the closest altitude frames. */
  | 'one-agent'
  /** Every Agent that is running Agents of its own, and their children. */
  | 'delegation';

/**
 * What a receded mark keeps. Not zero: the argument is that the fleet is still
 * there and still running, and a board that empties itself to make a point is
 * making a different, false point.
 */
export const HERO_DIM = 0.18;

/** The same floor for a Project zone fill, which is already faint. */
export const HERO_ZONE_DIM = 0.3;

export interface HeroHighlightSubject {
  kind: 'fleet' | 'project' | 'agent';
  /** The name the panel prints. Always from the capture, never authored. */
  label: string;
  /** One supporting line, also from the capture. */
  detail: string;
  /** The unit the board should reveal, or -1. Used by the closest altitude so
   *  the Agent the panel is describing is the one whose card is open. */
  unit: number;
}

export interface HeroHighlight {
  id: HeroHighlightId;
  /** 1 leads, 0 recedes. Index-aligned with `capture.zones`. */
  zones: Float32Array;
  /** 1 leads, 0 recedes. Index-aligned with `capture.units`. */
  units: Float32Array;
  /**
   * How present the delegated constellations are, 0..1 (ENG-031 W5).
   *
   * A number rather than a flag because the bloom is a TRANSITION: the
   * children scale out of their parents and their tethers draw, on a finite
   * damped move that leaves and arrives at rest. Everything else on the board
   * is a pure function of scroll position, and so is this.
   */
  delegation: number;
  /** True when unit emphasis is a function of LIVE status, so the scene keeps
   *  it truthful while the scheduler turns agents. */
  followsStatus: boolean;
  subject: HeroHighlightSubject;
}

/** Blocked or error: the two statuses the product calls needs-you and fault. */
export function heroStatusNeedsHuman(status: number): boolean {
  const name = HERO_STATUS_ORDER[status];
  return name === 'blocked' || name === 'error';
}

export function resolveHeroHighlight(
  capture: HeroBoardCapture,
  id: HeroHighlightId
): HeroHighlight {
  const zones = new Float32Array(capture.zones.length).fill(1);
  const units = new Float32Array(capture.units.length).fill(1);
  const { teamZone, agentUnit } = heroBoardSubjects(capture);

  if (id === 'needs-you') {
    for (let index = 0; index < capture.units.length; index += 1) {
      units[index] = heroStatusNeedsHuman(capture.units[index]!.status) ? 1 : 0;
    }
    for (let index = 0; index < capture.zones.length; index += 1) {
      zones[index] = capture.zones[index]!.needsYou > 0 ? 1 : 0;
    }
    // Under every big number, one plain sentence that resolves it (the ERCOT
    // rule in the brief's "Honest scale"). Never write the threat.
    const running = capture.counts.agents - capture.counts.needsYou;
    return {
      id,
      zones,
      units,
      followsStatus: true,
      delegation: 0,
      subject: {
        kind: 'fleet',
        label: `${capture.counts.needsYou} agents need you`,
        detail: `the other ${running} are on track`,
        unit: -1,
      },
    };
  }

  if (id === 'one-project') {
    const zone = capture.zones[teamZone]!;
    zones.fill(0);
    zones[teamZone] = 1;
    for (let index = 0; index < capture.units.length; index += 1) {
      units[index] = capture.units[index]!.zone === teamZone ? 1 : 0;
    }
    return {
      id,
      zones,
      units,
      followsStatus: false,
      delegation: 0,
      subject: {
        kind: 'project',
        label: zone.label,
        detail: `${zone.agentCount} agents · ${zone.needsYou} need you`,
        unit: -1,
      },
    };
  }

  if (id === 'one-agent') {
    const unit = capture.units[agentUnit]!;
    zones.fill(0);
    zones[unit.zone] = 1;
    units.fill(0);
    units[agentUnit] = 1;
    return {
      id,
      zones,
      units,
      followsStatus: false,
      delegation: 0,
      subject: {
        kind: 'agent',
        label: unit.name,
        detail: `${capture.zones[unit.zone]?.label ?? ''} · ${unit.doing}`,
        unit: agentUnit,
      },
    };
  }

  if (id === 'delegation') {
    // Every parent that is running Agents of its own leads, together with the
    // Projects those parents sit in. Everything else recedes to the same floor
    // the other highlights use, because the rest of the fleet is still there
    // and still running: a board that empties itself to make a point is making
    // a different, false point.
    const parents = new Set(capture.delegations.map(child => child.parent));
    units.fill(0);
    zones.fill(0);
    for (const index of parents) {
      units[index] = 1;
      const zone = capture.units[index]?.zone;
      if (zone !== undefined) zones[zone] = 1;
    }
    return {
      id,
      zones,
      units,
      followsStatus: false,
      delegation: 1,
      subject: {
        kind: 'fleet',
        label: `${capture.counts.delegating} agents are running agents`,
        detail: `${capture.counts.delegated} delegated runs underneath them`,
        unit: -1,
      },
    };
  }

  return {
    id: 'whole-fleet',
    zones,
    units,
    followsStatus: false,
    delegation: 0,
    subject: {
      kind: 'fleet',
      label: `${capture.counts.agents} agents`,
      detail: `${capture.counts.projects} projects · ${capture.counts.needsYou} need you`,
      unit: -1,
    },
  };
}
