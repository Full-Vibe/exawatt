# 0024 Adopt the RTS unit-control model for the Fleet board

Date: 2026-08-02
Status: accepted

## Context

An operator UX pass on 2026-08-02 (driven hands-on at four fleet scales, with
frame timing) found the board "chunky and clunky": altitude changes are cuts
dressed as flights with 500–1400ms stalls, plain scroll input is frequently
eaten by pan clamping, arrow keys pan the camera when the operator expects
them to walk units, pieces read as flat status moons with identical labels
("exawatt · Claude Co…" four times in one real Project), and the world carries
almost no information — identity, goal, and activity all live in scattered
edge chrome the operator reports never using.

Asked what the board should feel like, the operator named the comp directly:
*"I'm envisioning Starcraft manipulating units on the map… Maybe the scroll
wheel, trackpad, pans around and then click and drag draws selection boxes,
just like Command and Conquer Unit Control would."* And on rendering: *"the
noun primitives just look super low quality and basic. Just boxes with
background colors — we chose R3F/WebGL for a reason, and that was to push the
UI more."*

## Decision

The board's control model is the classic RTS unit-control grammar, adopted
coherently rather than piecemeal:

- **Click-drag on the board draws a selection box** (band select). This is the
  anchor of the model and REVERSES V2.4's drag-to-pan. Single click selects
  one unit; a modifier extends the selection. Multi-select is real selection
  state; what bulk COMMAND does with it stays governed by ENG-004 V3.2's
  preview boundary (no fan-out mechanism ships early).
- **Scroll wheel / trackpad pans.** Pinch and ctrl-wheel zoom at the cursor,
  plus explicit zoom keys. Pan clamping must never eat input silently: at the
  clamp edge the camera communicates the bound (a short damped overshoot)
  instead of ignoring the gesture.
- **Arrow keys walk units spatially** — selection moves to the nearest piece
  in the pressed direction, and the camera follows the selection. They no
  longer pan the camera. Camera-only movement gets its own keys (held-pan on
  a secondary binding), because unit navigation is the primary keyboard verb.
- **Selection has a command surface.** Selecting a unit (or units) populates
  one game-style selection panel — identity, status, current work, recent
  meaningful events, and the unit's commands (open Session, etc.). The
  free-floating inspector and the global activity-exhaust feed fold into it;
  a status line of top-level fleet stats survives as chrome.

## What this does NOT change

- Decision `0007` holds in full: no free orbit, no immersive-world motifs,
  deterministic top-down/fixed-angle projections, layout stays in
  `@exawatt/ui-model`. An RTS *control grammar* on a tactical board is the
  opposite of the rejected free-camera world — the comp is StarCraft's
  command clarity, not its terrain fantasy.
- Decision `0023`'s transition model (entry pose, directional fallback cut)
  is unchanged; this decision is about in-board control, not cross-altitude
  handoff.
- DOM remains the accessibility owner: every selectable unit keeps a
  focusable DOM equivalent, and band select gets a keyboard-equivalent path
  (walk + extend-selection modifier).

## Consequences

- V2.4's pointer grammar (drag-pan, plain-wheel pan) is superseded on the
  board surface. The project doc's interaction contract is amended by the
  2026-08-02 UX-pass section.
- Selection becomes plural across the board's selection state, DOM controls,
  and URL address handling (single selection stays the URL-addressed case;
  band selections are ephemeral).
- The board owes the operator a visible selection rectangle, drawn in-world
  (WebGL), with the same damped feel as the rest of the camera model.
