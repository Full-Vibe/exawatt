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

The current primary demo implementation is the mock fleet source behind `/fleet`, `/fleet/[agentId]`, and `/fleet/cron`.

It demonstrates:

- fleet health and source mode
- agent status changes
- focus/chat view
- blocker creation and resolution
- recurring heartbeats
- token, cost, and activity signals

The fleet demo is intentionally available without a live OpenClaw gateway. It should remain clearly labeled when using simulated data and should keep using the same UI-facing command hooks as Live Mode.

Fleet surfaces start in Demo Mode by default so public demos do not emit live-source token probes, auth redirects, or connection errors on page load. Live OpenClaw auto-connect is opt-in via `NEXT_PUBLIC_EXAWATT_AUTO_CONNECT_OC=true`; otherwise, users enter Live Mode through the explicit Connect control.

The legacy Supabase demo task flow is still retained. It powers `/dashboard` and `/board` with Supabase-backed projects, tasks, blockers, and activity events.

Seeded tasks are marked with:

```json
{
  "demoFlow": "legacy-supabase-task-demo",
  "seededBy": "seedDemoData"
}
```

`resetDemo()` is scoped to the known legacy demo project set and must not delete arbitrary user tasks.

## Future Architecture

Demo Mode should evolve into a pluggable scenario source:

- legacy Supabase demo flow
- local JSON scenarios
- recorded live traces
- generated simulations
- curated investor demos

All sources should normalize into the same UI-facing concepts as Live Mode.
