/**
 * Project registry data layer (ENG-015 S5 P2).
 *
 * The durable, user-scoped list of Projects (canon "Project / Context Group"),
 * independent of live sessions — this is what makes "open/browse a Project"
 * possible when nothing is running in it. A configured account keeps the
 * existing hosted sync behavior; Community uses a namespaced local registry.
 *
 * v1 only writes `kind: 'repository'` (a Project resolved from a git repo/dir);
 * the `kind` column leaves room for future inferred/semantic/manual Projects.
 */
import { resolveDistributionIdentity } from '@exawatt/core/distribution';
import { resolvedDistribution } from '@/lib/distribution/resolved';
import { createOptionalClient } from '@/lib/supabase/client';
import type { Project, ProjectInsert } from './contract';

export type { Project };

export const LOCAL_PROJECTS_STORAGE_VERSION = 1 as const;

function localProjectsStorageKey(): string {
  const identity = resolveDistributionIdentity(resolvedDistribution());
  return `${identity.stateNamespace}:projects:v${LOCAL_PROJECTS_STORAGE_VERSION}`;
}

function isProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false;
  const project = value as Partial<Project>;
  return (
    typeof project.id === 'string' &&
    typeof project.user_id === 'string' &&
    typeof project.name === 'string' &&
    (project.color === null || typeof project.color === 'string') &&
    typeof project.kind === 'string' &&
    (project.root_path === null || typeof project.root_path === 'string') &&
    (project.git_remote === null || typeof project.git_remote === 'string') &&
    (project.last_opened_at === null ||
      typeof project.last_opened_at === 'string') &&
    (project.archived_at === null || typeof project.archived_at === 'string') &&
    typeof project.sort_order === 'number' &&
    typeof project.created_at === 'string' &&
    typeof project.updated_at === 'string'
  );
}

function readLocalProjects(): Project[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(localProjectsStorageKey());
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isProject) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalProjects(projects: readonly Project[]): void {
  if (typeof window === 'undefined') {
    throw new Error('Local Project persistence requires a browser.');
  }
  try {
    window.localStorage.setItem(
      localProjectsStorageKey(),
      JSON.stringify(projects)
    );
  } catch {
    throw new Error('Project registry could not be saved locally.');
  }
}

function optionalProjectClient() {
  return createOptionalClient(resolvedDistribution());
}

function sortedLiveProjects(projects: readonly Project[]): Project[] {
  return projects
    .filter(project => project.archived_at === null)
    .sort((left, right) => {
      const byOrder = left.sort_order - right.sort_order;
      if (byOrder !== 0) return byOrder;
      return (right.last_opened_at ?? '').localeCompare(
        left.last_opened_at ?? ''
      );
    });
}

function newLocalProject(ref: RepositoryProjectRef, nowIso: string): Project {
  return {
    id: crypto.randomUUID(),
    user_id: 'local',
    name: ref.name,
    color: null,
    kind: 'repository',
    root_path: ref.rootPath,
    git_remote: ref.gitRemote ?? null,
    last_opened_at: nowIso,
    archived_at: null,
    sort_order: readLocalProjects().length,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

function updateLocalProject(
  id: string,
  update: (project: Project, nowIso: string) => Project
): void {
  const projects = readLocalProjects();
  const nowIso = new Date().toISOString();
  let found = false;
  const next = projects.map(project => {
    if (project.id !== id) return project;
    found = true;
    return update(project, nowIso);
  });
  if (!found) throw new Error('Project was not found in the local registry.');
  writeLocalProjects(next);
}

/** A resolved repository Project candidate (from the main-process resolver). */
export interface RepositoryProjectRef {
  /** resolved repo/dir root (worktrees fold to the main repo) */
  rootPath: string;
  /** display name (repo basename by default) */
  name: string;
  /** git remote fingerprint for future cross-machine rematch */
  gitRemote?: string | null;
}

/** Build the insert payload for a repository Project (pure; unit-tested). */
export function buildRepositoryInsert(
  userId: string,
  ref: RepositoryProjectRef,
  nowIso: string
): ProjectInsert {
  return {
    user_id: userId,
    name: ref.name,
    kind: 'repository',
    root_path: ref.rootPath,
    git_remote: ref.gitRemote ?? null,
    last_opened_at: nowIso,
  };
}

async function requireUserId(
  supabase: NonNullable<ReturnType<typeof createOptionalClient>>
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

/** Live (non-archived) Projects for the signed-in user, in display order:
 *  operator sort_order first, then most-recently-opened. Throws when signed
 *  out — RLS would otherwise return zero rows as a success, and callers could
 *  not tell "no Projects" from "not syncing" (ENG-016 D8). */
export async function listProjects(): Promise<Project[]> {
  const supabase = optionalProjectClient();
  if (!supabase) return sortedLiveProjects(readLocalProjects());
  await requireUserId(supabase);
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .is('archived_at', null)
    .order('sort_order', { ascending: true })
    .order('last_opened_at', { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Project[];
}

/** Ensure a repository Project exists for this root path and mark it opened.
 *  Idempotent via the (user_id, root_path) unique index — launching in a known
 *  directory reuses its Project instead of creating a duplicate. */
export async function openRepositoryProject(
  ref: RepositoryProjectRef
): Promise<Project> {
  const supabase = optionalProjectClient();
  if (!supabase) {
    const projects = readLocalProjects();
    const nowIso = new Date().toISOString();
    const existing = projects.find(
      project => project.root_path === ref.rootPath
    );
    if (existing) {
      const reopened: Project = {
        ...existing,
        archived_at: null,
        last_opened_at: nowIso,
        updated_at: nowIso,
      };
      writeLocalProjects(
        projects.map(project =>
          project.id === existing.id ? reopened : project
        )
      );
      return reopened;
    }
    const created = newLocalProject(ref, nowIso);
    writeLocalProjects([...projects, created]);
    return created;
  }
  const userId = await requireUserId(supabase);
  const nowIso = new Date().toISOString();
  // Reuse an existing Project for this directory (the unique (user_id,
  // root_path) index guarantees at most one). Launching again in a known dir
  // must NOT overwrite the operator's renamed / recolored / reordered Project,
  // so on reopen we only bump recency and un-archive; a brand-new dir inserts.
  const existing = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', userId)
    .eq('root_path', ref.rootPath)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) {
    const { data, error } = await supabase
      .from('projects')
      .update({ last_opened_at: nowIso, archived_at: null })
      .eq('id', existing.data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as Project;
  }
  const { data, error } = await supabase
    .from('projects')
    .insert(buildRepositoryInsert(userId, ref, nowIso))
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Project;
}

export async function renameProject(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const supabase = optionalProjectClient();
  if (!supabase) {
    updateLocalProject(id, (project, nowIso) => ({
      ...project,
      name: trimmed,
      updated_at: nowIso,
    }));
    return;
  }
  const { error } = await supabase
    .from('projects')
    .update({ name: trimmed })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setProjectColor(
  id: string,
  color: string
): Promise<void> {
  const supabase = optionalProjectClient();
  if (!supabase) {
    updateLocalProject(id, (project, nowIso) => ({
      ...project,
      color,
      updated_at: nowIso,
    }));
    return;
  }
  const { error } = await supabase
    .from('projects')
    .update({ color })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/** Re-bind a Project's directory on THIS machine (S5 "locate on this machine"):
 *  a synced Project whose root_path is absent here gets pointed at the folder
 *  the operator picks. v1 updates the single root_path (full per-machine path
 *  bindings are deferred); also bumps recency. */
export async function rebindProjectPath(
  id: string,
  rootPath: string
): Promise<void> {
  const supabase = optionalProjectClient();
  if (!supabase) {
    updateLocalProject(id, (project, nowIso) => ({
      ...project,
      root_path: rootPath,
      last_opened_at: nowIso,
      updated_at: nowIso,
    }));
    return;
  }
  const { error } = await supabase
    .from('projects')
    .update({ root_path: rootPath, last_opened_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/** Soft-remove: archived Projects drop out of the registry but keep their row
 *  (and any future history) instead of a destructive delete. */
export async function archiveProject(id: string): Promise<void> {
  const supabase = optionalProjectClient();
  if (!supabase) {
    updateLocalProject(id, (project, nowIso) => ({
      ...project,
      archived_at: nowIso,
      updated_at: nowIso,
    }));
    return;
  }
  const { error } = await supabase
    .from('projects')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/** Persist a new manual ordering (drag-to-reorder in the Projects surface). */
export async function reorderProjects(orderedIds: string[]): Promise<void> {
  const supabase = optionalProjectClient();
  if (!supabase) {
    const order = new Map(orderedIds.map((id, index) => [id, index]));
    const nowIso = new Date().toISOString();
    writeLocalProjects(
      readLocalProjects().map(project => {
        const sortOrder = order.get(project.id);
        return sortOrder === undefined
          ? project
          : { ...project, sort_order: sortOrder, updated_at: nowIso };
      })
    );
    return;
  }
  const results = await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from('projects').update({ sort_order: i }).eq('id', id)
    )
  );
  // surface a failed reorder like every sibling accessor does, rather than
  // reporting success while the registry silently diverges from the UI.
  const failed = results.find(r => r.error);
  if (failed?.error) throw new Error(failed.error.message);
}
