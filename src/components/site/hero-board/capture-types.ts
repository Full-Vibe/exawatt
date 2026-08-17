/**
 * Shape of the frozen hero-board capture (ENG-031 W2).
 *
 * Types only — this module is safe to import from the browser bundle, unlike
 * `./capture-source.ts`, which reaches into the demo fixture.
 */
import type { AgentStatus } from '@exawatt/core';

/**
 * Status ordinals, in the SAME order the production board's population field
 * uses (`operations-board/population-dots.ts` → `POPULATION_STATUS_ORDER`), so
 * a hero unit and a board unit mean the same thing by the same number. A test
 * pins the two lists together.
 */
export const HERO_STATUS_ORDER = [
  'blocked',
  'error',
  'reviewing',
  'working',
  'idle',
  'complete',
] as const satisfies readonly AgentStatus[];

export type HeroStatusIndex = 0 | 1 | 2 | 3 | 4 | 5;

export interface HeroBoardUnit {
  /** Board-model coordinates; the renderer maps them to world XZ. */
  x: number;
  y: number;
  size: number;
  status: number;
  zone: number;
  /** Agent display name, straight from the fixture. The overlay reads it on
   *  hover, focus, and selection, so a unit is never an anonymous dot. */
  name: string;
  /** The six-word context label (ENG-016 D33): what this Agent is doing. */
  doing: string;
  /**
   * Which harness runs this Agent. An index into `HeroBoardCapture.sources`
   * rather than a string, because 173 repeated strings is 173 repeated strings
   * in a first-paint-critical bundle, and because the lens needs an ordinal.
   */
  source: number;
  /**
   * Model-size-weighted token total for this Agent, delegated runs included
   * (ENG-008 E3, `packages/core/src/consumption/model-weights.ts`). This is the
   * compute proxy the product itself uses, NOT dollars: money is modelled from
   * a price table and the board is not the place to model it.
   */
  burn: number;
}

/**
 * One delegated child mark, or one overflow lobe (ENG-031 W5).
 *
 * Delegation is real product state, not a marketing invention: ENG-023 D3c and
 * ENG-004 V3.4 render a parent's children as same-family marks at a fixed
 * ratio in deterministic rosette slots, with a hairline lineage tether and an
 * overflow lobe past five. The capture carries the board model's OWN emitted
 * units (`selectSpatialDelegationUnits`), so the marketing board and the
 * product board cannot disagree about where a child sits.
 */
export interface HeroBoardDelegation {
  /** Board-model coordinates, same space as `HeroBoardUnit`. */
  x: number;
  y: number;
  size: number;
  /** Index into `units` of the Agent that spawned it. */
  parent: number;
  /** Parent edge to child edge. Lineage only: it implies no message flow,
   *  status, or command authority (ENG-023 D3c). */
  tether: { x1: number; y1: number; x2: number; y2: number };
  /** The child's subagent type, or null on an overflow lobe. */
  type: string | null;
  /** Exact Agents an overflow lobe stands for; 0 on an individual child. */
  overflow: number;
}

/** One harness on the board: what the launcher calls it, in its own colour. */
export interface HeroBoardSource {
  label: string;
  color: string;
}

export interface HeroBoardZone {
  label: string;
  x: number;
  y: number;
  radius: number;
  agentCount: number;
  needsAttention: boolean;
  /** Agents in this Project that need a human. Drives the zone label's dot. */
  needsYou: number;
}

export interface HeroBoardCapture {
  version: 1;
  /** Honesty stamp data. Rendered inside the hero frame, never optional. */
  source: {
    workspace: string;
    demo: true;
    synthetic: true;
    stamp: string;
  };
  bounds: { x: number; y: number; width: number; height: number };
  counts: {
    agents: number;
    projects: number;
    units: number;
    needsYou: number;
    /** Agents currently running Agents of their own. */
    delegating: number;
    /** Delegated runs underneath them, overflow lobes counted at their exact
     *  census rather than as one mark. */
    delegated: number;
  };
  /**
   * The harnesses on this board, in the ordinal order `HeroBoardUnit.source`
   * indexes (ENG-031 W8). The `source` LENS colours the fleet by this, which
   * is how vendor neutrality proves itself instead of being asserted: every
   * mark on the board is already running under one of these.
   *
   * The COLOUR travels in the capture rather than being resolved at render
   * time, because it comes from `contracts/agent-sources.json` through the
   * launcher's own declarations and the resolver that reads them also reaches
   * the demo fixture. Nothing in `capture-source.ts` may enter the browser
   * bundle.
   */
  sources: HeroBoardSource[];
  /** The highest per-Agent burn in the capture, so a lens can normalize
   *  without walking the units on the client. */
  burnMax: number;
  zones: HeroBoardZone[];
  units: HeroBoardUnit[];
  delegations: HeroBoardDelegation[];
}
