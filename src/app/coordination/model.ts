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

/** The three substrate roles — the designed architecture, one card each. */
export const SUBSTRATE = [
  {
    id: 'blackboard',
    title: 'The blackboard is your repo',
    detail:
      'Durable shared state lives under .exawatt/ in the Project repo: plain git-versioned files any agent can read with ordinary file tools.',
    meta: 'Yours, offline, no lock-in — readable by agents that have never heard of Exawatt',
  },
  {
    id: 'bus',
    title: 'The bus already exists',
    detail:
      'Live coordination traffic rides the harness event channel Exawatt already runs for delegation — bounded payloads, per-Session identity, fail-open.',
    meta: 'ENG-023’s channel, second consumer — never a second channel',
  },
  {
    id: 'viewer',
    title: 'Exawatt is the viewer, never the owner',
    detail:
      'Every message between agents is readable by the operator, at every rung. Deleting Exawatt loses no project state.',
    meta: 'Auditable is a hard requirement, not a nice-to-have',
  },
] as const;

/** The coordination ladder — least chatty first, later rungs gated. */
export const LADDER = [
  {
    rung: 1,
    name: 'Assignments',
    detail:
      'The operator assigns; agents execute. A record of which Agent works which roadmap item, read by others before starting. No conversation exists.',
    state: 'designed · gated until a collision worktrees and git do not catch',
  },
  {
    rung: 2,
    name: 'Directed notes',
    detail:
      'One agent leaves a bounded, one-way message for another — “the API contract changed, your slice is affected.” No threads.',
    state: 'later',
  },
  {
    rung: 3,
    name: 'Queryable room',
    detail:
      'Agents ask each other questions. Most capable, most prone to debate loops — climbed to only on evidence.',
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
