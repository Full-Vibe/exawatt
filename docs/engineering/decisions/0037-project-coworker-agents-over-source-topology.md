# 0037 Project coworker-shaped Agents over source-native topology

Date: 2026-08-16
Status: accepted — deliberately reversible; execution is ENG-010 and ENG-033

## Context

Exawatt's current local coding UI calls each Claude Code, Codex, OpenCode, or
Grok Build conversation an Agent. OpenClaw has a different native topology: one
Gateway may configure several durable Agents, and each configured Agent may own
a main conversation plus channel, cron, helper, and spawned Sessions.

Flattening every source Session into an Exawatt Agent would turn one coworker
into many apparent clones. Promoting an OpenClaw configured Agent into an Agent
Type would conflate a person with a reusable blueprint. Treating remote or
hosted execution as a separate kind of Agent would split the roster by
infrastructure rather than by who the operator is addressing.

The comparison evidence is in
`docs/research/market/2026-08-14-agent-identity-and-runtime-topology-comps.md`.
The first dogfood topology has two customer-hosted OpenClaw Gateways: one
configures Marcus and Scout; the other configures Tyler. Priya is retired and
must not silently re-enter the active roster from historical state.

## Decision

### 1. Agent is the coworker-shaped product projection

An Exawatt Agent is the stable, addressable thing the operator thinks of as a
coworker. It owns the name, current responsibility, attention target, and place
in Agent, Team, and Fleet.

- A configured OpenClaw Agent projects to one durable Exawatt Agent.
- A current local coding launch projects to one mission-bound Exawatt Agent.
- Source-native Sessions, threads, runs, channels, cron invocations, and helper
  contexts remain subordinate execution/context records unless the source
  exposes a separately addressable delegate that is operationally meaningful.
- Agent Type describes a reusable kind of worker; it is not the worker
  instance. Marcus may use a Reddit Marketer Type without becoming that Type.
- One source-qualified context may fill the Agent's primary-conversation role.
  Opening the Agent returns there; newer background activity does not silently
  change who the operator is addressing. OpenClaw maps the role to the
  configured Agent's exact `main` Session.

This is a product projection, not a claim that all harnesses share one native
ontology.

### 2. Preserve the native graph; version the projection

Exawatt stores source-qualified identity and topology without rewriting the
source:

```text
(configuredSourceId, nativeAgentId)
  -> exawattAgentId
  -> projectId
  -> optional display-name override
  -> projectionVersion
```

Native Agent IDs, Session/context IDs, lineage, source labels, and freshness
remain available as source records. The projection can be rebuilt under a
later version. A mapping edit changes Exawatt's view only.

Detaching a configured source or imported Agent removes the Exawatt projection
after confirmation. It never deletes or edits the remote Agent, workspace,
configuration, conversation history, automation, or credentials. Retired or
unconfigured native identities may remain discoverable in source detail but do
not return to the active roster automatically.

### 3. Placement is orthogonal to Agent identity

`local`, `customer-hosted`, and `exawatt-hosted` are placement/ownership facts
on a configured Agent Source. They do not create different Agent nouns or
different day-to-day command surfaces. “Hosted OpenClaw” is therefore not a
second adapter when it speaks the same OpenClaw contract.

The source instance, Gateway, Agent, Project, and Session remain distinct:

- configured source: the saved OpenClaw installation/endpoint and credential
  owner;
- Gateway: the connection path into that source;
- Agent: Marcus, Scout, Tyler, or another addressable coworker;
- Project: the operator-chosen context group where that Agent appears;
- Session: source context and execution history beneath the Agent.

One source instance may expose many Agents. A source instance is never
automatically a Project. Initial attach suggests one renameable Project per
imported Agent, while allowing an explicit existing-Project mapping.

### 4. Lifecycle and connection are separate facts

Closing or quitting Exawatt does not stop a remote Agent. Relaunch reopens the
same Exawatt Agent, reconnects to the same configured source, replaces cached
views from authoritative snapshots, and reconciles later events by stable
source/run identity. A connection-local sequence is not a durable replay
cursor. A stale or unreachable observation is not a stopped Agent.

Product commands name source-supported effects. `Pause`, `Resume`, `Stop
current work`, `Abort`, `Reconnect`, and `Disconnect` are not aliases. The UI
may place equivalent supported verbs consistently, but an adapter must not
pretend that disconnecting Exawatt paused OpenClaw or that a new context resumed
an old one.

### 5. Connect first; manage and move later

The Hosted Agents progression is one surface and one adapter family:

1. connect to and observe an existing customer-hosted OpenClaw;
2. command its Agents through capability-declared verbs;
3. provision an Exawatt-managed OpenClaw behind the same contract;
4. only then offer clone/move workflows with explicit state-transfer limits.

“Push to cloud” remains an announced promise until Exawatt can name what moves
and what remains source-local. It is not the label for attaching an existing
remote Agent.

## Reversibility guarantees

- No source-native identity is replaced by an Exawatt name or ID.
- No destructive source migration is part of attach.
- Projection policy is versioned and additive.
- Project and display-name mappings are editable.
- Detach is non-destructive to the source.
- Read-only observation ships before write authority.
- The first slice does not require Exawatt-hosted infrastructure.

## Consequences

- Primary roster surfaces speak Agent, not Session. Session remains canonical
  architecture vocabulary and can appear in technical detail, history, and
  diagnostics.
- ENG-028's phrase “the Type is the worker” is narrowed: the Type describes the
  kind of worker; the Agent is the coworker; the harness is the engine.
- ENG-010 owns the first implementation mile against customer-hosted OpenClaw.
  ENG-033 owns the broader hosted progression and does not become a parallel
  feature surface.
- ENG-011 later aggregates these projected Agents with local and other remote
  sources while retaining source-specific assurance and capability truth.

## Reversible scale-out rule

When one durable Agent has several simultaneous independent responsibilities,
the working projection keeps one coworker and shows a compact work stack in
Agent detail. A transient delegate remains subordinate; a separately
configured, persistent, directly addressable worker may become another Agent.
Concurrency alone never creates a coworker. The exact Team/Fleet presentation
remains reversible and must be tested with real multi-context OpenClaw activity.
The operator confirmed this as the default on 2026-08-16, explicitly as a
two-way door rather than a permanent ontology lock.
