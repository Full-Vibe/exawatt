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
- **W2 Demo source and pane content source** — the demo data source behind the existing fleet transport boundary plus the Terminal pane content source; demo tabs render transcripts and cannot spawn a PTY.
- **W3 Demo fleet content** — the authored demo Workspace: Projects, roadmaps, Agents, Sessions, consumption. Authored as data, versioned in the repo, resettable.
- **W4 Scale tier (data)** — the demo fleet authored or generated at the entity count the Spatial moment needs, with honest structure at that volume rather than cloned filler. This milestone owns the DATA only; ENG-004 V3.1 owns rendering it. See the contradiction note below.
- **W5 Organization Workspace preview** — shared tenants appear in the switcher as ENG-026 `preview`, linking to the Organization surface. Named Organization, not Team: decision `0023` gives **Team** to the middle command altitude, and two Teams in one product is a collision.

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

## Open questions

- Does the operator want a keyboard gesture for Workspace switching, or is the account menu enough? (Leaning: menu only. A one-stroke path to demo data during real work is a hazard, not a feature.)
- Should the Demo Workspace be seeded from *recorded* real sessions (redacted) rather than authored fixtures? Recording is more convincing and more work; authored is controllable and safe. Leaning: authored for W3, recording as a later upgrade once the pane content source exists.
- Whether a shared/read-only Workspace link is the natural first multiplayer primitive (ENG-034) once W2 lands.
