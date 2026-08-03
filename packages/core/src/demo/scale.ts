/**
 * The scale tier (ENG-027 W4 — DATA only).
 *
 * The Fleet-altitude moment needs entity count: enough Agents that
 * aggregation, clustering, and label budgets visibly do their job. This
 * module generates that volume with HONEST STRUCTURE rather than cloned
 * filler:
 *
 * - every generated Agent executes a distinct, authored assignment — either
 *   a singleton workstream or one partition of a genuinely parallel fan-out
 *   batch (sharded backtests, per-control evidence capture, per-vendor
 *   conformance runs — the shapes real agent fleets actually take);
 * - every assignment traces to a real item in its Project's roadmap, so the
 *   roadmap lens, Project drill-down, and Fleet altitude tell one story;
 * - names and goals are unique across the whole fleet (enforced by test);
 * - status, timing, model, and usage derive DETERMINISTICALLY from the
 *   agent id — no Math.random, so the fleet is versioned and resettable;
 * - Codex agents never carry delegated children (the source cannot record
 *   them), and preview-function Projects stay `preview` at every scale.
 *
 * Rendering this fleet (instancing, culling, label budgets, frame cost) is
 * ENG-004 V3.1's milestone, not this module's.
 */

import type {
  DemoDelegatedRun,
  DemoFleetAgent,
  DemoFleetTier,
  DemoUsageSpec,
} from './types';
import { DEMO_BASE_AGENTS } from './agents';
import { DEMO_PROJECTS_BY_KEY } from './projects';
import { DEMO_WORKSPACE_NOW_MS, HOUR_MS, MIN_MS } from './startup';

/* ------------------------------------------------------------------ */
/* deterministic pseudo-randomness                                     */
/* ------------------------------------------------------------------ */

/** FNV-1a over a string, folded to [0, 1). Stable across runs and hosts. */
function unit(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

/* ------------------------------------------------------------------ */
/* authored workstreams                                                */
/* ------------------------------------------------------------------ */

interface SingleAssignment {
  /** Display name. */
  n: string;
  /** Goal sentence. */
  g: string;
  /** Six-word-contract subtitle. */
  c: string;
  /** Roadmap item id in the Project's own roadmap. */
  i: string | null;
}

interface FanOutBatch {
  /** Name template; `#` is replaced with `partition/of`. */
  n: string;
  /** Goal template; `#` is replaced with `partition of total`. */
  g: string;
  c: string;
  i: string;
  count: number;
}

interface ProjectWorkstreams {
  singles: SingleAssignment[];
  fanouts: FanOutBatch[];
}

const WORKSTREAMS: Readonly<Record<string, ProjectWorkstreams>> = {
  'dispatch-engine': {
    singles: [
      { n: 'ORDC adder feature audit', g: 'Audit the ORDC adder feature against July scarcity intervals.', c: 'Auditing scarcity interval features', i: 'DSP-31' },
      { n: 'Bid ceiling warranty map', g: 'Map per-site battery warranty limits into bid ceiling constraints.', c: 'Mapping warranty bid ceilings', i: 'DSP-32' },
      { n: 'Curve monotonicity property tests', g: 'Property-test the bid curve builder for monotonicity under all feature inputs.', c: 'Property-testing curve monotonicity', i: 'DSP-32' },
      { n: 'Reserve product research spike', g: 'Compare reserve product bidding rules ahead of co-optimization design.', c: 'Comparing reserve product rules', i: 'DSP-33' },
      { n: 'Settlement mismatch investigation', g: 'Investigate the 0.4% settlement mismatch on the July 18 operating day.', c: 'Chasing July 18 settlement mismatch', i: null },
      { n: 'Forecast cache warm path', g: 'Cut forecast cold-start latency by warming the feature cache at market open.', c: 'Warming forecast feature cache', i: 'DSP-31' },
      { n: 'Backtest fixture refresh', g: 'Regenerate backtest fixture days to include the ORDC adder feature.', c: 'Regenerating stale backtest fixtures', i: 'DSP-30' },
      { n: 'Redispatch trigger sketch', g: 'Sketch the telemetry-divergence trigger for sub-hourly redispatch.', c: 'Sketching redispatch divergence trigger', i: 'DSP-34' },
    ],
    fanouts: [
      { n: 'Shadow-day scoring', g: 'Score shadow-bid trading day # against production.', c: 'Scoring one shadow trading day', i: 'DSP-31', count: 10 },
      { n: 'Basis feature sweep', g: 'Evaluate hub-to-node basis feature candidate set # for the refit model.', c: 'Evaluating one basis feature set', i: 'DSP-31', count: 6 },
    ],
  },
  'grid-api': {
    singles: [
      { n: 'Signing header conformance tests', g: 'Extend contract tests to cover every v2 signing header permutation.', c: 'Testing v2 signing headers', i: 'API-18' },
      { n: 'Dual-sign latency check', g: 'Measure delivery latency added by dual-signing and confirm it stays under budget.', c: 'Measuring dual-sign delivery latency', i: 'API-18' },
      { n: 'Sandbox data-only reset path', g: 'Build the data-only sandbox reset variant that preserves partner keys.', c: 'Building data-only sandbox reset', i: 'API-19' },
      { n: 'Rate tier modelling', g: 'Model burst tiers per partner class from ninety days of traffic.', c: 'Modelling partner burst tiers', i: 'API-20' },
      { n: 'Enrollment API error-copy pass', g: 'Rewrite enrollment API error messages so installers can self-serve fixes.', c: 'Rewriting enrollment error copy', i: null },
      { n: 'Webhook replay endpoint', g: 'Let partners replay a webhook delivery from the dashboard.', c: 'Adding webhook delivery replay', i: 'API-18' },
      { n: 'Fleet-stats aggregate design', g: 'Design the anonymized fleet statistics aggregate for the public read layer.', c: 'Designing public stats aggregates', i: 'API-21' },
      { n: 'OpenAPI drift check', g: 'Fail CI when the published OpenAPI spec drifts from handlers.', c: 'Gating CI on spec drift', i: null },
    ],
    fanouts: [
      { n: 'Partner verifier migration', g: 'Migrate sandbox partner # to v2 signature verification.', c: 'Migrating one sandbox partner', i: 'API-18', count: 8 },
    ],
  },
  'voltaic-home': {
    singles: [
      { n: 'Prefill coverage telemetry', g: 'Instrument how often commissioning-record prefill fills each enrollment field.', c: 'Instrumenting prefill field coverage', i: 'HOME-24' },
      { n: 'Enrollment a11y pass', g: 'Take the three-screen enrollment flow through a full accessibility pass.', c: 'Auditing enrollment flow accessibility', i: 'HOME-24' },
      { n: 'Savings card settlement split', g: 'Show pending versus settled earnings honestly on the savings card.', c: 'Splitting pending from settled', i: null },
      { n: 'Event timeline data contract', g: 'Define the dispatch-event timeline contract with the grid-api team.', c: 'Defining event timeline contract', i: 'HOME-25' },
      { n: 'Referral deep-link spike', g: 'Spike neighbor referral deep links that prefill the address screen.', c: 'Spiking referral deep links', i: 'HOME-26' },
      { n: 'Old-flow retirement checklist', g: 'Enumerate everything still depending on the legacy enrollment flow.', c: 'Enumerating legacy flow dependencies', i: 'HOME-24' },
      { n: 'App icon badge truthing', g: 'Badge the app icon only for events that need the customer.', c: 'Restricting badge to needs-you', i: null },
      { n: 'Offline savings cache', g: 'Cache the savings card so it renders instantly offline.', c: 'Caching savings card offline', i: null },
      { n: 'Multi-site data model sketch', g: 'Sketch the account model for households with two enrolled addresses.', c: 'Sketching multi-site account model', i: 'HOME-27' },
      { n: 'Store listing refresh', g: 'Refresh app store screenshots to show the rebuilt enrollment flow.', c: 'Refreshing store listing screenshots', i: 'HOME-24' },
    ],
    fanouts: [
      { n: 'Flow test matrix', g: 'Run enrollment resume test matrix cell #.', c: 'Running one resume matrix cell', i: 'HOME-24', count: 10 },
    ],
  },
  'telemetry-ingest': {
    singles: [
      { n: 'Vendor sequence audit', g: 'Verify sequence-number monotonicity guarantees for each hardware vendor.', c: 'Verifying vendor sequence guarantees', i: 'TEL-14' },
      { n: 'Dedupe key collision test', g: 'Prove the idempotency key cannot collide across devices or firmware resets.', c: 'Proving dedupe key uniqueness', i: 'TEL-14' },
      { n: 'Drift detector prototype', g: 'Prototype gateway-versus-meter drift detection on July data.', c: 'Prototyping meter drift detection', i: 'TEL-15' },
      { n: 'Cold tier query passthrough', g: 'Design transparent queries over readings tiered to cold storage.', c: 'Designing cold tier passthrough', i: 'TEL-16' },
      { n: 'Gap detector tuning', g: 'Cut gap-detection false positives from cellular gateway jitter.', c: 'Tuning gap detector jitter', i: null },
      { n: 'Replay hour selector', g: 'Build the historical-hour selector for the replay tool.', c: 'Building replay hour selector', i: 'TEL-17' },
      { n: 'Ingest load model', g: 'Model ingest load at five hundred homes against current headroom.', c: 'Modelling five-hundred-home load', i: null },
      { n: 'Schema registry cleanup', g: 'Retire the three deprecated reading schema versions still registered.', c: 'Retiring deprecated reading schemas', i: null },
    ],
    fanouts: [
      { n: 'July reconciliation partition', g: 'Reconcile double-counted July window partition # against vendor portals.', c: 'Reconciling one July partition', i: 'TEL-14', count: 14 },
    ],
  },
  'edge-gateway': {
    singles: [
      { n: 'A/B partition soak', g: 'Soak-test the A/B partition scheme across a hundred simulated update cycles.', c: 'Soaking A/B update cycles', i: 'EDGE-9' },
      { n: 'Health self-check hardening', g: 'Harden the boot health self-check against partial-flash states.', c: 'Hardening boot health checks', i: 'EDGE-9' },
      { n: 'Rollout halt thresholds', g: 'Derive rollout halt thresholds from lab failure telemetry.', c: 'Deriving rollout halt thresholds', i: 'EDGE-9' },
      { n: 'Register map diffing', g: 'Diff vendor register map revisions to catch silent changes.', c: 'Diffing vendor register maps', i: 'EDGE-10' },
      { n: 'Islanding reserve heuristic', g: 'Prototype smarter backup reserve targets under unstable grid connection.', c: 'Prototyping islanding reserve targets', i: 'EDGE-11' },
      { n: 'Update bandwidth budget', g: 'Measure OTA payload sizes against rural cellular data budgets.', c: 'Measuring OTA bandwidth cost', i: 'EDGE-9' },
    ],
    fanouts: [
      { n: 'Vendor conformance run', g: 'Run the adapter conformance suite against vendor bench #.', c: 'Running one vendor bench', i: 'EDGE-10', count: 6 },
    ],
  },
  'partner-portal': {
    singles: [
      { n: 'Reminder copy pass', g: 'Write homeowner reminder and confirmation copy for scheduled commissionings.', c: 'Writing commissioning reminder copy', i: 'POR-11' },
      { n: 'Reschedule state machine', g: 'Keep the commissioning record intact through reschedules and cancellations.', c: 'Modelling reschedule state machine', i: 'POR-11' },
      { n: 'Settlement PDF prototype', g: 'Prototype the signed settlement statement PDF export.', c: 'Prototyping settlement statement export', i: 'POR-13' },
      { n: 'SSO test IdP harness', g: 'Stand up a test identity provider so SSO work continues without the utility metadata.', c: 'Standing up test IdP', i: 'POR-12' },
      { n: 'Checklist hardware profiles', g: 'Derive commissioning checklists from the site hardware profile.', c: 'Deriving hardware-profile checklists', i: 'POR-14' },
      { n: 'Health board drill-down', g: 'Add per-site drill-down from the utility fleet health board.', c: 'Adding health board drill-down', i: null },
    ],
    fanouts: [
      { n: 'Portal accessibility audit', g: 'Audit portal surface area segment # for accessibility.', c: 'Auditing one portal segment', i: 'POR-11', count: 4 },
    ],
  },
  'platform-infra': {
    singles: [
      { n: 'Access review automation', g: 'Automate quarterly access review capture into the evidence store.', c: 'Automating access review capture', i: 'INF-21' },
      { n: 'Restore drill scheduler', g: 'Schedule unattended monthly backup-restore drills with captured evidence.', c: 'Scheduling unattended restore drills', i: 'INF-21' },
      { n: 'PG17 extension matrix', g: 'Verify every installed Postgres extension against version 17.', c: 'Verifying extension compatibility matrix', i: 'INF-22' },
      { n: 'Write-pause rehearsal rerun', g: 'Rerun the upgrade rehearsal targeting a sub-thirty-second dispatch write pause.', c: 'Shortening rehearsed write pause', i: 'INF-22' },
      { n: 'Spot checkpoint format', g: 'Design the checkpoint format that lets simulation jobs resume after preemption.', c: 'Designing preemption checkpoint format', i: 'INF-23' },
      { n: 'Region failover tabletop', g: 'Run the region-loss tabletop for the dispatch loop and write up the gaps.', c: 'Running region failover tabletop', i: 'INF-24' },
      { n: 'Deploy attestation verifier', g: 'Verify deploy provenance attestations at admission time.', c: 'Verifying attestations at admission', i: null },
      { n: 'Alert routing review', g: 'Re-check page routing after the on-call noise diet.', c: 'Reviewing post-diet alert routing', i: null },
    ],
    fanouts: [
      { n: 'Control evidence capture', g: 'Wire automated evidence capture for audit control #.', c: 'Wiring one control capture', i: 'INF-21', count: 10 },
    ],
  },
  'market-intel': {
    singles: [
      { n: 'Filing relevance rubric v2', g: 'Tighten the storage-relevance rubric that triages new filings.', c: 'Tightening filing relevance rubric', i: 'RES-7' },
      { n: 'Weekly digest template', g: 'Draft the weekly rule-change digest template for dispatch and legal.', c: 'Drafting weekly digest template', i: 'RES-7' },
      { n: 'Withdrawal pattern study', g: 'Study interconnection queue withdrawal patterns for timing signal.', c: 'Studying queue withdrawal patterns', i: 'RES-8' },
      { n: 'Second-market criteria memo', g: 'Define the evidence bar for opening the second-market analysis.', c: 'Defining second-market evidence bar', i: 'RES-9' },
      { n: 'Tariff change monitor', g: 'Watch pilot-utility tariff dockets for change filings.', c: 'Watching pilot tariff dockets', i: 'RES-6' },
    ],
    fanouts: [
      { n: 'Queue region scan', g: 'Scan interconnection queue region # for storage entries ahead of ours.', c: 'Scanning one queue region', i: 'RES-8', count: 3 },
    ],
  },
  'demand-gen': {
    singles: [
      { n: 'Landing variant build brief', g: 'Brief the landing page A/B variant that carries the new launch story.', c: 'Briefing landing page variant', i: 'MKT-9' },
      { n: 'Claims evidence table', g: 'Trace every launch claim to cleared pilot data in one table.', c: 'Tracing claims to evidence', i: 'MKT-9' },
      { n: 'Press one-pager tightening', g: 'Cut the press one-pager to a single ruthless page.', c: 'Tightening press one-pager', i: 'MKT-9' },
      { n: 'Kitchen-table savings sheet', g: 'Draft the installer savings one-pager with real pilot numbers.', c: 'Drafting installer savings sheet', i: 'MKT-10' },
      { n: 'Neighborhood story shortlist', g: 'Shortlist pilot neighborhoods with story-worthy savings results.', c: 'Shortlisting neighborhood savings stories', i: 'MKT-11' },
      { n: 'Case study distribution plan', g: 'Plan distribution for the Pflugerville case study beyond the blog.', c: 'Planning case study distribution', i: 'MKT-8' },
    ],
    fanouts: [],
  },
  'support-ops': {
    singles: [
      { n: 'Routing rule drafts', g: 'Draft help-desk routing rules from the symptom taxonomy.', c: 'Drafting symptom routing rules', i: 'SUP-5' },
      { n: 'Digest context enrichment', g: 'Attach site, hardware, and dispatch context to escalation digest entries.', c: 'Enriching escalation digest context', i: 'SUP-6' },
      { n: 'Troubleshooter failure modes', g: 'Rank the top enrollment failure modes for the self-serve troubleshooter.', c: 'Ranking enrollment failure modes', i: 'SUP-7' },
      { n: 'Macro voice audit', g: 'Spot-check rewritten macros against the support voice guide.', c: 'Spot-checking macro voice', i: 'SUP-4' },
    ],
    fanouts: [
      { n: 'Backlog classification week', g: 'Classify historical ticket backlog week # into the symptom taxonomy.', c: 'Classifying one backlog week', i: 'SUP-5', count: 6 },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* deterministic agent synthesis                                       */
/* ------------------------------------------------------------------ */

type ScaleStatus = DemoFleetAgent['status'];

/** Weighted status wheel — mostly quiet work, a truthful slice needing you. */
const STATUS_WHEEL: Array<{ status: ScaleStatus; upTo: number }> = [
  { status: 'working', upTo: 0.34 },
  { status: 'idle', upTo: 0.56 },
  { status: 'reviewing', upTo: 0.66 },
  { status: 'complete', upTo: 0.84 },
  { status: 'blocked', upTo: 0.94 },
  { status: 'error', upTo: 1.0 },
];

function statusFor(id: string): ScaleStatus {
  const roll = unit(`${id}:status`);
  for (const { status, upTo } of STATUS_WHEEL) {
    if (roll < upTo) return status;
  }
  return 'idle';
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function usageFor(id: string, source: 'claude-code' | 'codex', turns: number): DemoUsageSpec {
  const scale = 0.6 + unit(`${id}:usage`) * 1.6; // 0.6x – 2.2x
  const perTurnOutput = source === 'codex' ? 26_000 : 21_000;
  const output = Math.round(turns * perTurnOutput * scale);
  return {
    input: Math.round(turns * 9_000 * scale),
    cacheRead: Math.round(turns * (source === 'codex' ? 420_000 : 1_400_000) * scale),
    cacheWrite: Math.round(turns * (source === 'codex' ? 46_000 : 140_000) * scale),
    output,
    reasoning: source === 'codex' ? Math.round(output * 0.7) : 0,
    webSearches: unit(`${id}:web`) < 0.25 ? Math.ceil(unit(`${id}:webn`) * 6) : 0,
  };
}

function delegatedFor(
  id: string,
  source: 'claude-code' | 'codex',
  status: ScaleStatus,
  assignmentName: string,
  startedAtMs: number
): DemoDelegatedRun[] {
  // Only Claude Code records delegation, and only a slice of active work
  // fans out — mirrors the measured ~38% delegated-sample share without
  // making every parent identical.
  if (source !== 'claude-code') return [];
  if (status !== 'working' && status !== 'reviewing') return [];
  const roll = unit(`${id}:delegate`);
  if (roll > 0.45) return [];
  const children: DemoDelegatedRun[] = [
    {
      agentId: `agent-${Math.floor(unit(`${id}:child0`) * 0xffff)
        .toString(16)
        .padStart(4, '0')}`,
      agentType: 'Explore',
      model: 'claude-sonnet-5',
      task: `Survey prior art: ${assignmentName.toLowerCase()}`,
      startedAtMs: startedAtMs + 20 * MIN_MS,
      usage: {
        input: 34_000,
        cacheRead: 1_200_000,
        cacheWrite: 130_000,
        output: 46_000,
      },
    },
  ];
  if (roll < 0.18) {
    children.push({
      agentId: `agent-${Math.floor(unit(`${id}:child1`) * 0xffff)
        .toString(16)
        .padStart(4, '0')}`,
      agentType: 'general-purpose',
      model: 'claude-opus-5',
      task: `Test coverage: ${assignmentName.toLowerCase()}`,
      startedAtMs: startedAtMs + 50 * MIN_MS,
      usage: {
        input: 28_000,
        cacheRead: 940_000,
        cacheWrite: 110_000,
        output: 41_000,
      },
    });
  }
  return children;
}

const BLOCKER_STEMS: Array<{
  type: 'input_needed' | 'approval_required';
  title: (what: string) => string;
  description: string;
}> = [
  {
    type: 'input_needed',
    title: what => `Direction needed before continuing: ${what}`,
    description:
      'Two viable approaches diverge here and the choice is not reversible cheaply. Work is parked at the decision point with both options written up.',
  },
  {
    type: 'approval_required',
    title: what => `Approval required to proceed: ${what}`,
    description:
      'The next step touches shared state other teams depend on. Holding for an explicit go-ahead rather than proceeding on inference.',
  },
];

const FAULT_STEMS = [
  'Verification run exited non-zero on the final check; the failure reproduces and needs a human read.',
  'Dependency of this task changed underneath the run; rebase produced conflicts the agent will not resolve unattended.',
  'Environment prerequisite is missing on this runner; the task cannot proceed without provisioning.',
];

function synthesizeAgent(
  projectKey: string,
  name: string,
  goal: string,
  contextLabel: string,
  roadmapItemId: string | null,
  linkPreference: DemoFleetAgent['link']
): DemoFleetAgent {
  const project = DEMO_PROJECTS_BY_KEY.get(projectKey);
  if (!project) throw new Error(`unknown demo project "${projectKey}"`);
  const id = `vgs-${projectKey}-${slugify(name)}`;
  const status = statusFor(id);
  // Preview desks run on Claude in this fleet; coding splits between sources.
  const source: DemoFleetAgent['source'] =
    project.readiness === 'preview'
      ? 'claude-code'
      : unit(`${id}:source`) < 0.55
        ? 'claude-code'
        : 'codex';
  const model =
    source === 'codex'
      ? unit(`${id}:model`) < 0.2
        ? 'gpt-5.3-codex-mini'
        : 'gpt-5.3-codex'
      : unit(`${id}:model`) < 0.45
        ? 'claude-opus-5'
        : 'claude-sonnet-5';
  const effort =
    model === 'gpt-5.3-codex-mini'
      ? 'low'
      : unit(`${id}:effort`) < 0.5
        ? 'medium'
        : 'high';

  const startedAtMs =
    DEMO_WORKSPACE_NOW_MS -
    Math.round((2 + unit(`${id}:started`) * 60) * HOUR_MS);
  const lastActivityCandidateMs =
    status === 'working'
      ? DEMO_WORKSPACE_NOW_MS - Math.round(unit(`${id}:last`) * 25 * MIN_MS)
      : status === 'reviewing' || status === 'blocked' || status === 'error'
        ? DEMO_WORKSPACE_NOW_MS -
          Math.round((0.5 + unit(`${id}:last`) * 5) * HOUR_MS)
        : DEMO_WORKSPACE_NOW_MS -
          Math.round((3 + unit(`${id}:last`) * 30) * HOUR_MS);
  // A session cannot have acted before it started; startedAt is always at
  // least 2h old, so the clamp stays in the past.
  const lastActivityAtMs = Math.max(
    lastActivityCandidateMs,
    startedAtMs + 10 * MIN_MS
  );
  const turns = 3 + Math.floor(unit(`${id}:turns`) * 12);

  const agent: DemoFleetAgent = {
    id,
    name,
    projectKey,
    goal,
    contextLabel,
    status,
    source,
    model,
    effort,
    gitBranch:
      source === 'claude-code' && project.readiness === 'live'
        ? `agent/${slugify(roadmapItemId ?? projectKey)}-${slugify(name).slice(0, 24)}`
        : null,
    roadmapItemId,
    link: roadmapItemId === null ? null : linkPreference,
    startedAtMs,
    lastActivityAtMs,
    turns,
    usage: usageFor(id, source, turns),
    delegated: delegatedFor(id, source, status, name, startedAtMs),
    readiness: project.readiness,
    tier: 'scale',
    initiativeId: null,
  };

  if (status === 'blocked') {
    const stem = BLOCKER_STEMS[Math.floor(unit(`${id}:blocker`) * BLOCKER_STEMS.length)];
    agent.blocker = {
      type: stem.type,
      title: stem.title(contextLabel.toLowerCase()),
      description: stem.description,
      createdAtMs: lastActivityAtMs,
    };
  }
  if (status === 'error') {
    agent.faultNote =
      FAULT_STEMS[Math.floor(unit(`${id}:fault`) * FAULT_STEMS.length)];
  }
  return agent;
}

function generateScaleAgents(): DemoFleetAgent[] {
  const out: DemoFleetAgent[] = [];
  for (const [projectKey, streams] of Object.entries(WORKSTREAMS)) {
    for (const single of streams.singles) {
      const linkRoll = unit(`${projectKey}:${single.n}:link`);
      out.push(
        synthesizeAgent(
          projectKey,
          single.n,
          single.g,
          single.c,
          single.i,
          linkRoll < 0.5 ? 'declared' : linkRoll < 0.8 ? 'branch' : 'title'
        )
      );
    }
    for (const batch of streams.fanouts) {
      for (let part = 1; part <= batch.count; part++) {
        out.push(
          synthesizeAgent(
            projectKey,
            `${batch.n} ${part}/${batch.count}`,
            batch.g.replace('#', `${part} of ${batch.count}`),
            batch.c,
            batch.i,
            'declared' // batch launches declare their item at spawn
          )
        );
      }
    }
  }
  return out;
}

let scaleCache: DemoFleetAgent[] | null = null;

export interface DemoFleetOptions {
  /** Rebase every timestamp so the fixture reads as "now". */
  nowMs?: number;
}

function rebase(agents: DemoFleetAgent[], nowMs: number): DemoFleetAgent[] {
  const delta = nowMs - DEMO_WORKSPACE_NOW_MS;
  if (delta === 0) return agents;
  return agents.map(agent => ({
    ...agent,
    startedAtMs: agent.startedAtMs + delta,
    lastActivityAtMs: agent.lastActivityAtMs + delta,
    delegated: agent.delegated.map(run => ({
      ...run,
      startedAtMs: run.startedAtMs + delta,
    })),
    blocker: agent.blocker
      ? { ...agent.blocker, createdAtMs: agent.blocker.createdAtMs + delta }
      : undefined,
  }));
}

/**
 * The demo fleet at a tier: `base` is the 27 hand-authored Agents; `scale`
 * appends the generated volume for the Fleet-altitude moment. Deterministic —
 * two calls always return identical data (modulo `nowMs` rebasing).
 */
export function demoFleetAgents(
  tier: DemoFleetTier = 'scale',
  options: DemoFleetOptions = {}
): DemoFleetAgent[] {
  if (!scaleCache) scaleCache = generateScaleAgents();
  const agents =
    tier === 'base' ? DEMO_BASE_AGENTS : [...DEMO_BASE_AGENTS, ...scaleCache];
  return rebase(agents, options.nowMs ?? DEMO_WORKSPACE_NOW_MS);
}

/** Total delegated (child) runs across a tier — sub-entities on the board. */
export function demoDelegatedRunCount(tier: DemoFleetTier = 'scale'): number {
  return demoFleetAgents(tier).reduce(
    (count, agent) => count + agent.delegated.length,
    0
  );
}
