/**
 * Coordination preview model (ENG-029 C1, executing ENG-026 N4).
 *
 * Broad strokes of the blackboard-and-bus design: the repo is the blackboard,
 * ENG-023's harness event channel is the bus, and Exawatt is the viewer —
 * never the owner. Everything here is either derived from the Voltaic Demo
 * Workspace fixtures (`@exawatt/core`) or authored designed-shape content
 * presented only under the surface's Coming soon marker.
 *
 * Vocabulary rule (ENG-029 C2, operator 2026-08-02): the coordination record
 * is an **assignment**, never a "claim" — `claim` is already this product's
 * assurance word and must not be overloaded. The operator assigns and agents
 * execute (ENG-017 S10); agent self-assignment is a gated destination, not
 * the start. A test enforces the vocabulary on this module's exported copy.
 */
import {
  DEMO_BASE_AGENTS,
  DEMO_PROJECTS_BY_KEY,
  DEMO_WORKSPACE_NOW_MS,
  type DemoFleetAgent,
  type DemoWorkspaceProject,
} from '@exawatt/core';

export interface CoordinationBoardRow {
  agent: DemoFleetAgent;
  /** Roadmap item this Agent is working, in the Project's own roadmap. */
  itemId: string;
  /** How the link was established — real ENG-017 lens vocabulary. */
  how: 'declared at launch' | 'read from branch' | 'read from title';
  minutesSinceActivity: number;
}

export interface CoordinationBoard {
  project: DemoWorkspaceProject;
  rows: CoordinationBoardRow[];
}

const LINK_LABEL: Record<
  NonNullable<DemoFleetAgent['link']>,
  CoordinationBoardRow['how']
> = {
  declared: 'declared at launch',
  branch: 'read from branch',
  title: 'read from title',
};

/**
 * One Project read as common ground: which Agent is working which roadmap
 * item, and how Exawatt knows. Derived from the fixtures' real link fields —
 * this half of the board is what the ENG-017 lens already reads today.
 */
export function demoCoordinationBoard(
  projectKey = 'dispatch-engine'
): CoordinationBoard {
  const project = DEMO_PROJECTS_BY_KEY.get(projectKey);
  if (!project) throw new Error(`unknown demo project: ${projectKey}`);
  const rows = DEMO_BASE_AGENTS.filter(
    agent =>
      agent.projectKey === projectKey &&
      agent.roadmapItemId !== null &&
      agent.link !== null
  )
    .map(agent => ({
      agent,
      itemId: agent.roadmapItemId!,
      how: LINK_LABEL[agent.link!],
      minutesSinceActivity: Math.max(
        0,
        Math.round((DEMO_WORKSPACE_NOW_MS - agent.lastActivityAtMs) / 60_000)
      ),
    }))
    .sort((a, b) => a.minutesSinceActivity - b.minutesSinceActivity);
  return { project, rows };
}

/** The three substrate parts, one card each — product nouns, not theses. */
export const SUBSTRATE = [
  {
    id: 'blackboard',
    title: 'Blackboard',
    detail:
      'Durable shared state as plain files under .exawatt/ in the Project repo, versioned in git.',
    meta: '.exawatt/ · git-versioned · ordinary file tools',
  },
  {
    id: 'bus',
    title: 'Bus',
    detail:
      'Live coordination messages over the harness event channel — bounded payloads, per-Session identity, fail-open.',
    meta: 'harness event channel · ENG-023',
  },
  {
    id: 'viewer',
    title: 'Audit',
    detail:
      'Every message between agents stays readable by the operator. Deleting Exawatt loses no project state.',
    meta: 'all traffic operator-readable',
  },
] as const;

/** The coordination levels — least chatty first, later levels gated. */
export const LADDER = [
  {
    rung: 1,
    name: 'Assignments',
    detail:
      'The operator assigns; agents execute. One record per Agent per roadmap item, read by other agents before starting.',
    state: 'designed · gated',
  },
  {
    rung: 2,
    name: 'Directed notes',
    detail: 'A bounded one-way note from one agent to another. No threads.',
    state: 'later',
  },
  {
    rung: 3,
    name: 'Queryable room',
    detail: 'Agents answer each other’s questions on request.',
    state: 'later · gated',
  },
] as const;

/**
 * A handoff record specimen (ENG-019): the file a departing Agent writes on
 * graceful quit and the next Agent reads before starting. Authored
 * designed-shape content over the fixtures' DSP-31 story.
 */
export const HANDOFF_SPECIMEN = {
  path: '.exawatt/sessions/2026-08-02-dsp-31-shadow-run/handoff.md',
  sections: [
    {
      heading: 'Done',
      lines: [
        'Shadow-bid scoring through day six; MAE table regenerated with corrected settlement data.',
      ],
    },
    {
      heading: 'Unfinished',
      lines: [
        'Days seven through ten unscored. Day seven needs the refreshed fixture first — see below.',
      ],
    },
    {
      heading: 'The next agent must know',
      lines: [
        'The day-seven market fixture predates the ORDC adder; regenerate it before scoring or the rail check fails again.',
      ],
    },
  ],
} as const;
