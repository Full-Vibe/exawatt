import type { Project as SyncedProject } from '@/lib/projects/registry';
import type { RecentProject } from './switcher-rows';

export interface WorkspaceProjectSummary {
  dir: string;
  name: string;
  color?: string | null;
}

export interface ProjectLibraryEntry {
  dir: string;
  name: string;
  color: string | null;
  registryId: string | null;
  lastOpenedAt: number;
}

/** Synced registry order is operator-curated. Local workspace and recency data
 * fill gaps for signed-out/offline use without duplicating the same path. */
export function mergeProjectLibrary(
  synced: SyncedProject[],
  workspace: WorkspaceProjectSummary[],
  recents: RecentProject[]
): ProjectLibraryEntry[] {
  const entries = new Map<string, ProjectLibraryEntry>();
  for (const project of synced) {
    if (!project.root_path) continue;
    entries.set(project.root_path, {
      dir: project.root_path,
      name: project.name,
      color: project.color,
      registryId: project.id,
      lastOpenedAt: project.last_opened_at
        ? new Date(project.last_opened_at).getTime()
        : 0,
    });
  }
  for (const project of workspace) {
    if (entries.has(project.dir)) continue;
    entries.set(project.dir, {
      dir: project.dir,
      name: project.name,
      color: project.color ?? null,
      registryId: null,
      lastOpenedAt: 0,
    });
  }
  for (const project of recents) {
    if (entries.has(project.dir)) continue;
    entries.set(project.dir, {
      dir: project.dir,
      name: project.name,
      color: project.color ?? null,
      registryId: null,
      lastOpenedAt: 0,
    });
  }
  return [...entries.values()];
}
