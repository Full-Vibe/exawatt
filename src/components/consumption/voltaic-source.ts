/**
 * Demo Workspace consumption source (ENG-027 W2).
 *
 * The Demo tenant's `/consumption` reads the Voltaic corpus authored in
 * `@exawatt/core` (ENG-027 W3): real `ConsumptionSample`s and `PlanWindow`s,
 * rolled up here through the SAME `buildDemoConsumption` path the E4
 * expository week uses — one view shape, two corpora, zero demo-only rollup
 * code. Demo consumption never contributes to Personal totals because the
 * two corpora never meet: this module is only reachable from the Demo
 * tenant's gate.
 */
import {
  DEMO_PROJECTS,
  DEMO_PROJECTS_BY_KEY,
  DEMO_ROADMAP_MARKDOWN,
  demoAgentSessionId,
  demoFleetAgents,
  demoProjectRoadmap,
  demoWorkspaceConsumption,
  demoWorkspaceProjectResolver,
  type DemoFleetAgent,
  type RoadmapItemStatus,
} from '@exawatt/core';
import { demoShellNowMs } from '@/lib/demo-workspace/model';
import type {
  DemoConsumption,
  DemoProject,
  DemoRoadmapItem,
  DemoSessionSpec,
  LinkMethod,
} from './demo-source';
import { buildDemoConsumption } from './demo-source';

const ROADMAP_STATUS: Record<RoadmapItemStatus, DemoRoadmapItem['status']> = {
  now: 'active-build',
  next: 'next',
  later: 'planned',
  parked: 'planned',
  shipped: 'done',
};

/** Voltaic's roadmap items across all ten Projects, through the real parser.
 *  Milestones carry no shipped dates in the fixture markdown — `shippedAtMs`
 *  stays null (absent, never invented). */
function voltaicRoadmapItems(): DemoRoadmapItem[] {
  const items: DemoRoadmapItem[] = [];
  for (const project of DEMO_PROJECTS) {
    if (!DEMO_ROADMAP_MARKDOWN[project.key]) continue;
    const doc = demoProjectRoadmap(project.key);
    for (const item of doc.items) {
      if (!item.declaredId) continue;
      items.push({
        id: item.declaredId,
        title: item.title,
        status: ROADMAP_STATUS[item.status],
        milestones: item.milestones.map((milestone, index) => ({
          id: milestone.id ?? `m${index}`,
          title: milestone.title,
          done: milestone.done,
          shippedAtMs: null,
        })),
      });
    }
  }
  return items;
}

/** Base-tier fixture Agents as session specs — the per-session identity the
 *  attribution and outcome acts render (title, model, branch, link). */
function voltaicSessionSpecs(agents: DemoFleetAgent[]): DemoSessionSpec[] {
  return agents.map(agent => {
    const project = DEMO_PROJECTS_BY_KEY.get(agent.projectKey);
    return {
      id: demoAgentSessionId(agent),
      source: agent.source,
      title: agent.name,
      model: agent.model,
      effort: agent.effort,
      projectKey: agent.projectKey,
      cwd: project?.dir ?? agent.projectKey,
      gitBranch: agent.gitBranch,
      entrypoint: agent.source === 'codex' ? 'codex-tui' : 'cli',
      startedAtMs: agent.startedAtMs,
      lastAtMs: agent.lastActivityAtMs,
      turns: agent.turns,
      // Authored in the fixture corpus (ENG-026 N2 honesty): the count is
      // fixture truth like every other figure here, never derived at view
      // time — the copy's "measured, not surveyed" claim stays honest under
      // the surface's authored-fixture banner.
      interventions: agent.interventions,
      usage: agent.usage,
      delegated: agent.delegated.map(run => ({
        agentId: run.agentId,
        agentType: run.agentType,
        model: run.model,
        usage: run.usage,
      })),
      roadmapItemId: agent.roadmapItemId,
      link: agent.link,
    } satisfies DemoSessionSpec;
  });
}

let cached: DemoConsumption | null = null;

/** The Demo Workspace's consumption view — Voltaic Grid Systems' fourteen
 *  days, rebased onto the demo shell's clock (one "now" across the whole
 *  tenant) and cached exactly like the fixture corpus itself. */
export function voltaicConsumption(): DemoConsumption {
  if (cached) return cached;
  const nowMs = demoShellNowMs();
  const corpus = demoWorkspaceConsumption({ nowMs });
  const baseAgents = demoFleetAgents('base', { nowMs });
  const sessionLinks = new Map<string, { itemId: string; method: LinkMethod }>();
  for (const agent of baseAgents) {
    if (agent.roadmapItemId && agent.link) {
      sessionLinks.set(demoAgentSessionId(agent), {
        itemId: agent.roadmapItemId,
        method: agent.link,
      });
    }
  }
  const projects: DemoProject[] = DEMO_PROJECTS.map(project => ({
    key: project.key,
    name: project.name,
    dir: project.dir,
    color: project.color,
  }));
  cached = buildDemoConsumption({
    nowMs,
    windowLabel: 'fourteen days',
    samples: corpus.samples,
    planWindows: corpus.planWindows,
    projects,
    roadmap: voltaicRoadmapItems(),
    sessionSpecs: voltaicSessionSpecs(baseAgents),
    projectResolver: demoWorkspaceProjectResolver,
    sessionLinks,
    burn: {
      // shaped like the fixture's history cadence: Codex many-and-smaller,
      // Claude fewer-and-larger; most-recent last
      codex: [0.28, 0.41, 0.36, 0.49, 0.57, 0.52, 0.68, 0.61, 0.55, 0.7, 0.77, 0.65],
      'claude-code': [0.52, 0.66, 0.74, 0.6, 0.86, 0.71, 0.47, 0.79, 0.9, 0.67, 0.58, 0.63],
    },
    burnRates: { 'codex-primary': 8.1, 'codex-weekly': 0.78 },
    claudePlanNote:
      'Claude Code keeps no plan, quota, or rate-limit record in its local files.',
  });
  return cached;
}
