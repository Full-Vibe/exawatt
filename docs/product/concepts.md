<!-- Generated for the public repository by the "public-document-set" recipe. -->
# Product Concepts

These terms are canonical. Use them consistently in product docs, architecture docs, UI labels, and `/architecture`.

## Workspace

A boundary for users, agents, initiatives, context, secrets, spend, policies, and governance.

Examples:

- Jake's personal workspace
- FullVibe product workspace
- A company workspace for a team operating many agents

## Initiative

A durable high-level goal or area of responsibility. Initiatives are broader than tasks and should be understandable by non-technical users.

Examples:

- Maintain this codebase
- Plan Art Basel week
- Monitor churn risk and recommend interventions
- Run weekly product marketing experiments

The Agent altitude's ribbon projects current Session-backed tabs as **Initiative-shaped
work**: each tab answers what the operator is driving, not which harness process
exists. This is an intentional migration seam, not a claim that the full
Initiative primitive already exists. Near term the projection is usually
one-to-one with an Agent/Session; the durable model must allow one Initiative to
coordinate any number of Agents and Sessions over time without multiplying
top-level tabs for every worker or subagent.

## Project / Context Group

A user-facing cluster of related agent work. Near term, the UI should present these groups as Projects because that matches common SaaS mental models. Under the hood, the grouping should remain source-agnostic and able to resolve later by Initiative, repository, customer, goal, context signal, semantic similarity, or another durable grouping rule.

Examples:

- Exawatt demo polish
- OpenClaw local parity
- A repository and its active coding sessions
- A semantically related set of Codex or Claude Code tabs

Project / Context Group exists to make context switching cheaper. It should summarize current state, agent count, blocker pressure, recent activity, and the next useful human attention point without forcing the operator to inspect every Session.

A Project can be open with no Agent or Session running. Selecting a Project
changes context; it does not implicitly create work.

An explicitly opened zero-Agent Project remains open. Closing its last Agent
also leaves the Project open: the empty composer is useful Project state, not a
countdown to deletion. Once that empty Project is inactive for a short tunable
dwell, its compact header moves into the ribbon's dormant tail. This is a stable
partition, not recency sorting: relative manual order is preserved among active
Projects and among dormant Projects. Selecting it restores its manual position;
starting work repopulates the same Project.

Only an explicit close closes an open Project. `⌘W` closes the active Agent tab
when one exists; on an active empty Project, the same close verb closes the
Project immediately. The Project context menu exposes the same command. Close
is not delete: durable identity remains in the library and `⌘N` reopens it.

The first operator-authored composer change promotes the empty state into a
draft Agent tab atomically; task, source, model, effort, worktree/branch, and
roadmap link then travel together as draft launch intent. Background catalog
loading does not make an untouched composer durable.

An open Project has one identity across the Agent, Team, and Fleet altitudes. Each
surface may present that Project at a different density, but all three keep it
visible when its Agent and Session counts are zero. Starting the first Agent
populates the existing Project; it must not create a second lookalike group.

The Agent altitude's Project ribbon is a single-row projection of this
hierarchy. Projects fold into counted containers before anything disappears;
the active Project's Initiative-shaped tabs shrink before the row uses
last-resort horizontal scrolling. Hidden Agent attention, faults, results,
own-turn activity, and delegated work roll up into the compact Project signal.
Attention never unfolds or reorders a Project.

## Agent

A durable, addressable worker projected as a coworker from any compatible
source. An Agent may be backed by OpenClaw, Codex, Claude Code, a custom
harness, or Demo Mode. The Agent is the thing the operator names, opens,
directs, and recognizes across Agent, Team, and Fleet; the source retains the
technical identities that make that projection honest.

Sources do not need the same native topology. A configured OpenClaw Agent maps
naturally to one durable Exawatt Agent above several contexts. A current local
coding launch maps to one mission-bound Agent above its provider conversation.
Exawatt preserves those source-native differences rather than flattening every
Session into a coworker or requiring OpenClaw to imitate a coding harness.

Agent and Agent Type are distinct. An Agent Type is a reusable blueprint for a
kind of worker — identity guidance, instructions, tools, requirements, and
defaults. An Agent is the individual coworker using that blueprint. A source
Agent never becomes a Type merely because it has a name or persona.

An Agent's work class is not a product boundary. Coding is the first dogfood
workload; research, marketing, operations, and other non-coding work use the
same Agent, Session, Event, Artifact, and command concepts. A source may expose
different tools or capabilities for those work classes without creating a
separate kind of Exawatt Agent.

An Agent may expose one source-declared **primary conversation**: the stable
place the operator talks to that coworker by default. This is a role played by
a source-qualified Session/context, not a second identity for the Agent.
Opening the Agent returns there; recent background activity never silently
retargets it. OpenClaw maps this role to the configured Agent's `main` Session;
a mission-bound coding Agent maps it to its current provider conversation. If
a source cannot declare one, Exawatt opens Agent summary instead of guessing
from the newest Session.

Agents can create or coordinate subagents when their source supports it. Exawatt
should model this without assuming all providers expose the same internal
structure. A source-native context, cron run, helper, or subagent is not
automatically another top-level coworker or Initiative: its activity rolls into
the parent Agent until it is separately addressable and operationally
meaningful. One durable Agent may therefore own multiple contexts without
appearing as several clones. A bounded subagent run is delegated work beneath
that coworker; a separately configured, persistent, directly addressable worker
may project as another Agent. Concurrency alone never creates a new coworker.

## Session

A durable context-bearing execution record for an Agent. A Session may be an
interactive conversation, autonomous run, channel context, scheduled
invocation, or another source-native unit. It may be short-lived or long-running.
A logical local Session can span multiple process incarnations: quitting
Exawatt stops the local process, while the Session identity, terminal history,
and exact source conversation identity can be restored and explicitly resumed
later. A remote Session may continue while Exawatt is closed.

**Pause** is a resumable lifecycle promise, not another word for closing a view
or losing a connection. For today's local coding Agent, Exawatt can stop the
owned process while retaining the exact Session identity needed to resume it.
For a remote Agent, Exawatt may use **Pause** only when the source can confirm
what execution and triggers are halted and can later continue the same Agent
and work from preserved source-native state. A prompt asking the Agent to wait,
a disconnected client, or a powered-off VPS is not silently promoted into that
contract.

Session is canonical architecture and diagnostic vocabulary, but it is not the
primary roster noun. Agent, Team, and Fleet lead with the coworker-shaped Agent;
Session appears where context, history, lineage, lifecycle, or source detail is
the actual subject.

A Session carries a durable context cue for human re-entry. Necessary
subtasks, revisions, and direct continuations keep that cue; a newer purpose
that changes the primary object or outcome enough to stand as its own
Initiative replaces it, even when both purposes share the same Project or
Session container.

Agent turn state is semantic, not a raw byte counter. Once a live Agent turn
settles as finished, provider redraws and terminal protocol output must not
silently change it back to working. A new explicit operator interaction opens
the next turn. Shell activity remains output-driven because shells do not have
Agent turns.

Use `Session` as the canonical normalized term when a source internally calls
the context-bearing execution record a run, thread, task, conversation, or
process. Preserve the source's native kind and identity beneath that
normalization.

Agent state is a projection over a Session, not a single status field. At a
fleet-comparison altitude it should keep five questions legible: whether the
work needs attention, which work it is, what meaningfully changed, where it is
going next, and how fresh the observation is. Attention, Agent turn state,
Session process lifecycle, plan position, and freshness remain independent
facts even when a view composes them into one row. The deeper projection and
navigation contract lives in
[Agent state at a glance](reference/agent-state.md).

Independent attention facts compose by meaning rather than arrival order. An
explicit human gate such as a bell or roadmap block outranks a quiet turn-end
result for the same Session, so result delivery cannot hide an unresolved
needs-you target.

## Event

A timestamped observation in the system.

An Event should preserve what happened, where the information came from, and
how much assurance Exawatt can honestly claim. When a source exposes enough
detail, Events should distinguish declared intent, a proposed action, a policy
or Approval result, an attempted action, and a confirmed real-world effect.
Those are different facts; a harness saying it sent a message is not the same
as Exawatt or another trusted system verifying delivery.

Assurance is composable rather than a single "safe" flag. Exawatt should be
able to identify, independently when applicable, what was:

- **reported** by an Agent Source / Harness;
- **observed** by Exawatt or another named observer;
- **authorized** by a person or Policy;
- **enforced** by a named harness, operating system, broker, or Exawatt;
- **verified** from an outcome, receipt, or other evidence.

Unavailable facets remain explicit rather than inferred. Evidence can point to
an Artifact or a source record without copying sensitive content into every
Event.

At comparison altitude, Exawatt promotes only Events that change the
operator's mental model: orientation, a finding, decision, plan revision,
meaningful progress boundary, delegation, blocker, question, recovery,
completion, or stop. Ordinary commands, tool calls, file changes, and test
results remain evidence beneath those Events unless they create a meaningful
state transition.

Examples:

- intent or proposed action declared
- status changed
- message streamed
- tool used
- file changed
- blocker raised
- approval requested
- policy evaluated
- real-world effect confirmed
- session aborted

## Artifact

Output produced or modified by an Agent or Session.

Examples:

- code diff
- screenshot
- report
- generated document
- deployment
- research note

## Consumption

Normalized resource usage. Consumption should support operational trust and resource allocation.

Examples:

- cost
- tokens
- energy
- time
- tool calls
- compute
- model-size-normalized token usage

Consumption should preserve raw usage measures before converting them to money. Provider pricing, discounts, free tiers, cached tokens, and contract terms change over time, so Exawatt should not treat public per-token price as the only source of truth. Where possible, Consumption should also connect resource usage to Initiative-level outcomes or KPI velocity.

The energy framing is canonical: tokens are a metered fluid — closer to oil or watts than to seats or licenses. Consumption design should expect energy-market economics — metered units, fluctuating unit prices, allocation under scarcity, and eventually market-style allocation by ROI — rather than flat SaaS accounting. This framing is load-bearing for the product name and for future resource-allocation surfaces; it describes how Consumption behaves, and does not rename any canonical concept.

## Decision

A durable choice or tradeoff that should improve future work. Decisions are scoped, not only attached to Agents.

Decisions should appear at high-leverage points where human taste, values, priority, risk tolerance, or conflict resolution can guide many downstream actions. The UI should prefer clear options, recommended defaults, and enough surrounding context for the operator to decide without reloading the whole Session in their head.

Decision scopes may include:

- Workspace
- Initiative
- Agent
- Session
- Context Signal
- Artifact
- Gateway / Harness

Examples:

- Workspace: Use Supabase for auth and app data.
- Agent: This coding agent should use Claude Sonnet.
- Session: Skipped destructive migration pending approval.
- Context Signal: Treat a PostHog conversion spike as high-priority context.
- Harness: Local OpenClaw is the first source of truth for session status.

## Attention Scheduling

The product discipline of routing scarce human cognition to the highest-leverage agent moments.

Attention Scheduling is not a literal neural graph or a decorative visualization motif. It is the operating model that decides when work can continue unattended, when a human should inspect state, and when a blocker, approval, credential, taste call, risk tradeoff, or priority conflict deserves operator focus.

Why it exists: operators reliably max out around five or six concurrent agent contexts. This is a working-memory limit, not a tooling gap — more monitors and more tabs do not raise it. Fleet scale beyond that ceiling must come from the interface and orchestration absorbing context on the operator's behalf, not from asking the human to scan more surfaces.

Prioritization is leverage-aware, not first-in-first-out. The surface scores each call for attention by how much it unblocks — the blocker type (a missing credential or a required approval usually gates more downstream work than a single clarifying question), how long it has waited, and how much related work is stalled around it — then lifts one hero moment, groups the secondary ones, and keeps routine activity quiet. Each surfaced item carries a short reason so the operator sees _why_ it matters before spending attention on it.

Attention navigation follows that visible truth. A jump command selects only an
Agent or Session currently carrying the needs-attention projection; routine
roadmap state, including an empty queue, never causes a hidden cross-surface
navigation. Contextual commands use the same rule more generally: their
shortcut, passive hint, command-palette row, and native-menu item must agree on
whether a current target exists.

Examples:

- one blocked agent is lifted into an operator attention lane while routine activity stays quiet
- a heartbeat suggests an approval because several sessions depend on the same missing credential
- a project cluster shows rising attention pressure without turning the whole interface into red alerts
- a Decision prompt lets the operator resolve a broad direction once instead of supervising many downstream steps

## Context Signal

An external or internal input stream that can inform agent behavior. Context Signals can be many-to-many across Agents and Initiatives inside a Workspace.

Examples:

- PostHog
- Slack
- email
- GitHub
- calendar
- CRM
- analytics events

## Secret / Credential

Managed access material that agents may request or use under policy.

Examples:

- API keys
- OAuth tokens
- SSH keys
- cloud credentials
- service account credentials

Credential ownership must remain explicit. A source-owned login, such as a
Claude Code or Codex account session, stays with that source and is repaired
through the source's own authentication flow; Exawatt observes only the
minimum status and identity the source exposes. A remote Gateway or future
custom source may require an Exawatt-managed connection credential. That
credential is narrowly scoped, stored in the operating system keychain, and
is not a general Secrets broker for Agents.

Secrets management is a buy-vs-build decision. The roadmap should include explicit research before choosing a vendor or building in-house.

## Agent Source / Harness

A runtime/provider boundary that can create, observe, and control agents.

An Agent Source is not the Agent itself. Sources expose different capabilities:
some create local interactive Sessions, some attach to durable remote Agents,
and some support resume, branch, background execution, or delegation. Product
commands should ask for the desired Agent action and let the adapter translate
it. A plain shell is a Project tool, not an Agent Source.

A user may configure more than one instance of the same source. The source
type names the adapter contract; a configured source records the operator's
chosen name, endpoint or local installation, placement (`local`,
`customer-hosted`, or `exawatt-hosted`), identity, and credential ownership.
Placement is infrastructure metadata, not a different kind of Agent or
adapter. Settings presents those configured sources as an Agent Source
registry rather than treating one global Claude, Codex, or OpenClaw account as
the product boundary.

Source authentication and source Consumption are independent facts. A source
may be entitled through an existing consumer subscription, a metered API key,
a hosted account, or another source-owned arrangement. When a compatible
harness supports subscription-backed sign-in, Exawatt uses that harness session
and does not require separate provider API billing. Plan ceilings and overage
rules remain provider-owned; Exawatt observes or reports only the evidence the
source actually exposes.

Source state is a set of independent facts, not one connected boolean:
installation, reachability, authentication, identity, version compatibility,
capability availability, freshness, and provenance. A source can therefore be
installed but signed out, authenticated but unreachable, or ready while a
particular capability remains unknown. Demo Scenario Sources use the same
shape and label their provenance as simulated.

Stable adapter declarations and runtime observations are different kinds of
truth. A declaration can say that an adapter supports launch or model
discovery; only an observed runtime check can say that this configured source
is currently usable. Demo evidence is explicitly simulated. A missing or stale
registry never becomes permission to launch: the runtime owner validates the
selected source again at the command boundary.

Sources also differ in the security controls they enforce and the activity or
evidence they expose. A source capability describes what can be requested; it
does not by itself grant authority or prove an effect occurred. Adapters should
describe these differences so Exawatt can present an honest assurance posture
instead of flattening every source into the same safety claim.

Model and reasoning effort are also source capabilities. A new-Agent command
may request a source-supported model/effort pair for that Session without
changing the harness's personal configuration. When a source cannot identify
an exact default or an environment policy overrides the request, Exawatt keeps
that uncertainty or constraint visible instead of inventing control.

The registry's source identity and account default are global source facts;
the composer shows the Project-effective launch choice. Those values may
differ without contradiction. Model catalogs are discovered from the source
when it exposes a supported machine-readable contract, and every catalog value
retains its provenance and freshness. If a source exposes only an account
default or an exact configured value, Exawatt shows that narrower truth and
routes catalog selection back to the source instead of shipping a hard-coded
list that will age underneath users.

Near term, the Agent Source or another user-chosen security system owns
enforcement. Exawatt translates visible launch preferences, normalizes the
activity the source reports, and makes unknowns legible; it does not claim to
independently sandbox or mediate every downstream action. Long term, Exawatt
may itself become a Harness or compose with enforcement components while
preserving the same source-agnostic concepts.

Examples:

- OpenClaw on the local machine
- OpenClaw on customer-hosted or Exawatt-hosted infrastructure
- Codex
- Claude Code
- OpenCode
- Grok Build
- custom harness
- Demo Scenario Source

## Launch Configuration

One selectable thing that carries a whole Agent launch: which configured Agent
Source runs it, which source-native model it uses, and its exact effort or
variant. The Harness is derived from the configured source; it is not sufficient
identity by itself because two source instances may use the same Harness with
different endpoints, accounts, catalogs, or readiness. Agent Type is a future
axis and remains explicitly coming soon; no Type identity is created today.

A Launch Configuration exists so that starting an Agent is one choice rather
than an assembly of independent settings. Its identity is deliberately those
axes and no more — launch permissions, worktree/branch, and roadmap association
are per-launch modifiers that travel beside a configuration rather than inside
it, so the same configuration can be started cautiously or freely without
becoming two things.

Configurations enter the reusable pool through a successful launch or explicit
naming, not through incidental setup work. Selection, navigation, edits,
abandoned composition, naming, and failed starts do not increase frecency.
Identity edits may remain in the existing composer draft tab's launch snapshot,
but that snapshot is not itself a reusable configuration. Closing it without a
successful launch or explicit naming adds nothing to the pool. Successful
launch structurally deduplicates or adds the configuration and updates only the
active Project's ranking. A Project may pin configurations above its learned
order.

Naming is optional and creates a friendly reusable preset, not an Agent Type.
A future Type may be one axis of that preset, but naming alone does not claim
portable identity, instructions, tools, or capability requirements. The common
new-Agent page remains a lightweight launcher; customization, naming, and
pinning are secondary actions rather than an Agent-building workflow.

The shipped surface is task + one compact ribbon + Start. `⌘T`, type, Enter
starts the selected Agent; `⌘T`, `⌥↑/↓`, type, Enter cycles a whole Agent
configuration while task focus stays put; and `⌘⌥T` opens Shell directly.
**Customize** exposes the exact source/model/effort and per-launch modifiers;
**All configurations…** exposes the complete reusable pool and its Project pin
and management actions. Unavailable configurations remain inspectable and
block Start rather than substituting a different source, model, or effort.

A plain shell appears as a peer launch choice in the configuration ribbon,
which is how a blank terminal stays one gesture away without becoming an Agent.
Its domain shape is distinct: Shell has no source, model, effort, Type, or Agent
permission axes, and it is not a cross-source clone target. Successful Shell
launches train its position in the same per-Project peer ordering, and a Project
may pin it, without placing Shell in the Agent configuration pool. This does not
make Shell an Agent Source; it remains a Project tool.

**Clone to…** is a fresh-Session handoff between Agent configurations. From a
started Agent Session's context menu or `⌘K`, the operator selects one exact
available Agent target; Exawatt creates a distinct Session with bounded
Exawatt-owned goal/context handoff text, leaves the original Session untouched,
and passes no provider resume identity. Shell and unavailable targets are
excluded. Clone is not live conversation migration, provider-state transfer,
or automatic failover.

## Gateway

A network connection to a Harness, especially OpenClaw-like systems. A Gateway
can be local or remote and may expose several configured source-native Agents.
It is neither the Agent nor automatically a Project. Closing Exawatt disconnects
the observation path; it does not imply that a remote Gateway or Agent stopped.

## Policy / Budget

Rules and limits that govern agent behavior and consumption.

Policies can be layered. Personal Agent or Session preferences operate within
the effective Workspace policy. A future managed Workspace may impose absolute
ceilings that lower-level settings, including an unrestricted or YOLO launch
preference, cannot bypass. Until managed policy exists, Exawatt should avoid
inventing a second enforcement regime that conflicts with the user's chosen
Agent Source; it should state which system actually enforces each limit.

Examples:

- monthly spend cap
- per-session token cap
- per-Agent model or reasoning-effort constraint
- approval required before deployment
- restricted tools
- allowed context signals

## Approval

A human authorization checkpoint.

An Approval must state its scope and lifetime. It may authorize one proposed
action, a class of actions under Policy, or a bounded period of work. The
normal approval unit is deliberately unresolved until ENG-006 tests whether a
Session-level mandate reduces interruptions without creating dangerously broad
authority.

Examples:

- approve a deployment
- approve a purchase
- provide missing credentials
- approve a destructive action
- accept completed work
