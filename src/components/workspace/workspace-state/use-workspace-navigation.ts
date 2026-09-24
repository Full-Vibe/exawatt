'use client';

/**
 * Where the operator stands, and the order of what he looks at.
 *
 * Every verb here that takes the operator somewhere goes through
 * `moveOperator`, the one door selection uses (BUG-018): selecting a Project
 * or tab, the global tab ring (⌘⇧[/]), ⌘1–⌘9, back/forward, and the split
 * pin (⌘D). Arrangement (D20) reorders tabs within their Project and
 * Projects globally; Project order also syncs to the registry.
 */
import { useCallback, type Dispatch, type SetStateAction } from 'react';
import {
  moveProjectInList,
  moveTabWithinProject,
  nextTabInRing,
  placeProjectBeside,
  placeTabBeside,
  tabAtOrdinal,
  type RingAnchor,
} from '../tab-ring';
import { nextPin } from '../split-layout';
import {
  isSessionTab,
  type Latest,
  type Project,
  type WorkspaceLayout,
} from './workspace-model';

export function useWorkspaceNavigation({
  stateRef,
  moveOperator,
  syncProjectOrder,
  setProjects,
  setPinnedTabId,
}: {
  stateRef: Latest<WorkspaceLayout>;
  moveOperator: (dir: string, tabId: string | null) => void;
  /** best-effort push of Project order to the registry */
  syncProjectOrder: (ordered: Project[]) => void;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  setPinnedTabId: Dispatch<SetStateAction<string | null>>;
}) {
  const selectProject = useCallback(
    (index: number): boolean => {
      const g = stateRef.current.projects[index];
      if (!g) return false;
      moveOperator(g.dir, null);
      return true;
    },
    [moveOperator, stateRef]
  );

  /** Activate a tab by live PTY, stable tab, or durable Session identity. */
  const activateSession = useCallback(
    (sessionRef: string): boolean => {
      const { projects: gs } = stateRef.current;
      for (const g of gs) {
        const tab = g.tabs.find(t =>
          isSessionTab(t)
            ? t.sessionId === sessionRef ||
              t.id === sessionRef ||
              t.durableSessionId === sessionRef
            : // A coworker answers to its tab id only. The other two names are
              // Session identities it does not have.
              t.id === sessionRef
        );
        if (tab) {
          moveOperator(g.dir, tab.id);
          return true;
        }
      }
      return false;
    },
    [moveOperator, stateRef]
  );

  /** ⌘D: pin the active tab for a split ("watch one, drive one") — the
   *  pinned tab stays visible beside whatever becomes active; ⌘D unpins.
   *  The pin follows the TAB, not the PTY (D26): a pinned pane survives
   *  its session's exit (retained scrollback stays watched), so ⌘D on a
   *  stopped pin still just unpins. The decision table is pure and
   *  unit-tested in split-layout.ts. */
  const togglePin = useCallback((): boolean => {
    const { projects: gs, activeDir: ad, pinnedTabId: pin } = stateRef.current;
    const active = gs.find(g => g.dir === ad);
    const { pin: next, applied } = nextPin({
      tabs: gs.flatMap(g => g.tabs),
      activeTabId: active?.activeTabId ?? null,
      pinnedTabId: pin,
    });
    setPinnedTabId(next);
    return applied;
  }, [setPinnedTabId, stateRef]);

  /** pin/unpin a SPECIFIC tab in the split (D27 context menu); the ⌘D
   *  toggle for the active tab remains togglePin */
  const togglePinTab = useCallback(
    (tabId: string) => {
      setPinnedTabId(cur => (cur === tabId ? null : tabId));
    },
    [setPinnedTabId]
  );

  /** back/forward tab application (D27): select only if it still exists */
  const selectExistingTab = useCallback(
    (dir: string, tabId: string) => {
      const { projects: gs } = stateRef.current;
      const g = gs.find(x => x.dir === dir);
      if (!g || !g.tabs.some(t => t.id === tabId)) return;
      moveOperator(dir, tabId);
    },
    [moveOperator, stateRef]
  );

  const selectTab = useCallback(
    (dir: string, tabId: string) => moveOperator(dir, tabId),
    [moveOperator]
  );

  /** ⌘⇧[/]: rotate through every visible section in display order, crossing
   *  project boundaries (operator, 2026-07-03) — the strip is one global
   *  ring. Open zero-tab Projects are real stops (D19): landing on one
   *  activates its empty state (the Agent composer) instead of skipping it.
   *  The ring math is pure and unit-tested in tab-ring.ts (D18).
   *
   *  DISPLAY order is a parameter, because it is not the same at every
   *  altitude (BUG-021). The strip shows the durable manual arrangement
   *  (D20) and is the default; Team shows S6.3's Started or Activity sort
   *  and passes that instead, so one press moves one tile in whichever
   *  order the operator is actually looking at. The ring math stays the one
   *  owner either way — only what it is asked about changes. */
  const cycleTab = useCallback(
    (
      delta: 1 | -1,
      navigation?: {
        displayed?: readonly Project[];
        anchor?: RingAnchor;
      }
    ): RingAnchor | null => {
      const { projects: gs, activeDir: ad } = stateRef.current;
      const next = nextTabInRing(
        navigation?.displayed ?? gs,
        ad,
        delta,
        navigation?.anchor
      );
      if (!next) return null;
      moveOperator(next.dir, next.tab?.id ?? null);
      return { dir: next.dir, tabId: next.tab?.id ?? null };
    },
    [moveOperator, stateRef]
  );

  /** ⌘1–⌘9: jump straight to the Nth tab of the global ring (D18 — the
   *  highest-frequency switch gets the cheapest chord, browser-style). */
  const selectTabByOrdinal = useCallback(
    (index: number): boolean => {
      const target = tabAtOrdinal(stateRef.current.projects, index);
      if (!target) return false;
      moveOperator(target.dir, target.tab.id);
      return true;
    },
    [moveOperator, stateRef]
  );

  // ── Arrangement (D20): order is an interface once ⌘digit ordinals
  // exist. Tabs arrange within their Project; Projects arrange globally.
  // Order persists with the layout; Project order also pushes best-effort
  // to the registry's sort_order so it syncs across machines.
  const applyProjectOrder = useCallback(
    (next: Project[] | null): boolean => {
      if (!next) return false;
      setProjects(next);
      syncProjectOrder(next);
      return true;
    },
    [setProjects, syncProjectOrder]
  );

  /** ⌘⌥[/⌘⌥]: nudge the ACTIVE tab one slot within its Project */
  const moveActiveTab = useCallback(
    (delta: 1 | -1): boolean => {
      const { projects: gs, activeDir: ad } = stateRef.current;
      const active = gs.find(g => g.dir === ad);
      if (!active?.activeTabId) return false;
      const next = moveTabWithinProject(gs, active.activeTabId, delta);
      if (!next) return false;
      setProjects(next);
      return true;
    },
    [setProjects, stateRef]
  );

  /** ⌘⌥⇧[/⌘⌥⇧]: nudge the ACTIVE Project one slot in the strip */
  const moveActiveProject = useCallback(
    (delta: 1 | -1): boolean => {
      const { projects: gs, activeDir: ad } = stateRef.current;
      if (!ad) return false;
      return applyProjectOrder(moveProjectInList(gs, ad, delta));
    },
    [applyProjectOrder, stateRef]
  );

  /** drag-and-drop: drop a tab beside a sibling in the same Project */
  const reorderTab = useCallback(
    (
      tabId: string,
      targetTabId: string,
      place: 'before' | 'after'
    ): boolean => {
      const next = placeTabBeside(
        stateRef.current.projects,
        tabId,
        targetTabId,
        place
      );
      if (!next) return false;
      setProjects(next);
      return true;
    },
    [setProjects, stateRef]
  );

  /** drag-and-drop: drop a Project group beside another */
  const reorderProject = useCallback(
    (dir: string, targetDir: string, place: 'before' | 'after'): boolean =>
      applyProjectOrder(
        placeProjectBeside(stateRef.current.projects, dir, targetDir, place)
      ),
    [applyProjectOrder, stateRef]
  );

  return {
    selectProject,
    selectTab,
    activateSession,
    cycleTab,
    selectTabByOrdinal,
    selectExistingTab,
    moveActiveTab,
    moveActiveProject,
    reorderTab,
    reorderProject,
    togglePin,
    togglePinTab,
  };
}
