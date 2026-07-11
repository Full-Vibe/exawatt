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
- Electron Terminal Focus and DOM Session Overview for direct xterm control and
  multi-session orientation
- Spatial Operations Board for stable Project-grouped fleet observability,
  semantic zoom, anchored Agent selection, attention scheduling, and visible
  Session handoff; R3F renders top-down and shallow fixed-angle projections over
  one source-agnostic board model
- future packaged or Electron-hosted UI variants

The privileged desktop renderer is local application code packaged in the same
versioned Electron artifact as main/preload (decision `0008`). It must not load
the hosted Exawatt site as its primary renderer or expose PTY preload methods to
remote content. The hosted interface may share source and normalized UI models,
but it is a separate delivery and privilege boundary.

The Electron shell presents Terminal Focus → Session Overview → Spatial Command
as one command-altitude navigation continuum. That shared navigation does not
merge renderer ownership: xterm/DOM and R3F keep separate runtime boundaries and
meet through normalized session/fleet state. UI regimes may render and compose
controls, but they should not translate harness payloads, own provider-specific
state, or bypass typed command boundaries.

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
- `/fleet/spatial` Spatial Operations Board (V2.0 active replacement of the
  superseded immersive 3D composition)
- Electron agent terminal workspace with real `node-pty` sessions rendered by
  xterm.js for Claude Code, Codex, and shells, behind a session-manager boundary
- persisted project-grouped terminal sessions, attention state, keyboard-first
  command flows, split panes, and the exposé session overview
- persistent command-altitude navigation between terminal focus, session
  overview, and Spatial Command, with direct routes, shared shortcuts, existing-
  PTY Agent handoff, and exact semantic board-address return
- `LocalSessionsTransport` normalization of local PTY sessions into the shared
  `FleetState` consumed by the DOM and spatial fleet surfaces
- exact harness conversation identity for Electron tabs: assigned Claude IDs,
  explicit Codex selection fallback, and no-spawn relaunch with exact
  tab/Project/all resume actions
- self-contained Electron packaging, atomic clean-master dogfood installation,
  deep terminal fundamentals, and opt-in native attention notifications
- Developer-ID signing, Apple notarization, private source-linked GitHub
  Releases, public Supabase Storage update artifacts, and explicit
  `electron-updater` restart with live-session impact. Electron 43 includes the
  macOS 26 Squirrel.Mac helper-activation fix; signed `v0.1.2` to `v0.1.3`
  update and automatic relaunch are verified
- roadmap lens (ENG-017): a read-only workspace rail rendering each Project's
  repo-canonical roadmap per the published convention (`@exawatt/core` parser,
  `@exawatt/ui-model` lens view, validated `roadmap:read` IPC in Electron main)

Partial:

- detachable Electron session/process backend; terminal layouts revive after an
  app restart, but the underlying processes do not yet survive it
- source/harness abstraction beyond OpenClaw/mock
- architecture overview as a living map
- Spatial Operations Board extraction into a standalone package

Planned:

- Initiative model
- scoped Decision model
- Context Signals
- Consumption and spend controls
- secrets/configuration strategy
- hosted OpenClaw / remote harnesses
- multi-source fleet aggregation
- Intel/universal desktop artifacts when supported-customer evidence requires
  them; the initial signed channel targets arm64

## Architecture Map

`/architecture` is rendered from `src/lib/architecture/manifest.ts`. Keep that manifest in sync with this document and the roadmap.

## Documentation Contract

See `AGENTS.md`. Product, architecture, roadmap, and decision docs are live system state and must be updated with relevant changes.
