# Agent Sources

An Agent Source, or Harness, is a runtime/provider boundary that can create, observe, and control agents.

Exawatt should stay source-agnostic.

Examples:

- local OpenClaw
- hosted OpenClaw
- Codex
- Claude Code
- OpenCode
- Grok Build
- custom harnesses
- Demo Scenario Source

OpenClaw is the first implementation target, not the product boundary.

## Agent Source registry

Settings owns an Agent Source registry: a compact list of configured source
instances and a selected-source detail view. A user may eventually connect
multiple instances of one source type, so the row identifies both the adapter
(`Claude Code`, `Codex`, `OpenCode`, `Grok Build`, `OpenClaw`, or `Demo Mode`)
and the configured source
(`Personal`, `Work gateway`, or another user-chosen name).

A configured source is how Exawatt reaches the runtime that creates and resumes
real Agents. It also supplies the identity, model, capability, and health truth
Exawatt needs to represent those Agents accurately. Connecting does not move
execution or source-owned authentication into Exawatt; it gives Exawatt the
minimum command and observation boundary required to operate that source.

The registry reports installation, reachability, authentication, identity,
version compatibility, capabilities, freshness, provenance, and evidence basis
as separate facts. `Observed` means a bounded runtime check ran, `Declared`
means the adapter contract advertises the property, and `Simulated` identifies
Demo evidence. Its normalized roll-up states are `ready`, `connecting`, `action
required`, `degraded`, `unavailable`, `not installed`, `incompatible`, and
`unknown`. A roll-up helps scanning; detail must retain the underlying facts so
that, for example, installed-but-signed-out never collapses into a vague
offline state.

For every local CLI source — Claude Code, Codex, OpenCode, Grok Build —
authentication remains source-owned.
Exawatt may launch the harness's supported sign-in command and recheck status,
but does not collect or store the provider token. Gateway and future custom
source credentials may be stored as narrowly scoped connection material in the
operating system keychain. This is distinct from ENG-009's future general
Secrets/Credentials broker for Agent tool use.

That source-owned path includes eligible subscription-backed accounts. A user
who signs Claude Code or Codex in through a compatible paid plan can launch the
same local harness from Exawatt without adding a provider API key or buying a
separate Exawatt token balance. The provider's plan limits still govern the
harness. Authentication/entitlement and Consumption telemetry stay separate:
Exawatt must not infer a billing mode from observed tokens or claim plan
headroom that the source does not report.

Global source facts and Project-effective launch configuration appear at their
proper scopes. The registry can show the account identity and default; the
Agent composer's selected Launch Configuration shows the configured source,
model, and effort that the current Project will actually request. A provenance
affordance explains whether a fact came from a source command, source
configuration, Project settings, environment policy, or Demo fixture, and a
relative freshness label exposes its formatted timestamp on hover and keyboard
focus. Relative time refreshes while Settings remains open.

The **Browse Agent Sources** flow separates sources Exawatt supports but cannot
currently reach from future source types. `Inspect install` or `Configure` is
actionable now; `Coming soon` is an honest product affordance, not a disabled
connection that looks broken.

### Current desktop implementation

Settings now auto-discovers six built-in records through one Electron-main
registry boundary: local Claude Code, local Codex, local OpenCode, local Grok
Build, the local OpenClaw gateway, and Demo Mode. Claude Code, Codex, OpenCode,
and Grok Build can launch from the Agent composer when their installation and
source-owned authentication are ready. OpenClaw's local
installation and gateway configuration are reported independently, but
reachability and authentication become ready only after its protocol-level
gateway status command succeeds. Config presence and a listening port are not
treated as proof. Gateway launch remains outside the current Agent composer.
Demo Mode uses the same record and fact shapes with every value marked as
simulated.

Recheck repeats source discovery. When a local CLI reports that sign-in is
required, Settings can open that source's own login command as a terminal tab and
then reconcile through several bounded checks, waking immediately when the app
regains focus. If authentication still is not ready, the visible recovery state
ends with a manual Recheck action instead of pretending success. A missing CLI
opens its adapter-declared installation guide. Only the minimum identity
exposed by a status command crosses to the renderer. Provider tokens,
organization metadata, and OpenClaw connection secrets do not.

If registry IPC fails, Settings keeps the last known facts as explicitly stale
when possible, or shows the registry as unavailable. The composer does not
launch from fallback declarations. Electron main validates source readiness at
the launch boundary using main-owned evidence no more than five seconds old
before spawning any Agent process.

## Launch contract

Project selection and Agent launch are separate commands. An open Project may
have zero Sessions. The launch surface is intentionally only an optional task,
one Launch Configuration ribbon, and Start. Each Agent configuration carries
the exact configured Agent Source, source-native model, and effort or variant;
the source adapter decides how that request maps to a local process, remote
Agent, or provider Session.

Closing a Project does not delete its source-agnostic identity. After the last
Agent closes, the open zero-Session Project remains valid and moves to a compact
dormant ribbon tail after a short inactive dwell. Only an explicit Project close
removes it from the open workspace; the durable Project library remains the
`⌘N` reopen boundary. The close command is context-sensitive: `⌘W` closes the
active Agent tab, or the active Project when it has no tabs. `⌘⇧T` restores the
newest recoverable Session without starting it; direct shell launch uses
`⌘⌥T`.

The first composer edit creates a draft tab carrying the exact launch snapshot.
Untouched catalog/default hydration remains ephemeral; operator-authored task,
source, model, effort, permission, worktree/branch, and roadmap-link choices
persist together. That draft is not a reusable Launch Configuration. Only a
successful launch or explicit friendly name structurally deduplicates or adds
the Agent choice to the app-wide pool, and only successful launch changes the
active Project's frecency. Selection, editing, naming, failed starts, and
abandoned work do not train rank. Pins are Project-local and remain above the
learned order.

Near-term Claude Code, Codex, OpenCode, and Grok Build Sessions are PTY-backed. That
transport is an implementation detail, not a requirement for future sources.
Shells remain
secondary Project tools even though Shell appears as a peer ribbon and `⌘K`
choice. Its shape is distinct: no Agent Source, model, effort, Type, or Agent
permission, no composer task text, and no cross-source Clone target.

Coding is likewise the current dogfood workload, not a source-category
boundary. Research, marketing, operations, and other non-coding Agents should
enter through the same launch and observation contracts whenever their source
exposes compatible commands and evidence.

Launch recommendations are personal and reversible. One reusable Agent pool is
ranked by successful launches separately for each Project, and each Project may
pin its preferred Agent configurations or Shell. Exawatt must not silently
hard-code one provider for every user or Project.

Model and reasoning-effort choice are visible, exact, and source-owned. The
selected setup card shows the effective pair; ArrowDown enters its attached
Engine/Model/Thinking/Permission drawer, while **More** exposes the complete
reusable catalog, Shell, Project pin/manage actions, launch modifiers, and quick
naming. Naming a configuration does not create an Agent Type. Before a new local Agent starts, the
composer resolves the selected harness's effective model/effort pair. Codex
supplies its installed model catalog, each model's supported efforts and
default, and the configured pair. Claude Code answers the same question over
its SDK control protocol: the rows Exawatt lists are the rows its own `/model` menu renders,
carrying each row's launch value and accepted effort levels, so the two lists
cannot diverge and Exawatt adds nothing of its own to them. Changing models immediately
reconciles effort to that model's valid choices and default. Exawatt pins the
displayed pair on the launch command so the UI and process cannot drift between
composition and spawn. An override is scoped to that new Agent and does not
mutate the user's Codex or Claude configuration. A dominant environment effort
is shown as fixed because the harness would ignore a conflicting CLI choice. If
a harness cannot describe an exact value or live catalog, Exawatt labels the
harness default honestly and lets the harness remain the authority instead of
inventing one. Cached catalog values carry source provenance and freshness;
hard-coded provider catalogs are fixtures only and never product truth.

The common keyboard contract is likewise whole-configuration based: `⌘T`, type,
Enter starts the selected Agent; `⌘T`, `⌥↑/↓`, type, Enter cycles to another
Agent configuration without moving task focus; and `⌘⌥T` opens Shell directly.
The card row uses Left/Right and Home/End, while ArrowDown enters the selected
card's first drawer axis; `⌘K` exposes the same catalog. An unavailable configuration remains visible
and inspectable with its missing fact but blocks Start. Selection is never
silently translated to a different source, model, or effort.

Launch permission policy is also visible, personal, and reversible. Exawatt
uses one source-agnostic three-level contract:

- `prompt`: keep harness approval prompts active;
- `auto`: use a harness-provided safety reviewer or classifier;
- `unrestricted`: bypass approvals and sandboxing.

The source adapter translates those policies into provider-specific controls.
For current local sources, `auto` maps to Claude Code Auto mode and Codex
automatic approval review; `unrestricted` maps to each CLI's dangerous bypass
flag. A harness must advertise a policy before the composer offers it.

The machine-local preference is keyed by user, Project, and Agent Source. New
pairs default to `unrestricted` (shown as **YOLO**) and the composer keeps that
high-impact state visible. The selector explains each policy in place and saves
changes immediately, including draft choices made before an Agent starts.
Source changes from the composer, palette, or shortcuts restore that source's
pair-specific choice. Resuming a local Session uses the current remembered
policy for its Project and source; the policy is not part of provider
conversation identity. If personal preferences cannot be read, Exawatt uses
`prompt` (shown as **Ask first**) as a visible safe fallback. If a harness or
account cannot use a selected policy, Exawatt surfaces the harness response and
does not silently broaden access.

These policies are requests to, and enforced by, the selected harness. Exawatt
does not currently add an independent sandbox around Claude Code, Codex, or the
tools they invoke. In particular, **YOLO** means the harness receives the broad
machine authority available to the user's process. The UI must not describe a
provider-enforced mode as an Exawatt guarantee.

Model/effort discovery, create, attach, resume, branch, background, and
delegation are source capabilities. The UI should expose only capabilities an
adapter actually supports; a unified attach/resume design remains a hypothesis
for later iteration.

### What each launchable source actually supports

The registry fails closed: a capability is declared only where Exawatt verified
a mechanism on a real install, and an unverified one is reported absent rather
than optimistically enabled.

| Source | Model catalog | Reasoning effort | Delegation reported | Plan window |
| --- | --- | --- | --- | --- |
| Claude Code | live, per Project | live, per model | yes, through lifecycle hooks | no local record |
| Codex | live, per Project | live, per model | no | yes, source-reported |
| OpenCode | live, per Project | live, exact per-model variants | not through its PTY | no local record |
| Grok Build | live (`grok models`) | source-owned — see below | not through its PTY | no local record |

Two Grok Build facts are worth stating plainly because both are absences with
reasons, not gaps waiting to be filled:

- **Reasoning effort stays in Grok Build.** It accepts an effort at launch, but
  publishes no per-model option set to any interface a PTY launch can read, so
  Exawatt shows no effort control rather than inventing one.
- **Delegated work is not reported to Exawatt.** Grok Build's hooks are
  deliberately Claude Code-compatible and it does record subagents, but its
  interactive TUI accepts no per-launch hook seam: hooks load only from the
  state home, the `~/.claude` compatibility path, the project tree, or
  `config.toml`, and the vendor's own per-connection injection point
  (`--plugin-dir`) lives on its headless `grok agent` server. Relocating the
  state home would move the operator's sign-in, configuration, folder trust,
  and entire session history with it, so Exawatt injects nothing and the
  Session's status rides the same inference Codex and OpenCode use. Its
  delegation dots are therefore absent, not empty.

Grok-the-model has been launchable through OpenCode since that source landed;
Grok Build is the native harness — its own TUI, plan mode, subagents, and
on-disk session record. Choosing between them is a choice of harness, not of
model access.

## Activity and assurance contract

Agent Sources differ in more than launch and resume commands. An adapter should
eventually describe which activity it reports, which controls it enforces, and
which evidence it can provide. Exawatt can then normalize the parts a source
supports while leaving unsupported facts unknown.

For example, a source may report that an Agent called a mail tool. That is
useful activity, but it does not prove that Exawatt authorized the call or that
the recipient's server accepted the message. Exawatt should keep those claims
separate through the common Event assurance facets: reported, observed,
authorized, enforced, and verified.

This contract is intentionally provider-first today:

- harness manufacturers own their sandboxes, prompts, tool policies, and
  downstream integrations;
- users bring the security model appropriate to their chosen harness;
- Exawatt exposes the selected posture and source-reported activity without
  manufacturing stronger guarantees;
- Demo Scenario Sources emit the same shapes with clearly simulated provenance.

Future adapters may point to Exawatt-owned or third-party mediators for
credentials, network access, payments, messages, or other typed actions. The
adapter contract allows that future without making those integrations current
scope.

## Managed Workspace ceilings

Personal launch preferences are the current implementation. When managed
Workspace policy arrives, its ceilings take precedence: a personal Agent
setting or YOLO preference can request less access but cannot exceed what the
Workspace permits. An adapter that cannot honor the effective ceiling must fail
visibly rather than silently start with broader authority.

This is a future governance contract, not a second policy engine in today's
desktop app.
