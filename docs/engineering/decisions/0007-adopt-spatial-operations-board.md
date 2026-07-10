# 0007 Adopt a 2D/2.5D Spatial Operations Board

Status: accepted

Date: 2026-07-10

## Context

ENG-004 proved that Exawatt can render source-agnostic Fleet state with React
Three Fiber, instance large populations, select Projects and Agents, preserve
URL altitude, and park a demand-rendered scene. It did not prove that an
immersive 3D world is the right product metaphor.

Repeated operator review found the V1 composition visually weak and harder to
read than a solid 2D canvas: sparse Projects became tiny islands in empty space,
camera angle made flat objects feel like generic slabs, depth competed with
labels, and decorative world-building did not improve command decisions. A
recovery pass fixed several implementation defects but did not repair the
underlying motif.

The operator wants a stable game-board/map feel inspired by restrained tactical
interfaces and dense canvas tools. Automatic Project organization is required
now. Direct manipulation inspired by RTS maps and desktop icon organization is
valuable later. Agents should remain anchored rather than roam. Fleet altitude
must balance organizational structure with operational health, and selecting an
Agent should visibly continue into its Session workspace.

## Decision

Retain React Three Fiber and Three.js as the spatial rendering infrastructure,
but replace the immersive/free-camera 3D motif with a projection-independent
2D/2.5D Spatial Operations Board.

- Top-down orthographic is the clarity-first default.
- A shallow fixed-angle projection is an alternate presentation over the same
  board coordinates, selection, semantic altitude, and command model.
- Free orbit is removed from the product interaction model.
- Projects occupy deterministic automatic zones. Agents are anchored pieces.
- The square tactical grid is visual substrate only; it does not encode
  movement, territory, capacity, or adjacency semantics.
- Fleet, Project, Agent, and Session are distinct information resolutions.
  Zooming changes the data shown; it does not merely scale one world.
- Agent-to-Session navigation uses a short visible push/handoff, then delegates
  to the existing DOM/xterm workspace without recreating the PTY.
- Dense text, focus order, controls, errors, and accessibility remain DOM-owned.
- Pure board layout, aggregation, and stable addresses remain in
  `@exawatt/ui-model`; R3F owns geometry, picking, camera presentation, and
  finite visual transitions.
- User-authored placement, drawn zones, resize, and persistence are deferred to
  V2.2 and must layer on the automatic layout rather than replace it.

## Consequences

- Decision `0003` remains accepted for technology and architecture boundaries;
  its “3D Fleet Command” representation language is superseded by this record.
- Existing V0–V1 milestones remain evidence and regression history, not the
  visual target.
- The renderer can use depth, lighting, instancing, and shaders where useful,
  but no feature may depend on decorative three-dimensionality to communicate
  essential state.
- Projection switching cannot remount the domain scene or lose camera center,
  selection, focus, filter, URL state, or minimap viewport.
- Aggregation and label budgets are mandatory for long-range fleets. Rendering
  tens of thousands of React nodes or DOM labels is not an accepted scale path.
- The sparse two-Project/three-Agent Live Mode state and the 5–8-Agent Demo state
  remain primary visual acceptance fixtures.
- The Session transition is intentionally modest: preserve continuity and PTY
  identity first; avoid building a cinematic transition subsystem before
  dogfood proves its value.

## Evidence

- ENG-004 V1.0–V1.3.1 implementation and operator screenshots recorded in
  `docs/engineering/projects/spatial-operations-board.md`.
- Map-like spatial grouping recall research archived at
  `docs/research/spatial-memory/map-based-visualization-recall.pdf` with a local
  evidence note beside it.
- Version-pinned rendering constraints in
  `docs/engineering/r3f-authoring-guide.md`.
