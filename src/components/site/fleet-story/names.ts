/**
 * How a Project's name is drawn over its cluster (ENG-031 W15i, W15j). The
 * operator, 2026-10-13: "the project name titles are very missable", then:
 * "the project names should be tag at broader zoom levels like what we have
 * on 5... and Border for zoom levels like 4 and closer". A study switch:
 *
 * - Auto (the default): Border where the story is inside a Project, Tag
 *   where it shows the whole fleet.
 * - Border: each Project's land outlined on the globe, the way a map draws
 *   a border, with its name on a small glass tag set into the outline.
 * - Tag: the name on a small glass tag pinned to the far edge of the
 *   Project's land by a short stem, so it is attached, not near.
 * - Float: the name alone, standing beyond the cluster's far rim (W15h).
 */

import { STAGES, stageBlend, type Stage } from './stages';

export type NamesId = 'auto' | 'border' | 'tag' | 'float';
type NameStyle = Exclude<NamesId, 'auto'>;

export const NAMES: { id: NamesId; name: string; note: string }[] = [
  {
    id: 'auto',
    name: 'Auto',
    note: 'Border inside a Project, Tag over the whole fleet.',
  },
  {
    id: 'border',
    name: 'Border',
    note: 'Each Project’s land outlined on the globe, its name set into the outline.',
  },
  {
    id: 'tag',
    name: 'Tag',
    note: 'The name on a small glass tag pinned to the far edge of its Project.',
  },
  {
    id: 'float',
    name: 'Float',
    note: 'The name alone, beyond the far rim of its cluster.',
  },
];

export function parseNames(value: string | null): NamesId {
  return value === 'border' || value === 'tag' || value === 'float'
    ? value
    : 'auto';
}

/** The style a stage's names are drawn in, or null where it names no
 *  Project. A narrow screen has no room for ten names over the whole
 *  fleet, so there they show only while the story is inside one Project. */
export function nameStyleOf(
  names: NamesId,
  stage: Stage,
  narrow: boolean
): NameStyle | null {
  if (!stage.labels || (narrow && stage.focus === 'fleet')) return null;
  if (names === 'auto') return stage.focus === 'project' ? 'border' : 'tag';
  return names;
}

const shownScratch = { from: 0, to: 0, t: 0 };

/**
 * How much of one style shows at a rail position, 0 to 1. Between two
 * stages that draw it, all of it; across a move from a stage that does not
 * draw it (or draws another style) the old goes out over the first half of
 * the move and the new comes in over the second, so a style never changes
 * while it can be seen.
 */
export function nameShown(
  names: NamesId,
  style: NameStyle,
  rail: number,
  narrow: boolean
): number {
  const b = stageBlend(rail, undefined, shownScratch);
  const from = nameStyleOf(names, STAGES[b.from], narrow) === style;
  const to = nameStyleOf(names, STAGES[b.to], narrow) === style;
  if (from === to) return from ? 1 : 0;
  return from ? Math.max(0, 1 - 2 * b.t) : Math.max(0, 2 * b.t - 1);
}

/** How far a name or a border shows for how squarely its Project faces the
 *  camera: gone at the limb of the globe, whole head on. A name over a
 *  cluster seen edge-on is clutter. */
export function facingFade(facing: number): number {
  const f = Math.min(1, Math.max(0, (facing - 0.22) / 0.3));
  return f * f * (3 - 2 * f);
}
