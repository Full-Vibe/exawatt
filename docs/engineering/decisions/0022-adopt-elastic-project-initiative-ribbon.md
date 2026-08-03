# 0022 Adopt an elastic Project / Initiative ribbon

Date: 2026-07-27
Status: accepted, expected to evolve with the Initiative primitive.
AMENDED 2026-08-02 by ENG-016 D42 and 2026-08-03 by ENG-016 D45 — see the
Amendment sections below.

## Context

The Terminal strip rendered every open Project as one indivisible flex box
containing every Session tab. At real dogfood density—6–12 Projects and 15–40
top-level work contexts—a large Project owned an entire row, empty Projects were
stranded between active groups, and four wrapped rows could consume most of a
short terminal window. The close-last-Agent exit scaled pixels but retained its
layout width, then removed the group and applied a second FLIP animation. It
looked like no reflow because there was no continuous shared layout transition.

The product hierarchy is also becoming clearer. The operator thinks first in
Projects, then in durable initiatives/goals with any number of Agents working
against them over time. Current tabs remain Session-backed and roughly
one-to-one with Agents, while ENG-005 owns the future Initiative primitive and
ENG-023 is adding visible subagent truth. Creating another top-level tab for
every child would make the density problem worse and encode the wrong altitude.

## Decision

- Terminal uses a measured, source-agnostic elastic ribbon whose layout model is
  pure and independently testable. Project headers and Initiative-shaped tabs
  are individual layout atoms rather than nested indivisible flex groups.
- The ribbon has a hard two-row budget. A priority-aware overflow algorithm
  keeps the selected Project and selected tab visible without changing manual
  order; excess work opens through the existing overview/search surface.
- The selected Project auto-expands. Inactive Projects remain compact unless
  the operator explicitly keeps them expanded. Manual disclosure persists in
  workspace layout state and is deliberately exposed through one tuning seam.
- Project order remains manual and stable. Empty inactive Projects are the one
  automatic partition: after a short tunable dwell they move, with motion, to a
  dormant tail while preserving relative order on both sides. They remain open
  objects. Selection restores manual position; starting work repopulates them.
- Natural last-Agent close does not close the Project. `Command-W` on an empty
  selected Project and **Close project** remain explicit Project-close verbs.
- Current Session-backed tabs are described architecturally as
  Initiative-shaped projections, not as a prematurely completed Initiative
  model. Future Initiatives may own any number of Agents and Sessions.
- Subagent work from ENG-023 aggregates into its parent tab and compact Project
  signal. Attention, fault, result, own-turn work, and delegated work can change
  the signal; none may auto-expand or reorder a Project.
- Motion consumes shared target bounds. Surviving items translate with a
  210-millisecond emphasized ease while removed items condense from the right;
  pointer close briefly preserves the old slot so close targets do not jump.
  Layout responds to interruption from the currently rendered transform.
  Reduced Motion sets every ribbon transition duration to zero.
- Project header status, disclosure, and dormancy affordances reserve constant
  footprint even when their visible state disappears. State churn must not
  silently resize every later target.

## Consequences

- Terminal chrome is one row when it fits and at most two rows under realistic
  fleet density, returning vertical space to the active work surface.
- Multiple Projects can remain expanded, but density no longer grows without a
  bound. The overview is a first-class overflow route rather than accidental
  clipping or microscopic text.
- Project selection, manual disclosure, empty-tail partition, and explicit
  close are separate state transitions. Tests must not collapse them into tab
  count alone.
- Layout tests assert target rectangles, priority admission, and forty-item
  density. Browser evaluation samples intermediate animation frames,
  pointer-close stability/release, wide/narrow geometry, dormant reordering,
  and reduced motion. DOM class assertions alone are insufficient evidence.
- The exact dwell and motion constants are product tuning parameters. Changing
  them does not require another architecture decision unless the state model or
  object boundary changes.

## Supersession

This decision amends decision `0013`'s 2026-07-22 close-last-Agent behavior and
ENG-016 D37. Durable Project opening remains separate from Agent launch; only
automatic deletion of the exhausted open group is reversed. It also evolves
D20's arrangeable strip without changing its manual-order or keyboard contract.

## Amendment (2026-08-02, ENG-016 D42)

The first sustained dogfood round found that collapse-by-unmounting destroyed
information (tab count, per-Agent needs-you/blocked, ordinal-hint anchors),
that the animated strip height relayouted the terminal on every row-flipping
switch, and that admission priorities could hide the active Project's own next
tab while inactive chrome stayed. The disclosure and motion model evolves:

- Inactive Projects' tabs CONDENSE in place to glyph chips (status + dimmed
  source mark, identity in the tooltip) instead of unmounting. Selection is a
  presentation change on stable nodes, not an exit/enter storm. The persisted
  **Keep expanded** disclosure now means "full-width when inactive".
- The strip's outer height is selection-invariant: it reserves the rows of
  the tallest hypothetical selection (`stableRibbonRows`), changes only on
  data changes, and SNAPS without a transition — zero terminal resizes per
  switch, exactly one per row-flipping open/close.
- Admission priority puts the active Project's remaining tabs ahead of every
  inactive Project's chrome, and a tab is only admissible alongside its
  Project header (no orphan chips).
- Rearrangement is pointer-based: the real chip follows the pointer with
  live sibling re-targeting through the same pure layout engine; HTML5
  drag-and-drop and its inset drop line are deleted.

The two-row budget, manual order, dormant empty-Project tail, explicit-close
verbs, overview overflow route, and Reduced Motion contract stand unchanged.
For inactive-Project tabs this narrows ENG-021 E1.1's visible-identity rule:
condensed chips carry glyph identity plus tooltip; visible text identity is
owed by the active and explicitly disclosed Projects' tabs.

Same-day review refinements: width measurements cache per presentation and
each height variant reserves the active Project's dead tabs uncollapsed, so
tab clicks and stopped-tab selection changes are also height-invariant; the
D23 dead-chip hover-unfurl is deleted (a reveal must not shift layout or
feed the width model); Projects group by SPACING (a wider inter-Project gap)
rather than by border tint alone; dormant chips are outside the drag system
entirely; and the active tab and Project carry `aria-current`.

## Amendment (2026-08-03, ENG-016 D45)

Dogfood on the installed D42 build showed the two-row budget still deciding
how much of the ribbon you could see: at 1100 px a five-tab active Project
evicted every other Project's chips, while a one-tab Project showed all
thirteen. Wrapping also let items hop between rows, which the operator
ranked as the ribbon's worst motion. The overflow model is replaced:

- The ribbon is **one row**. The hard two-row budget, the wrap packer, the
  priority admission ladder, and the `+N` overview button are retired.
  Height is now constant by construction rather than by the reserved-rows
  machinery D42 needed, and row hopping is structurally impossible.
- **Nothing is evicted.** Three presentations exist and the engine picks
  them: `open` (the active Project — tabs with titles, shrunk Chrome-style
  toward a floor), `mini` (glyph chips), `folded` (one container chip
  carrying the Project's Session count). A Project folds rather than
  disappearing, so its work is always represented.
- **The presentation set is selection-invariant.** The fold budget is
  computed for the worst case — the Project with the most tabs being the
  open one — so what an inactive Project looks like does not change when
  you switch Projects.
- **Horizontal scroll with edge fades is the last resort**, used only when
  a fully folded row still overflows; the active Project scrolls into view.
- The manual **Keep expanded** disclosure and its `◇` control are deleted
  (operator: "I had no idea what that did as a user"). Manual Project
  order, the dormant empty-Project tail, explicit-close verbs, pointer
  reorder, and the Reduced Motion contract are unchanged.
- Motion: width snaps and position tweens; the only remaining scale is a
  closing Project's retraction, which is a data change rather than a
  selection change.
