# 0003 Adopt React Three Fiber for 3D Fleet Command

Status: accepted

Date: 2026-06-17

Updated: 2026-06-17

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

Liquid glass, metal, and crystal material language is allowed when it increases readability, hierarchy, and tactile command feel. It must not become decorative spectacle that hides work state.

## Consequences

- `@react-three/fiber` must track the installed React major version.
- The spatial route should be lazy-loaded so `/fleet` does not pay the 3D bundle cost.
- Dense text, chat, forms, approvals, and accessibility-critical controls remain DOM overlays.
- The 3D Fleet Command Surface can later be extracted into a package or Electron entrypoint without changing Agent Source adapters.
- Godot/Helios remains retired unless a future decision record explicitly reverses this decision.
