# 0050 Fleet view is a versioned presentation preference over one shared tile renderer

Date: 2026-10-14
Status: accepted for planning; implementation pending ENG-004 V4.1

**The Fleet board gains a second presentation, Tiles (Fleet view v2): the
homepage's agent tiles drawn flat over the board's existing layout, chosen
in Settings and stored as a versioned presentation preference that is not a
theme.** The homepage and the product draw tiles with one shared renderer.

## Context

The homepage fleet story (ENG-031 W15, decision `0047`) earned its agent look
over eleven operator review passes: rounded hex tiles in Gummy, Acrylic or
Anodized, harness marks, working motion, and a keyswitch press. The operator
asked for it in the product on 2026-10-14: "I want a less spherical version
in the product. Investigate what it would take to adopt this UI in Fleet
view, in a modular, robust, performant, high-quality way... We should version
and flag it, like Fleet View v1 / v2, perhaps with a toggle in settings. Then
over time we may have more UI prefs in there (e.g., material, behavior,
camera, etc.) if users demand such."

The investigation found the two boards closer than they look:

- Both lay agents out on a flat hex grid. The homepage packs its Projects on a
  plane and bends tiles onto a globe only at one placement step. The product's
  `SpatialBoardLayout` is projection-independent, already a honeycomb (V3.9),
  and reaches the world through one seam (`boardWorldPoint`), which V4.0 built
  so that "a globe or parallax lens is a bounded module implementing an
  existing interface".
- The board surface has one renderer slot, `OperationsBoardCanvas`, with a
  typed prop contract and an imperative camera handle. Everything above it
  (layout, route, selection, keymap, hover store, selection panel, chrome) is
  renderer-agnostic.
- The homepage renderer is not product-ready: it is keyed by array index on a
  synthetic fleet of at most 300, rebuilds its instanced meshes when the count
  changes, paints every frame, has no keyboard path, and has no Not-reported
  reading.
- No feature-flag system exists. The Backgrounds preference (`goalVisuals`) is
  the end-to-end template for a device-local preference.

## Decision

1. **Two presentations, one board.** `v1` (Dots, today's board) and `v2`
   (Tiles) are interchangeable renderers in the `OperationsBoardCanvas` slot.
   Both implement the same props and `OperationsBoardHandle`, read the same
   `SpatialBoardLayout`, keep the same `data-board-*` attributes and DOM hit
   targets, and obey the same control model (decision `0024`). A presentation
   never owns layout, addresses, selection, routing, or status truth. No
   second layout is created; Tiles adapts the existing one.
   **One switch.** The preference is read in exactly one place, which picks a
   module from a small registry of views (`v1`, `v2`) and mounts it in that
   slot. Each view is its own lazily loaded chunk, so a Dots user never
   downloads Tiles. Nothing below the switch branches on the preference: code
   the views share (the orthographic rig, the DOM controls) is a shared
   import, and where chrome must differ (Tiles may have no Top/Angle choice)
   the view's registry entry declares what it supports and the chrome reads
   that declaration, never the preference.
2. **One tile renderer for the homepage and the product.** The tile shape,
   materials, marks, working motion, press springs and sound move out of
   `src/components/site/fleet-story/` into a shared module. The homepage keeps
   its scroll story, camera rails and concept marks on top. The ground is a
   parameter (`sphere` for the homepage, `plane` for Fleet), so the two cannot
   drift and the homepage stays a picture of the product.
3. **Flat and isometric first.** Tiles uses the board's existing orthographic
   rig at its fixed angle. Ground curvature stays a renderer parameter and
   the camera stays behind the existing handle, so a gentle curve or a
   perspective camera can arrive later as its own slice. Neither is built
   now (operator: "Start with 1 for now").
4. **A presentation preference, not a theme.** Decision `0026` forbids a theme
   from owning motion, layout, density, geometry or camera, so Fleet view lives
   in its own top-level settings record, `presentation: { schemaVersion: 1,
   fleetView?: 'v1' | 'v2' }`, never inside `appearance`. Its parser is total:
   an unknown version reads as absent, so an older build never quarantines the
   settings file. Only an explicit choice is stored; absent resolves to the
   runtime default, `v1` (Dots), so a later default change moves everyone who
   never chose.
6. **Settings is the flag, and it only offers what works.** No separate
   feature-flag system is built. Until Tiles reaches parity (V4.1 P5), the
   Tiles option appears only in development builds and on the board bench;
   no released build can select it. At P5 every build offers it, labelled
   Preview, and a stored `v2` from a development build stays honoured.
   Future material, motion, camera or sound choices are added to this record
   when users ask for them, not before.
5. **The product's rules bind Tiles.** The demand frameloop, the ambient power
   cadence, one motion owner, reduced motion, the layout budgets and instance
   ceilings, the D40 status glyph with its unread corner and the Not-reported
   reading, and calm attention (needs-you and fault never pulse) all hold.
   Tiles may tint the agent body with its status, as the homepage does; that
   amends the design-system rule that status colour lives only in each
   Agent's light, for Tiles only, when V4.1 ships.

## Consequences

- The V2.0 restraint against "material spectacle" in the project doc governs
  Dots. Tiles brings the homepage's material language deliberately and opt-in;
  every other V2.0 prohibition (orbit controls, planet-like marks, floating
  islands) still holds.
- Tiles' modules join the board's landing gates (`BOARD_CANVAS_MODULES`), and
  the scale, motion and host-power evals learn to read it.
- Extracting the renderer must leave the homepage pixel-identical; before and
  after captures at every scene and at phone width are the evidence.
- Analytics stays closed: reporting the choice needs an allowlist bump under
  decision `0031`, and is not part of this decision.

## Not decided here

- Whether Tiles becomes the default. That is the operator's call after living
  with it.
- How delegated children look on Tiles beyond "distinct from their parent,
  connected to it" (operator, 2026-10-14: "I'll probably iterate on that over
  time").
- Whether Material becomes a Settings row at launch; the board bench review
  decides.
