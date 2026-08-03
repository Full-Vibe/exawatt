/**
 * Session-switcher rows (ENG-015 S2): pure mapping from live PTY sessions +
 * the persisted workspace layout to what the ⌘K palette renders — title,
 * project, micro-context, project color, and a live status. Pure so the
 * ranking and status rules are unit-tested without a palette.
 */
import { projectColor } from './project-colors';
import type { PtySessionInfo } from '@/types/electron';
import {
  sessionDelegationBusy,
  sessionGlyphState,
  sessionReportedBlocked,
} from './session-status';

/**
 * Row vocabulary. Spelled out rather than derived from `SessionGlyphState`
 * because the two are not the same list: a reported operator gate is its own
 * turn state but NOT its own row status — it lands on the existing `needs-you`,
 * which is the "no new light" boundary ENG-023 set.
 */
export type SessionRowStatus =
  | 'needs-you'
  | 'fault'
  | 'working'
  | 'done'
  | 'fresh'
  | 'quiet'
  | 'exited';

export interface SessionRow {
  id: string;
  title: string;
  harness: PtySessionInfo['harness'];
  projectName: string;
  subtitle: string | null;
  color: string;
  status: SessionRowStatus;
  /** roadmap item declared at launch (ENG-017 S9 mirror) — from the
   *  machine-local layout, so it works for every project without a lens */
  roadmapItemId: string | null;
  /** cmdk match target: title + project + micro-context */
  searchValue: string;
}

/** Compatibility only: older mocks predate the main-owned `working` bit.
 *  Match AttentionMonitor's 3s transition boundary until those callers are
 *  upgraded; production pty:list responses never use this heuristic. */
const LEGACY_WORKING_FALLBACK_MS = 3_000;

export function sessionRowStatus(
  s: Pick<
    PtySessionInfo,
    | 'exited'
    | 'exitCode'
    | 'attention'
    | 'working'
    | 'lastDataAt'
    | 'harness'
    | 'engaged'
    | 'contextSummary'
    | 'delegation'
  >,
  now: number
): SessionRowStatus {
  if (s.exited)
    return s.exitCode != null && s.exitCode !== 0 ? 'fault' : 'exited';
  const delegatedBusy = sessionDelegationBusy(s.delegation);
  const working = s.working ?? now - s.lastDataAt < LEGACY_WORKING_FALLBACK_MS;
  // Turn state FIRST, attention second. This used to run the other way, and
  // an attention signal could therefore answer for a Session it disagreed
  // with — reporting `done` while the harness said the turn was still open.
  // The shared derivation already knows about delegated children and reported
  // gates, so letting it speak first is what keeps this row and the tab strip
  // from producing two different answers for one Session.
  const glyph = sessionGlyphState({
    working,
    agent: s.harness !== 'shell',
    started: !!s.engaged || !!s.contextSummary?.trim(),
    delegatedBusy,
    blocked: sessionReportedBlocked(s.delegation),
    ownTurn: s.delegation?.ownTurn,
  });
  if (glyph === 'blocked') return 'needs-you';
  if (s.attention && s.attention.kind !== 'turn-end') return 'needs-you';
  // A ready result, unless something fresher says the Session is still going.
  if (s.attention?.kind === 'turn-end' && glyph !== 'working') return 'done';
  return glyph;
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

/** tolerant read of the layout's sessionId → declared roadmap item id */
export function extractRoadmapItemIds(layout: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!layout || typeof layout !== 'object') return out;
  const l = layout as { projects?: unknown; initiatives?: unknown };
  const groups = Array.isArray(l.projects) ? l.projects : l.initiatives;
  if (!Array.isArray(groups)) return out;
  for (const g of groups) {
    const tabs = (g as { tabs?: unknown })?.tabs;
    if (!Array.isArray(tabs)) continue;
    for (const tab of tabs) {
      if (!tab || typeof tab !== 'object') continue;
      const { sessionId, roadmapItemId } = tab as {
        sessionId?: unknown;
        roadmapItemId?: unknown;
      };
      if (typeof sessionId === 'string' && typeof roadmapItemId === 'string') {
        out[sessionId] = roadmapItemId;
      }
    }
  }
  return out;
}

const STATUS_RANK: Record<SessionRowStatus, number> = {
  fault: 0,
  'needs-you': 1,
  working: 2,
  done: 3,
  fresh: 4,
  quiet: 5,
  exited: 6,
};

/** Needs-you first (oldest flag first), then semantic turn state; sessions
 * within the same state retain output-recency ordering. */
export function buildSessionRows(
  sessions: PtySessionInfo[],
  layout: unknown,
  now: number
): SessionRow[] {
  const colors = extractProjectColors(layout);
  const itemIds = extractRoadmapItemIds(layout);
  return sessions
    .map((s) => {
      const subtitle = s.contextSummary?.trim() || null;
      const status = sessionRowStatus(s, now);
      const roadmapItemId = itemIds[s.id] ?? null;
      const row: SessionRow = {
        id: s.id,
        title: s.title,
        harness: s.harness,
        projectName: s.projectName,
        subtitle,
        color: colors[s.projectDir] ?? projectColor(s.projectDir),
        status,
        roadmapItemId,
        searchValue: `${s.title} ${s.projectName} ${subtitle ?? ''} ${roadmapItemId ?? ''}`.trim(),
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
