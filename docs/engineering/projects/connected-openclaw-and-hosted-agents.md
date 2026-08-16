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
a two-way door. One scale-out detail remains deliberately deferred.

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
- open one coworker and understand current work without scanning raw contexts;
- continue the main conversation when command authority lands;
- distinguish Agent state from connection freshness;
- quit and relaunch without stopping remote work or losing the selected Agent;
- revise names, Project placement, and topology mapping without touching the
  source.

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
   supported Gateway endpoint.
3. Run a bounded connection test and show identity, version, placement,
   credential owner, and observed capabilities separately.
4. Discover configured Agents. Preselect active configured Agents; show retired
   or historical identities separately and unchecked.
5. For each selected Agent, confirm display name and Project mapping.
6. Save the configured source and versioned projection; open the selected Agent
   without starting, stopping, or modifying remote work.

Failure leaves the partially entered source as an editable draft only when the
operator has authored it. No failed discovery creates roster Agents.

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
- relaunch reconnects and catches up from the last observed source cursor;
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
- source-native context IDs, kinds, lineage, cursors, timestamps, and assurance;
- Exawatt Agent ID, Project mapping, optional name override, and projection
  version.

SSH is a transport/bootstrap choice, not the data model. Prefer the OpenClaw
Gateway protocol through an authenticated tunnel; do not make remote shell
scraping the fleet contract. Connection material stays in the OS keychain or
source-owned SSH configuration and never crosses into renderer state.

Snapshots are replaceable and idempotent. Events after the saved cursor merge
by source identity. A reconnect may refresh source facts but cannot duplicate
an Agent or silently change its Project.

Demo Mode must exercise the same configured-source, projection, placement,
freshness, and catch-up contracts with simulated evidence.

## Milestones

### ENG-010 — connect to existing OpenClaw

- **C0 Projection kernel and redacted fixtures — next.** Add source-qualified
  configured-Agent/context records, projection versioning, and pure mappings
  for the two-Gateway dogfood topology. No network or UI writes.
- **C1 Saved remote source and read-only transport.** Extend the source registry
  with customer-hosted placement, OS-owned connection material, bounded
  Gateway discovery, capability/freshness truth, and reconnect cursors.
- **C2 Connect flow and coworker projection.** Prototype the cross-surface state
  in `/hud-gallery`, then wire **⌘N → Connect existing Agent…**, explicit
  Project mapping, and read-only Marcus/Scout/Tyler Agent + Team views.
- **C3 Relaunch and dogfood proof.** Quit/relaunch, endpoint outage, source
  restart, renamed Project, detach/reattach, and retired-Agent cases preserve
  identity and never mutate the VPS.

### ENG-033 — one hosted progression

- **H0 Hosted topology contract — shaped 2026-08-16.** Decision `0037` makes
  placement orthogonal and keeps ENG-010/011/012 as execution owners.
- **H1 Observe existing infrastructure.** ENG-010 C0–C3; customer-hosted
  OpenClaw, read-only first.
- **H2 Command connected Agents.** Send/follow up through the configured Agent's
  main context, then add exact steer/abort/schedule/context verbs only where
  OpenClaw reports support and outcome evidence.
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
- Each imported Agent has an editable Project mapping and optional Exawatt name
  override; changing either does not modify OpenClaw.
- Agent and Team clearly distinguish Remote placement, connection freshness,
  and D40 work state without color-only communication.
- Closing or quitting Exawatt leaves remote work untouched. Relaunch returns to
  the same Agent and catches up without duplication.
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

## Deferred scale-out question

Working hypothesis: one durable coworker may own several simultaneous work
contexts, shown as a compact work stack; only a separately addressable delegate
becomes another Agent. Validate this against real OpenClaw concurrent work
before deciding the exact Team/Fleet threshold or adding a new canonical Work
or Assignment object.

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
