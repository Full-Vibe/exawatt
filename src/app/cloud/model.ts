/**
 * Cloud preview model (ENG-026 N3, previewing ENG-033).
 *
 * The future managed-placement and transfer concept, shown with a real Voltaic
 * fixture Agent so the preview uses the same source as the Demo Workspace. The
 * fixture is a display example, not a promise that Session, Project, identity,
 * or tab continuity already exists.
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
 * The Agent the future-placement concept is shown with: a live-capability,
 * actively working Claude Code Session. Selection makes the preview concrete;
 * it does not claim a running Session can move today.
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
