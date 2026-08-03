/**
 * Voltaic's per-Project roadmaps (ENG-027 W3).
 *
 * Each Project carries a real ROADMAP.md authored under the published
 * Exawatt roadmap convention (docs/product/reference/roadmap-convention.md).
 * They are stored as raw markdown and read through the SAME parser the live
 * roadmap lens uses (`parseRoadmap`) — the demo never invents a pre-parsed
 * shape, so nothing about these roadmaps is unique to the demo.
 *
 * Contract, enforced by `__tests__/demo-workspace.test.ts`: every document
 * parses with `declared` conformance, ZERO warn-level diagnostics, and zero
 * unparsed lines. Info-level diagnostics (status-alias normalization) are
 * allowed — real repos use aliases like `active-build`.
 */

import { parseRoadmap } from '../roadmap/parse';
import type { RoadmapDoc } from '../roadmap/types';
import { DEMO_PROJECTS_BY_KEY } from './projects';

const DISPATCH_ENGINE = `---
exawatt-roadmap: v1
---

# dispatch-engine roadmap

The optimizer that decides, every five minutes, whether each enrolled site
charges, holds, or sells — and what we bid into the market on its behalf.

## Now

### DSP-31 Nodal price forecast refit

Status: active-build — summer telemetry is in; shadow bidding started 2026-07-30.

Scope:

- retrain the nodal LMP forecaster on May-July actuals from the pilot fleet
- add ORDC adder and hub-to-node basis features for the ERCOT entry
- shadow-bid the refit model against production for ten trading days

Exit criteria:

- backtest MAE under 4.1 $/MWh on the holdout week
- shadow P&L within 2% of production on calm days, better on scarcity days

Milestones:

- [x] F1 Feature backfill from pilot telemetry
- F2 Model refit and holdout eval (landed 2026-07-28)
- [ ] F3 Ten-day shadow bidding run
- [ ] F4 Production cutover behind the bid safety rails

## Next

### DSP-32 Bid curve safety rails

Status: planned — hard ceilings and monotonicity checks before any model cutover.

Scope:

- reject non-monotone bid curves before submission
- clamp bids to per-site battery warranty limits

### DSP-33 Ancillary services co-optimization

Status: planned — bid energy and reserves jointly instead of energy-only.

## Later

### DSP-34 Sub-hourly redispatch

Status: later — re-optimize inside the operating hour when telemetry diverges from plan.

## Shipped

### DSP-30 Deterministic dispatch backtest harness

Status: done — landed 2026-07-24; every strategy change replays the same twelve market days.

### DSP-27 Day-ahead bidding v1

Status: done — landed 2026-06-30; first revenue week cleared 2026-07-06.
`;

const GRID_API = `---
exawatt-roadmap: v1
---

# grid-api roadmap

The partner and public API: enrollment, telemetry access, and dispatch
webhooks for utilities and installers.

## Now

### API-18 Webhook signing v2

Status: active-build — dual-sign window open since 2026-07-29.

Scope:

- rotate from shared-secret HMAC to per-partner asymmetric signing
- dual-sign during the migration window so no partner breaks
- publish a verification library and migration guide

Exit criteria:

- every sandbox partner verifies v2 signatures before the shared secret is retired
- zero webhook deliveries rejected during the dual-sign window

Milestones:

- [x] W1 Key issuance and partner key registry
- W2 Dual-sign delivery path (landed 2026-07-29)
- [ ] W3 Partner verification and cutover
- [ ] W4 Shared-secret retirement

## Next

### API-19 Partner sandbox self-service reset

Status: blocked — key-rotation approval from the utility program manager is pending.

Scope:

- let partners reset sandbox state without filing a support ticket

### API-20 Usage-tiered rate limits

Status: planned — burst tiers per partner class instead of one global limit.

## Later

### API-21 Public read-only fleet statistics

Status: later — anonymized fleet-level stats for press and researchers.

## Shipped

### API-17 Honest rate-limit headers

Status: done — landed 2026-07-21; limits, remaining, and reset on every response.

### API-15 Enrollment API v2

Status: done — landed 2026-07-02; installers enroll a site in one call.
`;

const VOLTAIC_HOME = `---
exawatt-roadmap: v1
---

# voltaic-home roadmap

The customer app. Enrollment, live savings, outage backup status, and
honest dispatch-event transparency.

## Now

### HOME-24 Onboarding flow rebuild

Status: active-build — the old flow loses 38% of started enrollments; rebuild started 2026-07-27.

Scope:

- collapse enrollment to three screens: address, hardware, utility account
- inline hardware detection from the installer's commissioning record
- resumable enrollment — leaving the flow never loses progress

Exit criteria:

- started-to-completed enrollment above 80% for the pilot cohort
- zero support tickets caused by lost enrollment progress

Milestones:

- [x] O1 Three-screen flow behind a feature flag
- O2 Commissioning-record hardware prefill (landed 2026-07-31)
- [ ] O3 Resumable state and abandonment telemetry
- [ ] O4 Flag removal and old-flow retirement

## Next

### HOME-25 Dispatch-event transparency screen

Status: planned — show customers exactly when and why their battery was dispatched, and what it earned.

### HOME-26 Referral loop

Status: planned — neighbors enrolling neighbors is the cheapest acquisition channel we have.

## Later

### HOME-27 Multi-site households

Status: later — one account commanding batteries at two addresses.

## Shipped

### HOME-22 Outage banner state machine

Status: done — landed 2026-07-25; backup state is now truthful during grid events.

### HOME-21 Live savings card

Status: done — landed 2026-07-11; month-to-date earnings with an honest pending-settlement split.
`;

const TELEMETRY_INGEST = `---
exawatt-roadmap: v1
---

# telemetry-ingest roadmap

Per-second battery, inverter, and charger readings from every enrolled
site, normalized across four hardware vendors.

## Now

### TEL-14 Ingest backfill dedupe

Status: active-build — gateway retry storms double-count readings; dedupe keyed on device-sequence started 2026-07-30.

Scope:

- idempotency keys derived from device id plus vendor sequence number
- reconcile the July double-counted window without taking ingest offline

Exit criteria:

- replaying any gateway retry storm produces zero duplicate readings
- the July window reconciles to within 0.1% of vendor portal totals

Milestones:

- [x] B1 Sequence-number audit across all four vendors
- [ ] B2 Idempotent write path
- [ ] B3 July window reconciliation

## Next

### TEL-15 Meter drift alerting

Status: blocked — ops has not chosen the drift tolerance; 0.5% and 2% imply different alert volumes.

### TEL-16 Cold storage tiering

Status: planned — per-second data older than 90 days moves to cold storage with query passthrough.

## Later

### TEL-17 Firehose replay tooling

Status: later — replay any historical hour against a candidate pipeline build.

## Shipped

### TEL-13 Gap detection

Status: done — landed 2026-07-18; silent gateway outages surface within two minutes.

### TEL-12 Per-vendor normalization

Status: done — landed 2026-07-03; one canonical reading schema across all vendors.
`;

const EDGE_GATEWAY = `---
exawatt-roadmap: v1
---

# edge-gateway roadmap

The software on the site gateway: vendor protocol adapters, local safety
limits, and over-the-air updates for a fleet we cannot walk up to.

## Now

### EDGE-9 OTA rollback path

Status: active-build — an update that bricks a gateway strands a battery; rollback work started 2026-07-28.

Scope:

- A/B partition scheme so a failed update reverts on next boot
- health self-check that must pass before an update is marked good
- staged rollout with automatic halt on elevated failure rate

Exit criteria:

- a deliberately broken build deployed to the lab fleet reverts unattended on every unit
- no staged rollout can pass 5% of the fleet while failures are elevated

Milestones:

- [x] R1 A/B partition layout on the lab fleet
- R2 Boot-time health self-check (landed 2026-08-01)
- [ ] R3 Staged rollout with automatic halt
- [ ] R4 Production fleet migration

## Next

### EDGE-10 Modbus adapter conformance suite

Status: planned — one conformance suite all four vendor adapters must pass, replacing per-adapter ad-hoc tests.

## Later

### EDGE-11 Local islanding heuristics

Status: later — smarter backup reserve decisions when the grid connection is unstable.

## Parked

### EDGE-7 Direct Zigbee device control

Status: parked — every current vendor terminates Zigbee at their own hub; revisit only if that changes.

## Shipped

### EDGE-8 Signed update channel

Status: done — landed 2026-07-15; gateways verify update signatures before flashing.
`;

const PARTNER_PORTAL = `---
exawatt-roadmap: v1
---

# partner-portal roadmap

Where installers commission sites and utilities watch their program:
fleet health, commissioning, and settlement statements.

## Now

### POR-11 Installer scheduling calendar

Status: active-build — installers coordinate commissioning over text messages today; calendar started 2026-07-29.

Scope:

- commissioning appointment booking against installer availability
- automatic reminders and homeowner confirmation
- reschedule without losing the commissioning record

Exit criteria:

- a pilot installer books and completes a commissioning without leaving the portal
- no-show rate for scheduled commissionings drops below 10%

Milestones:

- [x] C1 Availability model and booking flow
- [ ] C2 Reminders and homeowner confirmation
- [ ] C3 Pilot with two Austin installers

## Next

### POR-12 Utility SSO

Status: blocked — waiting on SAML IdP metadata from the utility's IT team, requested 2026-07-22.

### POR-13 Settlement statement export

Status: planned — monthly per-program settlement statements as signed PDFs.

## Later

### POR-14 Commissioning checklists v2

Status: later — vendor-specific checklists generated from the hardware profile.

## Shipped

### POR-10 Fleet health board

Status: done — landed 2026-07-20; utilities see enrollment, availability, and dispatch performance per program.
`;

const PLATFORM_INFRA = `---
exawatt-roadmap: v1
---

# platform-infra roadmap

Cloud infrastructure, deploy pipelines, and the SOC 2 evidence trail.
Boring on purpose; the market does not wait for us to redeploy.

## Now

### INF-21 SOC 2 evidence collector

Status: active-build — evidence is collected continuously, not screenshotted quarterly; started 2026-07-26.

Scope:

- automated evidence capture for access reviews, deploy approvals, and backup restores
- evidence lands in the auditor-shared store with immutable timestamps
- coverage map showing which controls still need manual evidence

Exit criteria:

- the auditor's Q3 sample request is answered from the store without a single screenshot session
- every control in the audit scope maps to an automated or explicitly manual source

Milestones:

- [x] S1 Control-to-source coverage map
- S2 Deploy approval and access review capture (landed 2026-07-30)
- [ ] S3 Backup-restore drill capture
- [ ] S4 Auditor store handoff

## Next

### INF-22 Postgres 17 upgrade

Status: planned — rehearsed on a production clone first; the dispatch write path cannot pause longer than 60 seconds.

### INF-23 Spot capacity bidder

Status: planned — batch and simulation workloads move to spot instances with checkpointed resume.

## Later

### INF-24 Multi-region dispatch failover

Status: later — the dispatch loop survives a region loss inside one market interval.

## Shipped

### INF-20 On-call noise diet

Status: done — landed 2026-07-17; page volume down 70% with zero missed real incidents since.

### INF-19 Deploy provenance attestations

Status: done — landed 2026-07-08; every artifact traces to a reviewed commit.
`;

const MARKET_INTEL = `---
exawatt-roadmap: v1
---

# market-intel roadmap

The research desk. ISO rule changes, tariff filings, and interconnection
queues — digested into decisions the dispatch team can act on.

## Now

### RES-7 ERCOT rule-change watch

Status: active-build — NPRR filings tracked daily during the market-entry window; started 2026-07-21.

Scope:

- track new and revised NPRR filings and flag the ones touching storage dispatch
- one-page impact briefs, each citing the filing text it summarizes
- weekly delta digest for the dispatch and legal leads

Exit criteria:

- no storage-relevant filing older than two business days without a brief
- every brief links its primary sources; no unsourced claims

Milestones:

- [x] N1 Filing tracker and relevance rubric
- [ ] N2 Impact briefs for the open storage dockets
- [ ] N3 Weekly digest cadence through the entry window

## Next

### RES-8 Interconnection queue digest

Status: planned — what is ahead of us in the queue, and what withdrawal patterns say about timing.

## Later

### RES-9 CAISO demand-response brief

Status: later — entry analysis for the second market once ERCOT revenue is real.

## Shipped

### RES-6 Tariff library v1

Status: done — landed 2026-07-14; every pilot utility's tariff, indexed and cited.
`;

const DEMAND_GEN = `---
exawatt-roadmap: v1
---

# demand-gen roadmap

Growth and the launch narrative. Enrollment campaigns, case studies, and
the story we tell when Voltaic Home goes GA.

## Now

### MKT-9 GA launch narrative

Status: active-build — draft two of the launch story in review since 2026-07-31.

Scope:

- the launch story: your battery earns while the grid gets steadier
- landing page copy, launch post, and the press one-pager, one voice across all three
- claims audit — every number traces to pilot data legal has cleared

Exit criteria:

- launch copy approved by product and legal with zero unsupported claims
- landing page variant beats the current page on enrollment starts in an A/B test

Milestones:

- [x] G1 Message architecture and claims inventory
- [ ] G2 Draft three across all launch surfaces
- [ ] G3 Claims audit sign-off
- [ ] G4 A/B test against the current landing page

## Next

### MKT-10 Installer co-marketing kit

Status: planned — installers sell Voltaic at the kitchen table; give them the material to do it well.

## Later

### MKT-11 Neighborhood savings stories

Status: later — localized enrollment campaigns built on real per-neighborhood pilot results.

## Shipped

### MKT-8 Pilot case study

Status: done — landed 2026-07-23; the Pflugerville pilot wrote our first credible savings story.
`;

const SUPPORT_OPS = `---
exawatt-roadmap: v1
---

# support-ops roadmap

The support desk. Ticket triage, escalation digests, and enrollment
troubleshooting for a fleet of homes, not data centers.

## Now

### SUP-5 Ticket triage taxonomy

Status: active-build — one shared taxonomy so triage routes by symptom, not by guess; started 2026-07-28.

Scope:

- classify the trailing 90 days of tickets into a stable symptom taxonomy
- routing rules from symptom class to owning team
- weekly report of top symptom classes with example tickets

Exit criteria:

- 90% of new tickets route to the right owning team without manual re-triage
- the weekly report names the top three symptom classes with real examples

Milestones:

- [x] T1 Trailing-90-day ticket classification
- [ ] T2 Routing rules in the help desk
- [ ] T3 First weekly symptom report

## Next

### SUP-6 Escalation digest

Status: planned — one daily digest of escalations with context, replacing ad-hoc pings to engineers.

## Later

### SUP-7 Self-serve enrollment troubleshooter

Status: later — the top five enrollment failure modes, resolvable by the customer without a ticket.

## Shipped

### SUP-4 Macro library cleanup

Status: done — landed 2026-07-19; stale macros retired, the rest rewritten in one voice.
`;

/** Raw roadmap markdown per Project key. Authored, versioned, resettable. */
export const DEMO_ROADMAP_MARKDOWN: Readonly<Record<string, string>> =
  Object.freeze({
    'dispatch-engine': DISPATCH_ENGINE,
    'grid-api': GRID_API,
    'voltaic-home': VOLTAIC_HOME,
    'telemetry-ingest': TELEMETRY_INGEST,
    'edge-gateway': EDGE_GATEWAY,
    'partner-portal': PARTNER_PORTAL,
    'platform-infra': PLATFORM_INFRA,
    'market-intel': MARKET_INTEL,
    'demand-gen': DEMAND_GEN,
    'support-ops': SUPPORT_OPS,
  });

const parsed = new Map<string, RoadmapDoc>();

/**
 * The parsed roadmap for one demo Project — through the real parser, never
 * around it. Deterministic (`parsedAt` pinned) and cached.
 */
export function demoProjectRoadmap(projectKey: string): RoadmapDoc {
  const cached = parsed.get(projectKey);
  if (cached) return cached;
  const markdown = DEMO_ROADMAP_MARKDOWN[projectKey];
  const project = DEMO_PROJECTS_BY_KEY.get(projectKey);
  if (!markdown || !project) {
    throw new Error(`no demo roadmap for project key "${projectKey}"`);
  }
  const doc = parseRoadmap(markdown, {
    projectDir: project.dir,
    file: 'ROADMAP.md',
    now: () => 0,
  });
  parsed.set(projectKey, doc);
  return doc;
}

/** Every item id declared across a Project's roadmap. */
export function demoRoadmapItemIds(projectKey: string): Set<string> {
  return new Set(
    demoProjectRoadmap(projectKey)
      .items.map(item => item.declaredId)
      .filter((id): id is string => id !== null)
  );
}
