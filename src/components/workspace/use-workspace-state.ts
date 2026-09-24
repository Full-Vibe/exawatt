'use client';

/**
 * Workspace state (ENG-002 W0.2): project groups keyed by PROJECT
 * DIRECTORY, tabs within them, persistence, and exact-ID resume.
 *
 * Model decisions (operator, 2026-07-02):
 * - one app window; projects are groups inside it (⌘⌥1..9 switches
 *   project, ⌘⇧[/] rotates the GLOBAL tab ring, crossing projects)
 * - launching REQUIRES a project directory (never a silent home default);
 *   the last-used directory is remembered
 * - directory → project resolution happens in the main process (worktrees
 *   map to their main repo), so grouping is consistent everywhere
 * - on app restart, layout restores without spawning. Each agent resumes only
 *   an exact saved provider ID after an explicit operator action; a renderer
 *   reload re-adopts still-live PTYs.
 */
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
} from 'react';
import {
  useSessionScope,
  useSessionScopeRelease,
  useSessionScopedIdSet,
  useSessionScopedMap,
  useSessionScopedRecord,
} from './session-scoped-state';
import { useClosedSessionCount } from './use-closed-session-count';
import type {
  GoalVisual,
  PtyAttention,
  PtyReentryRecap,
  PtySessionRecord,
  SessionDelegation,
} from '@exawatt/core/desktop-bridge';
import {
  isRemoteAgentTab,
  isSessionTab,
  newTabId,
  tabFromPtySession,
  tabIsLive,
  type ObservedExit,
  type Project,
  type SessionTab,
  type WorkspaceLayout,
} from './workspace-state/workspace-model';
import { patchSessionTab, placeTab } from './workspace-state/project-list';
import { RecentProjects } from './workspace-state/recent-projects';
import { SessionOperations } from './workspace-state/session-operations';
import { useWorkspaceProjects } from './workspace-state/use-workspace-projects';
import { useWorkspaceHydration } from './workspace-state/use-workspace-hydration';
import { useWorkspacePersistence } from './workspace-state/use-workspace-persistence';
import { useSessionLaunch } from './workspace-state/use-session-launch';
import { useRecentlyClosed } from './workspace-state/use-recently-closed';
import { useSessionRuntime } from './workspace-state/use-session-runtime';
import {
  moveProjectInList,
  moveTabWithinProject,
  nextTabInRing,
  placeProjectBeside,
  placeTabBeside,
  tabAtOrdinal,
  type RingAnchor,
} from './tab-ring';
import { nextPin } from './split-layout';
import type { PtyHarness } from '@exawatt/core';
import {
  SESSION_JUMP_EVENT,
  TAB_SELECT_EVENT,
  LAUNCH_EVENT,
  OPEN_PROJECT_EVENT,
  TOGGLE_SPLIT_EVENT,
  consumePendingSessionJump,
  consumePendingTabSelect,
  consumePendingLaunch,
  consumePendingOpenProject,
} from './session-jump';

// The workspace model, its persisted shapes, and its verbs live in
// `workspace-state/`; this module composes them and stays the one entry point
// every caller imports from.
export {
  REVIVE_FAILED,
  applyWorkspaceDraftPatch,
  isRemoteAgentTab,
  isSessionTab,
  projectRootPath,
  remoteAgentGroupDir,
  resumableAgentTabsInProject,
  tabCanResumeAsAgent,
  tabFromPtySession,
  tabIsLive,
  tabNeedsReconnection,
} from './workspace-state/workspace-model';
export type {
  CloseOutcome,
  Project,
  RemoteAgentOpenRef,
  RemoteAgentTab,
  ResumeBatchProgress,
  ResumeState,
  SessionLifecycle,
  SessionTab,
  TabTitleKind,
  WorkspaceDraftPatch,
  WorkspaceTab,
} from './workspace-state/workspace-model';
export {
  dropDetachedRemoteTabs,
  parsePersisted,
} from './workspace-state/persisted-layout';
export type {
  PersistedRemoteAgentTab,
  PersistedSessionTab,
  PersistedTab,
  PersistedV6,
  PersistedV7,
} from './workspace-state/persisted-layout';
export type { LaunchOptions } from './workspace-state/use-session-launch';

export interface WorkspaceStateOptions {
  /**
   * Estimated terminal size for NEW sessions (from the pane container).
   * Passing real dimensions at spawn kills the width race: TUIs read the
   * terminal size during init, and a resize sent milliseconds later can
   * land before their WINCH handler exists — leaving them drawn at the
   * 80-col default forever.
   */
  getInitialSize?: () => { cols: number; rows: number } | null;
}

export function useWorkspaceState(options: WorkspaceStateOptions = {}) {
  const sizeRef = useRef(options.getInitialSize);
  sizeRef.current = options.getInitialSize;
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeDir, setActiveDir] = useState<string | null>(null);
  const [lastUsedDir, setLastUsedDir] = useState('');
  /** split view (S2): this tab renders beside the active one ("watch one,
   *  drive one"); null = no split */
  const [pinnedTabId, setPinnedTabId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /**
   * Every store below is keyed by a Session identity and is declared through
   * ONE owner (BUG-037, the renderer half of main's BUG-025). The owner also
   * hands back the ref mirror each store needs, and releases all of them at
   * the single moment the layout stops naming a Session — so a store cannot
   * be born here without a delete site. See `session-scoped-state.ts`.
   */
  const sessionScope = useSessionScope();
  /** goal subtitles keyed by durableSessionId (D21): the goal is durable
   *  Session truth — live updates stream from main, the persisted layout
   *  seeds them back after a restart, stopped tabs keep theirs */
  const [summaries, setSummaries, summariesRef] =
    useSessionScopedRecord<string>(sessionScope);
  /** Goal visuals share the same durable-Session identity and source seam. */
  const [goalVisuals, setGoalVisuals, goalVisualsRef] =
    useSessionScopedRecord<GoalVisual>(sessionScope);
  /** needs-operator flags keyed by sessionId (ENG-015 S1; main is truth) */
  const [attention, setAttention] =
    useSessionScopedRecord<PtyAttention>(sessionScope);
  /** sessions actively producing output right now, keyed by sessionId
   *  (D18: running vs waiting must read at a glance; main is truth) */
  const [activity, setActivity, activityRef] =
    useSessionScopedRecord<boolean>(sessionScope);
  /** sessions ever given work, keyed by sessionId (D22: started vs
   *  unstarted must read at a glance; main is truth — task/resume at
   *  create, first human keystroke, or raised attention) */
  const [engaged, setEngaged, engagedRef] =
    useSessionScopedRecord<boolean>(sessionScope);
  /** harness-reported delegated work, keyed by sessionId (ENG-023). Only
   *  Sessions with children outstanding appear; a missing key means "no
   *  delegated work reported", which covers both a Session with none and a
   *  source that cannot report it. The ref mirror is read by the close path,
   *  which asks about the TURN rather than about bytes: an Agent mid-tool-call
   *  has quiet activity and an open turn. */
  const [delegation, setDelegation, delegationRef] =
    useSessionScopedRecord<SessionDelegation>(sessionScope);
  /** quiet, one-shot S4 catch-up for the session currently being revisited */
  const [reentryRecap, setReentryRecap] = useState<PtyReentryRecap | null>(
    null
  );
  const dismissReentryRecap = useCallback(() => setReentryRecap(null), []);
  const stateRef = useRef<WorkspaceLayout>({
    projects,
    activeDir,
    lastUsedDir,
    pinnedTabId,
  });
  stateRef.current = { projects, activeDir, lastUsedDir, pinnedTabId };
  const readyRef = useRef(ready);
  readyRef.current = ready;
  // Exits can precede the IPC reply that introduces a replacement runtime.
  // Keep them only for the lifetime of the corresponding operation.
  const operationExitsRef =
    useSessionScopedMap<Record<string, ObservedExit>>(sessionScope);
  /** Durable Session ids parked by the shutdown checkpoint. */
  const shutdownTargetsRef = useSessionScopedIdSet(sessionScope);
  /** Identity can arrive before React has committed a newly launched/restored
   * tab. Retain that event by durable Session id instead of dropping it. */
  const observedIdentitiesRef = useSessionScopedMap<string>(sessionScope);
  const { closedSessionCount, beginPendingClose } =
    useClosedSessionCount(ready);
  // The single release moment: the layout is the renderer's authority on which
  // Sessions exist, so an identity it has stopped naming is unreachable and is
  // released here — whatever removed the tab, and in both identity spaces.
  //
  // Only Session tabs name a Session. A coworker tab holds neither identity,
  // so it is not part of the question this owner answers; projecting it out
  // here keeps that fact in one place instead of teaching the owner about a
  // second kind of tab it would then have to keep ignoring.
  const sessionScopeLayout = useMemo(
    () =>
      projects.map(project => ({ tabs: project.tabs.filter(isSessionTab) })),
    [projects]
  );
  useSessionScopeRelease(sessionScope, sessionScopeLayout);
  /** durable Project recency (ENG-016 D8) — loaded from the persisted layout,
   *  re-merged on every save so closed Projects survive */
  const [recents] = useState(() => new RecentProjects());
  /** resume, model change, and Project pause in flight, with the exits that
   *  raced their replies */
  const [operations] = useState(() => new SessionOperations(operationExitsRef));

  /**
   * The ONE door selection goes through (BUG-018).
   *
   * Every verb that takes the operator TO a Project or tab goes through here.
   * Each used to carry its own copy of "make this the operator's position",
   * which is why an asynchronous completion could be born asserting one.
   * Operator-driven verbs call this directly; asynchronous ones must first
   * hold a still-current claim from `operatorPosition`
   * (see `src/components/nav/operator-position.ts`).
   *
   * Closing is the one thing that does NOT come through here: it repairs a
   * position the operator himself destroyed, by following the neighbour rule.
   *
   * `tabId` is null for a move that only changes Project (⌘⌥N onto a Project
   * with no tabs), which leaves that Project's own current tab alone.
   */
  const moveOperator = useCallback((dir: string, tabId: string | null) => {
    setActiveDir(dir);
    if (tabId === null) return;
    setProjects(prev =>
      prev.map(g => (g.dir === dir ? { ...g, activeTabId: tabId } : g))
    );
  }, []);

  /**
   * Append a PTY incarnation as a live or stopped tab in its Project.
   *
   * Deliberately does not move the operator. Appending is bookkeeping; going
   * there is a decision, and it belongs to the caller that knows whether the
   * intent authorising it is still current. Mount adoption appends a whole
   * fleet at once and must move nobody: it used to assert selection once per
   * adopted Session, so the LAST one won and a relaunch landed on an
   * arbitrary Agent instead of the tab the layout restored.
   *
   * A Project still always names a current tab while it has one — filling an
   * EMPTY slot says where the operator would land if he ever went there,
   * which moves nobody; overwriting a filled one is a move.
   */
  const addSession = useCallback(
    (
      s: PtySessionRecord,
      tabId?: string,
      roadmapItemId?: string | null,
      initialTask?: string | null
    ) => {
      const tab = tabFromPtySession(
        s,
        tabId ?? newTabId(),
        roadmapItemId ?? null,
        initialTask ?? null
      );
      setProjects(prev =>
        placeTab(prev, { dir: s.projectDir, name: s.projectName }, tab)
      );
      return tab.id;
    },
    []
  );

  /**
   * Patch one Session tab. Deliberately not total over the union: every field
   * it exists to move is a PTY fact, and a coworker tab has none of them. A
   * remote tab reaches this only through a bug, and ignoring it keeps that bug
   * from writing a lifecycle onto someone else's Agent.
   */
  const updateTab = useCallback((tabId: string, patch: Partial<SessionTab>) => {
    setProjects(prev => patchSessionTab(prev, tabId, patch));
  }, []);

  /** S13.3 secondary path: attach a running Session to an item locally. */
  const attachRoadmapItem = useCallback(
    (tabId: string, roadmapItemId: string): boolean => {
      const tab = stateRef.current.projects
        .flatMap(project => project.tabs)
        .find(candidate => candidate.id === tabId);
      if (!tab || !tabIsLive(tab)) return false;
      updateTab(tabId, { roadmapItemId });
      return true;
    },
    [updateTab]
  );

  const {
    syncProjectIdentity,
    reconcileWithRegistry,
    syncProjectOrder,
    openProject,
    openRemoteAgent,
    openContextProject,
    importProjects,
    closeProject,
    renameProject,
    setProjectColor,
  } = useWorkspaceProjects({
    stateRef,
    recents,
    setProjects,
    setActiveDir,
    setLastUsedDir,
    setError,
    moveOperator,
  });

  // ---- mount: adopt live sessions, restore ended layout without spawning ----
  const { workspaceLoadFailure, retryWorkspaceLoad } = useWorkspaceHydration({
    stateRef,
    observedIdentitiesRef,
    operations,
    recents,
    setProjects,
    setActiveDir,
    setLastUsedDir,
    setPinnedTabId,
    setReady,
    setSummaries,
    setGoalVisuals,
    setAttention,
    setActivity,
    setEngaged,
    setDelegation,
    setReentryRecap,
    addSession,
    reconcileWithRegistry,
  });

  // ---- persistence: debounced, on unmount, and at the shutdown checkpoint ----
  useWorkspacePersistence({
    projects,
    activeDir,
    lastUsedDir,
    pinnedTabId,
    summaries,
    goalVisuals,
    ready,
    readyRef,
    stateRef,
    recents,
    summariesRef,
    goalVisualsRef,
    shutdownTargetsRef,
  });

  // ---- verbs ----
  const { launch, cloneSession, launchHere, createDraftTab, updateDraft } =
    useSessionLaunch({
      stateRef,
      sizeRef,
      summariesRef,
      engagedRef,
      observedIdentitiesRef,
      addSession,
      moveOperator,
      syncProjectIdentity,
      setProjects,
      setError,
      setLastUsedDir,
    });
  const {
    draftDiscards,
    closeTab,
    reopenClosedSession,
    reopenLastClosedSession,
    listClosedSessions,
  } = useRecentlyClosed({
    stateRef,
    readyRef,
    operations,
    summariesRef,
    engagedRef,
    activityRef,
    delegationRef,
    beginPendingClose,
    moveOperator,
    setProjects,
    setPinnedTabId,
    setSummaries,
    setError,
  });
  const {
    resumeBatchProgress,
    resumeTab,
    changeSessionModel,
    pauseProject,
    resumeAll,
    resumeProject,
  } = useSessionRuntime({
    stateRef,
    sizeRef,
    operations,
    summariesRef,
    updateTab,
    setError,
  });
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

  const activeProject = projects.find(g => g.dir === activeDir) ?? null;
  /** operator naming (W0.4): titles/names persist via the layout save; the
   *  PTY session is renamed too so fleet/spatial show the same identity.
   *
   *  A coworker is not renamed here. Its name is its source's, carried
   *  through the projection mapping, so an Exawatt-local override would be a
   *  second name for the same worker that the source never hears about;
   *  renaming lives with the mapping, in Connect and source detail. */
  const renameTab = useCallback(
    (tabId: string, title: string) => {
      const next = title.trim();
      if (!next) return;
      const tab = stateRef.current.projects
        .flatMap(g => g.tabs)
        .find(t => t.id === tabId);
      if (!tab || isRemoteAgentTab(tab)) return;
      updateTab(tabId, { title: next, titleKind: 'operator' });
      if (tab.sessionId) {
        void window.electron?.pty?.rename(tab.sessionId, next);
      }
    },
    [updateTab]
  );

  const activeTab =
    activeProject?.tabs.find(t => t.id === activeProject.activeTabId) ?? null;

  // ---- palette requests (S2) and their replay once the layout has loaded ----
  // ---- palette requests (S2): the ⌘K switcher lives at the app root and
  // asks the workspace to activate a session / launch a harness. Live events
  // handle the mounted-and-ready case; before ready the pending slot is left
  // alone so the ready-effect below applies it against the LOADED layout
  // (acting early would fail against empty state and lose the request).
  useEffect(() => {
    const onJump = (e: Event) => {
      if (!readyRef.current) return;
      consumePendingSessionJump();
      activateSession((e as CustomEvent<string>).detail);
    };
    // back/forward (D27): select a tab by identity when it still exists —
    // a closed tab simply stays a dead stop in the history
    const onTabSelect = (e: Event) => {
      if (!readyRef.current) return;
      consumePendingTabSelect();
      const { dir, tabId } =
        (e as CustomEvent<{ dir: string; tabId: string }>).detail ?? {};
      selectExistingTab(dir, tabId);
    };
    const onLaunch = (e: Event) => {
      if (!readyRef.current) return;
      consumePendingLaunch();
      launchHere((e as CustomEvent<PtyHarness>).detail);
    };
    const onToggleSplit = () => {
      if (readyRef.current) togglePin();
    };
    // JUMP_ATTENTION_EVENT is owned by WorkspaceClient: it composes PTY and
    // roadmap signals before deriving both the visible marker and jump queue.
    const onOpenProject = (e: Event) => {
      if (!readyRef.current) return;
      consumePendingOpenProject();
      void openProject((e as CustomEvent<string>).detail);
    };
    window.addEventListener(SESSION_JUMP_EVENT, onJump);
    window.addEventListener(TAB_SELECT_EVENT, onTabSelect);
    window.addEventListener(LAUNCH_EVENT, onLaunch);
    window.addEventListener(OPEN_PROJECT_EVENT, onOpenProject);
    window.addEventListener(TOGGLE_SPLIT_EVENT, onToggleSplit);
    return () => {
      window.removeEventListener(SESSION_JUMP_EVENT, onJump);
      window.removeEventListener(TAB_SELECT_EVENT, onTabSelect);
      window.removeEventListener(LAUNCH_EVENT, onLaunch);
      window.removeEventListener(OPEN_PROJECT_EVENT, onOpenProject);
      window.removeEventListener(TOGGLE_SPLIT_EVENT, onToggleSplit);
    };
  }, [
    activateSession,
    launchHere,
    openProject,
    readyRef,
    selectExistingTab,
    togglePin,
  ]);

  useEffect(() => {
    if (!ready) return;
    const jump = consumePendingSessionJump();
    if (jump) activateSession(jump);
    // ⌘[ from another route (D27): the tab half of the location fired
    // before this workspace mounted — apply it against the loaded layout
    const tabSel = consumePendingTabSelect();
    if (tabSel) selectExistingTab(tabSel.dir, tabSel.tabId);
    const harness = consumePendingLaunch();
    if (harness) launchHere(harness);
    const proj = consumePendingOpenProject();
    if (proj) void openProject(proj);
  }, [ready, activateSession, selectExistingTab, launchHere, openProject]);

  // ---- attention focus contract (S1) ----
  const activeSessionId =
    activeTab && isSessionTab(activeTab) ? activeTab.sessionId : null;
  useEffect(() => {
    setReentryRecap(current =>
      current?.id === activeSessionId ? current : null
    );
  }, [activeSessionId, setReentryRecap]);

  // A selected, visible tab is acknowledged before paint. A passive effect
  // used to leave one rendered frame where the newly active tab still wore
  // its old attention marker; main then confirmed the clear over IPC.
  useLayoutEffect(() => {
    if (activeSessionId && document.hasFocus()) {
      setAttention(prev => {
        if (!(activeSessionId in prev)) return prev;
        const next = { ...prev };
        delete next[activeSessionId];
        return next;
      });
    }
  }, [activeSessionId, setAttention]);

  useEffect(() => {
    const api = window.electron?.pty;
    if (!api?.focus) return;
    void api.focus(activeSessionId);
    // Main remains authoritative for background-window attention and
    // broadcasts the confirmed clear to every renderer on focus.
    // leaving the workspace (unmount) unfocuses — flags accumulate again
    return () => void api.focus(null);
  }, [activeSessionId]);

  return {
    projects,
    activeProject,
    activeTab,
    pinnedTabId,
    lastUsedDir,
    summaries,
    goalVisuals,
    attention,
    activity,
    delegation,
    engaged,
    reentryRecap,
    error,
    resumeBatchProgress,
    closedSessionCount,
    draftDiscards,
    setError,
    dismissReentryRecap,
    ready,
    workspaceLoadFailure,
    retryWorkspaceLoad,
    launch,
    cloneSession,
    launchHere,
    openProject,
    openContextProject,
    importProjects,
    closeProject,
    closeTab,
    createDraftTab,
    updateDraft,
    attachRoadmapItem,
    reopenClosedSession,
    reopenLastClosedSession,
    listClosedSessions,
    resumeTab,
    changeSessionModel,
    resumeProject,
    pauseProject,
    resumeAll,
    selectProject,
    selectTab,
    openRemoteAgent,
    activateSession,
    cycleTab,
    selectTabByOrdinal,
    moveActiveTab,
    moveActiveProject,
    reorderTab,
    reorderProject,
    togglePin,
    togglePinTab,
    renameTab,
    renameProject,
    setProjectColor,
  };
}
