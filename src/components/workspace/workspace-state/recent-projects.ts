/**
 * Durable Project recency (ENG-016 D8).
 *
 * A Project whose tabs all closed stays reachable from ⌘K even offline or
 * signed out, because the layout remembers it. The record is loaded with the
 * layout, re-merged on every save so closed Projects survive, and seeded
 * synchronously when a Project closes before a save has seen it.
 */
import type { Project } from './workspace-model';
import type { PersistedV7 } from './persisted-layout';

export type RecentProject = NonNullable<PersistedV7['recentProjects']>[number];

/** Most recent first, capped. */
const RECENT_PROJECT_LIMIT = 12;

/**
 * The persisted record, tolerating a corrupt or hand-edited one: a bad shape
 * here must not break every later debounced save or the shutdown checkpoint.
 */
export function readPersistedRecents(
  value: PersistedV7['recentProjects']
): RecentProject[] {
  return Array.isArray(value)
    ? value.filter(
        (recent): recent is RecentProject =>
          !!recent &&
          typeof recent === 'object' &&
          typeof recent.dir === 'string'
      )
    : [];
}

/** Every open Project is the most recent; a closed one keeps its place. */
export function mergeOpenProjects(
  open: readonly Project[],
  previous: readonly RecentProject[],
  now: number
): RecentProject[] {
  return [
    ...open.map(project => ({
      dir: project.dir,
      name: project.name,
      ...(project.color ? { color: project.color } : {}),
      lastOpenedAt: now,
    })),
    ...previous.filter(
      recent => !open.some(project => project.dir === recent.dir)
    ),
  ].slice(0, RECENT_PROJECT_LIMIT);
}

/** A Project closing now becomes the most recent entry. */
export function recordClosedProject(
  project: Project,
  previous: readonly RecentProject[],
  now: number
): RecentProject[] {
  return [
    {
      dir: project.dir,
      name: project.name,
      ...(project.color ? { color: project.color } : {}),
      lastOpenedAt: now,
    },
    ...previous.filter(recent => recent.dir !== project.dir),
  ].slice(0, RECENT_PROJECT_LIMIT);
}

/**
 * The one holder of the record between saves. Not React state: nothing
 * renders it, and a save reads it at the moment it serializes.
 */
export class RecentProjects {
  private entries: RecentProject[] = [];

  /** Adopt the record a restored layout carried. */
  replace(entries: RecentProject[]): void {
    this.entries = entries;
  }

  /** Fold the open Projects in, and return the record a save writes. */
  mergeOpen(open: readonly Project[], now: number): RecentProject[] {
    this.entries = mergeOpenProjects(open, this.entries, now);
    return this.entries;
  }

  /** A Project closed before any save saw it; remember it now. */
  recordClosed(project: Project, now: number): void {
    this.entries = recordClosedProject(project, this.entries, now);
  }
}
