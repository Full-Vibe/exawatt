/**
 * How a Project's name is drawn over its cluster (ENG-031 W15i, operator
 * 2026-10-13: "experiment with stylizing the project names a bit, right now
 * the project name titles are very missable and its sort of visually unclear
 * that they map to the fleet of agents, or the team of agents, or the squad
 * that I'm looking at"). A study switch:
 *
 * - Float: the name alone, standing beyond the cluster's far rim (W15h).
 * - Tag: the name on a small glass tag pinned to the far edge of the
 *   Project's land by a short stem, so it is attached, not near.
 * - Border: the Project's land outlined on the globe, a border the way a
 *   map draws one, with the name on a tag set into it.
 */

export type NamesId = 'float' | 'tag' | 'border';

export const NAMES: { id: NamesId; name: string; note: string }[] = [
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
  return value === 'tag' || value === 'float' ? value : 'border';
}

/** How far a name or a border shows for how squarely its Project faces the
 *  camera: gone at the limb of the globe, whole head on. A name over a
 *  cluster seen edge-on is clutter. */
export function facingFade(facing: number): number {
  const f = Math.min(1, Math.max(0, (facing - 0.22) / 0.3));
  return f * f * (3 - 2 * f);
}
