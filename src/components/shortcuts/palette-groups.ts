/**
 * Empty-query order and opening-selection policy shared by the palette and its
 * Recent projection. Workspace switches replace the entire visible context:
 * they remain searchable, but require an intentional selection. The controlled
 * cmdk cursor uses this same policy when async Session rows arrive.
 */
export type PaletteGroupId =
  | 'recent'
  | 'sessions'
  | 'start'
  | 'projects'
  | 'subject-tab'
  | 'subject-project'
  | 'subject-terminal'
  | 'workspace'
  | 'recently-closed'
  | 'fleet'
  | 'navigation'
  | 'workspaces'
  | 'actions';

interface PaletteGroup {
  id: PaletteGroupId;
  heading: string;
  /** May the palette open with its cursor inside this group? */
  landing: 'eligible' | 'never';
}

export const PALETTE_GROUPS: readonly PaletteGroup[] = [
  {
    id: 'recent',
    heading: 'Recent',
    landing: 'eligible',
  },
  {
    id: 'sessions',
    heading: 'Sessions',
    landing: 'eligible',
  },
  { id: 'start', heading: 'Start', landing: 'eligible' },
  {
    id: 'projects',
    heading: 'Projects',
    landing: 'eligible',
  },
  // The selected Agent, its Project and its terminal: the same commands their
  // right-click menus offer (`target-commands.ts`). The palette heads each
  // group with the target's own name; these are the fallbacks.
  { id: 'subject-tab', heading: 'This Agent', landing: 'eligible' },
  { id: 'subject-project', heading: 'This Project', landing: 'eligible' },
  { id: 'subject-terminal', heading: 'Terminal', landing: 'eligible' },
  {
    id: 'workspace',
    heading: 'Workspace',
    landing: 'eligible',
  },
  {
    id: 'recently-closed',
    heading: 'Recently closed',
    landing: 'eligible',
  },
  { id: 'fleet', heading: 'Fleet', landing: 'eligible' },
  {
    id: 'navigation',
    heading: 'Navigation',
    landing: 'eligible',
  },
  {
    id: 'workspaces',
    heading: 'Workspaces',
    landing: 'never',
  },
  {
    id: 'actions',
    heading: 'Actions',
    landing: 'eligible',
  },
];

const BY_ID = new Map(PALETTE_GROUPS.map(group => [group.id, group]));

export function paletteGroup(id: PaletteGroupId): PaletteGroup {
  const group = BY_ID.get(id);
  if (!group) throw new Error(`Unknown palette group: ${id}`);
  return group;
}

/** May a row from this group be the palette's opening highlight, or sit in
 *  the Recent group where it would be one? */
export function paletteGroupMayLand(id: PaletteGroupId): boolean {
  return paletteGroup(id).landing === 'eligible';
}
