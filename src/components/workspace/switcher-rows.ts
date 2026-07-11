/**
 * Session-switcher rows (ENG-015 S2): pure mapping from live PTY sessions +
 * the persisted workspace layout to what the ⌘K palette renders — title,
 * project, micro-context, project color, and a live status. Pure so the
 * ranking and status rules are unit-tested without a palette.
 */
import { projectColor } from './project-colors';
import type { PtySessionInfo } from '@/types/electron';

export type SessionRowStatus = 'needs-you' | 'working' | 'idle' | 'exited';

export interface SessionRow {
  id: string;
  title: string;
  harness: PtySessionInfo['harness'];
  projectName: string;
  subtitle: string | null;
  color: string;
  status: SessionRowStatus;
  /** cmdk match target: title + project + micro-context */
  searchValue: string;
}

/** output within this window reads as working (matches fleet truth) */
const WORKING_WINDOW_MS = 15_000;

export function sessionRowStatus(
  s: Pick<PtySessionInfo, 'exited' | 'attention' | 'lastDataAt'>,
  now: number
): SessionRowStatus {
  if (s.exited) return 'exited';
  if (s.attention) return 'needs-you';
  return now - s.lastDataAt <= WORKING_WINDOW_MS ? 'working' : 'idle';
}

/** tolerant read of the persisted layout's dir → color assignments */
export function extractProjectColors(layout: unknown): Record<string, string> {
  const colors: Record<string, string> = {};
  if (!layout || typeof layout !== 'object') return colors;
  // v2 stores groups under `projects`; v1 used `initiatives` (ENG-015 S5 rename)
  const l = layout as { projects?: unknown; initiatives?: unknown };
  const groups = Array.isArray(l.projects) ? l.projects : l.initiatives;
  if (!Array.isArray(groups)) return colors;
  for (const g of groups) {
    if (g && typeof g === 'object') {
      const { dir, color } = g as { dir?: unknown; color?: unknown };
      if (typeof dir === 'string' && typeof color === 'string') {
        colors[dir] = color;
      }
    }
  }
  return colors;
}

export interface RecentProject {
  dir: string;
  name: string;
  color?: string;
}

/** Tolerant read of the layout's open groups merged with its durable
 *  `recentProjects` record (ENG-016 D8): a Project whose tabs all closed —
 *  or whose registry row is unreachable — stays one ⌘K keystroke away.
 *  Open groups come first (they are the most recent by definition). */
export function extractRecentProjects(layout: unknown): RecentProject[] {
  if (!layout || typeof layout !== 'object') return [];
  const l = layout as {
    projects?: unknown;
    initiatives?: unknown;
    recentProjects?: unknown;
  };
  const rows: RecentProject[] = [];
  const seen = new Set<string>();
  const push = (entry: unknown) => {
    if (!entry || typeof entry !== 'object') return;
    const { dir, name, color } = entry as {
      dir?: unknown;
      name?: unknown;
      color?: unknown;
    };
    if (typeof dir !== 'string' || !dir || seen.has(dir)) return;
    seen.add(dir);
    rows.push({
      dir,
      name: typeof name === 'string' && name ? name : dir.split('/').pop() || dir,
      ...(typeof color === 'string' ? { color } : {}),
    });
  };
  const groups = Array.isArray(l.projects) ? l.projects : l.initiatives;
  if (Array.isArray(groups)) groups.forEach(push);
  if (Array.isArray(l.recentProjects)) l.recentProjects.forEach(push);
  return rows;
}

const STATUS_RANK: Record<SessionRowStatus, number> = {
  'needs-you': 0,
  working: 1,
  idle: 2,
  exited: 3,
};

/** needs-you first (oldest flag first), then by output recency */
export function buildSessionRows(
  sessions: PtySessionInfo[],
  layout: unknown,
  now: number
): SessionRow[] {
  const colors = extractProjectColors(layout);
  return sessions
    .map((s) => {
      const subtitle = s.contextSummary?.trim() || null;
      const status = sessionRowStatus(s, now);
      const row: SessionRow = {
        id: s.id,
        title: s.title,
        harness: s.harness,
        projectName: s.projectName,
        subtitle,
        color: colors[s.projectDir] ?? projectColor(s.projectDir),
        status,
        searchValue: `${s.title} ${s.projectName} ${subtitle ?? ''}`.trim(),
      };
      // within needs-you: oldest flag first (queue order); every other
      // rank (incl. exited-with-stale-flag) sorts by output recency
      const sort =
        status === 'needs-you' && s.attention
          ? s.attention.since
          : -s.lastDataAt;
      return { row, rank: STATUS_RANK[status], sort };
    })
    .sort((a, b) => a.rank - b.rank || a.sort - b.sort)
    .map((r) => r.row);
}
