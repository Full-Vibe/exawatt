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
import {
  LOCAL_PROJECT_OWNER,
  type Project,
  type ProjectInsert,
} from './contract';

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

type HostedProjectClient = NonNullable<
  ReturnType<typeof optionalProjectClient>
>;

type ProjectStore =
  | { kind: 'local'; reason: 'no-account' | 'signed-out' | 'local-project' }
  | { kind: 'hosted'; supabase: HostedProjectClient; userId: string };

/**
 * The account registry cannot be reached, and neither can the answer to
 * whether the operator is signed in.
 *
 * Callers must not read this as "signed out". Signed out has a registry, the
 * local one; this position has none it may safely write to, so a read or a
 * new Project refuses and the chooser says the registry is not syncing.
 */
export class ProjectRegistryUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Projects are not syncing right now.', { cause });
    this.name = 'ProjectRegistryUnavailableError';
  }
}

/**
 * Where the registry serves from, decided per call.
 *
 * The hosted registry is the signed-in operator's. The local namespace serves
 * a Community build and an account build whose operator has not signed in:
 * Agents, Projects, and Demo Mode work without an account, and Connect maps
 * an Agent into a durable Project before its dialog closes, so the mapping
 * step needs a registry to write to whether or not the operator ever signs in
 * (BUG-150).
 *
 * Signed out is "no session and no error", and nothing else (BUG-190). An
 * access token that expired while the machine was offline comes back from
 * auth-js as `{ session: null, error }`: the operator is signed in, and his
 * session could not be refreshed. Reading that as signed out wrote his next
 * Projects into the local registry, where they stayed after he reconnected.
 * It refuses instead, which is what the registry did before BUG-150.
 */
async function projectStore(): Promise<ProjectStore> {
  const supabase = optionalProjectClient();
  if (!supabase) return { kind: 'local', reason: 'no-account' };
  let read: Awaited<ReturnType<HostedProjectClient['auth']['getSession']>>;
  try {
    read = await supabase.auth.getSession();
  } catch (cause) {
    throw new ProjectRegistryUnavailableError(cause);
  }
  if (read.error) throw new ProjectRegistryUnavailableError(read.error);
  const { session } = read.data;
  if (!session) return { kind: 'local', reason: 'signed-out' };
  return { kind: 'hosted', supabase, userId: session.user.id };
}

/**
 * The registry that holds an existing Project.
 *
 * A Project made in the local registry stays there: it does not migrate into
 * the account on a later sign-in (BUG-191), so every verb on it writes
 * locally whatever the session says now. Anything else goes wherever the
 * session points.
 */
async function projectStoreHolding(id: string): Promise<ProjectStore> {
  if (readLocalProjects().some(project => project.id === id)) {
    return { kind: 'local', reason: 'local-project' };
  }
  return projectStore();
}

type ProjectRegistryScope = 'hosted' | 'local' | 'signed-out';

/** Which registry a caller is about to read or write. `signed-out` is the
 *  local registry in a build that could sync once the operator signs in.
 *  Throws `ProjectRegistryUnavailableError` when that cannot be known. */
export async function projectRegistryScope(): Promise<ProjectRegistryScope> {
  const store = await projectStore();
  if (store.kind === 'hosted') return 'hosted';
  return store.reason === 'signed-out' ? 'signed-out' : 'local';
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

/**
 * A signed-in listing: the account's Projects, plus the ones this machine's
 * local registry holds that the account does not.
 *
 * Projects made while signed out are local Projects. They are not migrated on
 * sign-in, and they are not dropped from the list either (BUG-191): Connect
 * mints one manual Project per Agent by default, the Agent's mapping names
 * that Project's id, and hiding the Project hid where the Agent belongs. A
 * local repository Project whose folder the account already has gives way
 * to the account's, which is the one opening that folder now uses.
 */
function withLocalProjects(hosted: readonly Project[]): Project[] {
  const hostedIds = new Set(hosted.map(project => project.id));
  const hostedPaths = new Set(
    hosted.flatMap(project =>
      project.root_path === null ? [] : [project.root_path]
    )
  );
  const local = readLocalProjects().filter(
    project =>
      !hostedIds.has(project.id) &&
      (project.root_path === null || !hostedPaths.has(project.root_path))
  );
  if (local.length === 0) return [...hosted];
  return sortedLiveProjects([...hosted, ...local]);
}

function newLocalProject(ref: RepositoryProjectRef, nowIso: string): Project {
  return {
    id: crypto.randomUUID(),
    user_id: LOCAL_PROJECT_OWNER,
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

/** A folder-optional Project created by an explicit operator grouping choice. */
export interface ManualProjectRef {
  /** Opaque Exawatt identity. Generated before cross-boundary Agent mapping. */
  id: string;
  name: string;
}

function newLocalManualProject(ref: ManualProjectRef, nowIso: string): Project {
  return {
    id: ref.id,
    user_id: LOCAL_PROJECT_OWNER,
    name: ref.name,
    color: null,
    kind: 'manual',
    root_path: null,
    git_remote: null,
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

async function requireUserId(supabase: HostedProjectClient): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

/** Live (non-archived) Projects in display order: operator sort_order first,
 *  then most-recently-opened. Signed out serves the local registry; signed in
 *  serves the account's Projects and this machine's local ones. A session
 *  that cannot be read or validated throws (ENG-016 D8, BUG-190): RLS would
 *  otherwise return zero rows as a success, and callers could not tell "no
 *  Projects" from "not syncing". */
export async function listProjects(): Promise<Project[]> {
  const store = await projectStore();
  if (store.kind === 'local') return sortedLiveProjects(readLocalProjects());
  const { supabase } = store;
  await requireUserId(supabase);
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .is('archived_at', null)
    .order('sort_order', { ascending: true })
    .order('last_opened_at', { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return withLocalProjects((data ?? []) as Project[]);
}

/** Ensure a repository Project exists for this root path and mark it opened.
 *  Idempotent via the (user_id, root_path) unique index — launching in a known
 *  directory reuses its Project instead of creating a duplicate. */
export async function openRepositoryProject(
  ref: RepositoryProjectRef
): Promise<Project> {
  const store = await projectStore();
  if (store.kind === 'local') {
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
  const { supabase } = store;
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

/**
 * Persist a Project / Context Group that has no folder binding.
 *
 * The caller supplies the opaque id because Connect must map a source Agent to
 * this exact durable record before its dialog closes. Repeating the same call
 * is an idempotent reopen, which also makes a retry safe after the renderer
 * loses an acknowledgement. A manual Project is not a synthetic path: local
 * launch, Finder, and worktree verbs must gate on `root_path`.
 */
export async function openManualProject(
  ref: ManualProjectRef
): Promise<Project> {
  const trimmed = ref.name.trim();
  if (!ref.id.trim() || !trimmed) {
    throw new Error('A manual Project needs an identity and name.');
  }
  const store = await projectStoreHolding(ref.id);
  if (store.kind === 'local') {
    const projects = readLocalProjects();
    const nowIso = new Date().toISOString();
    const existing = projects.find(project => project.id === ref.id);
    if (existing) {
      const reopened: Project = {
        ...existing,
        name: trimmed,
        kind: 'manual',
        root_path: null,
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
    const created = newLocalManualProject(
      { id: ref.id, name: trimmed },
      nowIso
    );
    writeLocalProjects([...projects, created]);
    return created;
  }

  const { supabase } = store;
  const userId = await requireUserId(supabase);
  const nowIso = new Date().toISOString();
  const existing = await supabase
    .from('projects')
    .select('*')
    .eq('id', ref.id)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) {
    const { data, error } = await supabase
      .from('projects')
      .update({
        name: trimmed,
        kind: 'manual',
        root_path: null,
        archived_at: null,
        last_opened_at: nowIso,
      })
      .eq('id', ref.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as Project;
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({
      id: ref.id,
      user_id: userId,
      name: trimmed,
      kind: 'manual',
      root_path: null,
      git_remote: null,
      last_opened_at: nowIso,
    } satisfies ProjectInsert)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Project;
}

export async function renameProject(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const store = await projectStoreHolding(id);
  if (store.kind === 'local') {
    updateLocalProject(id, (project, nowIso) => ({
      ...project,
      name: trimmed,
      updated_at: nowIso,
    }));
    return;
  }
  const { error } = await store.supabase
    .from('projects')
    .update({ name: trimmed })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setProjectColor(
  id: string,
  color: string
): Promise<void> {
  const store = await projectStoreHolding(id);
  if (store.kind === 'local') {
    updateLocalProject(id, (project, nowIso) => ({
      ...project,
      color,
      updated_at: nowIso,
    }));
    return;
  }
  const { error } = await store.supabase
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
  const store = await projectStoreHolding(id);
  if (store.kind === 'local') {
    updateLocalProject(id, (project, nowIso) => ({
      ...project,
      root_path: rootPath,
      last_opened_at: nowIso,
      updated_at: nowIso,
    }));
    return;
  }
  const { error } = await store.supabase
    .from('projects')
    .update({ root_path: rootPath, last_opened_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/** Soft-remove: archived Projects drop out of the registry but keep their row
 *  (and any future history) instead of a destructive delete. */
export async function archiveProject(id: string): Promise<void> {
  const store = await projectStoreHolding(id);
  if (store.kind === 'local') {
    updateLocalProject(id, (project, nowIso) => ({
      ...project,
      archived_at: nowIso,
      updated_at: nowIso,
    }));
    return;
  }
  const { error } = await store.supabase
    .from('projects')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/** Persist a new manual ordering (drag-to-reorder in the Projects surface).
 *  A signed-in list mixes account and local Projects, so each side keeps its
 *  own rows' positions in the one combined order. */
export async function reorderProjects(orderedIds: string[]): Promise<void> {
  const order = new Map(orderedIds.map((id, index) => [id, index]));
  const local = readLocalProjects();
  const localIds = new Set(local.map(project => project.id));
  if (orderedIds.some(id => localIds.has(id))) {
    const nowIso = new Date().toISOString();
    writeLocalProjects(
      local.map(project => {
        const sortOrder = order.get(project.id);
        return sortOrder === undefined
          ? project
          : { ...project, sort_order: sortOrder, updated_at: nowIso };
      })
    );
  }
  const hostedIds = orderedIds.filter(id => !localIds.has(id));
  if (hostedIds.length === 0) return;
  const store = await projectStore();
  // Signed out, nothing but the local registry is the operator's to order.
  if (store.kind === 'local') return;
  const results = await Promise.all(
    hostedIds.map(id =>
      store.supabase
        .from('projects')
        .update({ sort_order: order.get(id)! })
        .eq('id', id)
    )
  );
  // surface a failed reorder like every sibling accessor does, rather than
  // reporting success while the registry silently diverges from the UI.
  const failed = results.find(r => r.error);
  if (failed?.error) throw new Error(failed.error.message);
}
