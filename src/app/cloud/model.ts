/**
 * Cloud preview model (ENG-026 N3, previewing ENG-033).
 *
 * The one-click "push an Agent to an Exawatt-hosted plan" story, told over a
 * real Voltaic fixture Agent so the before/after is a view over the same
 * source the Demo Workspace uses — never an invented session.
 */
import {
  DEMO_BASE_AGENTS,
  DEMO_PROJECTS_BY_KEY,
  type DemoFleetAgent,
  type DemoWorkspaceProject,
} from '@exawatt/core';

export interface CloudHero {
  agent: DemoFleetAgent;
  project: DemoWorkspaceProject;
}

/**
 * The Agent the push story is told about: a live-capability, actively working
 * Claude Code Session — the kind whose laptop-lid problem Cloud solves.
 */
export function demoCloudHero(): CloudHero {
  const agent =
    DEMO_BASE_AGENTS.find(
      candidate =>
        candidate.readiness === 'live' &&
        candidate.status === 'working' &&
        candidate.source === 'claude-code' &&
        candidate.delegated.length > 0
    ) ?? DEMO_BASE_AGENTS[0];
  const project = DEMO_PROJECTS_BY_KEY.get(agent.projectKey)!;
  return { agent, project };
}
