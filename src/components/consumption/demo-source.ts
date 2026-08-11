/**
 * Demo Mode consumption source (ENG-008 E4).
 *
 * Demo Mode is first-class forever and must exercise the SAME UI and command
 * layers through a lower data-source layer (`AGENTS.md`, `docs/product/demo-mode.md`).
 * So this file does not invent a display shape: it emits real
 * `ConsumptionSample`s and `PlanWindow`s and rolls them up with core's own
 * `rollupBy*`. Every number on `/consumption` therefore travels the exact path
 * a local parse will travel — swap the sample producer for
 * `scanConsumption()` and nothing downstream changes.
 *
 * NO FILESYSTEM, NO PROCESS, NO NETWORK. Live wiring and incremental scanning
 * are explicitly out of E4's scope.
 *
 * The figures are shaped to the real corpus measured in
 * `docs/engineering/projects/consumption-spine.md`, because a design tested
 * against tidy round numbers would mislead:
 *
 *   - cache reads dominate raw volume by 10-100x in every real session;
 *   - delegated runs are ~18-24% of Claude Code's burn, and Codex records none
 *     at all (absent, never zero);
 *   - Claude sessions are few and enormous; Codex sessions are many and smaller,
 *     so Codex wins on raw tokens while Claude wins on normalized compute;
 *   - Exawatt's OWN goal-subtitle summarizer (`claude -p`, `entrypoint: sdk-cli`)
 *     opens a fresh session id per call and is ~97% of Claude session ids but
 *     ~1.5% of Claude tokens. It is included here precisely so the surface can
 *     separate it instead of quietly booking the tool's overhead against the
 *     Projects it is measuring.
 */
import {
  isOperatorEntrypoint,
  localLogAssurance,
  rollupByProject,
  rollupByRoadmapItem,
  rollupBySession,
  rollupWorkspace,
  type ConsumptionRollup,
  type ConsumptionSample,
  type ConsumptionSourceId,
  type PlanWindow,
  type RawUsage,
} from '@exawatt/core';
import {
  capacityWindowFromPlan,
  interventionStats,
  type ConsumptionSourceView,
  type Harness,
  type InterventionRow,
  type InterventionStats,
} from './model';

export const DEMO_NOW_MS = Date.parse('2026-08-02T15:20:00.000Z');
export const DEMO_WINDOW_DAYS = 7;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const iso = (ms: number) => new Date(ms).toISOString();

/* ------------------------------------------------------------------ */
/* reference data                                                      */
/* ------------------------------------------------------------------ */

export interface DemoProject {
  key: string;
  name: string;
  dir: string;
  color: string;
}

export const DEMO_PROJECTS: DemoProject[] = [
  {
    key: 'exawatt',
    name: 'exawatt',
    dir: '~/Code/Personal/FullVibeAI/exawatt',
    color: '#50E6FF',
  },
  {
    key: 'openclaw',
    name: 'openclaw',
    dir: '~/Code/Personal/openclaw',
    color: '#8AE6A8',
  },
  {
    key: 'fullvibe-site',
    name: 'fullvibe-site',
    dir: '~/Code/Personal/fullvibe-site',
    color: '#FFC46B',
  },
  {
    key: 'churn-research',
    name: 'churn-research',
    dir: '~/Code/Work/churn-research',
    color: '#B9A6FF',
  },
];

export interface DemoMilestone {
  id: string;
  title: string;
  done: boolean;
  shippedAtMs: number | null;
}

export interface DemoRoadmapItem {
  id: string;
  title: string;
  status: 'active-build' | 'next' | 'planned' | 'done';
  milestones: DemoMilestone[];
}

export const DEMO_ROADMAP: DemoRoadmapItem[] = [
  {
    id: 'ENG-016',
    title: 'Local terminal workspace',
    status: 'active-build',
    milestones: [
      { id: 'D39', title: 'Chrome type roles', done: true, shippedAtMs: DEMO_NOW_MS - 9 * DAY },
      { id: 'D40', title: 'Status-light protocol', done: true, shippedAtMs: DEMO_NOW_MS - 4 * DAY },
      { id: 'D41', title: 'Split-pane focus ring', done: true, shippedAtMs: DEMO_NOW_MS - 30 * HOUR },
      { id: 'D42', title: 'Tab overflow reflow', done: false, shippedAtMs: null },
    ],
  },
  {
    id: 'ENG-017',
    title: 'Project roadmap lens',
    status: 'active-build',
    milestones: [
      { id: 'S8', title: 'Queue-advance motion', done: true, shippedAtMs: DEMO_NOW_MS - 7 * DAY },
      { id: 'S9', title: 'Reciprocal chip', done: true, shippedAtMs: DEMO_NOW_MS - 5 * DAY },
      { id: 'S10', title: 'Manipulable-lens play', done: false, shippedAtMs: null },
    ],
  },
  {
    id: 'ENG-008',
    title: 'Consumption and controls',
    status: 'active-build',
    milestones: [
      { id: 'E1', title: 'Capacity truth', done: true, shippedAtMs: DEMO_NOW_MS - 6 * DAY },
      { id: 'E2', title: 'Attribution', done: true, shippedAtMs: DEMO_NOW_MS - 3 * DAY },
      { id: 'E3', title: 'Normalization', done: true, shippedAtMs: DEMO_NOW_MS - 40 * HOUR },
      { id: 'E4', title: 'Expository surface', done: false, shippedAtMs: null },
    ],
  },
  {
    id: 'ENG-022',
    title: 'Agent development-loop hardening',
    status: 'done',
    milestones: [
      { id: 'W1', title: 'worktree:setup bootstrap', done: true, shippedAtMs: DEMO_NOW_MS - 6 * DAY },
      { id: 'W2', title: 'node-pty rebuild guard', done: true, shippedAtMs: DEMO_NOW_MS - 5 * DAY },
    ],
  },
];

/** How a Session was tied to a roadmap item. Declared beats inferred. */
export type LinkMethod = 'declared' | 'branch' | 'title';

export const LINK_LABEL: Record<LinkMethod, string> = {
  declared: 'declared at launch',
  branch: 'inferred from the branch name',
  title: 'inferred from the session title',
};

/* ------------------------------------------------------------------ */
/* sessions                                                            */
/* ------------------------------------------------------------------ */

interface DemoUsage {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  /** Generated tokens, INCLUSIVE of reasoning (core `RawUsage` semantics). */
  output: number;
  /** Subset of `output`. 0 where the source does not report it separately. */
  reasoning?: number;
  webSearches?: number;
}

interface DemoDelegatedRun {
  agentId: string;
  agentType: string;
  model: string;
  usage: DemoUsage;
}

export interface DemoSessionSpec {
  id: string;
  source: ConsumptionSourceId;
  title: string;
  model: string;
  effort: string | null;
  /** null when the launch directory resolves to no known Project. */
  projectKey: string | null;
  cwd: string;
  gitBranch: string | null;
  entrypoint: string;
  startedAtMs: number;
  lastAtMs: number;
  /** Assistant turns this Session recorded. Drives how many samples it emits. */
  turns: number;
  /**
   * Operator messages AFTER launch (ENG-026 N2's intervention rate). Counted
   * live from the `UserPromptSubmit` events the ENG-023 harness channel
   * already receives (Claude Code) and the user turns Codex rollouts already
   * record. Required, like `delegation`: a construction site must state its
   * value rather than silently read as autonomous. `null` means the source
   * kept no record for this Session (E5 live identities without a count) —
   * unrecorded, never zero, and excluded from the intervention-rate
   * denominator. Authored corpora always state a number.
   */
  interventions: number | null;
  usage: DemoUsage;
  /**
   * Peak context footprint the run reached, in tokens (ENG-008 per-run
   * context pressure). Codex rollouts carry this truth alongside
   * `model_context_window`; Claude Code records none, so claude-code specs
   * leave it absent — unreported, never zero.
   */
  contextPeakTokens?: number;
  /** Context compactions observed during the run. Absent = not recorded. */
  compactions?: number;
  delegated: DemoDelegatedRun[];
  roadmapItemId: string | null;
  link: LinkMethod | null;
}

const EXA = '~/Code/Personal/FullVibeAI/exawatt';

export const DEMO_SESSIONS: DemoSessionSpec[] = [
  /* ---- Claude Code: few sessions, enormous, heavy delegation ---- */
  {
    id: '9f2c1a44-3e51-4c0b-9a77-51de0b2c88a1',
    source: 'claude-code',
    title: 'D40 status-light percolation',
    model: 'claude-opus-5',
    effort: 'high',
    projectKey: 'exawatt',
    cwd: `${EXA}-status-light`,
    gitBranch: 'agent/status-light-protocol',
    entrypoint: 'cli',
    startedAtMs: DEMO_NOW_MS - 4 * DAY - 5 * HOUR,
    lastAtMs: DEMO_NOW_MS - 4 * DAY,
    turns: 14,
    interventions: 3,
    usage: {
      input: 412_000,
      cacheRead: 31_460_000,
      cacheWrite: 3_180_000,
      output: 486_000,
      webSearches: 6,
    },
    delegated: [
      {
        agentId: 'agent-7d21',
        agentType: 'Explore',
        model: 'claude-sonnet-5',
        usage: { input: 148_000, cacheRead: 4_910_000, cacheWrite: 520_000, output: 196_000 },
      },
      {
        agentId: 'agent-91be',
        agentType: 'general-purpose',
        model: 'claude-opus-5',
        usage: { input: 121_000, cacheRead: 3_780_000, cacheWrite: 410_000, output: 164_000 },
      },
    ],
    roadmapItemId: 'ENG-016',
    link: 'declared',
  },
  {
    id: 'c48b7d10-8a2f-4f61-b0c3-2ad9e77f4410',
    source: 'claude-code',
    title: 'S10 manipulable-lens prototypes',
    model: 'claude-opus-5',
    effort: 'high',
    projectKey: 'exawatt',
    cwd: `${EXA}-roadmap-lab`,
    gitBranch: 'agent/roadmap-lab',
    entrypoint: 'cli',
    startedAtMs: DEMO_NOW_MS - 2 * DAY - 7 * HOUR,
    lastAtMs: DEMO_NOW_MS - 2 * DAY,
    turns: 11,
    // design iteration is steering-heavy by nature
    interventions: 4,
    usage: {
      input: 268_000,
      cacheRead: 19_820_000,
      cacheWrite: 2_040_000,
      output: 331_000,
    },
    delegated: [
      {
        agentId: 'agent-3ac0',
        agentType: 'Explore',
        model: 'claude-sonnet-5',
        usage: { input: 62_000, cacheRead: 2_240_000, cacheWrite: 214_000, output: 84_000 },
      },
      {
        agentId: 'agent-3ac1',
        agentType: 'general-purpose',
        model: 'claude-opus-5',
        usage: { input: 50_000, cacheRead: 1_600_000, cacheWrite: 200_000, output: 268_000 },
      },
    ],
    roadmapItemId: 'ENG-017',
    link: 'declared',
  },
  {
    id: 'a71e4402-55dd-4a29-9c8e-cc10f7b31d20',
    source: 'claude-code',
    title: 'split-pane focus ring',
    model: 'claude-opus-5',
    effort: 'high',
    projectKey: 'exawatt',
    cwd: `${EXA}-focus-ring`,
    gitBranch: 'agent/focus-ring',
    entrypoint: 'cli',
    startedAtMs: DEMO_NOW_MS - 34 * HOUR,
    lastAtMs: DEMO_NOW_MS - 29 * HOUR,
    turns: 9,
    interventions: 2,
    usage: {
      input: 151_000,
      cacheRead: 13_740_000,
      cacheWrite: 1_290_000,
      output: 214_000,
      webSearches: 2,
    },
    // the record exists and nothing was delegated — a real, recorded zero
    delegated: [],
    roadmapItemId: 'ENG-016',
    link: 'title',
  },
  {
    // Live right now, and deliberately delegation-heavy: this is the case that
    // breaks a naive ledger. The tab reads as ONE agent; four children burned
    // more than a third of what the Session cost.
    id: 'b3d81f60-9c22-4a5e-8f74-6d0e1b2c3a49',
    source: 'claude-code',
    title: 'E4 expository consumption surface',
    model: 'claude-opus-5',
    effort: 'high',
    projectKey: 'exawatt',
    cwd: `${EXA}-consumption-e4`,
    gitBranch: 'agent/consumption-e4',
    entrypoint: 'cli',
    startedAtMs: DEMO_NOW_MS - 4 * HOUR - 20 * MIN,
    lastAtMs: DEMO_NOW_MS - 6 * MIN,
    turns: 18,
    interventions: 5,
    usage: {
      input: 486_000,
      cacheRead: 38_900_000,
      cacheWrite: 3_640_000,
      output: 604_000,
      webSearches: 4,
    },
    delegated: [
      {
        agentId: 'agent-c410',
        agentType: 'Explore',
        model: 'claude-sonnet-5',
        usage: { input: 184_000, cacheRead: 6_120_000, cacheWrite: 640_000, output: 231_000 },
      },
      {
        agentId: 'agent-c411',
        agentType: 'Explore',
        model: 'claude-sonnet-5',
        usage: { input: 141_000, cacheRead: 4_880_000, cacheWrite: 502_000, output: 178_000 },
      },
      {
        agentId: 'agent-c4a2',
        agentType: 'general-purpose',
        model: 'claude-opus-5',
        usage: { input: 96_000, cacheRead: 3_240_000, cacheWrite: 388_000, output: 142_000 },
      },
      {
        agentId: 'agent-c4b7',
        agentType: 'fork',
        model: 'claude-opus-5',
        usage: { input: 74_000, cacheRead: 2_410_000, cacheWrite: 291_000, output: 108_000 },
      },
    ],
    roadmapItemId: 'ENG-008',
    link: 'declared',
  },
  {
    id: 'f0c3b5a1-77e2-4b8d-9f01-2c3d4e5f6a7b',
    source: 'claude-code',
    title: 'pricing page copy pass',
    model: 'claude-sonnet-5',
    effort: 'medium',
    projectKey: 'fullvibe-site',
    cwd: '~/Code/Personal/fullvibe-site',
    gitBranch: 'main',
    entrypoint: 'cli',
    startedAtMs: DEMO_NOW_MS - 46 * HOUR,
    lastAtMs: DEMO_NOW_MS - 44 * HOUR,
    turns: 6,
    // copy work reads as babysitting: four touches on six turns
    interventions: 4,
    usage: {
      input: 44_100,
      cacheRead: 2_180_000,
      cacheWrite: 262_000,
      output: 61_800,
      webSearches: 11,
    },
    delegated: [
      {
        agentId: 'agent-55d1',
        agentType: 'Explore',
        model: 'claude-sonnet-5',
        usage: { input: 9_400, cacheRead: 402_000, cacheWrite: 51_000, output: 14_600 },
      },
    ],
    roadmapItemId: null,
    link: null,
  },
  {
    // Big, real, and attributed to nothing. Most weeks contain one of these,
    // and a coverage figure that never dips is a coverage figure nobody checks.
    id: 'd41f7c02-6b93-4e18-9a5d-0c7b8e9f1a23',
    source: 'claude-code',
    title: 'context-window pressure spike',
    model: 'claude-opus-5',
    effort: 'high',
    projectKey: 'exawatt',
    cwd: `${EXA}-scratch`,
    gitBranch: 'agent/scratch',
    entrypoint: 'cli',
    startedAtMs: DEMO_NOW_MS - 3 * DAY - 9 * HOUR,
    lastAtMs: DEMO_NOW_MS - 3 * DAY - 1 * HOUR,
    turns: 12,
    // the week's intervention outlier: a fault-shaped run that kept needing
    // a human to cross the same gap
    interventions: 6,
    usage: {
      input: 302_000,
      cacheRead: 26_400_000,
      cacheWrite: 2_410_000,
      output: 388_000,
      webSearches: 1,
    },
    delegated: [
      {
        agentId: 'agent-8e02',
        agentType: 'Explore',
        model: 'claude-sonnet-5',
        usage: { input: 88_000, cacheRead: 3_010_000, cacheWrite: 312_000, output: 119_000 },
      },
      {
        agentId: 'agent-8e11',
        agentType: 'general-purpose',
        model: 'claude-opus-5',
        usage: { input: 50_000, cacheRead: 1_600_000, cacheWrite: 200_000, output: 268_000 },
      },
    ],
    roadmapItemId: null,
    link: null,
  },
  {
    // Deliberately unresolvable: the launch directory is outside every known
    // Project root, so Exawatt refuses to guess which Project it belongs to.
    id: '6b02f9ae-1c3d-4e5f-8a90-b1c2d3e4f506',
    source: 'claude-code',
    title: 'scratch shell exploration',
    model: 'claude-sonnet-5',
    effort: 'low',
    projectKey: null,
    cwd: '/private/tmp/scratch-9f2',
    gitBranch: null,
    entrypoint: 'cli',
    startedAtMs: DEMO_NOW_MS - 52 * HOUR,
    lastAtMs: DEMO_NOW_MS - 51 * HOUR,
    turns: 4,
    interventions: 3,
    usage: {
      input: 18_400,
      cacheRead: 812_000,
      cacheWrite: 96_000,
      output: 22_600,
      webSearches: 3,
    },
    delegated: [],
    roadmapItemId: null,
    link: null,
  },

  /* ---- Codex: many sessions, smaller each, no delegation record ---- */
  {
    id: '01958a3e-6c44-7bb1-9f2d-71a0b4c9d2e6',
    source: 'codex',
    title: 'worktree bootstrap + node-pty rebuild',
    model: 'gpt-5.3-codex',
    effort: 'medium',
    projectKey: 'exawatt',
    cwd: `${EXA}-worktree`,
    gitBranch: null,
    entrypoint: 'codex-tui',
    startedAtMs: DEMO_NOW_MS - 5 * DAY - 3 * HOUR,
    lastAtMs: DEMO_NOW_MS - 5 * DAY,
    turns: 12,
    interventions: 2,
    contextPeakTokens: 212_000,
    usage: {
      input: 184_000,
      cacheRead: 8_910_000,
      cacheWrite: 940_000,
      output: 518_000,
      reasoning: 396_000,
    },
    delegated: [],
    roadmapItemId: 'ENG-022',
    link: 'branch',
  },
  {
    id: '01958f71-2b09-7a4c-8d13-5e6f0a1b2c3d',
    source: 'codex',
    title: 'node-pty rebuild guard',
    model: 'gpt-5.3-codex',
    effort: 'medium',
    projectKey: 'exawatt',
    cwd: `${EXA}-worktree`,
    gitBranch: null,
    entrypoint: 'codex-tui',
    startedAtMs: DEMO_NOW_MS - 5 * DAY + 2 * HOUR,
    lastAtMs: DEMO_NOW_MS - 5 * DAY + 5 * HOUR,
    turns: 9,
    // launched with one instruction, landed without a touch
    interventions: 0,
    contextPeakTokens: 121_000,
    usage: {
      input: 96_400,
      cacheRead: 4_260_000,
      cacheWrite: 512_000,
      output: 259_500,
      reasoning: 188_000,
    },
    delegated: [],
    roadmapItemId: 'ENG-022',
    link: 'branch',
  },
  {
    id: '0195a0c2-9911-7d3e-b2a1-0f4c8e7d6b5a',
    source: 'codex',
    title: 'gateway reconnect backoff',
    model: 'gpt-5.3-codex',
    effort: 'medium',
    projectKey: 'openclaw',
    cwd: '~/Code/Personal/openclaw',
    gitBranch: null,
    entrypoint: 'codex-tui',
    startedAtMs: DEMO_NOW_MS - 30 * HOUR,
    lastAtMs: DEMO_NOW_MS - 26 * HOUR,
    turns: 8,
    interventions: 2,
    contextPeakTokens: 98_000,
    usage: {
      input: 74_800,
      cacheRead: 3_120_000,
      cacheWrite: 388_000,
      output: 195_200,
      reasoning: 141_000,
    },
    delegated: [],
    roadmapItemId: null,
    link: null,
  },
  {
    id: '0195b114-4c7a-7e02-a8b9-6d5c4b3a2e10',
    source: 'codex',
    title: 'consumption adapters over both harnesses',
    model: 'gpt-5.3-codex',
    effort: 'high',
    projectKey: 'exawatt',
    cwd: `${EXA}-consumption`,
    gitBranch: null,
    entrypoint: 'codex-tui',
    startedAtMs: DEMO_NOW_MS - 6 * DAY - 2 * HOUR,
    lastAtMs: DEMO_NOW_MS - 6 * DAY + 4 * HOUR,
    turns: 16,
    interventions: 3,
    contextPeakTokens: 248_000,
    compactions: 1,
    usage: {
      input: 214_000,
      cacheRead: 11_480_000,
      cacheWrite: 1_120_000,
      output: 612_000,
      reasoning: 441_000,
    },
    delegated: [],
    roadmapItemId: 'ENG-008',
    link: 'declared',
  },
  {
    id: '0195b7d5-2e18-7c44-9a03-8b7c6d5e4f31',
    source: 'codex',
    title: 'codex plan-window parser',
    model: 'gpt-5.3-codex',
    effort: 'high',
    projectKey: 'exawatt',
    cwd: `${EXA}-consumption`,
    gitBranch: null,
    entrypoint: 'codex-tui',
    startedAtMs: DEMO_NOW_MS - 3 * DAY - 6 * HOUR,
    lastAtMs: DEMO_NOW_MS - 3 * DAY,
    turns: 13,
    interventions: 2,
    contextPeakTokens: 187_000,
    usage: {
      input: 132_000,
      cacheRead: 6_940_000,
      cacheWrite: 704_000,
      output: 388_000,
      reasoning: 271_000,
    },
    delegated: [],
    roadmapItemId: 'ENG-008',
    link: 'declared',
  },
  {
    id: '0195c221-6a7b-7f10-b3d2-1e0f9a8b7c65',
    source: 'codex',
    title: 'roadmap rail untriaged count',
    model: 'gpt-5.3-codex-mini',
    effort: 'low',
    projectKey: 'exawatt',
    cwd: EXA,
    gitBranch: null,
    entrypoint: 'codex-tui',
    startedAtMs: DEMO_NOW_MS - 44 * HOUR,
    lastAtMs: DEMO_NOW_MS - 42 * HOUR,
    turns: 7,
    interventions: 0,
    contextPeakTokens: 58_000,
    usage: {
      input: 41_200,
      cacheRead: 1_840_000,
      cacheWrite: 208_000,
      output: 121_000,
      reasoning: 84_000,
    },
    delegated: [],
    roadmapItemId: 'ENG-017',
    link: 'branch',
  },
  {
    id: '0195c9f0-8b13-7a29-8e41-2f3a4b5c6d78',
    source: 'codex',
    title: 'spatial return address',
    model: 'gpt-5.3-codex',
    effort: 'medium',
    projectKey: 'exawatt',
    cwd: `${EXA}-spatial`,
    gitBranch: null,
    entrypoint: 'codex-tui',
    startedAtMs: DEMO_NOW_MS - 20 * HOUR,
    lastAtMs: DEMO_NOW_MS - 17 * HOUR,
    turns: 10,
    interventions: 2,
    contextPeakTokens: 104_000,
    usage: {
      input: 88_600,
      cacheRead: 4_020_000,
      cacheWrite: 441_000,
      output: 244_000,
      reasoning: 173_000,
    },
    delegated: [],
    roadmapItemId: null,
    link: null,
  },
  {
    id: '0195d3aa-1c44-7b83-9d20-3a4b5c6d7e89',
    source: 'codex',
    title: 'delegation hook latency gate',
    model: 'gpt-5.3-codex',
    effort: 'high',
    projectKey: 'exawatt',
    cwd: `${EXA}-delegation`,
    gitBranch: null,
    entrypoint: 'codex-tui',
    startedAtMs: DEMO_NOW_MS - 9 * HOUR,
    lastAtMs: DEMO_NOW_MS - 2 * HOUR,
    turns: 15,
    interventions: 4,
    contextPeakTokens: 226_000,
    usage: {
      input: 168_000,
      cacheRead: 8_120_000,
      cacheWrite: 812_000,
      output: 466_000,
      reasoning: 331_000,
    },
    delegated: [],
    roadmapItemId: 'ENG-016',
    link: 'declared',
  },
  {
    id: '0195da61-4f02-7d18-a7b6-4c5d6e7f8a90',
    source: 'codex',
    title: 'release notarize polling fix',
    model: 'gpt-5.3-codex',
    effort: 'medium',
    projectKey: 'exawatt',
    cwd: EXA,
    gitBranch: null,
    entrypoint: 'codex-tui',
    startedAtMs: DEMO_NOW_MS - 6 * HOUR,
    lastAtMs: DEMO_NOW_MS - 40 * MIN,
    turns: 8,
    interventions: 0,
    contextPeakTokens: 84_000,
    usage: {
      input: 61_200,
      cacheRead: 2_940_000,
      cacheWrite: 340_000,
      output: 170_900,
      reasoning: 122_000,
    },
    delegated: [],
    roadmapItemId: null,
    link: null,
  },
];

/**
 * Exawatt's OWN goal-subtitle summarizer. `claude -p --model haiku` per Session,
 * a fresh provider session id per call. Many ids, almost no tokens — exactly the
 * shape measured on the real corpus, and the reason `entrypoint` exists.
 */
const OVERHEAD_SESSIONS = 38;

function overheadSpecs(): DemoSessionSpec[] {
  return Array.from({ length: OVERHEAD_SESSIONS }, (_, i) => {
    const at = DEMO_NOW_MS - Math.round(((i + 1) / OVERHEAD_SESSIONS) * 6 * DAY);
    return {
      id: `sdk-${(0x4a10 + i * 7).toString(16)}-summarizer`,
      source: 'claude-code' as const,
      title: 'goal subtitle',
      model: 'claude-haiku-5',
      effort: null,
      projectKey: 'exawatt',
      cwd: EXA,
      gitBranch: null,
      entrypoint: 'sdk-cli',
      startedAtMs: at,
      lastAtMs: at + 12_000,
      turns: 1,
      interventions: 0,
      usage: {
        input: 5_200 + (i % 5) * 340,
        cacheRead: 46_000 + (i % 7) * 2_200,
        cacheWrite: 3_000,
        output: 640 + (i % 3) * 90,
      },
      delegated: [],
      roadmapItemId: null,
      link: null,
    };
  });
}

export const DEMO_ALL_SESSIONS: DemoSessionSpec[] = [
  ...DEMO_SESSIONS,
  ...overheadSpecs(),
];

/* ------------------------------------------------------------------ */
/* sample emission                                                     */
/* ------------------------------------------------------------------ */

/** Deterministic uneven split that sums EXACTLY to `total`. */
function distribute(total: number, parts: number, seed: number): number[] {
  if (parts <= 1) return [total];
  const weights = Array.from(
    { length: parts },
    (_, i) => 0.55 + Math.abs(Math.sin((i + 1) * seed))
  );
  const sum = weights.reduce((a, b) => a + b, 0);
  const out: number[] = [];
  let acc = 0;
  let given = 0;
  for (let i = 0; i < parts; i += 1) {
    acc += weights[i];
    const upto = Math.round((acc / sum) * total);
    out.push(upto - given);
    given = upto;
  }
  return out;
}

function emitSamples(
  spec: DemoSessionSpec,
  usage: DemoUsage,
  turns: number,
  keyPrefix: string,
  model: string,
  delegation: ConsumptionSample['delegation']
): ConsumptionSample[] {
  const seed = 1.3 + (keyPrefix.length % 5) * 0.31;
  const input = distribute(usage.input, turns, seed);
  const cacheRead = distribute(usage.cacheRead, turns, seed + 0.4);
  const cacheWrite = distribute(usage.cacheWrite, turns, seed + 0.8);
  const output = distribute(usage.output, turns, seed + 1.2);
  const reasoning = distribute(usage.reasoning ?? 0, turns, seed + 1.6);
  const webSearches = distribute(usage.webSearches ?? 0, turns, seed + 2.0);
  const span = Math.max(1, spec.lastAtMs - spec.startedAtMs);

  return Array.from({ length: turns }, (_, i) => {
    const at = spec.startedAtMs + Math.round(((i + 1) / turns) * span);
    const raw: RawUsage = {
      inputTokens: input[i],
      cacheReadTokens: cacheRead[i],
      cacheWriteTokens: cacheWrite[i],
      outputTokens: output[i],
      reasoningTokens: Math.min(reasoning[i], output[i]),
      webSearches: webSearches[i],
      webFetches: 0,
    };
    return {
      at: iso(at),
      source: spec.source,
      model,
      effort: spec.effort,
      providerSessionId: spec.id,
      cwd: spec.cwd,
      gitBranch: spec.source === 'claude-code' ? spec.gitBranch : null,
      usage: raw,
      assurance: localLogAssurance(spec.source),
      idempotencyKey: `${keyPrefix}:${i}`,
      contextWindow: spec.source === 'codex' ? 272_000 : null,
      sourceFile: null,
      delegation,
      entrypoint: spec.entrypoint,
    } satisfies ConsumptionSample;
  });
}

export function demoSamples(): ConsumptionSample[] {
  const out: ConsumptionSample[] = [];
  for (const spec of DEMO_ALL_SESSIONS) {
    out.push(
      ...emitSamples(spec, spec.usage, spec.turns, `${spec.id}:own`, spec.model, null)
    );
    for (const run of spec.delegated) {
      out.push(
        ...emitSamples(
          spec,
          run.usage,
          Math.max(2, Math.round(spec.turns / 3)),
          `${spec.id}:${run.agentId}`,
          run.model,
          {
            agentId: run.agentId,
            parentSessionId: spec.id,
            agentType: run.agentType,
            spawnDepth: 1,
            skill: null,
            background: false,
            parentAgentId: null,
          }
        )
      );
    }
  }
  return out;
}

/**
 * Codex `rate_limits`, as the harness writes them. Claude Code emits NOTHING
 * here — a structured key search across the whole `~/.claude` tree returns zero
 * matches — so its absence is represented by having no record at all, never by
 * a zero-valued one.
 */
export function demoPlanWindows(): PlanWindow[] {
  const observedAt = iso(DEMO_NOW_MS - 90_000);
  return [
    {
      source: 'codex',
      limitId: 'codex-primary',
      limitName: '5-hour window',
      scope: 'primary',
      usedPercent: 68,
      windowMinutes: 300,
      resetsAt: iso(DEMO_NOW_MS + 1 * HOUR + 48 * MIN),
      planType: 'pro',
      observedAt,
      providerSessionId: '0195da61-4f02-7d18-a7b6-4c5d6e7f8a90',
    },
    {
      source: 'codex',
      limitId: 'codex-weekly',
      limitName: 'Weekly window',
      scope: 'secondary',
      usedPercent: 84,
      windowMinutes: 10_080,
      resetsAt: iso(DEMO_NOW_MS + 2 * DAY + 6 * HOUR),
      planType: 'pro',
      observedAt,
      providerSessionId: '0195da61-4f02-7d18-a7b6-4c5d6e7f8a90',
    },
  ];
}

/* ------------------------------------------------------------------ */
/* rollups — through core, never around it                             */
/* ------------------------------------------------------------------ */

const CWD_TO_PROJECT = new Map<string, DemoProject>();
for (const spec of DEMO_ALL_SESSIONS) {
  const project = DEMO_PROJECTS.find(p => p.key === spec.projectKey);
  if (project) CWD_TO_PROJECT.set(spec.cwd, project);
}

/**
 * Worktree-aware Project resolution. `~/…/exawatt-status-light` is a worktree of
 * the `exawatt` Project, not a Project of its own — the naive directory
 * resolver would shatter one Project into nine. A cwd that matches nothing
 * resolves to null and the sample stays visibly unattributed.
 */
const demoProjectResolver = (cwd: string) => {
  const direct = CWD_TO_PROJECT.get(cwd);
  return direct ? { id: direct.key, label: direct.name } : null;
};

const SESSION_LINKS = new Map<string, { itemId: string; method: LinkMethod }>();
for (const spec of DEMO_SESSIONS) {
  if (spec.roadmapItemId && spec.link) {
    SESSION_LINKS.set(spec.id, { itemId: spec.roadmapItemId, method: spec.link });
  }
}

export interface DemoProjectRollup {
  project: DemoProject;
  rollup: ConsumptionRollup | null;
}

export interface DemoSessionRollup {
  spec: DemoSessionSpec;
  rollup: ConsumptionRollup;
}

export interface DemoRoadmapRollup {
  item: DemoRoadmapItem;
  rollup: ConsumptionRollup | null;
  sessions: DemoSessionRollup[];
  declaredWeighted: number;
  inferredWeighted: number;
}

export interface DemoConsumption {
  nowMs: number;
  /** The corpus's measurement window, as prose ("seven days", "fourteen
   *  days"). Copy that names the window MUST read this — the E4 week and
   *  the Voltaic fortnight share every component (ENG-027 W2). */
  windowLabel: string;
  samples: ConsumptionSample[];
  planWindows: PlanWindow[];
  /** Operator work only. Exawatt's own harness calls are separated, not hidden. */
  workspace: ConsumptionRollup;
  projects: DemoProjectRollup[];
  /** Operator sessions with no resolvable Project. */
  unresolvedSessions: DemoSessionRollup[];
  sessionsById: Map<string, ConsumptionRollup>;
  roadmap: DemoRoadmapRollup[];
  unattributedWeighted: number;
  unattributedSessions: DemoSessionRollup[];
  declaredWeighted: number;
  inferredWeighted: number;
  /** Exawatt's own machine-invoked harness usage. Shown, never folded in. */
  overhead: { sessionCount: number; rollup: ConsumptionRollup | null };
  /**
   * The corpus's own cwd → Project resolution (worktree-aware), carried on
   * the view so downstream derivations (the outside-fleet-record grid rows)
   * attribute a launch directory exactly the way the Project rollups did —
   * one resolver per corpus, never a second exact-match guess.
   */
  resolveProject: (cwd: string) => { id: string; label: string } | null;
  sources: ConsumptionSourceView[];
  /**
   * ENG-026 N2 — the intervention record for operator Sessions. Overhead is
   * excluded by construction: a machine-invoked call has no operator to
   * intervene, and counting it would flatter the rate.
   */
  interventions: {
    rows: InterventionRow[];
    total: InterventionStats;
    bySource: Record<Harness, InterventionStats>;
  };
}

/**
 * Everything a consumption view needs, decoupled from WHICH demo corpus
 * feeds it (ENG-027 W2): the E4 expository week below and the Demo
 * Workspace's Voltaic corpus (`voltaic-source.ts`) build the same shape
 * through the same core rollups.
 */
export interface DemoConsumptionInputs {
  nowMs: number;
  /** See `DemoConsumption.windowLabel`. */
  windowLabel: string;
  samples: ConsumptionSample[];
  planWindows: PlanWindow[];
  projects: DemoProject[];
  roadmap: DemoRoadmapItem[];
  sessionSpecs: DemoSessionSpec[];
  projectResolver: (cwd: string) => { id: string; label: string } | null;
  sessionLinks: Map<string, { itemId: string; method: LinkMethod }>;
  /** sparkline burn per source, most-recent last */
  burn: Record<ConsumptionSourceId, number[]>;
  /** per plan-window limitId: percent consumed per hour */
  burnRates: Record<string, number>;
  claudePlanNote: string;
}

export function buildDemoConsumption(
  inputs: DemoConsumptionInputs
): DemoConsumption {
  const {
    nowMs,
    samples,
    planWindows,
    projects: projectList,
    roadmap: roadmapItems,
    sessionSpecs,
    projectResolver,
    sessionLinks,
  } = inputs;
  const operator = samples.filter(s => isOperatorEntrypoint(s.entrypoint));
  const machine = samples.filter(s => !isOperatorEntrypoint(s.entrypoint));

  const workspace =
    rollupWorkspace(operator, { id: 'workspace', label: 'Your workspace' }) ??
    emptyWorkspace(nowMs);

  const projectResult = rollupByProject(operator, {
    projectResolver,
  });
  const projects: DemoProjectRollup[] = projectList.map(project => ({
    project,
    rollup: projectResult.rollups.find(r => r.scope.id === project.key) ?? null,
  }));

  const sessionResult = rollupBySession(operator);
  const sessionsById = new Map<string, ConsumptionRollup>();
  for (const rollup of sessionResult.rollups) {
    // rollupBySession keys as `${source}:${providerSessionId}`
    sessionsById.set(rollup.scope.label, rollup);
  }

  const specsById = new Map(sessionSpecs.map(s => [s.id, s]));
  const sessionRollups: DemoSessionRollup[] = [];
  for (const [id, spec] of specsById) {
    const rollup = sessionsById.get(id);
    if (rollup) sessionRollups.push({ spec, rollup });
  }

  const roadmapResult = rollupByRoadmapItem(operator, sample => {
    const link = sessionLinks.get(sample.providerSessionId);
    if (!link) return null;
    const item = roadmapItems.find(i => i.id === link.itemId);
    return item ? { id: item.id, label: item.title } : null;
  });

  let declaredWeighted = 0;
  let inferredWeighted = 0;
  const roadmap: DemoRoadmapRollup[] = roadmapItems.map(item => {
    const linked = sessionRollups.filter(
      s => sessionLinks.get(s.spec.id)?.itemId === item.id
    );
    let declared = 0;
    let inferred = 0;
    for (const s of linked) {
      if (sessionLinks.get(s.spec.id)?.method === 'declared') {
        declared += s.rollup.weightedTokens;
      } else {
        inferred += s.rollup.weightedTokens;
      }
    }
    declaredWeighted += declared;
    inferredWeighted += inferred;
    return {
      item,
      rollup: roadmapResult.rollups.find(r => r.scope.id === item.id) ?? null,
      sessions: linked.sort(
        (a, b) => b.rollup.weightedTokens - a.rollup.weightedTokens
      ),
      declaredWeighted: declared,
      inferredWeighted: inferred,
    };
  }).sort((a, b) => {
    const av = a.rollup?.weightedTokens ?? 0;
    const bv = b.rollup?.weightedTokens ?? 0;
    return bv - av;
  });

  const unattributedSessions = sessionRollups
    .filter(s => !sessionLinks.has(s.spec.id))
    .sort((a, b) => b.rollup.weightedTokens - a.rollup.weightedTokens);
  const unattributedWeighted = unattributedSessions.reduce(
    (n, s) => n + s.rollup.weightedTokens,
    0
  );

  const unresolvedSessions = sessionRollups
    .filter(s => s.spec.projectKey === null)
    .sort((a, b) => b.rollup.weightedTokens - a.rollup.weightedTokens);

  const overheadRollup = rollupWorkspace(machine, {
    id: 'exawatt-overhead',
    label: 'Exawatt’s own harness calls',
  });

  // Interventions ride the same session rollups as everything else, so the
  // token denominator includes delegated children — one human touch steers
  // the whole tree it launched. Sessions whose count is unrecorded (null)
  // stay OUT of the rate entirely: an unobserved session is not an
  // untouched one, and folding it in would flatter the rate.
  const interventionRows: InterventionRow[] = sessionRollups
    .filter(({ spec }) => spec.interventions !== null)
    .map(({ spec, rollup }) => ({
      sessionId: spec.id,
      title: spec.title,
      harness: spec.source,
      interventions: spec.interventions as number,
      activeMs: Math.max(1, spec.lastAtMs - spec.startedAtMs),
      rawTokens:
        rollup.totals.inputTokens +
        rollup.totals.cacheReadTokens +
        rollup.totals.cacheWriteTokens +
        rollup.totals.outputTokens,
    }));

  return {
    nowMs,
    windowLabel: inputs.windowLabel,
    samples,
    planWindows,
    workspace,
    projects,
    unresolvedSessions,
    sessionsById,
    roadmap,
    unattributedWeighted,
    unattributedSessions,
    declaredWeighted,
    inferredWeighted,
    overhead: {
      sessionCount: new Set(machine.map(s => s.providerSessionId)).size,
      rollup: overheadRollup,
    },
    resolveProject: projectResolver,
    sources: buildSources(inputs, operator, planWindows),
    interventions: {
      rows: interventionRows,
      total: interventionStats(interventionRows),
      bySource: {
        'claude-code': interventionStats(
          interventionRows.filter(r => r.harness === 'claude-code')
        ),
        codex: interventionStats(
          interventionRows.filter(r => r.harness === 'codex')
        ),
      },
    },
  };
}

let cached: DemoConsumption | null = null;

export function demoConsumption(): DemoConsumption {
  if (cached) return cached;
  cached = buildDemoConsumption({
    nowMs: DEMO_NOW_MS,
    windowLabel: 'seven days',
    samples: demoSamples(),
    planWindows: demoPlanWindows(),
    projects: DEMO_PROJECTS,
    roadmap: DEMO_ROADMAP,
    sessionSpecs: DEMO_SESSIONS,
    projectResolver: demoProjectResolver,
    sessionLinks: SESSION_LINKS,
    burn: {
      codex: [0.31, 0.44, 0.38, 0.52, 0.61, 0.55, 0.72, 0.66, 0.58, 0.74, 0.81, 0.69],
      'claude-code': [0.48, 0.62, 0.71, 0.58, 0.83, 0.69, 0.44, 0.76, 0.88, 0.64, 0.55, 0.61],
    },
    burnRates: { 'codex-primary': 9.4, 'codex-weekly': 0.92 },
    claudePlanNote:
      'Claude Code keeps no plan, quota, or rate-limit record in its local files.',
  });
  return cached;
}

function emptyWorkspace(nowMs: number): ConsumptionRollup {
  const at = iso(nowMs);
  return {
    scope: { kind: 'workspace', id: 'workspace', label: 'Your workspace' },
    window: { from: at, to: at },
    totals: {
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      webSearches: 0,
      webFetches: 0,
    },
    weightedTokens: 0,
    weightedTokensFromFallback: 0,
    modelsWithoutWeight: [],
    sessionCount: 0,
    samples: 0,
    sources: [],
    assurance: localLogAssurance('claude-code'),
    delegated: {
      samples: 0,
      totals: {
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        webSearches: 0,
        webFetches: 0,
      },
      weightedTokens: 0,
      agents: 0,
      agentTypes: [],
    },
    delegationBlindSources: [],
  };
}

/** Per-source capacity view, assembled from the same samples and plan windows. */
function buildSources(
  inputs: DemoConsumptionInputs,
  operator: ConsumptionSample[],
  planWindows: PlanWindow[]
): ConsumptionSourceView[] {
  const fiveHoursAgo = iso(inputs.nowMs - 5 * HOUR);
  const recent = operator.filter(s => s.at >= fiveHoursAgo);

  const build = (
    source: ConsumptionSourceId,
    label: string,
    burn: number[],
    burnRates: Record<string, number>,
    unreportedReason?: string
  ): ConsumptionSourceView => {
    const mine = recent.filter(s => s.source === source);
    const observedTokens5h = mine.reduce(
      (n, s) =>
        n +
        s.usage.inputTokens +
        s.usage.cacheReadTokens +
        s.usage.cacheWriteTokens +
        s.usage.outputTokens,
      0
    );
    const delegatedTokens = mine
      .filter(s => s.delegation)
      .reduce(
        (n, s) =>
          n +
          s.usage.inputTokens +
          s.usage.cacheReadTokens +
          s.usage.cacheWriteTokens +
          s.usage.outputTokens,
        0
      );
    const windows = planWindows
      .filter(w => w.source === source)
      .map(w => capacityWindowFromPlan(w, burnRates[w.limitId ?? ''] ?? 0))
      .filter((w): w is NonNullable<typeof w> => w !== null);
    return {
      key: source,
      harness: source,
      label,
      // The plan's OWN reported type, never an assumed tier.
      planType:
        windows.length > 0
          ? (planWindows.find(w => w.source === source && w.planType)
              ?.planType ?? null)
          : null,
      credits: null,
      windows,
      observedTokens5h,
      observedSessions: new Set(mine.map(s => s.providerSessionId)).size,
      observedDelegatedShare:
        source === 'codex'
          ? null // Codex writes no delegation record: unavailable, not zero
          : observedTokens5h > 0
            ? delegatedTokens / observedTokens5h
            : 0,
      burn,
      unreportedReason,
    };
  };

  return [
    build('codex', 'Codex', inputs.burn.codex, inputs.burnRates),
    build(
      'claude-code',
      'Claude Code',
      inputs.burn['claude-code'],
      {},
      inputs.claudePlanNote
    ),
  ];
}
