# 0003 Adopt React Three Fiber for 3D Fleet Command

Status: accepted

Date: 2026-06-17

Updated: 2026-07-10

## Context

Exawatt needs a spatial, game-like command interface for managing agent fleets, while preserving the source-agnostic three-layer architecture.

The retired Helios/Godot direction should not return as active architecture. The current app already uses React and Next.js for the UI layer, and the fleet provider exposes normalized Exawatt state to React surfaces.

## Decision

Use Three.js through React Three Fiber for the first 3D Fleet Command Surface.

The first route is `/fleet/spatial`. It is a UI-layer regime alongside `/fleet`, not a separate product architecture.

The shared fleet view models and command contracts live outside React Three Fiber in a pure TypeScript boundary. Three.js and R3F code must not translate provider payloads or own source-specific state.

The durable design direction is not a decorative orb, planet, or constellation scene. The surface should become an observability-first 2.5D operational command UI grouped by Project / Context Group, with a future zoom-resolution model:

- high altitude: semantic fleet clusters
- medium altitude: readable Project surfaces
- low altitude: Agent inspection

The zoom-resolution model is a durable representation boundary, not merely a
camera-distance suggestion:

- Fleet may use the scalable AgentField instanced cluster map and aggregate
  agent marks.
- Project must replace aggregate marks with readable, named agent units on a
  bounded 2.5D work surface.
- Agent must provide a focused unit/inspection state whose dense text and
  actions remain DOM.

Spatial continuity comes from stable identities, shared layout data, URL state,
and camera transitions. It does not require keeping the same geometry visible at
every altitude.

Liquid glass, metal, and crystal material language is allowed when it increases readability, hierarchy, and tactile command feel. It must not become decorative spectacle that hides work state.

## Consequences

- `@react-three/fiber` must track the installed React major version.
- The spatial route should be lazy-loaded so `/fleet` does not pay the 3D bundle cost.
- Dense text, chat, forms, approvals, and accessibility-critical controls remain DOM overlays.
- Every Project or Agent selectable through a mesh must have a focusable DOM
  equivalent. Screen-aligned readable text stays DOM; WebGL text is limited to
  decorative/nonessential use.
- Demand-rendered scenes must park after finite state transitions. Continuous
  decorative CPU animation and eager postprocessing are not acceptable defaults.
- The 3D Fleet Command Surface can later be extracted into a package or Electron entrypoint without changing Agent Source adapters.
- Godot/Helios remains retired unless a future decision record explicitly reverses this decision.

## 2026-07-10 clarification

V1.0 temporarily rendered one persistent AgentField constellation at Fleet,
Project, and Agent altitudes. That implementation was useful evidence for
scalable picking and layout, but it contradicted this decision's information-
resolution model and produced anonymous enlarged marks in the flagship small-
fleet case. ENG-004 V1.3 supersedes that representation choice while preserving
the AgentField as the Fleet-altitude implementation.
