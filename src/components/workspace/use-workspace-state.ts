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
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { WorkspaceLoadFailure } from './workspace-storage-recovery';
import { HARNESS_META } from './harnesses';
import {
  useSessionScope,
  useSessionScopeRelease,
  useSessionScopedIdSet,
  useSessionScopedMap,
  useSessionScopedRecord,
} from './session-scoped-state';
import {
  operatorPosition,
  type OperatorMoveClaim,
} from '@/components/nav/operator-position';
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
import {
  sessionDelegationBusy,
  sessionGlyphState,
  sessionReportedBlocked,
} from './session-status';
import { loadTerminalFont } from './terminal-font';
import { useClosedSessionCount } from './use-closed-session-count';
import { useLatestRequest } from '@/hooks/use-latest-request';
import {
  DEFAULT_AGENT_PERMISSION_MODE,
  isAgentSourceId,
  loadAgentSourcePreferences,
  loadAgentSourceRegistry,
  loadAgentModelCatalog,
  permissionModeFor,
} from './agent-sources';
import {
  cloneTargetSourceReady,
  sessionClonePrompt,
  tabCanClone,
  type CloneSessionTarget,
} from './session-clone';
import { recordLaunchConfigurationSuccess } from '@/lib/launch-configurations';
import {
  openRepositoryProject,
  listProjects,
  renameProject as registryRenameProject,
  reorderProjects as registryReorderProjects,
  setProjectColor as registrySetProjectColor,
} from '@/lib/projects/registry';
import type { AgentPermissionMode, PtyHarness } from '@exawatt/core';
import type {
  ClosedSessionEntry,
  GoalVisual,
  PtyAttention,
  PtyReentryRecap,
  PtySessionRecord,
  SessionDelegation,
  SessionModelChange,
} from '@exawatt/core/desktop-bridge';
import {
  REVIVE_FAILED,
  applyWorkspaceDraftPatch,
  isRemoteAgentTab,
  isSessionTab,
  newDraftTab,
  newDurableSessionId,
  newTabId,
  runtimeAdoptionPatch,
  tabFromClosedEntry,
  projectRootPath,
  remoteAgentGroupDir,
  resumableAgentTabsInProject,
  tabCanResumeAsAgent,
  tabFromPtySession,
  tabIsLive,
  type CloseOutcome,
  type Project,
  type RemoteAgentOpenRef,
  type RemoteAgentTab,
  type ResumeBatchProgress,
  type SessionTab,
  type WorkspaceDraftPatch,
  type WorkspaceLayout,
  type WorkspaceTab,
} from './workspace-state/workspace-model';
import {
  dropDetachedRemoteTabs,
  parsePersisted,
  type PersistedV7,
} from './workspace-state/persisted-layout';
import {
  persistedContextSummaries,
  persistedGoalVisualRefs,
  restoreLayout,
  resumeIdentityHints,
  seedSessionStores,
  unresolvedGoalVisual,
  withReconciledIdentities,
} from './workspace-state/layout-restore';
import {
  serializeLayout,
  shutdownTargets,
  withLiveHarnessIdentities,
} from './workspace-state/layout-serialize';
import { RecentProjects } from './workspace-state/recent-projects';
import {
  adoptObservedIdentity,
  appendTab,
  closeEmptyProjectGroup,
  linkRegistryProject,
  markPtyExited,
  openContextGroup,
  openProjectGroup,
  openProjectGroups,
  patchDraft,
  patchSessionTab,
  pendingRegistryEdits,
  placeTab,
  reconcileRegistry,
  removeTab,
  renameRemoteAgentViews,
  replaceTab,
  reseedDraft,
} from './workspace-state/project-list';

// The workspace model and its persisted shapes live in `workspace-state/`;
// this module stays the one entry point every caller imports them from.
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

/**
 * The ids of the sources Exawatt still has a record of.
 *
 * `null` means Exawatt could not ask — no desktop bridge, or a read that
 * failed. That is not the same answer as "no sources", and the caller must not
 * treat it as one.
 */
async function readConfiguredSourceIds(): Promise<ReadonlySet<string> | null> {
  const api = window.electron?.connectedSources;
  if (!api?.list) return null;
  try {
    const sources = await api.list();
    return new Set(sources.map(source => source.id));
  } catch {
    return null;
  }
}

export interface LaunchOptions {
  /** Preserve the initiating gesture's focus authority across preparation. */
  focusClaim?: OperatorMoveClaim;
  harness: PtyHarness;
  dir: string;
  permissionMode?: AgentPermissionMode;
  /** model pinned for this launch after resolving the source's current default */
  model?: string;
  /** reasoning effort pinned for this launch; omitted for a harness default */
  effort?: string;
  /** optional first user task for a new interactive Agent Session */
  initialPrompt?: string;
  /** Resume one provider conversation by its durable harness identity. */
  resumeSessionId?: string;
  /** Goal metadata for a resumed conversation; never written to the PTY. */
  statedTask?: string;
  /** Immediate context subtitle while the resumed harness restores. */
  restoredSubtitle?: string;
  /** Retained Exawatt Session to adopt after a successful provider launch.
   * The ledger entry is consumed only after create succeeds. */
  restoreSessionId?: string;
  /** create a git worktree (<repo>-wt/<branch>) and launch inside it */
  worktreeBranch?: string;
  /** roadmap item this session will work on (ENG-017 S4, optional) */
  roadmapItemId?: string;
  /** launch INTO an existing draft tab (D24 new-tab page), keeping its
   *  strip position and id */
  reuseTabId?: string;
}

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
  /**
   * How many drafts have been thrown away (BUG-041).
   *
   * The empty-Project composer and the draft tab that continues it are ONE
   * React element, so materialising that tab must not remount the surface the
   * operator is mid-gesture in. That continuity has to end somewhere, and a
   * DISCARDED draft is the only place it should: the composer that replaces a
   * thrown-away draft is a new one and must not inherit its task or its setup.
   *
   * Deliberately a count, not a Record keyed by Project. Only the active
   * Project's composer is ever mounted, and a draft can only be closed from
   * the Project it belongs to, so a per-Project key would buy precision no
   * reachable interaction can observe — while making this hook hold a
   * `Record<string, …>` that is not keyed by a Session identity, which is the
   * one thing `session-scope.test.tsx` asks it never to do (BUG-037).
   */
  const [draftDiscards, setDraftDiscards] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resumeBatchProgress, setResumeBatchProgress] =
    useState<ResumeBatchProgress | null>(null);
  const [ready, setReady] = useState(false);
  const [workspaceLoadFailure, setWorkspaceLoadFailure] =
    useState<WorkspaceLoadFailure | null>(null);
  const [hydrationAttempt, setHydrationAttempt] = useState(0);
  const retryWorkspaceLoad = useCallback(async () => {
    if (workspaceLoadFailure?.required) {
      await window.electron?.workspace?.retryRecovery();
    }
    setWorkspaceLoadFailure(null);
    setHydrationAttempt(attempt => attempt + 1);
  }, [workspaceLoadFailure]);
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
  /** One projected Agent can have one tab-opening transaction at a time. */
  const remoteAgentOpenInFlightRef = useRef<
    Array<{ agentId: string; task: Promise<string> }>
  >([]);
  // dirs whose identity the operator edited locally — the reconcile-on-load
  // must not clobber a rename/recolor made while the registry fetch was still
  // in flight (its snapshot is already stale), and instead pushes it up.
  const editedDirsRef = useRef<Set<string>>(new Set());
  /** durable Project recency (ENG-016 D8) — loaded from the persisted layout,
   *  re-merged on every save so closed Projects survive */
  const [recents] = useState(() => new RecentProjects());
  const readyRef = useRef(ready);
  readyRef.current = ready;
  /** Clone requests currently spawning, keyed `tabId:targetId`. A ref, not
   *  state: it exists to make a duplicate request a no-op, and re-rendering
   *  the workspace on it would only add churn. Not Session-keyed, and every
   *  entry is deleted by the request that added it. */
  const cloningRef = useRef(new Set<string>());
  const sessionOperationsRef = useRef<Set<string>>(new Set());
  // Exits can precede the IPC reply that introduces a replacement runtime.
  // Keep them only for the lifetime of the corresponding operation.
  const operationExitsRef =
    useSessionScopedMap<
      Record<string, { exitCode: number; exitSignal: string | null }>
    >(sessionScope);
  /** Close/archive work is tracked so browser-style reopen cannot race the
   * optimistic strip removal and read the ledger before the entry lands. */
  const closeInFlightRef = useRef<Set<Promise<CloseOutcome>>>(new Set());
  /** Repeated ⌘⇧T requests are a FIFO queue over a LIFO ledger: each request
   * waits for the previous take, then restores the next-newest entry. */
  const reopenLastClosedQueueRef = useRef<Promise<void>>(Promise.resolve());
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

  const syncProjectIdentity = useCallback(
    (ref: { rootPath: string; name: string }) => {
      void openRepositoryProject(ref)
        .then(proj => {
          setProjects(prev => linkRegistryProject(prev, proj));
          if (!proj.color) {
            const group = stateRef.current.projects.find(
              project => project.dir === proj.root_path
            );
            if (group) {
              void registrySetProjectColor(proj.id, group.color).catch(
                () => {}
              );
            }
          }
        })
        .catch(() => {});
    },
    []
  );

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

  // ---- mount: adopt live sessions, restore ended layout without spawning ----
  /** One hydration read per mount (or per retry); a newer one, or unmount,
   *  supersedes it. */
  const hydrationRequests = useLatestRequest();
  useEffect(() => {
    const api = window.electron?.pty;
    const ws = window.electron?.workspace;
    if (!api) return;
    const hydration = hydrationRequests.begin();
    // flags cleared by events BETWEEN the pty:list snapshot resolving and
    // the seed merge must stay cleared — main won't re-broadcast for them
    const clearedBeforeSeed = new Set<string>();
    // Same race guard for D29's working ride-along: a quiet transition after
    // main captured the list must not be overwritten by the stale snapshot.
    const quietBeforeSeed = new Set<string>();
    // And for delegation (ENG-023 D3a): the last child ending between the
    // snapshot and the seed merge publishes null, which deletes nothing from
    // an empty map — without this guard the stale snapshot then resurrects a
    // rail no future event will clear until the next spawn.
    const settledBeforeSeed = new Set<string>();

    void (async () => {
      // the font settles here too: the revive loop below reads the spawn
      // size via getInitialSize, whose cell metrics come from the resolved
      // font — spawning with defaults while a custom font loads recreates
      // the TUI init-width race
      const [live, persistedRaw, recovery, configuredSourceIds] =
        await Promise.all([
          api.list(),
          ws?.load() ?? Promise.resolve(null),
          ws?.recovery() ?? Promise.resolve({ previousRunInterrupted: false }),
          // Which sources are still configured. A DETACHED source is gone by
          // operator decision, and its coworker tabs must not come back with
          // the layout. Only an ANSWERED list decides that: a read that failed,
          // or a build with no connected-sources capability at all, is not
          // evidence that anything was detached, so the tabs stay and the pane
          // says what it could not read (BUG-063's rule).
          readConfiguredSourceIds(),
          loadTerminalFont(),
        ]);
      if (!hydration.current) return;
      const decoded = parsePersisted(persistedRaw);
      if (persistedRaw !== null && persistedRaw !== undefined && !decoded) {
        throw new Error('Saved workspace format is not supported');
      }
      let persisted = dropDetachedRemoteTabs(decoded, configuredSourceIds);
      if (persisted && api.reconcileResumeIdentities) {
        const hints = resumeIdentityHints(persisted);
        if (hints.some(tab => !tab.harnessSessionId)) {
          try {
            const reconciled = await api.reconcileResumeIdentities(hints);
            if (!hydration.current) return;
            persisted = withReconciledIdentities(persisted, reconciled);
          } catch (cause) {
            console.warn('Session identity reconciliation failed', cause);
          }
        }
      }
      // goal subtitles (D21) and their last ready visual: the persisted
      // layout restores each Session's goal first, through main's stores.
      let restoredSummaries: ReadonlyArray<readonly [string, string | null]> =
        [];
      let restoredGoalVisuals: ReadonlyArray<
        readonly [string, GoalVisual | null]
      > = [];
      if (persisted) {
        const persistedSummaries = persistedContextSummaries(persisted);
        const restoreContext = api.restoreContext;
        restoredSummaries = restoreContext
          ? await Promise.all(
              persistedSummaries.map(
                async ([durableSessionId, summary]) =>
                  [
                    durableSessionId,
                    await restoreContext(durableSessionId, summary),
                  ] as const
              )
            )
          : persistedSummaries;
        if (!hydration.current) return;
        const persistedGoalVisuals = persistedGoalVisualRefs(persisted);
        const restoreGoalVisual = api.restoreGoalVisual;
        restoredGoalVisuals = restoreGoalVisual
          ? await Promise.all(
              persistedGoalVisuals.map(
                async ([durableSessionId, visual]) =>
                  [
                    durableSessionId,
                    await restoreGoalVisual(durableSessionId, visual),
                  ] as const
              )
            )
          : persistedGoalVisuals.map(
              ([durableSessionId, visual]) =>
                [durableSessionId, unresolvedGoalVisual(visual)] as const
            );
        if (!hydration.current) return;
      }
      const seeds = seedSessionStores(
        live,
        { summaries: restoredSummaries, goalVisuals: restoredGoalVisuals },
        {
          attentionCleared: clearedBeforeSeed,
          quiet: quietBeforeSeed,
          settled: settledBeforeSeed,
        }
      );
      if (Object.keys(seeds.summaries).length > 0) {
        setSummaries(prev => ({ ...seeds.summaries, ...prev }));
      }
      if (Object.keys(seeds.goalVisuals).length > 0) {
        setGoalVisuals(prev => ({ ...seeds.goalVisuals, ...prev }));
      }
      if (Object.keys(seeds.attention).length > 0) {
        setAttention(prev => ({ ...seeds.attention, ...prev }));
      }
      if (Object.keys(seeds.activity).length > 0) {
        setActivity(prev => ({ ...seeds.activity, ...prev }));
      }
      if (Object.keys(seeds.engaged).length > 0) {
        setEngaged(prev => ({ ...seeds.engaged, ...prev }));
      }
      if (Object.keys(seeds.delegation).length > 0) {
        setDelegation(prev => ({ ...seeds.delegation, ...prev }));
      }
      const { restored, unclaimed } = restoreLayout(persisted, live, {
        observedIdentities: observedIdentitiesRef.current,
        previousRunInterrupted: recovery.previousRunInterrupted,
      });
      /** where the restored layout put the operator, if anywhere */
      let restoredActiveDir: string | null = null;
      if (restored) {
        setProjects(restored.projects);
        restoredActiveDir = restored.activeDir;
        setActiveDir(restoredActiveDir);
        setLastUsedDir(restored.lastUsedDir);
        recents.replace(restored.recentProjects);
        if (restored.pinnedTabId) setPinnedTabId(restored.pinnedTabId);
      }
      // PTY incarnations unknown to the persisted layout (e.g. created or
      // exited since the last save) — or the whole fresh-start case. Exited
      // entries reconstruct an honest stopped tab; dropping them here would
      // make Terminal disagree with the local Fleet/Spatial inventory.
      //
      // Adoption appends and moves nobody. Only a workspace with no restored
      // position needs one, and it lands on the FIRST adopted Session rather
      // than on whichever one happened to be enumerated last.
      for (const s of unclaimed) {
        addSession(s, s.exited ? s.durableSessionId : undefined);
      }
      if (!restoredActiveDir) {
        const [firstAdopted] = unclaimed;
        if (firstAdopted) setActiveDir(firstAdopted.projectDir);
      }
      setReady(true);
      // reconcile durable identity (S5 P3) — async, so a slow/offline registry
      // never delays the terminal: adopt each Project's synced name/color (a
      // rename/recolor made on another machine or a prior run shows here) and
      // link the group to its registry row for future syncs.
      void listProjects()
        .then(registry => {
          if (!hydration.current || registry.length === 0) return;
          // A rename/recolor made during this async window must win over
          // the now-stale registry snapshot: link the row but keep the
          // local edit (it's pushed up below so it still syncs). Otherwise
          // adopt the synced name/color.
          const editedDirs = editedDirsRef.current;
          setProjects(prev => reconcileRegistry(prev, registry, editedDirs));
          // Edits made before the row's id was known couldn't sync (the verbs
          // guard on registryId); now that we have the ids, push them up.
          for (const edit of pendingRegistryEdits(
            stateRef.current.projects,
            registry,
            editedDirs
          )) {
            if (edit.name !== undefined) {
              void registryRenameProject(edit.id, edit.name).catch(() => {});
            }
            if (edit.color !== undefined) {
              void registrySetProjectColor(edit.id, edit.color).catch(() => {});
            }
          }
        })
        .catch(() => {});
    })().catch(async () => {
      // Failed reads are not first launch. Keep every save/checkpoint gated
      // behind readiness until the operator can load the preserved layout.
      const recovery = await ws?.storageRecovery?.().catch(() => undefined);
      if (!hydration.current) return;
      setWorkspaceLoadFailure(recovery ?? { required: false });
    });

    const offExit = api.onExit(
      ({ id, durableSessionId, exitCode, exitSignal }) => {
        if (
          stateRef.current.projects.some(project =>
            project.tabs.some(
              tab =>
                isSessionTab(tab) &&
                tab.durableSessionId === durableSessionId &&
                sessionOperationsRef.current.has(tab.id)
            )
          )
        ) {
          operationExitsRef.current.set(durableSessionId, {
            ...operationExitsRef.current.get(durableSessionId),
            [id]: { exitCode, exitSignal },
          });
        }
        setProjects(prev => markPtyExited(prev, { id, exitCode, exitSignal }));
      }
    );
    const offIdentity = api.onIdentity?.(
      ({ id, durableSessionId, harnessSessionId }) => {
        observedIdentitiesRef.current.set(durableSessionId, harnessSessionId);
        setProjects(prev =>
          adoptObservedIdentity(prev, {
            id,
            durableSessionId,
            harnessSessionId,
          })
        );
      }
    );
    const offContext = api.onContext?.(({ durableSessionId, summary }) => {
      setSummaries(prev => ({ ...prev, [durableSessionId]: summary }));
    });
    const offGoalVisual = api.onGoalVisual?.(({ durableSessionId, visual }) => {
      setGoalVisuals(prev => ({ ...prev, [durableSessionId]: visual }));
    });
    const offRecap = api.onRecap?.(next => {
      const { projects: groups, activeDir: dir } = stateRef.current;
      const active = groups.find(group => group.dir === dir);
      const tab = active?.tabs.find(
        candidate => candidate.id === active.activeTabId
      );
      if (tab && isSessionTab(tab) && tab.sessionId === next.id) {
        setReentryRecap(next);
      }
    });
    const offActivity = api.onActivity?.(({ id, working }) => {
      if (working) quietBeforeSeed.delete(id);
      else quietBeforeSeed.add(id);
      setActivity(prev => {
        if (working) return prev[id] ? prev : { ...prev, [id]: true };
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });
    const offEngaged = api.onEngaged?.(({ id }) => {
      setEngaged(prev => (prev[id] ? prev : { ...prev, [id]: true }));
    });
    // Harness-reported delegation (ENG-023). A Session that finishes its last
    // child drops out of the record entirely, so surfaces read "no delegated
    // work" rather than "zero children" — absent is not the same as none.
    const offDelegation = api.onDelegation?.(({ id, delegation: next }) => {
      if (next) settledBeforeSeed.delete(id);
      else settledBeforeSeed.add(id);
      // Main decides what is worth publishing and sends null otherwise, so
      // the liveness rule lives in exactly one place. Re-deriving it here is
      // what let the switcher and the strip disagree about one Session.
      setDelegation(prev => {
        if (!next) {
          if (!(id in prev)) return prev;
          const cleared = { ...prev };
          delete cleared[id];
          return cleared;
        }
        return { ...prev, [id]: next };
      });
    });
    const offAttention = api.onAttention?.(({ id, attention: att }) => {
      if (att) clearedBeforeSeed.delete(id);
      else clearedBeforeSeed.add(id);
      setAttention(prev => {
        if (att) return { ...prev, [id]: att };
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });
    return () => {
      hydrationRequests.invalidate();
      offExit();
      offIdentity?.();
      offContext?.();
      offGoalVisual?.();
      offRecap?.();
      offActivity?.();
      offEngaged?.();
      offDelegation?.();
      offAttention?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrationAttempt]);

  const serializeWorkspace = useCallback(
    (cleanShutdown = false): PersistedV7 => {
      const layout = stateRef.current;
      return serializeLayout(layout, {
        recentProjects: recents.mergeOpen(layout.projects, Date.now()),
        summaries: summariesRef.current,
        goalVisuals: goalVisualsRef.current,
        cleanShutdown,
        shutdownTargets: shutdownTargetsRef.current,
      });
    },
    [goalVisualsRef, recents, shutdownTargetsRef, summariesRef]
  );

  // ---- persistence: debounced; ended tabs remain as explicit resume targets ----
  // Goal subtitles and their last ready visual persist with the layout so a
  // relaunch restores identity instead of re-deriving it from scrollback.
  useEffect(() => {
    if (!ready) return;
    const ws = window.electron?.workspace;
    if (!ws) return;
    const handle = setTimeout(() => {
      void ws
        .save(serializeWorkspace())
        .catch(error => console.error('Workspace persistence failed', error));
    }, 400);
    return () => clearTimeout(handle);
  }, [
    projects,
    activeDir,
    lastUsedDir,
    pinnedTabId,
    summaries,
    goalVisuals,
    ready,
    serializeWorkspace,
  ]);

  // Route changes can unmount Terminal before the debounce fires (for example,
  // opening an empty Project and immediately pressing Command-3). Flush the
  // latest catalog on unmount so Spatial cannot observe the previous layout.
  useEffect(
    () => () => {
      if (!readyRef.current) return;
      // The shutdown coordinator already owns a clean two-stage checkpoint.
      if (shutdownTargetsRef.current.size > 0) return;
      const ws = window.electron?.workspace;
      if (!ws) return;
      void ws
        .save(serializeWorkspace())
        .catch(error => console.error('Workspace unmount save failed', error));
    },
    [serializeWorkspace, shutdownTargetsRef]
  );

  useEffect(() => {
    if (!ready) return;
    const appApi = window.electron?.app;
    const ws = window.electron?.workspace;
    const ptyApi = window.electron?.pty;
    if (!appApi || !ws || !ptyApi) return;
    void appApi.setWorkspaceCheckpointOwner(true);
    const offCheckpoint = appApi.onCheckpointRequest(({ requestId, stage }) => {
      if (stage === 'pre-stop') {
        shutdownTargetsRef.current = shutdownTargets(stateRef.current.projects);
      }
      const state = serializeWorkspace(stage === 'stopped');
      void ptyApi
        .list()
        .then(live => ws.save(withLiveHarnessIdentities(state, live)))
        .then(() => appApi.completeCheckpoint(requestId, true))
        .catch(() => appApi.completeCheckpoint(requestId, false));
    });
    return () => {
      offCheckpoint();
      void appApi.setWorkspaceCheckpointOwner(false);
    };
  }, [ready, serializeWorkspace, shutdownTargetsRef]);

  // ---- verbs ----
  const launch = useCallback(
    async (opts: LaunchOptions): Promise<boolean> => {
      const api = window.electron?.pty;
      if (!api) {
        setError(
          'Local Agent launch is unavailable. Restart Exawatt and try again.'
        );
        return false;
      }
      const dir = opts.dir.trim();
      if (!dir) {
        setError('Choose a Project directory for this session.');
        return false;
      }
      const launchLabel = opts.harness === 'shell' ? 'shell' : 'Agent';
      // BUG-018: everything below this line waits on a worktree checkout and a
      // cold provider, so it may land minutes after the operator asked. State
      // the position that authorises going to the new Session NOW, while the
      // ask is his. ⌘T launches from the draft tab itself, so that tab is the
      // position; every other path launches from wherever he stands.
      const claim =
        opts.focusClaim ??
        (opts.reuseTabId
          ? operatorPosition.claimTab(
              stateRef.current.projects.find(group =>
                group.tabs.some(tab => tab.id === opts.reuseTabId)
              )?.dir ?? dir,
              opts.reuseTabId
            )
          : operatorPosition.claimHere());
      try {
        let cwd = dir;
        if (opts.worktreeBranch) {
          const wt = await api.createWorktree(dir, opts.worktreeBranch.trim());
          if (!wt.ok) {
            setError(wt.error);
            return false;
          }
          cwd = wt.path;
        }
        const size = sizeRef.current?.() ?? null;
        const tabId = opts.reuseTabId ?? newTabId();
        const restoredEntry = opts.restoreSessionId
          ? (await api.closedSessions()).find(
              entry => entry.durableSessionId === opts.restoreSessionId
            )
          : undefined;
        if (
          restoredEntry &&
          (restoredEntry.harness !== opts.harness ||
            (restoredEntry.harnessSessionId &&
              restoredEntry.harnessSessionId !== opts.resumeSessionId))
        ) {
          setError(
            'The saved Session no longer matches this provider conversation.'
          );
          return false;
        }
        const durableSessionId =
          restoredEntry?.durableSessionId ?? newDurableSessionId();
        const statedTask =
          restoredEntry?.initialTask ?? opts.statedTask?.trim() ?? null;
        const restoredSubtitle =
          restoredEntry?.goal ?? opts.restoredSubtitle?.trim() ?? null;
        const res = await api.create({
          harness: opts.harness,
          cwd,
          title: HARNESS_META[opts.harness].label,
          durableSessionId,
          ...(opts.permissionMode
            ? { permissionMode: opts.permissionMode }
            : {}),
          ...(opts.model?.trim() ? { model: opts.model.trim() } : {}),
          ...(opts.effort?.trim() ? { effort: opts.effort.trim() } : {}),
          ...(opts.initialPrompt?.trim()
            ? { initialPrompt: opts.initialPrompt.trim() }
            : {}),
          ...(opts.resumeSessionId
            ? { resumeSessionId: opts.resumeSessionId }
            : {}),
          ...(statedTask ? { statedTask } : {}),
          ...(restoredSubtitle ? { restoredSubtitle } : {}),
          ...(size ?? {}),
        });
        if (!res.ok) {
          setError(res.error);
          return false;
        }
        const observedIdentity =
          observedIdentitiesRef.current.get(res.session.durableSessionId) ??
          null;
        const launchedSession =
          observedIdentity && !res.session.harnessSessionId
            ? { ...res.session, harnessSessionId: observedIdentity }
            : res.session;
        if (restoredEntry) {
          // Commit the soft-close migration only after the provider process is
          // live. A failed create leaves the recoverable ledger entry intact.
          try {
            await api.reopenSession(restoredEntry.durableSessionId);
          } catch (cause) {
            console.warn(
              'Could not consume migrated Session ledger entry',
              cause
            );
          }
        }
        setError(null);
        setLastUsedDir(dir);
        // Promoting the tab to live ALWAYS happens; going there happens only
        // while the ask is still current. Conflating the two is what let a
        // late launch yank the operator off the Agent he had moved to.
        //
        // Asked BEFORE the tab lands, so the answer is about where the
        // operator stands and never about a position this launch just changed.
        const mayMove = claim.stillCurrent();
        // WHERE the Session landed, which is a Project group and not a path
        // string. Reusing a draft places the tab in the group that already
        // holds it, by tab identity; `launchedSession.projectDir` is MAIN's
        // view of the working directory, and the two are not the same name for
        // the same place. An exact provider resume launches in the directory
        // the provider's own history recorded, which the conversation catalog
        // realpaths — so on macOS a Project opened as `/var/…` comes back as
        // `/private/var/…`. Moving the operator to that string set `activeDir`
        // to a key no Project group has: `activeProject` went null, the ribbon
        // lost its Project, and the next launch verb opened the Project opener
        // instead of a composer, which reads as a verb that silently does
        // nothing (BUG-039). Go to the TAB; ask the layout where it is.
        const landedIn = opts.reuseTabId
          ? (stateRef.current.projects.find(group =>
              group.tabs.some(tab => tab.id === opts.reuseTabId)
            ) ?? null)
          : null;
        const landedDir = landedIn?.dir ?? launchedSession.projectDir;
        if (opts.reuseTabId) {
          // the draft becomes the live tab in place — same id, same spot
          const tab = tabFromPtySession(
            launchedSession,
            tabId,
            opts.roadmapItemId ?? null,
            statedTask || opts.initialPrompt?.trim() || null
          );
          setProjects(prev => replaceTab(prev, tabId, tab));
        } else {
          addSession(
            launchedSession,
            tabId,
            opts.roadmapItemId ?? null,
            statedTask || opts.initialPrompt?.trim() || null
          );
        }
        if (mayMove) moveOperator(landedDir, tabId);
        // Resolution bridge (ENG-015 S5 P3): register/refresh this directory's
        // Project in the durable, synced registry. Best-effort — a registry
        // failure (offline, not signed in) must NEVER stop the operator opening
        // a session, so it runs detached and swallows its own errors.
        //
        // The same landed identity: registering main's realpath would mint a
        // SECOND registry Project for the Project the operator is looking at.
        syncProjectIdentity({
          rootPath: landedDir,
          name: landedIn?.name ?? launchedSession.projectName,
        });
        return true;
      } catch (cause) {
        const detail =
          cause instanceof Error && cause.message ? `: ${cause.message}` : '.';
        setError(`Could not start the ${launchLabel}${detail}`);
        return false;
      }
    },
    [addSession, moveOperator, observedIdentitiesRef, syncProjectIdentity]
  );

  /**
   * Start a new Agent Session from bounded Exawatt-owned context. Clone never
   * supplies resumeSessionId (provider continuity) and never mutates or closes
   * the originating Session.
   *
   * Clone reads preferences, the source registry, and the model catalog before
   * it can spawn anything, so seconds pass with the menu already closed and no
   * new tab yet. The operator reads that gap as "nothing happened" and asks
   * again — and used to get a second billed Agent for it (2026-08-04). One
   * clone per (tab, target) may be in flight; a repeat is dropped, not
   * duplicated.
   */
  const cloneSessionOnce = useCallback(
    async (tabId: string, target: CloneSessionTarget): Promise<boolean> => {
      const project = stateRef.current.projects.find(group =>
        group.tabs.some(tab => tab.id === tabId)
      );
      const found = project?.tabs.find(candidate => candidate.id === tabId);
      // Clone starts a NEW local Agent from locally read current Session context.
      // A coworker's context is its source's, and Exawatt holds no authority
      // to spawn anything there, so the verb simply does not reach one.
      const tab = found && isSessionTab(found) ? found : null;
      const contextSummary = tab
        ? (summariesRef.current[tab.durableSessionId] ?? null)
        : null;
      if (
        !project ||
        !tab ||
        !tabCanClone(tab, {
          engaged: !!(tab.sessionId && engagedRef.current[tab.sessionId]),
          contextSummary,
        })
      ) {
        setError('Only started Agent Sessions can be cloned.');
        return false;
      }

      const focusClaim = operatorPosition.claimTab(project.dir, tabId);
      let currentContext: Awaited<
        ReturnType<
          NonNullable<
            NonNullable<typeof window.electron>['pty']
          >['cloneContext']
        >
      >;
      try {
        currentContext = await window.electron!.pty!.cloneContext(
          tab.durableSessionId
        );
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : 'Current Session context could not be read.'
        );
        return false;
      }
      const [preferenceLoad, registryLoad, modelCatalog] = await Promise.all([
        loadAgentSourcePreferences(),
        loadAgentSourceRegistry('launch', true),
        loadAgentModelCatalog(target.source, project.dir),
      ]);
      // A clone refuses exactly what the main-process gate refuses
      // (`cloneTargetSourceReady`, one verdict for every surface).
      const targetReady = cloneTargetSourceReady(registryLoad.snapshot, target);
      const modelReady =
        target.modelId === modelCatalog.effectiveModel ||
        modelCatalog.models.some(model => model.id === target.modelId);
      if (registryLoad.status !== 'live' || !targetReady || !modelReady) {
        setError(
          registryLoad.error?.message ??
            'That Agent Source is not available for a new Session.'
        );
        return false;
      }

      // The menu's origin remains the owner across asynchronous source reads.
      // Closing or moving it cancels; switching focus cannot redirect a clone.
      const stillHere = stateRef.current.projects
        .find(group => group.dir === project.dir)
        ?.tabs.find(candidate => candidate.id === tabId);
      if (
        !stillHere ||
        !isSessionTab(stillHere) ||
        stillHere.durableSessionId !== tab.durableSessionId ||
        stillHere.cwd !== tab.cwd ||
        stillHere.sessionId !== tab.sessionId
      )
        return false;

      const permissionMode = permissionModeFor(
        preferenceLoad.preferences,
        project.dir,
        target.source,
        preferenceLoad.usedSafeFallback
          ? 'prompt'
          : DEFAULT_AGENT_PERMISSION_MODE
      );
      const cloned = await launch({
        focusClaim,
        harness: target.source,
        dir: tab.cwd,
        permissionMode,
        model: target.modelId,
        effort: target.effort ?? undefined,
        initialPrompt: sessionClonePrompt({
          target: target.source,
          initialTask: tab.initialTask,
          contextSummary,
          currentContext,
        }),
        statedTask: tab.initialTask ?? contextSummary ?? undefined,
        roadmapItemId: tab.roadmapItemId ?? undefined,
      });
      if (cloned) {
        void recordLaunchConfigurationSuccess(project.dir, {
          sourceId: target.sourceId,
          modelId: target.modelId,
          effort: target.effort,
        }).catch(() => undefined);
      }
      return cloned;
    },
    [engagedRef, launch, summariesRef]
  );

  const cloneSession = useCallback(
    async (tabId: string, target: CloneSessionTarget): Promise<boolean> => {
      const inFlightKey = `${tabId}:${target.id}`;
      if (cloningRef.current.has(inFlightKey)) return false;
      cloningRef.current.add(inFlightKey);
      try {
        return await cloneSessionOnce(tabId, target);
      } catch (error) {
        setError(
          error instanceof Error ? error.message : 'Clone could not be started.'
        );
        return false;
      } finally {
        cloningRef.current.delete(inFlightKey);
      }
    },
    [cloneSessionOnce]
  );

  /** ⌘T (D24): a new tab exists the moment you ask for it — a draft tab
   *  in the active (or given) Project whose pane is the composer. One
   *  draft per Project; asking again selects it. Returns null when no
   *  Project is open (caller falls back to the Project chooser). */
  const createDraftTab = useCallback(
    (dirArg?: string, seed: WorkspaceDraftPatch = {}): string | null => {
      const requestedSource =
        seed.draftSource && isAgentSourceId(seed.draftSource)
          ? seed.draftSource
          : undefined;
      const requested: WorkspaceDraftPatch = {
        ...seed,
        ...(requestedSource ? { draftSource: requestedSource } : {}),
      };
      const { projects: gs, activeDir: ad } = stateRef.current;
      const dir = dirArg ?? ad;
      const g = dir ? gs.find(x => x.dir === dir) : undefined;
      if (!g) return null;
      const existing = g.tabs.find(
        t => isSessionTab(t) && t.lifecycle === 'draft'
      );
      if (existing) {
        if (Object.keys(requested).length > 0) {
          setProjects(prev => reseedDraft(prev, g.dir, existing.id, requested));
        }
        moveOperator(g.dir, existing.id);
        return existing.id;
      }
      const seededTab = applyWorkspaceDraftPatch(
        newDraftTab(g.dir, requestedSource ?? null),
        requested
      );
      setProjects(prev => appendTab(prev, g.dir, seededTab));
      moveOperator(g.dir, seededTab.id);
      return seededTab.id;
    },
    [moveOperator]
  );

  /** the composer reports its work-in-progress here (D28): the draft tab
   *  owns the typed task and chosen source, so switching tabs, switching
   *  Projects, or relaunching the app never loses draft work. No-op edits
   *  return the same state so per-keystroke calls stay cheap. */
  const updateDraft = useCallback(
    (tabId: string, patch: WorkspaceDraftPatch) => {
      setProjects(prev => patchDraft(prev, tabId, patch));
    },
    []
  );

  /** remove a tab from the layout (shared by every close path); closing
   *  the active tab activates its right neighbor, like Chrome (D24) */
  const removeTabFromLayout = useCallback((tabId: string) => {
    setPinnedTabId(cur => (cur === tabId ? null : cur));
    setProjects(prev => removeTab(prev, tabId));
  }, []);

  /** Close grammar (D27): ⌘W CLOSES, like Chrome. A started live agent
   *  gets ONE in-app confirm (the caller renders it and re-calls with
   *  force); drafts, unstarted tabs, and stopped tabs close instantly.
   *  The removal is OPTIMISTIC — the tab leaves the strip in a single
   *  transition and the stop/archive runs behind it, so a close never
   *  flickers through stopped/restore states. */
  const closeTab = useCallback(
    (tabId: string, opts: { force?: boolean } = {}): Promise<CloseOutcome> => {
      const operation = (async (): Promise<CloseOutcome> => {
        const { projects: gs } = stateRef.current;
        const g = gs.find(x => x.tabs.some(t => t.id === tabId));
        const tab = g?.tabs.find(t => t.id === tabId);
        if (!g || !tab) return { kind: 'noop' };
        if (isRemoteAgentTab(tab)) {
          // ⌘W on a coworker closes the VIEW (doc: "closing its tab closes
          // the Exawatt view, not the remote worker"). No confirm, because
          // nothing is lost; no stop, no archive, no ledger entry, and not one
          // byte to the source. Its work carries on and Exawatt stops looking.
          removeTabFromLayout(tabId);
          return { kind: 'view-closed', title: tab.title };
        }
        // Everything past here stops or archives a local process, so it needs
        // the PTY bridge; closing a coworker's view never did.
        const api = window.electron?.pty;
        if (!api) return { kind: 'noop' };
        if (
          tab.resumeState === 'resuming' ||
          sessionOperationsRef.current.has(tabId)
        ) {
          return { kind: 'noop' };
        }
        if (tab.lifecycle === 'draft') {
          // ⌘T ⌘W is a friction-free no-op — nothing exists yet
          removeTabFromLayout(tabId);
          // …and the empty-Project composer that takes its place is a NEW
          // draft, not the one just discarded (BUG-041).
          setDraftDiscards(current => current + 1);
          return { kind: 'discarded' };
        }
        const goal = summariesRef.current[tab.durableSessionId] ?? null;
        const live = tabIsLive(tab);
        if (live) {
          const started =
            !!(tab.sessionId && engagedRef.current[tab.sessionId]) || !!goal;
          if (!started) {
            // never given work: gone at once, banner history shed behind
            removeTabFromLayout(tabId);
            void api.closeSession(tab.durableSessionId, true).catch(() => {});
            return { kind: 'discarded' };
          }
          if (!opts.force) {
            const sessionDelegation = tab.sessionId
              ? delegationRef.current[tab.sessionId]
              : undefined;
            return {
              kind: 'needs-confirm',
              // The same derivation the tab's own light uses. Asking the
              // activity map directly called a mid-tool-call Agent idle for
              // the three seconds it took to think (BUG-008).
              turn: sessionGlyphState({
                working: !!(
                  tab.sessionId && activityRef.current[tab.sessionId]
                ),
                agent: tab.harness !== 'shell',
                started,
                delegatedBusy: sessionDelegationBusy(sessionDelegation),
                blocked: sessionReportedBlocked(sessionDelegation),
                ownTurn: sessionDelegation?.ownTurn,
              }),
            };
          }
        }
        // one clean transition, then stop + archive behind the strip
        removeTabFromLayout(tabId);
        // Recovery availability follows the same optimistic boundary as the
        // disappearing tab. Main remains authoritative for the durable count;
        // this pending overlay covers immediate ⌘W → ⌘⇧T.
        const settlePendingClose = beginPendingClose();
        const entryData = {
          durableSessionId: tab.durableSessionId,
          title: tab.title,
          titleKind: tab.titleKind,
          goal,
          harness: tab.harness,
          cwd: tab.cwd,
          projectDir: g.dir,
          projectName: g.name,
          harnessSessionId: tab.harnessSessionId,
          initialTask: tab.initialTask,
        };
        try {
          if (live) await api.closeSession(tab.durableSessionId);
          const entry = await api.archiveSession(entryData);
          return { kind: 'closed', entry };
        } catch {
          setError(
            `Could not archive ${tab.title}. Its conversation is still recoverable from its source.`
          );
          return { kind: 'noop' };
        } finally {
          settlePendingClose();
        }
      })();
      closeInFlightRef.current.add(operation);
      void operation.then(
        () => closeInFlightRef.current.delete(operation),
        () => closeInFlightRef.current.delete(operation)
      );
      return operation;
    },
    [
      activityRef,
      beginPendingClose,
      delegationRef,
      engagedRef,
      removeTabFromLayout,
      summariesRef,
    ]
  );

  /** resurrect a soft-closed Session whole: tab, goal, provider identity,
   *  retained history — the ledger's other half (D23) */
  const reopenClosedSession = useCallback(
    async (durableSessionId: string, reuseTabId?: string): Promise<boolean> => {
      const api = window.electron?.pty;
      if (!api?.reopenSession) return false;
      // The ledger read is a main-process round trip; ⌘⇧T must not land on
      // whichever tab the operator moved to while it was in flight.
      const claim = reuseTabId
        ? operatorPosition.claimTab(
            stateRef.current.projects.find(group =>
              group.tabs.some(tab => tab.id === reuseTabId)
            )?.dir ?? '',
            reuseTabId
          )
        : operatorPosition.claimHere();
      const entry = await api.reopenSession(durableSessionId);
      if (!entry) return false;
      const tab = tabFromClosedEntry(entry, reuseTabId ?? newTabId());
      if (entry.goal) {
        setSummaries(prev => ({
          ...prev,
          [entry.durableSessionId]: entry.goal as string,
        }));
      }
      const mayMove = claim.stillCurrent();
      setProjects(prev =>
        placeTab(
          prev,
          { dir: entry.projectDir, name: entry.projectName },
          tab,
          reuseTabId
        )
      );
      if (mayMove) moveOperator(entry.projectDir, tab.id);
      return true;
    },
    [moveOperator, setSummaries]
  );

  const listClosedSessions = useCallback(
    async (): Promise<ClosedSessionEntry[]> =>
      (await window.electron?.pty?.closedSessions?.()) ?? [],
    []
  );

  /** Browser-style reopen (D39): each request runs after any earlier request
   * and after all close operations already in flight, then takes the ledger's
   * newest entry. Reopen restores a stopped tab; it never starts a process. */
  const reopenLastClosedSession = useCallback((): boolean => {
    const api = window.electron?.pty;
    if (!readyRef.current || !api?.closedSessions || !api.reopenSession) {
      return false;
    }
    const run = reopenLastClosedQueueRef.current.then(async () => {
      const closing = [...closeInFlightRef.current];
      if (closing.length > 0) await Promise.allSettled(closing);
      const [latest] = await listClosedSessions();
      if (!latest) return;
      const reopened = await reopenClosedSession(latest.durableSessionId);
      if (!reopened) {
        setError(`Could not reopen ${latest.title}.`);
      }
    });
    reopenLastClosedQueueRef.current = run.catch(() => {
      setError('Could not reopen the last closed tab.');
    });
    return true;
  }, [listClosedSessions, reopenClosedSession]);

  /** A replacement belongs to the retained Session, never to whichever tab
   * happens to be selected when the process responds. Close wins over adoption. */
  const adoptSessionRuntime = useCallback(
    async (tab: SessionTab, session: PtySessionRecord): Promise<boolean> => {
      const retained = stateRef.current.projects
        .flatMap(project => project.tabs)
        .find(candidate => candidate.id === tab.id);
      if (
        !retained ||
        !isSessionTab(retained) ||
        retained.durableSessionId !== tab.durableSessionId
      ) {
        await window.electron?.pty?.closeSession(session.durableSessionId);
        return false;
      }
      const observedExit = operationExitsRef.current.get(
        tab.durableSessionId
      )?.[session.id];
      updateTab(tab.id, runtimeAdoptionPatch(tab, session, observedExit));
      return true;
    },
    [operationExitsRef, updateTab]
  );

  const resumeTab = useCallback(
    async (tabId: string, selectedHarnessId?: string): Promise<boolean> => {
      const api = window.electron?.pty;
      if (!api) return false;
      const found = stateRef.current.projects
        .flatMap(project => project.tabs)
        .find(candidate => candidate.id === tabId);
      const tab = found && isSessionTab(found) ? found : null;
      if (
        !tab ||
        tabIsLive(tab) ||
        tab.resumeState === 'resuming' ||
        sessionOperationsRef.current.has(tabId)
      )
        return false;
      const exactId = selectedHarnessId ?? tab.harnessSessionId;
      if (tab.harness !== 'shell' && !exactId) {
        setError(
          `Choose the exact ${HARNESS_META[tab.harness].label} conversation.`
        );
        return false;
      }
      // Admission precedes every await, including preference loading.
      sessionOperationsRef.current.add(tabId);
      updateTab(tabId, {
        resumeState: 'resuming',
        lifecycle: 'resuming',
        exitCode: null,
        exitSignal: null,
      });
      try {
        const projectDir =
          stateRef.current.projects.find(project =>
            project.tabs.some(candidate => candidate.id === tabId)
          )?.dir ?? tab.cwd;
        const preferenceLoad =
          tab.harness === 'shell' ? null : await loadAgentSourcePreferences();
        const permissionMode =
          tab.harness === 'shell'
            ? undefined
            : permissionModeFor(
                preferenceLoad!.preferences,
                projectDir,
                tab.harness,
                preferenceLoad!.usedSafeFallback
                  ? 'prompt'
                  : DEFAULT_AGENT_PERMISSION_MODE
              );
        // A close while preferences were loading must not launch anything.
        if (
          !stateRef.current.projects.some(project =>
            project.tabs.some(
              candidate =>
                candidate.id === tabId &&
                isSessionTab(candidate) &&
                candidate.durableSessionId === tab.durableSessionId
            )
          )
        )
          return false;
        const restoredSubtitle =
          summariesRef.current[tab.durableSessionId] ?? undefined;
        const result = await api.create({
          harness: tab.harness,
          cwd: tab.cwd,
          title: tab.title,
          durableSessionId: tab.durableSessionId,
          ...(permissionMode ? { permissionMode } : {}),
          ...(exactId ? { resumeSessionId: exactId } : {}),
          ...(tab.launchModel ? { model: tab.launchModel } : {}),
          ...(tab.launchEffort ? { effort: tab.launchEffort } : {}),
          ...(tab.initialTask ? { statedTask: tab.initialTask } : {}),
          ...(restoredSubtitle ? { restoredSubtitle } : {}),
          ...(sizeRef.current?.() ?? {}),
        });
        if (!result.ok) throw new Error(result.error);
        const adopted = await adoptSessionRuntime(
          { ...tab, harnessSessionId: exactId ?? null },
          result.session
        );
        if (adopted) setError(null);
        return adopted;
      } catch (cause) {
        updateTab(tabId, {
          resumeState: 'failed',
          lifecycle: 'failed',
          exitCode: REVIVE_FAILED,
        });
        const detail =
          cause instanceof Error && cause.message ? `: ${cause.message}` : '.';
        setError(`Could not resume ${tab.title}${detail}`);
        return false;
      } finally {
        sessionOperationsRef.current.delete(tabId);
        operationExitsRef.current.delete(tab.durableSessionId);
      }
    },
    [adoptSessionRuntime, operationExitsRef, summariesRef, updateTab]
  );

  const changeSessionModel = useCallback(
    async (tabId: string, choice: SessionModelChange) => {
      const api = window.electron?.pty;
      const tab = stateRef.current.projects
        .flatMap(project => project.tabs)
        .find(item => item.id === tabId);
      if (!api || !tab || !isSessionTab(tab) || !tab.sessionId)
        throw new Error('Session is no longer running.');
      if (sessionOperationsRef.current.has(tabId))
        throw new Error('A Session operation is already in progress.');
      sessionOperationsRef.current.add(tabId);
      try {
        const result = await api.changeModel(tab.sessionId, choice);
        if (!result.ok) throw new Error(result.error);
        await adoptSessionRuntime(tab, result.session);
      } finally {
        sessionOperationsRef.current.delete(tabId);
        operationExitsRef.current.delete(tab.durableSessionId);
      }
    },
    [adoptSessionRuntime, operationExitsRef]
  );

  const pauseProject = useCallback(
    async (projectDir: string, confirmedSessionIds?: string[]) => {
      const tabs =
        stateRef.current.projects.find(project => project.dir === projectDir)
          ?.tabs ?? [];
      const targets = tabs
        .filter(isSessionTab)
        .filter(
          tab =>
            tab.harness !== 'shell' &&
            (confirmedSessionIds
              ? confirmedSessionIds.includes(tab.durableSessionId)
              : !!tab.sessionId)
        );
      const sessionIds = targets.map(tab => tab.durableSessionId);
      const api = window.electron?.pty;
      if (!api?.pauseSessions) throw new Error('Project pause is unavailable.');
      if (targets.some(tab => sessionOperationsRef.current.has(tab.id)))
        throw new Error('A Session operation is already in progress.');
      targets.forEach(tab => sessionOperationsRef.current.add(tab.id));
      try {
        const result = await api.pauseSessions(
          sessionIds,
          confirmedSessionIds !== undefined
        );
        if (result.kind === 'completed') {
          for (const item of result.results) {
            if (item.status !== 'paused' && item.status !== 'already-paused')
              continue;
            const tab = targets.find(
              target => target.durableSessionId === item.durableSessionId
            );
            if (tab)
              updateTab(tab.id, {
                sessionId: null,
                lifecycle: 'stopped-clean',
                exitCode: null,
                exitSignal: null,
              });
          }
        }
        return { ...result, sessionIds };
      } finally {
        targets.forEach(tab => {
          sessionOperationsRef.current.delete(tab.id);
          operationExitsRef.current.delete(tab.durableSessionId);
        });
      }
    },
    [operationExitsRef, updateTab]
  );

  const resumeTabs = useCallback(
    async (tabs: WorkspaceTab[]) => {
      const eligible = tabs.filter(tabCanResumeAsAgent);
      if (eligible.length === 0) return;
      setResumeBatchProgress({ completed: 0, total: eligible.length });
      let resumed = 0;
      try {
        for (const [index, tab] of eligible.entries()) {
          if (await resumeTab(tab.id)) resumed += 1;
          setResumeBatchProgress({
            completed: index + 1,
            total: eligible.length,
          });
        }
      } finally {
        setResumeBatchProgress(null);
      }
      const failed = eligible.length - resumed;
      if (failed > 0) {
        setError(
          `${resumed} ${resumed === 1 ? 'agent' : 'agents'} resumed; ${failed} ${failed === 1 ? 'agent needs' : 'agents need'} review.`
        );
      }
    },
    [resumeTab]
  );

  const resumeAll = useCallback(() => {
    void resumeTabs(stateRef.current.projects.flatMap(project => project.tabs));
  }, [resumeTabs]);

  const resumeProject = useCallback(
    (projectDir: string) => {
      void resumeTabs(
        resumableAgentTabsInProject(stateRef.current.projects, projectDir)
      );
    },
    [resumeTabs]
  );

  /** launch in the active project's directory (fallback: last used) —
   *  the one dir-resolution path for ⌘T, palette commands, and buttons */
  const launchHere = useCallback(
    (harness: PtyHarness): boolean => {
      const { projects: gs, activeDir: ad, lastUsedDir: lu } = stateRef.current;
      const activeProject = gs.find(group => group.dir === ad);
      const dir = activeProject ? projectRootPath(activeProject) : lu || null;
      if (!dir) {
        setError('Choose a Project directory for this session.');
        return false;
      }
      void launch({ harness, dir });
      return true;
    },
    [launch]
  );

  /** Open a Project independently of Sessions. Main-process resolution keeps
   *  git worktrees grouped under the same durable Project identity. */
  const openProject = useCallback(
    async (dir: string): Promise<boolean> => {
      const claim = operatorPosition.claimHere();
      const result = await window.electron?.projects?.resolve(dir);
      if (!result) return false;
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      const canonicalDir = result.projectDir;
      const mayMove = claim.stillCurrent();
      setProjects(prev =>
        openProjectGroup(prev, {
          dir: canonicalDir,
          name: result.projectName,
        })
      );
      // The Project is registered either way; going to it needs the ask to
      // still be his (the resolve is a main-process round trip).
      if (mayMove) moveOperator(canonicalDir, null);
      setLastUsedDir(canonicalDir);
      setError(null);
      syncProjectIdentity({
        rootPath: canonicalDir,
        name: result.projectName,
      });
      return true;
    },
    [moveOperator, syncProjectIdentity]
  );

  /**
   * Open a connected coworker's conversation (ENG-033 H2).
   *
   * The same gesture as opening a local Session, and the same result: a tab in
   * the strip, selected. Asking twice returns to the tab that already exists
   * rather than opening a second view of one coworker.
   *
   * Opening reaches nothing. No Gateway call, no command, no state change on
   * the source: the tab is a view, and the surface it renders is what reads
   * the conversation.
   *
   * A caller that awaited anything before asking (a roster read, most often)
   * passes the claim it took BEFORE that await (BUG-192). Without one, the
   * claim is taken here, which is only right for a synchronous gesture.
   */
  const openRemoteAgent = useCallback(
    (
      ref: RemoteAgentOpenRef,
      focusClaim?: OperatorMoveClaim
    ): Promise<string> => {
      const inFlight = remoteAgentOpenInFlightRef.current.find(
        entry => entry.agentId === ref.agentId
      );
      if (inFlight) return inFlight.task;
      const claim = focusClaim ?? operatorPosition.claimHere();
      const task = (async () => {
        const registryProject = await listProjects()
          .then(
            rows => rows.find(project => project.id === ref.projectId) ?? null
          )
          .catch(() => null);
        const currentProject = stateRef.current.projects.find(
          project =>
            project.registryId === ref.projectId ||
            project.dir === ref.projectId ||
            (registryProject?.root_path !== null &&
              registryProject?.root_path !== undefined &&
              projectRootPath(project) === registryProject.root_path)
        );
        const dir =
          currentProject?.dir ??
          registryProject?.root_path ??
          remoteAgentGroupDir(ref);
        const existing = stateRef.current.projects
          .flatMap(project =>
            project.tabs.map(tab => ({ dir: project.dir, tab }))
          )
          .find(
            entry =>
              isRemoteAgentTab(entry.tab) && entry.tab.agentId === ref.agentId
          );
        if (existing) {
          // The source owns the names; a rename there shows here on next open.
          setProjects(prev => renameRemoteAgentViews(prev, ref));
          if (claim.stillCurrent()) moveOperator(existing.dir, existing.tab.id);
          return existing.tab.id;
        }
        const tab: RemoteAgentTab = {
          kind: 'remote-agent',
          id: newTabId(),
          title: ref.displayName,
          sourceId: ref.sourceId,
          nativeAgentId: ref.nativeAgentId,
          agentId: ref.agentId,
          projectLabel: ref.projectLabel,
        };
        // The Project this Agent was mapped to at Connect time may not be
        // open. It is still where the coworker belongs, so the group opens
        // with the mapping's own label rather than the coworker landing in
        // whichever Project the operator happens to be standing in.
        setProjects(prev =>
          placeTab(
            prev,
            {
              dir,
              rootPath: registryProject?.root_path ?? null,
              registryId: registryProject?.id ?? ref.projectId,
              name: ref.projectLabel || ref.displayName,
            },
            tab
          )
        );
        if (claim.stillCurrent()) moveOperator(dir, tab.id);
        return tab.id;
      })();
      const transaction = { agentId: ref.agentId, task };
      remoteAgentOpenInFlightRef.current.push(transaction);
      const release = () => {
        remoteAgentOpenInFlightRef.current =
          remoteAgentOpenInFlightRef.current.filter(
            entry => entry !== transaction
          );
      };
      task.then(
        () => release(),
        () => release()
      );
      return task;
    },
    [moveOperator]
  );

  /** Open a durable Context Group whose local folder binding is absent. */
  const openContextProject = useCallback(
    (ref: { id: string; name: string; color: string | null }): void => {
      setProjects(prev => openContextGroup(prev, ref));
      moveOperator(ref.id, null);
    },
    [moveOperator]
  );

  /** Curated import adds inert Projects in one state transition. Every path is
   *  resolved again at the trust boundary even when it came from our scanner. */
  const importProjects = useCallback(
    async (directories: string[]): Promise<boolean> => {
      const unique = [...new Set(directories)];
      if (unique.length === 0) return false;
      const claim = operatorPosition.claimHere();
      const resolved = await Promise.all(
        unique.map(directory => window.electron?.projects?.resolve(directory))
      );
      const failedIndex = resolved.findIndex(result => !result || !result.ok);
      if (failedIndex >= 0) {
        const failed = resolved[failedIndex];
        setError(
          failed && 'error' in failed
            ? failed.error
            : 'Project discovery is unavailable in this app build.'
        );
        return false;
      }
      const refs = resolved.filter(
        (result): result is Extract<NonNullable<typeof result>, { ok: true }> =>
          !!result && result.ok
      );
      if (refs.length === 0) return false;
      const mayMove = claim.stillCurrent();
      setProjects(prev =>
        openProjectGroups(
          prev,
          refs.map(ref => ({ dir: ref.projectDir, name: ref.projectName }))
        )
      );
      const first = refs[0];
      if (mayMove) moveOperator(first.projectDir, null);
      setLastUsedDir(first.projectDir);
      setError(null);
      for (const ref of refs) {
        syncProjectIdentity({
          rootPath: ref.projectDir,
          name: ref.projectName,
        });
      }
      return true;
    },
    [moveOperator, syncProjectIdentity]
  );

  /**
   * Remove an EMPTY Project from the open workspace without deleting its
   * durable registry/library identity. Callers own any Agent close flow first;
   * this guard prevents a Project close from orphaning a live PTY off-screen.
   */
  const closeProject = useCallback(
    (dir: string): boolean => {
      const { projects: groups, activeDir: currentDir } = stateRef.current;
      const index = groups.findIndex(project => project.dir === dir);
      const project = groups[index];
      if (!project || project.tabs.length > 0) return false;

      // A just-opened Project may not have reached the debounced layout save.
      // Seed recency synchronously so ⌘N can always bring a closed group back.
      recents.recordClosed(project, Date.now());

      setProjects(previous => closeEmptyProjectGroup(previous, dir));
      if (currentDir === dir) {
        setActiveDir(groups[index + 1]?.dir ?? groups[index - 1]?.dir ?? null);
      }
      return true;
    },
    [recents]
  );

  const selectProject = useCallback(
    (index: number): boolean => {
      const g = stateRef.current.projects[index];
      if (!g) return false;
      moveOperator(g.dir, null);
      return true;
    },
    [moveOperator]
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
    [moveOperator]
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
  }, []);

  /** pin/unpin a SPECIFIC tab in the split (D27 context menu); the ⌘D
   *  toggle for the active tab remains togglePin */
  const togglePinTab = useCallback((tabId: string) => {
    setPinnedTabId(cur => (cur === tabId ? null : tabId));
  }, []);

  /** back/forward tab application (D27): select only if it still exists */
  const selectExistingTab = useCallback(
    (dir: string, tabId: string) => {
      const { projects: gs } = stateRef.current;
      const g = gs.find(x => x.dir === dir);
      if (!g || !g.tabs.some(t => t.id === tabId)) return;
      moveOperator(dir, tabId);
    },
    [moveOperator]
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
    [moveOperator]
  );

  /** ⌘1–⌘9: jump straight to the Nth tab of the global ring (D18 — the
   *  highest-frequency switch gets the cheapest chord, browser-style). */
  // ── Arrangement (D20): order is an interface once ⌘digit ordinals
  // exist. Tabs arrange within their Project; Projects arrange globally.
  // Order persists with the layout; Project order also pushes best-effort
  // to the registry's sort_order so it syncs across machines.
  const syncProjectOrder = useCallback((ordered: Project[]) => {
    const ids = ordered
      .map(project => project.registryId)
      .filter((id): id is string => !!id);
    if (ids.length > 1) void registryReorderProjects(ids).catch(() => {});
  }, []);

  const applyProjectOrder = useCallback(
    (next: Project[] | null): boolean => {
      if (!next) return false;
      setProjects(next);
      syncProjectOrder(next);
      return true;
    },
    [syncProjectOrder]
  );

  /** ⌘⌥[/⌘⌥]: nudge the ACTIVE tab one slot within its Project */
  const moveActiveTab = useCallback((delta: 1 | -1): boolean => {
    const { projects: gs, activeDir: ad } = stateRef.current;
    const active = gs.find(g => g.dir === ad);
    if (!active?.activeTabId) return false;
    const next = moveTabWithinProject(gs, active.activeTabId, delta);
    if (!next) return false;
    setProjects(next);
    return true;
  }, []);

  /** ⌘⌥⇧[/⌘⌥⇧]: nudge the ACTIVE Project one slot in the strip */
  const moveActiveProject = useCallback(
    (delta: 1 | -1): boolean => {
      const { projects: gs, activeDir: ad } = stateRef.current;
      if (!ad) return false;
      return applyProjectOrder(moveProjectInList(gs, ad, delta));
    },
    [applyProjectOrder]
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
    []
  );

  /** drag-and-drop: drop a Project group beside another */
  const reorderProject = useCallback(
    (dir: string, targetDir: string, place: 'before' | 'after'): boolean =>
      applyProjectOrder(
        placeProjectBeside(stateRef.current.projects, dir, targetDir, place)
      ),
    [applyProjectOrder]
  );

  const selectTabByOrdinal = useCallback(
    (index: number): boolean => {
      const target = tabAtOrdinal(stateRef.current.projects, index);
      if (!target) return false;
      moveOperator(target.dir, target.tab.id);
      return true;
    },
    [moveOperator]
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

  const setProjectColor = useCallback((dir: string, color: string) => {
    editedDirsRef.current.add(dir);
    setProjects(prev => prev.map(g => (g.dir === dir ? { ...g, color } : g)));
    // sync to the durable registry so the recolor persists + syncs (best-effort)
    const g = stateRef.current.projects.find(p => p.dir === dir);
    if (g?.registryId) {
      void registrySetProjectColor(g.registryId, color).catch(() => {});
    }
  }, []);

  const renameProject = useCallback((dir: string, name: string) => {
    const next = name.trim();
    if (!next) return;
    editedDirsRef.current.add(dir);
    setProjects(prev =>
      prev.map(g => (g.dir === dir ? { ...g, name: next } : g))
    );
    // sync to the durable registry so the rename persists + syncs (best-effort)
    const g = stateRef.current.projects.find(p => p.dir === dir);
    if (g?.registryId) {
      void registryRenameProject(g.registryId, next).catch(() => {});
    }
  }, []);

  const activeTab =
    activeProject?.tabs.find(t => t.id === activeProject.activeTabId) ?? null;

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
  }, [activateSession, selectExistingTab, launchHere, openProject, togglePin]);

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

  // ---- attention focus contract (S1): tell main which session the operator
  // is looking at — the focused session never flags, and focusing clears.
  // The local record clears optimistically; main confirms via pty:attention.
  const activeSessionId =
    activeTab && isSessionTab(activeTab) ? activeTab.sessionId : null;
  useEffect(() => {
    setReentryRecap(current =>
      current?.id === activeSessionId ? current : null
    );
  }, [activeSessionId]);

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
