/**
 * Team-altitude ordering modes (ENG-015 S6, FIX-008 — bench engine).
 *
 * Operator, 2026-08-07: "a filter strip / ribbon in Team view that with one
 * click (or keyboard) lets one sort the active agents to the front within
 * each project. Right now I have to scroll and scan to see what I was
 * working on."
 *
 * This module is the PURE half of that request: given a Project's tabs in
 * their durable manual order, produce the same tabs in a view order. Three
 * properties are load-bearing:
 *
 *   1. **Within each Project.** The operator's words. Projects never
 *      reorder against each other here; only tabs inside one do.
 *   2. **A view, never a mutation.** ENG-016 D20/D45 made manual
 *      arrangement durable, and a sort that silently rewrote it would trade
 *      one orientation problem for a worse one. Callers pass the manual
 *      order in and paint the result; nothing is written back.
 *   3. **Stable.** Inside a band, manual order survives, so two Agents in
 *      the same state keep the relative positions the operator gave them
 *      and the sort cannot shuffle on every activity ping.
 *
 * The mode VOCABULARY is the open design question (view mode vs transient
 * filter vs sort; what "active" means), so the modes here are the candidate
 * answers the bench renders for the operator's pick — not a decided
 * contract. Whichever survives review is already tested.
 */
import {
  attentionNeedsOperator,
  type SessionAttentionSignal,
} from './session-status';
import { tabIsLive, type WorkspaceTab } from './use-workspace-state';

export type TeamOrderMode = 'arranged' | 'active-first' | 'needs-you-first';

export const TEAM_ORDER_MODES: ReadonlyArray<{
  id: TeamOrderMode;
  label: string;
  /** one sentence for the bench card; production copy is decided at pick */
  meaning: string;
}> = [
  {
    id: 'arranged',
    label: 'As arranged',
    meaning: 'Your manual order, exactly as the ribbon has it.',
  },
  {
    id: 'active-first',
    label: 'Active first',
    meaning: 'Working Agents lead each Project; the rest keep your order.',
  },
  {
    id: 'needs-you-first',
    label: 'Needs you first',
    meaning: 'Agents waiting on you lead; working ones follow.',
  },
];

export interface TeamOrderSignals {
  activity: Readonly<Record<string, boolean>>;
  attention: Readonly<Record<string, SessionAttentionSignal>>;
}

/** Lower band sorts earlier. Exposed for the bench's band labels. */
export function teamOrderBand(
  tab: WorkspaceTab,
  mode: TeamOrderMode,
  { activity, attention }: TeamOrderSignals
): number {
  if (mode === 'arranged') return 0;
  const live = tabIsLive(tab);
  const working = !!(tab.sessionId && live && activity[tab.sessionId]);
  const needsYou =
    !!tab.sessionId && live && attentionNeedsOperator(attention[tab.sessionId]);
  const bands =
    mode === 'active-first'
      ? [working, needsYou, live]
      : [needsYou, working, live];
  const index = bands.findIndex(Boolean);
  return index === -1 ? bands.length : index;
}

/** The same tabs, in view order for `mode`. `arranged` is the identity. */
export function orderTeamTabs(
  tabs: readonly WorkspaceTab[],
  mode: TeamOrderMode,
  signals: TeamOrderSignals
): WorkspaceTab[] {
  if (mode === 'arranged') return [...tabs];
  return tabs
    .map((tab, index) => ({ tab, index, band: teamOrderBand(tab, mode, signals) }))
    .sort((a, b) => a.band - b.band || a.index - b.index)
    .map(entry => entry.tab);
}
