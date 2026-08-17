import {
  inferSessionLinks,
  type RoadmapDoc,
  type SessionLink,
  type SessionLinkCandidate,
} from '@exawatt/core';
import type { RoadmapLensView } from './roadmap-lens';

/**
 * Roadmap-derived attention (ENG-017 S8): blocked items with live agents
 * attached, expressed as inputs to the EXISTING needs-you pipeline — one
 * attention truth, no second machine.
 *
 * FLEET-WIDE by construction (BUG-026). This used to read the active
 * Project's lens, so a Session blocked on a roadmap item anywhere else wore
 * no marker and ⌘J would not visit it; standing in that Project made the
 * marker appear and leaving made it vanish. Attention is a fleet fact, so its
 * producer takes the whole fleet: every open Project's parsed roadmap and
 * every one of its live Sessions, evaluated by the same rule regardless of
 * where the operator is standing.
 *
 * Deliberately git-free. Link evidence here is what every Project can produce
 * without spawning a process per Session — declared ids, worktree path,
 * session title, context and task. Branch and commit evidence stay the
 * Project lens's DISPLAY enrichment: an attention signal that exists only for
 * the Project you are standing in is the defect, not a feature.
 *
 * Pure: the workspace merges these with PTY attention through
 * `mergeFleetAttention` and routes ⌘J/markers through the merged map.
 */

export interface RoadmapBlockedSession {
  sessionId: string;
  tabId: string | null;
  projectDir: string;
  itemId: string;
  /** "APP-018 is blocked" — badge/tooltip copy */
  reason: string;
}

/** What the fleet producer needs about one live Session. No turn state: a
 *  blocked item is blocked whether or not bytes are moving, and depending on
 *  activity here would recompute every Project's links on every PTY tick. */
export interface RoadmapAttentionSession {
  sessionId: string;
  tabId: string | null;
  title: string;
  cwd: string;
  contextSummary: string | null;
  initialTask: string | null;
  /** roadmap item declared at launch (S4); overrides inference */
  declaredItemId: string | null;
}

/** One Project's roadmap as the producer sees it. `pending` is the honest
 *  third state: the read has not answered yet, so this Project's Sessions are
 *  neither blocked nor cleared. */
export type RoadmapAttentionRead =
  | { status: 'pending' }
  /** no roadmap file, or it could not be read/parsed */
  | { status: 'absent' }
  | { status: 'ok'; doc: RoadmapDoc };

export interface RoadmapAttentionProject {
  dir: string;
  read: RoadmapAttentionRead;
  sessions: readonly RoadmapAttentionSession[];
}

export interface FleetRoadmapAttention {
  /** every live Session attached to a blocked now/next item, fleet-wide */
  blocked: RoadmapBlockedSession[];
  /** Sessions whose Project has not answered yet — unknown, not clear */
  pending: string[];
}

/** Renderer-side worktree evidence: the basename of a Session cwd that has
 *  left the Project root. Free, and the strongest non-git link signal. */
function worktreeDirname(cwd: string, projectDir: string): string | null {
  const normalized = cwd.replace(/\/+$/, '');
  if (normalized === projectDir.replace(/\/+$/, '')) return null;
  const base = normalized.split('/').pop();
  return base || null;
}

function projectLinks(
  project: RoadmapAttentionProject,
  doc: RoadmapDoc
): Map<string, SessionLink> {
  const declared = new Map<string, SessionLink>();
  const inferable: SessionLinkCandidate[] = [];
  for (const session of project.sessions) {
    if (session.declaredItemId) {
      declared.set(session.sessionId, {
        sessionId: session.sessionId,
        tabId: session.tabId,
        projectDir: project.dir,
        itemId: session.declaredItemId,
        method: 'declared',
        confidence: 'high',
        evidence: [{ kind: 'declared', excerpt: 'declared at launch' }],
        evaluatedAt: 0,
      });
      continue;
    }
    inferable.push({
      sessionId: session.sessionId,
      tabId: session.tabId,
      projectDir: project.dir,
      title: session.title,
      contextSummary: session.contextSummary,
      initialTask: session.initialTask,
      cwd: session.cwd,
      branch: null,
      worktreeDirname: worktreeDirname(session.cwd, project.dir),
      commitSubjects: [],
    });
  }
  for (const link of inferSessionLinks(doc, inferable)) {
    if (!declared.has(link.sessionId)) declared.set(link.sessionId, link);
  }
  return declared;
}

/**
 * Every Session the fleet's roadmaps say is blocked, plus the ones whose
 * Project has not been read yet. The same computation for the Project the
 * operator is standing in and every Project they are not.
 */
export function deriveFleetRoadmapBlocked(
  projects: readonly RoadmapAttentionProject[]
): FleetRoadmapAttention {
  const blocked: RoadmapBlockedSession[] = [];
  const pending: string[] = [];
  for (const project of projects) {
    if (project.read.status === 'pending') {
      pending.push(...project.sessions.map(session => session.sessionId));
      continue;
    }
    if (project.read.status !== 'ok') continue;
    const doc = project.read.doc;
    const links = projectLinks(project, doc);
    if (links.size === 0) continue;
    for (const item of doc.items) {
      if (!item.blocked) continue;
      if (item.status !== 'now' && item.status !== 'next') continue;
      for (const session of project.sessions) {
        const link = links.get(session.sessionId);
        if (link?.itemId !== item.id) continue;
        blocked.push({
          sessionId: session.sessionId,
          tabId: session.tabId,
          projectDir: project.dir,
          itemId: item.id,
          reason: `${item.declaredId ?? item.title} is blocked`,
        });
      }
    }
  }
  return { blocked, pending };
}

/**
 * `since` is the ⌘J walk order, so it must be the moment the block became
 * true — not the moment this surface last happened to look at it.
 *
 * The pre-BUG-026 pin was pruned against the ACTIVE Project's view, so
 * leaving a Project dropped its pins and returning re-stamped them with a
 * fresh clock: the documented oldest-first walk silently ordered by "least
 * recently visited" instead. Pins now survive Project switches, drop when the
 * block clears, and are held (never re-stamped) while a Project's roadmap
 * read is still pending.
 */
export function pinRoadmapBlockedSince(
  previous: ReadonlyMap<string, number>,
  fleet: FleetRoadmapAttention,
  now: number
): Map<string, number> {
  const pinned = new Map<string, number>();
  for (const entry of fleet.blocked) {
    if (pinned.has(entry.sessionId)) continue;
    pinned.set(entry.sessionId, previous.get(entry.sessionId) ?? now);
  }
  for (const sessionId of fleet.pending) {
    const held = previous.get(sessionId);
    if (held !== undefined && !pinned.has(sessionId)) {
      pinned.set(sessionId, held);
    }
  }
  return pinned;
}

/** The "no food" condition: nothing left to execute while agents run. */
export function isProjectStarving(
  view: RoadmapLensView,
  liveSessionCount: number
): boolean {
  return view.status === 'ok' && view.queueEmpty && liveSessionCount > 0;
}
