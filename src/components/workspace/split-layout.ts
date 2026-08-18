/**
 * Split-view layout math (S2 ⌘D, reworked D26) — pure and unit-tested,
 * the tab-ring.ts pattern.
 *
 * Doctrine: the pin follows the TAB, not the PTY. "Watch one, drive one"
 * includes watching the pinned agent FINISH — a pinned pane survives its
 * session's exit and keeps showing retained scrollback (with the restore
 * bar) until the operator unpins or closes the tab. The driven (left)
 * region is whatever the workspace would show full-screen without a pin:
 * a live pane, a stopped tab, the ⌘T draft page, or the empty-Project
 * composer. Only drafts are unpinnable (there is nothing to watch yet).
 */
import type { SessionTab, WorkspaceTab } from './use-workspace-state';
import type { PaneLayout } from './terminal-pane';

export interface StageTabRef {
  tab: WorkspaceTab;
  dir: string;
}

/** a tab the split can show on the watched side — anything with content
 *  now (live pane) or retained history (stopped); a ⌘T draft has neither.
 *  A connected coworker always has something to watch: its conversation is
 *  the pane, and "watch one, drive one" is exactly what a coworker running
 *  work beside a local Session is for. */
export function tabIsPinnable(tab: WorkspaceTab): boolean {
  return tab.kind === 'remote-agent' || tab.lifecycle !== 'draft';
}

/** ⌘D outcome against the current pin: a real pin unpins (even a stopped
 *  one — muscle memory must hold); otherwise the active tab pins if it
 *  can; a pin whose tab is gone drops instead of blocking the key.
 *  `applied` = the press did something and should be consumed. */
export function nextPin(options: {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  pinnedTabId: string | null;
}): { pin: string | null; applied: boolean } {
  const { tabs, activeTabId, pinnedTabId } = options;
  const pinReal =
    pinnedTabId !== null &&
    tabs.some(t => t.id === pinnedTabId && tabIsPinnable(t));
  if (pinReal) return { pin: null, applied: true };
  const active = tabs.find(t => t.id === activeTabId);
  if (!active || !tabIsPinnable(active)) {
    // still drop a pin that lost its tab
    return { pin: null, applied: pinnedTabId !== null };
  }
  return { pin: active.id, applied: true };
}

export interface StageLayout {
  /** watched pane — right in a split, full when nothing drives beside it */
  pinned: StageTabRef | null;
  /** driven tab pane (left); null when the driven side is stage content
   *  (the empty-Project composer) or absent */
  driven: StageTabRef | null;
  split: boolean;
  /** layout for the non-tab stage content (the empty-Project composer) */
  stagePane: PaneLayout;
  layoutFor(tabId: string): PaneLayout;
}

export function resolveStageLayout(options: {
  entries: StageTabRef[];
  activeTabId: string | null;
  /** the active Project exists with zero tabs — its composer IS the
   *  driven content */
  emptyProjectStage: boolean;
  pinnedTabId: string | null;
  /** last active non-pinned tab — keeps the split up while the keyboard
   *  sits in the pinned pane */
  companionTabId: string | null;
}): StageLayout {
  const {
    entries,
    activeTabId,
    emptyProjectStage,
    pinnedTabId,
    companionTabId,
  } = options;
  const byId = new Map(entries.map(e => [e.tab.id, e]));
  const pinnedRef =
    pinnedTabId !== null ? (byId.get(pinnedTabId) ?? null) : null;
  const pinned = pinnedRef && tabIsPinnable(pinnedRef.tab) ? pinnedRef : null;
  const active = activeTabId !== null ? (byId.get(activeTabId) ?? null) : null;
  const activeIsPinned = !!pinned && !!active && active.tab.id === pinned.tab.id;

  const driven = !pinned
    ? null
    : activeIsPinned
      ? companionTabId !== null && companionTabId !== pinned.tab.id
        ? (byId.get(companionTabId) ?? null)
        : null
      : active;

  const split = !!pinned && (!!driven || (!active && emptyProjectStage));

  const stagePane: PaneLayout =
    !emptyProjectStage || active ? 'hidden' : split ? 'left' : 'full';

  const layoutFor = (tabId: string): PaneLayout => {
    if (split) {
      if (driven && tabId === driven.tab.id) return 'left';
      if (pinned && tabId === pinned.tab.id) return 'right';
      return 'hidden';
    }
    if (pinned) {
      // a pin with nothing beside it (the active tab IS the pin and its
      // companion is gone) renders alone
      return tabId === pinned.tab.id ? 'full' : 'hidden';
    }
    return activeTabId !== null && tabId === activeTabId ? 'full' : 'hidden';
  };

  return { pinned, driven, split, stagePane, layoutFor };
}

export interface ComposerSlot {
  /** The draft tab hosting the composer, or null before one exists. Always a
   *  Session tab: a coworker is opened, never composed. */
  tab: SessionTab | null;
  dir: string;
  layout: PaneLayout;
  /**
   * The composer's React identity. STABLE across the moment a draft intent
   * materialises the draft tab, which is the whole point: see below.
   */
  key: string;
}

/**
 * Where the new-Agent composer renders, and — the load-bearing part — WHO it
 * is while it renders there (BUG-041).
 *
 * The composer an empty Project shows and the composer a ⌘T draft tab shows
 * are the same surface at two moments of one gesture: the operator's first
 * draft intent is what materialises the tab. Resolving them as two render
 * sites made that materialisation a REMOUNT, so adjusting the first axis of a
 * setup closed the drawer holding it, dropped the settled engine catalog, and
 * took the caret with it. One slot, one identity, and React reconciles it in
 * place instead — nothing has to be carried across a hand-off that no longer
 * tears anything down.
 *
 * The identity ends only where the draft does. `draftDiscards` counts the
 * drafts the operator has thrown away, so the composer that replaces a
 * discarded draft is a NEW one and cannot inherit its task or its setup.
 */
export function resolveComposerSlot(options: {
  entries: StageTabRef[];
  stage: StageLayout;
  activeProjectDir: string | null;
  draftDiscards: number;
}): ComposerSlot | null {
  const { entries, stage, activeProjectDir, draftDiscards } = options;
  const draft =
    entries.find(
      (entry): entry is StageTabRef & { tab: SessionTab } =>
        entry.tab.kind === 'session' &&
        entry.tab.lifecycle === 'draft' &&
        stage.layoutFor(entry.tab.id) !== 'hidden'
    ) ?? null;
  const dir = draft
    ? draft.dir
    : stage.stagePane !== 'hidden'
      ? activeProjectDir
      : null;
  if (dir === null) return null;
  const layout = draft ? stage.layoutFor(draft.tab.id) : stage.stagePane;
  if (layout === 'hidden') return null;
  return {
    tab: draft?.tab ?? null,
    dir,
    layout,
    key: `composer:${dir}#${draftDiscards}`,
  };
}
