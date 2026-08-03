/**
 * Demo Workspace fixture types (ENG-027 W3/W4).
 *
 * The Demo Workspace is REPRESENTATIVE truth: an authored, versioned,
 * resettable fleet for one plausible startup, served entirely from these
 * fixtures. No LLM calls, no PTYs, no network, no Math.random — every value
 * is authored or derived deterministically, so "reset" is simply re-reading
 * the module and two reads are always identical.
 *
 * Ownership boundary (roadmap ENG-027 W4 vs ENG-004 V3.1): this package
 * produces DATA only. Rendering the fleet — instancing, culling, label
 * budgets — belongs to ENG-004 V3.1 and must not leak in here.
 *
 * Honesty boundaries these types encode:
 *
 * - `readiness` carries the ENG-026 grammar. Non-coding Agents (research,
 *   marketing, support) exist to sell the Agent Types vision (ENG-028) and
 *   are ALWAYS `preview` — the demo may show the future, but it may not fake
 *   the present.
 * - `status` uses the same `AgentStatus` union live Agents use, so the
 *   five-signal status-light protocol (ENG-016 D40: off, active, result,
 *   needs-you, fault) derives from demo Agents exactly as it derives from
 *   real ones. No demo-only status vocabulary exists.
 * - Delegation is authored as parent/child runs with the same identity
 *   fields `ConsumptionDelegation` carries, so a delegating demo Session
 *   reads as more than one worker (ENG-023) without a demo-only shape.
 */

import type { AgentStatus, BlockerType } from '../types/agent';
import type { ConsumptionSourceId } from '../consumption/types';

/** ENG-026 readiness grammar, as data. The demo never renders `announced`. */
export type DemoReadiness = 'live' | 'preview';

/** Business function a demo Project belongs to. Coding is the majority. */
export type DemoProjectFunction =
  | 'frontend'
  | 'backend'
  | 'infra'
  | 'data'
  | 'firmware'
  | 'research'
  | 'marketing'
  | 'support';

export const CODING_FUNCTIONS: readonly DemoProjectFunction[] = [
  'frontend',
  'backend',
  'infra',
  'data',
  'firmware',
];

export function isCodingFunction(fn: DemoProjectFunction): boolean {
  return (CODING_FUNCTIONS as DemoProjectFunction[]).includes(fn);
}

/**
 * Deep-freeze a fixture so consumer mutation cannot corrupt "reset =
 * identical". The canonical fixtures are frozen once at build time; `nowMs`
 * rebasing always returns fresh copies derived from the frozen canon, so no
 * caller can reach mutable shared state.
 */
export function deepFreezeFixture<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreezeFixture((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** Fixture tier: `base` is the hand-authored fleet an operator reads up
 * close; `scale` adds the generated volume the Fleet-altitude moment needs. */
export type DemoFleetTier = 'base' | 'scale';

export interface DemoInitiative {
  id: string;
  name: string;
  /** One line of intent, readable on an aggregation surface. */
  goal: string;
  projectKeys: string[];
}

export interface DemoWorkspaceProject {
  /** Stable key, used everywhere agents reference their Project. */
  key: string;
  /** Repo-style display name. */
  name: string;
  /** Plausible local checkout path (stable Project id for cwd resolution). */
  dir: string;
  color: string;
  function: DemoProjectFunction;
  /** ENG-028 Agent Type that fronts this Project's workers, e.g. `Engineer`. */
  agentType: string;
  /**
   * ENG-026 readiness of the CAPABILITY this Project's Agents represent.
   * Coding functions are `live` (Exawatt runs coding agents today);
   * everything else is `preview` and must render as such.
   */
  readiness: DemoReadiness;
  /** One line a visitor can read at the Fleet altitude. */
  summary: string;
}

/** One delegated (subagent) run under a demo Session. */
export interface DemoDelegatedRun {
  /** Harness-style id, e.g. `agent-3f21`. */
  agentId: string;
  /** `Explore`, `general-purpose`, `fork`, … — real harness vocabulary. */
  agentType: string;
  model: string;
  /** Six-or-so words of what the child is doing. */
  task: string;
  startedAtMs: number;
  usage: DemoUsageSpec;
}

/** Authored token totals for one Session or delegated run. The consumption
 * module distributes these into per-turn `ConsumptionSample`s. */
export interface DemoUsageSpec {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  /** Generated tokens, INCLUSIVE of reasoning (core `RawUsage` semantics). */
  output: number;
  /** Subset of `output`. Only Codex reports it; leave 0 for claude-code. */
  reasoning?: number;
  webSearches?: number;
}

export interface DemoBlocker {
  type: BlockerType;
  title: string;
  description: string;
  suggestedResponses?: string[];
  createdAtMs: number;
}

/** One line of an authored Session transcript. Honest recordings/authored
 * fixtures only — never a simulated agent pretending to think (ENG-027). */
export interface DemoTranscriptLine {
  atMs: number;
  role: 'operator' | 'agent' | 'tool';
  text: string;
}

/**
 * One demo Agent and its Session. Field names mirror the live shapes they
 * feed (`ExawattAgent`, `SessionDelegation`, `ConsumptionSample`) so W2's
 * demo source maps them without invention.
 */
export interface DemoFleetAgent {
  id: string;
  /** Session/tab display name — what the tab strip and cards show. */
  name: string;
  projectKey: string;
  /** The launch goal, one full sentence. */
  goal: string;
  /** Six-word-contract subtitle (ENG-016 D33). */
  contextLabel: string;
  status: AgentStatus;
  source: ConsumptionSourceId;
  model: string;
  effort: 'low' | 'medium' | 'high' | null;
  gitBranch: string | null;
  /** Roadmap item in this Project's own roadmap, when the Session links. */
  roadmapItemId: string | null;
  /** How the link was established; mirrors ENG-017 link methods. */
  link: 'declared' | 'branch' | 'title' | null;
  startedAtMs: number;
  lastActivityAtMs: number;
  /** Assistant turns recorded; drives consumption sample emission. */
  turns: number;
  /** Operator messages AFTER launch — the intervention metric (ENG-026 N2).
   * Authored fixture truth, never derived at view time; an agent with an
   * authored transcript must match its operator lines after the first. */
  interventions: number;
  usage: DemoUsageSpec;
  delegated: DemoDelegatedRun[];
  blocker?: DemoBlocker;
  /** Present only when status is `error`: what actually failed. */
  faultNote?: string;
  /** Few-bullet recorded work log — "worked on X, then Y" — for Sessions
   *  without an authored transcript. Every Session must open READABLE
   *  (ENG-027 W7); generated-tier Sessions derive theirs from fixture facts
   *  via `demoWorkLog`. */
  workLog?: readonly string[];
  readiness: DemoReadiness;
  tier: DemoFleetTier;
  /** Initiative this work rolls up to. The authored demo fleet is strategic
   *  by construction: every Agent must name the durable goal it advances. */
  initiativeId: string;
}

/** The organization portrayed by the Demo Workspace's representative data.
 *  This is deliberately NOT the tenant Workspace identity: the tenant is
 *  canonically named "Demo" by the app tenancy layer, while this record names
 *  the company whose fleet the fixture portrays. */
export interface DemoOrganizationIdentity {
  /** Stable organization id inside the fixture corpus. */
  id: string;
  /** Organization display name. */
  name: string;
  tagline: string;
  /** One paragraph of who this startup is, for About-style surfaces. */
  description: string;
}
