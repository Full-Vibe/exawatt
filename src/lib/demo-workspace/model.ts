/**
 * Demo Workspace shell model (ENG-027 W2).
 *
 * Pure mappings from the Voltaic fixtures (`@exawatt/core` demo module) into
 * the SAME shapes the live Agent/Team shell and the ⌘K palette consume:
 * `Project`/`WorkspaceTab` for the Team altitude's exposé, `SessionRow` for
 * the palette's Sessions group, and per-session attention/delegation/summary
 * maps. Nothing here can reach a PTY — the module imports no Electron API.
 *
 * The pane content source (the seam the roadmap names): a demo Session opens
 * either an authored transcript (`DEMO_TRANSCRIPTS`) or an honest session
 * record — goal, status, blocker, team, usage — never a simulated stream and
 * never a blank pane.
 */
import {
  DEMO_PROJECTS,
  DEMO_PROJECTS_BY_KEY,
  DEMO_ROADMAP_MARKDOWN,
  DEMO_TRANSCRIPTS,
  DEMO_WORKSPACE_NOW_MS,
  demoFleetAgents,
  demoProjectRoadmap,
  type DemoFleetAgent,
  type DemoTranscriptLine,
  type DemoWorkspaceProject,
  type RoadmapDoc,
} from '@exawatt/core';
import type { Project, WorkspaceTab } from '@/components/workspace/use-workspace-state';
import type { SessionAttentionSignal } from '@/components/workspace/session-status';
import type {
  SessionRow,
  SessionRowStatus,
} from '@/components/workspace/switcher-rows';
import type { PtyHarness, SessionDelegation } from '@/types/electron';

/** One stable "now" per app load: the whole demo tenant reads one clock. */
const DEMO_SHELL_NOW_MS = Date.now();

export function demoShellNowMs(): number {
  return DEMO_SHELL_NOW_MS;
}

/** Base tier only — the hand-authored 27 Agents an operator reads up close.
 *  The scale tier belongs to the Fleet altitude via the fleet transport. */
export function demoShellAgents(): DemoFleetAgent[] {
  return demoFleetAgents('base', { nowMs: DEMO_SHELL_NOW_MS });
}

export function demoShellAgentById(id: string): DemoFleetAgent | undefined {
  return demoShellAgents().find(agent => agent.id === id);
}

export function demoProjectFor(
  agent: DemoFleetAgent
): DemoWorkspaceProject | undefined {
  return DEMO_PROJECTS_BY_KEY.get(agent.projectKey);
}

const HARNESS_BY_SOURCE: Record<DemoFleetAgent['source'], PtyHarness> = {
  'claude-code': 'claude',
  codex: 'codex',
};

export function demoHarness(agent: DemoFleetAgent): PtyHarness {
  return HARNESS_BY_SOURCE[agent.source];
}

/* ------------------------------------------------------------------ */
/* Team altitude: Project/tab shapes for the exposé                    */
/* ------------------------------------------------------------------ */

function demoTab(agent: DemoFleetAgent, project: DemoWorkspaceProject): WorkspaceTab {
  const failed = agent.status === 'error';
  return {
    id: agent.id,
    durableSessionId: agent.id,
    harness: demoHarness(agent),
    title: agent.name,
    titleKind: 'operator',
    cwd: project.dir,
    sessionId: agent.id,
    harnessSessionId: null,
    // A failed demo Session reads as failed (dimmed, fault-labeled) exactly
    // like a live one; everything else is a live, owned Session.
    resumeState: failed ? 'failed' : 'live',
    lifecycle: failed ? 'failed' : 'running',
    exitCode: failed ? 1 : null,
    roadmapItemId: agent.roadmapItemId,
    initialTask: agent.goal,
  };
}

/** The demo Workspace as the shell's `Project[]` — same grouping shape the
 *  live workspace store produces. */
export function demoShellProjects(): Project[] {
  const agents = demoShellAgents();
  return DEMO_PROJECTS.map(project => {
    const tabs = agents
      .filter(agent => agent.projectKey === project.key)
      .map(agent => demoTab(agent, project));
    return {
      dir: project.dir,
      name: project.name,
      color: project.color,
      tabs,
      activeTabId: tabs[0]?.id ?? null,
    };
  }).filter(project => project.tabs.length > 0);
}

/** tabId → authored Agent Type name (ENG-028 T1): the Demo Workspace is a
 *  source that DECLARES Types, so its Team tiles name the worker on the
 *  announced Type chip instead of showing the empty slot. */
export function demoShellAgentTypes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const agent of demoShellAgents()) {
    const type = demoProjectFor(agent)?.agentType;
    if (type) out[agent.id] = type;
  }
  return out;
}

/** durableSessionId → six-word context label (the D33 subtitle channel). */
export function demoShellSummaries(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const agent of demoShellAgents()) out[agent.id] = agent.contextLabel;
  return out;
}

export function demoShellAttention(): Record<string, SessionAttentionSignal> {
  const out: Record<string, SessionAttentionSignal> = {};
  for (const agent of demoShellAgents()) {
    if (agent.status === 'blocked' && agent.blocker) {
      out[agent.id] = { kind: 'blocked', since: agent.blocker.createdAtMs };
    } else if (agent.status === 'complete') {
      out[agent.id] = { kind: 'turn-end', since: agent.lastActivityAtMs };
    }
  }
  return out;
}

/** sessionId → actively producing output (working/reviewing). */
export function demoShellActivity(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const agent of demoShellAgents()) {
    out[agent.id] = agent.status === 'working' || agent.status === 'reviewing';
  }
  return out;
}

/** Every demo Agent has been given work — the fixtures author real goals. */
export function demoShellEngaged(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const agent of demoShellAgents()) out[agent.id] = true;
  return out;
}

export function demoShellDelegation(): Record<string, SessionDelegation> {
  const out: Record<string, SessionDelegation> = {};
  for (const agent of demoShellAgents()) {
    if (agent.delegated.length === 0) continue;
    out[agent.id] = {
      ownTurn: agent.status === 'working' ? 'generating' : 'available',
      children: agent.delegated.map(run => ({
        id: run.agentId,
        agentType: run.agentType,
        description: run.task,
        startedAt: run.startedAtMs,
      })),
    };
  }
  return out;
}

/** tabId → what that Agent is executing, from the Project's OWN roadmap. */
export function demoShellRoadmapByTab(): Record<
  string,
  { label: string; fraction: string | null; inferred: boolean }
> {
  const out: Record<
    string,
    { label: string; fraction: string | null; inferred: boolean }
  > = {};
  for (const agent of demoShellAgents()) {
    if (!agent.roadmapItemId) continue;
    const doc = demoRoadmapDoc(agent.projectKey);
    const item = doc?.items.find(i => i.declaredId === agent.roadmapItemId);
    const done = item?.milestones.filter(m => m.done).length ?? 0;
    const total = item?.milestones.length ?? 0;
    out[agent.id] = {
      label: item?.declaredId ?? agent.roadmapItemId,
      fraction: total > 0 ? `${done}/${total}` : null,
      inferred: agent.link !== 'declared',
    };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* ⌘K: SessionRow projection                                           */
/* ------------------------------------------------------------------ */

const ROW_STATUS: Record<DemoFleetAgent['status'], SessionRowStatus> = {
  error: 'fault',
  blocked: 'needs-you',
  working: 'working',
  reviewing: 'working',
  complete: 'done',
  idle: 'quiet',
};

const ROW_RANK: Record<SessionRowStatus, number> = {
  fault: 0,
  'needs-you': 1,
  working: 2,
  done: 3,
  fresh: 4,
  quiet: 5,
  exited: 6,
};

/** The palette's Sessions group for the Demo tenant — same row shape, same
 *  needs-you-first ordering the live builder produces. */
export function demoSessionRows(): SessionRow[] {
  return demoShellAgents()
    .map(agent => {
      const project = demoProjectFor(agent);
      const status = ROW_STATUS[agent.status];
      const row: SessionRow = {
        id: agent.id,
        title: agent.name,
        harness: demoHarness(agent),
        projectName: project?.name ?? agent.projectKey,
        subtitle: agent.contextLabel,
        color: project?.color ?? '#50E6FF',
        status,
        roadmapItemId: agent.roadmapItemId,
        searchValue:
          `${agent.name} ${project?.name ?? ''} ${agent.contextLabel} ${agent.roadmapItemId ?? ''}`.trim(),
      };
      const sort =
        status === 'needs-you' && agent.blocker
          ? agent.blocker.createdAtMs
          : -agent.lastActivityAtMs;
      return { row, rank: ROW_RANK[status], sort };
    })
    .sort((a, b) => a.rank - b.rank || a.sort - b.sort)
    .map(entry => entry.row);
}

/* ------------------------------------------------------------------ */
/* Pane content source                                                 */
/* ------------------------------------------------------------------ */

export type DemoPaneContent =
  | { kind: 'transcript'; lines: DemoTranscriptLine[] }
  | { kind: 'record' };

/**
 * What a demo Session's pane renders. Three hero Sessions carry authored
 * transcripts; every other Session renders its honest record — exactly what
 * a real fleet looks like for a tab you have not opened. Never a PTY, never
 * a blank pane, never a simulated stream.
 */
export function demoPaneContent(agent: DemoFleetAgent): DemoPaneContent {
  const lines = DEMO_TRANSCRIPTS[agent.id];
  if (lines && lines.length > 0) {
    // Transcript timestamps are authored against the frozen fixture clock;
    // rebase them onto the shell clock so relative times read correctly.
    const delta = DEMO_SHELL_NOW_MS - DEMO_WORKSPACE_NOW_MS;
    return {
      kind: 'transcript',
      lines: lines.map(line => ({ ...line, atMs: line.atMs + delta })),
    };
  }
  return { kind: 'record' };
}

/* ------------------------------------------------------------------ */
/* Roadmap source (the lens over fixture markdown)                     */
/* ------------------------------------------------------------------ */

export type DemoRoadmapReadResult =
  | { status: 'ok'; text: string; file: string; mtimeMs: number }
  | { status: 'none'; checked: string[] };

/** Parsed fixture roadmap, or null for a key without one (never throws). */
export function demoRoadmapDoc(projectKey: string): RoadmapDoc | null {
  if (!DEMO_ROADMAP_MARKDOWN[projectKey]) return null;
  return demoProjectRoadmap(projectKey);
}

/** `roadmap:read`-shaped source over the fixture markdown, so the SAME lens
 *  hook (`useProjectRoadmap`) renders Voltaic roadmaps through the real
 *  parser without touching the filesystem. */
export function demoRoadmapRead(projectDir: string): DemoRoadmapReadResult {
  const project = DEMO_PROJECTS.find(p => p.dir === projectDir);
  const markdown = project ? DEMO_ROADMAP_MARKDOWN[project.key] : undefined;
  if (!project || !markdown) return { status: 'none', checked: [projectDir] };
  return {
    status: 'ok',
    text: markdown,
    file: `${project.dir}/ROADMAP.md`,
    mtimeMs: DEMO_SHELL_NOW_MS,
  };
}
