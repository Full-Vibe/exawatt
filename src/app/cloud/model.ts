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

/**
 * The destinations Push to cloud will offer, named before either is wired
 * (ENG-033 H3 for the Exawatt-hosted machine; the Gemini managed environment
 * is Google's Gemini API managed agents, in public preview). Each card draws
 * with the readiness grammar's dashed stroke and carries today's state as
 * product state; nothing on it operates.
 */
export interface CloudDestination {
  id: 'exawatt-hosted' | 'gemini-managed';
  name: string;
  /** What runs there and who runs it. */
  runs: string;
  /** What Push does once this destination is wired. */
  then: string;
  /** Today, as a state word. */
  state: string;
  /** The identifier the destination is pinned to, when it has one. */
  reference?: string;
}

export const CLOUD_DESTINATIONS: readonly CloudDestination[] = [
  {
    id: 'exawatt-hosted',
    name: 'Exawatt-hosted',
    runs: 'A machine Exawatt keeps on for Agents doing work.',
    then: 'This Agent continues there with this machine asleep, on the same Agent, Team and Fleet views.',
    state: 'Not active',
  },
  {
    id: 'gemini-managed',
    name: 'Gemini managed environment',
    runs: 'A Linux environment Google runs through the Gemini API, with the Antigravity agent.',
    then: "This Agent's task hands off to the Antigravity agent there, and the result lands back in this Project.",
    state: 'Not connected',
    reference: 'antigravity-preview-09-2026 · public preview',
  },
];
