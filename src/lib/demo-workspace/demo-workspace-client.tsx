'use client';

/**
 * Demo Workspace shell (ENG-027 W2) — the Agent and Team altitudes for the
 * Demo tenant, fed by the Voltaic fixtures through the same shapes the live
 * shell uses.
 *
 * - `/workspace` — one Session, readable (the pane content source).
 * - `/workspace?view=sessions` — the Team altitude: the REAL `ExposeOverlay`
 *   over fixture-derived Projects/tabs, with the roadmap rail reading the
 *   fixture roadmaps through the real parser.
 * - ⌘K session jumps land here through the same `SESSION_JUMP_EVENT` /
 *   pending-slot contract the live shell consumes.
 *
 * Nothing in this file can reach `window.electron.pty` — the Demo tenant has
 * no path to a process by construction.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { HUD } from '@/components/hud';
import { ExposeOverlay } from '@/components/workspace/expose-overlay';
import { HarnessGlyph } from '@/components/workspace/harness-icons';
import {
  StatusLight,
  statusLightStateForAgentStatus,
} from '@/components/status-light';
import {
  SESSION_JUMP_EVENT,
  MOVE_ACTIVE_PROJECT_EVENT,
  MOVE_ACTIVE_TAB_EVENT,
  consumePendingSessionJump,
} from '@/components/workspace/session-jump';
import {
  useFixedWorkspaceShortcuts,
  type FixedWorkspaceShortcutActions,
} from '@/components/workspace/use-workspace-shortcuts';
import {
  moveProjectInList,
  moveTabWithinProject,
} from '@/components/workspace/tab-ring';
import {
  deriveWorkspaceCommandAvailability,
  publishWorkspaceCommandAvailability,
  EMPTY_WORKSPACE_COMMAND_AVAILABILITY,
} from '@/components/workspace/workspace-command-availability';
import {
  demoHarness,
  demoRoadmapRead,
  demoShellActivity,
  demoShellAgents,
  demoShellAgentTypes,
  demoShellAttention,
  demoShellDelegation,
  demoShellEngaged,
  demoShellProjects,
  demoShellRoadmapByTab,
  demoShellSummaries,
} from './model';
import { DemoSessionPane } from './demo-session-pane';

/** The Session a walk-up demo opens first: the hero transcript. */
const DEFAULT_SESSION_ID = 'vg-home-onboard';

export function DemoWorkspaceClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const overviewOpen = searchParams.get('view') === 'sessions';

  const agents = useMemo(() => demoShellAgents(), []);
  const [projects, setProjects] = useState(() => demoShellProjects());
  const summaries = useMemo(() => demoShellSummaries(), []);
  const attention = useMemo(() => demoShellAttention(), []);
  const activity = useMemo(() => demoShellActivity(), []);
  const engaged = useMemo(() => demoShellEngaged(), []);
  const delegation = useMemo(() => demoShellDelegation(), []);
  const roadmapByTab = useMemo(() => demoShellRoadmapByTab(), []);
  const agentTypeByTab = useMemo(() => demoShellAgentTypes(), []);
  const sessionPaneRef = useRef<HTMLElement>(null);

  const [activeId, setActiveId] = useState<string>(() => {
    const pending = consumePendingSessionJump();
    if (pending && agents.some(agent => agent.id === pending)) return pending;
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
      if (agents.some(agent => agent.id === id)) {
        consumePendingSessionJump();
        setActiveId(id);
        if (overviewOpen) router.replace('/workspace', { scroll: false });
      }
    };
    window.addEventListener(SESSION_JUMP_EVENT, onJump);
    return () => window.removeEventListener(SESSION_JUMP_EVENT, onJump);
  }, [agents, overviewOpen, router]);

  const activeAgent =
    agents.find(agent => agent.id === activeId) ?? agents[0] ?? null;
  const activeProject = projects.find(project =>
    project.tabs.some(tab => tab.id === activeAgent?.id)
  );

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
      const tabs = projects.flatMap(project => project.tabs);
      const target = index === 8 ? tabs.at(-1) : tabs[index];
      if (!target) return false;
      setActiveId(target.id);
      if (overviewOpen) router.replace('/workspace', { scroll: false });
      return true;
    },
    [overviewOpen, projects, router]
  );

  const cycleTab = useCallback(
    (delta: 1 | -1): boolean => {
      const tabs = projects.flatMap(project => project.tabs);
      const from = tabs.findIndex(tab => tab.id === activeId);
      if (from < 0 || tabs.length < 2) return false;
      const target = tabs[(from + delta + tabs.length) % tabs.length];
      setActiveId(target.id);
      if (overviewOpen) router.replace('/workspace', { scroll: false });
      return true;
    },
    [activeId, overviewOpen, projects, router]
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

  const focusSession = useCallback((): boolean => {
    sessionPaneRef.current?.focus();
    return document.activeElement === sessionPaneRef.current;
  }, []);

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
          const selected = document.querySelector<HTMLElement>(
            '[data-demo-session][data-selected]'
          );
          selected?.focus();
          return document.activeElement === selected;
        }
        return focusSession();
      },
    }),
    [
      cycleTab,
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
      hasActiveTab: activeAgent !== null,
      canToggleSplit: false,
      canClose: false,
      canMoveTabLeft: activeTabIndex > 0,
      canMoveTabRight:
        activeTabIndex >= 0 &&
        activeTabIndex < (activeProject?.tabs.length ?? 0) - 1,
      canMoveProjectLeft: activeProjectIndex > 0,
      canMoveProjectRight:
        activeProjectIndex >= 0 && activeProjectIndex < projects.length - 1,
      hasAttentionTarget: false,
      closedSessionCount: 0,
    });
  }, [activeAgent, activeId, activeProject, projects]);

  useEffect(() => {
    publishWorkspaceCommandAvailability(commandAvailability);
    return () =>
      publishWorkspaceCommandAvailability(EMPTY_WORKSPACE_COMMAND_AVAILABILITY);
  }, [commandAvailability]);

  useEffect(() => {
    const onMoveTab = (event: Event) => {
      const delta = (event as CustomEvent<{ delta?: 1 | -1 }>).detail?.delta;
      if (delta === 1 || delta === -1) moveTab(delta);
    };
    const onMoveProject = (event: Event) => {
      const delta = (event as CustomEvent<{ delta?: 1 | -1 }>).detail?.delta;
      if (delta === 1 || delta === -1) moveProject(delta);
    };
    window.addEventListener(MOVE_ACTIVE_TAB_EVENT, onMoveTab);
    window.addEventListener(MOVE_ACTIVE_PROJECT_EVENT, onMoveProject);
    return () => {
      window.removeEventListener(MOVE_ACTIVE_TAB_EVENT, onMoveTab);
      window.removeEventListener(MOVE_ACTIVE_PROJECT_EVENT, onMoveProject);
    };
  }, [moveProject, moveTab]);

  const closeOverview = useCallback(
    () => router.replace('/workspace', { scroll: false }),
    [router]
  );

  return (
    <div
      data-demo-workspace
      className="relative flex h-full min-h-0 overflow-hidden"
      style={{ background: '#04060b' }}
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
      {/* Project & Session rail */}
      <nav
        aria-label="Demo Projects and Sessions"
        className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-white/5 py-2"
      >
        {projects.map(project => (
          <section
            key={project.dir}
            data-demo-project={project.dir}
            className="mb-2 px-2"
          >
            <div
              className="flex items-center gap-2 px-2 py-1.5"
              title={project.dir}
            >
              <span
                className="h-3 w-[3px] shrink-0 rounded-full"
                style={{ background: project.color }}
              />
              <span
                className="truncate font-sans text-xs font-semibold"
                style={{ color: HUD.text }}
              >
                {project.name}
              </span>
            </div>
            <ul>
              {project.tabs.map(tab => {
                const agent = agents.find(a => a.id === tab.id);
                if (!agent) return null;
                const selected = tab.id === activeAgent?.id;
                const light = statusLightStateForAgentStatus(agent.status);
                return (
                  <li key={tab.id}>
                    <button
                      type="button"
                      data-demo-session={tab.id}
                      data-selected={selected || undefined}
                      onClick={() => setActiveId(tab.id)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors"
                      style={{
                        background: selected
                          ? `${project.color}1f`
                          : 'transparent',
                      }}
                    >
                      <StatusLight decorative size="compact" state={light} />
                      <span style={{ color: project.color }}>
                        <HarnessGlyph harness={demoHarness(agent)} size={11} />
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-[11px]"
                        style={{ color: selected ? HUD.text : HUD.textDim }}
                      >
                        {agent.name}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>

      {/* Active Session pane — the pane content source */}
      <main
        ref={sessionPaneRef}
        tabIndex={-1}
        data-workspace-session-focus-owner
        className="min-h-0 min-w-0 flex-1 outline-none"
      >
        {activeAgent ? (
          <DemoSessionPane agent={activeAgent} />
        ) : (
          <div
            className="flex h-full items-center justify-center font-mono text-xs"
            style={{ color: HUD.textDim }}
          >
            No demo Sessions authored.
          </div>
        )}
      </main>

      {/* Team altitude — the real exposé over demo Projects */}
      {overviewOpen && (
        <ExposeOverlay
          projects={projects}
          summaries={summaries}
          attention={attention}
          activity={activity}
          engaged={engaged}
          delegation={delegation}
          roadmapByTab={roadmapByTab}
          agentTypeByTab={agentTypeByTab}
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
    </div>
  );
}
