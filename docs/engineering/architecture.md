# Exawatt Architecture

Exawatt is a command interface for managing agent fleets across local, hosted, and third-party harnesses.

The architecture is source-agnostic: local OpenClaw, hosted OpenClaw, Codex, Claude Code, custom harnesses, and Demo Harnesses all sit behind explicit Agent Source / Harness boundaries.

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

ENG-032's appearance boundary is in **active build** (decision `0026`). T0–T2
implement strict versioned definitions, Classic/Air/Night authored data, a
deterministic validator/generator, one pure resolver, device-local Electron/web
preference adapters, a production provider, first-paint/native bootstrap, and
the gallery-accepted Air/Night visual family.
Electron settings are authoritative on desktop; a validated local mirror exists
only to select generated CSS before hydration, then reconciles immediately.
BrowserWindow, the CSP launch document, native theme source, and the hydrated
root consume one generated/validated state path. `--safe-theme` bypasses stored
appearance for one launch without mutating it. The temporary theme workbench
resolves that same immutable snapshot into scoped DOM/material variables,
ANSI/xterm data, and a concrete-sRGB on-demand R3F sibling with a bloom-free
Air gate. Classic is still the only persistable production preset. T3–T5
project the accepted contract through production DOM, xterm, Fleet/R3F, and
selection adapters; those renderers do not merge theme state independently.
The contract keeps action, status, Project identity, Consumption, and readiness
channels distinct and accepts no executable CSS/JavaScript or remote assets.
Demo and Live data remain irrelevant to appearance selection.

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
The surface manifest owns route identity, the shortcut registry owns effective
keys, the Fleet board owns URL filters plus session-local camera return, and the
workspace owns terminal/Team focus.

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

This layer also owns translation, durable decisions, context signals, policies,
budgets, approvals, and consumption records.

This layer also owns UI-facing view models and command contracts that are shared by multiple UI regimes. These presentation models must be source-agnostic, deterministic, pure TypeScript, and testable without React, DOM, Electron, or Three.js.

Session context inference follows one source-agnostic evidence contract. The
desktop supplies bounded, redacted operator instructions through trusted IPC;
an authenticated hosted endpoint applies quota and server-held model
credentials; Electron main accepts only validated structured results and owns
the last-good durable label. PTY output is not label evidence. Hosted failure
retains existing state rather than invoking a competing local summarizer
(decision `0019`). Explicit label votes/corrections and general product reports
use an authenticated Supabase-backed feedback intake with private optional
attachments; inference excerpts themselves are not persisted.

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

#### Agent Source registry and connection truth

Settings consumes a source-agnostic Agent Source registry rather than reading
PTY launch helpers directly. A configured source record combines a source
adapter with user-scoped instance metadata: display name, endpoint or local
installation, minimum exposed identity, credential owner, and last successful
observation. Multiple records may use the same adapter.

The production desktop path implements that boundary in Electron main. A
versioned, generated declaration contract owns stable adapter identity,
presentation, supported actions, and capability claims for both main and
renderer. Runtime observations remain main-process evidence. This prevents UI
defaults, source probes, and launch code from becoming competing registries.
Source-specific CLI/config/protocol inspection stays behind a renderer-safe IPC
surface; Settings and the Agent composer consume the same normalized
snapshots. Claude Code and Codex are launch-capable local records. Local
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
source mechanism and observation time. Codex's supported machine-readable
model command populates its live catalog. Claude Code exposes the account-aware
rows from its native `/model` interface through an SDK `initialize` control
response. If that live probe is unavailable, its adapter returns only observed
configured values or an account-default sentinel and source-owned selection
action. Product code never promotes fixture aliases into source truth.

The registry exposes global source/account facts. The workspace resolves a separate
Project-effective launch view by combining source facts, Project draft state,
and environment policy. This separation prevents an account default in
Settings from masquerading as the model a particular Agent will launch.

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
connection action. Remote Gateway and future
custom-source credentials may be held as narrowly scoped OS-keychain connection
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
- remote OpenClaw gateway
- Codex / Claude Code adapters
- Demo Harness / Demo Scenario Source
- custom harnesses
- local machine
- Supabase
- Electron main/preload process
- hosted VPS instances, starting with Hetzner
- hosted Exawatt control plane

The UI should depend on normalized Exawatt concepts, not raw provider-specific payloads.

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
- `@exawatt/core` OpenClaw JSON-RPC client, adapters, FleetManager, and the Demo Workspace fixture transport (`DemoWorkspaceTransport`; the simulated `MockFleetTransport` is eval-only since ENG-027 W2)
- Workspace tenancy (ENG-027): Personal and Demo tenants behind the account-menu switcher; the Demo tenant runs the authored Voltaic fleet, pane content sources (transcripts / honest session records, never a PTY), demo ⌘K rows, and the Voltaic consumption corpus through the production surfaces
- `@exawatt/ui-model` typed UI-facing fleet selectors and command contracts
- `/fleet/spatial` Fleet Operations Board (V2.0 active replacement of the
  superseded immersive 3D composition)
- Electron agent terminal workspace with real `node-pty` sessions rendered by
  xterm.js for Claude Code, Codex, and shells, behind a session-manager boundary
- Electron-main turn-state ownership that distinguishes Agent work from PTY
  transport noise: output may establish working before a turn settles, while a
  quiet/BEL boundary latches finished until guaranteed operator engagement.
  Shells remain output-driven because they have no Agent turn contract
- inert persisted Projects independent of Session tabs; a curated Project
  chooser with reviewed parent-folder import; and a compact source-aware Agent
  composer whose optional first task and source-agnostic launch-permission
  policy cross the launch boundary as data. Personal permission defaults are
  persisted by Project and harness; the PTY/source boundary translates
  `prompt`, `auto`, and `unrestricted` into current Claude Code and Codex
  flags. The same boundary discovers Codex's live model catalog and reads
  Claude Code's account-aware catalog over its SDK control protocol, keeps the resolved pair
  visible beside the source, and passes per-Agent overrides as launch data
  without rewriting harness configuration. Claude's production path contains
  no hard-coded provider catalog: it mirrors the rows its own `/model` menu
  reports, falls back only to observed configured values or the honest account
  default when live discovery is unavailable, and never invents provider aliases.
  Environment-owned effort constraints remain visible and non-editable because
  they outrank session flags. The workspace chrome uses a measured elastic-ribbon
  boundary: compact Project headers, selected and manually persisted disclosure,
  Initiative-shaped Session tabs, two-row target-bounds layout,
  priority-preserving overflow, pointer-close stability, and
  reduced-motion-safe transitions. Empty Projects remain open objects and
  stable-partition into a dormant tail after a short inactive dwell; only an
  explicit close removes the open group. The first authored change promotes
  task, source, model, effort, worktree/branch, and roadmap link into one
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
  parallel agents, explicit selection fallback, and no-spawn relaunch with
  exact tab/Project/all resume actions
- a source-neutral recent-conversation catalog in Electron main. Replaceable
  Claude Code, Codex, and Exawatt Project-Session adapters normalize exact
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
- self-contained Electron packaging and transactional local delivery. Dogfood
  builds run from a detached snapshot of one committed clean-`master` SHA while
  a repository-scoped delivery lock prevents another agent from advancing the
  shared checkout. A second install-target lock serializes separate clones.
  The expected Exawatt Developer ID Team, secure timestamp, hardened runtime,
  main identifier, nested helpers, and archived native code are strict-verified
  before a same-volume atomic app exchange; the previous bundle remains the
  rollback object until post-swap verification succeeds, and the next run can
  recover any interrupted transaction. The running app is never restarted;
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
- Developer-ID signing, Apple notarization, private source-linked GitHub
  Releases, public Supabase Storage update artifacts, and explicit
  `electron-updater` restart with live-session impact. Electron 43 includes the
  macOS 26 Squirrel.Mac helper-activation fix; signed `v0.1.2` to `v0.1.3`
  update and automatic relaunch are verified
- roadmap lens (ENG-017): a read-only workspace rail rendering each Project's
  repo-canonical roadmap per the published convention (`@exawatt/core` parser,
  `@exawatt/ui-model` lens view, validated `roadmap:read` IPC in Electron main)
- ENG-021 E1 Session-context inference: operator-submission-triggered evidence,
  authenticated server-owned structured labeling, durable last-good failure
  behavior, immediate correction, a repository gold corpus, and a reusable
  authenticated product-feedback intake with private optional screenshots

Implemented:

- deterministic local Session rehydration (ENG-018): durable logical identity,
  a main-owned atomic provider-identity index, crash-safe bounded journaled
  terminal history, two-commit quit/update shutdown, conservative one-to-one
  repair for legacy identity-less Sessions, and explicit exact-provider resume
  without a detached runtime

Partial:

- source/harness abstraction beyond OpenClaw/mock
- architecture overview as a living map
- Fleet Operations Board extraction into a standalone package

Planned:

- ENG-032 DOM/xterm and Fleet/R3F percolation, production selection UI, and
  final Auto rollout
- Initiative model
- scoped Decision model
- Context Signals
- Consumption and spend controls
- provider-reported activity, security posture, and assurance normalization
  across Agent Sources
- managed Workspace policy ceilings and Exawatt-enforced action mediation
- secrets/configuration strategy
- hosted OpenClaw / remote harnesses
- multi-source fleet aggregation
- Intel/universal desktop artifacts when supported-customer evidence requires
  them; the initial signed channel targets arm64

## Architecture Map

`/architecture` is rendered from `src/lib/architecture/manifest.ts`. Keep that manifest in sync with this document and the roadmap.

## Documentation Contract

See `AGENTS.md`. Product, architecture, roadmap, and decision docs are live system state and must be updated with relevant changes.
