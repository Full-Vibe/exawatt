/**
 * Source-neutral Project registry DTO.
 *
 * This is the renderer's compatibility shape, not a generated database row.
 * Hosted adapters may map it to any storage schema; Community persists the
 * same shape locally.
 */
export interface Project {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  kind: string;
  root_path: string | null;
  git_remote: string | null;
  last_opened_at: string | null;
  archived_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectInsert {
  id?: string;
  user_id: string;
  name: string;
  color?: string | null;
  kind?: string;
  root_path?: string | null;
  git_remote?: string | null;
  last_opened_at?: string | null;
  archived_at?: string | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}
