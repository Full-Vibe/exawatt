# 0023 Command-altitude names and the transition model

Date: 2026-08-02
Status: accepted; the middle-altitude name is provisional pending a holistic brand pass

## Context

The command-altitude continuum has carried the labels **Terminal · Sessions · Spatial** since ENG-015 S3.1. Two of the three are implementation words and the third names a rendering shape rather than a thing the user is looking at. The 2026-08-02 operator brief called this out directly: "We need better names than 'Terminal', 'Sessions', and 'Spatial'."

The brief also asked for "much smoother, sexier, best-in-class visual transitions between command altitudes," with "visual, recognizable metaphors" connecting them. That ask collides with a hard architectural fact: Terminal and Sessions are one DOM document, while Spatial is a separate route rendering WebGL through R3F. There is no cheap way to fly a live xterm pane into a 3D board, and canon already rejects trying — ENG-004's exit criteria require that zoom change *information resolution*, not glyph scale.

## Decision

### Names

The altitude ladder is **singular → group → everything**, in plain language, per vision principle 6 (mom-friendly language, power-user depth):

| Position | Name | What you are looking at |
| --- | --- | --- |
| near | **Agent** | one live Agent, its terminal, its work |
| middle | **Team** | your Projects and the Agents working them, together |
| far | **Fleet** | all of it, at population scale |

- **Agent** is adopted now for the near altitude. It mildly collides with `Agent` the canonical noun, and that is accepted: at that altitude you are always looking at exactly one Agent, so the label reads correctly in place.
- **Team** was chosen by the operator on 2026-08-02, replacing the provisional "Work". It says the person → team → fleet ladder literally and puts the agent-team thesis in the navigation itself. The known cost is accepted: it claims a collaboration model that does not fully exist yet, which vision principle 8's readiness grammar must therefore carry honestly at that altitude rather than implying agents already coordinate.
- **Consequence — the human/enterprise surface cannot also be called Team.** ENG-026's surface map is amended: the members/permissions/spend surface for human colleagues is **Organization**, which also matches the Workspace tenancy vocabulary and the IT/SCIM framing in ENG-012. Two Teams in one product is exactly the kind of collision this decision exists to prevent.
- Labels are manifest data (`src/components/nav/surfaces.ts` is the single typed source), so renaming is a one-file change and does not justify deferring.
- **Blocker to resolve before the far altitude takes the name `Fleet`:** the legacy demo surface at `/fleet` is currently named "Fleet Command". Two names cannot both be Fleet. The legacy surfaces are already out of primary navigation and slated for retirement; retire or rename that surface as part of the rename, do not ship the collision.
- Route paths are not part of this decision. `/workspace` and `/fleet/spatial` may keep their URLs; user-facing labels are what change.
- **Timing (operator, 2026-08-02): the rename lands BEFORE the demos**, so audiences hear plain language instead of implementation words. It must be **holistic in one sweep**, not a manifest edit: the navigation manifest, shortcut and menu labels, window titles, `⌘K` and cheat-sheet copy, in-app strings, `AGENTS.md`, product and engineering docs, and any guide or marketing surface that names an altitude. A half-rename is worse than none, and future guides and marketing (ENG-031) inherit whatever is true when they are written.
- The legacy demo trio (`/fleet`, `/dashboard`, `/board`) is **retired** as part of this work (operator, 2026-08-02). That frees the `Fleet` name, and ENG-027's Demo Workspace supersedes the trio's entire purpose — showing the product without live agents.

### Transition model

**Position handoff, with a directional cut as the guaranteed fallback.**

- **Agent ↔ Team** is one DOM document and is genuinely continuous: the focused pane and its tile are the same object at two sizes.
- **Team ↔ Fleet** crosses the DOM→WebGL boundary. The board's entry camera pose places each Project/Agent node at the screen position its card occupied; cards crossfade into nodes in place, and only then does the camera pull back and the fleet resolve. The renderer swap is invisible because nothing moves during it.
- What carries across is **identity and position**, never content. Project color, emblem, and selection persist; terminal text does not travel and is not expected to.
- **Agent → Fleet** directly (one keystroke skipping the middle) runs the same motion continuously through both stages, faster — not a different animation.
- The existing single transition owner (ENG-016 D11) stays the only implementation. It hard-cuts to a fast directional transition whenever the target is not ready within its frame budget, under reduced motion, in low-power mode, or on any failure. Falling back is a normal outcome, not an error.
- Transitions never block input. An operator who keeps typing or presses another altitude key during a transition is always obeyed immediately.

## Consequences

- Sessions layout and board layout must agree on positions well enough to hand off. That coupling is real work and is the main risk in the design; the fallback cut is what makes taking that risk safe.
- The board gains a required "entry pose" concept: a camera pose derived from incoming screen positions, distinct from its resting pose.
- The rename touches the navigation manifest, shortcut labels, menus, docs, and roadmap prose. One sweep, before the demos; until it lands, docs may continue to say Terminal/Sessions/Spatial and mean Agent/Work/Fleet.
- Naming the far altitude Fleet forces the legacy `/fleet` retirement, which ENG-016 already wanted and never scheduled. Now scheduled: the trio retires with the rename.
- Retiring the trio deletes the legacy Supabase demo task flow's surfaces. Check `docs/product/demo-mode.md`, which still documents them as the current primary demo implementation, and reconcile it to ENG-027's Demo Workspace in the same sweep.

## Alternatives considered

- **Brand-native names (Console · Grid · Field).** Rejected by the operator in favor of plain language, though `Field` survives internally as the AgentField component name.
- **Identity-only handoff** (selected item stays lit, positions unrelated). Cheaper and layout-independent, but it reads as one *product* rather than one *space*; kept as the concrete shape of the fallback path.
- **Rendering xterm into WebGL** so terminals are literally zoomable objects on the board. Rejected: expensive, fidelity-losing, and contrary to the zoom-changes-resolution rule.
- **Deferring the rename entirely** until the brand pass. Rejected because labels are manifest data and the demos are now; the middle name stays provisional instead.
