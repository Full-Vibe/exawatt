# Exawatt Architecture

Exawatt is an Electron desktop app and future hosted interface layer for commanding agents from any compatible source.

The first execution target is local OpenClaw. The architecture must remain source-agnostic so future Agent Sources can include hosted OpenClaw, Codex, Claude Code, custom harnesses, and Demo Mode.

## Layers

### Experience Layer

User-facing surfaces:

- Electron desktop app
- Next.js web app
- `/fleet`
- `/dashboard` and `/board` legacy demo surfaces
- `/overview` architecture map
- future public `/docs` guides

### Command Layer

Canonical product objects:

- Workspace
- Initiative
- Agent
- Session
- Decision
- Approval
- Event
- Artifact
- Consumption

This layer should hide source-specific plumbing from the UI.

### Source Layer

Provider/runtime boundaries:

- Agent Source / Harness adapters
- local OpenClaw gateway
- remote OpenClaw gateway
- Codex / Claude Code adapters
- Demo Scenario Source
- custom harnesses

The UI should depend on normalized Exawatt concepts, not raw provider-specific payloads.

### Signal and Governance Layer

Context and controls:

- Context Signals
- Secrets / Credentials
- Policies / Budgets
- Consumption
- Decisions
- Approvals

### Infrastructure Layer

Runtime and persistence:

- local machine
- Supabase
- Electron main/preload process
- future hosted VPS instances, starting with Hetzner
- future hosted Exawatt control plane

## Current Implementation

Built:

- Next.js app shell
- Electron shell
- Supabase auth/data
- legacy Supabase demo task flow
- `@exawatt/core` OpenClaw JSON-RPC client, adapters, FleetManager, and MockFleetTransport
- `/fleet` live/mock fleet UI
- `/fleet/cron`

Partial:

- Electron local runtime integration
- source/harness abstraction beyond OpenClaw/mock
- architecture overview as a living map

Planned:

- Initiative model
- scoped Decision model
- Context Signals
- Consumption and spend controls
- secrets/configuration strategy
- hosted OpenClaw / remote harnesses
- multi-source fleet aggregation

## Architecture Map

`/overview` is rendered from `src/lib/architecture/manifest.ts`. Keep that manifest in sync with this document and the roadmap.

## Documentation Contract

See `AGENTS.md`. Product, architecture, roadmap, and decision docs are live system state and must be updated with relevant changes.
