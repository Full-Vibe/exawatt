'use client';

/**
 * Demo Workspace shell (ENG-027 W2, rebuilt under W6) — the Agent and Team
 * altitudes for the Demo tenant, rendered through the SAME chrome the live
 * shell uses: the D45 single-row `TabStrip` ribbon, the live context bar and
 * stage frame, and the exposé's inert-underlay pattern. The only demo-specific
 * rendering is the pane content source (`DemoSessionPane`).
 *
 * Demo-local verbs are real against fixture state: select, reorder (pointer
 * drag and ⌘⌥[/]), rename, recolor, close with the live confirm, and reopen
 * from the close ledger. Verbs that would reach a process — launch, shell,
 * split, resume — are simply absent, so the ribbon's menus never offer them.
 *
 * Nothing in this file can reach `window.electron.pty` — the Demo tenant has
 * no path to a process by construction.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FolderOpen, SquareTerminal, Target } from 'lucide-react';
import { HUD } from '@/components/hud';
import { ExposeOverlay } from '@/components/workspace/expose-overlay';
import { TabStrip } from '@/components/workspace/tab-strip';
import { CloseConfirm } from '@/components/workspace/close-confirm';
import { WorkspaceKeyHint } from '@/components/workspace/workspace-client';
import { middleTruncatePath } from '@/components/workspace/path-label';
import {
  SESSION_JUMP_EVENT,
  MOVE_ACTIVE_PROJECT_EVENT,
  MOVE_ACTIVE_TAB_EVENT,
  CLOSE_ACTIVE_EVENT,
  REOPEN_LAST_CLOSED_EVENT,
  JUMP_ATTENTION_EVENT,
  consumePendingSessionJump,
  consumePendingReopenLastClosed,
} from '@/components/workspace/session-jump';
import {
  useFixedWorkspaceShortcuts,
  type FixedWorkspaceShortcutActions,
} from '@/components/workspace/use-workspace-shortcuts';
import {
  moveProjectInList,
  moveTabWithinProject,
  placeProjectBeside,
  placeTabBeside,
  nextActiveTabAfterClose,
} from '@/components/workspace/tab-ring';
import {
  orderedAttentionTargets,
  attentionNeedsOperator,
} from '@/components/workspace/session-status';
import type {
  Project,
  WorkspaceTab,
} from '@/components/workspace/use-workspace-state';
import {
  deriveWorkspaceCommandAvailability,
  publishWorkspaceCommandAvailability,
  EMPTY_WORKSPACE_COMMAND_AVAILABILITY,
  type WorkspaceContextCommand,
} from '@/components/workspace/workspace-command-availability';
import {
  demoProjectFor,
  demoInitiativeFor,
  demoRoadmapRead,
  demoShellActivity,
  demoShellAgents,
  demoShellAgentTypes,
  demoShellInitiatives,
  demoShellConsumption,
  demoShellAttention,
  demoShellDelegation,
  demoShellEngaged,
  demoShellGoalVisuals,
  demoShellFleetAgentById,
  demoShellProjects,
  demoShellRoadmapByTab,
  demoShellSummaries,
  demoTab,
} from './model';
import { DemoSessionPane } from './demo-session-pane';

/** The Session a walk-up demo opens first: the hero transcript. */
const DEFAULT_SESSION_ID = 'vg-home-onboard';

/** The live shell's discoverability footer, reduced to the verbs the Demo
 *  tenant actually answers — same component, same availability gating. */
const DEMO_KEY_HINTS: Array<{
  shortcutId: string;
  label: string;
  command?: WorkspaceContextCommand;
}> = [
  { shortcutId: 'command-palette', label: 'commands' },
  { shortcutId: 'command-sessions', label: 'team' },
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
  { shortcutId: 'command-spatial', label: 'fleet' },
  { shortcutId: 'help-modal-slash', label: 'all keys' },
];

/** Close-ledger entry: where the tab lived, so reopen restores it there. */
interface ClosedDemoTab {
  tab: WorkspaceTab;
  projectDir: string;
  projectIndex: number;
  tabIndex: number;
  /** Snapshot of the Project row in case closing emptied it. */
  project: Pick<Project, 'dir' | 'name' | 'color'>;
}

export function DemoWorkspaceClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const overviewOpen = searchParams.get('view') === 'sessions';

  const agents = useMemo(() => demoShellAgents(), []);
  const [projects, setProjects] = useState(() => demoShellProjects());
  const [closedTabs, setClosedTabs] = useState<ClosedDemoTab[]>([]);
  const summaries = useMemo(() => demoShellSummaries(), []);
  const attention = useMemo(() => demoShellAttention(), []);
  const activity = useMemo(() => demoShellActivity(), []);
  const engaged = useMemo(() => demoShellEngaged(), []);
  const delegation = useMemo(() => demoShellDelegation(), []);
  const roadmapByTab = useMemo(() => demoShellRoadmapByTab(), []);
  const agentTypeByTab = useMemo(() => demoShellAgentTypes(), []);
  const initiativeByTab = useMemo(() => demoShellInitiatives(), []);
  const goalVisuals = useMemo(() => demoShellGoalVisuals(), []);
  const consumptionByTab = useMemo(() => demoShellConsumption(), []);
  const sessionPaneRef = useRef<HTMLElement>(null);
  const [closeConfirm, setCloseConfirm] = useState<{
    tabId: string;
    title: string;
    goal: string | null;
    color: string;
  } | null>(null);

  // Session resolution accepts the FULL fleet (base + scale tier): a
  // Fleet-board "Open session" targets any board agent, and every one of
  // them owns an honest session record. Only an unknown id falls back to
  // the default hero — never a known agent to unrelated content.
  const [activeId, setActiveId] = useState<string>(() => {
    const pending = consumePendingSessionJump();
    if (pending && demoShellFleetAgentById(pending)) return pending;
    return agents.some(agent => agent.id === DEFAULT_SESSION_ID)
      ? DEFAULT_SESSION_ID
      : (agents[0]?.id ?? '');
  });
  const [reorderStatus, setReorderStatus] = useState({
    sequence: 0,
    message: '',
  });
  const announceReorder = useCallback((message: string) => {
    setReorderStatus(current => ({
      sequence: current.sequence + 1,
      message,
    }));
  }, []);

  // ⌘K / Fleet-altitude jumps: same event contract as the live shell
  useEffect(() => {
    const onJump = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (demoShellFleetAgentById(id)) {
        consumePendingSessionJump();
        setActiveId(id);
        if (overviewOpen) router.replace('/workspace', { scroll: false });
      }
    };
    window.addEventListener(SESSION_JUMP_EVENT, onJump);
    return () => window.removeEventListener(SESSION_JUMP_EVENT, onJump);
  }, [overviewOpen, router]);

  const allTabs = useMemo(
    () => projects.flatMap(project => project.tabs),
    [projects]
  );
  const activeTab = allTabs.find(tab => tab.id === activeId) ?? null;
  const activeAgent =
    agents.find(agent => agent.id === activeId) ??
    demoShellFleetAgentById(activeId) ??
    null;
  const activeInitiative = activeAgent ? demoInitiativeFor(activeAgent) : null;
  /** A scale-tier Session opened from the Fleet board: not a base-tier tab,
   *  so its chip rides transiently in its Project's ribbon group while open. */
  const transientAgent = activeAgent && !activeTab ? activeAgent : null;
  const transientProject = transientAgent
    ? (demoProjectFor(transientAgent) ?? null)
    : null;
  const activeProject =
    projects.find(project =>
      project.tabs.some(tab => tab.id === activeAgent?.id)
    ) ??
    (transientProject
      ? projects.find(project => project.dir === transientProject.dir)
      : undefined);

  /** What the ribbon renders: state Projects with the active tab marked, and
   *  the transient scale-tier Session spliced into its Project while open. */
  const ribbonProjects = useMemo(() => {
    return projects.map(project => {
      let tabs = project.tabs;
      if (
        transientAgent &&
        transientProject &&
        project.dir === transientProject.dir
      ) {
        tabs = [...tabs, demoTab(transientAgent, transientProject)];
      }
      const activeTabId = tabs.some(tab => tab.id === activeId)
        ? activeId
        : (project.activeTabId ?? tabs[0]?.id ?? null);
      return { ...project, tabs, activeTabId };
    });
  }, [projects, transientAgent, transientProject, activeId]);

  const selectProject = useCallback(
    (index: number): boolean => {
      const project = projects[index];
      const first = project?.tabs[0];
      if (!first) return false;
      setActiveId(first.id);
      if (overviewOpen) router.replace('/workspace', { scroll: false });
      return true;
    },
    [overviewOpen, projects, router]
  );

  const selectTabOrdinal = useCallback(
    (index: number): boolean => {
      const target = index === 8 ? allTabs.at(-1) : allTabs[index];
      if (!target) return false;
      setActiveId(target.id);
      if (overviewOpen) router.replace('/workspace', { scroll: false });
      return true;
    },
    [allTabs, overviewOpen, router]
  );

  const cycleTab = useCallback(
    (delta: 1 | -1): boolean => {
      const from = allTabs.findIndex(tab => tab.id === activeId);
      if (from < 0 || allTabs.length < 2) return false;
      const target = allTabs[(from + delta + allTabs.length) % allTabs.length];
      setActiveId(target.id);
      if (overviewOpen) router.replace('/workspace', { scroll: false });
      return true;
    },
    [activeId, allTabs, overviewOpen, router]
  );

  const moveTab = useCallback(
    (delta: 1 | -1): boolean => {
      const project = projects.find(candidate =>
        candidate.tabs.some(tab => tab.id === activeId)
      );
      const from = project?.tabs.findIndex(tab => tab.id === activeId) ?? -1;
      const next = moveTabWithinProject(projects, activeId, delta);
      if (!next) {
        announceReorder(
          `Session cannot move ${delta < 0 ? 'left' : 'right'} from its current position.`
        );
        return false;
      }
      setProjects(next);
      const tab = project?.tabs[from];
      if (project && tab) {
        announceReorder(
          `Moved Session ${tab.title} to position ${from + delta + 1} of ${project.tabs.length}.`
        );
      }
      return true;
    },
    [activeId, announceReorder, projects]
  );

  const moveProject = useCallback(
    (delta: 1 | -1): boolean => {
      if (!activeProject) return false;
      const from = projects.findIndex(
        project => project.dir === activeProject.dir
      );
      const next = moveProjectInList(projects, activeProject.dir, delta);
      if (!next) {
        announceReorder(
          `Project cannot move ${delta < 0 ? 'left' : 'right'} from its current position.`
        );
        return false;
      }
      setProjects(next);
      announceReorder(
        `Moved Project ${activeProject.name} to position ${from + delta + 1} of ${projects.length}.`
      );
      return true;
    },
    [activeProject, announceReorder, projects]
  );

  /* ---------------- demo-local ribbon verbs (fixture state) ------------- */

  const reorderTabBeside = useCallback(
    (tabId: string, targetTabId: string, place: 'before' | 'after') => {
      setProjects(
        current => placeTabBeside(current, tabId, targetTabId, place) ?? current
      );
    },
    []
  );

  const reorderProjectBeside = useCallback(
    (dir: string, targetDir: string, place: 'before' | 'after') => {
      setProjects(
        current => placeProjectBeside(current, dir, targetDir, place) ?? current
      );
    },
    []
  );

  const renameTab = useCallback((tabId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setProjects(current =>
      current.map(project =>
        project.tabs.some(tab => tab.id === tabId)
          ? {
              ...project,
              tabs: project.tabs.map(tab =>
                tab.id === tabId
                  ? { ...tab, title: trimmed, titleKind: 'operator' as const }
                  : tab
              ),
            }
          : project
      )
    );
  }, []);

  const renameProject = useCallback((dir: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setProjects(current =>
      current.map(project =>
        project.dir === dir ? { ...project, name: trimmed } : project
      )
    );
  }, []);

  const setProjectColor = useCallback((dir: string, color: string) => {
    setProjects(current =>
      current.map(project =>
        project.dir === dir ? { ...project, color } : project
      )
    );
  }, []);

  /** Close for real, against fixture state: the tab leaves the ribbon, its
   *  right neighbor activates (Chrome policy), and the close ledger holds it
   *  for reopen. A reload restores the authored fleet. */
  const closeTab = useCallback(
    (tabId: string) => {
      const projectIndex = projects.findIndex(project =>
        project.tabs.some(tab => tab.id === tabId)
      );
      const project = projects[projectIndex];
      const tabIndex = project?.tabs.findIndex(tab => tab.id === tabId) ?? -1;
      const tab = project?.tabs[tabIndex];
      if (!project || !tab) return;

      setClosedTabs(current => [
        ...current,
        {
          tab,
          projectDir: project.dir,
          projectIndex,
          tabIndex,
          project: {
            dir: project.dir,
            name: project.name,
            color: project.color,
          },
        },
      ]);
      setProjects(current =>
        current
          .map(candidate =>
            candidate.dir === project.dir
              ? {
                  ...candidate,
                  tabs: candidate.tabs.filter(t => t.id !== tabId),
                }
              : candidate
          )
          .filter(candidate => candidate.tabs.length > 0)
      );
      if (activeId === tabId) {
        const nextInProject = nextActiveTabAfterClose(project.tabs, tabId);
        const nextGlobal = nextActiveTabAfterClose(allTabs, tabId);
        setActiveId(nextInProject ?? nextGlobal ?? '');
      }
    },
    [activeId, allTabs, projects]
  );

  /** The live confirm gate: a working Session never closes on one keystroke. */
  const requestClose = useCallback(
    (tabId: string) => {
      const tab = allTabs.find(candidate => candidate.id === tabId);
      if (!tab) return;
      if (activity[tabId]) {
        const project = projects.find(candidate =>
          candidate.tabs.some(t => t.id === tabId)
        );
        setCloseConfirm({
          tabId,
          title: tab.title,
          goal: tab.initialTask ?? null,
          color: project?.color ?? '#50E6FF',
        });
        return;
      }
      closeTab(tabId);
    },
    [activity, allTabs, closeTab, projects]
  );

  const reopenLastClosed = useCallback((): boolean => {
    const entry = closedTabs.at(-1);
    if (!entry) return false;
    setClosedTabs(current => current.slice(0, -1));
    setProjects(existing => {
      const at = existing.findIndex(
        project => project.dir === entry.projectDir
      );
      if (at >= 0) {
        return existing.map(project => {
          if (project.dir !== entry.projectDir) return project;
          const tabs = [...project.tabs];
          tabs.splice(Math.min(entry.tabIndex, tabs.length), 0, entry.tab);
          return { ...project, tabs };
        });
      }
      // Closing the last tab removed the Project row; restore both.
      const next = [...existing];
      next.splice(Math.min(entry.projectIndex, next.length), 0, {
        ...entry.project,
        tabs: [entry.tab],
        activeTabId: entry.tab.id,
      });
      return next;
    });
    setActiveId(entry.tab.id);
    return true;
  }, [closedTabs]);

  const jumpAttention = useCallback((): boolean => {
    const [target] = orderedAttentionTargets(attention, activeId);
    if (!target) return false;
    setActiveId(target);
    if (overviewOpen) router.replace('/workspace', { scroll: false });
    return true;
  }, [activeId, attention, overviewOpen, router]);

  const focusSession = useCallback((): boolean => {
    sessionPaneRef.current?.focus();
    return document.activeElement === sessionPaneRef.current;
  }, []);

  const focusActiveChip = useCallback((): boolean => {
    const chip =
      document.querySelector<HTMLElement>(
        `[data-tab-id="${CSS.escape(activeId)}"] [data-tab-chrome]`
      ) ??
      Array.from(
        document.querySelectorAll<HTMLElement>('[data-tab-chrome]')
      ).find(element => !element.closest('[inert]')) ??
      null;
    chip?.focus();
    return chip !== null && document.activeElement === chip;
  }, [activeId]);

  const fixedActions = useMemo<FixedWorkspaceShortcutActions>(
    () => ({
      selectIndex: selectProject,
      selectTabOrdinal,
      cycle: cycleTab,
      moveTab,
      moveProject,
      focusTerminal: focusSession,
      toggleFocus: () => {
        if (sessionPaneRef.current?.contains(document.activeElement)) {
          return focusActiveChip();
        }
        return focusSession();
      },
    }),
    [
      cycleTab,
      focusActiveChip,
      focusSession,
      moveProject,
      moveTab,
      selectProject,
      selectTabOrdinal,
    ]
  );
  useFixedWorkspaceShortcuts(fixedActions);

  const commandAvailability = useMemo(() => {
    const activeTabIndex =
      activeProject?.tabs.findIndex(tab => tab.id === activeId) ?? -1;
    const activeProjectIndex = projects.findIndex(
      project => project.dir === activeProject?.dir
    );
    return deriveWorkspaceCommandAvailability({
      activeProjectName: activeProject?.name ?? null,
      hasActiveTab: activeTab !== null,
      canToggleSplit: false,
      canClose: activeTab !== null,
      canMoveTabLeft: activeTabIndex > 0,
      canMoveTabRight:
        activeTabIndex >= 0 &&
        activeTabIndex < (activeProject?.tabs.length ?? 0) - 1,
      canMoveProjectLeft: activeProjectIndex > 0,
      canMoveProjectRight:
        activeProjectIndex >= 0 && activeProjectIndex < projects.length - 1,
      hasAttentionTarget: Object.values(attention).some(signal =>
        attentionNeedsOperator(signal)
      ),
      closedSessionCount: closedTabs.length,
    });
  }, [activeId, activeProject, activeTab, attention, closedTabs, projects]);

  useEffect(() => {
    publishWorkspaceCommandAvailability(commandAvailability);
    return () =>
      publishWorkspaceCommandAvailability(EMPTY_WORKSPACE_COMMAND_AVAILABILITY);
  }, [commandAvailability]);

  // Palette / native-menu verbs arrive as events (the registry provider is
  // the Demo shell's command owner): move, close, reopen, jump-attention.
  useEffect(() => {
    const onMoveTab = (event: Event) => {
      const delta = (event as CustomEvent<{ delta?: 1 | -1 }>).detail?.delta;
      if (delta === 1 || delta === -1) moveTab(delta);
    };
    const onMoveProject = (event: Event) => {
      const delta = (event as CustomEvent<{ delta?: 1 | -1 }>).detail?.delta;
      if (delta === 1 || delta === -1) moveProject(delta);
    };
    const onCloseActive = () => {
      if (activeTab) requestClose(activeTab.id);
    };
    const onReopenLastClosed = () => {
      consumePendingReopenLastClosed();
      reopenLastClosed();
    };
    const onJumpAttention = () => void jumpAttention();
    window.addEventListener(MOVE_ACTIVE_TAB_EVENT, onMoveTab);
    window.addEventListener(MOVE_ACTIVE_PROJECT_EVENT, onMoveProject);
    window.addEventListener(CLOSE_ACTIVE_EVENT, onCloseActive);
    window.addEventListener(REOPEN_LAST_CLOSED_EVENT, onReopenLastClosed);
    window.addEventListener(JUMP_ATTENTION_EVENT, onJumpAttention);
    if (consumePendingReopenLastClosed()) reopenLastClosed();
    return () => {
      window.removeEventListener(MOVE_ACTIVE_TAB_EVENT, onMoveTab);
      window.removeEventListener(MOVE_ACTIVE_PROJECT_EVENT, onMoveProject);
      window.removeEventListener(CLOSE_ACTIVE_EVENT, onCloseActive);
      window.removeEventListener(REOPEN_LAST_CLOSED_EVENT, onReopenLastClosed);
      window.removeEventListener(JUMP_ATTENTION_EVENT, onJumpAttention);
    };
  }, [
    activeTab,
    jumpAttention,
    moveProject,
    moveTab,
    reopenLastClosed,
    requestClose,
  ]);

  const closeOverview = useCallback(
    () => router.replace('/workspace', { scroll: false }),
    [router]
  );

  const activeRoadmapChip = roadmapByTab[activeId];
  const visibleKeyHints = DEMO_KEY_HINTS.filter(
    hint =>
      !hint.command || commandAvailability.commands[hint.command].available
  );

  return (
    <div
      data-demo-workspace
      className="relative flex h-full flex-col"
      style={{ background: HUD.bg.void }}
    >
      <p
        key={reorderStatus.sequence}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {reorderStatus.message}
      </p>
      <div
        data-workspace-underlay
        inert={overviewOpen}
        aria-hidden={overviewOpen || undefined}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* project groups + tabs — the live D45 ribbon over fixture state */}
        <div
          data-workspace-chrome
          className="relative flex shrink-0 items-start gap-2 border-b px-3 py-2"
          style={{
            borderColor: 'rgba(80,230,255,0.15)',
            background: HUD.bg.deep,
          }}
        >
          <div className="min-w-0 flex-1">
            <TabStrip
              projects={ribbonProjects}
              activeDir={activeProject?.dir ?? null}
              pinnedTabId={null}
              summaries={summaries}
              attention={attention}
              activity={activity}
              engaged={engaged}
              delegation={delegation}
              onSelectProject={selectProject}
              onSelectTab={(_dir, tabId) => {
                if (demoShellFleetAgentById(tabId)) setActiveId(tabId);
              }}
              onCloseTab={requestClose}
              onRenameTab={renameTab}
              onRenameProject={renameProject}
              onSetProjectColor={setProjectColor}
              onReorderTab={reorderTabBeside}
              onReorderProject={reorderProjectBeside}
            />
          </div>
        </div>

        {/* middle band: context bar + stage — the live frame */}
        <div className="relative flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {activeAgent && (
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
                  title={activeTab?.cwd ?? transientProject?.dir}
                  tabIndex={0}
                  style={{ color: HUD.textMono }}
                >
                  {middleTruncatePath(
                    activeTab?.cwd ?? transientProject?.dir ?? ''
                  )}
                </span>
                {activeRoadmapChip && (
                  <span
                    title={`working on ${activeRoadmapChip.label}`}
                    className="shrink-0 rounded border px-1.5 py-px font-mono text-chrome-meta"
                    style={{
                      color: activeProject?.color ?? HUD.textMono,
                      borderColor: `${activeProject?.color ?? HUD.cyan}55`,
                      borderStyle: activeRoadmapChip.inferred
                        ? 'dashed'
                        : 'solid',
                    }}
                  >
                    {activeRoadmapChip.label}
                    {activeRoadmapChip.fraction
                      ? ` ${activeRoadmapChip.fraction}`
                      : ''}
                  </span>
                )}
                {activeInitiative && (
                  <span
                    data-active-session-initiative={activeInitiative.id}
                    title={activeInitiative.goal}
                    className="inline-flex min-w-0 shrink items-center gap-1 rounded border px-1.5 py-px font-ui text-chrome-meta"
                    style={{
                      color: HUD.textDim,
                      borderColor: HUD.divider,
                    }}
                  >
                    <Target aria-hidden className="h-3 w-3 shrink-0" />
                    <span className="truncate">{activeInitiative.name}</span>
                  </span>
                )}
                {summaries[activeId] && (
                  <span
                    className="line-clamp-2 min-w-0 flex-1 border-l pl-3 text-sm leading-5"
                    style={{
                      color: HUD.textDim,
                      borderColor: 'rgba(138,160,190,0.18)',
                    }}
                  >
                    {summaries[activeId]}
                  </span>
                )}
                <button
                  type="button"
                  aria-label="Focus active Session"
                  title="Focus active Session"
                  onClick={focusSession}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded outline-none hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-hud-cyan"
                  style={{ color: HUD.textDim }}
                >
                  <SquareTerminal className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* stage: the pane content source under the live dim/scale */}
            <div
              data-workspace-stage
              className={`relative min-h-0 flex-1 origin-center transition-[transform,opacity] duration-300 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:scale-100 motion-reduce:transition-opacity ${
                overviewOpen ? 'scale-[0.975] opacity-35' : ''
              }`}
            >
              <main
                ref={sessionPaneRef}
                tabIndex={-1}
                data-workspace-session-focus-owner
                className="h-full min-h-0 min-w-0 outline-none"
              >
                {activeAgent ? (
                  <DemoSessionPane
                    agent={activeAgent}
                    title={activeTab?.title}
                  />
                ) : (
                  <div
                    className="flex h-full items-center justify-center font-mono text-xs"
                    style={{ color: HUD.textDim }}
                  >
                    No demo Sessions open.
                  </div>
                )}
              </main>
            </div>
          </div>
        </div>

        {/* discoverability: the same key-hint footer the live shell shows */}
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

      {/* Team altitude — the real exposé over demo Projects */}
      {overviewOpen && (
        <ExposeOverlay
          projects={ribbonProjects}
          summaries={summaries}
          attention={attention}
          activity={activity}
          engaged={engaged}
          delegation={delegation}
          roadmapByTab={roadmapByTab}
          agentTypeByTab={agentTypeByTab}
          initiativeByTab={initiativeByTab}
          goalVisuals={goalVisuals}
          consumptionByTab={consumptionByTab}
          activeTabId={activeAgent?.id ?? null}
          activeProjectDir={activeProject?.dir ?? null}
          roadmapRead={demoRoadmapRead}
          onPick={(_dir, tabId) => {
            setActiveId(tabId);
            closeOverview();
          }}
          onPickProject={dir => {
            const project = projects.find(p => p.dir === dir);
            const first = project?.tabs[0];
            if (first) setActiveId(first.id);
            closeOverview();
          }}
          onClose={closeOverview}
        />
      )}

      {closeConfirm && (
        <CloseConfirm
          title={closeConfirm.title}
          goal={closeConfirm.goal}
          working
          color={closeConfirm.color}
          onClose={() => {
            const { tabId } = closeConfirm;
            setCloseConfirm(null);
            closeTab(tabId);
          }}
          onCancel={() => setCloseConfirm(null)}
        />
      )}
    </div>
  );
}
