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
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  consumePendingSessionJump,
} from '@/components/workspace/session-jump';
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
  const projects = useMemo(() => demoShellProjects(), []);
  const summaries = useMemo(() => demoShellSummaries(), []);
  const attention = useMemo(() => demoShellAttention(), []);
  const activity = useMemo(() => demoShellActivity(), []);
  const engaged = useMemo(() => demoShellEngaged(), []);
  const delegation = useMemo(() => demoShellDelegation(), []);
  const roadmapByTab = useMemo(() => demoShellRoadmapByTab(), []);
  const agentTypeByTab = useMemo(() => demoShellAgentTypes(), []);

  const [activeId, setActiveId] = useState<string>(() => {
    const pending = consumePendingSessionJump();
    if (pending && agents.some(agent => agent.id === pending)) return pending;
    return agents.some(agent => agent.id === DEFAULT_SESSION_ID)
      ? DEFAULT_SESSION_ID
      : (agents[0]?.id ?? '');
  });

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
      {/* Project & Session rail */}
      <nav
        aria-label="Demo Projects and Sessions"
        className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-white/5 py-2"
      >
        {projects.map(project => (
          <section key={project.dir} className="mb-2 px-2">
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
      <main className="min-h-0 min-w-0 flex-1">
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
