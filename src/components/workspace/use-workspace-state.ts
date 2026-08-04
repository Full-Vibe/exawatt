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
  useRef,
  useState,
} from 'react';
import { HARNESS_META, isDefaultHarnessTitle } from './harnesses';
import { pickDistinctColor, projectColor } from './project-colors';
import {
  moveProjectInList,
  moveTabWithinProject,
  nextActiveTabAfterClose,
  nextTabInRing,
  placeProjectBeside,
  placeTabBeside,
  tabAtOrdinal,
} from './tab-ring';
import { nextPin, tabIsPinnable } from './split-layout';
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
import { loadTerminalFont } from './terminal-font';
import { useClosedSessionCount } from './use-closed-session-count';
import {
  DEFAULT_AGENT_PERMISSION_MODE,
  isAgentSourceId,
  launchSourceSnapshots,
  loadAgentSourcePreferences,
  loadAgentSourceRegistry,
  permissionModeFor,
  type AgentSourceId,
} from './agent-sources';
import { sessionClonePrompt, tabCanClone } from './session-clone';
import {
  openRepositoryProject,
  listProjects,
  renameProject as registryRenameProject,
  reorderProjects as registryReorderProjects,
  setProjectColor as registrySetProjectColor,
} from '@/lib/projects/registry';
import type {
  AgentPermissionMode,
  PtyAttention,
  SessionDelegation,
  PtyHarness,
  PtyReentryRecap,
  PtySessionInfo,
  ClosedSessionEntry,
  GoalVisual,
} from '@/types/electron';

export interface WorkspaceTab {
  /** stable across revives (sessionId changes when a tab is re-launchd) */
  id: string;
  /** stable logical Session identity, distinct from tab/PTY/provider IDs */
  durableSessionId: string;
  harness: PtyHarness;
  title: string;
  /** Ownership of the strip title. Provider/catalog labels never become
   * tab titles: only an explicit operator rename earns visible title copy. */
  titleKind: TabTitleKind;
  cwd: string;
  sessionId: string | null;
  harnessSessionId: string | null;
  resumeState: ResumeState;
  lifecycle: SessionLifecycle;
  /** null = running; number = exit code; REVIVE_FAILED = revive error */
  exitCode: number | null;
  /** roadmap item declared at launch (ENG-017 S4) — a machine-local view
   *  annotation per decision 0010; overrides link inference, never synced */
  roadmapItemId: string | null;
  /** the composer's goal statement (D21): persists with the layout and
   *  re-anchors the context summarizer when the Session resumes */
  initialTask: string | null;
  /** PTY incarnation start time; present while live for roadmap elapsed time. */
  startedAt?: number | null;
  /** draft tabs only (D24): the source the summon requested (palette
   *  "Start Agent with X"); null = use the recommendation */
  draftSource?: AgentSourceId | null;
  /** draft tabs only (D28): the composer's typed task — the draft's
   *  work-in-progress belongs to the TAB, so it survives the pane
   *  unmounting on tab/Project switches and (with content) restarts */
  draftTask?: string | null;
  /** draft tabs only: the source model resolved or explicitly selected for
   * this launch. It travels with the draft, never mutates harness config. */
  draftModel?: string | null;
  /** draft tabs only: the reasoning effort paired with the selected model. */
  draftEffort?: string | null;
  /** True only after an operator changes the composer. Background catalog
   * hydration must not make an untouched new-tab page durable. */
  draftTouched?: boolean;
  /** Draft launch options travel with the tab just like task/model choices. */
  draftWorktree?: boolean;
  draftBranch?: string | null;
  draftRoadmapItemId?: string | null;
}

export interface WorkspaceDraftPatch {
  draftTask?: string;
  draftSource?: AgentSourceId;
  draftModel?: string | null;
  draftEffort?: string | null;
  draftTouched?: boolean;
  draftWorktree?: boolean;
  draftBranch?: string | null;
  draftRoadmapItemId?: string | null;
}

export function applyWorkspaceDraftPatch(
  tab: WorkspaceTab,
  patch: WorkspaceDraftPatch
): WorkspaceTab {
  const sourceChanged =
    patch.draftSource !== undefined &&
    patch.draftSource !== (tab.draftSource ?? null);
  return {
    ...tab,
    draftTask:
      patch.draftTask === undefined ? (tab.draftTask ?? null) : patch.draftTask,
    draftSource:
      patch.draftSource === undefined
        ? (tab.draftSource ?? null)
        : patch.draftSource,
    draftModel:
      patch.draftModel === undefined
        ? sourceChanged
          ? null
          : (tab.draftModel ?? null)
        : patch.draftModel,
    draftEffort:
      patch.draftEffort === undefined
        ? sourceChanged
          ? null
          : (tab.draftEffort ?? null)
        : patch.draftEffort,
    draftTouched:
      patch.draftTouched === undefined
        ? (tab.draftTouched ?? false)
        : patch.draftTouched,
    draftWorktree:
      patch.draftWorktree === undefined
        ? (tab.draftWorktree ?? false)
        : patch.draftWorktree,
    draftBranch:
      patch.draftBranch === undefined
        ? (tab.draftBranch ?? null)
        : patch.draftBranch,
    draftRoadmapItemId:
      patch.draftRoadmapItemId === undefined
        ? (tab.draftRoadmapItemId ?? null)
        : patch.draftRoadmapItemId,
  };
}

export type TabTitleKind = 'default' | 'operator';

export type SessionLifecycle =
  | 'running'
  | 'stopped-clean'
  | 'interrupted'
  | 'exited'
  | 'resuming'
  | 'failed'
  /** ⌘T new-tab page (D24): a real strip tab whose pane is the composer;
   *  no process yet, discarded by ⌘W without ceremony. Typed draft work
   *  rides on the tab and persists with the layout (D28); an EMPTY draft
   *  still vanishes with the run. */
  | 'draft';

export type ResumeState =
  | 'live'
  | 'ended-resumable'
  | 'identity-missing'
  | 'resuming'
  | 'resumed'
  | 'failed';

export interface ResumeBatchProgress {
  completed: number;
  total: number;
}

/** what a close attempt did (D27) — the UI narrates each differently */
export type CloseOutcome =
  | { kind: 'noop' }
  /** a started live agent needs the in-app confirm; re-call with force */
  | { kind: 'needs-confirm'; working: boolean }
  | { kind: 'discarded' }
  | { kind: 'closed'; entry: ClosedSessionEntry };

export function tabIsLive(tab: WorkspaceTab): boolean {
  return tab.resumeState === 'live' || tab.resumeState === 'resumed';
}

export function tabCanResumeAsAgent(tab: WorkspaceTab): boolean {
  return (
    !tabIsLive(tab) &&
    tab.resumeState !== 'resuming' &&
    tab.harness !== 'shell' &&
    !!tab.harnessSessionId
  );
}

/** Re-adopt a main-process PTY without overstating its lifecycle. This also
 * reconstructs a stopped tab when persistence lagged behind process exit. */
export function tabFromPtySession(
  session: PtySessionInfo,
  id: string,
  roadmapItemId: string | null = null,
  initialTask: string | null = null
): WorkspaceTab {
  return {
    id,
    durableSessionId: session.durableSessionId,
    harness: session.harness,
    title: session.title,
    titleKind: isDefaultHarnessTitle(session.harness, session.title)
      ? 'default'
      : 'operator',
    cwd: session.cwd,
    sessionId: session.exited ? null : session.id,
    harnessSessionId: session.harnessSessionId,
    resumeState: session.exited
      ? session.harnessSessionId
        ? 'ended-resumable'
        : 'identity-missing'
      : 'live',
    lifecycle: session.exited ? 'exited' : 'running',
    exitCode: session.exited ? (session.exitCode ?? 0) : null,
    roadmapItemId,
    initialTask,
    startedAt: session.startedAt,
  };
}

export interface Project {
  /** projectDir — the identity/grouping key */
  dir: string;
  name: string;
  /** distinct per-project hue (least-used at creation; operator can pick) */
  color: string;
  /** the synced registry row id (S5 P3): links this group to Supabase for
   *  name/color sync. Derived from the registry on load / launch, not persisted. */
  registryId?: string | null;
  tabs: WorkspaceTab[];
  activeTabId: string | null;
}

export function resumableAgentTabsInProject(
  projects: Project[],
  projectDir: string
): WorkspaceTab[] {
  return (
    projects
      .find(project => project.dir === projectDir)
      ?.tabs.filter(tabCanResumeAsAgent) ?? []
  );
}

/** Current persisted layout (v6). v6 makes tab-title ownership explicit. */
export interface PersistedV6 {
  v: 6;
  lastUsedDir: string;
  activeDir: string | null;
  /** split view (S2): tab pinned beside the active one; optional (pre-S2
   *  layouts lack it) */
  pinnedTabId?: string | null;
  /** durable recency record (ENG-016 D8): a Project whose tabs all closed
   *  stays reachable from ⌘K even offline or signed out; most recent first,
   *  capped. Optional — pre-D8 layouts lack it. */
  recentProjects?: Array<{
    dir: string;
    name: string;
    color?: string;
    lastOpenedAt: number;
  }>;
  projects: Array<{
    dir: string;
    name: string;
    color?: string;
    activeTabId: string | null;
    /** Written by pre-D45 builds; read by nothing now that the ribbon has
     *  exactly three presentations. Kept in the shape so existing layouts
     *  stay valid without a migration. */
    ribbonExpanded?: boolean;
    tabs: Array<{
      id: string;
      durableSessionId: string;
      harness: PtyHarness;
      title: string;
      titleKind: TabTitleKind;
      cwd: string;
      sessionId: string | null;
      harnessSessionId: string | null;
      roadmapItemId: string | null;
      lifecycle: SessionLifecycle;
      exitCode: number | null;
      /** goal statement + last goal subtitle (D21) — optional: pre-D21
       *  layouts lack them; both restore the context layer on relaunch */
      initialTask?: string | null;
      startedAt?: number | null;
      contextSummary?: string | null;
      /** Last accepted visual survives restart; transitional states do not. */
      goalVisual?: GoalVisual | null;
      /** Draft new-tab composer state: any operator-authored launch choice
       * persists; an untouched ⌘T tile still vanishes without ceremony. */
      draftTask?: string | null;
      draftSource?: string | null;
      draftModel?: string | null;
      draftEffort?: string | null;
      draftTouched?: boolean;
      draftWorktree?: boolean;
      draftBranch?: string | null;
      draftRoadmapItemId?: string | null;
    }>;
  }>;
}

/** v5 layout on disk: v6 before tab-title ownership was explicit. */
type PersistedV5 = Omit<PersistedV6, 'v' | 'projects'> & {
  v: 5;
  projects: Array<
    Omit<PersistedV6['projects'][number], 'tabs'> & {
      tabs: Array<
        Omit<PersistedV6['projects'][number]['tabs'][number], 'titleKind'>
      >;
    }
  >;
};

/** v4 layout on disk: v5 minus durable identity and lifecycle. */
type PersistedV4 = Omit<PersistedV5, 'v' | 'projects'> & {
  v: 4;
  projects: Array<
    Omit<PersistedV5['projects'][number], 'tabs'> & {
      tabs: Array<
        Omit<
          PersistedV5['projects'][number]['tabs'][number],
          'durableSessionId' | 'lifecycle' | 'exitCode'
        >
      >;
    }
  >;
};

/** v3 layout on disk: v4 minus the per-tab declared roadmap link. */
type PersistedV3 = Omit<PersistedV4, 'v' | 'projects'> & {
  v: 3;
  projects: Array<
    Omit<PersistedV4['projects'][number], 'tabs'> & {
      tabs: Array<
        Omit<PersistedV4['projects'][number]['tabs'][number], 'roadmapItemId'>
      >;
    }
  >;
};

type PersistedV2 = Omit<PersistedV3, 'v' | 'projects'> & {
  v: 2;
  projects: Array<
    Omit<PersistedV3['projects'][number], 'tabs'> & {
      tabs: Array<
        Omit<
          PersistedV3['projects'][number]['tabs'][number],
          'harnessSessionId'
        >
      >;
    }
  >;
};

/** v1 layout on disk: identical v2 shape under the old `initiatives` key. */
type PersistedV1 = Omit<PersistedV2, 'v' | 'projects'> & {
  v: 1;
  initiatives: PersistedV2['projects'];
};

export const REVIVE_FAILED = -999;

let tabCounter = 0;
function newTabId(): string {
  return `tab-${Date.now().toString(36)}-${++tabCounter}`;
}

function newDurableSessionId(): string {
  return `session-${crypto.randomUUID()}`;
}

const LEGACY_CATALOG_TITLE_MAX_CHARS = 72;

/** D31 briefly leaked a bounded catalog fallback (the first operator prompt)
 * into a tab title. This shape is deliberately narrow: repair the known
 * migration artifact once without guessing away ordinary operator renames. */
function isLegacyCatalogTitleLeak(candidate: {
  harness: PtyHarness;
  title: string;
  harnessSessionId: string | null;
  initialTask?: string | null;
  semanticSummary?: string | null;
  draft?: boolean;
}): boolean {
  return (
    candidate.harness !== 'shell' &&
    !candidate.draft &&
    typeof candidate.harnessSessionId === 'string' &&
    typeof candidate.initialTask === 'string' &&
    !!candidate.initialTask.trim() &&
    typeof candidate.semanticSummary === 'string' &&
    !!candidate.semanticSummary.trim() &&
    candidate.title.trim().length <= LEGACY_CATALOG_TITLE_MAX_CHARS &&
    candidate.title.trim().endsWith('…') &&
    candidate.title.trim().split(/\s+/).length > 6
  );
}

function upgradeV5TabTitle(
  tab: PersistedV5['projects'][number]['tabs'][number]
): Pick<
  PersistedV6['projects'][number]['tabs'][number],
  'title' | 'titleKind'
> {
  const isDraft = tab.lifecycle === 'draft';
  if (
    isDraft ||
    isDefaultHarnessTitle(tab.harness, tab.title) ||
    isLegacyCatalogTitleLeak({
      ...tab,
      semanticSummary: tab.contextSummary,
      draft: isDraft,
    })
  ) {
    return {
      title: isDraft ? tab.title : HARNESS_META[tab.harness].label,
      titleKind: 'default',
    };
  }
  return { title: tab.title, titleKind: 'operator' };
}

/** Read the persisted layout, upgrading older shapes in place: v1 (key
 *  `initiatives`) → v2 (key `projects`) → v3 (exact provider IDs) → v4
 *  (declared roadmap links) → v5 (durable lifecycle) → v6 (title ownership). */
export function parsePersisted(raw: unknown): PersistedV6 | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as { v?: number; projects?: unknown; initiatives?: unknown };
  const toV5 = (p: PersistedV4): PersistedV5 => ({
    ...p,
    v: 5,
    projects: p.projects.map(project => ({
      ...project,
      tabs: project.tabs.map(tab => ({
        ...tab,
        durableSessionId: tab.id,
        lifecycle: 'stopped-clean' as const,
        exitCode: null,
      })),
    })),
  });
  const toV6 = (p: PersistedV5): PersistedV6 => ({
    ...p,
    v: 6,
    projects: p.projects.map(project => ({
      ...project,
      tabs: project.tabs.map(tab => ({
        ...tab,
        ...upgradeV5TabTitle(tab),
      })),
    })),
  });
  const normalizeV6 = (parsed: PersistedV6): PersistedV6 => {
    const seen = new Set<string>();
    return {
      ...parsed,
      projects: parsed.projects.map(project => ({
        ...project,
        tabs: project.tabs.map(tab => {
          let durableSessionId = tab.durableSessionId || tab.id;
          if (seen.has(durableSessionId))
            durableSessionId = `${tab.id}-session`;
          seen.add(durableSessionId);
          const lifecycle: SessionLifecycle = [
            'running',
            'stopped-clean',
            'interrupted',
            'exited',
            'resuming',
            'failed',
            'draft',
          ].includes(tab.lifecycle)
            ? tab.lifecycle
            : 'stopped-clean';
          return {
            ...tab,
            durableSessionId,
            titleKind:
              tab.titleKind === 'default' || tab.titleKind === 'operator'
                ? tab.titleKind
                : isDefaultHarnessTitle(tab.harness, tab.title)
                  ? 'default'
                  : 'operator',
            lifecycle,
            exitCode: tab.exitCode ?? null,
          };
        }),
      })),
    };
  };
  if (d.v === 6 && Array.isArray(d.projects)) {
    return normalizeV6(raw as PersistedV6);
  }
  if (d.v === 5 && Array.isArray(d.projects))
    return normalizeV6(toV6(raw as PersistedV5));
  if (d.v === 4 && Array.isArray(d.projects))
    return normalizeV6(toV6(toV5(raw as PersistedV4)));
  const toV4 = (p: Omit<PersistedV3, 'v'>): PersistedV4 => ({
    ...p,
    v: 4 as const,
    projects: p.projects.map(project => ({
      ...project,
      tabs: project.tabs.map(tab => ({ ...tab, roadmapItemId: null })),
    })),
  });
  if (d.v === 3 && Array.isArray(d.projects)) {
    const { v: _v, ...rest } = raw as PersistedV3;
    return normalizeV6(toV6(toV5(toV4(rest))));
  }
  const upgrade = (
    projects: PersistedV2['projects'],
    rest: Omit<PersistedV2, 'v' | 'projects'>
  ) =>
    normalizeV6(
      toV6(
        toV5(
          toV4({
            ...rest,
            projects: projects.map(project => ({
              ...project,
              tabs: project.tabs.map(tab => ({
                ...tab,
                harnessSessionId: null,
              })),
            })),
          })
        )
      )
    );
  if (d.v === 2 && Array.isArray(d.projects)) {
    const { projects, v: _v, ...rest } = raw as PersistedV2;
    return upgrade(projects, rest);
  }
  if (d.v === 1 && Array.isArray(d.initiatives)) {
    const { initiatives, v: _v, ...rest } = raw as PersistedV1;
    return upgrade(initiatives, rest);
  }
  return null;
}

export interface LaunchOptions {
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
  const [error, setError] = useState<string | null>(null);
  const [resumeBatchProgress, setResumeBatchProgress] =
    useState<ResumeBatchProgress | null>(null);
  const [ready, setReady] = useState(false);
  /** goal subtitles keyed by durableSessionId (D21): the goal is durable
   *  Session truth — live updates stream from main, the persisted layout
   *  seeds them back after a restart, stopped tabs keep theirs */
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  /** Goal visuals share the same durable-Session identity and source seam. */
  const [goalVisuals, setGoalVisuals] = useState<Record<string, GoalVisual>>(
    {}
  );
  /** needs-operator flags keyed by sessionId (ENG-015 S1; main is truth) */
  const [attention, setAttention] = useState<Record<string, PtyAttention>>({});
  /** sessions actively producing output right now, keyed by sessionId
   *  (D18: running vs waiting must read at a glance; main is truth) */
  const [activity, setActivity] = useState<Record<string, boolean>>({});
  /** sessions ever given work, keyed by sessionId (D22: started vs
   *  unstarted must read at a glance; main is truth — task/resume at
   *  create, first human keystroke, or raised attention) */
  const [engaged, setEngaged] = useState<Record<string, boolean>>({});
  /** harness-reported delegated work, keyed by sessionId (ENG-023). Only
   *  Sessions with children outstanding appear; a missing key means "no
   *  delegated work reported", which covers both a Session with none and a
   *  source that cannot report it. */
  const [delegation, setDelegation] = useState<
    Record<string, SessionDelegation>
  >({});
  /** quiet, one-shot S4 catch-up for the session currently being revisited */
  const [reentryRecap, setReentryRecap] = useState<PtyReentryRecap | null>(
    null
  );
  const dismissReentryRecap = useCallback(() => setReentryRecap(null), []);
  const stateRef = useRef({ projects, activeDir, lastUsedDir, pinnedTabId });
  stateRef.current = { projects, activeDir, lastUsedDir, pinnedTabId };
  // dirs whose identity the operator edited locally — the reconcile-on-load
  // must not clobber a rename/recolor made while the registry fetch was still
  // in flight (its snapshot is already stale), and instead pushes it up.
  const editedDirsRef = useRef<Set<string>>(new Set());
  /** durable Project recency (ENG-016 D8) — loaded from the persisted layout,
   *  re-merged on every save so closed Projects survive */
  const recentsRef = useRef<NonNullable<PersistedV6['recentProjects']>>([]);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const summariesRef = useRef(summaries);
  summariesRef.current = summaries;
  const goalVisualsRef = useRef(goalVisuals);
  goalVisualsRef.current = goalVisuals;
  const engagedRef = useRef(engaged);
  engagedRef.current = engaged;
  const activityRef = useRef(activity);
  activityRef.current = activity;
  const resumeInFlightRef = useRef<Set<string>>(new Set());
  /** Close/archive work is tracked so browser-style reopen cannot race the
   * optimistic strip removal and read the ledger before the entry lands. */
  const closeInFlightRef = useRef<Set<Promise<CloseOutcome>>>(new Set());
  /** Repeated ⌘⇧T requests are a FIFO queue over a LIFO ledger: each request
   * waits for the previous take, then restores the next-newest entry. */
  const reopenLastClosedQueueRef = useRef<Promise<void>>(Promise.resolve());
  const shutdownTargetsRef = useRef<Set<string>>(new Set());
  /** Identity can arrive before React has committed a newly launched/restored
   * tab. Retain that event by durable Session id instead of dropping it. */
  const observedIdentitiesRef = useRef<Map<string, string>>(new Map());
  const { closedSessionCount, beginPendingClose } =
    useClosedSessionCount(ready);

  const syncProjectIdentity = useCallback(
    (ref: { rootPath: string; name: string }) => {
      void openRepositoryProject(ref)
        .then(proj => {
          setProjects(prev =>
            prev.map(group =>
              group.dir === proj.root_path
                ? {
                    ...group,
                    registryId: proj.id,
                    name: proj.name || group.name,
                    color: proj.color || group.color,
                  }
                : group
            )
          );
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

  /** append a PTY incarnation as a live or stopped tab in its Project */
  const addSession = useCallback(
    (
      s: PtySessionInfo,
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
      setProjects(prev => {
        const i = prev.findIndex(g => g.dir === s.projectDir);
        if (i === -1) {
          return [
            ...prev,
            {
              dir: s.projectDir,
              name: s.projectName,
              color: pickDistinctColor(prev.map(g => g.color)),
              tabs: [tab],
              activeTabId: tab.id,
            },
          ];
        }
        const next = [...prev];
        next[i] = {
          ...next[i],
          tabs: [...next[i].tabs, tab],
          activeTabId: tab.id,
        };
        return next;
      });
      setActiveDir(s.projectDir);
      return tab.id;
    },
    []
  );

  const updateTab = useCallback(
    (tabId: string, patch: Partial<WorkspaceTab>) => {
      setProjects(prev =>
        prev.map(g =>
          g.tabs.some(t => t.id === tabId)
            ? {
                ...g,
                tabs: g.tabs.map(t =>
                  t.id === tabId ? { ...t, ...patch } : t
                ),
              }
            : g
        )
      );
    },
    []
  );

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
  useEffect(() => {
    const api = window.electron?.pty;
    const ws = window.electron?.workspace;
    if (!api) return;
    let cancelled = false;
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
      const [live, persistedRaw, recovery] = await Promise.all([
        api.list(),
        ws?.load() ?? Promise.resolve(null),
        ws?.recovery() ?? Promise.resolve({ previousRunInterrupted: false }),
        loadTerminalFont(),
      ]);
      if (cancelled) return;
      const persisted = parsePersisted(persistedRaw);
      if (persisted && api.reconcileResumeIdentities) {
        const agentTabs = persisted.projects.flatMap(project =>
          project.tabs.flatMap(tab =>
            tab.harness === 'shell' || tab.lifecycle === 'draft'
              ? []
              : [
                  {
                    durableSessionId: tab.durableSessionId,
                    harness: tab.harness,
                    cwd: tab.cwd,
                    initialTask: tab.initialTask ?? null,
                    harnessSessionId: tab.harnessSessionId,
                  },
                ]
          )
        );
        if (agentTabs.some(tab => !tab.harnessSessionId)) {
          try {
            const reconciled = await api.reconcileResumeIdentities(agentTabs);
            if (cancelled) return;
            const byDurableId = new Map(
              reconciled.map(identity => [
                identity.durableSessionId,
                identity.harnessSessionId,
              ])
            );
            for (const project of persisted.projects) {
              for (const tab of project.tabs) {
                tab.harnessSessionId =
                  byDurableId.get(tab.durableSessionId) ?? tab.harnessSessionId;
              }
            }
          } catch (cause) {
            console.warn('Session identity reconciliation failed', cause);
          }
        }
      }
      const liveByDurableId = new Map(live.map(s => [s.durableSessionId, s]));
      // goal subtitles (D21): the persisted layout restores each Session's
      // goal first; live truth from main overrides it, all by durable id.
      // Attention, activity, and started flags adopt from live main truth
      // (D22/D29), so renderer reloads cannot regress any status surface.
      const seeded: Record<string, string> = {};
      const seededGoalVisuals: Record<string, GoalVisual> = {};
      const seededAttention: Record<string, PtyAttention> = {};
      const seededActivity: Record<string, boolean> = {};
      const seededEngaged: Record<string, boolean> = {};
      const seededDelegation: Record<string, SessionDelegation> = {};
      if (persisted) {
        const persistedSummaries = persisted.projects.flatMap(g =>
          g.tabs.flatMap(t =>
            t.contextSummary
              ? [[t.durableSessionId, t.contextSummary] as const]
              : []
          )
        );
        const restoreContext = api.restoreContext;
        const restoredSummaries = restoreContext
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
        if (cancelled) return;
        for (const [durableSessionId, summary] of restoredSummaries) {
          if (summary) seeded[durableSessionId] = summary;
        }
        const persistedGoalVisuals = persisted.projects.flatMap(g =>
          g.tabs.flatMap(t =>
            t.goalVisual ? [[t.durableSessionId, t.goalVisual] as const] : []
          )
        );
        const restoreGoalVisual = api.restoreGoalVisual;
        const restoredGoalVisuals = restoreGoalVisual
          ? await Promise.all(
              persistedGoalVisuals.map(
                async ([durableSessionId, visual]) =>
                  [
                    durableSessionId,
                    await restoreGoalVisual(durableSessionId, visual),
                  ] as const
              )
            )
          : persistedGoalVisuals;
        if (cancelled) return;
        for (const [durableSessionId, visual] of restoredGoalVisuals) {
          if (visual) seededGoalVisuals[durableSessionId] = visual;
        }
      }
      for (const s of live) {
        if (s.contextSummary) seeded[s.durableSessionId] = s.contextSummary;
        if (s.goalVisual) seededGoalVisuals[s.durableSessionId] = s.goalVisual;
        if (s.attention && !clearedBeforeSeed.has(s.id)) {
          seededAttention[s.id] = s.attention;
        }
        if (s.working && !quietBeforeSeed.has(s.id)) {
          seededActivity[s.id] = true;
        }
        if (s.engaged) seededEngaged[s.id] = true;
        // Reload and late-attach adopt live delegation immediately (ENG-023);
        // otherwise the dots would wait for the next child to start or stop.
        // Already filtered by main; a settled Session simply carries none.
        if (s.delegation && !settledBeforeSeed.has(s.id)) {
          seededDelegation[s.id] = s.delegation;
        }
      }
      if (Object.keys(seeded).length > 0) {
        setSummaries(prev => ({ ...seeded, ...prev }));
      }
      if (Object.keys(seededGoalVisuals).length > 0) {
        setGoalVisuals(prev => ({ ...seededGoalVisuals, ...prev }));
      }
      if (Object.keys(seededAttention).length > 0) {
        setAttention(prev => ({ ...seededAttention, ...prev }));
      }
      if (Object.keys(seededActivity).length > 0) {
        setActivity(prev => ({ ...seededActivity, ...prev }));
      }
      if (Object.keys(seededEngaged).length > 0) {
        setEngaged(prev => ({ ...seededEngaged, ...prev }));
      }
      if (Object.keys(seededDelegation).length > 0) {
        setDelegation(prev => ({ ...seededDelegation, ...prev }));
      }
      if (persisted) {
        const assigned: Array<string | undefined> = persisted.projects.map(
          g => g.color
        );
        const restored: Project[] = persisted.projects.map((g, gi) => ({
          dir: g.dir,
          name: g.name,
          color:
            g.color ??
            (assigned[gi] = pickDistinctColor(assigned)) ??
            projectColor(g.dir),
          // belt-and-suspenders vs older/hand-edited files: an activeTabId
          // that matches no tab would blank the pane area
          activeTabId: g.tabs.some(t => t.id === g.activeTabId)
            ? g.activeTabId
            : (g.tabs[0]?.id ?? null),
          tabs: g.tabs.map(raw => {
            // the persisted draft fields stay OFF non-draft tabs (and the
            // untyped draftSource string never reaches WorkspaceTab)
            const {
              draftTask,
              draftSource,
              draftModel,
              draftEffort,
              draftTouched,
              draftWorktree,
              draftBranch,
              draftRoadmapItemId,
              ...t
            } = raw;
            // a persisted draft (D28) restores as a draft: no process, no
            // resume identity — just the composer with the saved work
            if (t.lifecycle === 'draft') {
              return {
                ...t,
                initialTask: t.initialTask ?? null,
                sessionId: null,
                exitCode: null,
                lifecycle: 'draft' as const,
                resumeState: 'identity-missing' as const,
                draftTask: draftTask ?? null,
                draftSource: isAgentSourceId(draftSource ?? '')
                  ? (draftSource as AgentSourceId)
                  : null,
                draftModel:
                  typeof draftModel === 'string' &&
                  draftModel.length <= 512 &&
                  !/[\s\u0000-\u001f\u007f]/.test(draftModel)
                    ? draftModel
                    : null,
                draftEffort:
                  typeof draftEffort === 'string' &&
                  draftEffort.length <= 32 &&
                  /^[a-z][a-z0-9_-]*$/.test(draftEffort)
                    ? draftEffort
                    : null,
                draftTouched: draftTouched === true,
                draftWorktree: draftWorktree === true,
                draftBranch:
                  typeof draftBranch === 'string' &&
                  draftBranch.length <= 512 &&
                  !/[\u0000-\u001f\u007f]/.test(draftBranch)
                    ? draftBranch
                    : null,
                draftRoadmapItemId:
                  typeof draftRoadmapItemId === 'string' &&
                  draftRoadmapItemId.length <= 256 &&
                  !/[\u0000-\u001f\u007f]/.test(draftRoadmapItemId)
                    ? draftRoadmapItemId
                    : null,
              };
            }
            const s = liveByDurableId.get(t.durableSessionId);
            const initialTask = t.initialTask ?? null;
            const observedIdentity =
              observedIdentitiesRef.current.get(t.durableSessionId) ?? null;
            if (s && !s.exited) {
              liveByDurableId.delete(s.durableSessionId);
              return {
                ...t,
                initialTask,
                startedAt: s.startedAt,
                sessionId: s.id,
                harnessSessionId:
                  s.harnessSessionId ?? observedIdentity ?? t.harnessSessionId,
                resumeState: 'live' as const,
                lifecycle: 'running' as const,
                exitCode: s.exited ? (s.exitCode ?? 0) : null,
              };
            }
            if (s?.exited) {
              liveByDurableId.delete(s.durableSessionId);
              return {
                ...t,
                initialTask,
                startedAt: s.startedAt,
                sessionId: null,
                harnessSessionId:
                  s.harnessSessionId ?? observedIdentity ?? t.harnessSessionId,
                resumeState:
                  s.harnessSessionId || observedIdentity || t.harnessSessionId
                    ? ('ended-resumable' as const)
                    : ('identity-missing' as const),
                lifecycle: 'exited' as const,
                exitCode: s.exitCode ?? t.exitCode,
              };
            }
            // App restart: process is gone. Restore history and identity, but
            // never spawn until the operator explicitly resumes.
            return {
              ...t,
              initialTask,
              harnessSessionId: observedIdentity ?? t.harnessSessionId,
              sessionId: null,
              exitCode: t.exitCode,
              lifecycle:
                recovery.previousRunInterrupted &&
                (t.lifecycle === 'running' || t.lifecycle === 'resuming')
                  ? ('interrupted' as const)
                  : t.lifecycle === 'running' || t.lifecycle === 'resuming'
                    ? ('stopped-clean' as const)
                    : t.lifecycle,
              resumeState:
                observedIdentity || t.harnessSessionId
                  ? ('ended-resumable' as const)
                  : ('identity-missing' as const),
            };
          }),
        }));
        setProjects(restored);
        setActiveDir(persisted.activeDir ?? restored[0]?.dir ?? null);
        setLastUsedDir(persisted.lastUsedDir ?? '');
        // tolerate a corrupt/hand-edited recentProjects: a bad shape here
        // must not break every later debounced save or the shutdown
        // checkpoint (which calls recentsRef.current.filter)
        recentsRef.current = Array.isArray(persisted.recentProjects)
          ? persisted.recentProjects.filter(
              (r): r is (typeof persisted.recentProjects)[number] =>
                !!r && typeof r === 'object' && typeof r.dir === 'string'
            )
          : [];
        // restore the split only if the pinned tab still exists
        const pinned = persisted.pinnedTabId ?? null;
        if (pinned && restored.some(g => g.tabs.some(t => t.id === pinned))) {
          setPinnedTabId(pinned);
        }
      }
      // PTY incarnations unknown to the persisted layout (e.g. created or
      // exited since the last save) — or the whole fresh-start case. Exited
      // entries reconstruct an honest stopped tab; dropping them here would
      // make Terminal disagree with the local Fleet/Spatial inventory.
      for (const s of liveByDurableId.values()) {
        addSession(s, s.exited ? s.durableSessionId : undefined);
      }
      setReady(true);
      // reconcile durable identity (S5 P3) — async, so a slow/offline registry
      // never delays the terminal: adopt each Project's synced name/color (a
      // rename/recolor made on another machine or a prior run shows here) and
      // link the group to its registry row for future syncs.
      void listProjects()
        .then(registry => {
          if (cancelled || registry.length === 0) return;
          const byPath = new Map(registry.map(p => [p.root_path, p]));
          setProjects(prev =>
            prev.map(g => {
              const r = byPath.get(g.dir);
              if (!r) return g;
              // A rename/recolor made during this async window must win over
              // the now-stale registry snapshot: link the row but keep the
              // local edit (it's pushed up below so it still syncs). Otherwise
              // adopt the synced name/color.
              return editedDirsRef.current.has(g.dir)
                ? { ...g, registryId: r.id }
                : {
                    ...g,
                    registryId: r.id,
                    name: r.name || g.name,
                    color: r.color || g.color,
                  };
            })
          );
          // Edits made before the row's id was known couldn't sync (the verbs
          // guard on registryId); now that we have the ids, push them up.
          for (const g of stateRef.current.projects) {
            const r = byPath.get(g.dir);
            if (!r || !editedDirsRef.current.has(g.dir)) continue;
            if (g.name && g.name !== r.name) {
              void registryRenameProject(r.id, g.name).catch(() => {});
            }
            if (g.color && g.color !== r.color) {
              void registrySetProjectColor(r.id, g.color).catch(() => {});
            }
          }
        })
        .catch(() => {});
    })();

    const offExit = api.onExit(({ id, durableSessionId, exitCode }) => {
      setProjects(prev =>
        prev.map(g => ({
          ...g,
          tabs: g.tabs.map(t =>
            t.sessionId === id || t.durableSessionId === durableSessionId
              ? {
                  ...t,
                  sessionId: null,
                  exitCode,
                  resumeState: t.harnessSessionId
                    ? 'ended-resumable'
                    : 'identity-missing',
                  lifecycle: 'exited',
                }
              : t
          ),
        }))
      );
    });
    const offIdentity = api.onIdentity?.(
      ({ id, durableSessionId, harnessSessionId }) => {
        observedIdentitiesRef.current.set(durableSessionId, harnessSessionId);
        setProjects(prev =>
          prev.map(g => ({
            ...g,
            tabs: g.tabs.map(t =>
              t.sessionId === id || t.durableSessionId === durableSessionId
                ? {
                    ...t,
                    harnessSessionId,
                    resumeState: t.sessionId
                      ? t.resumeState
                      : 'ended-resumable',
                  }
                : t
            ),
          }))
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
      if (tab?.sessionId === next.id) setReentryRecap(next);
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
      cancelled = true;
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
  }, []);

  const serializeWorkspace = useCallback(
    (cleanShutdown = false): PersistedV6 => {
      const {
        projects: gs,
        activeDir: ad,
        lastUsedDir: lu,
        pinnedTabId: pin,
      } = stateRef.current;
      // the pin follows the tab (D26): it persists with a stopped tab and
      // reattaches to retained history on relaunch (drafts never persist)
      const pinSurvives =
        pin !== null &&
        gs.some(g => g.tabs.some(t => t.id === pin && tabIsPinnable(t)));
      const now = Date.now();
      const recents = [
        ...gs.map(g => ({
          dir: g.dir,
          name: g.name,
          ...(g.color ? { color: g.color } : {}),
          lastOpenedAt: now,
        })),
        ...recentsRef.current.filter(r => !gs.some(g => g.dir === r.dir)),
      ].slice(0, 12);
      recentsRef.current = recents;
      return {
        v: 6,
        lastUsedDir: lu,
        activeDir: ad,
        pinnedTabId: pinSurvives ? pin : null,
        recentProjects: recents,
        projects: gs.map(g => {
          // An untouched draft is pre-session UI and vanishes with the run.
          // Any explicit composer choice is operator work, even when its task
          // is blank, and persists with the rest of the launch intent.
          const tabs = g.tabs
            .filter(
              tab =>
                tab.lifecycle !== 'draft' ||
                tab.draftTouched === true ||
                !!tab.draftTask?.trim()
            )
            .map(tab => {
              const stopped =
                cleanShutdown &&
                (shutdownTargetsRef.current.has(tab.durableSessionId) ||
                  tabIsLive(tab) ||
                  tab.lifecycle === 'resuming');
              return {
                id: tab.id,
                durableSessionId: tab.durableSessionId,
                harness: tab.harness,
                title: tab.title,
                titleKind: tab.titleKind,
                cwd: tab.cwd,
                sessionId: stopped ? null : tab.sessionId,
                harnessSessionId: tab.harnessSessionId,
                roadmapItemId: tab.roadmapItemId,
                lifecycle: stopped ? ('stopped-clean' as const) : tab.lifecycle,
                exitCode: tab.exitCode,
                initialTask: tab.initialTask ?? null,
                startedAt: tab.startedAt ?? null,
                contextSummary:
                  summariesRef.current[tab.durableSessionId] ?? null,
                goalVisual:
                  goalVisualsRef.current[tab.durableSessionId]?.state ===
                  'ready'
                    ? goalVisualsRef.current[tab.durableSessionId]
                    : null,
                ...(tab.lifecycle === 'draft'
                  ? {
                      draftTask: tab.draftTask ?? null,
                      draftSource: tab.draftSource ?? null,
                      draftModel: tab.draftModel ?? null,
                      draftEffort: tab.draftEffort ?? null,
                      draftTouched: tab.draftTouched ?? false,
                      draftWorktree: tab.draftWorktree ?? false,
                      draftBranch: tab.draftBranch ?? null,
                      draftRoadmapItemId: tab.draftRoadmapItemId ?? null,
                    }
                  : {}),
              };
            });
          return {
            dir: g.dir,
            name: g.name,
            color: g.color,
            activeTabId: tabs.some(t => t.id === g.activeTabId)
              ? g.activeTabId
              : (tabs[0]?.id ?? null),
            tabs,
          };
        }),
      };
    },
    []
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
    [serializeWorkspace]
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
        shutdownTargetsRef.current = new Set(
          stateRef.current.projects.flatMap(project =>
            project.tabs
              .filter(tab => tabIsLive(tab) || tab.lifecycle === 'resuming')
              .map(tab => tab.durableSessionId)
          )
        );
      }
      const state = serializeWorkspace(stage === 'stopped');
      void ptyApi
        .list()
        .then(live => {
          const byDurable = new Map(
            live.map(session => [session.durableSessionId, session])
          );
          for (const project of state.projects) {
            for (const tab of project.tabs) {
              const session = byDurable.get(tab.durableSessionId);
              if (session?.harnessSessionId) {
                tab.harnessSessionId = session.harnessSessionId;
              }
            }
          }
          return ws.save(state);
        })
        .then(() => appApi.completeCheckpoint(requestId, true))
        .catch(() => appApi.completeCheckpoint(requestId, false));
    });
    return () => {
      offCheckpoint();
      void appApi.setWorkspaceCheckpointOwner(false);
    };
  }, [ready, serializeWorkspace]);

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
        setError(
          'Project directory is required — pick where this session lives.'
        );
        return false;
      }
      const launchLabel = opts.harness === 'shell' ? 'shell' : 'Agent';
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
        if (opts.reuseTabId) {
          // the draft becomes the live tab in place — same id, same spot
          const tab = tabFromPtySession(
            launchedSession,
            tabId,
            opts.roadmapItemId ?? null,
            statedTask || opts.initialPrompt?.trim() || null
          );
          setProjects(prev =>
            prev.map(grp =>
              grp.tabs.some(t => t.id === tabId)
                ? {
                    ...grp,
                    tabs: grp.tabs.map(t => (t.id === tabId ? tab : t)),
                    activeTabId: tab.id,
                  }
                : grp
            )
          );
          setActiveDir(launchedSession.projectDir);
        } else {
          addSession(
            launchedSession,
            tabId,
            opts.roadmapItemId ?? null,
            statedTask || opts.initialPrompt?.trim() || null
          );
        }
        // Resolution bridge (ENG-015 S5 P3): register/refresh this directory's
        // Project in the durable, synced registry. Best-effort — a registry
        // failure (offline, not signed in) must NEVER stop the operator opening
        // a session, so it runs detached and swallows its own errors.
        syncProjectIdentity({
          rootPath: launchedSession.projectDir,
          name: launchedSession.projectName,
        });
        return true;
      } catch (cause) {
        const detail =
          cause instanceof Error && cause.message ? `: ${cause.message}` : '.';
        setError(`Could not start the ${launchLabel}${detail}`);
        return false;
      }
    },
    [addSession, syncProjectIdentity]
  );

  /**
   * Start a new Agent Session from bounded Exawatt-owned context. Clone never
   * supplies resumeSessionId (provider continuity) and never mutates or closes
   * the originating Session.
   */
  const cloneSession = useCallback(
    async (tabId: string, target: AgentSourceId): Promise<boolean> => {
      const project = stateRef.current.projects.find(group =>
        group.tabs.some(tab => tab.id === tabId)
      );
      const tab = project?.tabs.find(candidate => candidate.id === tabId);
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

      const [preferenceLoad, registryLoad] = await Promise.all([
        loadAgentSourcePreferences(),
        loadAgentSourceRegistry('launch', true),
      ]);
      const targetReady = launchSourceSnapshots(registryLoad.snapshot).some(
        source => source.harness === target && source.launchable
      );
      if (registryLoad.status !== 'live' || !targetReady) {
        setError(
          registryLoad.error?.message ??
            'That Agent Source is not available for a new Session.'
        );
        return false;
      }

      const permissionMode = permissionModeFor(
        preferenceLoad.preferences,
        project.dir,
        target,
        preferenceLoad.usedSafeFallback
          ? 'prompt'
          : DEFAULT_AGENT_PERMISSION_MODE
      );
      return launch({
        harness: target,
        dir: tab.cwd,
        permissionMode,
        initialPrompt: sessionClonePrompt({
          target,
          initialTask: tab.initialTask,
          contextSummary,
        }),
        statedTask: tab.initialTask ?? contextSummary ?? undefined,
        roadmapItemId: tab.roadmapItemId ?? undefined,
      });
    },
    [launch]
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
      const existing = g.tabs.find(t => t.lifecycle === 'draft');
      if (existing) {
        setProjects(prev =>
          prev.map(grp =>
            grp.dir === g.dir
              ? {
                  ...grp,
                  activeTabId: existing.id,
                  tabs:
                    Object.keys(requested).length > 0
                      ? grp.tabs.map(t =>
                          t.id === existing.id
                            ? applyWorkspaceDraftPatch(t, requested)
                            : t
                        )
                      : grp.tabs,
                }
              : grp
          )
        );
        setActiveDir(g.dir);
        return existing.id;
      }
      const tab: WorkspaceTab = {
        id: newTabId(),
        durableSessionId: newDurableSessionId(),
        harness: 'claude',
        title: 'New agent',
        titleKind: 'default',
        cwd: g.dir,
        sessionId: null,
        harnessSessionId: null,
        resumeState: 'identity-missing',
        lifecycle: 'draft',
        exitCode: null,
        roadmapItemId: null,
        initialTask: null,
        draftSource: requestedSource ?? null,
        draftTask: null,
        draftModel: null,
        draftEffort: null,
        draftTouched: false,
        draftWorktree: false,
        draftBranch: null,
        draftRoadmapItemId: null,
      };
      const seededTab = applyWorkspaceDraftPatch(tab, requested);
      setProjects(prev =>
        prev.map(grp =>
          grp.dir === g.dir
            ? {
                ...grp,
                tabs: [...grp.tabs, seededTab],
                activeTabId: seededTab.id,
              }
            : grp
        )
      );
      setActiveDir(g.dir);
      return seededTab.id;
    },
    []
  );

  /** the composer reports its work-in-progress here (D28): the draft tab
   *  owns the typed task and chosen source, so switching tabs, switching
   *  Projects, or relaunching the app never loses draft work. No-op edits
   *  return the same state so per-keystroke calls stay cheap. */
  const updateDraft = useCallback(
    (tabId: string, patch: WorkspaceDraftPatch) => {
      setProjects(prev => {
        const group = prev.find(g => g.tabs.some(t => t.id === tabId));
        const tab = group?.tabs.find(t => t.id === tabId);
        if (!group || !tab || tab.lifecycle !== 'draft') return prev;
        const nextTab = applyWorkspaceDraftPatch(tab, patch);
        if (
          Object.keys(patch).every(key => {
            const field = key as keyof WorkspaceDraftPatch;
            return nextTab[field] === tab[field];
          })
        )
          return prev;
        return prev.map(g =>
          g === group
            ? {
                ...g,
                tabs: g.tabs.map(t => (t.id === tabId ? nextTab : t)),
              }
            : g
        );
      });
    },
    []
  );

  /** remove a tab from the layout (shared by every close path); closing
   *  the active tab activates its right neighbor, like Chrome (D24) */
  const removeTabFromLayout = useCallback((tabId: string) => {
    setPinnedTabId(cur => (cur === tabId ? null : cur));
    setProjects(prev =>
      prev.map(grp => {
        if (!grp.tabs.some(t => t.id === tabId)) return grp;
        const activeTabId =
          grp.activeTabId === tabId
            ? nextActiveTabAfterClose(grp.tabs, tabId)
            : grp.activeTabId;
        return {
          ...grp,
          tabs: grp.tabs.filter(t => t.id !== tabId),
          activeTabId,
        };
      })
    );
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
        const api = window.electron?.pty;
        if (!api) return { kind: 'noop' };
        const { projects: gs } = stateRef.current;
        const g = gs.find(x => x.tabs.some(t => t.id === tabId));
        const tab = g?.tabs.find(t => t.id === tabId);
        if (!g || !tab || tab.resumeState === 'resuming') {
          return { kind: 'noop' };
        }
        if (tab.lifecycle === 'draft') {
          // ⌘T ⌘W is a friction-free no-op — nothing exists yet
          removeTabFromLayout(tabId);
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
            return {
              kind: 'needs-confirm',
              working: !!(tab.sessionId && activityRef.current[tab.sessionId]),
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
            `Could not archive ${tab.title} — its conversation is still recoverable from its source.`
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
    [beginPendingClose, removeTabFromLayout]
  );

  /** resurrect a soft-closed Session whole: tab, goal, provider identity,
   *  retained history — the ledger's other half (D23) */
  const reopenClosedSession = useCallback(
    async (durableSessionId: string, reuseTabId?: string): Promise<boolean> => {
      const api = window.electron?.pty;
      if (!api?.reopenSession) return false;
      const entry = await api.reopenSession(durableSessionId);
      if (!entry) return false;
      const repairsLegacyCatalogTitle =
        entry.titleKind === undefined &&
        isLegacyCatalogTitleLeak({
          ...entry,
          semanticSummary: entry.goal,
        });
      const tab: WorkspaceTab = {
        id: reuseTabId ?? newTabId(),
        durableSessionId: entry.durableSessionId,
        harness: entry.harness,
        title: repairsLegacyCatalogTitle
          ? HARNESS_META[entry.harness].label
          : entry.title,
        titleKind: repairsLegacyCatalogTitle
          ? 'default'
          : entry.titleKind === 'default' || entry.titleKind === 'operator'
            ? entry.titleKind
            : isDefaultHarnessTitle(entry.harness, entry.title)
              ? 'default'
              : 'operator',
        cwd: entry.cwd,
        sessionId: null,
        harnessSessionId: entry.harnessSessionId,
        resumeState:
          entry.harnessSessionId || entry.harness === 'shell'
            ? 'ended-resumable'
            : 'identity-missing',
        lifecycle: 'stopped-clean',
        exitCode: null,
        roadmapItemId: null,
        initialTask: entry.initialTask,
      };
      if (entry.goal) {
        setSummaries(prev => ({
          ...prev,
          [entry.durableSessionId]: entry.goal as string,
        }));
      }
      setProjects(prev => {
        const i = prev.findIndex(grp => grp.dir === entry.projectDir);
        if (i === -1) {
          return [
            ...prev,
            {
              dir: entry.projectDir,
              name: entry.projectName,
              color: pickDistinctColor(prev.map(grp => grp.color)),
              tabs: [tab],
              activeTabId: tab.id,
            },
          ];
        }
        const next = [...prev];
        const replacesDraft =
          !!reuseTabId &&
          next[i].tabs.some(
            candidate =>
              candidate.id === reuseTabId && candidate.lifecycle === 'draft'
          );
        next[i] = {
          ...next[i],
          tabs: replacesDraft
            ? next[i].tabs.map(candidate =>
                candidate.id === reuseTabId ? tab : candidate
              )
            : [...next[i].tabs, tab],
          activeTabId: tab.id,
        };
        return next;
      });
      setActiveDir(entry.projectDir);
      return true;
    },
    []
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

  const resumeTab = useCallback(
    async (tabId: string, selectedHarnessId?: string): Promise<boolean> => {
      const api = window.electron?.pty;
      if (!api) return false;
      const tab = stateRef.current.projects
        .flatMap(project => project.tabs)
        .find(candidate => candidate.id === tabId);
      if (resumeInFlightRef.current.has(tabId)) return false;
      if (!tab || tabIsLive(tab) || tab.resumeState === 'resuming')
        return false;
      const exactId = selectedHarnessId ?? tab.harnessSessionId;
      if (tab.harness !== 'shell' && !exactId) {
        setError(
          `Choose the exact ${HARNESS_META[tab.harness].label} conversation.`
        );
        return false;
      }
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
      resumeInFlightRef.current.add(tabId);
      updateTab(tabId, {
        resumeState: 'resuming',
        lifecycle: 'resuming',
        exitCode: null,
      });
      const size = sizeRef.current?.() ?? null;
      let result;
      try {
        // the goal survives the resume (D21): statedTask re-anchors the
        // summarizer's strongest signal, restoredSubtitle re-seeds the last
        // goal — both metadata-only, never sent to the process
        const restoredSubtitle =
          summariesRef.current[tab.durableSessionId] ?? undefined;
        result = await api.create({
          harness: tab.harness,
          cwd: tab.cwd,
          title: tab.title,
          durableSessionId: tab.durableSessionId,
          ...(permissionMode ? { permissionMode } : {}),
          ...(exactId ? { resumeSessionId: exactId } : {}),
          ...(tab.initialTask ? { statedTask: tab.initialTask } : {}),
          ...(restoredSubtitle ? { restoredSubtitle } : {}),
          ...(size ?? {}),
        });
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
        resumeInFlightRef.current.delete(tabId);
      }
      if (!result.ok) {
        updateTab(tabId, {
          resumeState: 'failed',
          lifecycle: 'failed',
          exitCode: REVIVE_FAILED,
        });
        setError(result.error);
        return false;
      }
      updateTab(tabId, {
        sessionId: result.session.id,
        harnessSessionId: result.session.harnessSessionId ?? exactId ?? null,
        cwd: result.session.cwd,
        resumeState: exactId ? 'resumed' : 'live',
        lifecycle: 'running',
        exitCode: null,
      });
      setError(null);
      return true;
    },
    [updateTab]
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
      const dir = gs.find(g => g.dir === ad)?.dir ?? (lu || null);
      if (!dir) {
        setError(
          'Project directory is required — pick where this session lives.'
        );
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
      const result = await window.electron?.projects?.resolve(dir);
      if (!result) return false;
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      const canonicalDir = result.projectDir;
      setProjects(prev => {
        if (prev.some(project => project.dir === canonicalDir)) return prev;
        return [
          ...prev,
          {
            dir: canonicalDir,
            name: result.projectName,
            color: pickDistinctColor(prev.map(project => project.color)),
            tabs: [],
            activeTabId: null,
          },
        ];
      });
      setActiveDir(canonicalDir);
      setLastUsedDir(canonicalDir);
      setError(null);
      syncProjectIdentity({
        rootPath: canonicalDir,
        name: result.projectName,
      });
      return true;
    },
    [syncProjectIdentity]
  );

  /** Curated import adds inert Projects in one state transition. Every path is
   *  resolved again at the trust boundary even when it came from our scanner. */
  const importProjects = useCallback(
    async (directories: string[]): Promise<boolean> => {
      const unique = [...new Set(directories)];
      if (unique.length === 0) return false;
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
      setProjects(prev => {
        const next = [...prev];
        for (const ref of refs) {
          if (next.some(project => project.dir === ref.projectDir)) continue;
          next.push({
            dir: ref.projectDir,
            name: ref.projectName,
            color: pickDistinctColor(next.map(project => project.color)),
            tabs: [],
            activeTabId: null,
          });
        }
        return next;
      });
      const first = refs[0];
      setActiveDir(first.projectDir);
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
    [syncProjectIdentity]
  );

  /**
   * Remove an EMPTY Project from the open workspace without deleting its
   * durable registry/library identity. Callers own any Agent close flow first;
   * this guard prevents a Project close from orphaning a live PTY off-screen.
   */
  const closeProject = useCallback((dir: string): boolean => {
    const { projects: groups, activeDir: currentDir } = stateRef.current;
    const index = groups.findIndex(project => project.dir === dir);
    const project = groups[index];
    if (!project || project.tabs.length > 0) return false;

    // A just-opened Project may not have reached the debounced layout save.
    // Seed recency synchronously so ⌘N can always bring a closed group back.
    recentsRef.current = [
      {
        dir: project.dir,
        name: project.name,
        ...(project.color ? { color: project.color } : {}),
        lastOpenedAt: Date.now(),
      },
      ...recentsRef.current.filter(recent => recent.dir !== project.dir),
    ].slice(0, 12);

    setProjects(previous =>
      previous.some(
        candidate => candidate.dir === dir && candidate.tabs.length > 0
      )
        ? previous
        : previous.filter(candidate => candidate.dir !== dir)
    );
    if (currentDir === dir) {
      setActiveDir(groups[index + 1]?.dir ?? groups[index - 1]?.dir ?? null);
    }
    return true;
  }, []);

  const selectProject = useCallback((index: number): boolean => {
    const g = stateRef.current.projects[index];
    if (!g) return false;
    setActiveDir(g.dir);
    return true;
  }, []);

  /** Activate a tab by live PTY, stable tab, or durable Session identity. */
  const activateSession = useCallback((sessionRef: string): boolean => {
    const { projects: gs } = stateRef.current;
    for (const g of gs) {
      const tab = g.tabs.find(
        t =>
          t.sessionId === sessionRef ||
          t.id === sessionRef ||
          t.durableSessionId === sessionRef
      );
      if (tab) {
        setActiveDir(g.dir);
        setProjects(prev =>
          prev.map(x => (x.dir === g.dir ? { ...x, activeTabId: tab.id } : x))
        );
        return true;
      }
    }
    return false;
  }, []);

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
  const selectExistingTab = useCallback((dir: string, tabId: string) => {
    const { projects: gs } = stateRef.current;
    const g = gs.find(x => x.dir === dir);
    if (!g || !g.tabs.some(t => t.id === tabId)) return;
    setActiveDir(dir);
    setProjects(prev =>
      prev.map(x => (x.dir === dir ? { ...x, activeTabId: tabId } : x))
    );
  }, []);

  const selectTab = useCallback((dir: string, tabId: string) => {
    setActiveDir(dir);
    setProjects(prev =>
      prev.map(g => (g.dir === dir ? { ...g, activeTabId: tabId } : g))
    );
  }, []);

  /** ⌘⇧[/]: rotate through every visible section in display order, crossing
   *  project boundaries (operator, 2026-07-03) — the strip is one global
   *  ring. Open zero-tab Projects are real stops (D19): landing on one
   *  activates its empty state (the Agent composer) instead of skipping it.
   *  The ring math is pure and unit-tested in tab-ring.ts (D18). */
  const cycleTab = useCallback((delta: 1 | -1): boolean => {
    const { projects: gs, activeDir: ad } = stateRef.current;
    const next = nextTabInRing(gs, ad, delta);
    if (!next) return false;
    setActiveDir(next.dir);
    const tab = next.tab;
    if (tab) {
      setProjects(prev =>
        prev.map(x => (x.dir === next.dir ? { ...x, activeTabId: tab.id } : x))
      );
    }
    return true;
  }, []);

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

  const selectTabByOrdinal = useCallback((index: number): boolean => {
    const target = tabAtOrdinal(stateRef.current.projects, index);
    if (!target) return false;
    setActiveDir(target.dir);
    setProjects(prev =>
      prev.map(x =>
        x.dir === target.dir ? { ...x, activeTabId: target.tab.id } : x
      )
    );
    return true;
  }, []);

  const activeProject = projects.find(g => g.dir === activeDir) ?? null;
  /** operator naming (W0.4): titles/names persist via the layout save; the
   *  PTY session is renamed too so fleet/spatial show the same identity */
  const renameTab = useCallback(
    (tabId: string, title: string) => {
      const next = title.trim();
      if (!next) return;
      updateTab(tabId, { title: next, titleKind: 'operator' });
      const tab = stateRef.current.projects
        .flatMap(g => g.tabs)
        .find(t => t.id === tabId);
      if (tab?.sessionId) {
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
  const activeSessionId = activeTab?.sessionId ?? null;
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
  }, [activeSessionId]);

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
    setError,
    dismissReentryRecap,
    ready,
    launch,
    cloneSession,
    launchHere,
    openProject,
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
    resumeProject,
    resumeAll,
    selectProject,
    selectTab,
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
