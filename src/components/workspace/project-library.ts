import { isLocalProject } from '@/lib/projects/contract';
import type { Project as SyncedProject } from '@/lib/projects/registry';
import type { RecentProject } from './switcher-rows';

export interface WorkspaceProjectSummary {
  dir: string;
  rootPath?: string | null;
  registryId?: string | null;
  name: string;
  color?: string | null;
}

export interface ProjectLibraryEntry {
  /** Workspace grouping key: folder for legacy local Projects, id otherwise. */
  dir: string;
  /** Durable Exawatt identity when the registry knows this Project. */
  projectId: string;
  /** Null is a valid folderless Project, not a missing lookup. */
  rootPath: string | null;
  name: string;
  color: string | null;
  registryId: string | null;
  /** Kept in this machine's local registry rather than an account's. */
  local: boolean;
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
    const dir = project.root_path ?? project.id;
    entries.set(dir, {
      dir,
      projectId: project.id,
      rootPath: project.root_path,
      name: project.name,
      color: project.color,
      registryId: project.id,
      local: isLocalProject(project),
      lastOpenedAt: project.last_opened_at
        ? new Date(project.last_opened_at).getTime()
        : 0,
    });
  }
  for (const project of workspace) {
    if (entries.has(project.dir)) continue;
    entries.set(project.dir, {
      dir: project.dir,
      projectId: project.registryId ?? project.dir,
      rootPath: project.rootPath === undefined ? project.dir : project.rootPath,
      name: project.name,
      color: project.color ?? null,
      registryId: project.registryId ?? null,
      local: false,
      lastOpenedAt: 0,
    });
  }
  for (const project of recents) {
    if (entries.has(project.dir)) continue;
    entries.set(project.dir, {
      dir: project.dir,
      projectId: project.dir,
      rootPath: project.dir,
      name: project.name,
      color: project.color ?? null,
      registryId: null,
      local: false,
      lastOpenedAt: 0,
    });
  }
  return [...entries.values()];
}
