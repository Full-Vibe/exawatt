/**
 * Project registry data layer (ENG-015 S5 P2).
 *
 * The durable, user-scoped list of Projects (canon "Project / Context Group"),
 * synced in Supabase and independent of live sessions — this is what makes
 * "open/browse a Project" possible when nothing is running in it. Accessors run
 * on the browser Supabase client; the `/workspace` renderer holds an authed
 * PKCE session, so RLS scopes every row to the signed-in user.
 *
 * v1 only writes `kind: 'repository'` (a Project resolved from a git repo/dir);
 * the `kind` column leaves room for future inferred/semantic/manual Projects.
 */
import { createClient } from '@/lib/supabase/client';
import type { Project, ProjectInsert } from '@/types/database';

export type { Project };

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
  supabase: ReturnType<typeof createClient>
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

/** Live (non-archived) Projects for the signed-in user, in display order:
 *  operator sort_order first, then most-recently-opened. */
export async function listProjects(): Promise<Project[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .is('archived_at', null)
    .order('sort_order', { ascending: true })
    .order('last_opened_at', { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Ensure a repository Project exists for this root path and mark it opened.
 *  Idempotent via the (user_id, root_path) unique index — launching in a known
 *  directory reuses its Project instead of creating a duplicate. */
export async function openRepositoryProject(
  ref: RepositoryProjectRef
): Promise<Project> {
  const supabase = createClient();
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
    return data;
  }
  const { data, error } = await supabase
    .from('projects')
    .insert(buildRepositoryInsert(userId, ref, nowIso))
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** Mark a Project as just opened (bumps recency for the switcher/recents). */
export async function touchProject(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('projects')
    .update({ last_opened_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function renameProject(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const supabase = createClient();
  const { error } = await supabase
    .from('projects')
    .update({ name: trimmed })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setProjectColor(id: string, color: string): Promise<void> {
  const supabase = createClient();
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
  const supabase = createClient();
  const { error } = await supabase
    .from('projects')
    .update({ root_path: rootPath, last_opened_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/** Soft-remove: archived Projects drop out of the registry but keep their row
 *  (and any future history) instead of a destructive delete. */
export async function archiveProject(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('projects')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/** Persist a new manual ordering (drag-to-reorder in the Projects surface). */
export async function reorderProjects(orderedIds: string[]): Promise<void> {
  const supabase = createClient();
  await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from('projects').update({ sort_order: i }).eq('id', id)
    )
  );
}
