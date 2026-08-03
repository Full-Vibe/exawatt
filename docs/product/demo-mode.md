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

**Interim — superseded by the Demo Workspace at ENG-027 W2.** The mock fleet source (`MockFleetTransport`) powers the Fleet altitude at `/fleet/spatial` when no live source is connected. It demonstrates agent status changes, attention, and fleet-scale motion without a live OpenClaw gateway, stays clearly labeled as simulated data, and drives the same UI-facing command hooks as Live Mode. When W2 lands, `MockFleetTransport` and `DemoControls` demote from the product surface to eval-only: the Demo Workspace's honest authored fleet becomes the only demo source on product surfaces, so simulated and honest demo data never coexist in a demo.

Fleet surfaces start in Demo Mode by default so public demos do not emit live-source token probes, auth redirects, or connection errors on page load. Live OpenClaw auto-connect is opt-in via `NEXT_PUBLIC_EXAWATT_AUTO_CONNECT_OC=true`; otherwise, users enter Live Mode through the explicit Connect control.

The Consumption surface (`/consumption`, ENG-008) reads its own in-process demo corpus and is Electron-navigable and demo-sourced by design.

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
