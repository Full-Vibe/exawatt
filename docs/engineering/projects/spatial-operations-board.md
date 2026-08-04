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

### V3 design pass (operator, 2026-08-02)

The 2026-07-24 reframing left ENG-004's continued refinement deliberately
unshaped pending a design pass. That pass happened on 2026-08-02 from the
operator brief. It answers what the board is FOR, which the earlier briefs
never stated plainly:

**The board is an instrument and a stage — not a map of org structure.** Ranked
by the operator:

1. **Situational awareness.** "What is my whole fleet doing right now, and where
   should I look?" Attention hotspots, blocked clusters, work in flight. A
   surface you glance at and immediately know where to go.
2. **Scale awe and command.** The felt sense of population — "I have this many
   workers and I can direct them" — and eventually the ability to act on many at
   once.

Explicitly named as future fleet-altitude capability, not near-term build:
reallocating workers between goals (ENG-014), consumption at fleet altitude
(ENG-008), overall activity, and bulk directives to many Agents at once. Bulk
command lands in this arc as a **preview affordance only** under ENG-026's
`Coming soon` grammar — lightweight broad strokes that show the vision without
shipping a fan-out mechanism.

Structure-and-belonging (org charts, delegation trees as the primary read) was
considered and NOT chosen as the board's purpose. Delegation topology still
arrives via ENG-023 D3 as a detail available at Project/Agent altitude, not as
the board's organizing idea.

Altitude names and the transition model are decided separately in decision
`0023`: the ladder becomes **Agent · Team · Fleet**, and the board gains a
required **entry pose** so that arriving from the middle altitude is a camera
move rather than a cut.

### Composition doctrine (operator, 2026-08-03)

Decision `0024` settled how the board is CONTROLLED (RTS unit grammar). This
settles what it is COMPOSED of. Both came from the same motif; this half was
still open when the 2026-08-03 visual audit found the shipped board reading as
sparse rather than vast.

The operator's framing:

> "Overlooking my fleet of thousands or tens of thousands of agents and
> generally seeing what they're working on, where my priorities are, and where
> the activity is… I think about it like a game board, StarCraft or Red Alert 2,
> where I can have all my units working against a given goal and I can select
> them and re-vector them. It's a very zoomed-out view of tmux."

With an explicit styling caveat: _"it doesn't have to be geeky and game-like
though. I'm just giving you kind of the UI motif."_ The RTS reference governs
the **control and legibility model** — units, mass, selection, re-vectoring —
not the aesthetic. Decision `0007`'s restraint holds in full.

Four rules follow.

1. **Zoom decides individuality, and mass stays legible at every step.** Agents
   are drawn individually by default; they agglomerate into one another only
   when the operator is _very_ zoomed out. Density and mass must read clearly at
   every altitude — an aggregate that hides how much is running defeats the
   purpose. This extends V3.1's label tiers into a stated policy and is the
   direct fix for the audit's "reads sparse, not vast" finding, together with
   F4's population-sized zones.
2. **Structure organizes; attention overlays and never relocates.** Projects
   hold stable positions so spatial memory survives. Attention is expressed
   through prominence, weight, color, and the stable attention queue — never
   by moving a zone. If a future treatment uses a callout, it must be
   **anchored to its subject**. The audit found the hero blocked callout floating
   top-center while `partner-portal`, its subject, sat two rows away; an
   unanchored callout is the failure mode this rule forbids.
3. **Work visibly happens.** At rest the board should convey that a population
   is working — the C&C-general feeling — rather than looking like a diagram of
   a fleet. Constraint that keeps this from fighting canon: liveness rides
   D40's existing rule that **only Active moves**, plus genuine state
   transitions (a turn completing, an agent arriving or leaving). It does not
   add resting animation to idle or finished states, and it parks under reduced
   motion, low power, and hidden tabs per V2.4.
4. **The board must be learnable without a manual.** The audit counted at least
   five hex fills against three named header states with no legend on screen.
   D30 retired hue-only signalling precisely because it is not learnable; a
   surface that encodes status in color owes the viewer a way to learn it.

Open composition gaps recorded by the same audit, owned by V3.3: three stacked
chrome rows before content (with "Fleet" appearing twice), and a minimap of ten
identical grey rectangles carrying no population, status, or viewport
information.

### UX pass — 2026-08-02 (operator + hands-on drive): the V3.3 brief

The operator's verdict on the shipped board: _"It's really chunky and clunky
and rough around the edges. I don't really like using it at all."_ The pass
drove every interaction at four fleet scales (demo S/M/L and the 173-agent
Voltaic fleet) with frame timing, then put the findings to the operator. The
evidence and the operator's answers together shape **V3.3 Feel & Fidelity**.

**Measured/observed findings** (drive harness, dev server):

1. Altitude changes remount the zone/piece layers (they are keyed by semantic
   address), replaying entrance choreography and stalling 500–1400ms
   mid-transition. The camera "flight" completes between two frames ~140ms
   apart — a cut dressed as a flight, at the most-used interaction. Lateral
   moves (N/P, project-to-project) jump the same way. Operator: transitions
   are "jumpy, also jumpy laterally."
2. Plain wheel input is frequently eaten whole by pan clamping (six ticks at
   Agent altitude moved nothing). `V` acked at 133ms against the 80ms budget.
3. Arrow keys pan the camera; the operator expects them to WALK UNITS:
   "I want the arrow keys to navigate spatially to different units on the map
   and not pan the camera."
4. Up close the octagon body vanishes into the zone fill, so a piece reads as
   a large flat status moon with a black label chip. At Voltaic scale every
   agent is a saturated status-colored chip — the grammar's "semantic and
   scarce" status color is instead 100% of the field. Operator: "the noun
   primitives just look super low quality and basic. Just boxes with
   background colors — we chose R3F/WebGL for a reason, and that was to push
   the UI more."
5. Pieces are not individually recognizable: the board labels pieces with the
   transport's `cwd · harness-title` name, so a real four-agent Project reads
   "exawatt · Claude Co…" four times (operator screenshot). The durable
   context goal that already distinguishes these Sessions on the Team tiles
   never reaches the board.
6. The world is information-starved: a one-agent drill renders one donut
   centered in a screen-sized empty slab; identity/goal/activity/cost all
   live in edge chrome. Agent altitude is Team altitude plus a side panel —
   no in-world resolution change.
7. Chrome is scattered across six floating clusters, the minimap/switcher
   cluster relocates between altitudes, and the hero attention callout is "a
   bell waiting pop-up floating modal thing that doesn't make any sense" that
   also overlaps zone headers at scale. The operator does not use the chrome.
   Top-level fleet stats are worth keeping; the activity feed's
   state-transition exhaust is not.

**Operator direction** (the shape of V3.3):

- **Control model: classic RTS unit control** — decision `0024`. Scroll and
  trackpad pan; click-drag draws a selection box; arrow keys walk units with
  the camera following; selection populates a game-style command panel.
  Comp named by the operator: StarCraft / Command & Conquer unit control.
- **A tiled game board, not rectangles.** "Each agent should be kind of like
  an octagon or hexagon tile and then each of the projects should be a larger
  version of that on the tiled game board, not just a big rectangle." Gallery
  review amended the hierarchy on 2026-08-03: Agents remain hex/oct tiles;
  Projects become circular population boundaries. Zones still size to their
  population with no empty pools, and the production world stays
  WebGL/Three.js for future compatibility.
- **Rendering pushed to earn the WebGL choice**: real tile materiality
  (bevel, depth, edge light), status subordinate to a visible body, scarce
  color at scale — within decision `0007`'s restrained-board constraints.
- **In-world identity and activity** (operator chose "activity in-world"):
  each piece carries the durable context goal as its label — the same truth
  the Team tiles show, never the duplicated harness title — plus its current
  activity sentence at Team/Agent altitude within the label budget.
- **Chrome consolidation**: one stable tool cluster; the selection command
  panel absorbs the inspector and the activity feed (the feed becomes "what
  has this unit been doing" — meaningful Events, not state-transition
  exhaust); the hero callout is redesigned into the attention system (zone
  highlight + minimap ping + the needs-you queue) rather than a floating
  modal; the top status strip survives.

**Sequencing note.** V3.3's transition slice (F1) makes the board's layers
survive altitude changes and morph in place — that is the same
identity-and-position-carries foundation V3.0's entry pose needs, so V3.0
(demo-arc P7, gated on P6.5) should land ON this foundation rather than build
its own. The tile-family redesign prototypes in `/hud-gallery` for operator
review before production adoption, per the standing workbench rule.

### V3.3 execution contract (planning session, operator + agent, 2026-08-02)

The four open calls from the UX pass are decided; this section is the
pick-up-cold contract for the agents that execute V3.3. It amends nothing —
it makes the brief above executable. One stream, one order: **feel first,
then the V3.0 cinematic handoff on top of F1's machinery** (operator,
2026-08-02). V3.3 and V3.0 are one integrated arc, not two competing plans.

**Decisions taken 2026-08-02 (operator):**

- **The board is the Fleet altitude only.** The DOM tile grid stays the Team
  altitude. The operator explicitly reserves the right to revisit
  board-as-Team later; V2.3's consolidation question therefore stays OPEN and
  gains this as fresh input — do not treat Fleet-only as settled forever, and
  do not build toward consolidation without a new decision.
- **Multi-select is preview-only in this arc.** Band select is real selection
  state; the command card shows the group with a muted
  "Direct these N agents — Coming soon" affordance under ENG-026's readiness
  grammar. No fan-out mechanism ships (V3.2's boundary holds).
- **F4 builds now.** The hex direction is decided from the gallery prototype;
  the operator's in-app review of `/hud-gallery` → "Board tile family" shapes
  materials and proportions MID-FLIGHT (it is an input to F4's acceptance,
  not a gate on starting). Schedule the review at the next dogfood install.

**Slice contracts.** Order: **S1 (F2+F3) → S2 (F1, then V3.0 on top) →
S3 (F4+F5) → S4 (F6)**. S1 and S3 are file-disjoint enough to run in
parallel with care; S2 must not run concurrently with either (it restructures
the canvas layer tree both touch). Every slice: read
`docs/engineering/r3f-authoring-guide.md` first, keep decision `0007`
(no free orbit, deterministic layout in `@exawatt/ui-model`) and decision
`0024` (the control model), screenshot-iterate, and keep `pnpm eval:r3f`,
`eval:spatial`, `eval:spatial:pointer`, and `eval:spatial:scale` green.

- **S1 — Input (F2 keyboard unit navigation + F3 RTS pointer grammar).**
  Scope: arrows move SELECTION to the nearest piece in the pressed direction
  (spatial nearest-neighbor over board coordinates, a pure `ui-model`
  selector), camera follows selection with the NUDGE lambda; camera-only pan
  moves to a secondary binding; click-drag draws an in-world selection
  rectangle (band select over piece bounds, also a pure selector) replacing
  drag-pan; plain wheel/trackpad pans, pinch/ctrl-wheel zooms at cursor;
  clamped input answers with a short damped overshoot, never silence.
  Files: `operations-board-canvas.tsx` (pointer handlers, selection
  rectangle), `operations-board-surface.tsx` (key handling, hints),
  `packages/ui-model/src/spatial-board.ts` (nearest-neighbor + band-hit
  selectors + multi-selection state shape), `spatial-navigation-state.ts`
  (single selection stays URL-addressed; band selections are ephemeral).
  Acceptance: arrows never pan; every gesture the hand tries produces visible
  feedback; selection acks <80ms; DOM keyboard path can extend selection
  (a11y equivalent of band select); the keyboard-hint bar teaches the new
  verbs; unit tests for both selectors.
- **S2 — Continuity (F1 continuous transitions; V3.0 entry pose on top).**
  Scope: stop keying `ZoneLayer`/`AgentPieceLayer`/controls by
  `choreoKey` — layers survive altitude changes; zones/pieces morph position,
  scale, and visibility with damped motion while the camera flies; entrance
  choreography runs on DATA arrival only; lateral moves (N/P, project
  switches) glide the same way. Kill the measured 500–1400ms remount stalls.
  RECONCILED 2026-08-03: V3.0 landed the same evening this contract was
  written (Voltaic-tuned, see the V3.0 milestone above), extending the D11
  transition owner — the one-machinery invariant this ordering protected
  holds. S2 therefore ABSORBS the landed rig-side entry-pose execution
  (`tryEnterFromHandoff` → pose → hold → pull-back in
  `operations-board-canvas.tsx`) into its surviving-layers restructure
  instead of building it; the nav-side handoff contract
  (`nav/altitude-handoff.ts` capture/store/solver, the ghost layer, the two
  events) is stable and must not fork. Keep the four `eval:spatial` handoff
  scenarios green through the restructure.
  Acceptance: one continuous 60fps morph per altitude change with zero
  full-layer remounts (assert via a transition-frame eval that samples
  `__EVAL_GL__` frame gaps — no gap >100ms during the settle window);
  reduced-motion snaps; input is never blocked mid-transition.
- **S3 — The tiled board (F4 tile family + F5 in-world identity).**
  Scope: replace zone rectangles and cylinder pieces with the approved shape
  hierarchy from the `board-tile-study` prototype — beveled hex Agent tiles
  in socketed positions inside population-sized circular Project boundaries,
  subordinate glowing
  status lamps (status stays the five-light protocol), scarce color at fleet
  scale (idle sinks toward the board); layout math for hex plates/sockets is
  pure `ui-model` (`spatial-board.ts` grows a circular-footprint + hex-slot
  policy, versioned, stable slots preserved); piece labels switch to the durable context goal
  (`agent.goal`, already the ENG-021 context summary via the transport —
  NEVER the `cwd · harness-title` name) with the current activity sentence at
  Team/Agent altitude inside the label-budget rules; delegation satellites
  (ENG-023 D3b) re-anchor to the new tile geometry.
  Acceptance: no rectangular Project plates remain at any altitude; circular
  Project outlines and hex Agent bodies remain distinct at every individual
  resolution; a real 4-agent Project
  shows four DISTINCT goal labels; a 1-agent drill frames the tile, not an
  empty slab; `eval:spatial:scale` still meets V3.1's recorded budgets on the
  Voltaic fleet; the operator's gallery-review notes are reflected or
  explicitly answered in the landing message.
- **S4 — Chrome (F6 command panel + consolidation).**
  Scope: one game-style selection panel (single unit: identity, status,
  goal, current activity, recent meaningful Events, delegation children,
  Open Session; multi: the preview affordance above) replacing the inspector
  rail and the activity feed; one stable tool cluster (projection, minimap,
  zoom, hints) that does not relocate between altitudes; the hero callout
  retires in favor of zone highlight + minimap ping + the existing needs-you
  queue (`N` still walks it); the top fleet-stats strip survives.
  Acceptance: at most TWO chrome regions besides breadcrumbs (status strip,
  tool cluster) plus the selection panel when something is selected; nothing
  overlaps in-world content at any seeded scale; no state-transition exhaust
  copy anywhere on the surface.

**Verification assets that already exist:** the drive harness from the UX
pass (`/tmp` scratch, recreate from this section: burst screenshots + frame
gaps via `__EVAL_GL__`), `eval:spatial` (4 scenario contexts),
`eval:spatial:pointer`, `eval:spatial:scale` (Voltaic + synthetic tiers),
`/eval/t5-operations-board` (`?altitude=project` supported), and
`/eval/t10-board-scale?fleet=voltaic`. S1's selector tests live beside
`spatial-board.test.ts`.

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

| Altitude | Primary objects                      | Required information                                                                    | Deliberately hidden                    |
| -------- | ------------------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------- |
| Fleet    | Initiatives/Projects                 | name, Agent count, health mix, attention pressure, activity, consumption when available | most Agent names and Session detail    |
| Project  | one Project zone and anchored Agents | Agent identity, status, concise current goal/activity, attention ranking                | long transcripts and provider payloads |
| Agent    | selected Agent in spatial context    | full identity, status, Session target, concise operational summary                      | duplicated terminal content            |
| Session  | existing terminal workspace          | live harness interaction, transcript/TUI, Session actions                               | board geometry after handoff completes |

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

Status: landed 2026-07-10 — B0–B5 complete

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
- **B1 landed (2026-07-10):** added the pure, projection-independent
  `selectSpatialBoardLayout` boundary in `@exawatt/ui-model`. It emits stable
  Project slots, anchored Agent/aggregate pieces, visibility applied after
  placement, previous-layout slot preservation for arrivals, altitude-specific
  camera bounds, minimap bounds, semantic aggregation, and explicit label
  budgets. Top-down and fixed-angle options produce identical coordinates.
- B1 verification: 14 focused board-model tests cover empty and 1/2/3/6-Project
  composition, insertion-order/projection invariance, status-change stability,
  filter stability, Project/Agent arrivals, Project overflow, selected-label
  priority, stale deep links, Agent camera focus, and a 10,000-Agent/50-Project
  fixture whose emitted pieces remain bounded to status aggregates. Full type-
  check and lint pass; 281/281 repository tests pass.
- **B2 landed (2026-07-10):** replaced the product route's AgentField world at
  the dynamic renderer boundary with a demand-rendered orthographic Operations
  Board. It renders a quiet square grid, bounded Project zones, health rails,
  instanced anchored octagonal Agent/aggregate pieces, one finite attention
  callout, DOM Project/Agent controls, deterministic camera fit, damped held-key
  pan/zoom, content-aware empty state, and reduced-motion/low-power parity. The
  old AgentField remains only as implementation history and isolated regression
  evidence; it is no longer the `/fleet/spatial` product renderer.
- B2 responsive correction: fleet zones and Project pieces were reduced after
  screenshot review; phone Agent controls now meet 44px touch targets and use a
  narrow label treatment that avoids collision while the inspector reveals full
  identity. Desktop Project screenshots explicitly reset accidental harness
  scroll before capture.
- B2 verification: full type-check, focused lint, 281/281 tests, and production
  build pass. The updated full-route evaluator asserts the top-down board and
  passes desktop, 390px touch/mobile, reduced motion, and simulated low power at
  DPR 1.25; Fleet → Project → Agent keyboard/pointer descent, Escape ascent,
  held-key camera glide, and zero settled idle frames pass. New isolated fixture
  `t5-operations-board` renders two Projects/five Agents in 7 draw calls with no
  WebGL warnings and raises the five-fixture R3F evaluator to 100/100.
- **B3 landed (2026-07-10):** added a URL-backed Top/Angle projection switcher
  over the same board coordinates and renderer. Angle uses a fixed shallow
  dimetric orthographic pose with visible zone/piece depth and screen-aligned
  DOM labels; there is still no free orbit. Projection changes use the same
  finite damped camera owner and preserve semantic altitude, Agent selection,
  filter state, pan/zoom intent, and command contracts.
- Board tools now include a live SVG minimap viewport, click-to-recenter,
  explicit zoom/recenter controls, `V` projection shortcut, and a DOM WebGL
  recovery state linking to `/fleet`. Desktop uses the full vertical tool stack;
  phone layouts retain 44px targets in one compact bottom row with a live mini
  overview, preventing controls from obscuring Agent pieces.
- B3 verification: full type-check, focused lint, 281/281 tests, and production
  build pass. Full-route evaluation proves minimap viewport contraction after
  zoom, a real camera-quaternion change for Angle, projection URL persistence,
  Agent/inspector preservation while switching at Agent altitude, top-down
  restoration, desktop/mobile/reduced/low-power parity, zero idle frames, and
  no WebGL/console errors. Screenshot review passed both projections and the
  responsive board-tool layouts; isolated R3F remains 100/100 at 7 board draw
  calls.
- **B4 landed (2026-07-10):** the selected live Agent now performs one short,
  finite camera push before handing its existing PTY identity to the terminal
  workspace. The handoff uses the existing cross-route session-jump contract;
  it neither creates nor revives a Session. Reduced-motion replaces the push
  delay with a brief opacity handoff, missing local Sessions retain the existing
  Agent-detail fallback, and PTY-list failures leave the board in place with a
  DOM alert.
- The reverse path stores only a validated same-origin `/fleet/spatial` address
  in session storage. Command-altitude controls, the workspace shortcut, global
  shortcut, and command palette all restore that address, preserving Project,
  Agent, and projection without allowing external or sibling-route injection.
- B4 verification: 284/284 tests, full type-check, and lint pass. A browser-level
  navigation evaluator proves reduced-motion Agent handoff, selected PTY
  activation, and exact address return. A hermetic real Electron run launches a
  shell PTY, descends Sessions → Project → Agent, opens the same PTY, restores
  the exact fixed-angle Agent address, and confirms the one live process survives
  the complete round trip. Full-route spatial evaluation continues to pass
  desktop, mobile, reduced-motion, and low-power modes with zero settled idle
  frames; the five-fixture R3F evaluator remains 100/100 and the board remains
  at 7 isolated draw calls.
- **B5 landed (2026-07-10):** release reconciliation re-ran the complete
  type-check, lint, 284-test suite, production build, browser navigation, real
  Electron navigation, isolated R3F evaluator, and full-route spatial evaluator
  from the B4 checkpoint. All pass. The headed reference-desktop motion sample
  records 8.3ms p50 and 8.8ms p95 at the 40-Agent medium fixture, and 8.3ms p50
  and 9.1ms p95 at the flagship 8-Agent fixture. Both settle at zero idle scene
  frames.
- B5 visual/a11y review covered top-down and fixed-angle Fleet, focused Project,
  selected Agent, 390px scroll-to-inspector, reduced motion, low power, the live
  sparse Electron fixture, and the 5–8-Agent Demo fixture. Project and Agent
  meshes retain focusable DOM twins; touch controls remain at least 44px; the
  WebGL fallback retains a DOM route to Fleet. The result is accepted as the
  V2.0 baseline, not a claim that visual iteration is finished.
- Remaining hypotheses move forward instead of expanding V2.0: measure
  Initiative/1k+/10k truth under V2.1; add opt-in direct manipulation only under
  V2.2; decide default-surface consolidation only from dogfood under V2.3. The
  manually arranged desktop-map feeling remains inspiration for V2.2, not a
  reason to turn the V2.0 visual grid into ownership or movement semantics.

### V2.4 Experience pass — graphics, motion, navigation, transitions

Status: landed 2026-07-20 (same-day build after the operator unpark); operator
visual acceptance is the remaining dogfood evidence

Implementation record (2026-07-20): world materiality (ambient+directional
lighting; per-project accent zone edges in one vertex-colored Line2 draw;
accent-tinted lambert zone plates; emissive toneMapped-off status cores;
thin breathing status halos in two additively blended instanced classes;
radially fading vertex-colored grid; lazy low-power-gated Bloom+Vignette in
`operations-board-effects.tsx`), motion (mount-keyed slotIndex-staggered
piece entrance; zone fade-up; FLIGHT vs NUDGE camera lambdas 5.5/13;
arrival dolly from 0.82x fit zoom; rotating dashed selection reticle;
`board-control-enter` crossfade on the DOM controls), direct navigation
(drag-pan with pointer capture, plain-wheel pan, ctrl/meta-wheel
zoom-at-cursor on the shared damped target; click guards intact), and
directional regime transitions (ascend contracts / descend expands nested
viewport frames in the CommandNavigationProvider overlay; enter-session
scrim gains a radial fade and the Agent's name). The dev CSP now allows
'unsafe-eval' in development only (React dev callstacks were failing every
console-clean eval), and `eval:spatial`'s park-at-rest assertion moved to
the reduced-motion/low-power contexts per the gate amendment. Evidence:
eval:r3f 100/100 (t5 board 1 draw call), eval:spatial 4/4 contexts,
new `eval:spatial:pointer` (drag/wheel/pinch/click-guard/M/L/reduced-park),
browser altitude eval, real-Electron navigation eval (live PTY -> Spatial
Agent -> same PTY -> exact address), 515 unit tests, type-check, lint,
production build.

The operator's ask (2026-07-20): "take us past the spatial experience …
super good graphics, really smooth, navigable, excellent transitions in
between states in the spatial mode and also between spatial and other
modes." The V2.0 board is correct but reads as a wireframe: near-invisible
zone plates, flat status discs, no glow or depth, no pointer pan/zoom, and
functional-but-unchoreographed altitude cuts.

Scope (all within decision `0007`: restrained board, ortho projections only,
DOM owns text/interaction, keyboard-first):

- world materiality: lighting so the fixed-angle projection reads depth;
  Project zone plates with per-project accent edge glow instead of uniform
  gray outlines; radial-fade grid; Agent pieces get emissive status cores
  (`toneMapped={false}`) with soft halos; animated selection ring; lazy,
  low-power-gated Bloom + Vignette postprocessing
- motion: entrance choreography keyed to MOUNTS (never data ticks);
  breathing pulses on working/attention pieces; altitude changes become
  choreographed flights (slower damp for flights than for nudges) with the
  `<Html>` project/agent controls crossfading instead of popping
- direct navigation: pointer drag-pan and wheel zoom-to-cursor feeding the
  same damped camera target model; existing click-vs-drag guards preserved;
  free orbit stays forbidden
- transitions: the regime overlay becomes directional (ascending toward
  Spatial expands, descending toward Terminal contracts); the board plays an
  arrival dolly on entry; entering a Session keeps the camera dive plus a
  polished scrim

Gate amendment: V2.0's "at rest, the demand-rendered scene parks" becomes
"parks under reduced motion, low power, and hidden tabs" — ambient status
motion is now a deliberate product quality, not an accident. Frame budget,
instancing (one draw per layer), and the full-route evaluator remain gates.

Acceptance:

- the four operator axes each visibly improved, screenshot-evidenced at
  fleet/project/agent altitudes, both projections, S/M/L demo scales
- pointer drag-pan + wheel zoom-to-cursor work without breaking click
  selection, keyboard glide, or viewport persistence
- reduced-motion, low-power, and hidden-tab paths verified (static but
  complete); `pnpm eval:r3f` and the full-route spatial evaluator pass
- no regression in draw-call counts beyond the added halo/effects budget

### V3.0 Altitude handoff

Status: landed 2026-08-02 — the Team → Fleet position handoff decided in
`0023`, built on the D11 single transition owner and tuned against the
populated Voltaic Demo Workspace board (ENG-027 W2). SEQUENCE
RECONCILIATION 2026-08-03: the V3.3 execution contract (written the same
evening, before this landing was known) sequenced V3.0 onto S2; the
one-machinery invariant that ordering protected holds by construction, and
S2 now absorbs the rig-side entry-pose execution — see the S2 slice
contract below and the roadmap amendment chain.

What ships: ascending from the Team altitude to the Fleet altitude carries
**identity and position** across the DOM→WebGL boundary — content never
travels. Each visible Project card's screen rect and identity (name, color)
is captured at departure; the board arrives at an **entry pose** derived
from those rects; card ghosts crossfade into their zones in place; only
then does the camera pull back to the resting fit.

Ownership (extends D11, adds no second transition system):

- **`nav/altitude-handoff.ts`** — the shared contract: capture
  (`[data-handoff-card]` hooks on the exposé Project sections), a
  single-use snapshot store with freshness (= the frame budget, 900ms) and
  viewport-match validation, the entry-pose solver, and the two
  coordination events (`pose`, `fallback`).
- **`CommandNavigationProvider` (the D11 owner)** owns the lifecycle: it
  captures and publishes on a sessions→spatial regime crossing, renders the
  ghost layer (`nav/altitude-handoff-ghosts.tsx`), and owns the fallback
  decision — the deadline, the stall watchdog, and teardown when the
  operator navigates again mid-flight.
- **`BoardCameraRig`** is an executor, exactly as D11 kept xterm and R3F
  renderer ownership uncoupled: it claims the snapshot on mount, solves the
  pose against the live zone layout, applies it (current = target = pose),
  dispatches `pose` only after the first PAINTED frame at it (so ghosts
  hold still over the renderer swap and shader-compile stall), holds
  through the crossfade, then releases the target to the camera-bounds fit
  — the same damped FLIGHT the rig already owns. The lazy bloom chunk
  defers until the choreography settles (its compile was the one stall long
  enough to trip the mid-flight watchdog).

Entry-pose solver (`solveEntryPose`): a top-down orthographic camera has
exactly uniform-zoom + translation degrees of freedom. When the card order
correlates with the board's stable zone addresses (correlation ≥ 0.55), the
least-squares similarity fit places each zone as close as one camera can to
the screen position its card occupied. When the orders disagree — the
NORMAL case, since the Team overview is operator-ordered and board
addresses are stable — the least-squares scale degenerates toward zero (a
tiny distant board), so the pose instead matches **scale** (zones arrive at
roughly card size, via the median card/zone area ratio) and **centroid**,
and the per-card ghost flights carry the exact positions. Entry zoom is
clamped to [1.06×fit, 2.2×fit]: the release always PULLS BACK, never dives in,
and matched zones never land far offscreen — real Team sections dwarf their
zones, so an unclamped size match framed one giant zone and scattered the
rest outside the viewport (Voltaic tuning, 2026-08-02).

The fallback cut is the feature that makes this safe, and firing it is a
normal outcome (event-driven, never an exception): reduced motion and low
power never attempt the capture (same `hardwareConcurrency` gate as the
canvas's low-power mode); a missed frame budget (no painted pose within
900ms of capture) fades the ghosts and leaves the ordinary fast directional
arrival; stale snapshots, viewport changes, wrong arrival regime
(projection/altitude/deep-link), unmatched or duplicate identities,
degenerate geometry, and a failed renderer (no pose ever dispatched — the
error boundary path) all cut the same way. A main-thread stall >250ms
mid-crossfade finishes the flight instantly rather than resuming a stale
tween.

Transitions never block input: the ghost layer is `pointer-events-none`;
the board's keyboard model answers mid-crossfade (eval proves a `1` drill
lands while ghosts are flying); operator camera input during the entry hold
wins — the automatic pull-back is suppressed rather than yanking the
camera; a new altitude command mid-handoff tears the ghosts down
immediately. The stored-viewport restore yields to an active handoff (the
one arrival where the remembered camera must not win).

Evidence — eval: `eval:spatial` gained four handoff scenarios over the new
`/eval/t11-altitude-handoff` fixture (real capture → publish → ghosts →
claim → pose → pull-back over the Voltaic fleet): `handoff-pose` (10/10
card identities carried, entry zoom above fit, settled at fit 12.10, input
probe drilled mid-flight), `handoff-reduced-motion` and `handoff-low-power`
(never attempted, board arrives normally), `handoff-missed-budget`
(claimDelay 1600ms > budget → fallback outcome, pose never applied).
Unit coverage: capture hygiene (offscreen/zero-size/duplicate cards),
store single-use/freshness/viewport gates, solver exact-recovery,
scale-fallback, bounds, and degeneracy declines.

Evidence — Voltaic acceptance tuning (the amended P7 gate, run after
ENG-027 W2 landed, 2026-08-02): the REAL app in the Demo tenant, driven
`/workspace?view=sessions` → ⌃⌘3. The exposé rendered all 10 Voltaic
Project sections (the shell reuses the real `ExposeOverlay`, so the
`data-handoff-card` hooks ride for free); the 3 sections intersecting a
1440×1000 viewport were captured and carried — offscreen cards are
deliberately not invented; ghosts crossfaded into their zones over the
tenant-aware Voltaic board (10 Projects / 52 emitted pieces / 209-entity
fleet) at the clamped 2.2×fit entry pose, then the camera pulled back to
the 12.10 fit. Zero console errors. This run drove the two tuning changes
recorded above (1.06×fit floor, 2.2×fit ceiling; 460ms in-out flight ease — the original
front-loaded expo curve finished the travel in ~120ms and read as a pop).
Frame-by-frame video of the crossfade and the entry/mid/settled
screenshots live in `scripts/r3f-eval/spatial-report/`.

Deliberately NOT built (the roadmap's overinvestment warning): no
per-node camera choreography beyond the one pose, no xterm-into-WebGL, no
Team-card-order adoption by the board layout (stable spatial addresses win;
the ghost flights absorb the difference), and Agent→Fleet direct keeps the
existing directional transition — with no cards on screen there is no
position to carry, which is the fallback working as designed.

Closing-review fix (2026-08-03): `onPose` now declines a pose that lands
after the deadline fade has begun (`fadingOut` guard in
`altitude-handoff-ghosts.tsx`) — the flight keyframes start at opacity 1,
so accepting a just-late pose snapped half-faded ghosts back to full
instead of letting the fallback finish.

### V3.1 Demo-scale board — RENDERING

Status: landed 2026-08-02 — measured against the real ENG-027 W4 fleet
(Voltaic, 173 Agents / 10 Projects) plus synthetic 1k/10k headroom tiers.
Unparks the RENDERING half of V2.1 only; the truth half (Initiative-level
aggregation, aggregate Project drill) stays parked.

Rendering strategies, each with the budget it serves:

- **Instancing — population dot fields.** Every aggregate piece (status +
  count per zone) expands into deterministic per-agent status dots packed
  inside its zone rect, drawn as ONE `InstancedMesh` for the entire board
  (`operations-board/population-dots.ts`, pure and unit-tested). Dots are
  banded in board status order, use the exact status-light protocol colors,
  are non-raycastable (zones stay the click target), and carry no per-agent
  React elements or DOM labels. Dot pitch adapts from 1.7 (a handful of
  agents read as substantial marks) down to 0.22 world units; beyond a zone's
  geometric capacity the field downsamples with largest-remainder
  proportional representation and reports `truncated` — the zone's DOM
  control always carries the exact count, so density never lies. Replaces
  the previous six-status-discs-plus-DOM-count-labels treatment (150 drei
  `<Html>` labels at 10k → 0).
- **Density zone sizing.** A focused Project beyond the 120-piece individual
  budget used to emit a footprint sized for thousands of never-rendered
  slots — at 10k the camera fit framed an empty sliver (screenshot in the
  eval report). Aggregated Projects now size to bounded density content
  (`densityZoneRect`), so the giant-Project drill reads as a banded
  population field with correct framing.
- **Label budgets — projected-size zone-label tiers.** Full DOM zone cards
  render only when a zone's projected width affords them (≥290px, with
  hysteresis at 250px); below that a one-line chip (name · count · blocked)
  keeps identity and the drill affordance. Fixed-size cards previously
  covered entire zones at fleet fit zoom, hiding exactly the population the
  scale moment exists to show. The tier flips on boundary crossings only —
  never per frame. Existing piece-label budgets (8 fleet / 32 project)
  unchanged.
- **Transparent-sort correctness.** Dot field and zone plates are both
  origin-anchored instanced meshes, so painter sorting cannot order them by
  depth; an explicit `renderOrder` keeps dots above plates in both
  projections (the fixed-angle projection silently lost the entire field
  without it — triangles drawn, pixels overwritten).
- **Demand-loop parking preserved.** The dot field is static after its
  entrance fade; at aggregate density there are no rotors, so the V2.4
  ambient gates hold and the settled scene renders zero frames.

Measured numbers (canonical run 2026-08-02, review-fixed sampler: percentiles
cover the DRIVEN motion window only — the idle settle tail is excluded, and
gl.render pass bursts are collapsed into presented frames. Headed Chromium,
real GPU, 1400×860, 60Hz-vsynced window; `pnpm eval:spatial:scale`):

| Scenario                                | Agents               | Emitted pieces       | Layout | Glide render-interval p50/p95 | Render CPU p95 (glide/zoom) | Draw calls | JS heap | Parks        |
| --------------------------------------- | -------------------- | -------------------- | ------ | ----------------------------- | --------------------------- | ---------- | ------- | ------------ |
| Voltaic fleet (W4)                      | 173 / 10 Projects    | 48 aggregates → dots | 1.1ms  | 16.7 / 18.5ms                 | 0.4 / 2.5ms                 | 6          | 34MB    | 0 frames     |
| Voltaic fleet, fixed-angle              | 173                  | 48 → dots            | 1.2ms  | 16.7 / 16.8ms                 | 0.4 / 2.4ms                 | 6          | 31MB    | 0 frames     |
| Voltaic project drill (dispatch-engine) | 28 individual        | 28 pieces + controls | 1.2ms  | 16.7 / 16.9ms                 | 0.4 / 0.5ms                 | 13         | 39MB    | n/a (rotors) |
| Synthetic fleet                         | 1,000 / 26           | 148 → dots           | 2.2ms  | 16.7 / 18.0ms                 | 0.3 / 2.3ms                 | 6          | 36MB    | 0 frames     |
| Synthetic fleet                         | 10,000 / 26          | 150 → dots           | 10.2ms | 16.7 / 18.3ms                 | 0.3 / 2.3ms                 | 6          | 38MB    | 0 frames     |
| Synthetic giant-Project drill           | 3,334 in one Project | 6 → dots             | 8.6ms  | 16.7 / 17.7ms                 | 0.5 / 0.3ms                 | 6          | 36MB    | n/a          |

Display-refresh caveat: interval percentiles are vsync-bound — a demand
renderer that keeps up reads exactly the refresh interval (16.7ms at 60Hz,
8.3ms at 120Hz), so cadence says "never missed vsync", not "costs 16.7ms".
The app-cost truths are the render CPU column (≤0.5ms glide, ≤2.6ms during
wheel-zoom bursts at every scale), layout cost, and draw calls. Wheel-zoom
interval p95 stays ≤22ms at every scale. 10k dots ≈ 55.6k triangles —
trivial GPU load. Headless runs gate correctness (park === 0, draw calls,
blank/error checks) but their cadence measures Chromium's throttled
begin-frame scheduler, not the app.

Supporting scaffolding (measurement is a deliverable, not a byproduct):

- `/eval/t10-board-scale` — deterministic fixture: seeded synthetic fleets
  (`?agents=N&projects=P`) and the real Voltaic fleet (`?fleet=voltaic`),
  both altitudes, both projections; exposes layout cost and stats.
- `pnpm eval:spatial:scale` — frame cadence + `gl.render` CPU sampling
  during held-key glide and wheel-zoom bursts, draw calls, heap,
  park-at-rest quiescence gate, 9-point blank gate, screenshots per
  scenario. Headless by default; `SCALE_HEADED=1 SCALE_WINDOW_POS=x,y` for
  real-GPU runs on a non-primary display.
- `t10-board-scale` ratcheted into `pnpm eval:r3f`: max draw calls across
  renders (probe, not a last-render snapshot) is 6 for the 1k board
  including postprocessing passes; gate is 8.
- Demo scale tiers `xl` (1k) / `xxl` (10k) in `MockFleetTransport` and
  DemoControls drive the full route to demo scale; the synthetic project
  list now exceeds the 24-zone budget so the `+N more Projects` aggregate
  zone is exercised.

Also fixed in this pass: the full-route evaluator's Agent-unit locator had
been stale since the status-light protocol landed (2026-07-23) — it matched
pre-protocol aria-labels and found zero units; it now selects
`button[data-board-agent][data-board-status-light]`. All four contexts pass
again.

Known limits, recorded not hidden:

- A zone saturates at its geometric dot capacity (~2k dots at the smallest
  pitch); beyond that the field downsamples proportionally and the DOM
  count stays exact. The 3,334-agent synthetic zone renders ~2k dots.
- Delegated child runs (36 in the W4 fleet) are not board entities; the
  board renders top-level Agents. Delegation topology arrives via ENG-023
  D3 as a Project/Agent-altitude detail, per the design pass.
- Per-status numeric counts left the canvas with the aggregate discs; the
  zone control's health rail and count plus the dot banding carry the
  composition. If dogfood misses the numbers, reopen as a V2.1-truth
  concern, not a rendering one.

Verification: type-check, lint, 1,065 unit tests (23 new: dot-field packing
and density-rect coverage), `eval:r3f` 100/100 across ten fixtures,
`eval:spatial` 4/4 contexts, `eval:spatial:pointer` full pass, production
build, and the scale eval above. Scale-report artifacts (screenshots per
scenario, `results.json`) are regenerable with `pnpm eval:spatial:scale`
rather than committed — rerun it for evidence instead of trusting a stale
local report.

2026-08-02 review fixes (same-day verified review of the V3.1 commits):

- **Minority-status pin.** Largest-remainder downsampling could floor a
  small band to zero dots (1 blocked Agent among 10,000 → 0 blocked dots) —
  an attention-critical status silently vanished from the field. Every
  nonzero band now renders at least one dot, taking the slot from the
  largest band (attention-first when capacity is ever tighter than the band
  count). Pinned by unit tests, alongside new exact-capacity-boundary and
  multi-zone banding tests (population-dots tests 6 → 11).
- **Measurement honesty.** The scale sampler folded a 900ms idle settle
  tail into its cadence percentiles — on a 120Hz display the quoted
  8.3ms p50 was the vsync interval, not a measurement. Percentiles now
  cover the driven motion window only, gl.render pass bursts collapse into
  presented frames, and the table above quotes render-interval p50/p95 and
  render-CPU p95 with the display-refresh caveat stated.
- **Gates match claims.** The park gate asserted `<= 1` while the doc
  claims 0 — now `=== 0` (re-verified 9/9 headless; the harness also
  records whether the pre-sample quiet window was reached so a failure
  distinguishes "never settled" from "re-woke"). `eval:r3f` draw-call gates
  now read a max-across-renders probe instead of the last-render snapshot
  and are ratcheted to observed+2 (t10: 6 → gate 8; t5: 14 → gate 16).
- **Label-tier bound.** Hysteresis keyed off the first visible zone's width
  and only recomputed on zoom; it now uses the narrowest visible zone (the
  zone whose card overflows first) and recomputes when zone widths change.
- **Reduced-motion snap.** `useReducedMotion` initialized `false` and
  corrected in an effect, so reduced-motion users got a ~0.3s entrance fade
  (guide rule 12) in PopulationDotLayer and the preexisting
  ZoneLayer/SelectionRing/AgentPieceLayer pattern. The hook now reads
  matchMedia synchronously; entrances snap.
- **Shared constants.** The dot packer's zone insets derive from
  `SPATIAL_BOARD_ZONE_METRICS` and the density-zone sizing pitch is the
  exported `SPATIAL_DENSITY_ZONE_PITCH` (ui-model), used by both
  `densityZoneRect` (0.35² per dot) and the packer's PITCH_TIERS — a pitch
  change can no longer silently missize density zones (test-pinned).
- Also in this pass: `eval:navigation`'s status-filter click made exact
  (the Team altitude label "…the Agents working them" substring-matched
  `working` after decision 0023's rename), and the untriaged-feedback count
  hook no longer issues a guaranteed-401 Supabase query when signed out
  (console-error noise on every surface that mounts it).

### V3.2 Fleet-altitude command previews

Status: landed 2026-08-03 — the Fleet altitude's command story beat for the
demo arc: selection is a real mechanism, the group verb is an honest
announced affordance, and the board answers "what is this scope doing and
burning" in one compact readout. Lightweight broad strokes by design; no
fan-out mechanism ships (the V3.3-contract boundary holds — band select is
real selection state, "Direct these N agents" is `Coming soon`).

What is REAL:

- **Multi-select.** Shift-drag draws a dashed selection band over the board
  (plain drag still pans — V2.4's grammar stands until V3.3 S1 flips it per
  decision `0024`; shift-drag is forward-compatible with that model, where
  it remains the additive-selection gesture). Shift-click toggles agent
  pieces at every altitude and zone plates at fleet altitude. The working
  set is ephemeral client state (per the V3.3 contract: the single
  inspected Agent stays URL-addressed; a band selection is a working set,
  not an address), pruned live against the filtered fleet.
- **Band-hit semantics** are a pure ui-model selector
  (`selectSpatialBandAgentIds`, unit-tested): visible agent pieces are RTS
  units (center-in-band); zones whose population renders as the V3.1 dot
  field — no per-agent hit targets — are RTS buildings, captured whole when
  the band intersects their rect; zones that do render pieces are owned by
  the piece rule, so a band inside a focused Project never grabs the whole
  Project. Filtered-out Agents never enter a zone capture.
- **Complete DOM/keyboard path** (exit-criteria a11y rule): shift+1–9
  toggles the numbered zone; the focusable zone cards and agent controls
  carry shift-activate (keyboard-synthesized clicks keep modifier state);
  Esc releases the selection before ascending; background click releases
  before ascending (RTS deselect-before-zoom-out order). The keyboard-hint
  bar teaches "⇧ drag select".
- **Selection visuals** reuse the board's existing selection language: the
  dashed-teal `SelectionRing` idiom, drawn as ONE segmented Line2 for the
  whole set (rings on selected pieces, inset outlines on fully-captured
  zones) — static, so the demand loop still parks; the DOM band rectangle
  is positioned imperatively at pointer frequency (guide rule 14).
- **Scope-aware activity readout** (top-left, fleet altitude; any altitude
  while a selection exists): agent count, working/blocked/idle per the D40
  folding the zone health rails already use (working+reviewing / blocked+
  error / idle+complete), and the scope's reported token burn via
  `selectSpatialScopeActivity` over the shared E7 burn derivation —
  absent-never-zero (no figure renders when nothing in scope reports; the
  unreported count is stated when partial). Fleet totals by default; the
  selection's totals the moment one exists. The "known honest divergence"
  this section originally recorded — the fleet metrics strip bucketing
  `error` into IDLE while this readout folds error into blocked — was
  RESOLVED 2026-08-03 by the ENG-008 usage-loop review fixes: core
  `fleet-manager`/`mock-fleet` metrics now use the board's needs-attention
  semantics (error counts as blocked), so the strip and this readout agree
  on the same screen. Roadmap-shaping note: V3.2 was shaped with this readout as a
  `Coming soon` preview before the burn data existed; E7 landed first, so
  it ships real (recorded in the roadmap Amendment chain).

What is ANNOUNCED (and nothing else):

- **"Direct N Agents"** — an `AnnouncedChip` (ENG-026 grammar: dashed
  readiness-neutral, inert contents, `Coming soon` tooltip) in the scope
  readout whenever a selection exists. It presents the future fan-out verb
  and does nothing, honestly.

Owed (recorded 2026-08-03, ENG-008 usage-loop review): a first-class
KEYBOARD path for building a band-scale multi-selection and reaching the
Direct verb. Shift+1–9 and shift-activate cover piece/zone toggling, but
there is no keyboard equivalent of sweeping a band or extending a selection
directionally, and the announced Direct chip is inert by design so it has no
keyboard story yet. Owner: V3.3 S1 already carries the acceptance line "DOM
keyboard path can extend selection (a11y equivalent of band select)"; the
Direct verb's keyboard reachability lands with whatever ships the real
fan-out mechanism. Build nothing before S1 — this note only prevents the gap
from being forgotten.

Verification: `pnpm eval:r3f` 100/100, `eval:spatial` 8/8 PASS (including
the four handoff scenarios), `eval:spatial:scale` all scenarios green
(park === 0, calls=6 at fleet scale — the selection layer adds one draw
only while a selection exists). Scale-eval honesty note: under heavy
multi-agent host load (headless render intervals 250–460ms vs the canonical
16.7ms) the park gate flaked intermittently, on a different synthetic
scenario each run; the t10 fixture passes none of the V3.2 props, so every
addition is provably dormant in those scenarios — the flake is
environmental, not this change. A fully green run exists and the Voltaic
scenarios parked at 0 in every run. Also ui-model selector unit tests, and
a headless
screenshot pass over the Voltaic board: band drag mid-gesture, 58-Agent
band capture with zone outlines + "Direct 58 Agents", shift+1 zone toggle,
project-altitude shift-clicks, and both lenses (the burn lens composes with
selection). `eval:spatial:pointer` was already broken before this change —
it drives the retired "Seed N demo fleet" dev controls; V3.3 S1 owns that
harness's future.

### V3.3 F7 + S3 composition landed (2026-08-03)

The gallery review boundary treats F7 and the S3 tiled-board slice as one
composition problem, per the operator sequencing amendment. The existing F4
tile-material study grew into `/hud-gallery#board-tiles`'s **Fleet board
composition** bench. The operator approved the direction on 2026-08-03 with
one amendment before production wiring: circular Project outlines replace the
large Project hexes, Agent units remain hex tiles, and the production board
must remain WebGL/Three.js for future compatibility.

The accepted composition now ships through the production WebGL/Three.js board
at three explicit resolution tiers:

- **Unit detail** resolves distinct goal-first identity and current activity on
  beveled Agent hexes inside a circular Project boundary.
- **Fleet fit** renders the 173-Agent Voltaic fleet individually in
  population-sized hex units inside population-sized
  circular Projects. Individual Active units alone carry work motion; resting
  states remain still.
- **Very far** is the sole agglomerated tier. Project marks retain stable
  addresses while their area, exact count, active count, and needs-you count
  preserve mass. Fleets above the 240-visible-unit boundary enter this tier;
  drilling a Project restores its individual units up to the existing
  Project-detail budget.

Attention stays anchored to the owning Agent unit or Project in all three
tiers through its redundant status mark; the stable needs-you queue and
minimap carry navigation, with no bell popup obscuring the board. The single
header status strip replaces the audit's three-row preamble and names all five
D40 states with counts, so the board teaches its marks without a manual. The
minimap sizes Projects by population, marks active/urgent state, selection, and
the viewport. Goal-first identity plus the latest non-status activity sentence
replaces harness-title duplication at Project/Agent altitude. The existing RTS
reference remains a control and legibility model only: material, palette,
fixed top-down framing, and stable automatic addresses continue to follow
decisions `0007`, `0023`, and `0024`.

The pure layout is version 2: circular Project footprints expose square
bounding boxes plus radius, use deterministic axial-hex slots, preserve stable
centers across resize, and use circle intersection for selection. The renderer
uses circular WebGL plates, beveled hex Agent bodies, and one instanced shader
draw for shape-redundant D40 aggregate marks. The accepted
`/hud-gallery#board-tiles` study and its isolated T13 route were retired after
production wiring per ENG-036; production is now the only source of truth.

Landing evidence: `pnpm type-check` and `pnpm lint`; 27 pure spatial-board
tests, 11 population-packing tests, and the gallery isolation tests; `pnpm
eval:r3f` 100/100 with zero warnings or errors; all desktop, mobile,
reduced-motion, low-power, and handoff scenarios green in `eval:spatial`; and
all `eval:spatial:scale` scenarios green. The real Voltaic fleet stays at 13
draw calls with 173 individual units; 1k/10k very-far fixtures stay at 6 draw
calls and park at zero frames. The repository's signed-browser doctor and
hosted smoke check pass. This evidence was superseded by the production-review
correction below, which migrates the stale pointer evaluator with the control
change it now proves.

### V3.3 operator correction — controls, continuity, and shared truth (2026-08-03)

Direct production review amended the F7/S3 landing without reopening its
approved shape hierarchy or WebGL/Three.js boundary:

- the bell/hero popup is retired; Agent/Project marks, minimap urgency, and the
  stable needs-you queue carry attention without covering units;
- the standalone in-board D40 legend is retired into the existing header
  metrics strip, which now names and counts all five canonical states;
- arrows walk the nearest visible Agent by pure board-coordinate selection and
  the camera follows; WASD is the secondary keyboard pan binding, while
  plus/minus retain zoom;
- plain primary click-drag draws the selection band and never pans; middle
  drag, WASD, and trackpad/wheel own pan, while a still click continues to
  activate the underlying Project or Agent;
- the default surface has one fleet-wide status strip. The duplicate in-board
  legend is gone, the scope summary appears only for a real multi-selection,
  and its unexplained token-burn figure plus the Status/Burn color-lens control
  are removed from the primary board;
- Project centers remain the same spatial address at Fleet, Project, and Agent
  altitude. Focusing one Project retains every neighboring Project in the same
  WebGL world at Fleet resolution; the minimap always renders those fixed Fleet
  footprints and overlays the live viewport. Stored viewports restore only on
  route entry, never during an altitude change; camera focus is issued only
  when the semantic address or fit actually changes, so live/layout/projection
  rerenders cannot snap an operator pan back to focus. Zone, Agent, and
  population layers survive navigation, and the Agent field inverse-morphs
  from the actual previous frame instead of restarting at the Project origin.
  The radial/floral stagger remains an arrival animation and does not replay
  on semantic zoom;
- local Fleet status consumes the same source-owned working/settled and
  reported-turn facts as terminal tabs. Recent byte timing is now only the
  fallback for sources that report no activity truth, eliminating blue-active
  Fleet units for Sessions whose terminal tabs already show a green result.

This lands F1 and F2 plus F3's primary pointer-grammar flip. F3's explicit
clamp-feedback polish and the remainder of S4's selection-panel consolidation
stay open; this correction does not claim those slices complete.

### V3.3 camera, input, and learnability hardening (2026-08-04)

Operator dogfood of the integrated F7/S3 board found that the composition was
right but its camera still violated the one-world promise: selection inherited
unfinished zooms, projection compensation popped on the last frame, Project
and Agent descent could refit as if entering a new map, manual pan was pulled
back toward focus, and the minimap described a nominal top-down rectangle
rather than the board-plane footprint actually visible in fixed angle.

The camera is now an explicit, modular policy. Pure functions in
`operations-board-camera.ts` own fit, bounded semantic zoom, edge-buffer
follow, projection-continuous zoom compensation, screen-to-board projection,
and the actual board-plane viewport; the R3F rig is only the damped executor.
Altitude changes preserve the current composition, zoom by a bounded amount,
and pan only enough to keep the subject inside an 18–20% safe buffer. Arrow
selection keeps the current zoom and gently follows only when **Follow Agent**
is armed. Any manual pan or zoom suspends follow; the reticle resumes it and
returns the selected Agent to the buffer without dead-centering. Agent descent
uses the same one semantic zoom and never performs a second tight refit.
Top-down/fixed-angle compensation now interpolates continuously through tilt
instead of holding an 8% scale offset until the final frame.

The single world is also now literal at the model boundary. Density-expanded
Projects retain their Fleet-lattice center instead of reappearing at the
origin, every altitude continues to render neighboring circular Projects, and
the minimap always renders fixed Fleet footprints plus the ray/plane-projected
live viewport. Non-focused Project controls compact at lower altitudes so
neighbor context stays legible. Population dots and their DOM identity siblings
morph from the prior stable address while the approved radial/floral arrival
stagger remains entry-only. Compact viewports receive a larger, still-bounded
semantic zoom so 44px direct-touch Agent targets separate.

The input extension to decision `0024` is pointer-specific: mouse/pen primary
drag band-selects, middle drag/WASD/scroll pans, and arrows select; direct touch
uses one-finger pan and two-finger pinch by default, with an explicit **Select
units** mode for band selection and tap for a single Agent. Every rendered
individual Agent also has a focusable DOM path at Fleet altitude, selected
state is exposed through `aria-current`/`aria-pressed`, and selection changes
are announced. This holds the design-system D30 redundant-channel and D40
five-signal contracts without putting WebGL under the accessibility tree.

Chrome now has one fleet-wide status source: the five left-hand D40 counts are
multi-select filter pills, remain global totals, and expose the filtered
`N shown` separately. The duplicate upper-right status filters remain retired;
the in-board scope readout appears only for a real multi-selection; Burn remains
absent from the primary surface. Status-pill requests compose synchronously so
rapid multi-selection cannot lose the first filter while the URL router catches
up.

Regression ownership is proportional to the expected iteration rate. Camera
and pointer policy have dedicated pure tests; board layout pins stable density
addresses; the route eval covers projection-continuous zoom, arrow safe-zone
follow, manual-follow suspension/resume, persistent neighboring Projects,
fixed-angle minimap projection, and multi-select status pills; the pointer eval
covers mouse band selection, secondary pan, cursor zoom, direct-touch pan,
explicit touch band selection, pinch, tap-to-Agent, and reduced-motion parking.
The 1k/10k scale matrix remains green at six draw calls for aggregate tiers.
Landing evidence: lint and type-check pass; the production Next build passes;
the full bounded suite passes 1,602 tests (one opt-in live-provider test
skipped); `eval:r3f` scores 100/100 with zero warnings; desktop, mobile,
reduced-motion, low-power, entry-pose, and fallback scenarios all pass in
`eval:spatial`; the pointer/touch probe and every real/synthetic scale tier
pass. Browser screenshots were inspected at Fleet and focused Project altitude
after the automated gates.

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

## Roadmap milestone log (moved from roadmap.md, 2026-07-24)

On 2026-07-24 `docs/engineering/roadmap.md` was compressed to its contract —
status, concise scope, exit criteria, a one-line milestone list, and links —
so the top-level sequence is readable in one screen. The milestone narratives
and status history that lived in the roadmap until that date are preserved
verbatim below, exactly as written, including their dates. The roadmap remains
canonical for sequence and status; this log is the durable execution detail it
points to. Nothing here is new material: it is the ENG-004 roadmap entry as it
stood on 2026-07-24.

<!-- Verbatim: docs/engineering/roadmap.md ENG-004 entry, 2026-07-24. Do not reword. -->

### ENG-004 Modular UI regimes and Spatial Operations Board

Status: active-build — EXPERIENCE PASS UNPARKED 2026-07-20 (operator): "take us past the spatial experience… super good graphics, really smooth, navigable, excellent transitions between states in spatial mode and between spatial and other modes." V2.4 owns that pass and executes now; V2.1–V2.3 stay gated on dogfood evidence. (History: PARKED 2026-07-10 at the operator dogfood interview while the daily-driver arc landed.) V2.0 **Spatial Operations Board** landed 2026-07-10; V2.1–V2.3 remain planned follow-on work. V0.1–V1.3.1 remain implementation history and evidence, but their immersive 3D composition is superseded. The operator rejected free-camera 3D, floating islands, oversized world objects, and decorative depth after repeated Live Mode review. The replacement is a restrained R3F-rendered 2D/2.5D tactical board: stable automatic Project zones, anchored Agents, semantic zoom, top-down and fixed-angle projections, and a visible transition into the Session workspace. Decision `0007` records the reversal while preserving decision `0003`'s R3F and DOM/WebGL boundaries. Dogfood may reopen visual or interaction hypotheses without reopening the retired motif by default.

Identity note (operator, 2026-07-06; superseded and clarified 2026-07-10): this regime remains distinct from the terminal workspace, but its character is now a **solid operations map**, not an immersive world. Draw from RTS command maps, desktop spatial organization, and restrained dense-canvas tools: stable coordinates, compact pieces, strong selection, a minimap, and useful zoom-level simplification. R3F remains the rendering technology for scale and future visual range; three-dimensionality is optional presentation depth, not the interaction model.

Navigation decision (operator, 2026-07-10): exposé is the middle command
altitude between terminal focus and AgentField. A persistent Electron-shell
control exposes Terminal, Sessions, and Spatial as one continuum with direct
click targets and visible shortcuts. This does not merge the routes or renderers:
xterm/DOM and R3F remain separate regimes over shared session/fleet truth.

Scope:

- keep `/fleet` as the DOM operations UI for dense text, forms, chat, and accessible controls
- keep `/fleet/spatial` as the Three.js / React Three Fiber Spatial Operations Board over the same fleet state
- introduce a pure `@exawatt/ui-model` boundary for shared selectors, view models, spatial layout data, and typed command contracts
- keep the spatial surface in the UI layer; do not let it import provider-specific protocol types or replace Agent Source abstractions
- prepare the spatial surface for later extraction into an independently packageable surface or Electron entrypoint
- make the spatial surface a durable command regime, with the DOM board as a sibling and fallback
- render a stable tactical substrate grouped by Project / Context Group; tiles are visual texture in V2.0, not movement, capacity, or territory semantics
- ship one consolidated spatial route and command model with altitude-specific render regimes: Fleet aggregates Initiatives/Projects and health, Project reveals anchored Agent pieces, and Agent provides orientation before entering the Session workspace
- provide top-down orthographic and shallow fixed-angle projections over the same layout and selection state; do not support free orbit
- preserve automatic deterministic layout now and reserve user-authored placement, drawing, resizing, and persistence for a later named phase
- use depth, lighting, and material effects only when they improve hierarchy and interaction feedback
- introduce Attention Scheduling as a product and UI-model concern for routing scarce human cognition to high-leverage blocker, approval, and decision moments

Exit criteria:

- DOM and spatial fleet surfaces render from the same UI-facing model
- Demo Mode and Live Mode use the same UI-model contracts
- spatial route can select Agents, surface blockers, and enter the existing Session workspace through a quick visible spatial transition
- `/fleet` does not load the Three.js bundle unless the user opens spatial mode
- the first serious demo shows 5–8 Agents across a few Projects as a composed board without planets, floating islands, decorative rooms, or excessive empty world space
- zoom changes information resolution: Fleet summarizes Initiatives/Projects, Project exposes compact named Agent units, and Agent exposes Session orientation rather than scaling the same glyphs
- fleets with tens of thousands of Agents remain navigable through aggregation, instancing, culling, and label budgets rather than one React component or DOM label per Agent
- top-down and fixed-angle views preserve the same stable spatial addresses and command semantics
- pointer, keyboard, and programmatic camera motion share one damped input model with immediate (<80ms) visual acknowledgment and no discontinuous tap kick or free orbit
- every Project and Agent that is selectable in WebGL has a focusable DOM equivalent; reduced-motion and low-power modes preserve the complete command path
- at rest, the demand-rendered scene parks; postprocessing is lazy and low-power gated; performance is measured on the full spatial route, not inferred from isolated draw-call tests
- the roadmap milestones in `docs/engineering/projects/spatial-operations-board.md` are kept current as work lands

Milestones:

- V0.1 Correct the Metaphor (landed): readable 2.5D Project surfaces, agent tiles, and an operator attention lane.
- V0.2 Gorgeous 2.5D Command Surface (landed): liquid glass / metal / crystal material system with tasteful state motion.
- V0.3 Zoom-Resolution Model (landed): fleet, Project, and Agent altitude states with increasing information density.
- V0.4 Attention Scheduling (landed): leverage-aware UI-model selectors for hero attention, secondary attention, and ambient work.
- V0.5 Fleet-Scale Readiness (landed): semantic clustering and progressive disclosure for dozens to hundreds of agents, preparing for thousands.
- V1.0 AgentField Command Surface (landed): live fleet state rendered as the canonical AgentField world (instanced cluster map, hero-sector red, blocked-triage circuit, full keyboard); altitude moves the camera; Console 3D removed.
- V1.1 Feel Pass (landed): camera tuning (framing minimums, gentler flights), held-key glide panning/zoom/orbit, sectors as first-class click/hover targets (generous pick disc + clickable sector labels), drag-guarded clicks, label/tooltip polish.
- V1.2 Meaning Pass (landed): the world shows _why and what to do_ — the hero blocker renders an in-world callout with its Attention Schedule reason (click = select, opening the panel's clear/focus flows), sector labels carry the zone statLine (agents/blocked/$rate), and nodes blip when live activity lands on their agent.
- V1.3 Semantic Regimes & Feel Recovery (landed 2026-07-10): restored the Fleet → Project → Agent information-resolution model; added stable tactile Project/Agent regimes with screen-aligned DOM controls; corrected camera, tooltip, identity, finite-motion, selection, and postprocessing behavior; made narrow layouts scroll to the inspector with compact touch controls; and added a repeatable full-route spatial evaluator covering S/M/L, keyboard descent/ascent, desktop/mobile, reduced motion, low power, WebGL errors, and idle-frame parking. The same pass fixed authoritative Demo fleet replacement so scaling 150 → 8 cannot leave stale agents in shared state.
- V1.3.1 Live Sparse-Fleet Composition Recovery (superseded 2026-07-10): implementation and verification evidence remain useful, but operator review rejected the underlying 3D motif. Its failed sparse fixture remains a permanent regression input for V2.0.
- V2.0 Spatial Operations Board (landed 2026-07-10; B0–B5): canonical reversal and research archive; deterministic board layout; orthographic tactical renderer; semantic aggregation; anchored Agent pieces; projection switcher; minimap and robust controls; visible board-to-Session transition with exact semantic-address return; full S/M/L/XL, accessibility, performance, Electron-navigation, and visual acceptance gates. Detailed phase contracts and evidence live in the project doc.
- V2.1 Scale & Truth (planned): verify density and interaction budgets at 1k, 10k, and representative higher synthetic counts; Initiative-level aggregation; aggregate Project drill; viewport culling; label budgets; frame/memory instrumentation. Live-data truth already enters through ENG-002 W0.3.
- V2.2 User-authored spatial organization (planned): opt-in drag/reposition, selection groups, drawn/resized Project or team zones, layout persistence, automatic-layout reset, conflict-safe layout versioning, and keyboard equivalents. Draw inspiration from RTS piece manipulation and desktop icon organization without turning layout into source-of-truth ownership semantics.
- V2.3 Consolidation (planned): decide from dogfood evidence whether spatial becomes the default fleet view; integrate command palette actions; retain `/fleet` as the accessible dense-text sibling and `/hud-gallery` as a development workbench.
- V2.4 Experience pass — graphics, motion, navigation, transitions (landed 2026-07-20, same day as the unpark; operator visual acceptance pending as dogfood evidence): the V2.0 board is correct but visually flat and mouse-blind; the operator asked for a top-notch experience. Scope: (a) world materiality — lit Project zone plates with per-project accent edges, depth-reading fixed-angle projection, radial-fade grid, emissive status cores on Agent pieces, animated selection, lazy low-power-gated Bloom/Vignette; (b) motion — mount-keyed entrance choreography, breathing status pulses, choreographed altitude flights with crossfading DOM controls; (c) direct navigation — pointer drag-pan and wheel zoom-to-cursor joining the same damped camera model (click guards preserved; still no free orbit); (d) transitions — directional regime overlay (ascending zooms out, descending zooms in), arrival dolly into the board, polished enter-session dive. AMENDS the V2.0 parked-at-rest gate: the visible scene may carry ambient status motion; it parks under reduced motion, low power, and hidden tabs. Decision `0007` constraints (restrained board, ortho projections, DOM chrome ownership, keyboard-first) all hold.

Sequencing note (amended 2026-07-10): V2.0 replaces the V1.3.1 acceptance gate. Execute it in pushed, independently verified phases: canon/research/decision; pure layout model; top-down board; projection/minimap/interaction; Session transition; full release reconciliation. Do not start V2.1 scale optimization or V2.2 manipulation before V2.0 passes its real sparse Live Mode and Demo acceptance fixtures. Do not overinvest in cinematic transition machinery: prove a fast, reversible continuity cue using existing route and terminal lifecycles first.

Per-milestone acceptance detail and progress logs live in the project doc; keep both in sync as work lands.

Project doc:

- `docs/engineering/projects/spatial-operations-board.md`
