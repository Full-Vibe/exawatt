# Connected OpenClaw and hosted Agents (ENG-010 / ENG-033)

ENG-010 owns the connect-to-existing implementation. ENG-033 owns the hosted
product progression. This document is their shared execution detail, not a
second roadmap.

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

- Gateway A exposes active configured Agents Marcus and Scout.
- Gateway B exposes active configured Agent Tyler.
- Priya exists only as retired/dormant history and is not imported into the
  active roster unless the operator explicitly chooses it from source detail.
- Historical cron/helper contexts remain subordinate to their configured Agent
  and do not become coworkers.

No endpoint, IP address, token, password, or key belongs in fixtures, logs,
screenshots, or canonical docs.

### Information architecture

There is no separate “remote agents” workspace.

- **⌘N** gains a first-class **Connect existing Agent…** route beside Project
  open/create. It creates or selects a configured Agent Source, discovers its
  Agents, and asks where each selected Agent belongs.
- **Settings → Agent Sources** remains the complete source-instance and
  connection-health surface.
- **Agent, Team, and Fleet** remain the daily operating surfaces. Agent name and
  responsibility lead; source and placement are secondary identity.
- The existing `/cloud` preview becomes the eventual management/provisioning
  face for Exawatt-hosted placement, not a second roster.

Initial Project mapping is explicit. The flow suggests one renameable Project
per imported Agent because that matches the first dogfood topology, but the
operator may choose an existing Project or place several Agents together. A
Gateway is never silently turned into a Project.

### Connect flow

1. Invoke **⌘N → Connect existing Agent…**.
2. Choose **OpenClaw** and either an existing SSH host alias or a direct
   supported Gateway endpoint. Exawatt may passively list named SSH aliases and
   source-owned saved remote targets from local configuration, but it never
   probes or connects to one until the operator selects it. Candidate
   enumeration reads only alias/endpoint metadata and never imports secret
   payloads.
3. Run a bounded connection test and show identity, version, placement,
   credential owner, and observed capabilities separately.
4. Discover configured Agents. Preselect active configured Agents; show retired
   or historical identities separately and unchecked.
5. For each selected Agent, confirm display name and Project mapping.
6. Save the configured source and versioned projection; open the selected Agent
   without starting, stopping, or modifying remote work.

Failure leaves the partially entered source as an editable draft only when the
operator has authored it. No failed discovery creates roster Agents.

### Key states

| State                | What the operator sees                                           | Product rule                                                     |
| -------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| No connected sources | One concise Connect existing Agent action                        | No fake remote roster or required hosted signup                  |
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

The H1 read-only slice exposes no write, pause, resume, stop, scheduling, or
configuration control. H2 earns those controls one capability at a time.

### Source and data contract

The normalized boundary stores:

- configured source ID, adapter type, placement, endpoint reference, credential
  owner, version, capabilities, and last observation;
- source-qualified Agent ID and display metadata;
- source-native context IDs, kinds, lineage, primary-conversation role,
  timestamps, optional replay positions, and assurance;
- Exawatt Agent ID, Project mapping, optional name override, and projection
  version.

SSH is a transport/bootstrap choice, not the data model. Prefer the OpenClaw
Gateway protocol through an authenticated tunnel; do not make remote shell
scraping the fleet contract. Connection material stays in the OS keychain or
source-owned SSH configuration and never crosses into renderer state.

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

| Step | Engineering result                                     | What the operator gets                                                               |
| ---- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| C0   | Versioned Agent/context projection and fixtures        | No new surface yet; topology can change later without renaming or migrating the VPSs |
| C1   | Saved read-only source and Gateway transport           | Exawatt can safely test, remember, diagnose, and reconnect to each Hetzner source    |
| C2   | Connect flow plus Agent/Team projection                | Marcus, Scout, and Tyler appear as remote coworkers with read-only conversation/work |
| C3   | Relaunch, outage, rename, detach, and retirement proof | Quit/reopen and transient failures preserve the same coworkers without VPS mutation  |
| H2   | Capability-declared command path                       | Talk to a coworker and later steer/stop only where OpenClaw proves the exact effect  |
| H3   | Exawatt-managed OpenClaw placement                     | Create a hosted coworker without learning a second roster or control surface         |
| H4   | Explicit clone/move with a transfer manifest           | Move or copy a coworker only after seeing exactly what transfers and what does not   |

### ENG-010 — connect to existing OpenClaw

- **C0 Projection kernel and redacted fixtures — next.** Add source-qualified
  configured-Agent/context records, the primary-conversation role, projection
  versioning, and pure mappings for the two-Gateway dogfood topology. No network
  or UI writes.
- **C1 Saved remote source and read-only transport.** Extend the source registry
  with customer-hosted placement, OS-owned connection material, bounded
  Gateway discovery, capability/freshness truth, authoritative reconnect
  snapshots, subscriptions, and optional source-declared replay positions.
- **C2 Connect flow and coworker projection.** Prototype the cross-surface state
  in `/hud-gallery`, then wire **⌘N → Connect existing Agent…**, explicit
  Project mapping, and read-only Marcus/Scout/Tyler Agent + Team views with a
  bounded primary-conversation history and compact current-work stack.
- **C3 Relaunch and dogfood proof.** Quit/relaunch, endpoint outage, source
  restart, renamed Project, detach/reattach, and retired-Agent cases preserve
  identity and never mutate the VPS.

### ENG-033 — one hosted progression

- **H0 Hosted topology contract — shaped 2026-08-16.** Decision `0037` makes
  placement orthogonal and keeps ENG-010/011/012 as execution owners.
- **H1 Observe existing infrastructure.** ENG-010 C0–C3; customer-hosted
  OpenClaw, read-only first.
- **H2 Command connected Agents.** Send/follow up through the configured Agent's
  primary conversation (OpenClaw `main`), then add exact
  steer/abort/schedule/context verbs only where OpenClaw reports support and
  outcome evidence.
- **H3 Exawatt-managed placement.** Provision and operate an Exawatt-managed
  OpenClaw behind the same source, Agent, Project, state, and command contracts.
- **H4 Clone or move.** Offer a source-to-source handoff only after the product
  can enumerate workspace, secrets, memory, automations, history, and identity
  transfer. “Push” cannot imply provider-state continuity that did not occur.

ENG-011 later proves mixed-source scale; ENG-012 supplies hosted metadata,
governance, policy ceilings, and billing. Neither owns a parallel roster.

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
  one.
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
