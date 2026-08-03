# ENG-027 Workspace tenancy and the Demo Workspace

Owning roadmap item: `docs/engineering/roadmap.md` → ENG-027. This doc is execution detail, not an independent roadmap.

Source: the 2026-08-02 operator brief and design pass. Decided in that pass: the account/organization switcher is the **real tenancy seam**, not a demo toggle, and the Demo Workspace is its first non-personal tenant.

## Why this exists

Two needs met by one mechanism.

1. **The demo needs scale.** The altitude story — talk to one agent, zoom out to a populated fleet — cannot be told from the operator's real machine, which tops out around a dozen agents. The operator asked for the Gmail-style switcher so a demo can happen inside the product rather than beside it.
2. **The product needs tenancy anyway.** `Workspace` is already canonical (`docs/product/concepts.md`): the boundary for users, agents, initiatives, context, secrets, spend, policies, and governance. Team support, multiplayer, executive visibility, and the hosted control plane (ENG-012) all require it. Building a demo-only toggle would mean building it twice.

So: introduce Workspace as a real, switchable product concept now, with **Personal** and **Demo** as the first two tenants and team Workspaces arriving on ENG-012's sequence.

## Model

- A **Workspace** is the top-level context. Everything the operator sees — Projects, Agents, Sessions, roadmap lens, Consumption — is scoped to the active Workspace.
- **Personal** is local truth: real PTYs, real harness sessions, the operator's machine. It is the default and it is what daily driving means today.
- **Demo** is representative truth: a populated fleet with Projects, Agents, Sessions, roadmaps, and consumption history, served from a demo source. No LLM calls, no PTYs, no network.
- Team Workspaces are `preview` (ENG-026 grammar) until ENG-012 makes them real.

The switcher lives in the account/avatar menu. It is a context switch, not a mode toggle: the word *Demo* never appears as a global app state chip that could read as "the product is fake" — it appears as the identity of the Workspace you are in.

## Non-negotiable constraints

- **Switching Workspaces never touches live agents.** Local PTYs keep running while the operator is in the Demo Workspace; returning to Personal finds everything exactly as it was. Workspace switching is a view-scope change with zero lifecycle side effects. This is the single most important correctness property, because the operator dogfoods this app all day and a demo must never cost real work.
- **Demo data can never be mistaken for real.** Distinct Workspace identity is always visible; Consumption in a Demo Workspace never contributes to Personal totals; feedback capture (ENG-025) records the Workspace.
- **No fabricated liveness.** Demo Sessions are honest recordings/fixtures, not simulated agents pretending to think. The operator explicitly does not want scripted LLM responses or fake streaming output.
- **Terminal in the Demo Workspace spawns nothing.** Demo tabs render static transcript content through a pane content source; the PTY path is not reachable from a demo tab.

## The seam this forces (and why that is good)

Terminal panes are currently bound to live PTY output. The Demo Workspace requires a **pane content source** abstraction: a pane renders from either a live PTY or a fixed transcript buffer. That is the same shape as the existing FleetState transport split (`LocalSessionsTransport` / `MockFleetTransport`) applied one level lower, and it is the seam that later serves recorded traces, session replay, and shareable session links (multiplayer, ENG-034).

The demo work therefore pays for itself architecturally rather than accreting demo-only code — the standing requirement from the operator brief's holistic-architecture principle.

## Demo Workspace content

**What it portrays** (operator, 2026-08-02): one plausible multi-function startup, **majority coding**. Frontend, API, infra, and design-engineering Projects dominate; a minority of marketing, research, and support work shows the Agent Types vision (ENG-028) without implying those capabilities ship today. Non-coding Agents must read as ENG-026 `preview` content — the demo may show the future, but it may not fake the present.

The demo fleet must support the full altitude sweep across *different* Projects, Agents, and roadmaps:

- 6–12 Projects with distinct identities, colors, and real-looking roadmaps that parse under the published roadmap convention (ENG-017's parser reads them unmodified)
- a spread of Agent states across the five-signal status protocol (ENG-016 D40) including delegation (ENG-023) so the fleet does not read as uniformly idle
- Sessions with context labels, goals, and transcripts good enough to read over a shoulder
- consumption history with plausible shape over time
- a scale tier for the Spatial moment: enough Agents that aggregation, clustering, and label budgets visibly do their job

## Milestones

- **W1 Workspace as a real scope** — LANDED 2026-08-02 (see milestone log). Workspace identity, the account-menu switcher, Workspace-scoped view state, and the hard guarantee that switching never disturbs live local Sessions. Personal only; the switcher shows Demo as `Coming soon` until W2.
- **W2 Demo source and pane content source** — LANDED 2026-08-02 (see milestone log). The demo data source behind the existing fleet transport boundary plus the pane content source; demo tabs render transcripts and cannot spawn a PTY; Demo flips `available`.
- **W3 Demo fleet content** (landed 2026-08-02 — see milestone log) — the authored demo Workspace: Projects, roadmaps, Agents, Sessions, consumption. Authored as data, versioned in the repo, resettable.
- **W4 Scale tier (data)** (landed 2026-08-02 — see milestone log) — the demo fleet authored or generated at the entity count the Spatial moment needs, with honest structure at that volume rather than cloned filler. This milestone owns the DATA only; ENG-004 V3.1 owns rendering it. See the contradiction note below.
- **W5 Organization Workspace preview** — shared tenants appear in the switcher as ENG-026 `preview`, linking to the Organization surface. Named Organization, not Team: decision `0023` gives **Team** to the middle command altitude, and two Teams in one product is a collision.

## Scale honesty (decided 2026-08-02)

The honest authored fleet tops out at **~209 board entities** (173 Agents + 36 delegated runs), because every entity traces to a distinct real assignment on a real roadmap item — that is the ceiling of honest structure, not a rendering limit. The synthetic 1k/10k tiers are **headroom proof** for the rendering budget (ENG-004 V3.1) and must always be presented as synthetic — never as "the fleet". Demo scripts say **"hundreds"**, not thousands; the thousands claim belongs to the measured rendering headroom, presented as such.

## Recorded contradiction: demo scale vs parked V2.1

ENG-004 V2.1 (*Scale & Truth* — density and interaction budgets at 1k/10k, viewport culling, label budgets, frame instrumentation) is **parked** as of 2026-07-24, when Spatial was reframed as a demo asset rather than a daily-driver surface.

W4 needs part of that work: the demo's "zoom out to thousands" moment is precisely a rendering-density claim.

Resolution: only the **rendering-budget** half of V2.1 unparks — instancing, culling, label budgets, and frame measurement against the demo fleet — and the **truth** half stays parked, since Initiative-level aggregation and aggregate Project drill answer questions no demo asks. The demo-asset reframing is the reason to do the rendering half, not a reason to skip it.

That rendering work is **ENG-004 V3.1**, not this milestone. W4 produces the data; V3.1 makes it render at frame budget. Two milestones were briefly written claiming the same work on 2026-08-02 and were split the same day — an ownership collision is exactly the layer-cake failure `AGENTS.md` forbids, and parallel agents would have duplicated it.

## Roadmap milestone log

### 2026-08-02 — W1 Workspace as a real scope (landed)

Workspace tenancy exists as a real, switchable scope with Personal live and Demo visible as `Coming soon`.

**Mechanism.** New tenancy module at `src/lib/tenancy/` — deliberately named "tenant workspace" in code because "workspace" was already taken by the terminal shell (`src/components/workspace`, `workspace-store.ts`):

- `workspace-scope.ts` — the pure model: `TenantWorkspace` (id, name, kind, availability), builtin Personal/Demo, `resolveActiveWorkspace` (unknown or `coming-soon` ids always fall back to Personal — the app can never wake up inside a tenant that cannot render), `workspaceScopedStorageKey` (Personal keeps the legacy unscoped keys so pre-tenancy operator view memory survives; every other tenant gets `exawatt:ws:<id>:…`), `mergeWorkspaces` (builtins win id collisions).
- `tenancy-provider.tsx` — owns WHICH Workspace the app is looking at and nothing else; it never imports `window.electron.pty`/`workspace`, making the zero-lifecycle-side-effects guarantee structural. On switch it restores the target tenant's remembered command surface (recorded per-tenant by `CommandAltitudeNav` under the scoped key). A dev-only registration event lets tests add an `available` tenant — the same shape W2/W5 use to make Demo/Organization real.
- `workspace-scope-gate.tsx` — wraps `WorkspaceClient` on `/workspace`: non-personal tenants render an honest identity-carrying empty state instead of the PTY-bound shell. Unmounting the personal shell disposes only renderer widgets; PTYs live in the Electron main process, and returning re-adopts them via the existing reload-adoption path — no new session machinery was needed or touched.
- Account menu (`site-header-nav.tsx`): a `Workspace` section lists tenants with kind icons, taglines, an active check, and `Coming soon` disabled entries; in Electron the menu renders signed in or not so the switcher is always reachable. When the active tenant is not Personal, an always-visible teal identity chip (`data-active-tenant-workspace`) sits in the header — the "demo data can never be mistaken for real" rule made structural from day one.

**Proof.** `pnpm eval:electron:tenancy` (`scripts/electron-workspace-tenancy-eval.mjs`, withElectronApp): starts a real shell PTY in Personal, prints a marker, switches to a registered non-personal tenant through the real menu, verifies `pty.list()` identity is untouched, writes to the PTY over IPC **while the other Workspace is on screen** and sees fresh output (running, not merely not-killed), switches back, and verifies the pane re-adopts with both markers replayed and identical session identity. All 11 checks pass; screenshots of the switcher, the scoped view, and the restored shell are captured by the eval.

**Explicitly out of W1** (tracked forward): Workspace-attributed feedback and consumption ride the W2 source work; the Demo tenant flips `availability` in W2; no keyboard gesture for switching (per the open question's leaning — the menu is the only path).

### 2026-08-02 — W1 review fixes (landed)

A verified code review of the W1 landing (and the decision-0023 rename) surfaced seven findings; all fixed in one pass.

**View-state correctness.**

- *Boot-restore race (MEDIUM).* Child effects run before parent effects, so `CommandAltitudeNav`'s one-shot surface restore ran before the tenancy provider resolved the persisted tenant — a relaunch inside a non-personal tenant read Personal's surface memory, consumed the one-shot against it, and polluted Personal's key. The provider now exposes `hydrated` (false until the persisted choice resolves post-mount); the nav's restore-and-record effect waits on it, so the restore runs exactly once against the correct tenant's key. The provider also accepts `initialWorkspaces` — tenants that must survive a relaunch as the boot Workspace have to be present at mount, because the dev registration event arrives after resolution.
- *Transient cross-tenant write (LOW).* On switch, the memory key flips before navigation lands, so the OLD tenant's surface was briefly written under the NEW tenant's key. The nav now tracks which key each recorded address was written under and skips the write when only the tenant changed; recording resumes when navigation lands.
- Regression tests: `src/components/nav/command-altitude-nav.test.tsx` (boot restore under a persisted non-personal tenant, no fallback to Personal memory, scope-aware validation, the transient-write skip).

**Scope-gate coverage (MEDIUM).**

- `/fleet/spatial` renders Personal live truth (the fleet transport reads `window.electron.pty`) but was ungated — a non-personal tenant showed the personal live fleet under its identity chip. The Fleet page now mounts `WorkspaceScopeGate`; the eval proves it end-to-end (rail to Fleet while in a bench tenant → scoped view, no `[data-spatial-command]`, chip still visible).
- Restore hardening: `validStoredCommandSurfaceForWorkspace` allows a non-personal tenant to restore only onto surfaces in `TENANT_SCOPE_GATED_SURFACE_PATHS` (`command-surface-memory.ts`); both `switchWorkspace` and the boot restore use it, so a remembered path can never bypass the gate. Any route added to that set MUST mount the gate.
- **Decision — Settings is tenant-neutral.** `/settings` carries app-level configuration (shortcuts, agent sources, notifications), not tenant data; it stays ungated deliberately. **Decision — `/consumption` stays ungated in W1**: it renders only its own in-process demo corpus (ENG-008 E4), so it shows no Personal live truth. The moment W2 gives Consumption a per-tenant source, it joins the gated set — that is a W2 exit criterion, not an option.

**Shutdown identity refresh (LOW).** Quitting while the workspace UI was unmounted (scope-gated tenant on screen, or from `/settings`/Fleet) skipped the renderer checkpoint that merges live `harnessSessionId`s into the persisted layout, so identities settled at `pre-stop` could go stale on disk. Main now performs the merge itself when no renderer owns workspace state: `mergeHarnessIdentities` (`electron/main/workspace-store.ts`, defensive walk of `projects[].tabs[]` identity fields only) runs from `checkpointRenderer`'s no-owner path. Unit-tested in `electron/main/workspace-store.test.ts`.

**Chrome consistency (LOW/NIT).** The header identity chip uses `WORKSPACE_KIND_ICONS` per tenant kind instead of a hardcoded demo icon; the web-only header link to `/workspace` now carries the manifest's name (**Agent**) and the canonical altitude icon (`ALTITUDE_ICONS`, exported from the rail); `src/proxy.ts` narrows the public prefix `/fleet` → `/fleet/spatial` — only that route exists since decision 0023.

### 2026-08-02 — W3 + W4: the authored demo fleet (data only)

**What landed.** The Demo Workspace's content, authored as deterministic,
versioned, resettable fixtures in `@exawatt/core` (`packages/core/src/demo/`),
with its contract enforced by `packages/core/src/__tests__/demo-workspace.test.ts`
(37 tests). No rendering was touched — ENG-004 V3.1 owns pixels, and W2's demo
source / pane content source are the intended consumers of this data.

**The startup.** Voltaic Grid Systems ("Voltaic") — an AI-native virtual power
plant that aggregates home batteries, EV chargers, and rooftop solar into
dispatchable grid capacity. Chosen per the coordination pass: energy-tech fits
Exawatt's wattage vocabulary. Ten Projects (7 coding / 3 non-coding), four
Initiatives (ERCOT market entry, Voltaic Home GA, Pilot: 500-home fleet, SOC 2
Type II):

- coding, `live`: `dispatch-engine`, `grid-api`, `voltaic-home`,
  `telemetry-ingest`, `edge-gateway`, `partner-portal`, `platform-infra`
- non-coding, `preview` (ENG-028 Agent Types: Researcher / Marketer / Support):
  `market-intel`, `demand-gen`, `support-ops`

**Roadmaps.** Each Project carries a real `ROADMAP.md` (52 items, 36
milestones total) stored as raw markdown and read through the real
`parseRoadmap` — never a pre-parsed demo shape. The test suite fails on any
warn-level diagnostic, any unparsed line, or missing `declared` conformance,
so "parses with zero warnings" is a gate, not an eyeball. Item ids are unique
workspace-wide, and every Session link on every Agent is verified to point at
an item that exists in its Project's roadmap.

**Fleet.** 27 hand-authored base Agents (readable up close: goals, six-word
D33 subtitles, three fully-written blockers covering approval/question/
credential, two written fault notes, three hero transcripts including one
preview-desk transcript). The W4 scale generator extends this to 173 Agents
plus 36 delegated runs (~209 board entities) with honest structure: every
generated Agent executes a distinct authored assignment — singleton
workstreams or partitions of genuinely parallel fan-out batches (sharded
backtests, per-control SOC 2 evidence, per-vendor conformance runs) — tracing
to a real roadmap item. Uniqueness of id/name/goal, five-signal coverage at
both tiers, Codex-never-delegates capability truth, and preview honesty for
every non-coding Agent are all test-enforced. Everything derives
deterministically from the frozen fixture clock (`DEMO_WORKSPACE_NOW_MS`);
`demoFleetAgents(tier, { nowMs })` rebases timestamps without changing
structure, so reset means byte-identical data.

**Consumption.** 1,008 real `ConsumptionSample`s across 145 provider sessions
over 14 days, following the ENG-008 E4 precedent: emitted in core's own
shapes and rolled up with core's own `rollupBy*`, so no shape is unique to
the demo. The corpus keeps the measured real-world properties — cache reads
dominate 10-100x, delegated spend exists only on Claude Code samples, Codex
alone reports reasoning tokens and plan windows, and Exawatt's own `sdk-cli`
summarizer overhead is present and separable.

**Not in this milestone.** The Workspace switcher (W1), the demo source and
pane content source (W2), any rendering, and any UI marker components — the
fixtures carry `readiness` as data; ENG-026 owns how `preview` renders.

### 2026-08-02 — W3/W4 review fixes (landed)

A verified review of the fixture commit found six defects; all are fixed and
test-enforced (`demo-workspace.test.ts`, now 43 tests):

- **Branches**: the scale generator truncated branch slugs mid-word at 24
  chars, collapsing fan-out partitions onto one branch (`…-migrati` ×5).
  Branch slugs now trim at word boundaries only and always keep the partition
  token; branch uniqueness and word-shape are test-enforced.
- **Determinism was tested tautologically** (cached object vs itself). The
  fixtures now expose internal rebuild hooks (`rebuildScaleTierForTest`,
  `rebuildConsumptionForTest`) and tests compare two independent builds. The
  canonical fleet and corpus are deep-frozen, so consumer mutation cannot
  corrupt "reset = identical".
- **Consumption now matches the measured corpus it cites**
  (consumption-spine.md): Codex operator sessions outnumber Claude's
  (75 vs 40; measured 302 vs 61) while Claude sessions stay individually
  larger, and delegated runs are ~36% of Claude samples (measured 37.7%).
  Both cited properties are test-enforced so the module header cannot lie.
  The corpus is now 1,178 samples over the same 145 provider sessions.
- **Needs-you rows are authored, never rolled**: blocked status at the scale
  tier now comes only from a written, assignment/partition-specific blocker
  (13 authored, with descriptions and suggested responses matching base-tier
  quality); the generic clone stems (byte-identical titles ×4, lowercase
  "july") are gone. Title/description uniqueness is test-enforced fleet-wide.
- **Preview desks delegate function-appropriate children** (source sweeps,
  claim fact-checks, ticket pulls — never "test coverage").
- Smaller: all three preview functions are pinned against silent promotion
  into `CODING_FUNCTIONS`; `demoWorkspaceConsumption({ nowMs })` rebases like
  `demoFleetAgents`; the base-agents doc comment no longer overclaims "one of
  each `BlockerType`"; `pnpm --filter @exawatt/core test` now runs the suite
  instead of silently exiting 0.

### 2026-08-02 — W2 Demo source and pane content source (landed)

The Demo Workspace is live: switching to Demo in the account menu walks
Voltaic through the production surfaces at every altitude, and switching back
finds every live local Session exactly as it was.

**Transport.** `DemoWorkspaceTransport` (`packages/core/src/transports/demo-workspace.ts`)
maps the W3/W4 fixtures into the SAME `FleetManager`/`ExawattAgent` contract
`LocalSessionsTransport` feeds — status, blockers, delegation (present only
when children exist), turns/tokens — with every timestamp rebased to real now
via the fixtures' `nowMs` support. Deliberately NOT mapped: dollars.
`estimatedCost` stays 0 exactly as the live local path reports it, because a
list-price-derived figure is the confident lie `model-weights.ts` refuses;
the Consumption surface owns the demo spend story. `stop()` removes every
demo agent, and the tenant-aware `FleetProvider` additionally creates a fresh
`FleetManager` per source regime, so demo entities can never linger under
Personal's identity (or vice versa). The provider waits on the W1 `hydrated`
fence before picking a source, so a relaunch inside Demo never spins up the
personal source first.

**Pane content source.** The demo shell (`src/lib/demo-workspace/`) renders
`/workspace` and `/workspace?view=sessions` for the Demo tenant behind
`WorkspaceScopeGate` (which grew a per-route `demo` slot and fails closed to
the scoped empty state for any tenant without content). A demo Session opens
readable content: the three authored hero transcripts, or the honest session
record — goal, subtitle, status, blocker text, delegated team, usage — which
is exactly what a real fleet shows for a tab you have not opened. No input
affordance exists; the module imports no Electron API, so the PTY path is
unreachable by construction. Preview desks carry the shared ENG-026
`ComingSoonMarker` (owner = the ENG-028 Agent Type), not a local vocabulary.

**Same UI-model contracts everywhere.** The Team altitude is the REAL
`ExposeOverlay` over fixture-derived `Project`/`WorkspaceTab` shapes, with
the roadmap rail reading fixture markdown through the real parser via an
injected `RoadmapReadSource` on `useProjectRoadmap` (no filesystem, no
watcher). ⌘K lists Voltaic Sessions through the same `SessionRow` shape and
session-jump events; every verb that reaches Personal truth or a PTY (Start
Agent, shells, Projects, reopen) is gated off in Demo. The Fleet altitude is
the unmodified `SpatialFleetClient` — the tenant-aware provider swaps the
transport underneath, so the 173-agent / ~209-entity honest board renders
with drill, filters, and the session handoff jumping into the demo shell.
Scale honesty holds: the board shows the honest fleet; the synthetic 1k/10k
tiers remain eval-only (`/eval/t10-board-scale`).

**Consumption.** `/consumption` joined `TENANT_SCOPE_GATED_SURFACE_PATHS`
per the W1 decision note: it now has a per-tenant source. The E4 rollup
builder was extracted (`buildDemoConsumption`), and the Demo tenant feeds it
the Voltaic corpus (`demoWorkspaceConsumption({ nowMs })` on the shared
demo-shell clock) with the fixture roadmaps parsed for the outcome act and
derived intervention counts for the N2 metric. Two corpora, one rollup path,
zero merging — demo consumption structurally cannot contribute to Personal
totals.

**Disposition executed.** `MockFleetTransport` is eval-only (removed from
`FleetProvider`; the web demo posture now runs the honest Voltaic source) and
`DemoControls` was deleted from the product surface. The simulated and honest
demo sources can no longer coexist anywhere a user looks.
`docs/product/demo-mode.md` records the Demo Workspace as the demo
implementation.

**ENG-026 readiness:** nothing flips. The spine surfaces were already `live`;
Consumption stays `preview` because it is still demo-sourced in Personal —
E5's live local parse owns that flip.

**Proof.** `pnpm eval:electron:tenancy` grew from 13 to 31 checks across two
launches: the W1 bench round trip unchanged; the Demo walk (readable
transcript, preview marker, palette rows and absent launch verbs, 27 exposé
tiles with the in-tenant roadmap rail, the populated board, PTY identity
untouched AND still executing under a third marker); and a relaunch on the
same userData proving boot-restore inside Demo lands on Demo content — the
W1 review-fix composition demonstrated, not assumed. Screenshots of every
altitude, the palette, Consumption, and the relaunch are captured by the
eval and the CDP consumption check.

## Open questions

- Does the operator want a keyboard gesture for Workspace switching, or is the account menu enough? (Leaning: menu only. A one-stroke path to demo data during real work is a hazard, not a feature.)
- Should the Demo Workspace be seeded from *recorded* real sessions (redacted) rather than authored fixtures? Recording is more convincing and more work; authored is controllable and safe. Leaning: authored for W3, recording as a later upgrade once the pane content source exists.
- Whether a shared/read-only Workspace link is the natural first multiplayer primitive (ENG-034) once W2 lands.
