/**
 * Agent Types preview model (ENG-028 T1, executing ENG-026 N5).
 *
 * Derives the Type roster this surface presents from the Voltaic Demo
 * Workspace fixtures (`@exawatt/core`) — the same fixture API the Demo
 * Workspace source consumes — so the preview is a view model over a source,
 * never a throwaway mock (ENG-026's central decision). The Type *profiles*
 * (identity, responsibilities, tools) are authored representative content:
 * the designed shape of a Type file, presented only under this surface's
 * Coming soon marker.
 *
 * Honesty boundaries carried through from the fixtures:
 * - a Type whose Voltaic Projects are non-coding desks is `preview`
 *   capability — the direction, not something Exawatt runs today;
 * - engine lists are observed from the fixture Agents' real `source`
 *   fields, never asserted.
 */
import {
  DEMO_BASE_AGENTS,
  DEMO_PROJECTS,
  type AgentSourceAdapterId,
  type DemoFleetAgent,
  type DemoReadiness,
  type DemoWorkspaceProject,
} from '@exawatt/core';

export interface AgentTypeProfile {
  /** Type name as the fixtures author it: Engineer, Researcher, … */
  name: string;
  /** SOUL-style identity line — who this worker is, not what task to do. */
  identity: string;
  /** Standing responsibilities, instruction-shaped. */
  responsibilities: readonly string[];
  /** Required tools and permissions the Type declares. */
  tools: readonly string[];
  /** Voltaic Projects fronted by this Type. */
  projects: DemoWorkspaceProject[];
  /** Base-tier Voltaic Agents currently running as this Type. */
  agents: DemoFleetAgent[];
  /** Distinct engines those Agents actually run on, from fixture truth: the
   *  Agent Source that launched each one, never the usage ledger it reports
   *  into (BUG-293). */
  engines: AgentSourceAdapterId[];
  /** Most common model+effort among this Type's Agents — the Type default. */
  defaults: { model: string; effort: string } | null;
  /**
   * `live` when the capability this Type represents is what Exawatt runs
   * today (coding); `preview` for the desks that sell the direction.
   */
  capability: DemoReadiness;
}

/** Authored profile content, keyed by the Type names the fixtures use. */
const PROFILES: Record<
  string,
  Pick<AgentTypeProfile, 'identity' | 'responsibilities' | 'tools'>
> = {
  Engineer: {
    identity:
      'You ship Voltaic’s systems. Correct first, fast second; you leave every codebase more legible than you found it.',
    responsibilities: [
      'Work roadmap items in a dedicated worktree; land through the verified path',
      'Diagnose root causes before writing fixes',
      'Keep dispatch safety rails non-negotiable',
    ],
    tools: ['files', 'git', 'shell', 'test runners'],
  },
  Researcher: {
    identity:
      'You watch the market so the dispatch team doesn’t have to. Primary sources, every finding checkable, digested to one page.',
    responsibilities: [
      'Track ISO rule changes, tariff filings, and interconnection queues',
      'Digest findings for the dispatch desk with sources attached',
    ],
    tools: ['web browsing', 'files', 'long-running watches'],
  },
  Marketer: {
    identity:
      'You tell Voltaic’s story in the customer’s words. Every claim traceable to a real fleet number.',
    responsibilities: [
      'Run enrollment campaigns and the GA launch narrative',
      'Keep case studies current with measured savings',
    ],
    tools: ['web browsing', 'files', 'drafts for human review'],
  },
  Support: {
    identity:
      'You are the first reader of every customer ticket. Triage honestly, escalate early, close the loop.',
    responsibilities: [
      'Triage tickets and route escalations with context attached',
      'Publish the daily escalation digest',
    ],
    tools: ['ticket queue', 'files', 'escalation paths'],
  },
};

function typeDefaults(
  agents: DemoFleetAgent[]
): { model: string; effort: string } | null {
  const counts = new Map<string, number>();
  for (const agent of agents) {
    if (!agent.effort) continue;
    const key = `${agent.model}\u0000${agent.effort}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )[0];
  if (!top) return null;
  const [model, effort] = top[0].split('\u0000');
  return { model, effort };
}

/**
 * The Voltaic Type roster, derived from the base-tier fleet (the hand-authored
 * 27 an operator reads up close). Ordered with the shipped capability first,
 * then by fleet size.
 */
export function demoAgentTypeRoster(): AgentTypeProfile[] {
  const names = [...new Set(DEMO_PROJECTS.map(project => project.agentType))];
  return names
    .map(name => {
      const projects = DEMO_PROJECTS.filter(
        project => project.agentType === name
      );
      const projectKeys = new Set(projects.map(project => project.key));
      const agents = DEMO_BASE_AGENTS.filter(agent =>
        projectKeys.has(agent.projectKey)
      );
      const profile = PROFILES[name];
      return {
        name,
        identity: profile?.identity ?? '',
        responsibilities: profile?.responsibilities ?? [],
        tools: profile?.tools ?? [],
        projects,
        agents,
        engines: [...new Set(agents.map(agent => agent.harness))],
        defaults: typeDefaults(agents),
        capability: projects.every(project => project.readiness === 'live')
          ? ('live' as const)
          : ('preview' as const),
      };
    })
    .sort(
      (a, b) =>
        Number(b.capability === 'live') - Number(a.capability === 'live') ||
        b.agents.length - a.agents.length ||
        a.name.localeCompare(b.name)
    );
}
