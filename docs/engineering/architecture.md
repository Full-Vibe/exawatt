# Exawatt Architecture

Exawatt is a command interface for managing agent fleets across local, hosted, and third-party harnesses.

The architecture is source-agnostic: local OpenClaw, hosted OpenClaw, Codex, Claude Code, custom harnesses, and Demo Harnesses all sit behind explicit Agent Source / Harness boundaries.

## Layers

### UI Layer

User-facing surfaces:

- Electron desktop app
- Next.js web app
- `/fleet`
- `/fleet/spatial`
- `/dashboard` and `/board` legacy demo surfaces
- `/architecture` public architecture map
- future public `/docs` guides

The UI layer supports multiple modular regimes over the same command model:

- DOM operations UI for dense text, forms, chat, and accessibility-critical controls
- 3D Fleet Command Surface for project-grouped fleet observability, zooming, selection, attention scheduling, and state animation
- future packaged or Electron-hosted UI variants

UI regimes may render and compose controls, but they should not translate harness payloads, own provider-specific state, or bypass typed command boundaries.

### Coordination and Intelligence Layer

Canonical product objects:

- Workspace
- Initiative
- Project / Context Group (a resolvable grouping lens keyed off agents, not a stored parent)
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

This layer also owns translation, durable decisions, context signals, policies, budgets, approvals, and consumption records.

This layer also owns UI-facing view models and command contracts that are shared by multiple UI regimes. These presentation models must be source-agnostic, deterministic, pure TypeScript, and testable without React, DOM, Electron, or Three.js.

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
- Project / Context Group (a resolvable grouping lens keyed off agents, not a stored parent)
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
- `@exawatt/core` OpenClaw JSON-RPC client, adapters, FleetManager, and MockFleetTransport
- `@exawatt/ui-model` typed UI-facing fleet selectors and command contracts
- `/fleet` live/mock fleet UI
- `/fleet/cron`
- `/fleet/spatial` first 3D Fleet Command Surface
- Electron agent terminal workspace with real `node-pty` sessions rendered by
  xterm.js for Claude Code, Codex, and shells, behind a session-manager boundary
- persisted project-grouped terminal sessions, attention state, keyboard-first
  command flows, split panes, and the exposé session overview
- `LocalSessionsTransport` normalization of local PTY sessions into the shared
  `FleetState` consumed by the DOM and spatial fleet surfaces

Partial:

- detachable Electron session/process backend; terminal layouts revive after an
  app restart, but the underlying processes do not yet survive it
- source/harness abstraction beyond OpenClaw/mock
- architecture overview as a living map
- 3D Fleet Command Surface extraction into a standalone package

Planned:

- Initiative model
- scoped Decision model
- Context Signals
- Consumption and spend controls
- secrets/configuration strategy
- hosted OpenClaw / remote harnesses
- multi-source fleet aggregation

## Architecture Map

`/architecture` is rendered from `src/lib/architecture/manifest.ts`. Keep that manifest in sync with this document and the roadmap.

## Documentation Contract

See `AGENTS.md`. Product, architecture, roadmap, and decision docs are live system state and must be updated with relevant changes.
