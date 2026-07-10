# Spatial Operations Board

Roadmap item: ENG-004

The Spatial Operations Board is Exawatt's game-like command regime for understanding and operating agent teams across Projects and Initiatives. It uses React Three Fiber as scalable rendering infrastructure while presenting a restrained 2D/2.5D map rather than an immersive 3D world.

It lives in the UI layer over the same source-agnostic view models and command contracts as the DOM fleet UI. The DOM fleet UI remains a sibling and fallback for dense text, forms, chat, exact controls, and accessibility-critical flows.

This plan is canonical but malleable. Forthcoming agents should advance it milestone by milestone, update status as work lands, and challenge stale assumptions instead of blindly extending the last implementation.

## Product Role

The surface should help operators manage individual agents more effectively than low-level harness UIs, understand work grouped by Project / Context Group, and reduce the human cost of context switching.

The first serious demo should optimize for 5-8 agents across a few Projects. It should feel like a real product surface driven by Demo Mode, not a toy demo built separately from the application.

Current direction (operator, 2026-07-10): repeated review rejected the V1
free-camera constellation/tabletop motif even after its sparse-fleet recovery.
V2.0 replaces it with a stable tactical board that borrows the solidity of map
and canvas tools: automatic Project zones, anchored Agent pieces, semantic
aggregation, a minimap, strong selection, and top-down/fixed-angle projections
over one coordinate system. Session entry should visibly push through the
selected Agent into the existing terminal workspace, then reverse to the same
board address. The transition must feel quick and coherent without becoming a
bespoke cinematic system.

V0–V1 records below remain as implementation history and evidence. They are not
permission to reintroduce floating islands, orbit controls, planet-like marks,
decorative rooms, oversized workstations, or material spectacle.

## V2.0 Design Brief: Spatial Operations Board

### Outcome and operator job

The board should let an operator answer, in a few seconds:

1. Which Initiative or Project needs attention?
2. How much work is active, blocked, reviewing, or idle there?
3. Which Agent should I inspect?
4. How do I enter that Agent's live Session without losing where it lived?

The flagship state remains 5–8 Agents across a few Projects, but the information
model must aggregate cleanly toward tens of thousands. The small fleet must feel
intentional and substantial; the large fleet must become more summarized rather
than merely smaller.

### Evidence and product hypothesis

- Map-like grouping and stable spatial addresses can improve recall of where
  information lives. Preserve deterministic placement across state-only updates
  and treat large layout churn as a navigational regression. Source artifact:
  `docs/research/spatial-memory/map-based-visualization-recall.pdf`.
- Orthographic presentation keeps apparent object size independent of depth and
  supports a readable 2D board while retaining R3F/Three.js rendering.
- Instancing and instance-aware picking remain the long-range rendering path;
  React elements and DOM labels are budgeted by visible semantic importance.
- Tiles are a visual substrate in V2.0. They do not represent legal movement,
  capacity, adjacency, ownership, or scheduling rules. Do not let visual grid
  geometry silently become product semantics.

### Visual grammar

- **Board:** dark, head-on tactical canvas with a quiet square grid, stronger
  major lines, bounded content, and restrained texture. Empty space supports
  scanning but never dominates the composed fleet.
- **Project zone:** stable rectilinear or softly irregular footprint with one
  clear label rail, aggregate status, and compact Agent placement. Zone color is
  identity; status color remains semantic and scarce.
- **Agent piece:** anchored compact token with a strong silhouette, status mark,
  selection outline, and optional short label. No autonomous travel or ambient
  wandering.
- **Attention:** one highest-leverage item may receive the strongest contrast;
  stable blocked state remains readable without perpetual pulsing.
- **Chrome:** projection switcher, minimap, zoom/recenter controls, breadcrumbs,
  filtering, and keyboard hints form one precise tool cluster. Avoid floating
  decorative cards and redundant inspector chrome.
- **Depth:** top-down is the clarity-first default. Fixed-angle adds shallow tile
  thickness, contact shadow, and selection lift without changing coordinates,
  hit targets, labels, or available commands. Free orbit is prohibited.

### Semantic altitude contract

| Altitude | Primary objects | Required information | Deliberately hidden |
| --- | --- | --- | --- |
| Fleet | Initiatives/Projects | name, Agent count, health mix, attention pressure, activity, consumption when available | most Agent names and Session detail |
| Project | one Project zone and anchored Agents | Agent identity, status, concise current goal/activity, attention ranking | long transcripts and provider payloads |
| Agent | selected Agent in spatial context | full identity, status, Session target, concise operational summary | duplicated terminal content |
| Session | existing terminal workspace | live harness interaction, transcript/TUI, Session actions | board geometry after handoff completes |

Semantic altitude is a data-resolution decision, not a scale transform. At Fleet
altitude, large populations collapse into meaningful Initiative/Project counts
and health composition. Labels appear only when their projected space and
priority budget allow them to remain legible.

### Automatic layout contract

- A pure TypeScript layout engine in `@exawatt/ui-model` owns stable board
  coordinates, Project bounds, Agent slots, aggregate placement, minimap bounds,
  and camera-fit targets. It does not import React or Three.js.
- Stable entity IDs and a versioned layout policy produce deterministic output.
  Status, activity, selection, filtering, and arrival order must not reshuffle
  surviving Projects or Agents.
- Initial placement balances compactness, label room, health/attention priority,
  and predictable scan order. It must handle 0, 1, 2, 3, 6, and many Projects
  without ring minimums or pathological voids.
- Filtered and newly arrived entities occupy deterministic slots; they do not
  force unrelated zones to teleport during routine live updates.
- V2.0 exposes no direct manipulation. V2.2 may layer persisted user overrides,
  drawing, resizing, and reset-to-automatic behavior on this automatic baseline.

### Interaction and navigation contract

- Click/tap, focus + Enter, search result selection, and programmatic commands
  converge on the same typed selection/altitude actions.
- Selection acknowledges within 80ms. Hover and focus never require React state
  updates at raw pointer frequency.
- Wheel/pinch and keyboard zoom move through bounded semantic thresholds. Pan is
  clamped to useful board bounds. Recenter fits current semantic content.
- Projection switching preserves board center, zoom intent, selection, focus,
  filter, URL state, and minimap viewport. It is a presentation preference, not
  a separate scene or product mode.
- Selecting an Agent first establishes Agent altitude. Opening its Session runs
  one short visible camera push toward that piece, fades spatial labels/chrome,
  then hands off to `/workspace` without restarting the PTY. Return restores the
  same Project, Agent, projection, and camera address.
- Reduced motion replaces the push with a brief opacity handoff while preserving
  state and focus. Route failure restores the board and reports a DOM error.

### State matrix

- **Empty:** teach how Agents appear and provide a real path to launch or Demo.
- **Loading:** show stable chrome and a board-shaped skeleton; do not mount an
  indefinite spinner over a blank canvas.
- **Sparse Live:** preserve the rejected two-Project/three-Agent fixture as the
  primary regression case.
- **Small Demo:** 5–8 Agents across roughly three Projects is the flagship look.
- **Medium/Large:** aggregate names progressively and keep Project drill viable.
- **Attention:** blocker/approval reason is available in DOM and one hero item
  is visually dominant without washing an entire zone red.
- **Filtered:** retain surviving spatial addresses and offer a clear-filter DOM
  action when nothing remains.
- **WebGL failure:** explain the failure and link to the DOM fleet surface.
- **Narrow/touch:** preserve selection, semantic zoom, minimap, and Session entry;
  touch targets are at least 44 CSS pixels.
- **Low power/reduced motion:** identical information and commands; static depth,
  capped DPR, no postprocessing dependency, finite or instant transitions.

### Technical ownership boundaries

- `@exawatt/core`: canonical source-agnostic domain state only.
- `@exawatt/ui-model`: deterministic grouping, aggregation, attention ranking,
  board layout, projection-independent addresses, semantic thresholds, and typed
  commands.
- R3F/Three.js: grid, zone/piece geometry, instancing, picking, authored camera
  poses, finite state transitions, and projection rendering.
- DOM/React: all readable labels, focus order, filters, breadcrumbs, inspector,
  controls, live regions, errors, and Session handoff accessibility.
- Electron/workspace: PTY lifecycle and terminal preservation. The spatial route
  may navigate to Sessions but may not own or recreate them.

### Performance and accessibility budgets

- 60fps target during ordinary pan/zoom/projection transitions on the reference
  desktop; record median and p95 on the full route.
- First input acknowledgment begins within 80ms; ordinary control transitions
  settle in roughly 200–350ms. Session handoff may be slightly longer only when
  it preserves continuity without delaying terminal usability.
- Demand rendering parks at zero new frames during a settled one-second sample.
- DPR remains capped in `[1, 2]` and lower in low-power mode. Postprocessing is
  optional, lazy, and never required for state legibility.
- No one-React-component-per-Agent or one-DOM-label-per-Agent design at scale.
  V2.0 verifies architectural aggregation; V2.1 establishes 1k/10k/higher
  measured budgets.
- Every WebGL-selectable Project and Agent has a focusable DOM equivalent.
  Keyboard descent/ascent, visible focus, live-region altitude announcements,
  reduced-motion parity, contrast, and touch targets are release gates.

### Phase plan and check gates

1. **B0 Canon, decision, evidence, baseline:** update roadmap/project/marketing,
   add decision `0007`, archive cited research, preserve rejected sparse fixture,
   and capture current screenshots/runtime/bundle baseline. Check: docs links,
   repository cleanliness, baseline evaluators. Push before implementation.
2. **B1 Board model:** implement projection-independent deterministic Project
   zones, anchored Agent slots, aggregation/label budgets, semantic thresholds,
   minimap bounds, and pure fixtures. Check: unit/property-style coverage for
   empty/sparse/small/medium/large, stability under status/filter/order changes,
   type/lint/tests. Push independently.
3. **B2 Top-down board:** replace the free-camera world with orthographic grid,
   Project zones, Agent pieces, screen-aligned DOM labels, selection, attention,
   and content-bounded camera fit. Check: R3F evaluator, desktop/mobile/reduced/
   low-power screenshots, WebGL console, idle frames, keyboard parity. Push.
4. **B3 Projection and board tools:** add fixed-angle view over the same model,
   projection switcher, minimap viewport, zoom/recenter, empty/error/loading and
   long-name states. Check: state preservation across projection switches,
   interaction latency, visual comparison, full focused tests. Push.
5. **B4 Session continuum:** add Agent-to-Session push/handoff and reverse return
   using existing navigation and PTY lifecycle. Check: real Electron shortcut/
   click round trip, PTY identity and output survival, reduced motion, failed
   navigation recovery, return address. Push.
6. **B5 Release reconciliation:** run full type/lint/tests/build, both R3F and
   spatial route evaluators, Electron navigation, performance samples, a11y and
   screenshot rubric. Update roadmap/project/decision with evidence and unresolved
   hypotheses; only then mark V2.0 landed and consider V2.1/V2.2.

### V2.0 non-goals

- No user-authored dragging, zone drawing/resizing, or layout persistence.
- No movement simulation, adjacency rules, tile capacity, or Agent wandering.
- No new Agent Source, terminal, chat, orchestration, or command semantics.
- No cinematic engine, texture pipeline, custom shader suite, or premature 10k
  optimization that delays proving the board and Session continuum.
- No default-view decision until dogfood evidence supports V2.3.

## Preserved Constraints

Useful prior planning still stands:

- the surface lives in the UI layer
- it consumes source-agnostic Exawatt view models and command contracts
- it must not import OpenClaw, Codex, Claude Code, or other harness protocol payloads directly
- it shares Demo Mode and Live Mode behavior with the DOM fleet UI
- it preserves DOM overlays for text-heavy interactions, chat, forms, approvals, and accessible controls
- it should be package-ready, but extraction should happen only after the shared UI-model API stabilizes
- it should show fleet health, agent state, blockers, consumption, activity, cost, heartbeat signals, selected-agent inspection, and links back to existing focus/control flows
- motion should communicate state changes, not decoration
- reduced-motion users should receive a stable layout without camera sweeps or particle-heavy transitions

## Interaction Priority

Version 1 is observability-first.

It should support selecting Projects and Agents, understanding state, opening the existing focus route, and resolving the most important blocker through existing flows. Direct manipulation such as drag-to-reassign, work redistribution, or complex spatial editing is deliberately deferred until the product semantics are clearer.

## Historical V0–V1 Visual Direction (Superseded)

This section records the material direction that produced the V0–V1 evidence.
V2.0's visual grammar above is authoritative. Do not use the allowed-material
list below to override the restrained board direction.

The surface should be gorgeous, tactile, and operational.

Allowed material language:

- liquid glass panels and lenses
- dark metal frames and rails
- crystal-like Project boundaries
- refractive selected states
- shallow 2.5D depth
- smooth game-menu camera motion

Non-goals:

- planets, orbs, or celestial bodies as the primary agent representation
- decorative star maps
- sci-fi clutter that hides state
- red-alert overload
- 3D spectacle that reduces readability

Material beauty should make the command surface more legible, tactile, and memorable. It should not ask the operator to decode a decorative scene.

## Historical V0–V1 Zoom-Resolution Model

The constellation idea is valid only as a high-altitude overview, not as the primary object model.

### Altitude 3: Fleet Map

Projects / Context Groups appear as semantic clusters. Agent count, health, attention pressure, and consumption are visible at a glance. Cluster boundaries may use glass or crystal material language.

### Altitude 2: Project Surface

A selected Project becomes a shallow 2.5D work surface. Agents become readable tiles arranged by status, activity, and attention pressure.

### Altitude 1: Agent Focus

One Agent becomes an inspection surface with goal, recent activity, blocker state, heartbeat signal, cost, and links into the existing focus route.

## Historical V1.3 Design Brief: Semantic Regimes & Feel Recovery

### Feature summary

The spatial route is a game-like command regime for technical operators and
early evaluators managing a typical 5-8 agents, while remaining architecturally
ready for larger fleets. Fleet altitude answers "where does attention go?";
Project altitude answers "what is each agent doing?"; Agent altitude answers
"what can I understand or do next?" without forcing users to decode enlarged
dots.

### Primary user action

Identify the highest-leverage Project or blocker, descend to a named Agent with
one confident gesture, and reach its existing focus/clear workflow without
losing spatial orientation.

### Design direction

Commanding, lucid, kinetic. Fleet altitude is an RTS command map with restrained
status color and high information compression. Project/Agent altitudes are a
shallow, tactile operations table: dark metal chassis, restrained crystal or
glass boundaries, physical edge highlights, contact grounding, and status light
as a signal rather than a fully emissive object. Avoid decorative star-map
links, anonymous glowing diamonds at small scale, excessive bloom, generic
glass-card stacking, and motion that continues without a state reason.

### Layout strategy

- **Fleet:** retain the scalable instanced cluster overview. Projects are the
  primary selectable objects; agents are aggregate marks, not individually
  decoded units. One hero blocker receives the strongest contrast.
- **Project:** replace the overview marks with named, beveled agent units on one
  bounded 2.5D deck. Arrange units by stable identity, then use elevation,
  status light, and concise DOM labels for attention and activity. The selected
  Project owns the visual field; neighboring Projects recede rather than remain
  clipped at the edges.
- **Agent:** focus one unit/station and let the existing DOM inspector carry
  goal, cost, activity, blocker explanation, and actions. The world provides
  orientation and selection confirmation, not duplicate paragraphs.
- **Chrome:** keep fleet metrics and breadcrumb orientation. Remove internal
  gallery promotion from the primary demo path. Reveal only regime-relevant
  shortcuts; detailed controls remain discoverable through existing shortcut
  help.

### Key states

- Small Demo fleet (5-8 agents / roughly 3 Projects): flagship acceptance state.
- Medium and large Demo fleets: Fleet remains instanced; Project uses readable
  units up to its declared threshold and a stable density fallback beyond it.
- Empty/filter result: plain-language recovery with a DOM control to clear the
  filter.
- Loading/font/effects delay: useful world and DOM controls appear without
  waiting for postprocessing or remote assets.
- Blocked/error/activity change: finite, state-triggered emphasis that settles.
- Reduced motion: instant camera/selection state, no pulsing/spinning, identical
  information and controls.
- Low power: capped DPR, no postprocessing, static material hierarchy.
- WebGL failure: DOM route/chrome provides a recovery path to `/fleet`.
- Narrow/touch: preserve selection and ascent; controls meet 44px touch targets;
  secondary chrome compacts rather than hiding critical actions.

### Interaction model

- Pointer, keyboard, and programmatic camera movement share one velocity model:
  damped acceleration/deceleration, clamped delta, no tap kick, and a restrained
  2.5D orbit band that cannot make labels unreadable.
- Selection acknowledges locally within 80ms, then synchronizes URL state; URL
  remains the durable/deep-linkable source after navigation settles.
- Fleet Project controls and Project Agent controls are real DOM buttons aligned
  to the world. Mesh picking mirrors them; it is never the only path.
- Search/filter operations preserve surviving object identity and camera target.
  They do not remount the world or replay deployment.
- Motion is finite and semantic: regime transition, hover/focus settle, new
  activity, and blocker-state change. Stable blocked state is conveyed by static
  hierarchy, not perpetual CPU animation.

### Content requirements

- Fleet Project control: Project name, agent count, blocked count, and rate when
  available.
- Project Agent control: Agent name, status, and one concise goal/activity line
  when space permits.
- Agent inspector: existing goal, cost, turns, blocker title/reason, Focus, and
  Clear flows; do not duplicate these inside WebGL.
- Use canonical terms Project / Context Group, Agent, Attention, and Activity;
  reserve "sector" for optional game-flavor hints rather than primary semantics.

### Performance and quality budgets

- First selection/hover acknowledgment begins within 80ms.
- Target 60fps / 16.7ms p95 during camera and hover motion on the reference
  desktop at small and medium Demo scales; record rather than assume full-route
  frame time. Large-scale budget is established in V1.4.
- After finite transitions settle, no component may self-invalidate solely for
  decorative motion; an idle one-second sample should render zero new frames.
- No React state updates at raw pointer-move frequency.
- Postprocessing is code-split and omitted for low-power mode. DPR stays capped
  in `[1, 2]`, with a lower low-power ceiling.
- WebGL/shader console errors are hard failures. Text overlap, clipped framing,
  unreadable foreshortening, bloom blowout, and blank frames fail visual QA.
- WCAG AA text/focus contrast, complete keyboard traversal, reduced-motion
  parity, and focusable DOM mirrors are release gates.

### Ownership boundaries

- `@exawatt/ui-model` owns source-agnostic grouping, attention, and stable layout
  data; it does not own Three.js objects or animation state.
- R3F owns scalable geometry, shallow physical depth, camera, and finite visual
  state transitions.
- DOM owns all readable text, focus order, keyboard-accessible selection,
  filters, breadcrumbs, inspector actions, loading/error recovery, and help.
- Demo Mode and live sources enter through the same provider/selectors; no
  demo-only rendering path.

### Delivery sequence

1. **S0 Canon and baseline:** land this brief/roadmap/ADR; capture current full-
   route screenshots, runtime errors, frame cadence, and bundle boundary.
2. **S1 Feel and render correctness:** velocity camera, optimistic selection,
   imperative tooltip, stable keys/animation state, finite attention/focus
   motion, lazy/gated effects, label/cursor hover correctness.
3. **S2 Regime greyboxes:** build Project and Agent representations in the HUD
   gallery with solid materials and DOM controls; verify framing and interaction
   before integration.
4. **S3 Tactile integration:** integrate regimes into `/fleet/spatial`; add
   restrained lighting/materials, responsive chrome, accessible traversal, and
   empty/error/reduced/low-power states.
5. **S4 Verification and polish:** full S/M/L interaction battery, type/lint/
   tests/build/eval, screenshot rubric at desktop/mobile and every altitude,
   before/after performance evidence, then update canonical status/progress.

### Explicit non-goals

- No drag-to-reassign, spatial editing, chat, or new command semantics.
- No provider-specific payloads in the UI and no Demo-only component tree.
- No revival of retired Console 3D modules, Godot, or Helios.
- No 1k-10k optimization that weakens the 5-8-agent experience; that resumes in
  V1.4 behind the preserved Fleet abstraction.
- No attempt to merge the terminal workspace and map/expose regimes in this
  milestone.

### References for implementation

- `.impeccable.md` for audience and commanding/lucid/kinetic character.
- `docs/engineering/r3f-authoring-guide.md` for pinned APIs, demand rendering,
  materials/bloom, reduced motion, and screenshot verification.
- Decision `0003` for the DOM/WebGL and semantic-zoom boundary.

### Open questions

- Whether exposé eventually becomes the transition between Project and Agent
  remains intentionally open and does not block V1.3.
- Large-project density threshold and the V1.4 reference-device budget are
  hypotheses to set from measured V1.3 evidence, not guesses embedded now.

## Attention Scheduling

Attention Scheduling is a first-class product idea and should shape this surface.

The interface should make operator cognition cheap to spend: one hero blocker may lift into an attention lane, related blockers should group tastefully, and routine activity should remain visible without screaming for attention.

## Milestones

### V0.1 Correct the Metaphor

Status: landed

Scope:

- replace the orb/planet layout with readable flat or beveled agent tiles
- group visible work by Project while keeping the model future-ready for Context Groups
- add an operator attention lane with one hero blocker
- keep the DOM inspector and existing focus routes

Acceptance criteria:

- no agent is represented as a planet, sphere, or celestial object
- a first-time evaluator can identify Projects, Agents, and the highest-leverage attention item without explanation
- the surface still uses the same UI model as the DOM fleet UI

Progress log:

- Adopted the "command table" metaphor: a fixed dimetric war table of coplanar frosted-glass Project zones, each holding flat beveled agent tiles, with one hero blocker lifted onto a front attention rail. The orb/orbital-ring layout (`selectSpatialAgentLayout`) is retired.
- Introduced **Project / Context Group** as a real entity in `@exawatt/core` (`types/project.ts`, `state/context-groups.ts`'s `resolveContextGroups`). It is a **resolvable grouping lens** derived from `state.agents` — never stored on `FleetState` and never a structural parent of Agent — so the planned Initiative→Agent hierarchy stays orthogonal.
- Demo fleet re-grouped from 8 single-agent "Demo Project A–H" into 3 named Projects (Exawatt Demo Polish, OpenClaw Local Parity, Investor Pipeline Research) so clustering reads; Gamma seeded as a deterministic hero blocker.
- New pure-TS `@exawatt/ui-model` selectors: `selectSpatialProjectZones`, `selectSpatialAgentTiles`, `selectSpatialAttention`, `selectFleetSpatialScene` (all layout math; no React/Three). Attention selectors (hero / secondary / ambient) landed early — testable in pure TS per V0.4.
- R3F surface rewritten under `src/components/fleet/spatial/command-table/` with a swappable dimetric camera rig, selective real glass (≤2 transmissive surfaces, 1 at rest), `prefers-reduced-motion` support, and the DOM inspector + focus routes preserved.
- **Consolidated (2026-06-20) to a SINGLE surface — Console 3D** (WebGL 2.5D, locked CSS-pixel-orthographic camera so cards never occlude; glowing tier-colored frames + gated bloom; crisp pixel-aligned DOM text overlay). Screenshot-verified via Playwright at fleet / project / agent / mobile. Removed the four R3F war-table styles (Dark glass / Blueprint / Bento / Holo — they rendered an oversized hero card overlapping tilted, tiny Project zones), the redundant Command + Console DOM surfaces, and the multi-style switcher. Console 3D fills the viewport, lists each Project's agents as rows + a health track, and uses a distinct Activity feed (not a duplicate blocker list). (Supersedes the earlier multi-style / Command-default notes in this log.)
- Doc contract updated: `Project / Context Group` added to `architecture.md` and the `manifest.ts` object model.
- Adversarial review pass (multi-agent) found and fixed issues the unit tests could not catch: a P1 where drei `PerformanceMonitor` under `frameloop="demand"` sampled cold-idle gaps as ~0fps and latched the surface into all-frosted (0 transmission) — replaced with a one-shot hardware hint; attention-rail layout math moved out of R3F into `@exawatt/ui-model` (heroLink now references the emitted hero-card position, so the glow line cannot drift); `selectOperatorQueue` given a stable id tiebreak for deterministic hero election; `resolveTransmission` made pure and unit-tested (≤2 / 1-at-rest cap matrix); `<Environment preset="city">` (runtime CDN HDR) replaced with a procedural `<Lightformer>` environment + canvas error boundary for offline/Electron; the hand-rolled rAF camera pump removed in favour of drei `CameraControls`' own demand-mode invalidation. Reduced motion keeps static glass (refraction is not motion); only low-power hardware drops to frosted. Test count 146 → 152.
- Pending before marking done: visual QA pass in demo mode (camera framing, procedural-environment reflection look, in-scene label orientation are reasoned but not yet eyeballed), then the V0.2 material/motion polish. CLOSED 2026-07-01: self-serve Playwright screenshot QA is standing practice; the surface these gates described was superseded by the V1.0 AgentField world (V0.x model/selector work carries forward unchanged).

### V0.2 Gorgeous 2.5D Command Surface

Status: landed

Scope:

- introduce the liquid glass / metal / crystal material system
- add selected Project and Agent lift states
- add tasteful activity and attention motion
- preserve reduced-motion behavior

Acceptance criteria:

- the surface feels premium and tactile without reducing readability
- motion explains selection, activity, and attention changes
- desktop and mobile screenshots show no overlapping text or unusable controls

Progress log:

- Material system: brushed dark-metal zone frames + table-edge molding + hero card bezel (`MetalMaterial`); crystalline Project boundaries faked with drei `<Edges>` + a soft inner halo line (no transmission); deepened `LiquidGlassMaterial` and a polished `FrostedMaterial`. The `resolveTransmission` cap is unchanged — metal/crystal are non-transmissive fakes, so the surface still holds ≤2 live transmissive surfaces (1 at rest).
- Lift/emphasis states are emitted by the pure `@exawatt/ui-model` selectors (`SpatialAgentTile.restY/liftTarget/targetScale/emphasisTarget`; `SpatialProjectZone.liftTarget/edgeEmphasisTarget/frameEmissiveTarget` with a passive recede on non-selected zones). R3F only damps current → target; no magnitudes are hardcoded in components.
- Motion driver under `frameloop="demand"`: transient lift/scale/emissive transitions damp via `THREE.MathUtils.damp`, self-invalidating while moving and settling to true cold idle; ambient motion (active-agent emissive breathing + hero shimmer) is state-gated (`ambient = !reducedMotion && !lowPower && (anyActive || hero)`) and stops the loop when work/attention ends. Reduced motion makes transitions instant and disables all ambient motion; layout is identical.
- In-scene labels now use Exo 2, vendored to `public/fonts/Exo2-Medium.ttf` (troika needs a real font-file URL; woff2/next-font CSS var do not work) via `command-table/typography.ts`.
- Responsive pass: fluid mobile canvas height, a non-overlapping metric overlay, and aspect-aware camera framing that widens on portrait so zones + the front attention rail stay in view; touch can't pan/zoom (controls locked), tap-to-select works.
- R3F surface (now the sole Console 3D surface) renders metrics, the hero attention band, Project panels (agent rows + health tracks), and Agent cards via WebGL under a locked pixel-orthographic camera, with crisp pixel-aligned DOM text and glowing tier frames + bloom — readable card grid, no occlusion.
- Pending before marking done: visual QA in a browser (material look, motion feel, mobile framing, label legibility) and a tier-color cross-fade (currently rim color changes instantly on tier transitions; intensity/opacity already damp). CLOSED 2026-07-01: self-serve Playwright screenshot QA is standing practice; the surface these gates described was superseded by the V1.0 AgentField world (V0.x model/selector work carries forward unchanged).

### V0.3 Zoom-Resolution Model

Status: landed

Scope:

- add fleet, Project, and Agent altitude states
- use high-altitude clustering for fleet-scale overview
- transition into readable Project surfaces and Agent inspection

Acceptance criteria:

- zoom level changes information density rather than merely scaling the same scene
- URL or UI state tracks selected altitude, Project, and Agent where practical

Progress log:

- Three altitudes in the pure selector (`FleetSpatialScene.altitude` + `FleetSpatialSceneOptions.altitude`/`focusedProjectId`): **fleet** renders every Project as a compact summary cluster (metal frame + label + stat line + a 3-segment active/blocked/idle status histogram) and emits **no agent tiles** — this is the density reduction, not a scale change; **project** renders only the focused Project, re-centered to the origin, with its full agent tiles; **agent** centers the focused agent's Project, lifts the agent, and hides the 3D attention rail so the DOM inspector takes over. The selector gracefully ascends to fleet if a focus target is stale.
- Information density genuinely changes per altitude (summary histogram vs. full tiles vs. single-agent focus), satisfying "not merely scaling".
- URL state tracks altitude + Project + Agent (`?altitude=&project=&agent=`); the surface is deep-linkable and reconstructs altitude on load. Navigation: click a Project zone → project altitude; click a tile / hero card → agent altitude; a DOM breadcrumb (Fleet › Project › Agent), the Escape key, and clicking empty space each ascend one level.
- Camera flights reuse the V0.1/V0.2 rig: it reframes on `scene.bounds` change (fleet ↔ project) and dollies tighter at agent altitude; instant under reduced motion.
- `selectFleetSpatialScene` now DEFAULTS to fleet altitude, so the landing view is the Fleet Map (summary clusters); existing selector tests that needed agent tiles were moved to project altitude, and new altitude tests were added (24 ui-model tests).
- Deviation: at agent altitude `bounds` is the focused-zone footprint (not a tile-tight box); the rig's `moveTo` + tighter dolly provides the close agent framing instead. Pending before marking done: visual QA of the altitude transitions in a browser. CLOSED 2026-07-01: self-serve Playwright screenshot QA is standing practice; the surface these gates described was superseded by the V1.0 AgentField world (V0.x model/selector work carries forward unchanged).

### V0.4 Attention Scheduling

Status: landed

Scope:

- promote attention queue / lane data into `@exawatt/ui-model`
- distinguish hero attention, secondary attention, and ambient activity
- document Attention Scheduling in product and marketing canon

Acceptance criteria:

- the demo shows why human attention matters without becoming a wall of red blockers
- attention state is testable in pure TypeScript selectors

Progress log:

- Added a leverage-aware `selectAttentionSchedule(state, { now?, limit? })` to `@exawatt/ui-model`: a pure, deterministic ranking of blocked agents by `score = typeWeight*1000 + ageMinutes + stalledInProject*10` (credentials/approval/error outrank input/awaiting), tiebroken by oldest blocker then agent id. Each `AttentionItem` carries `score`, `ageMinutes`, `stalledInProject`, and a human `reason` ("Credentials needed · 50m waiting · 2 stalled in <Project>"). `now` is an input, not `Date.now()`, so the selector stays pure/testable.
- The hero (and `heroAgentId`) is now the top of the Attention Schedule, not the raw oldest blocker; `SpatialAttentionItem` carries `reason`. The seeded demo hero (Gamma, credentials) is unchanged because credentials is the highest-weight type.
- Both surfaces share one model: `selectFleetCommandView.nextBlockedAgentId` (the DOM `/fleet` "Clear Blocker" target) now also comes from the Attention Schedule, so the DOM board and the spatial surface agree on the highest-leverage blocker. `selectOperatorQueue` remains for the raw blocked list.
- Fixed the V0.3 follow-up: tile `isHero` lift is now altitude-scoped — `selectFleetSpatialScene` passes the focused Project's hero into `selectSpatialAgentTiles` at project/agent altitude, so the lifted tile, the rail hero card, and the glow line always reference the same agent.
- Surfaced the "why": the 3D hero card shows a third reason line, and the DOM Signals panel shows the reason under the hero + secondary blockers. The client threads `now` (Date.now()) into the scene so age advances as fleet state ticks.
- Documented Attention Scheduling's leverage scoring in `concepts.md` and `marketing.md`.
- Pending before marking done: visual QA of the reason copy + hero card layout in a browser. CLOSED 2026-07-01: self-serve Playwright screenshot QA is standing practice; the surface these gates described was superseded by the V1.0 AgentField world (V0.x model/selector work carries forward unchanged).

### V0.5 Fleet-Scale Readiness

Status: landed

Scope:

- aggregate dozens to hundreds of agents into semantic clusters
- prepare later density clustering for thousands of agents
- add search, filters, summarization, and progressive disclosure as needed

Acceptance criteria:

- the same route can degrade from 5-8 demo agents to many live agents without a new architecture
- cluster density and information hierarchy remain understandable at high altitude

Progress log:

- Configurable demo fleet size (`MockFleetTransport.setScale` + a Small/Medium/Large control in DemoControls): `small` keeps the 8 hand-authored agents (default, so all prior tests/behavior are unchanged); `medium` ~40 and `large` 150 synthetic agents spread across ~10 Projects, reseeded and re-emitted live. The 8 base agents (incl. Gamma, the credentials hero) are always present, so a stable hero exists at every scale; the large fleet concentrates ~1/3 of agents into the lead Project so drilling it exercises the instanced path.
- High-altitude clustering at scale: `selectSpatialProjectZones` / `selectFleetSpatialScene` take `maxZones` (default 24) and, at fleet altitude, render the top-N Projects (by attention pressure, then agent count, then label) as full summary clusters and fold the rest into a single non-drillable "+N quieter projects" aggregate cluster with summed counts (`SpatialProjectZone.isAggregate`). Keeps the Fleet Map legible with many Projects without a new architecture.
- Progressive disclosure at project altitude: below 48 tiles the rich per-mesh `AgentTile` path (full materials + motion) is used; at/above it the agent layer switches to a single instanced draw call (`InstancedAgentField`) with per-instance status color and labels dropped, while the selected/hero tiles stay rich on top. Pure render-strategy switch keyed on tile count — the scene model is unchanged.
- Search + status filter: a pure `filterFleetState(state, { query?, statuses? })` selector (empty = identity) narrows the fleet before the scene is built; a search input + status chips live in the spatial nav. Fleet-wide metrics stay unfiltered.
- Pending before marking done: visual QA at scale (instanced field legibility, aggregate cluster styling, search/filter UX) in a browser, and perf profiling of the medium/large fleets. CLOSED 2026-07-01: self-serve Playwright screenshot QA is standing practice; the surface these gates described was superseded by the V1.0 AgentField world (V0.x model/selector work carries forward unchanged).

### V1.0 AgentField Command Surface

Status: landed (visual QA'd)

Scope:

- replace the Console 3D surface with the canonical AgentField WebGL world
  (Tactical Clusters — the operator-selected direction from the fidelity
  bake-off) under the existing DOM chrome
- keep the URL-driven altitude model, Attention Scheduling, search/filters,
  and the selected-agent/activity side panel unchanged

Progress log:

- The world (`src/components/hud/webgl/agent-field.tsx`) renders the WHOLE
  (filtered) fleet at every altitude — altitude now only moves the camera
  (fly-to via an imperative `AgentFieldHandle`). One InstancedMesh of status
  nodes + one of additive halos → draw calls stay constant to 10k+ agents.
- Pure geometry extracted as `layoutClusteredField(groups)`; the surface maps
  `selectSpatialProjectZones` output (+ per-agent status from the filtered
  `FleetState`) into it. Zones and agent lists are sorted by stable ids so a
  live status tick re-colors nodes IN PLACE instead of teleporting them; the
  deploy entrance and ring fades are keyed to mounts, never data ticks.
- The red hull = the zone owning the hero blocker (`ownsHeroBlocker`), so the
  map and the DOM board agree on where a commander goes next. Node size
  encodes importance; blocked/error nodes pulse (reduced-motion gated).
- Sector labels wrap (real project names are long), scale with cluster radius,
  and fade camera-aware (near-sector + deep-zoom) so they never wall over a
  zoomed view. `MIN_RING` spacing keeps tiny real fleets legible.
- Keyboard: 1–9 fly to sector (URL project altitude), N/P triage through the
  blocked circuit, arrows/Q/E/+/− free camera, 0 overview, Esc ascends (kept
  in the client). Click = select (drills with owning Project); drag-orbit is
  guarded (pointer delta) so it never deselects/ascends.
- Deleted `console3d/` and the orphaned `command-table/` modules. The gallery
  demo (`/hud-gallery/agent-field`) drives the same world with synthetic data.
- Verified: type-check/lint/build, 183 tests, eval:r3f 100/100, Playwright
  screenshot passes on `/fleet/spatial` (fleet/project/agent altitudes, S/M/L
  scales, blocked-filter triage board, live-tick soak, drag guard, tooltip)
  and the gallery demo (incl. reduced-motion) — zero console errors.

### V1.1 Feel Pass

Status: landed

Scope (usability + smoothness on the V1.0 surface):

- camera tuning: gentler programmatic flights, framing minimums so tiny
  sectors/agents are never over-zoomed, sensible free-cam speed
- held-key glide: arrows/Q/E/+/− move continuously while held (per-frame
  nudges through the camera's own damping) instead of discrete hops
- sectors as first-class targets: hull/disc click drills to the project,
  sector hover emphasizes + cursor affordance (empty sector space, not just
  node hits)
- selection continuity + micro-polish: selection cues survive altitude moves,
  tooltip/label behavior at mid-zoom, focus-visible parity

Acceptance criteria:

- keyboard camera movement feels continuous (no stutter at key-repeat rate)
- clicking anywhere inside a sector hull (not on a node) drills to it;
  drag-orbit still never drills/deselects
- sector/agent flights land with comfortable margins at S/M/L scales

Progress log:

- Camera: smoothTime 0.45; focusCluster/focusAgent framing minimums (44/34 world
  units) so tiny sectors land with margin; azimuth/polar clamps unchanged.
- Held-key glide: shared `useAgentFieldGlide` hook (arrows/Q/E/+/−) feeds small
  instant `nudge`s per rAF through the camera's own damping; a fresh press gets
  an immediate kick so taps stay responsive. Both the real surface and the
  gallery demo use it; tap-handlers for those keys were removed (double-speed
  hazard).
- Sector targets: an invisible generous pick disc per cluster
  (max(1.45·radius, radius+9) — nodes are 45°-rotated diamonds whose corner
  reach × pulse × hover-grow exceeds 1.45·radius at small clusters, found the
  hard way) plus an invisible hit plane behind the sector label; both drill to
  the project, hover-emphasize the hull, and honor the pointer-delta drag
  guard. Nodes always win the hit (nearer + stopPropagation). Label targets
  disable themselves when camera-faded.
- Debug/eval affordance: dev builds expose `__EVAL_SCENE__`/`__EVAL_CAM__`/
  `__EVAL_RAY__` alongside `__EVAL_GL__` so harnesses can project world points
  to screen coordinates atomically (probe coordinates computed against a
  mid-flight camera were a major source of false test failures).
- Verified: full Playwright battery on /fleet/spatial (altitudes, scales,
  filter, hull-click drill to a real project, 600ms held-arrow glide pan,
  drag guard, live-tick soak) + gallery demo incl. reduced-motion — zero
  console errors; type-check/lint/183 tests/build green.

### V1.2 Meaning Pass

Status: landed

Scope:

- Attention Schedule reason lines rendered in-world on the hero blocker
- blocker actions (clear/respond → existing focus/control flows) reachable
  from the map without leaving the surface
- activity pulses on nodes as events land; per-sector cost/pressure encoding

Progress log:

- Hero callout: a crisp DOM chip (drei `<Html>`, fixed screen size) anchored
  BELOW the hero agent's node (sector labels live above hulls, so below never
  collides) showing the blocker title + the Attention Schedule's leverage
  reason. Clicking it selects the agent — the side panel's Focus/Clear flows
  open without hunting the map. Hidden automatically when the hero is
  filtered out of view.
- Per-sector cost/pressure: sector labels render the zone's `statLine`
  ("N agents · M blocked · $X/hr") when provided; the synthetic demo keeps
  the generated units/blocked line.
- Activity pulses: `FieldAgent.activityAt` (mapped from `lastActivityAt`);
  the constellation diffs it across live ticks and pops the node (sin blip,
  0.7s) when an event lands. First seed only records the baseline (no blip
  storm on mount); gated off under reduced motion and during the entrance.
- Also this pass: vertical keyboard pan inversion fixed (operator report).
- Verified: full Playwright battery (fleet/project/agent, S/M/L, filter,
  hull drill, glide, drag guard, live-tick soak) + gallery regression incl.
  reduced-motion — zero console errors; 183 tests, type-check/lint/build
  green.

### V1.3 Semantic Regimes & Feel Recovery

Status: landed 2026-07-10 — operator selected the semantic-regime direction,
confirmed the canonical brief, and S0-S4 passed the release battery.

Scope and acceptance criteria are defined in the V1.3 design brief above.
Implementation must follow S0 → S4 and update this status/progress after each
pushed checkpoint. A passing type-check or isolated draw-call eval alone cannot
mark this milestone landed.

Progress log:

- **S0 landed (2026-07-10):** roadmap, this design brief, decision `0003`, the
  R3F authoring guide, and design context now agree on altitude-specific semantic
  regimes and the DOM/WebGL boundary.
- **S1 landed (2026-07-10):** replaced the 120ms camera tap kick with a pure,
  unit-tested damped-velocity model (normalized diagonal input, clamped delta,
  acceleration and release decay); narrowed orbit to a readable 2.5D band;
  added immediate optimistic selection/fly-to before URL synchronization;
  moved cursor-following tooltip position to one rAF-coalesced DOM transform;
  replaced count-based React keys and hover indices with stable IDs; converted
  persistent blocker pulses and focus-ring spin into finite state transitions;
  and split postprocessing behind a lazy, low-power-gated boundary with capped
  low-power DPR.
- S1 verification: type-check and focused lint pass; full suite 244/244; R3F
  eval 100/100; full `/fleet/spatial` run has no application/WebGL errors; a
  paused one-second Fleet idle sample renders zero new frames; held-key samples
  show acceleration plus release decay and then zero idle frames; filtering no
  longer replays the deploy sequence.
- **S2 landed (2026-07-10):** introduced shared regime types and a pure,
  unit-tested Project-deck layout whose ID ordering remains stable across live
  status changes; added a bounded Project deck with named Agent units and a
  focused Agent station; wired semantic camera targets to those units; and
  exercised the same regime switching in the HUD gallery before route polish.
- **S3 landed (2026-07-10):** integrated the regimes into `/fleet/spatial` with
  restrained directional/ambient lighting, grounded metal chassis, status
  rails, finite damped hover/selection/entrance motion, and crisp screen-aligned
  DOM buttons. Fleet Project labels are DOM controls too. Activity and empty
  states now follow the active Project/Agent context; mobile uses a bounded
  canvas plus scroll-reachable inspector; Demo controls compact by default and
  expose 44px touch targets; reduced-motion and low-power paths retain the same
  commands.
- **S4 landed (2026-07-10):** removed the decorative adjacency trunk that
  implied nonexistent Project relationships; removed gallery promotion and
  stale sector language from the product route; tuned Agent framing/materials;
  added `eval:spatial` as a repeatable full-route Playwright battery; and fixed
  Demo scale-down at the source boundary with atomic authoritative
  `FleetManager.replaceAgents`, preventing stale large-fleet agents from
  surviving a 150 → 8 scale change.
- S2-S4 verification: type-check, focused lint, production build, and 252/252
  tests pass; isolated R3F eval remains 100/100. Full-route spatial evaluation
  passes small/medium/large Demo fleets (8/40/150 agents), accessible
  Fleet → Project → Agent descent and Escape ascent, desktop, 390px mobile,
  reduced motion, simulated low power at the 1.25 DPR cap, zero application or
  WebGL errors, and zero new render frames in a settled one-second sample.
  Headed Chromium development samples recorded 16.7ms median and 17.8-18.2ms
  p95 during held-key glide at small/medium scale; a local production spot
  sample recorded 16.7ms median / 17.5ms p95. This is near the 16.7ms target,
  not evidence for V1.4's future 1k-10k budget.
- This completion record was superseded later on 2026-07-10 by V1.3.1 after
  real sparse Live Mode screenshots failed visual acceptance. V1.3's runtime
  gates remain landed; composition acceptance is reopened below.

### V1.3.1 Live Sparse-Fleet Composition Recovery

Status: implementation complete; operator visual acceptance pending — opened
2026-07-10 after the operator rejected the real two-Project / three-idle-Agent
Live Mode composition.

#### Why V1.3 verification was insufficient

V1.3 correctly separated Fleet, Project, and Agent render regimes and repaired
input/render behavior, but its flagship visual verification used richer Demo
fixtures. The real Live Mode screenshots exposed a different state:

- `MIN_RING = 36` placed two tiny Projects at opposite ends of a vertical ring;
  the global sphere fit then made empty void the largest visual element;
- circular hulls plus glow still read as planets/orbs, contradicting the stated
  small-fleet metaphor;
- Project and Agent focus inherited the prior camera azimuth/polar pose, so an
  otherwise flat 2.5D unit could arrive as a tilted floating slab;
- Agent drill issued two camera commands with different radii (optimistic
  Project target, then URL-driven Agent target), creating a zoom-in/pull-back
  hitch; unit entrance also multiplied its progress into scale twice;
- Agent altitude repeated a truncated name/goal inside WebGL-adjacent DOM and
  the inspector without adding operational information;
- a fixed, flex-growing empty Activity card consumed the right rail while the
  useful field remained visually under-populated.

The prior V1.3 implementation record remains true, but “landed” did not mean the
real sparse Live Mode state had reached the intended visual bar. This recovery
milestone corrects that acceptance gap rather than layering on unrelated scope.

#### Direction

Build a compact adaptive 2.5D operations tabletop, not an infinite-space
constellation:

- **Sparse Fleet (1–6 Projects / roughly 1–24 Agents):** matte rectangular
  Project bays with harder silhouettes, restrained status rails, embedded
  Agent marks, and screen-aligned Project controls. Use an intentional compact
  row/grid arrangement derived from content bounds; no circular filled discs,
  ring minimum, or ambient blue bloom as the primary composition.
- **Dense Fleet:** retain the scalable instanced AgentField and aggregate
  strategy, but the sparse threshold must transition without changing command
  semantics or source contracts.
- **Project:** fit the actual Project deck bounds, not the Fleet cluster's
  historical minimum sphere. Preserve stable identity and named Agent units.
- **Agent:** reset to a deliberate shallow camera pose and present a compact
  workstation/instrument silhouette. The world confirms identity/status and
  orientation; the DOM inspector owns full goal, source/session detail, and
  actions. Do not print the same truncated paragraph twice.
- **Chrome:** when there is no activity or selection, collapse the right rail to
  concise operational guidance instead of reserving a large empty card. Preserve
  full Agent names, shorten raw paths to useful context, and rename ambiguous
  `Focus` copy to the actual command destination.

#### Sequence

1. **R0 Canon and failed fixture:** land this recovery plan and preserve the
   operator screenshots as acceptance evidence in the project record; add pure
   sparse-layout expectations for 1–6 Projects.
2. **R1 Sparse Fleet composition:** implement content-bounded compact Project
   placement and tactile Project bays while preserving instanced Agent marks,
   DOM mirrors, stable IDs, picking, and the dense-fleet fallback.
3. **R2 Semantic framing and Agent hierarchy:** add altitude-specific camera
   targets/poses and one transition owner; fit Project deck bounds; compose
   entrance scale once; redesign Agent focus to remove the generic
   slab/duplicated label; compact empty inspector/activity states and repair
   truncation/action language.
4. **R3 Verification and polish:** add deterministic 1/2/3/6-Project fixtures;
   compare Fleet/Project/Agent screenshots at desktop and mobile; verify long
   names, all-idle and attention states, keyboard/DOM parity, reduced motion,
   low power, zero idle frames, type/lint/tests/build, and both R3F evaluators.

#### Release gates

- In the two-Project / three-Agent fixture, both Projects sit in the primary
  scan area and read as one composed tabletop; neither touches a viewport edge
  or creates an empty gap larger than the composed Project group itself.
- Sparse Project silhouettes are unmistakably operational bays rather than
  circles, planets, or decorative glass cards. Status color is signal, not wash.
- Project and Agent transitions reset to authored semantic poses regardless of
  prior pan/orbit input; content is centered in the actual canvas after the
  inspector width is accounted for.
- The Agent view has one canonical full-name heading, no duplicated truncated
  goal, a meaningful session action label, and a compact empty-activity state.
- The 1–8-Agent state is the flagship visual fixture. Demo S/M/L checks remain
  regression coverage, not a substitute for sparse Live Mode acceptance.
- Existing V1.3 gates remain: accessible DOM equivalents, URL/deep-link state,
  reduced-motion and low-power parity, no raw pointer React renders, finite
  motion, zero settled idle frames, and no WebGL/shader errors.

#### Implementation record (2026-07-10)

- R0–R1 landed with a pure sparse-layout boundary and unit coverage for 1–6
  Projects. The exact rejected Live Mode shape is preserved at
  `/eval/t3-spatial-sparse`: two matte, notched Project bays share a centered
  horizontal composition and contain three idle Agent marks. Dense fleets keep
  the existing scalable fallback.
- R2 landed with actual Project/Agent content boxes, authored shallow camera
  poses, and a single URL-driven transition owner inside the camera rig. This
  removes the competing Project/Agent flight and the doubled unit entrance
  scale. Agent altitude now uses a compact workstation/instrument silhouette;
  readable identity, goal, context, cost, activity, and commands remain DOM
  responsibilities.
- Chrome now appears only when it has inspection or Activity content. Agent
  names wrap instead of truncating in the inspector, raw session paths reduce
  to useful context with the full value retained as a title, and `Open session`
  replaces the ambiguous `Focus` action. An altitude live region announces
  semantic transitions.
- R3 added `t3-spatial-sparse` and `t4-agent-station` to the R3F harness. The
  sparse fixture has semantic DOM geometry assertions in addition to pixel and
  WebGL gates, preventing a non-blank but badly dispersed composition from
  passing again. Eval-only drawing-buffer preservation is no longer enabled in
  the development/product render path.
- Verification: type-check and focused lint pass; all 263 tests pass; isolated
  R3F eval is 100/100 across four fixtures; the real route passes desktop,
  mobile, reduced-motion, and low-power descent/ascent with zero settled idle
  frames and no WebGL/console errors. The headed sample records 16.7ms p95 at
  medium scale and 9.1ms p95 for the flagship small fleet; the production build
  passes. Operator judgment of the updated Live Mode view remains the
  milestone's final visual acceptance.

### V2.0 Spatial Operations Board

Status: active-build — B0 landed; B1 board model next

Scope, phase gates, budgets, and non-goals are defined in the V2.0 design brief
above. Record each pushed B0–B5 checkpoint here with verification evidence. A
passing unit suite without real sparse Live Mode and visual-route acceptance
cannot mark this milestone landed.

Progress log:

- **B0 landed (2026-07-10):** renamed the canonical project around the Spatial
  Operations Board; updated ENG-004, architecture, `/architecture` manifest, and
  marketing canon; accepted decision `0007`; preserved the map-based recall paper
  with provenance/checksum; and promoted stable spatial addresses plus the future
  manifesto opportunity without overstating the evidence.
- B0 baseline: type-check and focused architecture-manifest lint pass; 267/267
  tests pass; isolated R3F evaluator is 100/100 across the existing four
  fixtures; full `/fleet/spatial` evaluator passes desktop, mobile, reduced
  motion, and low power with three Project controls/three Agent controls, zero
  settled idle frames, and DPR 1.25 in simulated low-power mode. These are the
  pre-V2 renderer baselines, not acceptance of the superseded visual motif.

### V2.1 Scale & Truth

Status: planned; gated by V2.0

Scope:

- verify aggregation, culling, picking, memory, and full-route frame budgets at
  1k, 10k, and representative higher synthetic Agent counts
- add Initiative-level aggregation and aggregate Project drill without changing
  the V2.0 address/command contracts
- tune visible label and DOM-control budgets from measurement
- preserve flagship small-fleet composition and semantic resolution

### V2.2 User-authored Spatial Organization

Status: planned; gated by V2.0 dogfood

Scope:

- opt-in Project/Agent repositioning inspired by RTS piece manipulation and
  desktop icon organization
- drawn/resized team zones, multi-selection, keyboard equivalents, and undo
- versioned persisted overrides layered on the automatic layout baseline
- reset, merge, migration, and conflict behavior that cannot corrupt domain data

### V2.3 Consolidation

Status: planned; gated by V2.0/V2.1 evidence

Scope:

- decide whether `/fleet/spatial` becomes the default fleet view
- command-palette integration and durable projection preference
- keep the DOM `/fleet` board as the accessible dense-text sibling
- keep `/hud-gallery` as a development workbench only
