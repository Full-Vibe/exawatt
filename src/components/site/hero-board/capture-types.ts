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
}

export interface HeroBoardZone {
  label: string;
  x: number;
  y: number;
  radius: number;
  agentCount: number;
  needsAttention: boolean;
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
  };
  zones: HeroBoardZone[];
  units: HeroBoardUnit[];
}
