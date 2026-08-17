# Demo Mode

Demo Mode is a first-class Exawatt product mode. It is not a temporary hack.

Demo Mode lets investors, collaborators, and users experience Exawatt without live agents, while exercising the same UI and command concepts as Live Mode.

## Principles

- Demo Mode should use the same UI layers as Live Mode.
- Demo Mode should sit behind a lower-level data/source abstraction.
- Demo scenarios should demonstrate real product concepts: Workspace, Initiative, Agent, Session, Decision, Context Signal, Consumption, and Approval.
- Demo data must be clearly separated from real user-controlled agent data.
- Demo scenarios should be easy to reset, replay, and evolve.

## Current Implementation

**The Demo Workspace (ENG-027, landed 2026-08-02) is the demo implementation.** Demo is a real tenant in the account-menu and ⌘K Workspace switchers. Selecting it runs the authored Voltaic Grid Systems fixtures (`@exawatt/core` demo module) through the production surfaces:

- the Fleet altitude renders the honest ~209-entity fleet through `DemoWorkspaceTransport` — the same `FleetManager`/UI-model contracts the live local transport feeds
- the Agent and Team altitudes render the demo shell behind `WorkspaceScopeGate`: Sessions open a **pane content source** — authored hero transcripts or the honest session record — never a live PTY, never a simulated stream, never a blank pane
- every demo Agent names one of four authored Initiatives; the active Agent context bar and Team cards project that source truth without inventing it for sources that do not report Initiatives
- ⌘K lists the demo Sessions through the same row shapes; every verb that could reach a PTY or Personal truth is absent in the Demo tenant
- ⌘K also projects the shared tenancy rows: available Workspaces switch through the production seam, while Organization previews navigate without activating
- `/consumption` reads the Voltaic consumption corpus through the same core rollups; demo consumption structurally cannot contribute to Personal totals
- switching Workspaces never touches live agents — proven end to end by `pnpm eval:electron:tenancy`

Naming is domain-specific and singular: **Demo** is the tenant's name;
**Voltaic Grid Systems** is the organization portrayed by the representative
fixture corpus. The switcher also shows that shared Organization Workspace as
an honest, non-activatable preview linking to `/organization`.

The web app (no Electron, no OS-owned Agent Source boundary) always starts on
the same honest Demo Workspace source, so public demos do not emit live-source
token probes, auth redirects, or connection errors on page load. A focused
Electron run may opt into its configured local/LAN OpenClaw source with
`NEXT_PUBLIC_EXAWATT_AUTO_CONNECT_OC=true`; the authenticated socket and every
credential remain Electron-main owned. Browsers never receive a token-returning
fallback route.

### Retired to eval-only: the mock fleet simulation

The simulation engine (`MockFleetTransport`, with its speed/scale `DemoControls` UI) demoted from the product surface to eval-only when the Demo Workspace landed, per the recorded ENG-027 W2 disposition: the simulated and honest demo sources must never coexist in a demo. The class remains in `@exawatt/core` for eval harnesses; its synthetic 1k/10k tiers serve rendering-headroom measurement only (`/eval/t10-board-scale`) and are always presented as synthetic, never as "the fleet".

### Retired: the legacy demo trio

The legacy demo surfaces — `/fleet` (Fleet Command), `/dashboard` (Lattice), and `/board` — and their Supabase-backed task simulation (`seedDemoData` / `resetDemo`, the `legacy-supabase-task-demo` flow) were retired with decision `0023` (2026-08-02). Retiring the trio freed the `Fleet` name for the far command altitude. Their purpose — showing the product without live agents — is superseded by the **Demo Workspace** (ENG-027), which runs demo content through the primary product surfaces instead of parallel demo-only pages.

## Future Architecture

Demo Mode should evolve into a pluggable scenario source behind the Demo Workspace (ENG-027):

- versioned, resettable demo Workspace data (ENG-027 W3/W4)
- local JSON scenarios
- recorded live traces
- generated simulations
- curated investor demos

All sources should normalize into the same UI-facing concepts as Live Mode.
