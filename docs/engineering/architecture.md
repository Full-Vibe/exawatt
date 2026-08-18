# Exawatt Architecture

Exawatt is a command interface for managing agent fleets across local, hosted, and third-party harnesses.

The architecture is source-agnostic: OpenClaw on local, customer-hosted, or
Exawatt-hosted infrastructure; Codex; Claude Code; custom harnesses; and Demo
Harnesses all sit behind explicit Agent Source / Harness boundaries. Placement
is a configured-source fact, not a separate kind of Agent.

## Layers

### UI Layer

User-facing surfaces:

- Electron desktop app
- Next.js web app
- `/workspace` (Agent and Team altitudes)
- `/fleet/spatial` (Fleet altitude)
- `/architecture` public architecture map
- future public `/docs` guides

The UI layer supports multiple modular regimes over the same command model:

- DOM operations UI for dense text, forms, chat, and accessibility-critical controls
- Electron Agent altitude and DOM Team overview for direct xterm control and
  multi-session orientation
- Fleet Operations Board for stable Project-grouped fleet observability,
  semantic zoom, anchored Agent selection, attention scheduling, and visible
  Session handoff; R3F renders top-down and shallow fixed-angle projections over
  one source-agnostic board model
- future packaged or Electron-hosted UI variants

The privileged desktop renderer is local application code packaged in the same
versioned Electron artifact as main/preload (decision `0008`). It must not load
the hosted Exawatt site as its primary renderer or expose PTY preload methods to
remote content. The hosted interface may share source and normalized UI models,
but it is a separate delivery and privilege boundary.

Desktop startup has two explicit phases. Electron creates the real main window
with a self-contained, CSP-restricted launch document as soon as Chromium is
ready; that document has no trusted IPC origin and reports only main-owned boot
milestones. The packaged Next renderer, PTY/session services, auth, updater, and
other command modules initialize behind it. A cached renderer server starts
before Electron's ready event; archive extraction on a version cache miss waits
until the launch frame exists so disk work cannot delay visible acknowledgement.
The same window then navigates to the trusted loopback renderer. Shutdown owns
that renderer child process as part of the verified lifecycle: it waits for the
server to close (with bounded force-stop escalation) before declaring cleanup
complete. This is a presentation boundary, not a second application or
alternate data source.

The desktop artifact's **runtime payload is a declaration, not a copy**
(BUG-030). electron-builder ships `dist-electron/**/*` and excludes
`node_modules/**/*`, so the packed main process can require only what a
packaging step stages under `dist-electron/node_modules` first. That set is
declared in `scripts/lib/electron-runtime-deps.mjs` as the production dependency
closure of `RUNTIME_PACKAGES`, staged flat: a package's nested `node_modules` is
the workspace's install layout and never payload, and prebuilt native binaries
for a platform this build does not target are unreachable by construction. The
snapshot exists only during packaging — `electron:compile` discards it so no
development launch can resolve through a stale copy (incident `0012`) — and
`assertRuntimePayload` in `scripts/release-package.mjs` refuses an artifact whose
staged tree drifts from the declaration in either direction. Before it was
declared, the tree was a dereferencing copy of workspace directories and every
user downloaded the TypeScript compiler inside the code signature.

ENG-030 OS4 adds one versioned distribution boundary before Next and Electron
build. `@exawatt/core/distribution` strictly validates the input; absence means
the stable `Exawatt Community` identity and no Exawatt account, service,
analytics, protocol, branded icon, or update capability. The resolved canonical
JSON and SHA-256 digest feed Next explicitly, are mirrored beside Electron
build-info, and are passed after ambient env to the packaged loopback child.
Main refuses disagreement among its mirror, the renderer digest, and build-info.
A resolved product identity is also the single owner of the bundle and
executable paths, launch/header/metadata name, native lifecycle name, protocol,
and the `appId`-derived state and cache namespaces. Community therefore
registers no OAuth callback scheme and can coexist with the official app rather
than replacing its bundle or state; a branded distributor receives only the
scheme its contract declares.
A separately hashed `desktop-public` renderer-composition manifest enumerates
the packaged payload so the public-tree-only desktop rule can be inspected at
the artifact boundary; the hosted web delivery composes a private route overlay.
That overlay is now the only place hosted implementations live (ENG-030 WP3).
`company/overlay-manifest.json` declares every file, `company/overlay/web/`
mirrors the repository path each takes in a composed tree, and
`scripts/lib/company-composition.mjs` composes `official-web` or
`official-desktop` as a strictly ADDITIVE function of the Gate A public tree at
a commit: an entry may only create a path the public tree lacks, and hosted-web
targets are structurally refused by the desktop profile. `pnpm build` composes
in place, so the deployed tree is the composed tree; a community contract
composes nothing and withdraws anything a previous official build applied. The
public tree keeps the typed request/response contracts and answers 404, and the
runtime census in `src/lib/distribution/community-runtime.test.ts` spans both
trees: an entrypoint must be declared on exactly one side, and nothing under
`src/` may import across the boundary. Agent Source WebSockets are separate from service origins and remain
available to community builds for operator-configured Gateways. A configured
Agent Source is an Electron-main capability: main reads the source-owned
config, keeps the Gateway secret, device key/token, SSH tunnel, endpoint
selection, and authenticated WebSocket, and the renderer receives view
projections only. There is no renderer-reachable Gateway bridge and no command
channel at all: `ConnectedGatewaySession`'s method allowlist and the source's
own `operator.read` scope are the two locks that make H1 read-only, so
`chat.send`, steering, abort, and cron mutation have no code path in the
process. Browser builds have no equivalent credential route and remain in
Demo Mode.

Renderer product-service callers consume only the corresponding versioned
`services.*` endpoint. Product feedback and operator-stat publication check
capability absence before creating an account client, reading auth, scheduling
or scanning, and fetching; community renders an explicit unavailable state
instead of misreporting the absent service as signed out or failed.

Official release and company dogfood are stricter consumers of the same
boundary: they refuse an absent or unbranded JSON contract before building,
resolve product/bundle paths through `scripts/lib/packaged-app.mjs`, and assert
the packaged distribution digest plus the contract's required update feed.
The release workflow reads the JSON only from private secret custody and
packages with the contract-projected builder config; the public/manual dogfood
tooling remains distribution-generic.

Account transport is an explicit nullable adapter at every renderer and server
call site. When `account` is absent, auth surfaces report that the capability is
not configured instead of treating Community as a failed sign-out, and no auth
client is constructed. Product state does not inherit the account database as
its public contract: the Project registry exposes a source-neutral DTO and
persists to the distribution's state namespace locally in Community, while a
configured account temporarily preserves the hosted adapter until the private
service relocation. Keyboard shortcut overrides follow the same boundary:
account-backed builds retain sync, and Community stores the validated override
set in its isolated browser namespace. Local Agent Sources and Demo Mode do not
depend on either capability. Browser admin affordances consume a versioned,
server-derived capability DTO containing only the decision and display data
they need; operator identities, allowlists, table names, and database types stay
behind the private service boundary and never enter `NEXT_PUBLIC_*` state.

ENG-032's appearance boundary is **implemented** (decision `0026`). T0–T5.4
provide strict versioned Classic/Air/Night definitions, a deterministic
validator/generator, one pure resolver, device-local Electron/web preference
adapters, production Settings, account-menu, and command-palette selection, first-paint/native
bootstrap, and complete DOM, xterm, R3F, and Electron projections. Generated
foundation, action, HUD, readiness, typography, material, status, and terminal
roles project through app chrome, Settings, feedback, shared overlays,
Workspace, Roadmap, status glyphs, live/retained terminals, Usage/Consumption,
and the Fleet Operations Board's canvas, grid, zones, units,
D40/Consumption marks, selection, labels, lights, bloom, and DOM overlays.
Existing terminals and Fleet scenes update in place without remounting, touching
PTY/data state, or resetting camera, filters, and selection. Material filters
and authored opaque fallbacks swap through generated roles; renderer capability
never changes theme truth.

Electron settings are authoritative on desktop; a validated local mirror exists
only to select generated CSS before hydration, then reconciles immediately.
BrowserWindow, the CSP launch document, native theme source, and the hydrated
root consume one generated/validated state path. Fresh missing state follows
the OS with Auto Air/Night; Manual pins Classic, Air, or Night while remembering
the Auto pair. Invalid state and the one-launch `--safe-theme` path recover
through Classic without mutating valid stored preferences. Settings, the avatar
menu, and **Change theme…** are three faces over that one device-local preference, and no
renderer merges theme state independently. The temporary theme workbench
retired after production rollout. The bounded Electron native-material spike
closed renderer-only:
an opaque operational renderer hid macOS vibrancy completely, and Exawatt will
not trade startup continuity and cross-platform fallback for a
transparent-window workaround.
Manual Enhanced contrast and Reduce transparency overrides are retired; legacy
V1 values normalize to OS-managed behavior while contrast, forced-color,
inversion, and reduced-transparency signals still apply automatically. The
contract keeps action, status, Project identity, Agent Source identity,
Consumption, and readiness channels distinct and accepts no executable
CSS/JavaScript or remote assets.
Demo and Live data remain irrelevant to appearance selection.
Local preview and commit intent publish immediately. Validated preference or
OS/native events arriving from another tab or renderer settle for 250 ms and
publish only their final distinct snapshot. Web storage subscribers do not
rewrite their already-persisted input; Electron mirrors the final settled
settings result for the next first paint without writing back to its settings
source. This consistency boundary sits before the pure resolver, so a
concurrent transport cannot drive DOM, xterm, R3F, or native projection through
intermediate appearances. Incident `0005` records the two-context reproduction.
Client-navigation continuity is part of that projection boundary, not a second
theme owner. Fixed-dark public exhibition surfaces own a complete presentation
boundary: route-stable opaque chrome, a same-ground pending frame, one fixed
interface family, and fixed type scale. App theme canvases never become
decorative full-viewport transition paint, and app font/scale changes never
reflow those public surfaces. Incidents `0003` and `0004` record the paint and
typography failures that established this invariant.

The Electron shell presents Agent → Team → Fleet (decision `0023`) as one
command-altitude navigation continuum. That shared navigation does not
merge renderer ownership: xterm/DOM and R3F keep separate runtime boundaries and
meet through normalized session/fleet state. UI regimes may render and compose
controls, but they should not translate harness payloads, own provider-specific
state, or bypass typed command boundaries.

`CommandNavigationProvider` is the shell-level route and transition boundary for
cross-regime DOM ↔ WebGL movement. Header clicks, registry shortcuts,
native menu commands, palette navigation, workspace gestures, and Agent handoff
delegate route completion to it. The provider begins navigation immediately and
owns only a finite transform/opacity overlay with reduced-motion parity; it does
not own PTY lifetime, workspace selection, Fleet-board semantics, or camera state.
The surface manifest owns destination identity, canonical hrefs, route
presentation, and command-palette eligibility as independent fields. Its app
subset drives app chrome and go-chords; public destinations such as Leaderboard
can therefore remain public website routes while joining the Electron palette.
The shortcut registry owns effective keys, the Fleet board owns URL filters
plus session-local camera return, and the workspace owns terminal/Team focus.

### Render-path performance contract

Decision `0038` keeps Electron and makes the existing renderer split an
explicit performance boundary. React owns discrete semantic state — route,
selection, visibility, focus intent, command availability, and accessible
structure — while continuous pixels stay with the renderer built for them:
Chromium's compositor for DOM transform/opacity motion, xterm's renderer (WebGL
with its canvas fallback) for terminal cells, and R3F for Fleet geometry and
camera interpolation. Pure typed selectors derive layout and view models outside
those renderers.

This is GPU-aware architecture, not a plan to move every surface into WebGL.
DOM remains the owner of dense text and accessibility; xterm panes preserve PTY
presentation; Fleet retains demand rendering, instancing, bounded DPR, and its
measured label/population budgets. Per-frame R3F and projected-DOM work mutates
stable refs/buffers and publishes React state only when a semantic boundary
changes. DOM motion prefers transform/opacity after measurement, without blanket
layer promotion or containment.

Performance work starts from an operator-visible gesture and an attributed
trace, changes the narrowest proven owner, and reruns the same behavior and
timing evidence on the exact tree. The cross-surface Electron evaluator planned
by ENG-016 D55 is optional: it serves baseline, diagnosis, before/after proof,
and targeted regression investigation rather than the default landing floor.
React-provider rewrites, generic memoization, persistent `will-change`, hidden
route mounts, or prewarming are not architectural defaults.

Prewarming is considered only when a repeated cold-path trace proves preparation
is the critical delay and the prepared work is pure or idempotent,
version-keyed, bounded, cancellable, discardable, and unable to subscribe,
navigate, focus, spawn, command a source, or publish stale UI. Absence or failure
must preserve the same ordinary cold path and the existing fail-to-cut
transition behavior. Electron replacement remains a future decision only if
representative critical interactions still miss ratified budgets after their
narrow proven owners are addressed and Chromium/Electron itself is the
irreducible cause.

Contextual workspace verbs add one deliberately small cross-process projection.
The renderer derives command availability from restored Project, Session,
split, recovery-ledger, and visible attention state. That snapshot gates the
workspace key layer and passive hints, supplies disabled reasons to the command
palette, and sends validated booleans through preload so Electron main can
enable the same native Session-menu items. The projection never owns or mutates
the underlying state; each command still validates its target in the workspace
or Electron-main lifecycle authority. The application-global native menu also
disables workspace-local rename, split, close, and attention verbs while
another route such as Spatial owns the renderer; route-safe Project opening,
shell launch, and closed-Session recovery retain their explicit navigation
paths. Decision `0020` records the visible-target rule, including `⌘J`'s strict
needs-you semantics. Electron invalidates the projection when document loading
starts, on main-frame navigation, and at renderer-process-loss boundaries;
restored renderer state must republish before native contextual commands become
available again.

### Coordination and Intelligence Layer

Canonical product objects:

- Workspace
- Initiative
- Project / Context Group (a resolvable grouping lens seeded by the source's
  Project catalog and joined by Agents, not a structural parent of Agent)
- Agent
- Session
- Decision
- Approval
- Event
- Artifact
- Consumption
- Context Signal
- Secret / Credential
- Agent Source / Harness
- Gateway
- Policy / Budget

This layer should hide source-specific plumbing from the UI.

Agent identity is a versioned product projection over preserved source-native
topology (decision `0037`). The primary roster shows addressable coworkers. A
configured OpenClaw Agent projects to one durable Exawatt Agent while its main,
channel, cron, helper, and spawned Sessions stay subordinate. Current local
coding launches project to mission-bound Agents above their provider Sessions.
Raw source IDs, kinds, lineage, and freshness remain intact so a later
projection can be rebuilt without rewriting the source.

This layer also owns translation, durable decisions, context signals, policies,
budgets, approvals, and consumption records.

This layer also owns UI-facing view models and command contracts that are shared by multiple UI regimes. These presentation models must be source-agnostic, deterministic, pure TypeScript, and testable without React, DOM, Electron, or Three.js.

Session-continuity diagnostics are a local, explainable projection owned here,
not an opaque source status and not a hosted-control-plane invention. The
projection may combine source-observed Events, Consumption, intervention
patterns, compaction boundaries, declared plan/progress state, and
completion/review Artifacts. Every signal retains its basis and freshness; a
small repeatable harness-aware probe may add evidence about one capability but
can never certify the quality of all work. A hosted control plane may aggregate
the same projection across a Workspace without changing its semantics.

Session context inference follows one source-agnostic evidence contract. The
desktop supplies bounded, redacted operator instructions through trusted IPC;
an authenticated hosted endpoint applies quota and server-held model
credentials; Electron main accepts only validated structured results and owns
the last-good durable label. PTY output is not label evidence. Hosted failure
retains existing state rather than invoking a competing local summarizer
(decision `0019`). Explicit label votes/corrections and general product reports
use an authenticated Supabase-backed feedback intake with private optional
attachments. The renderer submits through the distribution-declared
`services.productFeedback` V1 endpoint; without it the intake is unavailable
before account/session work and no request is possible. Inference excerpts
themselves are not persisted.

Goal visual identity is a downstream projection of that accepted Session
context, never a second classifier. Electron main creates a new revision only
for the first accepted label, an Objective Engine `new_context` result, or an
explicit operator correction; `same_context` preserves the current asset. The
renderer consumes one source-neutral `GoalVisual` contract with deterministic
fallback, while Demo supplies the same contract without network I/O.

Live generation crosses an authenticated hosted boundary with only the
accepted label and a one-way Project identity. The FAL prototype credential
stays server-side. The hosted route derives a deterministic identity, seed,
natural scene family, palette, atmosphere, and composition; only that generic
recipe and seed reach FAL, never the accepted label. The route checks per-user
quota and a private Supabase cache, disables provider payload retention,
safety-checks the request, downloads a bounded result from a trusted provider
host, and immediately stores it privately. Electron and renderer receive no
raw instruction, terminal output, local path, Project name, provider URL, or
provider credential. Failure, offline use, quota, or safety rejection remains
a complete deterministic Team tile.

#### Public operator statistics projection

ENG-035 adds an opt-in public projection over existing Session and Consumption
facts; it does not add `Agentmaxxing` as a canonical object or make the hosted
leaderboard the source of local truth. `@exawatt/core` owns source-neutral Run
facts, deterministic Run/day derivation, Command/Endurance/Fleet/Energy rank
semantics, activity-graph levels, and a strict versioned publish allowlist.
Source adapters may improve their evidence over time without changing the
public contract. The initial historical adapter derives conservative activity
intervals from timestamped Claude Code and Codex Consumption samples and keeps
reported, observed, derived, and unavailable assurance explicit.

The desktop privilege boundary remains narrow and preference-governed. Electron
main's incremental Consumption service is the only reader of machine-local
harness logs; Operator stats requests a settled, samples-only projection from
that service and never starts a second corpus scan or assembles unrelated plan-
window history. The renderer schedules the scan only while the durable, off-by-
default `operatorProfile.autoPublish` preference is on, then receives only
sanitized daily and Run aggregates. Local source identifiers are hashed before
they become public idempotency keys and public Run ids; prompts, responses,
code, repositories, Projects, branches, paths, filenames, diffs, and raw
Session ids are absent from the IPC and network schemas.

The consent boundary, last successful sync, and cached hosted visibility live
beside that preference in Electron's settings store, not renderer
`localStorage`: packaged Electron serves each launch from a different localhost
port, so origin-scoped storage is not durable application state. An owner-only
authenticated metadata read recovers the original hosted `joined_at` boundary
for profiles created before this repair; new profiles anchor at the switch-on
instant and never upload pre-consent history. The renderer owns account auth,
GitHub identity resolution, and the coalesced launch/interval/manual POST
through the distribution-declared `services.operatorStats` V1 endpoint. With
that capability absent it creates no account client, reads no auth, installs no
schedule, scans nothing, and reports publishing as unavailable rather than
signed out.
Pausing stops future writes, while disabling public visibility also pauses and
does not delete or mutate local history.

The hosted boundary accepts only the versioned allowlist after authenticated
GitHub identity resolution. A server RPC atomically replaces that operator's
bounded day and Run projection so retries cannot inflate totals. The underlying
Supabase profile, day, and Run tables remain row-owned and unavailable to
anonymous callers. Anonymous leaderboard, profile, and Run reads go through
allowlisted security-definer functions that filter on the profile's enabled
state. Public values are therefore recorded by Exawatt with stated assurance,
not independently verified claims. GitHub seeds V1 identity, while the stored
identity shape remains provider-neutral for later operator classes.

A device-local preference defaults goal visuals on and gates both sides of the
projection. Electron persists the preference in its settings store and stops
future hosted requests in main; hosted web persists it in versioned browser
storage. Both sources drive the same app-global renderer snapshot, so off
removes the backdrop in Team without deleting cached assets or changing
accepted goal truth; on resumes from the private cache or current accepted
goal.

#### Agency control spine

Visibility, authorization, evidence, and enforcement form a cross-cutting spine
through the existing Coordination objects. This is not a fourth layer, a
separate service, or a new integration project. It is the contract that lets
Events, Decisions, Approvals, Policies, Artifacts, Consumption, and Agent Source
adapters explain agent activity consistently as Exawatt grows.

Where a source provides the information, the normalized contract distinguishes:

1. the Agent's declared intent or proposed action;
2. the effective Policy and any human Approval;
3. the attempted action;
4. the resulting real-world effect;
5. evidence or an Artifact supporting that result;
6. provenance for what was reported, observed, authorized, enforced, and
   verified.

These are independent assurance facets, not one boolean safety score. Unknown
or unsupported facets remain visible. A provider-reported tool call, an
OS-observed network connection, a broker-enforced spend limit, and a
receipt-verified payment can therefore coexist without Exawatt overstating what
it knows.

The near-term enforcement boundary remains the Agent Source / Harness and any
security model the user brings with it. Exawatt may request a provider launch
policy and normalize source-reported activity, but it does not yet independently
mediate general network access, email, messages, payments, or other real-world
actions. Current UI must name the enforcing system and must not turn missing
telemetry into a claim that an action was safe or did not occur.

#### Runtime capability discovery

An installed plugin, listed skill, or exposed tool description is advertised
capability metadata, not proof that the active Agent Session has a connected
runtime backend. Agent Source adapters must keep advertised, runtime-available,
authorized, and verified capability states distinct. A failed discovery must
remain explicitly unavailable rather than being inferred as working from the
presence of instructions or a tool launcher.

This distinction is already observable in the current Codex path. Exawatt
launches Codex CLI inside a PTY. OpenAI's built-in Browser is supplied by the
ChatGPT desktop/web host and is not available to Codex CLI. A CLI Session can
therefore receive the installed Browser plugin's skill and Node execution tool
while browser discovery returns zero backends. Direct page retrieval may still
be a valid lower-fidelity fallback for public semantic content, but it is not
evidence of rendered layout, interaction, authenticated state, hover behavior,
or responsive behavior. The verified 2026-07-22 trace and supported alternatives
are recorded in the
[Agent Terminal Workspace project history](projects/agent-terminal-workspace.md#dogfood-investigation-codex-browser-capability-boundary-2026-07-22).

Codex delegation uses a separate read-side boundary without taking ownership
of that PTY Session. Electron version- and shape-probes the installed Codex
app-server, correlates the Session's exact provider thread ID to source-owned
descendant IDs, and translates reported lifecycle into the shared delegation
model. Reconnect replaces the observation from a fresh descendant snapshot.
An unavailable or incompatible protocol withdraws the observation to absent;
files, worktrees, process trees, and terminal text are never delegation
evidence.

#### Agent Source registry and connection truth

Settings consumes a source-agnostic Agent Source registry rather than reading
PTY launch helpers directly. A configured source record combines a source
adapter with user-scoped instance metadata: display name, endpoint or local
installation, placement (`local`, `customer-hosted`, or `exawatt-hosted`),
minimum exposed identity, credential owner, and last successful observation.
Multiple records may use the same adapter.

The production desktop path implements that boundary in Electron main. A
versioned, generated declaration contract owns stable adapter identity,
presentation, supported actions, and capability claims for both main and
renderer. Runtime observations remain main-process evidence. This prevents UI
defaults, source probes, and launch code from becoming competing registries.
Source-specific CLI/config/protocol inspection stays behind a renderer-safe IPC
surface; Settings and the Agent composer consume the same normalized
snapshots. The separate OpenClaw live transport uses an opaque, owner-bound
Electron-main capability rather than returning config or credentials to the
renderer. Claude Code, Codex, OpenCode, and Grok Build are launch-capable local records. Local
OpenClaw reachability is established only by a successful gateway protocol
status command, not by config presence or an open TCP port. Demo Mode is a
built-in record whose facts use simulated provenance. The renderer receives
neither provider credentials nor OpenClaw connection secrets.

The adapter reports independent installation, reachability, authentication,
identity, compatibility, capability, freshness, provenance, and evidence-basis
facets. `Declared` says what an adapter contract supports, `observed` records a
bounded runtime check, and `simulated` identifies Demo evidence; one basis may
never be promoted into another. A pure view-model derivation produces the
compact registry state (`ready`,
`connecting`, `action required`, `degraded`, `unavailable`, `not installed`,
`incompatible`, or `unknown`) without discarding the facts that explain it.
Demo Mode enters below this boundary and emits the same contract with simulated
provenance.

Discovery is evidence-bearing. Each catalog or capability snapshot names the
source mechanism and observation time. A capability is declared only where a
mechanism was verified on a real install; Grok Build's delegation reporting is
declared UNOBSERVABLE because its interactive TUI accepts no per-launch hook
seam and relocating its state home would move the operator's sign-in,
configuration, folder trust, and session corpus with it. Codex's supported machine-readable
model command populates its live catalog. OpenCode's bounded verbose catalog
provides source-reported `provider/model` identity and records exact per-model
variant keys. Its 1.3.4 root TUI has no `--variant` flag, so Electron creates a
collision-resistant primary agent containing the selected model, exact
variant, and ordered permission policy, injects it through a guarded
`OPENCODE_CONFIG_CONTENT`, and selects it with `--agent`. Global config, a
user-owned `OPENCODE_CONFIG`, and project config continue to merge; an existing
content value is preserved and makes launch unavailable rather than being
replaced. Exawatt does not read its full resolved config to recover a model
because that document may contain provider settings. Claude Code exposes the account-aware
rows from its native `/model` interface through an SDK `initialize` control
response. If that live probe is unavailable, its adapter returns only observed
configured values or an account-default sentinel and source-owned selection
action. Product code never promotes fixture aliases into source truth.

The registry exposes global source/account facts. The workspace resolves a separate
Project-effective launch view by combining source facts, Project draft state,
and environment policy. This separation prevents an account default in
Settings from masquerading as the model a particular Agent will launch.

#### Agent projection and remote attachment

The projection boundary is additive and versioned:

```text
(configuredSourceId, nativeAgentId)
  -> exawattAgentId
  -> projectId
  -> optional displayNameOverride
  -> projectionVersion
```

ENG-010 C0 implements this as the exported `@exawatt/core` Agent projection
kernel in `packages/core/src/agent-projection.ts`. Its pure boundary accepts
source-qualified topology snapshots plus an explicit projection plan and
returns either a deterministic coworker projection with diagnostics or
fail-closed structural errors. The plan and output carry the projection
version; snapshots and individual mapping records do not. The kernel owns no
transport, persistence, credential access, or UI policy. It accepts
`observed`, `declared`, and `simulated` through one evidence-basis contract;
Demo and Live adapters have not integrated it yet, so end-to-end Demo/Live
parity remains later acceptance rather than a C0 claim.

The C0 topology snapshot retains native Agent and Session/context IDs, kinds,
lineage, primary-conversation roles, timestamps, placement, Gateway identity,
observation time, and one snapshot-level evidence basis. It deliberately owns
neither a transport cursor nor persisted connection state. C1's broader source
and connection snapshots add freshness and assurance facts plus an optional
durable replay position only when an adapter can substantiate one. A mapping
edit changes only Exawatt. Detach never deletes or edits a remote Agent,
workspace, history, automation, or credential.
A configured source may expose several Agents; a Gateway is not automatically
a Project. Initial attach suggests one editable Project per imported Agent and
permits explicit existing/shared mappings.

ENG-010's first mile adds customer-hosted OpenClaw through the existing source
registry. SSH may bootstrap an authenticated tunnel, but source observation
uses the OpenClaw Gateway protocol rather than shell-scraping remote files. The
connection record retains placement, credential owner, compatibility,
capabilities, freshness, authoritative resnapshot strategy, and any
source-declared durable replay position; secrets remain in source-owned SSH
configuration or OS-keychain custody behind Electron main. Opening an Agent
resolves its declared primary conversation rather than guessing from recent
activity; OpenClaw maps that role to the configured Agent's exact `main`
Session.

Connection state is orthogonal to Agent and Session work state. Quitting or
closing Exawatt disconnects observation only; a remote Agent may continue.
Relaunch restores the same projection, replaces cached views from authoritative
snapshots, and reconciles subsequent events idempotently by stable source/run
identity. Connection-local event sequence is never promoted into a durable
cursor. `Live`, `Reconnecting`, `Stale`, and `Unavailable` therefore cannot be
collapsed into running/stopped or the D40 work-state protocol. Source commands
remain capability-declared exact verbs; disconnect is not pause, and a fresh
context is not resume. Generic remote Pause is a resumable-continuity contract:
the adapter must name and verify what active work, queued work, or triggers are
halted and preserve the same source-native work for Resume. Exawatt does not
fake that contract with a prompt, cron mutation, Gateway stop, or VPS shutdown.

Demo Mode enters below the same configured-source, projection, placement,
primary-conversation, freshness, resnapshot, and optional replay boundary with
simulated evidence. The first live slice is read-only by contract; write
authority follows only after observation and reattachment are proven.

#### Launch Configuration runtime

The shared Launch Configuration domain in `@exawatt/core` owns a versioned
app-wide pool with stable Agent/Shell variants, structural deduplication,
deterministic per-Project usage, and Project-local pins. Electron main persists
that state atomically in the desktop settings store and exposes validated IPC;
the renderer adapter never becomes a second storage owner. Only a confirmed
successful Agent or Shell launch records usage. Selection, edits, explicit
naming, failed starts, and abandoned composer work do not train frecency.

The workspace combines that pool with the normalized Agent Source registry and
source-native model catalogs to produce one Project-ranked selector. The task,
ribbon, Customize, All catalog, `⌘K`, and launch request use the same exact
configuration identity and launch translation. Configured source, model, and
effort/variant are identity; permission, worktree/branch, and roadmap
association remain per-launch modifiers. Readiness is revalidated at spawn, and
an unavailable saved configuration remains inspectable rather than being
silently translated to another source or model. Agent Type remains a future
axis; a friendly configuration name is not a Type.

Shell is a distinct union variant presented beside Agents. It has no source,
model, effort, Type, or Agent permission and the composer never sends task text
to it. Session Clone uses the same available Agent targets but a separate
fresh-launch handoff boundary: a bounded Exawatt-owned goal/context prompt
starts a distinct Session, preserves the original, and carries no provider
resume identity. Shell and unavailable configurations cannot be Clone targets.

Registry transport failure is an explicit unavailable or stale state. Renderer
fallback declarations are informational and never launch-capable. Electron
main validates the selected source at every Agent-spawn boundary against
main-owned evidence no more than five seconds old, so a stale or unavailable
renderer cannot bypass launch truth without making ordinary launch incur two
additional CLI probes.

Local source authentication remains harness-owned: Electron may launch the
source's supported sign-in flow and then run a bounded, cancellable
reconciliation loop that also wakes when the app regains focus. The loop ends
only when the source is launchable or its retry budget is exhausted; provider
tokens do not cross into the renderer or Exawatt storage. Missing local CLIs
offer a fixed, adapter-declared installation guide rather than a nonfunctional
connection action. Subscription-backed harness entitlement and
metered API authentication are distinct source-owned modes; Exawatt does not
require the latter when the former makes the harness launchable. Consumption
observation remains a separate evidence channel and must not be used to infer
the source's billing mode or unreported plan headroom.

Remote Gateway and future custom-source credentials may be held as narrowly
scoped OS-keychain connection
material behind Electron main. That is an explicit seam, not ENG-009's general
Secrets/Credentials broker.

The same contracts leave a deliberate future seam for Exawatt to become a
Harness or compose with policy engines, credential brokers, restricted
runtimes, network controls, and typed action providers. Those components can
add enforcement or verification without changing the canonical object model or
requiring the UI to understand provider-specific mechanics. This is an
architectural affordance, not authorization to build those integrations now.

Policy resolution is hierarchical. A future managed Workspace can set absolute
ceilings that personal Agent or Session settings and YOLO mode cannot bypass.
Until that managed policy layer is built, personal launch policy should
continue to delegate to the chosen harness rather than conflict with an
illusory Exawatt policy engine.

Two product defaults remain open and belong to existing roadmap work:

- ENG-006 must decide whether the normal Approval scope is one action, a class
  of actions, or a bounded Session mandate.
- ENG-003 must decide whether redacted activity metadata is retained locally by
  default while detailed arguments/content are opt-in, or whether all durable
  evidence requires opt-in. Credentials and secret values are never activity
  evidence.

### Agent Infrastructure Layer

Provider/runtime boundaries:

- Agent Source / Harness adapters
- local OpenClaw gateway
- customer-hosted and Exawatt-hosted OpenClaw gateways
- Codex / Claude Code / OpenCode / Grok Build adapters
- Demo Harness / Demo Scenario Source
- custom harnesses
- local machine
- Supabase
- Electron main/preload process
- hosted VPS instances, starting with Hetzner
- hosted Exawatt control plane

The UI should depend on normalized Exawatt concepts, not raw provider-specific payloads.

### Persistence size classes

Everything Exawatt writes under Electron `userData` declares a **size class**:
a stated bound (age, count, or bytes) and a named owner for eviction, enforced
where the value is written rather than where it is read. Decision `0039` holds
the rule and the three defects that produced it.

| store                           | shape                                                           | bound                                                                                                                                                                                                   | eviction owner                                                                 |
| ------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `workspace.json`                | small-object layout: ids, titles, cwds, lifecycle, drafts       | no large field may live here at all                                                                                                                                                                     | —                                                                              |
| `goal-visuals/`                 | content-addressed side store, keyed by `GoalVisual.identityKey` | 64 entries / 48 MB                                                                                                                                                                                      | the workspace save path, which is the only place that knows the referenced set |
| `consumption-scan/log-v1.jsonl` | append log compacted from live state                            | samples: 14 days behind the newest sample, widened to cover an active Operator-profile publication anchor, clamped at 400 days; observations: 14 days; a Codex watermark's `seenSnapshots`: 256 entries | the scanner's sample sink and `parseCodexRollout`, both at the write           |
| `agent-model-catalogs.json`     | one row per `(engine, shell, cwd)`                              | 48 rows, 14 days, and a row whose `cwd` no longer exists                                                                                                                                                | `AgentModelCatalogCache.write`, plus one sweep on load                         |

Two rules carry most of the weight. **A large per-Session artifact never rides
a small-object record**: it goes in a content-addressed side store, written
once and read on demand, so the record stays cheap to rewrite on a hot path.
And **an age bound is anchored on the data, not the clock** — at the newest
record seen — so a clock jump or a restored backup cannot empty a collection.

## Object Model

`/architecture` uses the canonical nouns from `docs/product/concepts.md`:

- Workspace
- Initiative
- Project / Context Group (a resolvable grouping lens seeded by the source's
  Project catalog and joined by Agents, not a structural parent of Agent)
- Agent
- Session
- Event
- Artifact
- Consumption
- Decision
- Context Signal
- Secret / Credential
- Agent Source / Harness
- Gateway
- Policy / Budget
- Approval

## Current Implementation

Built:

- Next.js app shell
- Electron shell
- Supabase auth/data
- legacy Supabase demo task flow
- `@exawatt/core` OpenClaw JSON-RPC client, Electron-main credential/capability broker, adapters, FleetManager, and the Demo Workspace fixture transport (`DemoWorkspaceTransport`; the simulated `MockFleetTransport` is eval-only since ENG-027 W2)
- `@exawatt/core` source-qualified Agent projection kernel (ENG-010 C0): pure,
  fail-closed topology validation, explicit Agent/Project mappings, a versioned
  projection plan/output, source-declared primary-conversation selection, and
  one `observed`/`declared`/`simulated` evidence-basis input contract; no
  Demo/Live adapter integration, remote transport, or UI
- Workspace tenancy (ENG-027): Personal and Demo are `available` tenants behind the account-menu switcher; the Voltaic Grid Systems shared tenant is a non-activatable `preview` Workspace linking to `/organization`. **Demo** is the tenant identity and **Voltaic Grid Systems** is the separately modeled organization its fixtures portray. The Demo source runs the authored Voltaic fleet, pane content sources (transcripts / honest session records, never a PTY), demo ⌘K rows, Initiative projections, and the Voltaic consumption corpus through the production surfaces
- `@exawatt/ui-model` typed UI-facing fleet selectors and command contracts
- `/fleet/spatial` Fleet Operations Board (V2.0 active replacement of the
  superseded immersive 3D composition)
- Electron agent terminal workspace with real `node-pty` sessions rendered by
  xterm.js for Claude Code, Codex, OpenCode, Grok Build, and shells, behind a session-manager boundary
- Electron-main turn-state ownership that distinguishes Agent work from PTY
  transport noise: output may establish working before a turn settles, while a
  quiet/BEL boundary latches finished until guaranteed operator engagement.
  Shells remain output-driven because they have no Agent turn contract
- source-reported delegation behind the same Electron-main projection: Claude
  Code contributes push hooks and Codex contributes a read-side app-server
  protocol snapshot. Both drive exact child identities through the shared
  Agent, Team, and Fleet view model; loss of a protocol observation is absent,
  never an inferred empty team or a synthetic child completion
- inert persisted Projects independent of Session tabs; a curated Project
  chooser with reviewed parent-folder import; and a lightweight task + Launch
  Configuration ribbon + Start composer. Its selected configuration carries an
  exact configured source/model/effort identity; Customize carries
  source-agnostic launch-permission, worktree/branch, roadmap, and naming
  controls beside that identity. Personal permission defaults are
  persisted by Project and harness; the PTY/source boundary translates
  `prompt`, `auto`, and `unrestricted` into current Claude Code and Codex
  flags plus OpenCode's guarded unique launch agent. The same boundary
  discovers Codex's and OpenCode's live model catalogs and reads
  Claude Code's account-aware catalog over its SDK control protocol, keeps the resolved pair
  visible beside the source, and passes per-Agent overrides as launch data
  without rewriting harness configuration. Claude's production path contains
  no hard-coded provider catalog: it mirrors the rows its own `/model` menu
  reports, falls back only to observed configured values or the honest account
  default when live discovery is unavailable, and never invents provider aliases.
  OpenCode applies exact reported variants through that launch agent even
  though the root TUI has no `--variant` flag; an unavailable catalog remains
  explicitly source-default/unknown. Grok Build reports model IDs and a
  default through `grok models` and enumerates no per-model effort to any
  interface a PTY launch can read, so Exawatt declares its effort selection
  `source-owned` and shows no effort control rather than inventing one; its
  permission modes map one-to-one onto the source's own
  `default`/`auto`/`bypassPermissions`, and the launch pins the Exawatt
  directory with `--cwd` so a login-shell `cd` cannot relocate the Session.
  Environment-owned effort constraints remain visible and non-editable because
  they outrank session flags. Successful launches alone train a Project-ranked
  app-wide Launch Configuration pool; Project pins, All/Customize, exact
  unavailable states, direct Shell, shared palette entries, and fresh-Session
  Clone sit on that one domain. The workspace chrome uses a measured
  single-row boundary: Projects fold before anything disappears, active tabs
  shrink before last-resort horizontal scrolling, and pointer-close stability
  and reduced-motion-safe transitions remain intact. Empty Projects remain open
  objects and stable-partition into a dormant tail after a short inactive dwell;
  only an explicit close removes the open group. The first authored change
  promotes task, source, model, effort, worktree/branch, and roadmap link into one
  persisted draft-tab record
- a source-agnostic Project catalog derived from durable workspace state. The
  Electron workspace save broadcasts an authoritative change event through the
  preload boundary; FleetProvider refreshes the catalog and local Session
  inventory so Agent, Team, and Fleet render the same open Projects,
  including zero-Agent/zero-Session Projects. Local Agents carry the stable
  directory-backed Project identity and join the existing group when started.
- persisted project-grouped terminal sessions, attention state, keyboard-first
  command flows, split panes, and the exposé session overview
- persistent command-altitude navigation between the Agent, Team, and Fleet
  altitudes, with one route/transition command service,
  direct routes, shared shortcuts, last-altitude restore, URL-backed Fleet
  filters, session-local camera return, existing-PTY Agent handoff, and exact
  semantic board-address return
- `LocalSessionsTransport` normalization of a local Session inventory into the
  shared `FleetState` consumed by the DOM and spatial fleet surfaces. The source
  boundary merges live Electron-main PTYs with persisted open workspace tabs:
  live PTYs provide runtime activity, while tabs without a process remain
  explicit stopped Session-backed Agents with stable handoff identity. This
  keeps Agent, Team, and Fleet aligned without pretending a stopped
  local process is alive.
- exact harness conversation identity for Electron tabs: assigned Claude IDs,
  bounded/cached Codex rollout discovery with launch-time association for
  parallel agents, and OpenCode's fail-closed pre-turn snapshot followed by a
  post-turn `session list` candidate export whose first user message must carry
  that PTY's collision-resistant launch-agent name. Persisted source IDs drive
  no-spawn relaunch with exact tab/Project/all resume actions; OpenCode resumes
  only through `-s`, never `--continue` or a timing/recency guess. The recovery
  bar makes the selected Project the one-click default and nests the distinct
  Agent/all-Projects scopes in one menu, so Project recovery does not restart
  unrelated work or create three competing controls
- a source-neutral recent-conversation catalog in Electron main. Replaceable
  Claude Code, Codex, and OpenCode provider adapters plus the Exawatt
  Project-Session adapter normalize exact
  identity, Project ownership, title, handoff text, continuation capability,
  and recency. Exact provider identity reconciles duplicate source records;
  one unambiguous same-harness initial-task match can recover identity-less
  legacy ownership, while ambiguity stays visibly unmapped. Exawatt's ledger
  contributes semantic goals and whole-Session reopening while provider-only
  rows resume their exact conversation. The new-tab composer
  renders native and machine-local cached labels immediately, supports either
  continuation path or a distinct fresh handoff, and never makes model
  availability a condition of local launch. Project scope is resolved once;
  Codex discovery uses its Project-filtered SQLite thread index with a
  metadata-first legacy fallback, actual nested/worktree launch directories
  are retained, concurrent visible-pane reads share a bounded TTL cache, and
  identity-less reconciliation is one-to-one on both sides. Missing labels may
  be augmented asynchronously through an authenticated hosted boundary only
  when the visible Settings preference allows it; excerpts are bounded and
  common credential patterns are redacted locally, Supabase enforces durable per-user hourly/daily
  quota, and the Anthropic credential is never exposed to the desktop renderer
  (decision `0017`)
- serialized workspace persistence and bounded terminal-history snapshots with
  append journals; steady-state disk work scales with new terminal output and
  compacts without exposing partial state
- an Electron-main Recently-closed ledger that publishes authoritative count
  changes for archive, reopen, and expiry/reap. The renderer subscribes before
  its initial snapshot and treats in-flight close state only as a temporary
  availability overlay, preventing stale hydration and periodic cleanup from
  drifting command enablement
- self-contained Electron packaging and transactional local delivery. Agent
  integration is a machine-local FIFO over the clone's common Git directory:
  each author publishes immutable attempt refs, the head rebases and proves the
  exact tree in its own bootstrapped worktree, and a repository-scoped delivery
  lock covers only the final non-force `master` push. The shared `master`
  checkout is a best-effort mirror, never merge authority. Dogfood is a separate
  superseding consumer outside that lock: queue drain or a ten-minute ceiling
  selects the newest requested integrated SHA, and the build runs from its
  detached immutable snapshot. A separate install-target lock serializes app
  replacement across clones. The expected Exawatt Developer ID Team, secure
  timestamp, hardened runtime, main identifier, nested helpers, and archived
  native code are strict-verified before a same-volume atomic app exchange; the
  previous bundle remains the rollback object until post-swap verification
  succeeds, and the next run can recover any interrupted transaction. The
  running app is never restarted. See
  [`agent-delivery.md`](agent-delivery.md) and decision `0030`;
- one owner for login-shell invocation
  (`electron/main/pty/login-shell.ts`). Running a harness, probing a source,
  reading a model catalog, or scanning resumes all execute the operator's own
  shell, which means executing arbitrary user startup code. The owner holds
  both contracts that were previously re-derived per call site: per-shell login
  argv (tcsh rejects a combined `-l -c`; PowerShell spells it `-Login
-Command`), and the rule that startup files never execute inside a Project —
  the shell starts in an app-owned scratch directory and enters the Project
  only afterwards, so a side effect of the operator's dotfiles cannot land in
  his repository (incident `0006`);
- standing main-thread stall instrumentation
  (`electron/main/main-thread-stall-trace.ts`). A beachball is a main process
  not servicing its run loop, and it freezes every window and every IPC reply.
  A sampled heartbeat measures its own lateness, and one wrapper at the single
  trusted-IPC door names the work that was open, or that started and finished,
  inside the blocked window. It records to a bounded, rotated, rate-limited
  local JSONL that rides along in a diagnostics bundle, and it fails closed —
  instrumentation may never become the reason the app is slow;
- deep terminal fundamentals and opt-in native attention notifications;
  immediate measured startup feedback backed by real bootstrap milestones,
  deferred command-module loading, warm renderer prestart, and bounded renderer
  cache retention;
  system-browser OAuth is coordinated by Electron main, which owns the PKCE
  verifier and code exchange, performs auth HTTP through Electron's native
  Chromium-backed `net.fetch`, and persists the completed session into the
  local renderer's canonical Supabase cookie jar; the sandboxed renderer
  receives only a completion signal through trusted preload IPC. A bounded,
  redacted JSONL lifecycle log under the app's machine-local data directory
  records auth phases, request shape, response status/timing, cookie mutation
  counts, and nested transport errors without codes, tokens, request bodies, or
  header values (decision `0014`)
- distribution-gated desktop identity and updates: community packaging uses
  `Exawatt Community` / `ai.exawatt.community`, an isolated state/cache
  namespace, no protocol registration, and no update-feed metadata or product
  update IPC. An official overlay may supply the Exawatt identity, protocol,
  icon, feed, and optional grouped update capability. Developer-ID signing,
  Apple notarization, private source-linked GitHub
  Releases, public Supabase Storage update artifacts, and explicit
  `electron-updater` restart with live-session impact. Electron 43 includes the
  macOS 26 Squirrel.Mac helper-activation fix; signed `v0.1.2` to `v0.1.3`
  update and automatic relaunch are verified
- roadmap lens (ENG-017): a Team-altitude rail rendering each Project's
  repo-canonical roadmap through the convention-v2 `@exawatt/core` parser and
  pure `@exawatt/ui-model` view. Electron main owns validated read/watch/git-
  activity IPC plus declared-only sequence/state transactions: parser-validated
  targets, real-path containment, per-file serialization, compare/refuse,
  atomic replacement, a named policy seam, guarded undo, and no git operation
  (decision `0035`). Roadmap-derived ATTENTION is a separate, fleet-wide
  producer (BUG-026): every open Project's roadmap is read and watched by one
  owner, blocked Sessions are linked without per-Session git, and the result
  joins PTY attention through a merge where each source declares whether it
  covers the whole fleet
- ENG-021 E1 Session-context inference: operator-submission-triggered evidence,
  authenticated server-owned structured labeling, durable last-good failure
  behavior, immediate correction, a repository gold corpus, and a reusable
  authenticated product-feedback intake with private optional screenshots
- ENG-035 operator-statistics foundation: a pure source-neutral Run/day/rank
  kernel, conservative Claude Code and Codex Consumption projection from the
  shared incremental main-process scanner, strict aggregate-only payload
  parser, preference-gated Electron-main scan IPC, durable consent/sync state,
  authenticated idempotent sync/disable/status API, and RLS-backed Supabase
  aggregate schema with enabled-only anonymous leaderboard/profile/Run
  projections
- ENG-038 provider plan-account read (slice 1): a credentialed, remote,
  read-only Electron-main sibling of the local Consumption scanner that
  fetches Claude plan windows from the vendor's own account endpoint using
  the Keychain credential Claude Code already holds (read in place, never
  persisted or refreshed), merges them into the live snapshot as reported
  plan-level capacity behind the same IPC seam, degrades every failure to
  absence, and carries a default-on own-account privacy switch. Installed
  Exawatt injects `electron.net.fetch` so the signed Chromium helper owns the
  request; unpackaged development and automated tests cannot open that path
  without the narrow explicit integration opt-in. ENG-030 OS4 replaces the
  temporary `app.isPackaged` capability test with the versioned distribution
  declaration `ownAccount.claudePlanUsage`: community defaults it absent,
  while official or downstream distributions may set `stable-signed` beside
  their signing custody. The declaration controls local automatic traffic and
  is never service authentication.

Implemented:

- deterministic local Session rehydration (ENG-018): durable logical identity,
  a main-owned atomic provider-identity index, crash-safe bounded journaled
  terminal history, two-commit quit/update shutdown, conservative one-to-one
  repair for legacy identity-less Sessions, and explicit exact-provider resume
  without a detached runtime

Partial:

- source/harness abstraction beyond OpenClaw/mock
- customer-hosted OpenClaw persistence, transport, reconnect/freshness, and UI
  projection (ENG-010 C1-C3; the pure C0 projection kernel is built)
- architecture overview as a living map
- Fleet Operations Board extraction into a standalone package

Planned:

- Initiative model
- scoped Decision model
- Context Signals
- Consumption and spend controls
- provider-reported activity, security posture, and assurance normalization
  across Agent Sources
- managed Workspace policy ceilings and Exawatt-enforced action mediation
- secrets/configuration strategy
- customer-hosted OpenClaw attach and read-only observation (ENG-010)
- command-capable connected Agents, Exawatt-managed placement, and later
  explicit clone/move workflows (ENG-033)
- multi-source fleet aggregation
- exact live Run lifecycle adapters beyond the conservative timestamped
  Consumption projection, and additional public identity providers beyond the
  GitHub-seeded V1 boundary
- Intel/universal desktop artifacts when supported-customer evidence requires
  them; the initial signed channel targets arm64

## Architecture Map

`/architecture` is rendered from `src/lib/architecture/manifest.ts`. Keep that manifest in sync with this document and the roadmap.

## Documentation Contract

See `AGENTS.md`. Product, architecture, roadmap, and decision docs are live system state and must be updated with relevant changes.
