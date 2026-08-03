/**
 * Demo Workspace consumption history (ENG-027 W3).
 *
 * Emits REAL `ConsumptionSample` and `PlanWindow` records — the same shapes
 * a local parse produces — so no consumption shape is unique to the demo
 * (the ENG-008 E4 precedent). Rollups happen through core's own `rollupBy*`
 * on the consumer side; this module only produces the sample stream.
 *
 * The corpus keeps the measured real-world properties (see
 * `docs/engineering/projects/consumption-spine.md`):
 *
 * - cache reads dominate raw volume by 10-100x;
 * - Claude Code sessions are fewer and larger, Codex sessions many and
 *   smaller, and only Codex reports reasoning tokens and plan windows;
 * - delegated runs exist ONLY on Claude Code samples (`SOURCE_CAPABILITIES`);
 * - Exawatt's own goal-subtitle summarizer (`entrypoint: sdk-cli`) appears
 *   as many tiny machine sessions, so surfaces can separate tool overhead
 *   from the work being measured;
 * - fourteen days of history with a weekday cadence and a weekend dip.
 *
 * Everything is deterministic: authored numbers plus a seeded sin-based
 * splitter. Two calls return identical corpora.
 */

import { localLogAssurance } from '../consumption/assurance';
import type {
  ConsumptionSample,
  ConsumptionSourceId,
  PlanWindow,
  RawUsage,
} from '../consumption/types';
import type { DemoFleetAgent, DemoUsageSpec } from './types';
import { DEMO_BASE_AGENTS } from './agents';
import { DEMO_PROJECTS, DEMO_PROJECTS_BY_KEY } from './projects';
import {
  DAY_MS,
  DEMO_WORKSPACE_NOW_MS,
  HOUR_MS,
  MIN_MS,
} from './startup';

const NOW = DEMO_WORKSPACE_NOW_MS;
const iso = (ms: number) => new Date(ms).toISOString();

export const DEMO_CONSUMPTION_WINDOW_DAYS = 14;

/* ------------------------------------------------------------------ */
/* deterministic helpers                                               */
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

function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return 1.1 + ((hash >>> 0) % 997) / 997;
}

/** Deterministic uuid-shaped session id from a stable key. */
function sessionIdFrom(key: string): string {
  const hex = (salt: string, len: number) => {
    let hash = 0x811c9dc5;
    const text = `${key}:${salt}`;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0').slice(0, len);
  };
  return `${hex('a', 8)}-${hex('b', 4)}-4${hex('c', 3)}-9${hex('d', 3)}-${hex('e', 8)}${hex('f', 4)}`;
}

/* ------------------------------------------------------------------ */
/* sample emission                                                     */
/* ------------------------------------------------------------------ */

interface EmitSpec {
  sessionId: string;
  source: ConsumptionSourceId;
  model: string;
  effort: string | null;
  cwd: string;
  gitBranch: string | null;
  entrypoint: string;
  startedAtMs: number;
  lastAtMs: number;
  turns: number;
  usage: DemoUsageSpec;
  delegation: ConsumptionSample['delegation'];
}

function emit(spec: EmitSpec): ConsumptionSample[] {
  const seed = seedFrom(spec.sessionId + (spec.delegation?.agentId ?? ''));
  const input = distribute(spec.usage.input, spec.turns, seed);
  const cacheRead = distribute(spec.usage.cacheRead, spec.turns, seed + 0.4);
  const cacheWrite = distribute(spec.usage.cacheWrite, spec.turns, seed + 0.8);
  const output = distribute(spec.usage.output, spec.turns, seed + 1.2);
  const reasoning = distribute(spec.usage.reasoning ?? 0, spec.turns, seed + 1.6);
  const webSearches = distribute(spec.usage.webSearches ?? 0, spec.turns, seed + 2.0);
  const span = Math.max(1, spec.lastAtMs - spec.startedAtMs);

  return Array.from({ length: spec.turns }, (_, i) => {
    const at = spec.startedAtMs + Math.round(((i + 1) / spec.turns) * span);
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
      model: spec.model,
      effort: spec.effort,
      providerSessionId: spec.sessionId,
      cwd: spec.cwd,
      gitBranch: spec.source === 'claude-code' ? spec.gitBranch : null,
      usage: raw,
      assurance: localLogAssurance(spec.source),
      idempotencyKey: `${spec.sessionId}:${spec.delegation?.agentId ?? 'own'}:${i}`,
      contextWindow: spec.source === 'codex' ? 272_000 : null,
      sourceFile: null,
      delegation: spec.delegation,
      entrypoint: spec.entrypoint,
    } satisfies ConsumptionSample;
  });
}

/** The provider session id for a demo Agent's Session. Stable per agent. */
export function demoAgentSessionId(agent: DemoFleetAgent): string {
  return sessionIdFrom(agent.id);
}

function agentSamples(agent: DemoFleetAgent): ConsumptionSample[] {
  const project = DEMO_PROJECTS_BY_KEY.get(agent.projectKey);
  if (!project) return [];
  const sessionId = demoAgentSessionId(agent);
  const out = emit({
    sessionId,
    source: agent.source,
    model: agent.model,
    effort: agent.effort,
    cwd: project.dir,
    gitBranch: agent.gitBranch,
    entrypoint: agent.source === 'codex' ? 'codex-tui' : 'cli',
    startedAtMs: agent.startedAtMs,
    lastAtMs: agent.lastActivityAtMs,
    turns: agent.turns,
    usage: agent.usage,
    delegation: null,
  });
  for (const run of agent.delegated) {
    out.push(
      ...emit({
        sessionId,
        source: agent.source,
        model: run.model,
        effort: agent.effort,
        cwd: project.dir,
        gitBranch: agent.gitBranch,
        entrypoint: 'cli',
        startedAtMs: run.startedAtMs,
        lastAtMs: Math.min(agent.lastActivityAtMs, run.startedAtMs + 2 * HOUR_MS),
        turns: Math.max(2, Math.round(agent.turns / 3)),
        usage: run.usage,
        delegation: {
          agentId: run.agentId,
          parentSessionId: sessionId,
          agentType: run.agentType,
          spawnDepth: 1,
          skill: null,
          background: false,
          parentAgentId: null,
        },
      })
    );
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* fourteen-day history                                                */
/* ------------------------------------------------------------------ */

/** Relative day-over-day work weight per Project (history shaping only). */
const HISTORY_WEIGHT: Readonly<Record<string, number>> = {
  'dispatch-engine': 1.0,
  'grid-api': 0.7,
  'voltaic-home': 0.9,
  'telemetry-ingest': 0.8,
  'edge-gateway': 0.5,
  'partner-portal': 0.5,
  'platform-infra': 0.7,
  'market-intel': 0.3,
  'demand-gen': 0.25,
  'support-ops': 0.35,
};

const HISTORY_TITLE_SLUGS = ['feature', 'fix', 'tests', 'review', 'refactor'];

function historySamples(): ConsumptionSample[] {
  const out: ConsumptionSample[] = [];
  for (const project of DEMO_PROJECTS) {
    const weight = HISTORY_WEIGHT[project.key] ?? 0.4;
    for (let day = 2; day <= DEMO_CONSUMPTION_WINDOW_DAYS; day++) {
      const dayStart = NOW - day * DAY_MS;
      // Sunday=0 dip; deterministic weekday from the frozen clock.
      const weekday = new Date(dayStart).getUTCDay();
      const weekendFactor = weekday === 0 || weekday === 6 ? 0.3 : 1;
      const roll = seedFrom(`${project.key}:${day}`) - 1.1; // 0..~1
      const sessionCount = Math.round(roll * 3 * weight * weekendFactor);
      for (let s = 0; s < sessionCount; s++) {
        const key = `${project.key}:history:${day}:${s}`;
        const codex = seedFrom(`${key}:src`) < 1.6;
        const magnitude = 0.5 + (seedFrom(`${key}:mag`) - 1.1) * 1.8;
        const turns = 4 + Math.floor((seedFrom(`${key}:turns`) - 1.1) * 9);
        const startedAtMs =
          dayStart + 9 * HOUR_MS + Math.round((seedFrom(`${key}:hour`) - 1.1) * 8 * HOUR_MS);
        const output = Math.round(turns * (codex ? 27_000 : 22_000) * magnitude);
        out.push(
          ...emit({
            sessionId: sessionIdFrom(key),
            source: codex ? 'codex' : 'claude-code',
            model: codex
              ? 'gpt-5.3-codex'
              : seedFrom(`${key}:model`) < 1.5
                ? 'claude-opus-5'
                : 'claude-sonnet-5',
            effort: seedFrom(`${key}:effort`) < 1.6 ? 'medium' : 'high',
            cwd: project.dir,
            gitBranch: codex
              ? null
              : `agent/${project.key}-${HISTORY_TITLE_SLUGS[s % HISTORY_TITLE_SLUGS.length]}-${day}`,
            entrypoint: codex ? 'codex-tui' : 'cli',
            startedAtMs,
            lastAtMs: startedAtMs + Math.round(turns * 14 * MIN_MS),
            turns,
            usage: {
              input: Math.round(turns * 9_500 * magnitude),
              cacheRead: Math.round(turns * (codex ? 430_000 : 1_500_000) * magnitude),
              cacheWrite: Math.round(turns * (codex ? 48_000 : 150_000) * magnitude),
              output,
              reasoning: codex ? Math.round(output * 0.7) : 0,
            },
            delegation: null,
          })
        );
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Exawatt's own overhead                                              */
/* ------------------------------------------------------------------ */

const OVERHEAD_SESSIONS = 30;

function overheadSamples(): ConsumptionSample[] {
  const out: ConsumptionSample[] = [];
  for (let i = 0; i < OVERHEAD_SESSIONS; i++) {
    const at =
      NOW - Math.round(((i + 1) / OVERHEAD_SESSIONS) * (DEMO_CONSUMPTION_WINDOW_DAYS - 1) * DAY_MS);
    const project = DEMO_PROJECTS[i % DEMO_PROJECTS.length];
    out.push(
      ...emit({
        sessionId: sessionIdFrom(`overhead:${i}`),
        source: 'claude-code',
        model: 'claude-haiku-5',
        effort: null,
        cwd: project.dir,
        gitBranch: null,
        entrypoint: 'sdk-cli',
        startedAtMs: at,
        lastAtMs: at + 12_000,
        turns: 1,
        usage: {
          input: 4_800 + (i % 5) * 320,
          cacheRead: 42_000 + (i % 7) * 2_100,
          cacheWrite: 2_800,
          output: 610 + (i % 3) * 80,
        },
        delegation: null,
      })
    );
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* public surface                                                      */
/* ------------------------------------------------------------------ */

export interface DemoWorkspaceConsumption {
  samples: ConsumptionSample[];
  planWindows: PlanWindow[];
}

/**
 * Codex plan windows as the harness reports them. Claude Code writes no
 * local plan record, so it has NO entry here — absent, never zero.
 */
export function demoWorkspacePlanWindows(): PlanWindow[] {
  const observedAt = iso(NOW - 2 * MIN_MS);
  const reportingSession = sessionIdFrom(`${DEMO_BASE_AGENTS[4]?.id ?? 'vg'}`);
  return [
    {
      source: 'codex',
      limitId: 'codex-primary',
      limitName: '5-hour window',
      scope: 'primary',
      usedPercent: 57,
      windowMinutes: 300,
      resetsAt: iso(NOW + 2 * HOUR_MS + 10 * MIN_MS),
      planType: 'pro',
      observedAt,
      providerSessionId: reportingSession,
    },
    {
      source: 'codex',
      limitId: 'codex-weekly',
      limitName: 'Weekly window',
      scope: 'secondary',
      usedPercent: 71,
      windowMinutes: 10_080,
      resetsAt: iso(NOW + 3 * DAY_MS + 5 * HOUR_MS),
      planType: 'pro',
      observedAt,
      providerSessionId: reportingSession,
    },
  ];
}

let cached: DemoWorkspaceConsumption | null = null;

/**
 * The Demo Workspace's full consumption corpus: base-tier Sessions (with
 * their delegated runs), fourteen days of finished-session history, and
 * Exawatt's own machine-entrypoint overhead. Deterministic and cached.
 */
export function demoWorkspaceConsumption(): DemoWorkspaceConsumption {
  if (cached) return cached;
  cached = {
    samples: [
      ...DEMO_BASE_AGENTS.flatMap(agentSamples),
      ...historySamples(),
      ...overheadSamples(),
    ],
    planWindows: demoWorkspacePlanWindows(),
  };
  return cached;
}

/**
 * Directory→Project resolver for `rollupByProject`, mirroring how the live
 * resolver maps a cwd onto a known Project root.
 */
export function demoWorkspaceProjectResolver(
  cwd: string
): { id: string; label: string } | null {
  const project = DEMO_PROJECTS.find(p => p.dir === cwd);
  return project ? { id: project.key, label: project.name } : null;
}
