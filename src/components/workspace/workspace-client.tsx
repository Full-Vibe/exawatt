'use client';

/**
 * Agent Terminal Workspace (ENG-002) — orchestration surface.
 *
 * W0.2 model: ONE window; projects are directory-keyed groups inside it
 * (⌘⌥1..9 switches project, ⌘⇧[/] rotates the global tab ring across projects,
 * ⌘T opens an Agent draft, and ⌘⇧T reopens a closed Session). Layout persists
 * across app restarts and
 * ended tabs restore without spawning and resume only an exact provider ID.
 * State/verbs live in use-workspace-state; this file is composition only.
 *
 * This terminal regime is FIRST-CLASS: an AI-native tmux++ developed in
 * parallel with the ENG-004 spatial regime — independent skins over the
 * same session system (see docs/product/operator-workflow.md).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LAYOUT_CLASS, TerminalPane } from './terminal-pane';
import { resolveStageLayout, tabIsPinnable } from './split-layout';
import {
  acceptTerminalSettings,
  loadTerminalFont,
  loadedTerminalFont,
  resolveTerminalFont,
  terminalFontsEqual,
} from './terminal-font';
import type { EffectiveTerminalFont } from './terminal-font';
import { TabStrip } from './tab-strip';
import { AgentComposer } from './launch-controls';
import { Button } from '@/components/ui/button';
import { CloseConfirm, CloseProjectConfirm } from './close-confirm';
import { navHistory } from '@/components/nav/nav-history';
import { ProjectOpener } from './project-opener';
import { ExposeOverlay } from './expose-overlay';
import { ReentryRecapLine } from './reentry-recap';
import {
  useWorkspaceState,
  tabCanResumeAsAgent,
  tabIsLive,
} from './use-workspace-state';
import { SessionRestorePanel } from './session-restore-panel';
import { RetainedTerminalPane } from './retained-terminal-pane';
import {
  useWorkspaceShortcuts,
  type WorkspaceShortcutActions,
} from './use-workspace-shortcuts';
import {
  JUMP_ATTENTION_EVENT,
  OPEN_ROADMAP_EVENT,
  RENAME_ACTIVE_EVENT,
  CLOSE_ACTIVE_EVENT,
  OPEN_OVERVIEW_EVENT,
  FOCUS_ACTIVE_TERMINAL_EVENT,
  OPEN_PROJECT_PICKER_EVENT,
  consumePendingProjectPicker,
  FOCUS_AGENT_COMPOSER_EVENT,
  hasPendingAgentComposer,
  hasPendingTabSelect,
  REOPEN_CLOSED_EVENT,
  REOPEN_LAST_CLOSED_EVENT,
  consumePendingReopenLastClosed,
} from './session-jump';
import { useEffectiveShortcut, useShortcuts } from '@/components/shortcuts';
import { formatShortcutKeys } from '@/lib/shortcuts';
import { useCommandNavigation } from '@/components/nav/command-navigation-provider';
import {
  ROADMAP_RAIL_FOCUS_EVENT,
  requestRoadmapRailSummon,
} from '@/components/roadmap/roadmap-rail';
import {
  useProjectRoadmap,
  type RoadmapSessionDescriptor,
} from '@/components/roadmap/use-project-roadmap';
import {
  findRoadmapSessionChip,
  deriveRoadmapBlockedSessions,
} from '@exawatt/ui-model';
import { HUD } from '@/components/hud';
import { useProductFeedback } from '@/components/feedback/product-feedback-provider';
import { setQuickFeedbackAttribution } from '@/components/feedback/quick-feedback-events';
import {
  Bell,
  BellOff,
  FolderOpen,
  Play,
  SquareTerminal,
  X,
  Plus,
} from 'lucide-react';
import { middleTruncatePath } from './path-label';
import { useProjectCloseLifecycle } from './use-project-close-lifecycle';
import { isAgentSourceId } from './agent-sources';
import {
  attentionNeedsOperator,
  mergeSessionAttentionMaps,
  orderedAttentionTargets,
} from './session-status';
import {
  deriveWorkspaceCommandAvailability,
  publishWorkspaceCommandAvailability,
  type WorkspaceContextCommand,
} from './workspace-command-availability';

/** the discoverability layer (S3): the workspace SHOWS its keys, exactly
 *  like the spatial map's bottom legend — normal case, dim, always there */
const KEY_HINTS: Array<{
  shortcutId: string;
  label: string;
  command?: WorkspaceContextCommand;
}> = [
  { shortcutId: 'command-palette', label: 'commands' },
  { shortcutId: 'command-sessions', label: 'sessions' },
  { shortcutId: 'workspace-new-project', label: 'new project' },
  { shortcutId: 'workspace-new-agent', label: 'new agent' },
  {
    shortcutId: 'workspace-new-shell',
    label: 'shell',
    command: 'launch-shell',
  },
  {
    shortcutId: 'workspace-split',
    label: 'split',
    command: 'toggle-split',
  },
  {
    shortcutId: 'workspace-roadmap',
    label: 'roadmap',
    command: 'open-roadmap',
  },
  {
    shortcutId: 'workspace-jump-attention',
    label: 'needs you',
    command: 'jump-attention',
  },
  {
    shortcutId: 'workspace-rename',
    label: 'rename',
    command: 'rename-tab',
  },
  { shortcutId: 'command-spatial', label: 'spatial' },
  { shortcutId: 'help-modal-slash', label: 'all keys' },
];

function WorkspaceKeyHint({
  shortcutId,
  label,
}: {
  shortcutId: string;
  label: string;
}) {
  const keys = useEffectiveShortcut(shortcutId);
  if (!keys) return null;
  return (
    <span className="flex items-center gap-1">
      <kbd
        className="rounded border px-1 leading-4"
        style={{
          borderColor: 'rgba(80,230,255,0.25)',
          color: HUD.textMono,
        }}
      >
        {formatShortcutKeys(keys)}
      </kbd>
      {label}
    </span>
  );
}

/**
 * Owns overflow for every new-Agent surface. Keeping the scroll contract here
 * prevents a long composer child from escaping its stage pane or painting over
 * workspace chrome.
 */
function ComposerViewport({ children }: { children: ReactNode }) {
  return (
    <div
      data-composer-scroll
      className="h-full min-h-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
    >
      <div className="flex min-h-full items-start justify-center py-6 sm:py-8">
        {children}
      </div>
    </div>
  );
}

export function WorkspaceClient() {
  const { activateCommandAltitude } = useCommandNavigation();
  // SSR renders neither branch; the electron check runs after mount so the
  // server and client HTML always match (hydration safety)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const inElectron = mounted && !!window.electron?.pty;

  const panesRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  // split view (S2): the last active NON-pinned tab — the driven/left side.
  // Lives up here unconditionally (rules of hooks); assigned below once the
  // active tab is known.
  const companionRef = useRef<string | null>(null);

  // effective terminal font = defaults + userData/settings.json (S3) —
  // panes render only after it resolves so every terminal is born with the
  // right font (one local IPC; imperceptible). The state hook awaits the
  // SAME loadTerminalFont() promise before auto-reviving, so restored
  // sessions never spawn with default metrics while a custom font loads.
  const [font, setFont] = useState<EffectiveTerminalFont | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [resumeNoticeDismissed, setResumeNoticeDismissed] = useState(false);
  const [projectOpenerOpen, setProjectOpenerOpen] = useState(false);
  useEffect(() => {
    if (!inElectron) return;
    let cancelled = false;
    const apply = (next: Promise<EffectiveTerminalFont>) =>
      void next.then(resolved => {
        if (!cancelled) {
          setFont(current =>
            terminalFontsEqual(current, resolved) ? current : resolved
          );
        }
      });
    apply(loadTerminalFont());
    void window.electron?.settings
      ?.get()
      .then(settings =>
        setNotificationsEnabled(settings.notifications?.attention ?? false)
      );
    const offSettings = window.electron?.settings?.onChanged?.(settings => {
      apply(Promise.resolve(acceptTerminalSettings(settings)));
      setNotificationsEnabled(settings.notifications?.attention ?? false);
    });
    return () => {
      cancelled = true;
      offSettings?.();
    };
  }, [inElectron]);

  // derive the spawn-size estimate from the terminal's own font config —
  // new sessions spawn at (approximately) their final size so TUIs never
  // init at 80 cols; the pane's post-attach wiggle-resync covers any drift
  const getInitialSize = useCallback(() => {
    const el = panesRef.current;
    if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return null;
    const f = loadedTerminalFont() ?? resolveTerminalFont(null);
    const cellW = f.cellWidthEstimate;
    const cellH = f.size * f.lineHeight;
    return {
      cols: Math.min(500, Math.max(20, Math.floor(el.offsetWidth / cellW))),
      rows: Math.min(200, Math.max(10, Math.floor(el.offsetHeight / cellH))),
    };
  }, []);

  const router = useRouter();
  const searchParams = useSearchParams();
  const { openCommandPalette, openHelpModal } = useShortcuts();
  const { isAuthenticated: feedbackEnabled, submitContextRating } =
    useProductFeedback();
  const {
    projects,
    activeProject,
    activeTab,
    pinnedTabId,
    summaries,
    attention,
    activity,
    engaged,
    reentryRecap,
    error,
    resumeBatchProgress,
    closedSessionCount,
    setError,
    dismissReentryRecap,
    launch,
    launchHere,
    openProject,
    importProjects,
    closeProject,
    closeTab,
    createDraftTab,
    updateDraft,
    reopenClosedSession,
    reopenLastClosedSession,
    resumeTab,
    resumeAll,
    selectProject,
    selectTab,
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
    ready,
  } = useWorkspaceState({ getInitialSize });

  const { exitingProjectDirs, requestProjectExit, retainProject } =
    useProjectCloseLifecycle({
      projects,
      ready,
      onCloseProject: closeProject,
    });

  useEffect(() => {
    if (!inElectron) return;
    const openPicker = () => {
      consumePendingProjectPicker();
      setProjectOpenerOpen(true);
    };
    window.addEventListener(OPEN_PROJECT_PICKER_EVENT, openPicker);
    if (consumePendingProjectPicker()) setProjectOpenerOpen(true);
    return () =>
      window.removeEventListener(OPEN_PROJECT_PICKER_EVENT, openPicker);
  }, [inElectron]);

  useEffect(() => {
    if (!inElectron) return;
    const ensureProject = (event: Event) => {
      if (!activeProject) {
        setProjectOpenerOpen(true);
        return;
      }
      // the summon IS a new tab now (D24): the draft pane hosts the
      // composer, and a palette source override rides ON the draft
      const requested = (event as CustomEvent<string | null>).detail ?? null;
      createDraftTab(
        undefined,
        requested && isAgentSourceId(requested)
          ? { draftSource: requested, draftTouched: true }
          : undefined
      );
    };
    window.addEventListener(FOCUS_AGENT_COMPOSER_EVENT, ensureProject);
    if (!activeProject && hasPendingAgentComposer()) {
      setProjectOpenerOpen(true);
    }
    return () =>
      window.removeEventListener(FOCUS_AGENT_COMPOSER_EVENT, ensureProject);
  }, [inElectron, activeProject, createDraftTab]);

  const readyAgentCount = useMemo(
    () =>
      projects.flatMap(project => project.tabs).filter(tabCanResumeAsAgent)
        .length,
    [projects]
  );
  const reconnectableAgents = useMemo(
    () =>
      projects.flatMap(project =>
        project.tabs.flatMap(tab =>
          tab.harness !== 'shell' &&
          !tabIsLive(tab) &&
          tab.resumeState !== 'resuming' &&
          !tab.harnessSessionId &&
          tab.lifecycle !== 'draft'
            ? [{ projectDir: project.dir, tab }]
            : []
        )
      ),
    [projects]
  );
  const stoppedAgentCount = readyAgentCount + reconnectableAgents.length;

  useEffect(() => {
    const off = window.electron?.pty?.onNotificationClick(({ id }) => {
      for (const project of projects) {
        const tab = project.tabs.find(item => item.sessionId === id);
        if (tab) {
          selectTab(project.dir, tab.id);
          return;
        }
      }
    });
    return off;
  }, [projects, selectTab]);

  const toggleNotifications = () => {
    void window.electron?.settings
      ?.setAttentionNotifications(!notificationsEnabled)
      .then(settings =>
        setNotificationsEnabled(settings.notifications?.attention ?? false)
      )
      .catch(reason =>
        setError(
          reason instanceof Error
            ? reason.message
            : 'Could not update notifications'
        )
      );
  };

  // roadmap home (ENG-017 S12): the lens lives at the Sessions altitude —
  // Terminal keeps only per-session mirrors (context chip, tile chips,
  // roadmap-derived attention) and summons Sessions for the full plan.
  const summonRoadmap = useCallback(
    (drillId?: string) => {
      requestRoadmapRailSummon(drillId);
      if (searchParams.get('view') === 'sessions') {
        window.dispatchEvent(new CustomEvent(ROADMAP_RAIL_FOCUS_EVENT));
      } else {
        activateCommandAltitude('sessions');
      }
      return true;
    },
    [activateCommandAltitude, searchParams]
  );

  // the lens data: live sessions of the focused Project, linked to roadmap
  // items by inference (S3); the same view feeds the rail and the
  // context-bar reciprocal chip
  const roadmapSessions = useMemo<RoadmapSessionDescriptor[]>(
    () =>
      (activeProject?.tabs ?? [])
        .filter(t => t.sessionId && tabIsLive(t))
        .map(t => ({
          sessionId: t.sessionId as string,
          tabId: t.id,
          title: t.title,
          harness: t.harness,
          cwd: t.cwd,
          contextSummary: summaries[t.durableSessionId] ?? null,
          needsAttention: attentionNeedsOperator(
            attention[t.sessionId as string]
          ),
        })),
    [activeProject, summaries, attention]
  );
  // declared-at-launch links (S4): machine-local tab annotations that
  // override inference; a declared id the roadmap no longer contains falls
  // to the unmapped shelf, never silently back to inference
  const declaredLinks = useMemo(
    () =>
      (activeProject?.tabs ?? [])
        .filter(t => t.roadmapItemId && t.sessionId && tabIsLive(t))
        .map(t => ({
          sessionId: t.sessionId as string,
          tabId: t.id,
          projectDir: activeProject?.dir ?? '',
          itemId: t.roadmapItemId as string,
          method: 'declared' as const,
          confidence: 'high' as const,
          evidence: [
            { kind: 'declared' as const, excerpt: 'declared at launch' },
          ],
          evaluatedAt: 0,
        })),
    [activeProject]
  );
  const { view: roadmapView } = useProjectRoadmap(
    activeProject?.dir ?? null,
    roadmapSessions,
    declaredLinks
  );
  // the launch picker offers the unfinished queue of the active project
  const launchRoadmapItems = useMemo(
    () =>
      roadmapView.status === 'ok'
        ? [...roadmapView.now, ...roadmapView.next, ...roadmapView.later].map(
            item => ({
              id: item.id,
              label: item.declaredId
                ? `${item.declaredId} — ${item.title}`
                : item.title,
            })
          )
        : [],
    [roadmapView]
  );
  const activeItemChip =
    activeTab && roadmapView.status === 'ok'
      ? findRoadmapSessionChip(roadmapView, activeTab.id)
      : null;

  // roadmap-derived attention (S8): blocked items with agents attached join
  // the SAME needs-you truth as terminal bells — badges and ⌘J, one pipeline.
  // `since` is pinned on first sight so the ⌘J oldest-first order is stable.
  const roadmapBlockedSince = useRef(new Map<string, number>());
  const roadmapAttention = useMemo(() => {
    const out: Record<string, { kind: 'roadmap-blocked'; since: number }> = {};
    const blocked = deriveRoadmapBlockedSessions(roadmapView);
    const seen = new Set<string>();
    for (const entry of blocked) {
      seen.add(entry.sessionId);
      const since =
        roadmapBlockedSince.current.get(entry.sessionId) ?? Date.now();
      roadmapBlockedSince.current.set(entry.sessionId, since);
      out[entry.sessionId] = { kind: 'roadmap-blocked', since };
    }
    for (const key of [...roadmapBlockedSince.current.keys()]) {
      if (!seen.has(key)) roadmapBlockedSince.current.delete(key);
    }
    return out;
  }, [roadmapView]);
  // Attention sources compose. A quiet harness result must never mask an
  // independent roadmap block for the same Session.
  const mergedAttention = useMemo(
    () => mergeSessionAttentionMaps(attention, roadmapAttention),
    [attention, roadmapAttention]
  );
  const attentionJumpTargets = useMemo(() => {
    const liveSessionIds = new Set(
      projects.flatMap(project =>
        project.tabs.flatMap(tab =>
          tab.sessionId && tab.exitCode === null ? [tab.sessionId] : []
        )
      )
    );
    return orderedAttentionTargets(
      mergedAttention,
      activeTab?.sessionId ?? null
    ).filter(sessionId => liveSessionIds.has(sessionId));
  }, [activeTab?.sessionId, mergedAttention, projects]);
  const hasAttentionTarget = attentionJumpTargets.length > 0;

  // ⌘J is a strict attention queue: every target has a visible needs-you
  // marker. Empty-roadmap starvation remains visible in the roadmap itself,
  // but must never surprise-navigate Terminal → Sessions without an amber
  // target in the workspace.
  const jumpAttentionQueue = useCallback((): boolean => {
    for (const sessionId of attentionJumpTargets) {
      for (const g of projects) {
        const tab = g.tabs.find(t => t.sessionId === sessionId);
        if (tab) {
          selectTab(g.dir, tab.id);
          return true;
        }
      }
    }
    return false;
  }, [attentionJumpTargets, projects, selectTab]);

  // the palette row dispatches OPEN_ROADMAP_EVENT; same summon as ⌘B
  useEffect(() => {
    const onOpenRoadmap = () => void summonRoadmap();
    window.addEventListener(OPEN_ROADMAP_EVENT, onOpenRoadmap);
    return () => window.removeEventListener(OPEN_ROADMAP_EVENT, onOpenRoadmap);
  }, [summonRoadmap]);

  // the menu item and palette row dispatch JUMP_ATTENTION_EVENT; run the
  // same ladder here so they never do less than the ⌘J key they advertise
  useEffect(() => {
    const onJump = () => jumpAttentionQueue();
    window.addEventListener(JUMP_ATTENTION_EVENT, onJump);
    return () => window.removeEventListener(JUMP_ATTENTION_EVENT, onJump);
  }, [jumpAttentionQueue]);

  // agent-first mirror (S9): tabId → what that agent is executing. Declared
  // ids cover every project (machine-local layout truth); the active
  // project's lens enriches with real labels, fractions, inferred links.
  const roadmapByTab = useMemo(() => {
    const out: Record<
      string,
      { label: string; fraction: string | null; inferred: boolean }
    > = {};
    for (const g of projects) {
      for (const t of g.tabs) {
        // declared ids are machine-local tab annotations — valid whether or
        // not the process is live, so a STOPPED tab keeps its item in the
        // overview (exactly the info you want when deciding what to resume)
        if (t.roadmapItemId) {
          out[t.id] = {
            label: t.roadmapItemId,
            fraction: null,
            inferred: false,
          };
        }
      }
    }
    if (roadmapView.status === 'ok') {
      const groups = [
        roadmapView.now,
        roadmapView.next,
        roadmapView.later,
        roadmapView.shipped,
        roadmapView.parked,
      ];
      for (const group of groups) {
        for (const item of group) {
          for (const chip of item.chips) {
            if (!chip.tabId) continue;
            out[chip.tabId] = {
              label: item.declaredId ?? item.title,
              fraction:
                item.milestonesTotal > 0
                  ? `${item.milestonesDone}/${item.milestonesTotal}`
                  : null,
              inferred: chip.method !== 'declared',
            };
          }
        }
      }
    }
    return out;
  }, [projects, roadmapView]);
  // Sessions altitude (S3): ⌃⌘2 — sessions fan out as tiles
  const requestedOverview = searchParams.get('view') === 'sessions';
  const [overviewOpen, setOverviewOpen] = useState(requestedOverview);
  const updateOverview = useCallback(
    (open: boolean) => {
      setOverviewOpen(open);
      const href = open ? '/workspace?view=sessions' : '/workspace';
      const current = `${window.location.pathname}${window.location.search}`;
      if (current !== href) router.replace(href, { scroll: false });
    },
    [router]
  );
  useEffect(() => setOverviewOpen(requestedOverview), [requestedOverview]);
  // back stack recorder (D27): every location the operator lands on in the
  // workspace — surface (Terminal vs Sessions) + the active tab — becomes a
  // ⌘[/⌘] stop. Applying back dedupes in navHistory, never re-records.
  useEffect(() => {
    if (!ready) return;
    // a ⌘[ application is mid-flight: the restored-layout active tab is a
    // transient state, not a location — recording it would truncate the
    // forward stack before the target tab applies (D27 review)
    if (hasPendingTabSelect()) return;
    navHistory.visit({
      surface: overviewOpen ? '/workspace?view=sessions' : '/workspace',
      tab:
        activeProject && activeTab
          ? { dir: activeProject.dir, tabId: activeTab.id }
          : null,
    });
  }, [ready, overviewOpen, activeProject, activeTab]);

  // ENG-025 F1: quick feedback submitted from the workspace attributes to the
  // active Project and durable Session without the provider knowing any
  // workspace state.
  useEffect(() => {
    const projectName = activeProject?.name ?? null;
    const durableSessionId = activeTab?.durableSessionId ?? null;
    setQuickFeedbackAttribution(() => ({ projectName, durableSessionId }));
    return () => setQuickFeedbackAttribution(null);
  }, [activeProject?.name, activeTab?.durableSessionId]);

  const closeOverview = useCallback(() => {
    updateOverview(false);
    requestAnimationFrame(() =>
      window.dispatchEvent(new CustomEvent(FOCUS_ACTIVE_TERMINAL_EVENT))
    );
  }, [updateOverview]);

  // ── Close grammar UI (D27): ⌘W closes like Chrome — the one confirm is
  // OUR modal (default-highlighted Close, tab/space/⏎ macOS semantics);
  // an ambient toast narrates archived closes (auto-fades)
  const [closeToast, setCloseToast] = useState<string | null>(null);
  const closeToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [closeConfirm, setCloseConfirm] = useState<{
    tabId: string;
    title: string;
    goal: string | null;
    working: boolean;
    color: string;
  } | null>(null);
  useEffect(
    () => () => {
      if (closeToastTimer.current) clearTimeout(closeToastTimer.current);
    },
    []
  );
  const requestClose = useCallback(
    async (tabId: string, force = false) => {
      const outcome = await closeTab(tabId, { force });
      if (outcome.kind === 'needs-confirm') {
        const project = projects.find(g => g.tabs.some(t => t.id === tabId));
        const tab = project?.tabs.find(t => t.id === tabId);
        if (!project || !tab) return;
        setCloseConfirm({
          tabId,
          title: tab.title,
          goal: summaries[tab.durableSessionId] ?? null,
          working: outcome.working,
          color: project.color,
        });
        return;
      }
      if (outcome.kind === 'closed') {
        if (closeToastTimer.current) clearTimeout(closeToastTimer.current);
        const what = outcome.entry.goal ?? outcome.entry.title;
        setCloseToast(`Closed "${what}" — kept for 14 days · ⌘⇧T to reopen`);
        closeToastTimer.current = setTimeout(() => setCloseToast(null), 6000);
      }
    },
    [closeTab, projects, summaries]
  );
  const [projectCloseConfirm, setProjectCloseConfirm] = useState<{
    dir: string;
    name: string;
    color: string;
    tabCount: number;
    workingCount: number;
  } | null>(null);
  const requestProjectClose = useCallback(
    (dir: string) => {
      const project = projects.find(candidate => candidate.dir === dir);
      if (!project) return;
      if (project.tabs.length === 0) {
        requestProjectExit(dir);
        return;
      }
      setProjectCloseConfirm({
        dir,
        name: project.name,
        color: project.color,
        tabCount: project.tabs.length,
        workingCount: project.tabs.filter(
          tab => !!(tab.sessionId && activity[tab.sessionId])
        ).length,
      });
    },
    [activity, projects, requestProjectExit]
  );
  /**
   * Browser-style close target: the active Agent tab wins; when the active
   * Project has no tabs, the same verb closes that empty Project. Keep this
   * shared by the key layer and menu/palette event so ⌘W never becomes an
   * entry-point-specific contract again.
   */
  const closeActiveItem = useCallback((): boolean => {
    if (activeTab) {
      void requestClose(activeTab.id);
      return true;
    }
    if (activeProject && activeProject.tabs.length === 0) {
      requestProjectClose(activeProject.dir);
      return true;
    }
    return false;
  }, [activeProject, activeTab, requestClose, requestProjectClose]);

  const commandAvailability = useMemo(
    () =>
      deriveWorkspaceCommandAvailability({
        activeProjectName: activeProject?.name ?? null,
        hasActiveTab: activeTab !== null,
        canToggleSplit:
          pinnedTabId !== null ||
          (activeTab !== null && tabIsPinnable(activeTab)),
        canClose:
          activeTab !== null ||
          (!!activeProject && activeProject.tabs.length === 0),
        hasAttentionTarget,
        closedSessionCount,
      }),
    [
      activeProject,
      activeTab,
      closedSessionCount,
      hasAttentionTarget,
      pinnedTabId,
    ]
  );
  useEffect(() => {
    if (ready) publishWorkspaceCommandAvailability(commandAvailability);
  }, [commandAvailability, ready]);
  const visibleKeyHints = KEY_HINTS.filter(
    hint =>
      !hint.command || commandAvailability.commands[hint.command].available
  );
  const confirmProjectClose = useCallback(() => {
    if (!projectCloseConfirm) return;
    const project = projects.find(
      candidate => candidate.dir === projectCloseConfirm.dir
    );
    setProjectCloseConfirm(null);
    if (!project) return;
    // Mark the group first: once the optimistic tab removals make it empty,
    // the Project exits immediately instead of entering the auto-close grace.
    requestProjectExit(project.dir);
    for (const tab of project.tabs) void requestClose(tab.id, true);
  }, [projectCloseConfirm, projects, requestClose, requestProjectExit]);
  const settleCloseConfirm = useCallback(() => {
    setCloseConfirm(null);
    requestAnimationFrame(() =>
      window.dispatchEvent(new CustomEvent(FOCUS_ACTIVE_TERMINAL_EVENT))
    );
  }, []);
  // ⌘T (D24): a new tab, instantly — draft in the active Project, or the
  // Project chooser when nothing is open
  const newDraftTab = useCallback(() => {
    if (!createDraftTab()) {
      setProjectOpenerOpen(true);
      return false;
    }
    return true;
  }, [createDraftTab]);

  // palette-issued workspace verbs (close/overview live here; the rest are
  // handled by the state hook and the tab strip)
  useEffect(() => {
    const onCloseActive = () => void closeActiveItem();
    const onReopenClosed = (e: Event) => {
      const durableSessionId = (e as CustomEvent<{ durableSessionId?: string }>)
        .detail?.durableSessionId;
      if (durableSessionId) void reopenClosedSession(durableSessionId);
    };
    window.addEventListener(REOPEN_CLOSED_EVENT, onReopenClosed);
    const onOpenOverview = () => {
      updateOverview(true);
    };
    window.addEventListener(CLOSE_ACTIVE_EVENT, onCloseActive);
    window.addEventListener(OPEN_OVERVIEW_EVENT, onOpenOverview);
    return () => {
      window.removeEventListener(REOPEN_CLOSED_EVENT, onReopenClosed);
      window.removeEventListener(CLOSE_ACTIVE_EVENT, onCloseActive);
      window.removeEventListener(OPEN_OVERVIEW_EVENT, onOpenOverview);
    };
  }, [closeActiveItem, reopenClosedSession, updateOverview]);

  // Native Session menu requests survive a route transition; the shortcut
  // itself calls the same action directly below. Wait for restored workspace
  // state before consuming the pending request so startup cannot overwrite it.
  useEffect(() => {
    if (!ready) return;
    const onReopenLastClosed = () => {
      consumePendingReopenLastClosed();
      reopenLastClosedSession();
    };
    window.addEventListener(REOPEN_LAST_CLOSED_EVENT, onReopenLastClosed);
    if (consumePendingReopenLastClosed()) reopenLastClosedSession();
    return () =>
      window.removeEventListener(REOPEN_LAST_CLOSED_EVENT, onReopenLastClosed);
  }, [ready, reopenLastClosedSession]);

  const shortcutActions = useMemo<WorkspaceShortcutActions>(() => {
    const focusTerminal = () => {
      window.dispatchEvent(new CustomEvent(FOCUS_ACTIVE_TERMINAL_EVENT));
      return !!activeTab?.sessionId;
    };
    return {
      launchShell: () =>
        commandAvailability.commands['launch-shell'].available
          ? launchHere('shell')
          : false,
      newProject: () => {
        setProjectOpenerOpen(true);
        return true;
      },
      closeActive: () => {
        return closeActiveItem();
      },
      reopenClosed: () =>
        commandAvailability.commands['reopen-closed-tab'].available
          ? reopenLastClosedSession()
          : false,
      selectIndex: selectProject,
      selectTabOrdinal: selectTabByOrdinal,
      cycle: cycleTab,
      moveTab: moveActiveTab,
      moveProject: moveActiveProject,
      newAgent: () => {
        // same summon the palette uses: expands + focuses the composer, or
        // opens the Project chooser first when nothing is open
        window.dispatchEvent(new CustomEvent(FOCUS_AGENT_COMPOSER_EVENT));
        return true;
      },
      jumpAttention: () => {
        // The chord belongs to the workspace even when the strict visible
        // queue is empty. Consume it as a deliberate no-op so Chromium or a
        // parent navigation layer cannot reinterpret ⌘J.
        jumpAttentionQueue();
        return true;
      },
      activateCommandAltitude: target => {
        activateCommandAltitude(target);
        return true;
      },
      openPalette: () => {
        openCommandPalette();
        return true;
      },
      openHelp: () => {
        openHelpModal();
        return true;
      },
      focusTerminal,
      toggleFocus: () => {
        const inTerminal = !!document.activeElement?.closest(
          '.xterm-helper-textarea'
        );
        if (!inTerminal) return focusTerminal();
        const target = chromeRef.current?.querySelector<HTMLElement>(
          'button:not([disabled]), input:not([disabled])'
        );
        target?.focus();
        return !!target;
      },
      togglePin,
      // ⌘B (S12): the roadmap lives at the Sessions altitude — summon it
      // there focused, from anywhere
      toggleRoadmap: () =>
        commandAvailability.commands['open-roadmap'].available
          ? summonRoadmap()
          : false,
      renameActive: () => {
        if (!activeTab) return false;
        window.dispatchEvent(new CustomEvent(RENAME_ACTIVE_EVENT));
        return true;
      },
    };
  }, [
    activeTab,
    commandAvailability,
    summonRoadmap,
    launchHere,
    closeActiveItem,
    reopenLastClosedSession,
    selectProject,
    cycleTab,
    selectTabByOrdinal,
    moveActiveTab,
    moveActiveProject,
    jumpAttentionQueue,
    togglePin,
    activateCommandAltitude,
    openCommandPalette,
    openHelpModal,
  ]);
  useWorkspaceShortcuts(shortcutActions, inElectron);

  if (!mounted) return null;

  if (!inElectron) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div
          className="max-w-md rounded border p-6 text-center"
          style={{
            borderColor: 'rgba(80,230,255,0.25)',
            background: 'rgba(7,12,20,0.9)',
          }}
        >
          <p
            className="font-display text-lg font-semibold"
            style={{ color: HUD.text }}
          >
            Terminal Workspace
          </p>
          <p className="mt-2 font-mono text-sm" style={{ color: HUD.textDim }}>
            Live terminal sessions run in the Exawatt desktop app. Launch it
            with <span style={{ color: HUD.textMono }}>pnpm electron:dev</span>.
          </p>
        </div>
      </div>
    );
  }

  const allTabs = projects.flatMap(g =>
    g.tabs.map(t => ({ tab: t, dir: g.dir }))
  );

  // split view (S2, reworked D26): the pinned tab renders RIGHT beside the
  // driven content LEFT. The pin follows the TAB — a pinned pane survives
  // its session's exit (retained scrollback + restore bar) so the operator
  // actually sees the watched agent finish. The driven side is whatever
  // would render full-screen without the pin: a live pane, a stopped tab,
  // the ⌘T draft page, or the empty-Project composer. The companion (last
  // active non-pinned tab) keeps the split up while the keyboard sits in
  // the pinned pane — a click must never collapse the split (you could
  // not even copy text out of the watched pane otherwise).
  if (activeTab && activeTab.id !== pinnedTabId) {
    companionRef.current = activeTab.id;
  }
  const stage = resolveStageLayout({
    entries: allTabs,
    activeTabId: activeTab?.id ?? null,
    emptyProjectStage: !!activeProject && activeProject.tabs.length === 0,
    pinnedTabId,
    companionTabId: companionRef.current,
  });
  const activeProjectExiting = !!(
    activeProject && exitingProjectDirs.has(activeProject.dir)
  );

  return (
    <div
      className="relative flex h-full flex-col"
      style={{ background: HUD.bg.void }}
    >
      <div
        data-workspace-underlay
        inert={overviewOpen}
        aria-hidden={overviewOpen || undefined}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* project groups + tabs + launch controls */}
        <div
          ref={chromeRef}
          data-workspace-chrome
          className="relative flex shrink-0 items-start gap-2 border-b px-3 py-2"
          style={{
            borderColor: 'rgba(80,230,255,0.15)',
            background: HUD.bg.deep,
          }}
        >
          {/* the strip wraps INSIDE its own flex-1 box (D24): the controls
              stay pinned to the first row instead of dropping below */}
          <div className="min-w-0 flex-1">
            <TabStrip
              projects={projects}
              activeDir={activeProject?.dir ?? null}
              pinnedTabId={pinnedTabId}
              summaries={summaries}
              attention={mergedAttention}
              activity={activity}
              engaged={engaged}
              onTogglePinTab={togglePinTab}
              onResumeTab={id => void resumeTab(id)}
              onNewAgent={dir => createDraftTab(dir)}
              onCloseProject={requestProjectClose}
              onRevealPath={cwd =>
                void window.electron?.pty?.openPath(cwd, cwd)
              }
              onSelectProject={selectProject}
              onSelectTab={selectTab}
              onCloseTab={id => void requestClose(id)}
              onRenameTab={renameTab}
              onRenameProject={renameProject}
              onSetProjectColor={setProjectColor}
              feedbackEnabled={feedbackEnabled}
              onRateContext={submitContextRating}
              onReorderTab={(tabId, targetTabId, place) =>
                void reorderTab(tabId, targetTabId, place)
              }
              onReorderProject={(dir, targetDir, place) =>
                void reorderProject(dir, targetDir, place)
              }
              exitingProjectDirs={exitingProjectDirs}
            />
          </div>
          {activeProject && activeProject.tabs.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-composer-toggle
              aria-label="New Agent"
              title={`New agent in ${activeProject.name} (⌘T)`}
              onClick={() => newDraftTab()}
              className="shrink-0 font-mono text-chrome-title!"
            >
              <Plus className="h-3.5 w-3.5" />
              New Agent
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setProjectOpenerOpen(true)}
              className="shrink-0 font-mono text-chrome-title!"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Open Project
            </Button>
          )}
          <button
            type="button"
            aria-label={
              notificationsEnabled
                ? 'Disable attention notifications'
                : 'Enable attention notifications'
            }
            aria-pressed={notificationsEnabled}
            title={
              notificationsEnabled
                ? 'Attention notifications enabled'
                : 'Attention notifications disabled'
            }
            onClick={toggleNotifications}
            className="grid h-7 w-7 shrink-0 place-items-center rounded border outline-none hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-hud-cyan"
            style={{
              color: notificationsEnabled ? HUD.amber : HUD.textDim,
              borderColor: notificationsEnabled
                ? 'rgba(255,184,77,0.42)'
                : 'rgba(80,230,255,0.2)',
            }}
          >
            {notificationsEnabled ? (
              <Bell className="h-3.5 w-3.5" />
            ) : (
              <BellOff className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        {stoppedAgentCount > 0 && !resumeNoticeDismissed && (
          <div
            role="region"
            aria-label="Saved Agent recovery"
            className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 font-mono text-xs"
            style={{
              borderColor: 'rgba(25,230,255,0.18)',
              background: 'rgba(25,230,255,0.06)',
              color: HUD.textDim,
            }}
          >
            <span role="status" className="min-w-0 flex-1">
              {resumeBatchProgress
                ? `Resuming ${resumeBatchProgress.completed} of ${resumeBatchProgress.total} saved agents…`
                : readyAgentCount > 0
                  ? `${readyAgentCount} saved ${readyAgentCount === 1 ? 'agent is' : 'agents are'} ready to resume${reconnectableAgents.length > 0 ? ` · ${reconnectableAgents.length} ${reconnectableAgents.length === 1 ? 'needs' : 'need'} reconnection` : ''}`
                  : `${reconnectableAgents.length} saved ${reconnectableAgents.length === 1 ? 'agent needs its' : 'agents need their'} conversation reconnected`}
            </span>
            {readyAgentCount > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!!resumeBatchProgress}
                onClick={resumeAll}
                className="h-7 font-mono"
              >
                <Play className="h-3.5 w-3.5" />
                {resumeBatchProgress
                  ? 'Resuming…'
                  : `Resume ${readyAgentCount} ${readyAgentCount === 1 ? 'Agent' : 'Agents'}`}
              </Button>
            )}
            <button
              type="button"
              aria-label="Dismiss resume notice"
              title="Dismiss"
              onClick={() => setResumeNoticeDismissed(true)}
              className="grid h-7 w-7 place-items-center outline-none hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-hud-cyan"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* middle band: [context bar + errors + stage] beside the roadmap
          rail (ENG-017). The stage width changes ONCE when the rail mode
          flips (single xterm fit) — only rail CONTENTS animate, per the
          ENG-015 S3 reflow rule. On narrow windows the rail overlays. */}
        <div className="relative flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {activeTab && (
              <div
                data-active-session-context
                className="flex min-h-9 shrink-0 items-center gap-2 border-b px-3 py-1.5"
                style={{
                  borderColor: 'rgba(80,230,255,0.1)',
                  background: 'rgba(8,13,22,0.92)',
                }}
              >
                <FolderOpen
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ color: HUD.textDim }}
                />
                <span
                  data-active-session-path
                  className="min-w-0 shrink truncate font-mono text-chrome-label"
                  title={activeTab.cwd}
                  tabIndex={0}
                  style={{ color: HUD.textMono }}
                >
                  {middleTruncatePath(activeTab.cwd)}
                </span>
                {activeItemChip && (
                  <button
                    type="button"
                    title={`working on ${activeItemChip.item.title} — open in roadmap`}
                    onClick={() => summonRoadmap(activeItemChip.item.id)}
                    className="shrink-0 rounded border px-1.5 py-px font-mono text-chrome-meta outline-none hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-hud-cyan"
                    style={{
                      color: activeProject?.color ?? HUD.textMono,
                      borderColor: `${activeProject?.color ?? HUD.cyan}55`,
                      borderStyle:
                        activeItemChip.chip.method === 'inferred'
                          ? 'dashed'
                          : 'solid',
                    }}
                  >
                    {activeItemChip.item.declaredId ??
                      activeItemChip.item.title}
                  </button>
                )}
                {reentryRecap && activeTab.sessionId === reentryRecap.id ? (
                  <ReentryRecapLine
                    recap={reentryRecap}
                    onExpire={dismissReentryRecap}
                  />
                ) : (
                  // durable-Session goal (D21): a stopped tab still answers
                  // "what was this session driving toward?"
                  summaries[activeTab.durableSessionId] && (
                    <span
                      className="line-clamp-2 min-w-0 flex-1 border-l pl-3 text-sm leading-5"
                      style={{
                        color: HUD.textDim,
                        borderColor: 'rgba(138,160,190,0.18)',
                      }}
                    >
                      {summaries[activeTab.durableSessionId]}
                    </span>
                  )
                )}
                <button
                  type="button"
                  aria-label="Focus active terminal"
                  title="Focus active terminal"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent(FOCUS_ACTIVE_TERMINAL_EVENT)
                    )
                  }
                  className="grid h-7 w-7 shrink-0 place-items-center rounded outline-none hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-hud-cyan"
                  style={{ color: HUD.textDim }}
                >
                  <SquareTerminal className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* launch errors (missing/bad dir, worktree or spawn failures) */}
            {error && (
              <div
                role="alert"
                className="flex shrink-0 items-center justify-between gap-3 border-b px-3 py-1.5 font-mono text-xs"
                style={{
                  color: HUD.red,
                  borderColor: 'rgba(255,31,75,0.35)',
                  background: 'rgba(255,31,75,0.08)',
                }}
              >
                <span>{error}</span>
                <button
                  onClick={() => setError(null)}
                  aria-label="Dismiss error"
                  className="px-1 outline-none focus-visible:ring-1 focus-visible:ring-hud-red"
                >
                  ×
                </button>
              </div>
            )}

            {/* panes: ALL tabs stay mounted (sessions keep streaming across
          project switches); exactly one is visible (two in a split).
          Terminals are born with the EFFECTIVE font, so rendering waits for
          settings.json to resolve (one local IPC) */}
            <div
              ref={panesRef}
              data-workspace-stage
              data-project-exiting={activeProjectExiting || undefined}
              className={`relative min-h-0 flex-1 origin-center transition-[transform,opacity] duration-300 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:scale-100 motion-reduce:transition-opacity ${
                overviewOpen ? 'scale-[0.975] opacity-35' : ''
              }`}
            >
              {!activeProject ? (
                <div className="flex h-full flex-col items-center justify-center gap-4">
                  <button
                    type="button"
                    onClick={() => setProjectOpenerOpen(true)}
                    className="inline-flex h-10 items-center gap-2 rounded border px-4 font-mono text-sm outline-none hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-hud-cyan"
                    style={{
                      color: HUD.text,
                      borderColor: 'rgba(80,230,255,0.3)',
                    }}
                  >
                    <FolderOpen className="h-4 w-4" /> Open Project
                  </button>
                  <p
                    className="max-w-sm text-center font-mono text-chrome-label"
                    style={{ color: HUD.textDim }}
                  >
                    Choose the Project where you want to start or resume work.
                  </p>
                </div>
              ) : (
                <>
                  {/* every tab renders through ONE per-state pane path
                    (D26): live panes stay mounted whatever is active —
                    including an empty Project's composer — and a stopped,
                    draft, or resuming tab renders wherever the layout
                    puts it (full, driven-left, or watched-right), not
                    only as a full-stage overlay of the active tab. */}
                  {font !== null &&
                    allTabs.map(({ tab, dir }) => {
                      const layout = stage.layoutFor(tab.id);
                      if (tab.sessionId) {
                        return (
                          <TerminalPane
                            key={tab.sessionId}
                            sessionId={tab.sessionId}
                            cwd={tab.cwd}
                            active={tab.id === activeTab?.id}
                            layout={layout}
                            font={font}
                            onActivate={() => selectTab(dir, tab.id)}
                          />
                        );
                      }
                      if (layout === 'hidden') return null;
                      const project = projects.find(p => p.dir === dir);
                      if (!project) return null;
                      return (
                        <div
                          key={tab.id}
                          data-pane={layout}
                          className={LAYOUT_CLASS[layout]}
                          style={
                            layout === 'right'
                              ? {
                                  borderLeft: '1px solid rgba(80,230,255,0.2)',
                                }
                              : undefined
                          }
                          onMouseDown={
                            tab.id !== activeTab?.id
                              ? () => selectTab(dir, tab.id)
                              : undefined
                          }
                        >
                          {tab.lifecycle === 'draft' ? (
                            // the new-tab page (D24): the pane IS the composer
                            <ComposerViewport>
                              <AgentComposer
                                projectDir={project.dir}
                                projectName={project.name}
                                initialSource={tab.draftSource ?? undefined}
                                initialTask={tab.draftTask ?? undefined}
                                initialModel={tab.draftModel ?? undefined}
                                initialEffort={tab.draftEffort ?? undefined}
                                initialWorktree={tab.draftWorktree}
                                initialBranch={tab.draftBranch ?? undefined}
                                initialRoadmapItemId={
                                  tab.draftRoadmapItemId ?? undefined
                                }
                                roadmapItems={launchRoadmapItems}
                                onLaunch={opts =>
                                  launch({ ...opts, reuseTabId: tab.id })
                                }
                                onReopenConversation={durableSessionId =>
                                  reopenClosedSession(durableSessionId, tab.id)
                                }
                                onDraftChange={patch =>
                                  updateDraft(tab.id, patch)
                                }
                                onDraftIntent={patch =>
                                  updateDraft(tab.id, patch)
                                }
                              />
                            </ComposerViewport>
                          ) : tab.resumeState === 'resuming' ? (
                            <p
                              className="absolute inset-0 flex items-center justify-center text-sm"
                              style={{ color: HUD.textDim }}
                            >
                              Starting a new process for the saved
                              conversation...
                            </p>
                          ) : (
                            <div className="absolute inset-0 flex min-h-0 flex-col">
                              <SessionRestorePanel
                                tab={tab}
                                onResumeTab={resumeTab}
                              />
                              <RetainedTerminalPane
                                durableSessionId={tab.durableSessionId}
                                title={tab.title}
                                font={font}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  {/* empty-Project composer: the driven side of a split
                    when something is pinned (D26), full alone otherwise */}
                  {stage.stagePane !== 'hidden' && (
                    <div
                      data-pane={stage.stagePane}
                      data-empty-project-exiting={
                        activeProjectExiting || undefined
                      }
                      className={`${LAYOUT_CLASS[stage.stagePane]} origin-left transition-[transform,opacity] duration-[240ms] [transition-timing-function:cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none ${
                        activeProjectExiting
                          ? 'pointer-events-none scale-x-0 opacity-0'
                          : ''
                      }`}
                    >
                      <ComposerViewport>
                        <AgentComposer
                          projectDir={activeProject.dir}
                          projectName={activeProject.name}
                          roadmapItems={launchRoadmapItems}
                          onLaunch={launch}
                          onReopenConversation={reopenClosedSession}
                          onUserInteraction={() =>
                            retainProject(activeProject.dir)
                          }
                          onDraftIntent={patch =>
                            createDraftTab(activeProject.dir, patch)
                          }
                        />
                      </ComposerViewport>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* discoverability (S3): the workspace SHOWS its keys — same pattern
          as the spatial map's bottom legend */}
        <div
          data-key-hints
          className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-1 font-mono text-chrome-meta"
          style={{
            color: HUD.textDim,
            borderColor: 'rgba(80,230,255,0.12)',
            background: HUD.bg.deep,
          }}
        >
          {visibleKeyHints.map(hint => (
            <WorkspaceKeyHint key={hint.shortcutId} {...hint} />
          ))}
        </div>
      </div>

      {/* Mission Control-style Sessions overview. The obscured workspace
          underlay is inert; shell-level navigation remains reachable. */}
      {overviewOpen && (
        <ExposeOverlay
          roadmapByTab={roadmapByTab}
          projects={projects}
          summaries={summaries}
          attention={mergedAttention}
          activity={activity}
          engaged={engaged}
          activeTabId={activeTab?.id ?? null}
          activeProjectDir={activeProject?.dir ?? null}
          onPick={(dir, tabId) => {
            selectTab(dir, tabId);
            closeOverview();
          }}
          onPickProject={dir => {
            const index = projects.findIndex(project => project.dir === dir);
            if (index >= 0) selectProject(index);
            closeOverview();
          }}
          onClose={closeOverview}
        />
      )}
      <ProjectOpener
        open={projectOpenerOpen}
        onOpenChange={setProjectOpenerOpen}
        workspaceProjects={projects}
        onOpenProject={openProject}
        onImportProjects={importProjects}
      />
      {closeConfirm && (
        <CloseConfirm
          title={closeConfirm.title}
          goal={closeConfirm.goal}
          working={closeConfirm.working}
          color={closeConfirm.color}
          onClose={() => {
            const { tabId } = closeConfirm;
            settleCloseConfirm();
            void requestClose(tabId, true);
          }}
          onCancel={settleCloseConfirm}
        />
      )}
      {projectCloseConfirm && (
        <CloseProjectConfirm
          title={projectCloseConfirm.name}
          tabCount={projectCloseConfirm.tabCount}
          workingCount={projectCloseConfirm.workingCount}
          color={projectCloseConfirm.color}
          onClose={confirmProjectClose}
          onCancel={() => setProjectCloseConfirm(null)}
        />
      )}
      {closeToast && (
        <div
          data-close-toast
          role="status"
          className="fixed bottom-10 right-4 z-40 max-w-md rounded border px-3 py-2 font-sans text-xs motion-safe:animate-in motion-safe:fade-in"
          style={{
            borderColor: 'rgba(138,160,190,0.25)',
            background: HUD.bg.panelFill,
            color: HUD.textDim,
          }}
        >
          {closeToast}
        </div>
      )}
    </div>
  );
}
