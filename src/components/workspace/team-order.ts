/**
 * Team-altitude sorts (ENG-015 S6.3, FIX-008 — operator picks 2026-08-07).
 *
 * Two named sorts, the operator's vocabulary ("Started vs. Activity"):
 *
 *   `started`  — the stored default. Chrome's model, at his word ("keep it
 *                like Google Chrome"): start time, oldest first, so a new
 *                Agent APPENDS to its Project and nothing already on screen
 *                changes address.
 *   `activity` — most recent activity leads each Project. At the fidelity
 *                this surface actually has: an Agent working NOW has
 *                activity "now" and leads (ties in Started order); then
 *                Agents by their most recent attention signal, newest
 *                first — a bell IS activity aimed at the operator; the
 *                rest keep Started order. When per-tab activity timestamps
 *                are ever plumbed, this sort refines without renaming.
 *
 * A needs-you-first mode was benched and rejected ("active first without
 * needs you first shouldn't exist").
 *
 * Three properties are load-bearing, each pinned by a test:
 *
 *   1. **Within each Project.** Projects never reorder against each other
 *      here; only tabs inside one do.
 *   2. **A view, never a mutation.** ENG-016 D20/D45 made manual
 *      arrangement durable for the ribbon; Team paints these sorts and
 *      writes nothing back.
 *   3. **Deterministic.** Start time is the total tiebreak everywhere, so
 *      equal-state Agents cannot swap on an activity ping — under live
 *      re-sorting (operator: fully live) a tile moves only when its RANK
 *      inputs change, never because a sort was unstable.
 *
 * needs-you recency rides D51's one attention predicate: a finished turn is
 * a result to read, not an operator gate — it does not raise an Agent here.
 */
import {
  attentionNeedsOperator,
  type SessionAttentionSignal,
} from './session-status';
import { tabIsLive, type WorkspaceTab } from './use-workspace-state';

export type TeamOrderMode = 'started' | 'activity';

export interface TeamOrderSignals {
  activity: Readonly<Record<string, boolean>>;
  attention: Readonly<Record<string, SessionAttentionSignal>>;
}

interface TeamOrderRank {
  band: number;
  /** within band 1: newer attention sorts earlier (negated `since`) */
  recency: number;
}

/** Rank for `activity`; `started` is rank-free. Lower sorts earlier. */
export function teamOrderRank(
  tab: WorkspaceTab,
  mode: TeamOrderMode,
  { activity, attention }: TeamOrderSignals
): TeamOrderRank {
  if (mode === 'started') return { band: 0, recency: 0 };
  // A coworker has no PTY incarnation, so neither signal this function is
  // given can say anything about it. Its D40 work state is real, and it is
  // the roster's to report — not this function's to infer from the absence of
  // a local one. It keeps a seat among the tabs that are not visibly working
  // rather than being sorted to the end, where a stopped Session belongs.
  if (tab.kind === 'remote-agent') return { band: 2, recency: 0 };
  const live = tabIsLive(tab);
  const working = !!(tab.sessionId && live && activity[tab.sessionId]);
  if (working) return { band: 0, recency: 0 };
  const signal = tab.sessionId ? attention[tab.sessionId] : undefined;
  if (live && attentionNeedsOperator(signal)) {
    return { band: 1, recency: -(signal?.since ?? 0) };
  }
  return { band: live ? 2 : 3, recency: 0 };
}

/**
 * The same tabs, in view order. Start time ascending is both the default
 * sort and the tiebreak inside every band; a tab with no `startedAt` (a
 * draft, a restored shell) sorts after every dated one, holding its manual
 * position relative to other undated tabs.
 */
export function orderTeamTabs(
  tabs: readonly WorkspaceTab[],
  mode: TeamOrderMode,
  signals: TeamOrderSignals
): WorkspaceTab[] {
  return tabs
    .map((tab, index) => ({
      tab,
      index,
      rank: teamOrderRank(tab, mode, signals),
      started:
        (tab.kind === 'session' ? tab.startedAt : null) ??
        Number.POSITIVE_INFINITY,
    }))
    .sort(
      (a, b) =>
        a.rank.band - b.rank.band ||
        a.rank.recency - b.rank.recency ||
        a.started - b.started ||
        a.index - b.index
    )
    .map(entry => entry.tab);
}

/**
 * Every Project with its tabs in the order Team PAINTS them (BUG-021).
 *
 * The Team altitude and the tab ring were reading two different orders for
 * one question — "which Session comes next?". The grid sorted per Project
 * with `orderTeamTabs` while `⌘⇧[`/`⌘⇧]` stepped the durable manual
 * arrangement (D20), so one press moved one place in the STRIP and landed
 * wherever that Session happened to sit in the GRID. The ring's own
 * contract was never "the arrangement"; it is "every visible section in
 * DISPLAY order", and at Team the display is this.
 *
 * So this is the one producer of that order, and both the surface that
 * draws it and the command that steps it read it from here. Projects keep
 * their global order — only tabs sort, and nothing is written back.
 */
export function teamViewProjects<P extends { tabs: readonly WorkspaceTab[] }>(
  projects: readonly P[],
  mode: TeamOrderMode,
  signals: TeamOrderSignals
): Array<P & { tabs: WorkspaceTab[] }> {
  return projects.map(project => ({
    ...project,
    tabs: orderTeamTabs(project.tabs, mode, signals),
  }));
}
