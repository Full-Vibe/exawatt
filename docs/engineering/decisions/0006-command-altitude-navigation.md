# 0006 — Present terminal, session overview, and Spatial as one command altitude

Date: 2026-07-10
Status: accepted

## Context

Exawatt already had three useful scales: one active terminal session, an exposé
overview of live sessions, and the Spatial Command field. They shared session
truth and keyboard commands, but the app presented them as disconnected routes.
The only visible Spatial affordance in the terminal was a small bottom key hint,
so a first-time Electron operator reasonably concluded there was no way to get
there. A hidden shortcut is not navigation.

Options considered:

1. Keep the routes independent and improve help text.
2. Merge terminal and R3F rendering into one literal zoomable scene.
3. Preserve the renderer/route boundaries but present a shared, persistent
   three-level command-altitude navigator.

## Decision

Choose option 3. The Electron app shell presents:

- **Terminal** — near altitude, direct xterm control;
- **Sessions** — middle altitude, exposé overview;
- **Spatial** — far altitude, Project/Agent fleet command.

All three levels remain directly clickable from terminal and spatial routes.
`/workspace?view=sessions` addresses the middle altitude. `⌘O` remains the
Session Overview gesture and `⌘⇧M` remains the direct Terminal ↔ Spatial toggle,
including while xterm owns focus. The control labels the shortcuts instead of
requiring prior knowledge.

Refinement (operator, 2026-07-11): Sessions behaves like a Mission Control-style
transient overview rather than an application-modal dialog. It preserves the
originating Session, uses arrows/J/K for selection, Enter to open, and Escape or
`⌘O` to return. Obscured workspace chrome is inert, but the shell-level altitude
control remains reachable. Escape remains owned by the running TUI while xterm
has focus; Spatial uses Escape only to clear its own Agent/Project selection.

The direct Terminal ↔ Spatial gesture routes through one finite transition
owner. This shared motion/command contract is the extension point for making
the regimes feel like one game board over time; it does not merge the xterm and
R3F renderer boundaries. The shell restores the last altitude, Spatial semantic
filters are URL state, and bounded camera return state is session-local.

## Consequences

- Navigation and orientation feel continuous without loading Three.js into the
  terminal route or rendering terminal text in WebGL.
- Running PTYs remain owned by Electron main and survive renderer route changes.
- Session Overview becomes URL-addressable and testable as an app state.
- Motion may reinforce the altitude change but must use finite transform/opacity
  transitions with reduced-motion parity; it may not delay navigation.
- The shared navigator is shell-level UI, not a new product concept or a second
  roadmap layer.
