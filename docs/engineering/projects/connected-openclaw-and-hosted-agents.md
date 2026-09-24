# Connected OpenClaw and hosted Agents (ENG-010 / ENG-033)

ENG-010's connect-to-existing implementation is complete through C5. ENG-033
owns the hosted product progression; H3/H4 remain planned and inactive, with no
paid-cloud implementation active. This document is their shared execution
detail, not a second roadmap.

## Outcome

The operator sees Marcus, Scout, and Tyler beside local coding Agents as three
individual coworkers, opens their current work, talks to them, quits Exawatt,
and returns to the same relationships without changing where they run.

The first executable slice is intentionally narrower: connect and observe the
existing OpenClaw Agents read-only, then prove identity and reattachment before
adding command authority.

## Design brief

Status: shaped 2026-08-16. The operator confirmed the coworker model, the
connect-first hosted progression, and the requirement that the taxonomy remain
a two-way door. The operator also confirmed one coworker with subordinate work
as the default, while requiring that projection policy and the exact
multi-context presentation remain deliberately revisable.

### Problem

Exawatt currently makes local coding conversations feel like Agents, while the
operator's long-lived OpenClaw coworkers run on two separate VPS installations.
OpenClaw's configured Agent, Gateway, and Session topology does not match the
current one-tab/one-Session implementation. A literal import would either
multiply one person into dozens of Session rows or hide durable people behind
a source-instance abstraction.

The product must answer “who is doing work?” first, then retain enough source
truth to answer “where and how?” without forcing the operator to think in
sessions.

### Primary user and jobs

Primary user: an operator who already runs named local and remote agents and
wants one daily command surface.

Core jobs:

- see every active coworker and whether it is local or remote;
- open one coworker at a stable conversational front door and understand
  current work without scanning raw contexts;
- continue the main conversation when command authority lands;
- distinguish Agent state from connection freshness;
- quit and relaunch without stopping remote work or losing the selected Agent;
- revise names, Project placement, and topology mapping without touching the
  source.

Anchor stories:

- **Return to Tyler:** after Exawatt was closed overnight, opening Tyler returns
  to the same conversation, refreshes what happened remotely, and never implies
  that Tyler had been paused.
- **Leave Tyler working:** quitting Exawatt during Tyler's Reddit work detaches
  the client only. Reopening reattaches to Tyler and shows the posts, progress,
  and current work produced while the client was absent; no Resume is offered.
- **Park a local coder:** pausing a local Claude Code Agent, quitting, reopening,
  and resuming re-inflates the exact retained Session. A future remote Pause
  must earn that same continuity promise rather than approximate it.
- **Marcus is busy:** three active posts and several historical cron runs still
  produce one Marcus card; meaningful current work expands beneath him.
- **Scout delegates:** a bounded calendar-research child appears as Scout's
  delegated work and result, not as a surprise fourth coworker.
- **Create a peer:** when the operator wants another persistent marketer, an
  explicit create/clone action makes a named Agent from the same Type; a second
  Session or concurrent task never does so accidentally.

### Product hierarchy

| Layer        | Product meaning                      | First OpenClaw mapping                          |
| ------------ | ------------------------------------ | ----------------------------------------------- |
| Workspace    | operator/team boundary               | current Personal Workspace                      |
| Project      | renameable context group             | suggested per imported Agent; editable          |
| Agent        | coworker shown in Agent/Team/Fleet   | configured OpenClaw Agent                       |
| Agent Type   | reusable profession/blueprint        | optional explicit mapping later; never inferred |
| Session      | subordinate context/execution record | main, channel, cron, helper, spawned context    |
| Agent Source | configured runtime instance          | one saved OpenClaw installation                 |
| Gateway      | transport into the source            | local connection or SSH-backed tunnel           |
| Placement    | where/whose infrastructure           | Local, Remote, or Exawatt Cloud                 |

Current local coding launches remain mission-bound Agents backed one-to-one by
their current Session. That is a supported projection, not a requirement that
OpenClaw imitate it.

### Agent home and work stack

Each Agent may declare one primary conversation role. Opening the Agent returns
to that stable address; it never guesses from the latest or busiest Session.

- For OpenClaw, the primary conversation is the configured Agent's exact
  `agent:<agentId>:main` Session. OpenClaw already treats it as Home: direct
  conversation converges there, heartbeats wake it, and background work reports
  back to it.
- For a mission-bound coding Agent, the current provider conversation fills the
  same role.
- A source with no stable address opens Agent summary with communication
  unavailable instead of fabricating continuity.

The rest of an Agent's activity is a subordinate work stack, not a row of
cloned coworkers. Meaningful threads, channel contexts, automations, tasks,
runs, and delegated children can appear in Agent detail as work and evidence;
historical noise stays collapsed. A transient OpenClaw subagent is delegated
work beneath its requester and reports back there. A separately configured,
persistent, directly addressable source Agent remains a peer coworker.

When command authority lands, the normal composer addresses the primary
conversation. Opening a subordinate context may expose an explicitly labelled
reply action for that context, but viewing recent work never silently retargets
the normal composer. Concurrency does not create an Agent automatically. A
future explicit create/clone action may make another named coworker from the
same Agent Type when the operator wants a persistent peer rather than delegated
work.

### Dogfood topology

- Gateway A exposes active configured Agents Scout and the Reddit Agent. The
  brief calls the latter "Marcus" throughout, but Marcus is the Reddit persona
  it posts under, not the coworker's name (corrected 2026-08-17). Its
  configured source name is a lowercase role slug; Exawatt shows that by default
  and the operator may rename it. Read every "Marcus" below as "the Reddit
  Agent".
- Gateway B exposes active configured Agent Tyler.
- Priya exists only as retired/dormant history and is not imported into the
  active roster unless the operator explicitly chooses it from source detail.
- Historical cron/helper contexts remain subordinate to their configured Agent
  and do not become coworkers.

No endpoint, IP address, token, password, or key belongs in fixtures, logs,
screenshots, or canonical docs.

### Information architecture

There is no separate “remote agents” workspace.

- **⌘N** gains a first-class **Connect a server…** route beside Project
  open/create. It creates a configured Agent Source, discovers its Agents, and
  asks which Project the selected Agents join.
- **Settings → Agent Sources** remains the complete source-instance and
  connection-health surface.
- **Agent, Team, and Fleet** remain the daily operating surfaces. Agent name and
  responsibility lead; source and placement are secondary identity.
- The existing `/cloud` preview becomes the eventual management/provisioning
  face for Exawatt-hosted placement, not a second roster.

Project mapping is explicit and chosen once for the batch (ENG-033 H2.4 P2):
the default is the Project the connected coworkers already live in, by
identity, or a new Project named Remote; the operator may choose any existing
Project instead. A Gateway is never silently turned into a Project.

### Connect flow

1. Invoke **⌘N → Connect a server…** (also File → Connect a Server… and
   Settings).
2. Pick an existing SSH host alias, filtered by typing, or describe a server.
   OpenClaw is the only connectable adapter, so there is no adapter step until
   a second one exists. Exawatt may passively list named SSH aliases and
   source-owned saved remote targets from local configuration, but it never
   probes or connects to one until the operator selects it. Candidate
   enumeration reads only alias/endpoint metadata and never imports secret
   payloads.
3. Open a bounded SSH-forwarded tunnel to the source's loopback Gateway port,
   resolve the source-owned Gateway credential through that tunnel, and hold it
   in memory only. Exawatt never persists the Gateway token and never asks the
   operator to paste one when the server already declares it.
4. Run a bounded connection test on the picked server's own row and show
   identity, version, placement, credential owner, and observed capabilities
   separately (one disclosure away on that row). A failed test stays on its row
   and releases the record, so nothing is saved.
5. Discover configured Agents, listed beneath the server that answered.
   Preselect active configured Agents; show retired or historical identities
   separately and unchecked.
6. Rename any Agent in place and choose one Project for the batch.
7. Save the configured source and versioned projection; open the selected Agent
   without starting, stopping, or modifying remote work.

Failure leaves the partially entered source as an editable draft only when the
operator has authored it. No failed discovery creates roster Agents.

### Key states

| State                | What the operator sees                                           | Product rule                                                     |
| -------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| No connected sources | One concise Connect a server action                              | No fake remote roster or required hosted signup                  |
| Source draft         | Chosen adapter and local alias/endpoint reference                | Nothing is persisted as an Agent until discovery succeeds        |
| Testing              | Bounded progress with the exact step: tunnel, auth, discovery    | Cancel leaves source and remote runtime untouched                |
| Approval required    | The Gateway/device approval needed and how to complete it        | Distinct from bad credentials or an offline Agent                |
| Incompatible         | Observed source/protocol version and supported remediation       | Never falls back to shell scraping                               |
| Live                 | Current snapshot, observed-at time, and subscribed updates       | Work state remains a separate signal                             |
| Reconnecting         | Last-known content plus a quiet reconnecting treatment           | Remote work is presumed unknown, never stopped                   |
| Stale                | Last-known content and prominent observation age                 | No stale action or result is presented as current                |
| Unavailable          | Last-known identity, failure class, and Reconnect/source details | No destructive repair, pause, or remap is inferred               |
| Identity drift       | Old mapping beside newly observed source identity                | Ask to remap or detach; never guess by display name              |
| Retired native Agent | Available only in source detail, unchecked                       | Does not silently return to Agent, Team, or Fleet                |
| Detached             | Exawatt projection removed after confirmation                    | Source Agent, history, automation, and credentials remain intact |

### Agent and Team presentation

The existing design system remains authoritative. The slice introduces no new
type, spacing, color, or status vocabulary.

- Agent name uses the existing title rung; responsibility/context uses body or
  chrome-meta according to altitude.
- `Local`, `Remote`, and later `Exawatt Cloud` are quiet placement metadata with
  a redundant desktop/cloud glyph. Placement never borrows D40 status color,
  Project identity color, or source brand color.
- Source identity continues through `SourceIdentityMark`; **OpenClaw · Remote**
  is inspectable secondary metadata, not the Agent's name.
- D40 remains the work-state signal. Connection uses separate short labels:
  `Live`, `Reconnecting`, `Stale`, `Unavailable`.
- Team cards show one Agent per coworker. Agent detail may show a compact work
  stack and source-context history; cron/helper noise stays collapsed until it
  produces a meaningful Event, result, fault, or human gate.
- Primary product copy says **Conversation**, **Work**, **Automations**, and
  **History**. `Session` stays available in source detail and diagnostics where
  the technical distinction is the subject.
- The first materially changed cross-surface treatment must be prototyped in
  `/hud-gallery` before production, with DOM and R3F siblings when Agent, Team,
  and Fleet are all affected.

All controls follow the existing keyboard authority, visible-focus, 160–260ms
motion, reduced-motion, target size, and semantic-label rules. Remote state
must remain comprehensible without color, hover, or animation.

### Lifecycle semantics

Four dimensions stay independent:

| Dimension      | Examples                                      | Rule                                       |
| -------------- | --------------------------------------------- | ------------------------------------------ |
| Placement      | Local / Remote / Exawatt Cloud                | infrastructure fact, not status            |
| Connection     | Live / Reconnecting / Stale / Unavailable     | observation freshness, not Agent lifecycle |
| Work state     | D40 Off / Active / Result / Needs you / Fault | same projection across sources             |
| Source context | main / channel / cron / helper / spawned      | subordinate record under the Agent         |

For a remote Agent:

- closing its tab closes the Exawatt view, not the remote worker;
- quitting Exawatt disconnects observation, not execution;
- relaunch reconnects, replaces cached views from authoritative source
  snapshots, and reconciles later events by stable source identity;
- unreachable means last-known and stale, never stopped;
- **Reconnect** repairs observation;
- **Pause**, **Resume**, **Stop current work**, and **Abort** appear only when
  the adapter declares and the runtime observes their exact semantics.

Pause carries a stricter cross-source promise than a generic control label: it
halts a declared scope while preserving the same Agent and work for Resume.
Local process ownership plus exact provider identity can satisfy that contract.
Remote OpenClaw Pause remains deferred until the adapter can verify comparable
source-native continuity and say whether active work, queues, triggers, or a
narrower subset are halted. Exawatt will not approximate it with a prompt, cron
mutation, Gateway stop, or VPS shutdown.

The H1 slice shipped with no write, pause, resume, stop, scheduling, or
configuration control. H2 later added source-granted primary-conversation send
plus the main-process allowlist for `chat.abort`, `sessions.steer`, and
`tasks.cancel`. It did not add Pause, scheduling/configuration mutation,
Gateway administration, or VPS lifecycle control.

### Source and data contract

The normalized boundary stores:

- configured source ID, adapter type, placement, endpoint reference, credential
  owner, version, capabilities, and last observation;
- source-qualified Agent ID and display metadata;
- source-native context IDs, kinds, lineage, primary-conversation role,
  timestamps, optional replay positions, and assurance;
- Exawatt Agent ID, Project mapping, optional name override, and projection
  version.

SSH is a transport/bootstrap choice, not the data model. The first mile speaks
the OpenClaw Gateway protocol through an SSH-forwarded tunnel to the source's
own loopback Gateway port; remote shell scraping is never the fleet contract.

Connection material has two tiers, and Exawatt holds as little as it can:

- **Server access** is source-owned by default. A configured source that names
  an SSH alias stores the alias only, and reaching the server uses the
  operator's existing SSH configuration, agent, and key. Manually entered
  servers are the fallback for an operator without an alias; only that path
  stores explicit server access material behind Electron main.
- **The Gateway's shared secret is never persisted.** On first connect Exawatt
  resolves the source's own declared Gateway token through the authorized
  tunnel, holds it in process memory only, and uses it once: to pair Exawatt's
  own device identity with exactly the scopes the current milestone needs. The
  Gateway answers with a device token bound to that identity and those scopes.
  Exawatt persists **that** device token and keypair in OS-protected encrypted
  storage and never exposes either to the renderer. The persisted credential is
  therefore per-device, scoped (read-only through H1), and revocable on the
  server with the source's own tooling; the credential that could do anything
  never rests anywhere Exawatt owns. Pasting a shared token is a fallback for a
  source that does not declare one, not the normal path.

No connection material of either tier crosses into renderer state.

Snapshots are replaceable and idempotent. Reconnect always permits an
authoritative resnapshot, then merges later events by source and run identity.
A transport sequence that resets per connection is never stored as a durable
catch-up cursor; adapters may use a replay position only when the source
explicitly guarantees its durability. A reconnect may refresh source facts but
cannot duplicate an Agent, rerun a turn, or silently change its Project.

Demo Mode must exercise the same configured-source, projection, placement,
primary-conversation, freshness, resnapshot, and reconciliation contracts with
simulated evidence.

## Milestones

### User-visible execution ladder

| Step | Engineering result                                      | What the operator gets                                                               |
| ---- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| C0   | Versioned projection plan/output plus topology fixtures | No new surface yet; topology can change later without renaming or migrating the VPSs |
| C1   | Saved read-only source and Gateway transport            | Exawatt can safely test, remember, diagnose, and reconnect to each Hetzner source    |
| C2   | Connect flow plus Agent/Team projection                 | Marcus, Scout, and Tyler appear as remote coworkers with read-only conversation/work |
| C3   | Relaunch, outage, rename, detach, and retirement proof  | Quit/reopen and transient failures preserve the same coworkers without VPS mutation  |
| C4   | Visual, transport, and contract hardening               | The attach path tells only facts the real runtime can support                        |
| C5   | Existing-fleet control and installed-app proof          | Packaged and official installed-app/live-fleet acceptance passed                     |
| H2   | Capability-declared command path                        | Talk to a coworker; exact controls follow only where OpenClaw proves their effect    |
| H3   | Exawatt-managed OpenClaw placement                      | Create a hosted coworker without learning a second roster or control surface         |
| H4   | Explicit clone/move with a transfer manifest            | Move or copy a coworker only after seeing exactly what transfers and what does not   |

### ENG-010 — connect to existing OpenClaw

- **C0 Projection kernel and public-safe authored fixtures — landed
  2026-08-16.** Added
  source-qualified configured-Agent/context records, the primary-conversation
  role, a versioned projection plan/output, and pure mappings for the
  operator-confirmed two-Gateway conceptual topology. All technical fixture
  data is invented. No network or UI writes.
- **C1 Saved remote source and read-only transport — LANDED 2026-08-17**, and
  proved end to end against both operator Gateways. See the milestone log entry
  for what the live run corrected. The renderer seam ships; the Connect flow
  and the roster surface that give it content are C2, so C1 adds no new UI.
  Original scope, all delivered: extend the source
  registry with customer-hosted placement, OS-owned connection material, bounded
  Gateway discovery, capability/freshness truth, authoritative reconnect
  snapshots, subscriptions, and optional source-declared replay positions.
  C1 also carries the decisions taken 2026-08-17: an SSH-alias-first tunnel
  transport, shared-secret-in-memory plus persisted read-only device token,
  and retirement of the pre-registry single-Gateway path (see the milestone
  log entries). Concretely, C1 lands: (a) an SSH tunnel owner in Electron main
  with alias enumeration, port-forward lifecycle, and failure classes that
  separate host-unreachable, Gateway-down, and auth-rejected; (b) bounded
  Gateway-token resolution over the tunnel and read-scoped device pairing;
  (c) registry records for placement, endpoint reference, credential owner,
  observed version and capabilities, and observation freshness; (d) discovery
  via `agents.list` and topology via `sessions.list`, classified by key
  segment, plus `cron.list` and `status`; (e) an authoritative resnapshot on
  every reconnect; (f) deletion of the environment-flag single-Gateway path
  and the `hosted-openclaw` coming-soon adapter.
- **C2 Connect flow and coworker projection — LANDED 2026-08-18.** Prototype the cross-surface state
  in `/hud-gallery`, then wire **⌘N → Connect existing Agent…**, explicit
  Project mapping, and read-only Marcus/Scout/Tyler Agent + Team views with a
  bounded primary-conversation history and compact current-work stack.
- **C3 Relaunch and dogfood proof — LANDED 2026-08-19.** Quit/relaunch, endpoint outage, source
  restart, renamed Project, detach/reattach, and retired-Agent cases preserve
  identity and never mutate the VPS.
- **C4 Hardening — LANDED 2026-08-19.** Visual review, manual transport proof,
  and Electron-test type-checking corrected the Connect progress channel,
  credential bootstrap, and unreported work-state presentation.
- **C5 Existing-fleet control proof — LANDED 2026-08-20.** The packaged
  two-Gateway gate passed initial launch and relaunch at `436286f5a155`. The
  exact installed official app at
  `7dc07d2c29c31e26917c001f63038c07b30a7b23` then connected both live
  SSH-alias Gateways, projected three source-qualified Agents, opened them
  through Team and Fleet, and preserved Agent, Project, and UI identity across
  relaunch. Both sources correctly remained observation-only because neither
  granted write authority; no send was attempted. The gate removed its exact
  new device IDs, and independent readback found zero Exawatt UI read devices.

### ENG-033 — one hosted progression

- **H0 Hosted topology contract — shaped 2026-08-16.** Decision `0037` makes
  placement orthogonal and keeps ENG-010/011/012 as execution owners.
- **H1 Observe existing infrastructure.** ENG-010 C0–C3; customer-hosted
  OpenClaw, read-only first.
- **H2 Command connected Agents — LANDED 2026-08-20.** Request and record
  Gateway-granted `operator.write`, read and follow the configured Agent's
  primary conversation (OpenClaw `main`), and send by Exawatt Agent identity.
  Electron main allowlists `chat.send`, `chat.abort`, `sessions.steer`, and
  `tasks.cancel`; the production UI exposes primary-conversation send. No
  Pause, schedule/configuration mutation, Gateway administration, or VPS
  lifecycle control is included.
- **H2.1 Work and automations on the connected coworker — planned, shaped
  2026-09-14.** Close the gap the 2026-08-20 entry recorded: the roster DTO
  carries no work or automation evidence, so the pane shows Conversation only.
- **H2.2 One-gesture write approval — planned, shaped 2026-09-14; needs one
  operator decision.** Approve Exawatt's own pending write request on the
  server through the operator's existing SSH identity instead of by hand.
- **H2.3 Remote needs-you and result — planned, shaped 2026-09-14.** Give
  D40's `blocked` and `complete` remote evidence from the read-scoped
  subscriptions.
- **H3 Exawatt-managed placement — NOT ACTIVE; REQUIRES A DESIGN PASS (operator,
  2026-08-19).** H3 would force business and custody decisions, including
  whether and how the product charges, and the operator asked that it be shaped
  deliberately rather than fallen into from momentum. It stays unshaped until
  that pass happens. No paid-cloud implementation is active. The
  questions it raises are ones the earlier milestones never had to answer:
  what becomes of a machine when someone stops paying, who can reach it, what
  detach and delete each mean when Exawatt owns the box, and whether an
  operator may hold their own credentials for infrastructure Exawatt runs.
  Nobody should answer those in passing. Provision and operate an Exawatt-managed
  OpenClaw behind the same source, Agent, Project, state, and command contracts.
- **H4 Clone or move.** Offer a source-to-source handoff only after the product
  can enumerate workspace, secrets, memory, automations, history, and identity
  transfer. “Push” cannot imply provider-state continuity that did not occur.

ENG-011 later proves mixed-source scale; ENG-012 supplies hosted metadata,
governance, policy ceilings, and billing. Neither owns a parallel roster.

## H2.1–H2.3 execution packets (shaped 2026-09-14 for pickup)

State on 2026-09-23: the installed app is 0.1.13, which carries BUG-132 but
not the Connect-path repairs; those (C6, BUG-147 to BUG-153) and C7's evidence
(BUG-154) landed 2026-09-23 and reach the operator with the next dogfood
build. Neither dogfood Gateway has been connected from the installed app; a
second attempt on 2026-09-21 ended with nothing saved and no evidence of why.
The first step is the operator's, not an agent's: on a build that carries
C6/C7, connect both Gateways from ⌘N and use them for a few days, and read
`logs/connected-sources.jsonl` first if anything fails. Build the packets
below against that use, in order. Alias names and endpoints never enter this
doc.

### H2.1 Work and automations reach the pane

- **Why:** `ConnectedSourceRuntime.discover()` already calls `cron.list`,
  `status`, and `sessions.list` (with `hasActiveRun`), and the projection
  kernel derives a work stack and automation rows from them (2026-08-19
  entry), but the renderer roster DTO carries none of it, so
  `RemoteAgentSurface.work` receives the empty stack in production and a
  coworker with no `main` Session opens to nothing.
- **Where:** the roster boundary in `electron/main/connected-sources-ipc.ts`
  (`connected-sources:agents`) and its renderer readers
  `src/components/workspace/remote-agent/remote-agent-roster.ts` and
  `use-remote-coworkers.ts`; the consumer is
  `src/components/workspace/remote-agent/remote-agent-surface.tsx`. Demo
  parity lives in `packages/core/src/sources/demo-connected-source.ts` and the
  lifecycle contract in `electron/main/connected-source-lifecycle.contract.ts`.
- **Rules:** bounded and source-reported; never turn `contextCount` into work
  state; stale and unavailable dim the work stack exactly as they dim the
  transcript (C4 finding); cron and helper noise stays collapsed until it
  produces an Event, result, fault, or human gate (design brief).
- **Acceptance:** each dogfood coworker opens showing current work and
  automations from its source; the coworker with no `main` Session leads with
  Automations and shows them; the lifecycle contract and the packaged
  connected-fleet gate carry the DTO; Demo passes the same contract.

### H2.2 One-gesture write approval (operator decision first)

- **Today:** `request-command-authority` enqueues a pending pairing request on
  the Gateway; the operator approves it by hand with the source's CLI. Exawatt
  deliberately holds neither `operator.pairing` nor `operator.admin` (H1
  criterion, decision `0037` §4, 2026-08-18 entries).
- **Decision needed:** whether authority may be placement-dependent. For a
  customer-hosted source reached over the operator's own SSH alias, the
  operator IS the server's admin; running the source's approval command over
  that alias adds no authority Exawatt did not already have. The agent
  recommendation of 2026-09-14 is to adopt this for SSH-alias sources only and
  keep the refusal for anything reached by shared token. If adopted: amend the
  H1 criterion and `0037` §4, add the amendment-chain row, and keep the
  generality test (another operator, another provider).
- **Where:** `electron/main/gateway-bootstrap.ts` already owns a bounded
  remote exec over the alias (`createSshRemoteExec`); the authority tiers are
  in `electron/main/connected-gateway-authority.ts`; the surface's
  approval-pending state is in `remote-agent-surface.tsx`. The live send proof
  (`connected-openclaw-send.live.test.ts`) and the fail2ban note in the
  2026-08-19 hardening entry bound how the proof may touch a real server.
- **Acceptance:** from approval-pending, one gesture completes the approval of
  exactly the request Exawatt made and the composer becomes ready without a
  terminal; a refused or absent request is named in the source's words; the
  gesture is absent for non-alias transports.

### H2.3 Remote needs-you and result

- **Today:** remote D40 reaches `active`, `unreported`, and `error` only
  (C2 and H2 entries); `complete`, `blocked`, and `reviewing` are listed by
  name as unreachable so adding evidence has to be deliberate.
- **Where:** `sessions.subscribe` and `sessions.messages.subscribe` are read
  scoped (2026-08-18 entry) and already feed the conversation; the work-state
  derivation is in the projection kernel and `connected-source-runtime.ts`.
- **Acceptance:** a finished remote turn lights `complete` and a remote human
  gate lights `blocked`, each with the named source evidence; anything without
  evidence stays unreachable and listed. Fleet then answers "who is waiting on
  me" for connected coworkers.

### ⌘T on a box (not shaped; recorded so nobody re-derives it)

A Launch Configuration (`packages/core/src/launch-configurations.ts`) carries
`sourceId` but no placement. The launcher's source list filters to PTY
harnesses with interactive launch (`src/components/workspace/agent-sources.ts`),
which structurally excludes the OpenClaw source. `agents.create` and
`sessions.create` are `operator.admin` and are not requestable
(`connected-gateway-authority.ts`). Launch itself goes through
`electron/main/pty/session-manager.ts`, which has no remote branch. The
gesture therefore needs the H2.2 authority decision, a placement on the launch
configuration, an unfiltered launcher, and a launch path through the connected
source runtime. It belongs to the ENG-016 D54 flow pass and the ENG-033 H3
pass, not to a packet here.

## H2.4 Connect in one step, from ⌘T and ⌘N (direction set 2026-09-23)

The 2026-09-23 audit walked the Connect flow end to end in the real app
against two simulated Gateways reached through a stand-in `ssh`, recorded
every click, screen, and SSH login, and had an independent reviewer score it:
15 of 40 on Nielsen's heuristics. One server took six screens and five clicks
plus a scroll; both servers took thirteen clicks, two scrolls, and a terminal
session, and the flow ended on a send-access state that could not complete.
The three behaviour defects it found are BUG-155 to BUG-157 (fixed as ENG-010
C8); this section is the redesign.

**Operator decisions, 2026-09-23.** Repair and redesign together. A connected
coworker's default home is one special Project, named along the lines of
"Remote" ("maybe we can call it a special project, like remote, or online, or
cloud, or something for now"), with "the right to iterate on this over time".
Connect is offered in two places: "why isn't this in Command-T instead of
Command-N? I think even within a project I want to be able to connect to an
open instance or something like that, a cloud instance. Maybe we can support
both t under project and n under a generic Remote pseudoproject, for now,
until we decide more clearly later."

**What the audit says the shape needs**, as input to the gallery review, not
a spec:

- one Connect surface reachable from ⌘T (into the current Project), ⌘N (into
  Remote), ⌘K, and Settings; skip the one-option source step while OpenClaw
  is the only connectable adapter;
- a server list with type-ahead, saved servers marked and routed to Settings,
  and likely OpenClaw hosts and recent servers first; the chips that name
  config keys rather than values go;
- one confirm screen: Agents checked, inline rename, one Project choice for
  the batch (default Remote), send access offered in place, diagnostics moved
  to Settings, primary action "Connect N Agents";
- land on the coworkers, not on whichever Agent sorts first.

**Constraints.** ⌘T is ENG-016 D54's surface, the New Agent flow design pass
the operator named for external design help, so the ⌘T entry is shaped with
that pass rather than beside it. Send access in the confirm step depends on
the open H2.2 decision (one-gesture approval over the operator's own SSH
alias). The Remote pseudo-project is a folderless `manual` Project like the
ones Connect creates today; making it a single, named, renameable home is a
Project-registry change that must hold for signed-in, signed-out, and
expired-session operators (see BUG-150 and the workspace-honesty work).
Prototype in `/hud-gallery` for operator review before production, per the
design system.

**Operator decisions, 2026-09-24.** The direction is accepted ("I generally
like the new UI direction for remote connection and agent management"), and
send access is decided: "that should be like a connection or setup flow to set
up a particular server endpoint. It should be one-click to run that command or
let the user copy and run it themselves." The operator also asked whether this
is needed for every user or once for him: every user does it once per server
per machine (a new Mac, or a detach and reconnect, pairs a new device).

**Execution packets.** In dependency order; each lands through the normal
queue with the connected-fleet gate.

- **P1 Remote home.** One Exawatt-owned, folderless, renameable Project,
  "Remote" for now, created on first need and used as ⌘N Connect's default.
  Touches the Project registry, so it lands after the workspace-honesty work
  on signed-in, signed-out, and expired-session registries, and must hold for
  all three.
- **P2 One-step Connect.** LANDED 2026-09-24 except the three items in P2b
  (log entry of that date). Filter with type-ahead; saved servers marked with
  their Agents and a Manage link to Settings; picking a server tests it in
  place; a failure stays on its row and saves nothing (persist a source only
  after discovery succeeds, which retires BUG-157's release-on-switch); Agents
  checked inline with rename; one Project choice for the batch; primary
  "Connect N Agents"; skip the source step while OpenClaw is the only
  connectable adapter; land on the Project with the new coworker marked; a
  ⌘K row and a permanent Settings entry.
- **P2b Connect follow-ups.** Three P2 items not in the first cut: (1) land on
  the Project with the new coworker marked, which needs P1's Remote home to be
  the Project it lands on, so it ships with P1; (2) a ⌘K row, which reverses
  the `connect-agent-source` verb's recorded decision to have none, so the
  manifest's reason is rewritten in the same change; (3) the send-access step
  inside the dialog as the study shows it, which P3 put on the coworker pane
  the dialog opens onto. The permanent Settings entry already exists.
- **P3 Send access as server setup.** LANDED 2026-09-24 (log entry of that
  date). One click runs `openclaw devices
  approve <id>` for Exawatt's OWN pending request over the source's SSH
  destination; the copy path shows the same exact command; Check again
  completes both. Feasibility checked 2026-09-24 against OpenClaw's own
  source (`src/infra/device-pairing.types.ts`, `src/cli/devices-cli.runtime.ts`
  on main): every pending request carries `requestId`, `deviceId`, and
  `publicKey`, and `devices list --json` writes the pairing list unchanged, so
  Exawatt matches its own request by device id and public key and approves
  only that one. Confirmed 2026-09-24 on the operator's servers (OpenClaw
  2026.7.1-2): the installed build constructs every pending request with
  `requestId`, `deviceId`, and `publicKey`, and the CLI is on the
  non-interactive SSH PATH. If a Gateway's list does not identify the device,
  the one-click path refuses rather than approving a guessed entry. Alias and
  manual transports only; a shared-token source has no SSH identity to act
  with.
- **P4 ⌘T.** Connected coworkers become launch setups ("Send to Scout"; the
  coworker joins the current Project), and "Connect a server into <Project>"
  sits under More. The launcher is ENG-016 D54's surface and carries in-flight
  readiness work, so this packet is shaped with D54 and coordinated with that
  work before it starts.
- **P5 UI eval.** LANDED 2026-09-24 as `eval:electron:connect-flow` (log
  entry of that date). Turn the audit harness (stand-in `ssh` plus
  `ConnectedGatewayFixture`) into a Connect UI eval that measures clicks,
  screens, and SSH logins, and gate P2 to P4 on it.

**Evidence to keep.** The audit's walkthrough drove the real preload and IPC
with a stand-in `ssh` on PATH forwarding to `ConnectedGatewayFixture`; it
found BUG-155 and BUG-157, which no unit and no packaged gate had. H2.4 should
turn it into a UI eval of the Connect flow so the redesign is measured the
same way (clicks, screens, SSH logins) before and after.

## H1 acceptance criteria

- The operator can connect both existing Gateways without entering an IP when
  an SSH alias already exists.
- Discovery returns exactly Marcus, Scout, and Tyler as active import choices;
  Priya does not reappear without explicit selection.
- Marcus and Scout remain distinct Agents even though they share one Gateway.
- OpenClaw main/channel/cron/helper contexts do not become top-level Agents.
- Opening Marcus, Scout, or Tyler resolves that configured Agent's exact `main`
  context as the primary conversation; newer cron, channel, or subagent
  activity never steals that role.
- The read-only Agent view shows bounded authoritative history, any observed
  active run, and meaningful current work with no composer or send affordance.
- Reconnecting, stale, unavailable, approval-required, incompatible, and
  identity-drift cases preserve last-known identity while clearly limiting
  what Exawatt can claim is current.
- Each imported Agent has an editable Project mapping and optional Exawatt name
  override; changing either does not modify OpenClaw.
- Agent and Team clearly distinguish Remote placement, connection freshness,
  and D40 work state without color-only communication.
- Closing or quitting Exawatt leaves remote work untouched. Relaunch returns to
  the same Agent, resnapshots authoritative state, and reconciles active work
  without duplication or replay.
- Disconnecting or detaching never deletes the remote installation, Agent,
  workspace, contexts, automations, or credentials.
- H1 contains no remote command path, even if the protocol client already has
  one. **Superseded by H2 on 2026-08-18**, which added one deliberately: send,
  abort, steer, and cancel, gated on authority the Gateway granted and refused
  locally until it does. The criterion did its job, which was to keep the
  command path out of H1 rather than out of the product.
- H1 contains no remote Pause implementation, cron mutation, Gateway control,
  or VPS lifecycle control. **This one still holds after H2** and is the sharper
  half: cron mutation, configuration, and Agent lifecycle need `operator.admin`,
  which Exawatt never requests, and a generic remote Pause is still deferred
  until a source can prove a named halted scope.
- Demo and live adapters pass the same projection and lifecycle contract tests.

## Non-goals for H1

- provisioning, updating, or repairing a VPS;
- sending messages or controlling work;
- generic SSH terminal management;
- importing every retained OpenClaw Session as an Agent;
- inferring Agent Types from names or source configuration;
- migrating local repos, memory, credentials, or conversations;
- organization sharing, SCIM, billing, or managed policy;
- automatic consolidation of one person across unrelated source instances.

## Risks and seams

- **Native identity drift:** fail visibly and offer remapping; never guess by
  display name alone.
- **Source-version skew:** capability and compatibility facts remain observed
  per configured source, so the two dogfood versions can differ honestly.
- **Connection ambiguity:** stale is not stopped, and disconnect is not pause.
- **Surface overload:** Agent name/responsibility remain primary; placement and
  source stay compact secondary metadata.
- **Taxonomy drift:** projection versioning and preserved raw topology make a
  later Agent/work-stack rule a re-projection, not a source migration.

## Reversible scale-out rule

Confirmed default: one durable coworker may own several simultaneous work
contexts, shown as a compact work stack. A transient delegate stays visibly
subordinate; only a separately configured, persistent, directly addressable
worker becomes another Agent. Validate and refine the presentation against real
OpenClaw concurrent work before deciding the exact Team/Fleet threshold or
adding a new canonical Work or Assignment object. This is projection policy,
not a source migration, and can change by projection version.

## Roadmap milestone log

### 2026-08-16 — topology and design pass

Inspected the operator's two live OpenClaw installations and compared their
configured Agents with retained context/session stores. The active source graph
is two Gateways and three configured Agents; the high historical Session count
belongs mostly to main/channel/cron/helper execution beneath those people. The
operator selected Tyler as intentional and Priya as retired.

The market comparison found the same split elsewhere: coding products call a
task-shaped Session an Agent, OpenClaw exposes a durable Agent over many
Sessions, and hosted/self-hosted products generally treat placement as an
orthogonal runtime choice. Decision `0037` promotes the reversible coworker
projection and connects ENG-010's first mile to ENG-033's hosted promise.

### 2026-08-16 — Agent Home and reconnect refinement

Current OpenClaw documentation confirms that each configured Agent's `main`
Session is its stable Home while threads, tasks, automations, and subagents sit
beneath it or report back to it. It also corrects the first reconnect draft:
WebSocket frame sequence resets on every connection and events are not replayed.
ENG-010 therefore opens the source-declared primary conversation, resnapshots
authoritative history and active-run state after reconnect, and treats durable
replay positions as optional adapter capability rather than a baseline promise.

### 2026-08-16 — pause and detach refinement

The operator separated two daily stories. A local Agent may be deliberately
paused, the app quit, and the exact retained Session explicitly resumed later.
A remote Agent instead keeps working while Exawatt is closed; relaunch
reattaches observation and catches up without calling that Resume. ENG-010 C3
proves the detach/reattach story. H2 starts with conversation and does not take
on OpenClaw cron mutation, Gateway/VPS lifecycle, or a generic remote Pause
until the source can prove the halted scope and resumable continuity.

### 2026-08-16 — C0 projection kernel landed and review-hardened

The pure `@exawatt/core` Agent projection kernel now accepts source-qualified
Agent/context snapshots plus an explicit projection plan; the plan and returned
projection carry the version while snapshots and individual Agent/Project
mappings do not. It produces a deterministic coworker projection without
transport, persistence, UI, or source mutation. Bare native IDs never cross a
configured-source boundary, and Project and display-name changes remain
mapping-only.

The post-landing review hardened the boundary as a whole rather than adding
case-specific guards: recognized adapter payload fields are validated before
identity derivation and return structured issues, unknown fields are stripped at
the allowlisted copy boundary, every finite vocabulary used by the projection
boundary has one exhaustive runtime definition, and context lineage must be
acyclic as well as source-qualified and parent-complete. Malformed, duplicate,
orphaned, cross-source, cyclic, or ambiguous topology therefore fails closed.

Primary conversation selection uses only the source-declared
`primary-conversation` role. Newer channel, cron, helper, or spawned work cannot
replace it; a missing primary returns a warning and `null` instead of a recency
guess. The public-safe simulated fixtures model two Gateways and the
Marcus/Scout/Tyler projection, deliberately repeat native Agent and main-context
IDs across sources, and retain retired Priya without projecting her by default.
The fixture contract now pins that complete topology, allowlists its public
schema, and rejects endpoint, credential, path, PEM, URL, domain, and IP
material in field names or values. The kernel accepts observed, declared, and
simulated evidence through one input contract; Demo and Live adapters remain
C1-C3 work, so parity is not yet claimed.

Evidence: 30 focused projection contract tests, all 435 `@exawatt/core` tests,
`@exawatt/core` type-check, changed code/project-doc formatting, roadmap
parsing, and `git diff --check`. This lands no H1 acceptance or user-visible
remote behavior; C1 remains the first transport slice.

### 2026-08-17 — C1 transport, credential, and legacy-path decisions

Inspected the operator's real reachability before shaping C1. The Mac's own
`~/.openclaw` Gateway is a third, local source bound to loopback; it holds no
remote-host configuration, so the existing operator workflow reaches both VPSs
over SSH. Named aliases for both servers already exist in the operator's SSH
configuration, and each server declares its Gateway token by indirection rather
than inline.

Three decisions follow, and all three were chosen to hold for other operators
on other providers rather than to fit this one topology:

- **Transport is an SSH-forwarded tunnel to the source's loopback Gateway
  port.** Anyone running an agent on a VPS already has SSH to it, so no
  operator has to expose a port, learn an IP, or run a second network
  component. Direct endpoints remain possible later; they are not the first
  mile.
- **Server access is alias-first with manual entry as the fallback.** Connect
  lists the operator's existing SSH aliases and stores only the chosen alias
  name. Manual host/user/key entry exists for an operator without an alias and
  is the only path that writes server access material to the OS keychain.
- **The Gateway credential is resolved through the authorized tunnel and kept
  in memory only.** Connecting a server the operator can already reach requires
  no pasted secret and leaves no new secret at rest. (Refined the same day by
  the live probe below: the shared secret stays in memory only and is used
  once to pair a scoped device identity; the resulting read-only device token
  is what persists.)

The read-only gate stays strict: C1 through C3 ship observation, and command
authority waits for H2 even though the protocol client already has a send path.

The pre-registry single-Gateway path is retired in C1 rather than carried. That
path was an early scaffold: an environment flag that connected one Gateway read
from local configuration and presented it _instead of_ the local terminal
fleet. Its either/or posture directly contradicts the outcome this project
exists for, which is remote coworkers standing beside local Agents. C1 deletes
the flag branch and the single-connection assumption in the Gateway config
reader, and makes the operator's local Gateway one more configured source.

`contracts/agent-sources.json` also stops advertising `hosted-openclaw` as a
separate coming-soon adapter. Decision `0037` makes placement a fact on a
configured source, so a remote or managed Gateway is the `openclaw` adapter at
a different placement, not a second adapter.

No application code changed with these decisions; they refine the C1 packet
before it is opened.

### 2026-08-17 — live read-only probe of both dogfood Gateways

With the operator's permission, probed both servers over SSH using only
read-scoped Gateway methods and the source's own CLI. Nothing was written,
paired, or persisted. Findings that change C1's shape (no endpoint, path,
token, or key material is recorded here):

**Reachability.** Both Gateways run the same OpenClaw release, listen on
loopback only, and use shared-token auth. The SSH tunnel is the only path in,
which confirms the transport decision rather than merely permitting it.

**Discovery is first-class.** `agents.list` returns the configured-Agent list
directly: id, display name, workspace, model, runtime, default flag, and the
Gateway's `mainKey`. No inference from Session keys is needed. Agents that
exist only as retained directories and not in configuration do not appear,
which is exactly the retired-history behaviour the acceptance criteria require.

**The scope map matches the ladder.** The Gateway classifies every method by
required scope. `operator.read` covers all of H1: `agents.list`,
`sessions.list`, `sessions.subscribe`, `sessions.messages.subscribe`,
`chat.history`, `cron.list`, `cron.runs`, `tasks.list`, `status`, `health`,
and `usage.*`. `operator.write` is H2: `chat.send`, `chat.abort`,
`sessions.steer`, `tasks.cancel`. `operator.admin` owns cron mutation,
configuration, and Agent create/delete, and stays out of scope. Read-only is
therefore enforceable **by the source**, not only by Exawatt's allowlist.

**Pairing is silent through the tunnel.** A connection that reaches the
Gateway from loopback with the valid shared token and no proxy or browser
origin headers is classified as local, and for that class an unpaired device
requesting scopes is paired without an approval step; the requested scopes are
stored on the device record and returned as a device token. A later scope
upgrade through the same locality is also silent. This is what makes the
device-token custody model above workable with no operator ceremony: Exawatt's
own device identity asks for `operator.read`, receives a read-only token,
persists that, and drops the shared secret. The Gateway lists the paired
device by name and can revoke it, so custody is visible on the source side.

**Topology, as observed.** Gateway A configures two Agents. One has its
identity name set and is the default; the other has no identity name on the
box, only a lowercase role slug as its configured name. The operator corrected
the brief here: "Marcus" is the Reddit persona that Agent posts under, a
property of its work, not the coworker's name. So the brief's "Marcus" is a
persona, the source's own configured name is what Exawatt shows by default,
and the operator may rename it in Exawatt. A persona is never promoted to
Agent identity, and the coworker is not named after its server either, since
placement is not identity. That Agent's 75 retained
Sessions decompose as one `main`, one cron context, one spawned subagent, and
72 arbitrarily named helper contexts, so context-kind classification must key
on the Session key's second segment (`main`, `cron`, `subagent`, otherwise
helper) and never on the label. Gateway B configures one Agent with no
channels, no `main` Session, and a single automation on a fixed interval that
runs in isolated Sessions. Nobody has ever conversed with it. Its primary
conversation is therefore genuinely absent, and the kernel's null-primary path
is exercised by real data on day one: that Agent opens with Automations
leading and no conversation, not with a fabricated Home.

**Work-state and automation signals exist.** Every Session record carries
`hasActiveRun`; `status` reports task totals, heartbeat configuration, and
Session counts per Agent; `cron.list` reports schedule, last run time and
status, next run, and delivery mode. D40 work state, the compact work stack,
and Automations all have observed sources.

**Amendment to the credential decision.** The morning's "in memory only" rule
was written before pairing was understood. Persisting nothing would force
Exawatt to re-read the admin-capable shared secret over SSH on every launch,
which is a worse posture than holding a read-only, per-device, revocable
token. The rule is now: shared secret in memory for one issuance handshake;
scoped device token persisted in the OS keychain. The later H2 live proof
refined the second half: after source-side approval, an explicit write request
resolves the secret again and reissues the SAME device keypair at the wider
scope. Ordinary launch and reconnect still use only the scoped token.

### 2026-08-17 — C1 landed, and four things only a live run could find

C1 is implemented and proved against both operator Gateways: SSH tunnel,
credential bootstrap, read-scoped pairing, `agents.list` and `sessions.list`
discovery, the topology adapter, and the C0 projection kernel, end to end, with
a write method refused by the source. The proof is committed as an opt-in test
that names no infrastructure; alias names come from the environment.

Four defects surfaced only because the run was real. Each had passed its own
unit tests, and none could have been caught by a fixture, because in every case
the fixture would have encoded the same wrong assumption as the code.

- **The protocol was pinned.** The client advertised `minProtocol: 3,
maxProtocol: 3`. A current Gateway accepts an operator client only when
  `maxProtocol >= 4 && minProtocol <= 4`, so Exawatt could not have connected to
  any up-to-date OpenClaw at all. It now advertises a range, which both eras
  accept.
- **Device identity was the wrong shape.** Exawatt sent hex public keys and
  derived the device id as the key's first 32 characters. The Gateway decodes
  base64url and derives SHA-256 over the raw key bytes, so every connect was
  rejected as an identity mismatch. The auth tests now verify against Node's
  own crypto rather than restating Exawatt's encoding: the previous tests were
  green throughout, because they asserted what the code did rather than what
  the protocol required.
- **The CLI masks the credential.** `openclaw config get gateway.auth.token`
  answers with a short masked value, not the token. Preferring it produced a
  confident pairing failure while a working token sat in the config file. The
  file is now preferred and the CLI is the fallback for the indirection case.
- **SSH multiplexing stole the forward.** Under the operator's `ControlMaster
auto`, `ssh -N -L` hands the forward to an existing master and exits 0. That
  read as a failure, but the dangerous half is the opposite reading: had it been
  treated as success, the forward would have outlived Exawatt's child process,
  leaving a port open to the operator's server after Exawatt believed it had
  detached. Exawatt now refuses multiplexing so `close()` means what it says.

**The credential model is confirmed, with a correction to how Exawatt
introduces itself.** Connecting as a `backend` client makes the Gateway treat a
tunneled connection as a local self-connection and skip device pairing
entirely; no device token is issued, and every launch would have to re-read the
admin-capable shared secret. Connecting as a UI client pairs properly. Verified
on a live Gateway: the resulting device record carries `operator.read` and
nothing else, sits beside the operator's own admin device, and is revocable
with the source's own tooling. The Gateway's client-id vocabulary is a closed
set with no Exawatt member, so Exawatt identifies as the platform's UI client
and carries its real identity in `clientVersion`. The probe's device was
removed after the run; both servers hold only the operator's own devices.

**Scope note.** C1 ships the main-process capability and the renderer seam.
The Settings surface named in the original C1 description moves to C2: with no
Connect flow there is nothing for it to show, and building a surface that
cannot be reached is the unreachable-navigation mistake the repo already has a
rule against. C2 lands the Connect route and the surface together.

Follow-ups for C2, both recorded rather than worked around: a `local-loopback`
source has no SSH alias, so the bootstrap cannot yet resolve a credential for
the operator's own machine-local Gateway; and `ssh-manual` transport is
accepted by the record model but not yet by the tunnel owner, which is
alias-only and fails closed with a plain sentence.

### 2026-08-18 — C2 landed: the route, the roster, and what removing debt exposed

Connect is a route on the ⌘N chooser, beside opening a known Project and adding
one from disk, with a File menu entry that lands on that same route rather than
opening a second door. It lists the operator's own SSH aliases by name, names
the stage a bounded connection test is in, preselects configured Agents while
keeping retired ones apart and unchecked, and takes an explicit Project mapping.
Cancelling at any step leaves both the source and the server untouched.

Remote coworkers now stand in the same roster as local ones, carrying placement,
connection freshness, and source identity as one optional presence field, so no
downstream surface needs a remote branch. Settings gains the connected-source
registry, and `/hud-gallery/connected-source` holds the treatment the design
system requires to be reviewed before it reaches production.

**Work state became real.** `sessions.list` reports an active run per session
and that signal now travels adapter to kernel to runtime to renderer, tri-state
so that "the source said nothing" is never coerced into "not working". Remote
still reaches only two of D40's six states: a turn boundary, a human gate, and
an exit have no remote evidence, and claiming one would invent a result, a gate,
or a fault. H2 earns those.

**Two rungs the existing contracts did not reach, both found by writing the
test rather than by review.**

A verb could satisfy every join the discoverability manifest makes, render in
the native menu, and still do nothing, because dispatch is a switch and a
missing case is silent. Dispatch has three owners, so each publishes what it
handles and the contract now joins the union to the manifest in both
directions. Writing that test immediately flagged five verbs; all five turned
out to be dispatched from the other two owners, which is the answer the test
should give, since the invariant is that a menu item does something rather than
that one file handles everything.

The second was the read-only posture itself. H1 being read-only was a claim
about which function the renderer called, while the old broker sat wired into
main with `chat.send` and the whole cron mutation set on its allowlist, reached
through a preload bridge nothing consumed any more. Deleting it, and the
single-connection resolver that turned local configuration into THE gateway
connection, makes read-only structural: no code path in the process can now
send a message or change a schedule on someone's server.

**C1 follow-ups closed as seams.** Credential resolution is one function
dispatching on transport kind, with an SSH implementation and a local one; the
local path resolves the indirection this machine actually uses through a
bounded read of a secret file whose name config text cannot choose, and
executes nothing. Transport is one destination model whose alias and manual
cases share a single injection guard, so hardening cannot be present on one
path and missing on the other.

**Evidence.** The live probe now runs the shipping client identity rather than a
profile the Gateway exempts from pairing, asserts against the server's own
record that the device it pairs carries `operator.read` and nothing else, and
removes only the devices that run created, computed as a difference against a
listing taken beforehand. Matching on client id or scopes would have been
simpler and eventually deleted the very device production is meant to keep.
Both dogfood Gateways pass, and both finish holding only the operator's own
device.

### 2026-08-18 — write authority is granted on the server, not taken

H2 was shaped around a line in the credential entry above: "H2 upgrades that
token's scope explicitly rather than re-pairing." A live probe says that is not
a thing Exawatt can do, and the correction improves the posture rather than
costing anything.

Two experiments, each on a freshly paired throwaway device that was removed
afterwards. A device approved at `operator.read` reconnected with its own
device token asking for `operator.write`, and was refused: `device token scope
mismatch (re-pair or approve scope upgrade)`. The same device then presented
the admin-capable shared secret, which Exawatt deliberately does not persist,
and was refused again: `pairing required: device is asking for more scopes than
currently approved`. Asking for a scope at or below the approved baseline
succeeds, so narrowing is free and widening is not.

The asymmetry is the point. First pairing at a given scope is silently approved
for a loopback-local connection, which is what makes connecting a server the
operator already reaches feel like one click. Raising an approved device's
authority is not, and completing it needs `operator.pairing` authority that
Exawatt refuses to hold. So Exawatt can ask for write authority and can never
grant itself write authority, and no bug in Exawatt can change that.

That puts a real waiting state between read-only and able to send, and the
design brief already named it: **Approval required**, listed in Key states as
"the Gateway/device approval needed and how to complete it", explicitly
distinct from bad credentials or an offline Agent. It was written as an
edge case for connecting. It is in fact the normal path to write authority, and
an operator will sit in it every time they give a coworker a voice.

H2 therefore models three authority states rather than two: read-only with
nothing requested, requested and awaiting approval on the machine that runs the
Agent, and granted. The write allowlist gates on what the Gateway granted, never
on what Exawatt asked for, so a surface that runs ahead of an approval is
refused locally before it can produce a confusing server-side rejection.

### 2026-08-18 — what the approval actually looks like, measured

The entry above establishes that Exawatt cannot widen its own authority. It
left open what the operator does about it, and the answer changes the copy, so
it was measured rather than assumed.

A refused upgrade **enqueues a pending pairing request**. Listing the source's
devices immediately after shows a `pending` entry carrying the requested scopes
and a request id, alongside the unchanged `paired` record still at
`operator.read`. So the operator approves a request that is waiting for them,
which is a materially different sentence from asking them to re-pair a device,
and the surface says the true one.

Two further facts came out of the same pass, both of a kind no fixture would
have produced.

`sessions.subscribe` and `sessions.messages.subscribe` are accepted at
`operator.read`. Following a conversation as it arrives is observation, not
command, so streaming needs no authority beyond what H1 already holds and the
subscription joins the read allowlist rather than waiting for write.

`chat.history` takes `sessionKey`, not `key`, while the subscribe methods take
`key`. The parameter name is not uniform across the protocol, and a fixture
written from the shape of one method would have been confidently wrong about
the other.

### 2026-08-18 — H2 landed: a voice you grant, and a tab that admits what it is

An operator can now open a connected coworker, read its own conversation, ask
for the authority to reply, and reply once the server grants it.

Authority is the spine. A source records what the Gateway granted, never what
Exawatt asked for; the write tier of the allowlist gates on the grant, so a
surface that runs ahead of an approval is refused locally before it can produce
a confusing server-side rejection. Send, abort, steer, and cancel are the whole
write vocabulary. There is no Pause, because the doc defers a generic remote
Pause until a source can prove a named halted scope, and a verb that merely
looked like one would be the approximation it forbids.

Sending addresses the Agent, not a session key, and the address is resolved
from the projection at every layer. That is the doc's rule about never silently
retargeting the composer, made unavailable rather than merely discouraged.
History is bounded twice, by turns and characters, and an Agent with no primary
conversation gets an explicit answer instead of an empty transcript that would
read as silence from the coworker. A reply in flight across a reconnect is
recovered from authoritative history, because the Gateway replays nothing, and
a retry reuses its idempotency key so a message that landed cannot post twice.

Work state gained its second evidence source: a cron job the source attributes
to an Agent, enabled, whose last run failed, makes `error` reachable. The task
totals in `status` deliberately do not, being source-wide with no per-Agent
axis. `complete`, `blocked`, and `reviewing` remain unreachable and are listed
by name so that adding evidence has to be deliberate.

The workspace now models two honest kinds of tab. A coworker has no working
directory, no harness, no exit code, and no Session to resume, so `WorkspaceTab`
became a discriminated union and the compiler walked every consumer that had
assumed otherwise. Cloning, reviving, splitting, resuming, and worktrees are
session verbs and now say so. The layout schema is v7, migrating every tab a v6
file holds to a session, which is all v6 could have meant. Opening a coworker
from Team opens its conversation, so the surface is reachable rather than
latent.

One correction to production came with the status word the operator chose. The
Team tile drew its mark from the status projection and its label from the turn
vocabulary, two channels that could disagree and did: a tile whose Agent had
failed announced "result ready" beside a red light. Both now derive from one
projection.

### 2026-08-19 — the contract found six defects, and two claims that were not true

C3's first deliverable is a lifecycle contract written once and run against a
Demo source in CI, which is also the last unmet H1 criterion: _"Demo and live
adapters pass the same projection and lifecycle contract tests."_ Standing the
real runtime and the real session up over simulated evidence, with the real
store on a temp directory, found six defects in code that had passed every
suite and two live probes.

Three would have been felt.

**Pressing Reconnect blinded the session and leaked a tunnel.** `connect()`
established a new tunnel and client over a live one without tearing the old
down, and the drop watcher refused to attach because a previous one existed. So
after one Reconnect the session could never see a drop again, kept reporting
`Live`, and left an orphaned `ssh` child holding a port open to the operator's
server.

**Retiring one Agent emptied the whole roster.** A plan mapping whose Agent the
source no longer declares is a fatal projection error, so `agents()` returned
nothing at all: one Agent retiring on one server removed every connected
coworker from every source, with no explanation on screen.

**Detach left the coworkers standing.** The record and credential went, but the
session, its snapshot, and the source's mappings stayed, so detached coworkers
remained in the roster until quit and the projection file grew forever. And
reattaching the same server minted new ids, so the same people came back as
strangers.

Two entries above this one claimed more than the code did, and the contract is
how that surfaced.

The C2 entry says a failing automation "makes `error` reachable". The kernel did
derive it, and `discover()` did fetch `cron.list` and `status`, but it never
passed them to the adapter and the runtime never read the kernel's answer. The
evidence was gathered, thrown away, and recomputed less well. `error` was
unreachable end to end for as long as that entry has been written down.

The H2 entry describes following a reply as it arrives. The subscription was
taken before a connection existed, and the seam returned a no-op unsubscribe in
exactly that case, so nothing was ever subscribed and replies only appeared on
the next authoritative read. Degraded rather than wrong, but not what was
claimed.

Both are now fixed rather than reworded. The lesson is the one the contract was
built for: a claim in a milestone log is not evidence, and a live probe that
exercises the happy path will not catch a signal that is collected and
discarded.

### 2026-08-19 — C3 landed, and the defect that was the milestone

The live proof drives the shipping runtime against both dogfood Gateways: real
store, real plan, real session, real client, real tunnel, with two seams only,
so the outage is Exawatt closing its own transport and a refusal is quoted in
the source's own words. Twenty-nine cases, green on both, and each server ends
the run holding exactly one device: the operator's own.

It found a seventh defect that the hermetic contract could not, and it was the
whole promise.

Exawatt persisted the scoped device token so that a saved source would
reconnect without ever re-reading the admin-capable Gateway secret again. It
was persisting half a credential. `OCClient` minted a fresh keypair in its
constructor, the session built a new client per connection, and the Gateway
derives a device id from the public key and binds the token to it. Every launch
after the first therefore presented a stranger holding someone else's token and
was refused. Because credential resolution short-circuits whenever a stored
token exists, nothing re-bootstrapped: a saved source was permanently
unavailable. Quit overnight, come back, and the coworker was gone, which is the
one story this milestone exists to make true.

No fixture could see it and neither could the new contract, because both build
one client per test and a relaunch is the second one. That is the shape worth
remembering: a promise about the SECOND time cannot be proved by a suite that
only ever does something once.

The identity is persisted with the token now, encrypted alike, cleared
together, gone on detach, and owned by the session rather than the socket so
the first connect, each reconnect, and a scope renegotiation are all one
device. A token found without a keypair is ignored, which repairs the state the
shipped build left behind. A refused credential is discarded and named in the
source's words rather than reported as an unreachable Gateway, and the ladder
stops rather than re-pairing on a timer, since re-pairing mints a device and
re-reads the secret and that is the operator's decision to make.

**H1 is complete.** Both Gateways connect by alias with no address typed,
discovery offers only what the source declares configured, retained identities
never rejoin on their own, contexts stay subordinate through every transition,
rename and Project mapping leave the source byte-identical, detach removes
Exawatt's record and nothing else, reattaching returns the same coworkers
rather than strangers, identity drift is reported rather than guessed, and a
relaunch returns to the same Agent on the credential it kept.

### 2026-08-19 — the hardening pass, and what looking at it found

The operator asked that connecting to a Gateway you already run be bulletproof
before anything is built on top of it. Three passes ran: a first-ever visual
review, the manual-server transport proved against a real machine, and an
architecture and correctness sweep.

**Nobody had ever looked at the UI.** Three milestones of surface shipped
unit-tested and protocol-proved and unseen, against a standing rule that every
UI change is screenshotted on localhost first. Fifty screenshots later, the
review found the whole Connect dialog set in monospace across twenty-one sites,
which the design system reserves for tracked micro-labels and never for a
sentence, so the flow read as a terminal dump. It found stale and unavailable
dimming the transcript while leaving the work stack at full strength, which is
"no stale result is presented as current" broken on the loudest claim on the
page. It found a conversation opening at its oldest message, with the composer
four screens below the fold. None of that is subtle, and none of it needed a
user to discover.

**Two lies the fakes were telling.** The four-step connection checklist never
moved: `ipcRenderer.invoke` arguments must be structured-clonable, so the stage
callback was dropped at the process boundary and could never have arrived. It
survived review because every test injected a bridge double that honoured a
callback the real preload cannot deliver. The doubles were more capable than
reality, so the suite was green about a thing that had never once worked. The
fix subscribes to the phase broadcast that already existed, and the new test
builds its bridge from the real preload surface rather than from a fixture.

The same shape appeared in the credential bootstrap. It lacked the multiplexing
refusal the tunnel had, so on a machine whose SSH config sets `ControlMaster
auto` it rode a socket an earlier connection had opened. The proof is a manual
server naming a key file that does not exist, reading the Gateway credential
successfully. Exawatt would have told an operator their details worked, saved
the source, and broken when the borrowed socket expired.

**A verification hole underneath both.** The Electron build config excludes
`*.test.ts` and the root config excludes `electron/`, so no Electron test file
had ever been type-checked. A refactor moved two exports and the entire live
suite became unrunnable in silence, because the only thing that would have
complained was a test run that does not happen in CI. `electron/tsconfig.test.json`
now checks the connected-source subsystem's tests, scoped deliberately: the
backlog elsewhere is real and not this change's to fix, and a check that runs is
worth more than a comprehensive one that stays unwired.

**One operational finding worth keeping.** One of the dogfood servers runs
fail2ban with an empty `ignoreip`, five attempts, an hour's ban. A refused-login
probe is a counted failure there, so a few suite runs would have banned the
operator from their own production machine. That probe is now opt-in behind its
own flag; every other failure case uses a name that never resolves or a port
nothing answers, so none of them reach sshd at all.

### 2026-08-19 — three ways an absence passed for a fact

A live run against both dogfood Gateways failed five tests, and the failures
were worth more than the pass would have been. None of them were in a product
path. All of them were in the checks that guard the safety claims, which is the
worse place to be wrong.

`deviceListing` answered an unreadable listing with an empty listing. Its
comment defended the choice -- an unreadable listing means no cleanup target,
never a guess -- and that reasoning holds in exactly one direction. The same
helper takes the BEFORE snapshot that cleanup subtracts against, so a single
swallowed SSH failure empties `devicesBefore`, and every device on the server
then looks like one this run created. The operator's own `operator.admin`
credential is on that list. It also feeds the untouched-server comparison,
where two failed reads compare empty to empty and report a clean result: the
strongest claim this project makes, satisfiable without ever reading the
server. The listing now retries and then throws, and cleanup refuses to delete
on evidence it could not read.

The out-of-band verifier hit our own deadline. `observeSource` reads server
state through the source's CLI rather than through the Gateway socket under
test, on purpose: asking the path under test whether the path under test
changed anything is asking the suspect for an alibi. The cost is that it runs
`openclaw` on a live production box while that box is also serving the
connection being tested, and those invocations are sometimes slower than one
exec deadline. The symptom was `exit null` -- not a server error, our own kill
-- on commands that take three seconds when asked on their own. Retried now,
for the same reason: "the command did not finish" and "there are no cron jobs"
must never arrive looking alike.

The read-only proof cannot tell refusal from silence. Three writes are attempted
and asserted to reject, under a comment claiming the server refuses rather than
Exawatt declining. But `call` times out after ten seconds, so a Gateway that
simply never answers satisfies the assertion identically. Both dogfood servers
do refuse properly, which is why this has never shown as red. It is still a
proof of the wrong thing.

One measurement worth keeping: disabling SSH multiplexing, which C1 correctly
required so a detach cannot hand its forward to someone else's master, costs
connections. One suite run now opens over five hundred authenticated SSH
sessions against a single server. Neither dogfood box throttles at that rate
and production opens a handful per source, so nothing needs changing -- but the
number is the kind that stops being free at a customer's scale, and it should
be known before it is discovered.

### 2026-08-20 — runtime truth closed the gaps between green seams

The source kernel now does what the live protocol and fleet surface claim. A
conversation send uses the Gateway's `message` field. An approved write request
re-reads the source-owned issuer secret only on the explicit gesture, presents
the same persisted device keypair, and persists the newly issued scoped token;
pending or refused approval restores the read token, and no local path widens
authority. A fresh SSH-alias source reads its declared Gateway port before the
first forward, persists that mutable port without changing source identity, and
uses it instead of the renderer's valid-but-placeholder default.

Observation is continuous rather than a connect-time snapshot. Healthy sources
replace topology every thirty seconds, presence bursts coalesce into one
authoritative read, and each replacement reaches the runtime revision seam.
Failed reads and first-launch outages are visibly Reconnecting. The fast retry
ladder becomes one quiet maintenance retry per minute instead of a terminal
wall, while credential refusal, incompatible protocol, and identity drift stay
terminal because waiting cannot repair them. Contract tests cover the exact
send envelope, same-device scope reissue, non-default alias port, periodic and
coalesced replacement, initial recovery, and recovery after the fast ladder.

### 2026-08-20 — the existing-fleet surfaces became one product path

The Connect dialog now persists the complete Agent mapping before it closes,
then resolves the source-qualified native identity through the refreshed roster
and opens the stable projected Agent. Team reads that same roster, while Fleet
preserves placement and connection freshness and hands the same projected id
back to the Agent altitude instead of routing a remote coworker through a local
PTY Session path.

Connect-created Projects are durable `manual` records with opaque Exawatt ids,
renameable labels, and `root_path: null`. A folderless Project remains openable;
Finder, local launch, worktree, and other local-path verbs are withheld rather
than receiving a synthetic path. Existing Projects remain shareable across
Agents and sources, and source detach does not delete them.

One assembled renderer/preload contract now exercises Connect, the atomic
mapping acknowledgement, roster refresh, Team projection, and Agent open as a
single path. The current-work and automation presentation remains intentionally
empty in production because the renderer roster does not yet carry the
runtime's bounded work/automation evidence. A later packet must add a bounded,
source-reported DTO at the existing roster boundary and feed
`RemoteAgentSurface.work`; inventing it from `contextCount` here would turn a
count into work-state truth.

### 2026-08-20 — C5 closed in the official app against the existing fleet

The final packaged two-Gateway gate at `436286f5a155` passed initial launch and
relaunch through the real preload/IPC/runtime/UI: three Agents,
Agent/Team/Fleet DOM and open parity, authority-gated send/reply,
outage/recovery, and credential reuse.

Separately, dogfood installed the exact official app from
`7dc07d2c29c31e26917c001f63038c07b30a7b23`. The exact `436286f5a155` gate
script was overlaid in a detached checkout without changing the installed app.
That app connected the operator's two live Gateways by their existing SSH
aliases and returned three source-qualified Agents. Team and Fleet opened those
same Agents, and a full quit and relaunch preserved the Agent identities,
Project mappings, and UI open paths without duplication.

The live pass was deliberately observation-only: neither Gateway had granted
`operator.write`, the app exposed no send authority, no message was sent, and
Exawatt did not widen scope. The gate removed the exact device IDs it created.
Independent readback then found one older pre-existing CLI device and zero
Exawatt UI read devices on each source. C5 and ENG-010 are complete. ENG-033
H3/H4 remain future design work; no paid-cloud implementation is active.

### 2026-09-14 — the first real connect from the installed app found the list clipped

Twenty-five days after C5, the operator opened ⌘N → Connect existing Agent in
the installed app for the first time, and neither Hetzner alias was in the
list. Every layer between the file and the dialog was checked and every layer
was right: the parser returns twelve aliases, the bundle inside the installed
app returns twelve when its own enumerator is run outside Electron, and the
dialog renders every alias it receives. The defect was the dialog's own box.
The base dialog is a CSS grid; Connect caps its height and hides overflow but
never made itself a flex column, so the body's shrink-and-scroll classes meant
nothing, the list grew to its full height, and the container clipped it at a
row boundary. Ten rows fit exactly, so the list looked complete (BUG-132).

Two things worth keeping. C4's visual review, fifty screenshots deep, could not
have seen this: the reviewer's SSH config was short, and a list that fits is
indistinguishable from a list that scrolls. A layout defect that depends on
the operator's data needs a fixture longer than any reviewer's, which the
agent-sources eval now carries: sixteen aliases in a fake home, Connect opened
from Settings, and a check that the overflowing element is one the operator
can scroll. That last clause is the load-bearing one. On the old layout the
last row can still be brought inside the dialog programmatically, because an
`overflow: hidden` box scrolls for `scrollIntoView` even though it will not
scroll for a wheel; "the last row is inside the dialog" passed on the broken
build, and only "the overflowing element is `overflow-y: auto`" failed it.
The negative run was made before the fix was trusted.

The second: this is the first record of the feature being used from the
installed app at all. The two Gateways the milestones were proved against
have not been connected since C5 cleaned up after itself, and the main log
carries no connected-source event between 2026-08-17 and today. What ENG-010
shipped is proven; what it has not yet had is a day of ordinary use.

### 2026-09-16 — state for pickup

BUG-132 integrated as `6a1daaac`, dogfood-installed the same night, and the
app was relaunched on that build on 2026-09-14. The connected-source store file
now exists and holds zero sources: the operator opened Connect during the
clipped-list night and did not save a source. H2.1–H2.3 above are shaped from
the gaps this document already recorded; the first move is still to connect
both Gateways and live with them.

### 2026-09-16 — seven defects, one predicate

The release-candidate review of this path found seven defects (BUG-146). None
was live-reported and none blocked the release alone; together they were one
class, and the class was about to ship in the first release with remote
Connect. Two layers had collapsed "the connection failed" into "the source
refused", and three had thrown a verdict that cannot change on retry in the
same shape as a failure that can. Each was fixed by making the predicate
explicit where it is produced, and each fix is pinned by a unit fixture that
fails without it; the mutation run reverted all of them at once and every
item's test went red.

**The bootstrap read the wrong thing first.** `bootstrapGatewayCredentialOverSsh`
probed `openclaw --version` before anything else, on the reading that it was
the cheapest proof the login worked and OpenClaw was there. It runs under the
server's non-interactive `sshd` shell, and a Homebrew or npm OpenClaw that
the login shell finds is routinely absent from that PATH. The configuration
file, which is the trustworthy credential source and the only place the
declared port appears, sat behind that probe; `openclaw-missing` mapped to
`gateway-down`; and the ladder re-ran the whole bootstrap, four SSH logins,
every 60 seconds for as long as the source was saved. The file is read first
now and is never gated on the binary. The version probe stays as evidence and
as the one fact that says whether the CLI is worth asking; the CLI is asked
only when the file holds nothing literal and the binary answered, which also
takes the happy path from three logins to two. `openclaw-missing` is reached
only beside an unreadable file, and `BOOTSTRAP_FAILURE_TO_SOURCE_FAILURE` is
now pinned by a test that lets only `unreachable` become a class the ladder
retries. The C1 note that "the file is the trustworthy source and the CLI is
only worth trying when the file has nothing literal to give" was already the
stated rule; the code had not followed it all the way.

**A mask is a refusal.** The same C1 live run recorded that `config get
gateway.auth.token` answers with a masked value on 2026.7.x. `parseCliToken`
still accepted `***`: it is one whitespace-free line, which was the whole
shape test, and it ranked above the honest `token-unavailable`. Any mask
glyph in the answer now fails closed toward the file.

**The file is JSON5.** OpenClaw's own loader parses `openclaw.json` with
`JSON5.parse`; both Exawatt readers used `JSON.parse`, so a hand-edited file
with a comment or a trailing comma read as "could not read the configuration"
and sent the operator to check a permission on a file the Gateway was reading
fine. `parseGatewayConfigText` in `@exawatt/core` is the one grammar now, used
by the local read and the remote bootstrap. `json5` 2.2.3 was already in the
dependency graph (Babel, electron-builder); it becomes a production dependency
of `@exawatt/core`, which places it in the Electron runtime closure
`scripts/lib/electron-runtime-deps.mjs` stages, and the notices file was
regenerated.

**Silence is not a refusal.** `pair()` fell back from write to read on any
`!opened.ok` and then persisted `read` to the record, so one timed-out
handshake on the way to a source that still approved write downgraded the
saved source for good: the next reconnect asked for what the record now said.
The core client marks a rejection the Gateway actually answered
(`OCGatewayError`), and `openHandshake` reports `answered` beside the
sentence. The marker is read structurally (`gatewayAnswered`) rather than by
`instanceof`, because main's CJS bundle and the workspace package can hold two
copies of the module and a class identity check would silently read every
refusal as silence. The fallback fires only on an answered refusal; a timeout
keeps the write ask, classifies as `gateway-down`, and rides the ladder, which
the fixture proves by silencing one handshake and watching the retry pair at
write scope with nothing persisted.

**A verdict is not a failure.** The Codex read adapter judged an installed
app-server older than 0.147 by throwing a plain error from `connect()`, and
the observer's ladder, capped at 30 seconds with no memory, spawned a login
shell and a `codex app-server` on every tick for as long as any Codex Session
was live. `CodexProtocolIncompatibleError` marks a permanent verdict; the
observer holds it instead of retrying, keyed to the binary it judged (the
path is resolved through the login shell once, at verdict time; each later
poll is a `stat`) and to the Session set it was judged over. It looks again
when the binary on disk changes or when a new Codex Session is observed, which
is the operator's own moment to have upgraded; nothing lifts it on a timer.
The `thread/items/list` page over the 2 MiB frame cap was verified by code
path to enter the same loop: `acceptOutput` fails the client, the pending read
rejects, the observer withdraws and reconnects into the same page. It is a
verdict about the binary and the thread rather than the binary alone, and the
frame's owner is not attributable from the byte stream, so it rides the same
per-binary memory and is lifted by the same Session-set change. That is
coarser than ideal and strictly better than today: the same observation was
already withdrawn for every root on each overflow, with a spawn every 30
seconds on top.

**Drift reported and kept the connection.** The drift branch returned before
`establish()`'s teardown and before `watchForDrops()`, so a session in
`failed` held an `ssh` child with a forward open on the operator's server and
a Gateway subscription streaming into nothing, until remap or quit. The drift
branch of `discover()` closes the connection itself now, which covers both
paths in, first connect and periodic read; the snapshot and identity it keeps
for the operator were never the connection.

**A frame that is not a frame.** `socket.onmessage` called
`void this._handleMessage(...)`; a JSON `null`, a primitive, an array, or a
`connect.challenge` without a nonce threw inside that detached promise, and
main registered no `unhandledRejection` listener, so the throw reached
nothing. The handler is total for those shapes, the detached call has a
catch wall that emits `connection:error`, and the fixture asserts no
rejection escapes across every shape while a later real handshake still
completes. This is adjacent to BUG-129 rather than BUG-129: main now has
`electron/main/unhandled-rejection-trace.ts`, one `main.unhandled-rejection`
record per escaped rejection in `logs/main.jsonl`, at most six per minute and
two hundred per run, one `suppressed` line per window and one `exhausted` line
per run after that, disabled permanently on its own first throw, exactly the
stall trace's discipline. The renderer half and the `render-process-gone` and
`unresponsive` handling stay open under BUG-129.

What a fixture cannot prove: the two operator Gateways were not connected for
this change, so the reordered bootstrap has not run against a real `sshd`
PATH, and the live two-Gateway test self-skipped as designed. The behaviours
that changed are all on the far side of injected seams the C3 and C5 live
passes already exercised; the next real connect from the installed app is the
observation that closes this.

### 2026-09-16 — the release-candidate review found the connect path dead-ending and the coworker pane forgetful

A read-only review of the renderer against current master, two days after
BUG-132, confirmed five defects on ENG-010's own path. None had been seen in
use, for the reason the BUG-132 entry already gives: the feature has had no
ordinary day yet. All five landed in one change with a unit at the seam each
crossed, and every unit was run against the old shape first.

**File → Connect could not be cancelled (BUG-147).** The chooser hands the
screen to Connect by closing itself and takes it back by reopening itself,
which is right; what was wrong is that the route it was summoned on lived
beside `open` in `workspace-client` as standing state nobody reset, so the
reopen re-entered Connect every time. The repair is a shape, not a reset:
`useProjectOpenerState` makes closed a member of the same value as the route,
so a self-reopen cannot be on Connect and only a summons can. The test uses
the real hook; a harness that kept its own `route` beside `open` would have
reproduced the loop and proved nothing.

**The coworker pane forgot everything on a tab switch (BUG-148).** The stage
mounted `RemoteAgentPane` only while visible, on the reasoning that one
subscription per pane on screen beat one per tab ever opened. Every piece of
operator state lives in that pane, so the reasoning bought a subscription and
spent the operator's half-typed message, their undelivered outbox with its
retry, and the transcript they had already read, re-fetched over the tunnel
on the way back. This is BUG-041 again: the unmount IS the defect, and the
answer is the one a terminal pane already had. The pane takes its `layout`
and stays mounted while hidden; `pane-layout.ts` now holds
`PaneLayout`/`LAYOUT_CLASS` so the coworker pane does not import xterm to
share two constants with the terminal.

**A signed-out account build could not save the mapping (BUG-150).** The
mapping step needs a Project with a registry id; a signed-out operator has
none, so "New Project" was the only option and `openManualProject` threw
`Not authenticated` on Save, after the whole flow. The decision was between
making Connect work without an account and stating the prerequisite at the
entry point. The first, because the product already promises "Agents,
Projects, and Demo Mode work without an account", and because the mapping's
durable identity is main-process state that never needed the hosted row. The
registry now asks whether a user session exists, per call, instead of
whether the build declares an account, and serves the local namespace
otherwise; the chooser reads `projectRegistryScope()` and keeps its "Local
Projects" label for the signed-out case. What is NOT done: Projects made
locally while signed out do not migrate into the hosted registry on a later
sign-in. Repository Projects re-link by path on the next registry sync;
manual ones keep their local identity and keep working as local Projects.
That is recorded on the roadmap entry as the residual. (2026-09-23: the
residual was worse than written. Signed in, the registry listed only the
account's rows, so the local manual Projects did not keep working: they left
the chooser. They now stay listed and stay local, BUG-191; and a session
that could not be refreshed no longer counts as signed out, BUG-190. See the
2026-09-23 entry below.)

**A failed first read looked like a slow one (BUG-152).** The surface's catch
left `loading` standing when it had nothing last-known, and a refused read's
`unread` with a null context collapsed into the loading presentation in both
`frontDoorFor` and `composerFor`. Three facts, one line, no retry. The model
now names the third: `FrontDoor.unread`, a `conversation-unread` composer
reason, and `Try again` as its action on a reachable source, with Reconnect
staying the remedy on an unreachable one. An empty conversation says "No
messages yet" over a ready composer, so empty and loading no longer share a
presentation either.

**The selection panel counted silence as rest (BUG-151).** The board's own
census carries `unreported` as its sixth band (this doc, 2026-08-19), and
`selectSpatialScopeActivity` never learned that: `status: null` fell into
its `else`, the panel said "idle". `SpatialScopeActivity.unreported` is the
fourth count, drawn with the open-ring mark the status-light atom uses for
a reading nobody gave, in the unlit paint, because hue is not what separates
it from idle.

Two smaller things rode along because they sat on the same path. A superseded
roster read in `useRemoteCoworkers` answered `null`, which is the failed-read
value, so "Connect and open X" could close and open nothing when main's own
change tick raced the dialog's refresh; a superseded read now answers with
the newer read's roster, and the two callers fall back to the last-known
roster on a genuine failure. And the coworker surface's "Conversation
unavailable on this source" became "No conversation on this source", with
the gallery study it was copied from.

Evidence: `project-opener.test.tsx` (the cancel round trip and the second
summons), `remote-agent-pane.test.tsx` (full → hidden → full), the
`remote-agent-model`/`-surface` reads, `registry-signed-out.dom.test.ts`,
`spatial-board.test.ts`, `spatial-selection-panel.test.tsx`,
`use-remote-coworkers.test.tsx`; `eval:workspace:chrome`, `eval:navigation`,
and `eval:r3f` green against the worktree's dev server. The packaged gates
(`eval:electron:connected-fleet`, `eval:electron:lifecycle`) were waived for
this landing: no packaged build of this tree exists and the review asked for
no dogfood build; the connected-fleet eval is the next thing to run against
the next packaged candidate.


### 2026-09-23 — the fixes that stayed on a branch, and a trace nobody could read

The operator's second attempt to connect the fleet, on 2026-09-21 in 0.1.13,
left the store with zero sources and the projection plan with zero mappings,
both files written in the same minute a day into the app's run. Nothing else
survived: `main.jsonl` has never carried a line from this subsystem, and
`connected-sources.jsonl` was written only for a refused projection, so it
did not exist. A refused tunnel, a Save that threw, and a Cancel were
indistinguishable after the fact. BUG-150's signed-out Save failure matches
the trace; nothing on disk can confirm it.

The same week held the answer to part of it. The 2026-09-16 release-candidate
review had written eight fixes on this path, the C6 predicate hardening on
`agent/fix-gateway-hardening` and the renderer repairs on
`agent/fix-renderer-blockers`, and neither branch was landed. Two other
release blockers from that review were, and 0.1.12 and 0.1.13 shipped from
master without these. Their authoring session confirmed on 2026-09-23 that the
branches were abandoned and handed them over; both were applied to master that
day in a fresh worktree, with conflicts only where master had grown beside
them (a new Codex item parser at the same spot as the binary resolver, and
dated doc entries).

Their bug ids had collided twice, with each other and with master, which had
since assigned BUG-141 to BUG-145 elsewhere. They were renumbered in one pass
over the patches, commit messages included. For anyone reading the stale
branches or their session transcript:

| On the branch | Now | Record |
| --- | --- | --- |
| gateway BUG-141 | BUG-146 | Connected sources threw permanent verdicts as retryable failures |
| renderer BUG-141 | BUG-147 | File → Connect existing Agent… could not be cancelled |
| renderer BUG-142 | BUG-148 | A coworker's draft, outbox, and transcript were discarded on tab switch |
| renderer BUG-143 | BUG-149 | An ungranted Claude plan read looked like the operator's own switch |
| renderer BUG-144 | BUG-150 | A signed-out account build could not finish Connect |
| renderer BUG-145 | BUG-151 | The Fleet selection panel counted an unreported coworker as idle |
| renderer BUG-146 | BUG-152 | A failed conversation read said "Opening the conversation" forever |
| renderer BUG-147 | BUG-153 | Limitation copy and em dashes in global chrome and usage |

C7 closes the evidence gap rather than guessing at the 2026-09-21 cause
(BUG-154). Every operator act on a source and every phase transition now
writes one line to `connected-sources.jsonl`, in fields a bug report can
carry without describing the operator's infrastructure, and the bug report
attaches the file. The packaged connected-fleet gate, which the renderer
repairs had waived for want of a packaged build, ran on the landed tree and
now also proves the real IPC writes those lines and names no source.

Next is unchanged and still the operator's: connect both Gateways on a build
that carries this, and let the log say what happens.

### 2026-09-23 — an expired session was read as signed out, and signed-out Projects left on sign-in

**The registry now tells signed out from unknown, and keeps local Projects
local and listed.** A second read-only release-candidate review found two
defects in BUG-150's own fix, both shipped in 0.1.14's candidate.

**An expired session wrote the operator's work locally (BUG-190).** The
registry decided hosted-vs-local from `getSession()`'s session alone. In
auth-js 2.86.0, an access token that expired while the machine was offline
comes back as `{ session: null, error }` (`GoTrueClient.__loadSession`: the
refresh fails, the session is withheld, the error is returned). The error was
ignored, so an operator signed in but offline for an hour was treated as
signed out: opening a folder wrote a local-only Project and the workspace
adopted its local id, Connect saved each Agent's Project locally, and the
chooser said "Local Projects" instead of saying it was not syncing. 0.1.13
threw here. The repair restores that behaviour and names it: signed out is
"no session and no error" and nothing else. An error, or a session read that
throws, is `ProjectRegistryUnavailableError`. `listProjects`, `openRepositoryProject`
and `openManualProject` refuse, nothing is written anywhere, the chooser says
"Not syncing", and Connect's Save says Projects are not syncing and to try
again. This is the absence-is-not-an-answer rule again: a failed read
returned the same value as a successful read of nobody.

**Projects made signed out left the chooser on sign-in (BUG-191).** The
BUG-150 entry above recorded the intent: no migration; repository Projects
re-link by path; manual Projects keep their local identity and keep working
as local Projects. The code did not honour the second half. Signed in,
`listProjects` served only the account's rows, so every local manual Project
dropped out, and Connect mints one manual Project per Agent by default, so
this was every coworker connected while signed out. The Agent's mapping in
main still named the local id, which no longer resolved to anything the
chooser showed. The intent stands and is now implemented rather than
extended. The decision is **keep them visible as local, do not migrate**:

- Signed in, the list is the account's Projects plus the local registry's
  Projects the account does not hold. A local repository Project whose folder
  the account already has gives way to the account's row, and the workspace
  re-links to it by path as before.
- A Project in the local registry is written locally whatever the session
  says now (`projectStoreHolding`): rename, color, rebind, archive, a
  Connect re-save, and its share of a reorder. Before, a hosted
  `update().eq('id', localId)` matched no row and reported success.
- The chooser marks a local Project "Local" beside the account's.

Migration was rejected rather than deferred. It would move data one way into
whichever account signs in next on this machine, and a repository Project
would collide with the account's `(user_id, root_path)` row and have to
change id, breaking the mapping that names it. Keeping the local id keeps
every mapping true.

The case that exercises both: an expired token, Connect two coworkers, then
back online. Save refuses with the not-syncing message and
nothing is minted; the same Save succeeds once the session refreshes and
creates account Projects. Connecting while truly signed out mints two local
manual Projects, which are listed, marked "Local", and still named by the
mapping after sign-in.

Evidence: `registry-signed-out.dom.test.ts` (the refresh-failed answer
refuses and writes nothing, the signed-in list keeps the Connect-minted
Projects, local writes never reach the account, the combined reorder) and
`project-opener.test.tsx` (not syncing is not "Local Projects"; the local
mark). Each was run against the pre-fix shape by mutation first: dropping
the error check, dropping the local merge, and routing writes by session
each fail their tests.

### 2026-09-23 — Instinct as the packaging bar for an always-on coworker

Operator evidence, given in session. Instinct is always on, keeps working
between messages, and arrives with its own email address, calendar and
document storage, so it can run a restaurant reservation end to end, including
the venue's replies. The operator wants to spin up one or more such agents and
see them beside the Exawatt fleet, and says the same applies to every harness
type. Recorded as demand for H3 managed placement and the per-agent identity it
implies; ENG-009 owns credentials. No scope is shaped and H3 remains not
active. Operator answer, same session: Exawatt should eventually give its
own agents that identity on any harness ("in the future"). This is long-term
direction, not the next build. [Source-side record](agent-source-architecture.md#2026-09-23--operator-direction-every-harness-type-first-class).

### 2026-09-23 — the audit, and the flow repair it produced

The operator said Connect felt "clunky, a little bit confusing, and has too
many clicks". A real-app walkthrough confirmed all three and found three
behaviour defects that no unit, eval, or packaged gate had seen, because each
needs a sequence of ordinary operator acts to reach: Cancel after re-picking a
connected server detached it (BUG-155); a pending send-access request had no
way to complete (BUG-156); a failed attempt stayed saved and kept dialing
(BUG-157). The failure copy also blamed a port an alias user never typed
(BUG-158).

The repair is ENG-010 C8. The store's add result now says whether it created
the record, and the flow releases only what it created, refuses to test a
server it was handed back, and marks saved servers Connected. It releases its
own failed attempt before starting on another server. The send-access pending
state names the server, shows the `openclaw devices` commands with Copy, and
offers Check again, which reports "Not approved yet" with the time. The model
test that pinned "no action while pending" had the premise backwards: the
request only completes when Exawatt asks again, so that test was pinning the
dead end.

Evidence: unit and component tests for each defect, each shown to fail with
its fix reverted; and a replay of the audit's failing scenarios in the real
app against the fixed tree. Check again said "Not approved yet" before the
server approved and opened the composer after; Cancel on the connected server
left 1 source and 2 mappings; the dead server was dialed once, before the
switch, and never after.

### 2026-09-24 — direction accepted, send access decided

The operator reviewed the `/hud-gallery/connect-flow` study and accepted the
direction. The operator decided send access as a per-server setup step with
two paths, one click or copy-and-run, which amends decision `0037` §4:
Exawatt may run the approval of its own pending request through the
operator's own SSH login, on an explicit gesture. It still holds no pairing or
admin authority of its own. The study was revised to show that step, and H2.4 is split into packets
P1 to P5 above.

### 2026-09-24 — send access in one click (H2.4 P3)

A read-only coworker's pane now offers "Approve on <server>" beside "Show
commands". The one click asks for write access exactly as before, which leaves
a request standing; reads the server's own pairing list with `openclaw devices
list --json`; takes the request whose device id (and public key) is Exawatt's;
runs `openclaw devices approve <that id>` over the operator's own SSH login;
and asks again, which reissues the device at the wider scope. The copy path
asks, names the same request, and shows `ssh <server>` then `openclaw devices
approve <id>` with a Copy button; Check again finishes it. A list that cannot
be read, a request that cannot be found, or an approval the server refuses
approves nothing, leaves the request standing, and says which one happened.

What keeps it narrow: the matcher approves only a request carrying Exawatt's
own device id, never one whose listed public key differs, never one asking for
more than `operator.read` and `operator.write` or for a role other than
operator, and never an id outside a letters, digits, dash, and underscore
grammar before it reaches a remote shell. Each of those four checks has a test
that fails when the check is removed. A source reached without an SSH login
keeps the ask-and-wait path, and the diagnostics log records how far a one
click got (`step`) and never the request id.

Evidence: the gateway fake now keeps pending requests the way the live build
does (a refused wider ask leaves one, a new ask supersedes it with a new id),
and `ConnectedGatewayFixture` does the same for real-app runs. A throwaway
real-app run through the preload, IPC, and a stand-in `ssh` connected two
servers, each with another device's request waiting: the one click granted
write in about 1.2 seconds and approved only Exawatt's request; the copy path
showed the exact id, the by-hand approval plus Check again opened the
composer, and both other devices' requests were still pending at the end.

Cost to carry into P5: the one click is six SSH logins (credential read twice
at two logins each, the list, the approval). Reusing the first credential read
for the second ask would make it four; measure it in P5's eval before
changing it.

### 2026-09-24 — Connect in one screen (H2.4 P2)

⌘N → Connect a server… opens straight onto the operator's servers: no source
step while OpenClaw is the only connectable adapter, a filter that takes focus
and counts what it hides, and Return on a filter narrowed to one server tests
it. Picking a server tests it on its own row, stage by stage off main's change
channel. A failure stays on that row, names the class and the source's own
sentence, and releases the record before it says "Nothing was saved"; a
release that itself fails says the record is still in Settings instead. The
server that answers opens its Agents beneath its row: configured ones checked,
retired ones apart and unchecked, each renameable in place, the five
connection facts one disclosure away, and one "Add to" Project for the batch.
The primary action names what it connects ("Connect Tyler", "Connect 2
Agents") and closes through to the first Agent as before. A saved server's row
says what it brings ("Connected · reddit, Scout") with Manage, and cannot start
a second connect.

The batch's default Project is the one the connected coworkers already live
in, found by identity from the roster, or a new Project named Remote. That is
the operator's "special project, like remote" without P1's registry work: P1
still owns making it an Exawatt-owned, renameable home, and can adopt the
Project by the identity the mappings already carry.

What did not change: main still needs a saved record to test, so the record is
written before the test and released on failure or when another server is
picked (BUG-157's rule, kept for a server that answered and was then passed
over). A main-side probe that persists only after discovery would remove the
brief window where a record exists mid-test; nothing the operator sees depends
on it, so it is not built.

The entry is renamed "Connect a server" everywhere: the dialog title, the ⌘N
chooser, the File menu ("Connect a Server…"), the verb manifest, Settings, the
product guide and reference, and the agent-sources eval, which no longer
clicks an adapter step. Historical records keep the name they had.

Evidence: 47 model and 29 dialog tests, rewritten for one screen, carry every
rule the step-by-step flow protected (retired identities, BUG-155 custody,
BUG-157 release, lost mapping acknowledgements, the manual draft, voice). A
throwaway real-app walkthrough against two Gateway fixtures, through the real
preload and a stand-in `ssh`, over the operator's twelve-alias shape: a dead
host failed on its row with nothing saved; typing `claw-a` and Return tested
the right server; "Connect 2 Agents" landed on Scout; reopening marked the
server connected with both coworkers; the second server defaulted into the
same Remote Project and "Connect Tyler" put all three mappings there. One
connect is ⌘N and three clicks, or ⌘N, two clicks, and a typed name; each
server costs three SSH logins.

### 2026-09-24 — the Connect flow is measured (H2.4 P5)

`eval:electron:connect-flow` drives ⌘N → Connect a server… and send access in
the real app, through the real preload, tunnel owner, and remote exec, against
two Gateway fixtures reached by a committed stand-in `ssh`
(`scripts/lib/connect-eval-ssh.mjs`). The stand-in answers the tunnel and the
five commands Exawatt runs on a source, keeps pairing state in the fixtures
through a loopback control port, and logs every login, so the eval can count
what each step costs on the operator's servers. Every name and address in it
is invented (RFC 5737 ranges and example domains) in the shape of a real
twelve-alias configuration.

It holds the flow to budgets: a connect takes three clicks or fewer after ⌘N
(two with a typed name), testing a server costs three SSH logins, a dead
server is dialed once and leaves nothing saved, and the one click costs six
logins and approves only Exawatt's own request while another device's request
waits beside it. It also checks the connected row (coworkers named, no second
connect), the shared default Project across two servers, the copy path's exact
`ssh` and `openclaw devices approve <id>` lines finishing through Check again,
and that the diagnostics log records the one click's step without naming a
server. It gates changes to the Connect dialog and model, the approval
matcher, and itself. First run: all sixteen checks passed.

