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
 * - names, goals, and git branches are unique across the whole fleet
 *   (enforced by test), and branch names never truncate mid-word or drop
 *   the partition token;
 * - every needs-you row is AUTHORED: blocked status comes only from a
 *   written, assignment-specific blocker, never from a status roll;
 * - status, timing, model, and usage derive DETERMINISTICALLY from the
 *   agent id — no Math.random, so the fleet is versioned and resettable
 *   (and the canonical fixture is deep-frozen, so consumer mutation cannot
 *   corrupt a reset);
 * - Codex agents never carry delegated children (the source cannot record
 *   them), and preview-function Projects stay `preview` at every scale.
 *
 * Rendering this fleet (instancing, culling, label budgets, frame cost) is
 * ENG-004 V3.1's milestone, not this module's.
 */

import type { AgentSourceAdapterId } from '../agent-sources';
import type {
  DemoDelegatedRun,
  DemoFleetAgent,
  DemoFleetTier,
  DemoProjectFunction,
  DemoUsageSpec,
} from './types';
import { deepFreezeFixture, isCodingFunction } from './types';
import { DEMO_BASE_AGENTS } from './agents';
import { DEMO_PROJECTS_BY_KEY } from './projects';
import {
  DEMO_WORKSPACE_NOW_MS,
  HOUR_MS,
  MIN_MS,
  demoInitiativeIdForWork,
} from './startup';

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

/**
 * Fully-authored needs-you copy for one blocked scale Agent. The needs-you
 * queue is the product's flagship attention story, so blocked status is
 * never rolled from a hash — an Agent is blocked exactly when a human wrote
 * its blocker, and every title/description is specific to its assignment
 * (for fan-out batches, to its PARTITION), so a drill-in never shows two
 * identical rows.
 */
interface ScaleBlockerSpec {
  type: 'input_needed' | 'approval_required' | 'credentials_needed';
  /** Title, written to survive a shoulder-read. */
  t: string;
  /** Description with the concrete situation, like the base-tier blockers. */
  d: string;
  /** Suggested responses (macOS-style, most constructive first). */
  r: string[];
}

interface SingleAssignment {
  /** Display name. */
  n: string;
  /** Goal sentence. */
  g: string;
  /** Six-word-contract subtitle. */
  c: string;
  /** Roadmap item id in the Project's own roadmap. */
  i: string | null;
  /** Authored blocker; its presence makes this Agent `blocked`. */
  b?: ScaleBlockerSpec;
}

interface FanOutBatch {
  /** Name template; `#` is replaced with `partition/of`. */
  n: string;
  /** Goal template; `#` is replaced with `partition of total`. */
  g: string;
  /** Context-label template; `#` is replaced with `partition/total` so
   *  fan-out siblings never share an identical subtitle. */
  c: string;
  i: string;
  count: number;
  /** Authored blockers by partition number; those partitions are `blocked`. */
  blocked?: Readonly<Record<number, ScaleBlockerSpec>>;
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
      {
        n: 'Shadow-day scoring', g: 'Score shadow-bid trading day # against production.', c: 'Scoring shadow trading day #', i: 'DSP-31', count: 10,
        blocked: {
          4: {
            type: 'approval_required',
            t: 'The market operator revised its official numbers — score day 4 against the new ones?',
            d: 'ERCOT restated the July 9 operating day after initial publication. Scoring day 4 against the restatement moves its MAE by six percent; both scorecards are written up, and the batch summary aggregates whichever ruling makes canonical.',
            r: ['Score against the restatement', 'Keep the original publication', 'Report both in the summary'],
          },
        },
      },
      {
        n: 'Basis feature sweep', g: 'Evaluate hub-to-node basis feature candidate set # for the refit model.', c: 'Evaluating basis feature set #', i: 'DSP-31', count: 6,
        blocked: {
          2: {
            type: 'input_needed',
            t: 'Feature set 2 is more accurate but twice as slow — take the trade?',
            d: 'Candidate set 2 improves holdout MAE by 3.1% and pushes per-interval inference from 40ms to 95ms against a 60ms dispatch-loop budget. It can ship trimmed or not at all; the sweep summary needs the ruling.',
            r: ['Trim the set to fit 60ms', 'Take the latency hit', 'Drop set 2 from the sweep'],
          },
        },
      },
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
      {
        n: 'Partner verifier migration', g: 'Migrate sandbox partner # to v2 signature verification.', c: 'Migrating sandbox partner #', i: 'API-18', count: 8,
        blocked: {
          6: {
            type: 'credentials_needed',
            t: 'Partner 6 changed its credentials mid-migration — need the new ones',
            d: 'GreenVolt Installations rotated their sandbox signing secret outside the migration window, so dual-sign verification cannot be proven against their endpoint. Partners 1–5 are unaffected; partner 6 is parked until the rotated secret arrives.',
            r: ['Request the secret via the partner portal', 'Skip partner 6 for this pass', 'Escalate to the integrations channel'],
          },
        },
      },
    ],
  },
  'voltaic-home': {
    singles: [
      { n: 'Prefill coverage telemetry', g: 'Instrument how often commissioning-record prefill fills each enrollment field.', c: 'Instrumenting prefill field coverage', i: 'HOME-24' },
      { n: 'Enrollment a11y pass', g: 'Take the three-screen enrollment flow through a full accessibility pass.', c: 'Auditing enrollment flow accessibility', i: 'HOME-24' },
      {
        n: 'Savings card settlement split', g: 'Show pending versus settled earnings honestly on the savings card.', c: 'Splitting pending from settled', i: null,
        b: {
          type: 'input_needed',
          t: 'Pending earnings: show a range or a point estimate?',
          d: 'Settlement lags dispatch by up to 72 hours. A point estimate reads confident and lands up to 9% wrong; a range is honest but reads hedgy on a card customers check daily. Mocks of both are on the branch.',
          r: ['Show the range', 'Point estimate with a pending badge', 'Look at both mocks first'],
        },
      },
      { n: 'Event timeline data contract', g: 'Define the dispatch-event timeline contract with the grid-api team.', c: 'Defining event timeline contract', i: 'HOME-25' },
      { n: 'Referral deep-link spike', g: 'Spike neighbor referral deep links that prefill the address screen.', c: 'Spiking referral deep links', i: 'HOME-26' },
      { n: 'Old-flow retirement checklist', g: 'Enumerate everything still depending on the legacy enrollment flow.', c: 'Enumerating legacy flow dependencies', i: 'HOME-24' },
      { n: 'App icon badge truthing', g: 'Badge the app icon only for events that need the customer.', c: 'Restricting badge to needs-you', i: null },
      { n: 'Offline savings cache', g: 'Cache the savings card so it renders instantly offline.', c: 'Caching savings card offline', i: null },
      { n: 'Multi-site data model sketch', g: 'Sketch the account model for households with two enrolled addresses.', c: 'Sketching multi-site account model', i: 'HOME-27' },
      { n: 'Store listing refresh', g: 'Refresh app store screenshots to show the rebuilt enrollment flow.', c: 'Refreshing store listing screenshots', i: 'HOME-24' },
    ],
    fanouts: [
      {
        n: 'Flow test matrix', g: 'Run enrollment resume test matrix cell #.', c: 'Running resume matrix cell #', i: 'HOME-24', count: 10,
        blocked: {
          9: {
            type: 'input_needed',
            t: 'One flow fails only on the iOS 19 beta — hold the launch on it or waive it?',
            d: 'Resume-from-background drops the entered address on iOS 19 beta 3 and nowhere else. If GA gates on released OS versions only, cell 9 becomes a tracked waiver; if betas count, the flow needs a state-serialization fix first.',
            r: ['Waive and track for iOS 19 GA', 'Fix before GA', 'Reproduce on beta 4 first'],
          },
        },
      },
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
      {
        n: 'July reconciliation partition', g: 'Reconcile double-counted July window partition # against vendor portals.', c: 'Reconciling July partition #', i: 'TEL-14', count: 14,
        blocked: {
          11: {
            type: 'input_needed',
            t: 'Partition 11 holds 2,100 readings the vendor portal lacks — which record wins?',
            d: 'The double-counted window in partition 11 overlaps a gateway firmware reboot; our pipeline kept 2,100 readings the vendor portal never received. Reconciling toward either side moves July settlement by $412, and both deltas are staged.',
            r: ['Trust our pipeline', 'Trust the vendor portal', 'Split at the reboot timestamp'],
          },
        },
      },
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
      {
        n: 'Vendor conformance run', g: 'Run the adapter conformance suite against vendor bench #.', c: 'Running vendor bench #', i: 'EDGE-10', count: 6,
        blocked: {
          2: {
            type: 'input_needed',
            t: 'Bench 2 shipped on firmware 4.2.1 but the fleet runs 4.1.9 — test which?',
            d: 'The vendor pre-flashed bench 2 with a firmware the fleet has not adopted. Conformance against 4.2.1 validates a future we have not scheduled; reflashing to 4.1.9 costs a bench day. The other five benches are unaffected.',
            r: ['Reflash to 4.1.9', 'Test 4.2.1 and note the skew', 'Run both, half suite each'],
          },
        },
      },
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
      {
        n: 'Portal accessibility audit', g: 'Audit portal surface area segment # for accessibility.', c: 'Auditing portal segment #', i: 'POR-11', count: 4,
        blocked: {
          3: {
            type: 'approval_required',
            t: 'Segment 3 contrast fix changes the utility’s co-branded header — approve the brand exception?',
            d: 'The co-branded header fails WCAG AA contrast in segment 3, and that palette is contractually the utility’s. Shipping the fix needs either their brand team’s sign-off or an approved exception noted in the audit record.',
            r: ['Request utility sign-off', 'File the exception note', 'Restrict the fix to non-branded chrome'],
          },
        },
      },
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
      {
        n: 'Control evidence capture', g: 'Wire automated evidence capture for audit control #.', c: 'Wiring control capture #', i: 'INF-21', count: 10,
        blocked: {
          7: {
            type: 'approval_required',
            t: 'Needs permission to write into the auditor evidence store',
            d: 'Automating access-review capture (CC6.2) requires a role with direct write access to the immutable evidence store. The role policy passed security review in draft; granting it is an explicit go-ahead, not an inference call.',
            r: ['Grant the drafted role', 'Scope it to this audit window', 'Route through the manual uploader'],
          },
        },
      },
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
      {
        n: 'Queue region scan', g: 'Scan interconnection queue region # for storage entries ahead of ours.', c: 'Scanning queue region #', i: 'RES-8', count: 3,
        blocked: {
          2: {
            type: 'approval_required',
            t: 'Region 2 queue data sits behind a paid mirror — approve the $240/mo subscription?',
            d: 'The ISO’s public queue export for region 2 lags six weeks, so the scan would report stale positions. A commercial mirror carries same-day data. Spend needs explicit approval before the desk relies on it.',
            r: ['Approve the subscription', 'Use the lagged public export', 'One-month trial, then decide'],
          },
        },
      },
    ],
  },
  'demand-gen': {
    singles: [
      { n: 'Landing variant build brief', g: 'Brief the landing page A/B variant that carries the new launch story.', c: 'Briefing landing page variant', i: 'MKT-9' },
      { n: 'Claims evidence table', g: 'Trace every launch claim to cleared pilot data in one table.', c: 'Tracing claims to evidence', i: 'MKT-9' },
      { n: 'Press one-pager tightening', g: 'Cut the press one-pager to a single ruthless page.', c: 'Tightening press one-pager', i: 'MKT-9' },
      { n: 'Kitchen-table savings sheet', g: 'Draft the installer savings one-pager with real pilot numbers.', c: 'Drafting installer savings sheet', i: 'MKT-10' },
      {
        n: 'Neighborhood story shortlist', g: 'Shortlist pilot neighborhoods with story-worthy savings results.', c: 'Shortlisting neighborhood savings stories', i: 'MKT-11',
        b: {
          type: 'approval_required',
          t: 'The three strongest stories need consent outreach to eight pilot households',
          d: 'The shortlist’s best savings numbers belong to named pilot customers. Marketing cannot contact them without program-consent sign-off from customer ops; the outreach drafts are written and attached.',
          r: ['Approve the outreach', 'Anonymize the stories instead', 'Ask customer ops to make first contact'],
        },
      },
      { n: 'Case study distribution plan', g: 'Plan distribution for the Pflugerville case study beyond the blog.', c: 'Planning case study distribution', i: 'MKT-8' },
    ],
    fanouts: [],
  },
  'support-ops': {
    singles: [
      { n: 'Routing rule drafts', g: 'Draft help-desk routing rules from the symptom taxonomy.', c: 'Drafting symptom routing rules', i: 'SUP-5' },
      {
        n: 'Digest context enrichment', g: 'Attach site, hardware, and dispatch context to escalation digest entries.', c: 'Enriching escalation digest context', i: 'SUP-6',
        b: {
          type: 'credentials_needed',
          t: 'Needs read-only access to help-desk tickets',
          d: 'Joining dispatch context onto ticket text requires help-desk API access, but the only token on file is admin-scoped. A read-only token scoped to ticket bodies has been requested from IT; nothing ships against admin credentials.',
          r: ['Chase IT for the scoped token', 'Approve temporary admin-token use', 'Park until the token arrives'],
        },
      },
      { n: 'Troubleshooter failure modes', g: 'Rank the top enrollment failure modes for the self-serve troubleshooter.', c: 'Ranking enrollment failure modes', i: 'SUP-7' },
      { n: 'Macro voice audit', g: 'Spot-check rewritten macros against the support voice guide.', c: 'Spot-checking macro voice', i: 'SUP-4' },
    ],
    fanouts: [
      {
        n: 'Backlog classification week', g: 'Classify historical ticket backlog week # into the symptom taxonomy.', c: 'Classifying backlog week #', i: 'SUP-5', count: 6,
        blocked: {
          5: {
            type: 'input_needed',
            t: 'Week 5 tickets predate the taxonomy v2 split — classify under old or new codes?',
            d: 'The taxonomy split “no data reported” into gateway-offline and meter-silent after week 5 was filed. Back-classifying needs a rule for tickets whose evidence no longer distinguishes the two.',
            r: ['Map ambiguous tickets to gateway-offline', 'Add an unresolved-legacy code', 'Sample 50 and decide from evidence'],
          },
        },
      },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* deterministic agent synthesis                                       */
/* ------------------------------------------------------------------ */

type ScaleStatus = DemoFleetAgent['status'];

/**
 * Weighted status wheel — mostly quiet work. `blocked` is deliberately NOT
 * on the wheel: an Agent is blocked exactly when its assignment carries an
 * authored `ScaleBlockerSpec`, so every needs-you row is written, never
 * generated filler.
 */
const STATUS_WHEEL: Array<{ status: ScaleStatus; upTo: number }> = [
  { status: 'working', upTo: 0.36 },
  { status: 'idle', upTo: 0.6 },
  { status: 'reviewing', upTo: 0.7 },
  { status: 'complete', upTo: 0.92 },
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

/** Character budget for the name portion of a generated branch. */
const BRANCH_NAME_BUDGET = 32;

/**
 * Branch-name slug: trims at WORD boundaries only, and never drops the
 * trailing partition token (`3/14` slugifies to `3-14`), so every partition
 * of a fan-out batch gets its own branch and no branch ends mid-word.
 */
function branchSlug(name: string): string {
  const words = slugify(name).split('-');
  const partition: string[] = [];
  while (words.length > 1 && /^\d+$/.test(words[words.length - 1])) {
    partition.unshift(words.pop() as string);
  }
  const kept: string[] = [];
  let length = 0;
  for (const word of words) {
    const next = length === 0 ? word.length : length + 1 + word.length;
    if (next > BRANCH_NAME_BUDGET && kept.length > 0) break;
    kept.push(word);
    length = next;
  }
  return [...kept, ...partition].join('-');
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

/**
 * Delegated child-task templates per business function, so a Researcher
 * never fans out coding-flavored work (a Marketer running "test coverage"
 * would break the preview-desk story on a drill-in).
 */
const CHILD_TASK_STEMS: Record<
  'coding' | 'research' | 'marketing' | 'support',
  { explore: string; general: string }
> = {
  coding: { explore: 'Survey prior art', general: 'Test coverage' },
  research: { explore: 'Primary source sweep', general: 'Citation and figure check' },
  marketing: { explore: 'Prior campaign scan', general: 'Claim fact-check' },
  support: { explore: 'Ticket sample pull', general: 'Macro tone audit' },
};

function childStemsFor(fn: DemoProjectFunction) {
  if (isCodingFunction(fn)) return CHILD_TASK_STEMS.coding;
  return CHILD_TASK_STEMS[fn as 'research' | 'marketing' | 'support'];
}

/** Deterministic per-child spread around an authored base so no two
 *  delegated runs report identical usage. */
function jitterUsage(key: string, base: number): number {
  return Math.round(base * (0.55 + unit(key) * 0.9));
}

function delegatedFor(
  id: string,
  source: 'claude-code' | 'codex',
  status: ScaleStatus,
  assignmentName: string,
  startedAtMs: number,
  projectFunction: DemoProjectFunction
): DemoDelegatedRun[] {
  // Only Claude Code records delegation (`SOURCE_CAPABILITIES.codex` has
  // none), and only a slice of ACTIVE work fans out, so delegating parents
  // read as a pattern of real work rather than a uniform decoration.
  if (source !== 'claude-code') return [];
  if (status !== 'working' && status !== 'reviewing') return [];
  const roll = unit(`${id}:delegate`);
  if (roll > 0.45) return [];
  const stems = childStemsFor(projectFunction);
  const children: DemoDelegatedRun[] = [
    {
      agentId: `agent-${Math.floor(unit(`${id}:child0`) * 0xffff)
        .toString(16)
        .padStart(4, '0')}`,
      agentType: 'Explore',
      model: 'claude-sonnet-5',
      task: `${stems.explore}: ${assignmentName}`,
      startedAtMs: startedAtMs + 20 * MIN_MS,
      usage: {
        input: jitterUsage(`${id}:child0:in`, 34_000),
        cacheRead: jitterUsage(`${id}:child0:cr`, 1_200_000),
        cacheWrite: jitterUsage(`${id}:child0:cw`, 130_000),
        output: jitterUsage(`${id}:child0:out`, 46_000),
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
      task: `${stems.general}: ${assignmentName}`,
      startedAtMs: startedAtMs + 50 * MIN_MS,
      usage: {
        input: jitterUsage(`${id}:child1:in`, 28_000),
        cacheRead: jitterUsage(`${id}:child1:cr`, 940_000),
        cacheWrite: jitterUsage(`${id}:child1:cw`, 110_000),
        output: jitterUsage(`${id}:child1:out`, 41_000),
      },
    });
  }
  return children;
}

const FAULT_STEMS = [
  'Verification run exited non-zero on the final check; the failure reproduces and needs a human read.',
  'Dependency of this task changed underneath the run; rebase produced conflicts the agent will not resolve unattended.',
  'Environment prerequisite is missing on this runner; the task cannot proceed without provisioning.',
  'The working branch diverged from its roadmap item mid-run; continuing would overwrite a landed change.',
  'An upstream fixture this run replays was republished with different totals; the comparison baseline is gone.',
  'The runner lost access to the vendor sandbox partway through; partial results are recorded, nothing was retried.',
  'A step in this task needs a credential the runner does not hold; stopped before any partial write.',
  'Output validation failed twice on the same schema field; the agent stopped rather than loosen the check.',
];

/**
 * WHICH HARNESS RUNS A GENERATED AGENT (ENG-031 W13).
 *
 * `harness` and `source` are two axes and this is the one the product means
 * by "whose agent is this" (`types.ts` carries the contract). Before this the
 * fixture had one field for both, typed as a consumption ledger, so the whole
 * 173-Agent fleet could only ever be Claude Code and Codex, and every surface
 * that reads provenance -- the launcher, the Fleet board's source lens, the
 * marketing capture -- inherited that ceiling from a consumption type.
 *
 * TWO RULES DECIDE THE SPREAD, and both are read off
 * `contracts/agent-sources.json` rather than chosen for variety:
 *
 * 1. **A harness may only run models its own catalog serves.** So the ledger
 *    narrows the candidates: a Claude-family Session may be launched by Claude
 *    Code, by an OpenClaw gateway, or by the multi-provider OpenCode CLI, and
 *    a GPT-family Session by Codex, OpenCode, or Grok Build. The one loose
 *    pairing this leaves is recorded in `types.ts` with its reason.
 * 2. **Only a harness that OBSERVES delegation may parent one.** Claude Code
 *    reports lifecycle events, Codex reports app-server parent/child, and an
 *    OpenClaw gateway reports protocol events. OpenCode's PTY reports nothing
 *    and Grok Build reports only to hooks Exawatt cannot inject per launch, so
 *    neither may carry children here. The demo must not fake a record the real
 *    source cannot produce, which is the same rule that already kept Codex
 *    children out of this file.
 *
 * Weights are the operator mix the consumption corpus cites, unchanged: the
 * two native CLIs stay the majority and the other three are the long tail.
 */
const HARNESS_BY_LEDGER: Record<
  DemoFleetAgent['source'],
  readonly AgentSourceAdapterId[]
> = {
  'claude-code': ['claude', 'claude', 'claude', 'claude', 'openclaw', 'opencode'],
  codex: ['codex', 'codex', 'codex', 'codex', 'opencode', 'grok'],
  grok: ['grok'],
};

/** Harnesses that can report a delegated run, per the source contract. */
const DELEGATION_OBSERVING: readonly AgentSourceAdapterId[] = [
  'claude',
  'codex',
  'openclaw',
];

function harnessFor(
  id: string,
  ledger: DemoFleetAgent['source'],
  delegates: boolean
): AgentSourceAdapterId {
  const candidates = HARNESS_BY_LEDGER[ledger].filter(
    adapter => !delegates || DELEGATION_OBSERVING.includes(adapter)
  );
  const pool = candidates.length > 0 ? candidates : HARNESS_BY_LEDGER[ledger];
  return pool[Math.floor(unit(`${id}:harness`) * pool.length)] ?? pool[0]!;
}

function synthesizeAgent(
  projectKey: string,
  name: string,
  goal: string,
  contextLabel: string,
  roadmapItemId: string | null,
  linkPreference: DemoFleetAgent['link'],
  authoredBlocker?: ScaleBlockerSpec
): DemoFleetAgent {
  const project = DEMO_PROJECTS_BY_KEY.get(projectKey);
  if (!project) throw new Error(`unknown demo project "${projectKey}"`);
  const id = `vgs-${projectKey}-${slugify(name)}`;
  const status: ScaleStatus = authoredBlocker ? 'blocked' : statusFor(id);
  // Preview desks run on Claude in this fleet. Coding leans codex-majority,
  // matching the measured operator mix the consumption corpus cites (Codex
  // sessions are the majority; Claude sessions are individually larger) —
  // the W7 full-fleet corpus keeps that property with current sessions in.
  const source: DemoFleetAgent['source'] =
    project.readiness === 'preview'
      ? 'claude-code'
      : unit(`${id}:source`) < 0.4
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
  // Human-touch count, authored by the same deterministic recipe as every
  // other scale-tier field: most sessions run near-untouched (the fleet
  // story), a blocked session carries the operator gate that blocked it.
  const interventions =
    Math.floor(unit(`${id}:interventions`) * 3) + (authoredBlocker ? 1 : 0);

  const delegated = delegatedFor(
    id,
    source,
    status,
    name,
    startedAtMs,
    project.function
  );

  const agent: DemoFleetAgent = {
    id,
    name,
    projectKey,
    goal,
    contextLabel,
    status,
    source,
    harness: harnessFor(id, source, delegated.length > 0),
    model,
    effort,
    gitBranch:
      source === 'claude-code' && project.readiness === 'live'
        ? `agent/${slugify(roadmapItemId ?? projectKey)}-${branchSlug(name)}`
        : null,
    roadmapItemId,
    link: roadmapItemId === null ? null : linkPreference,
    startedAtMs,
    lastActivityAtMs,
    turns,
    interventions,
    usage: usageFor(id, source, turns),
    delegated,
    readiness: project.readiness,
    tier: 'scale',
    initiativeId: demoInitiativeIdForWork(projectKey, roadmapItemId),
  };

  if (authoredBlocker) {
    agent.blocker = {
      type: authoredBlocker.type,
      title: authoredBlocker.t,
      description: authoredBlocker.d,
      suggestedResponses: authoredBlocker.r,
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
          linkRoll < 0.5 ? 'declared' : linkRoll < 0.8 ? 'branch' : 'title',
          single.b
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
            // `4/10`, not `4 of 10` — the label must hold the D33 six-word cap
            batch.c.replace('#', `${part}/${batch.count}`),
            batch.i,
            'declared', // batch launches declare their item at spawn
            batch.blocked?.[part]
          )
        );
      }
    }
  }
  return out;
}

let scaleCache: readonly DemoFleetAgent[] | null = null;

/** The canonical (frozen) generated tier. Frozen so consumer mutation can
 * never corrupt "reset = identical"; rebasing derives fresh copies. */
function scaleAgents(): readonly DemoFleetAgent[] {
  if (!scaleCache) scaleCache = deepFreezeFixture(generateScaleAgents());
  return scaleCache;
}

/**
 * INTERNAL, for tests: rebuild the generated tier from scratch, bypassing
 * the module cache, so determinism is provable against an INDEPENDENT build
 * rather than by comparing a cached object to itself.
 */
export function rebuildScaleTierForTest(): DemoFleetAgent[] {
  return generateScaleAgents();
}

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
  const agents =
    tier === 'base' ? [...DEMO_BASE_AGENTS] : [...DEMO_BASE_AGENTS, ...scaleAgents()];
  return rebase(agents, options.nowMs ?? DEMO_WORKSPACE_NOW_MS);
}

/** Total delegated (child) runs across a tier — sub-entities on the board. */
export function demoDelegatedRunCount(tier: DemoFleetTier = 'scale'): number {
  return demoFleetAgents(tier).reduce(
    (count, agent) => count + agent.delegated.length,
    0
  );
}
