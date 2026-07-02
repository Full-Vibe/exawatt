# Agent Terminal Workspace

Roadmap item: ENG-002

The dogfood-parity workspace: replicate the canonical operator workflow
(`docs/product/operator-workflow.md`) inside Exawatt — initiatives → windows
→ session tabs, parallel coding agents in git worktrees — then improve it
incrementally. Terminal hosting approach is decision `0005` (node-pty +
xterm.js in Electron; session-manager boundary so a detachable backend can
come later).

## Product framing

- The gesture is **ignite an agent**, not "open a terminal": pick a harness
  (Claude Code, Codex, plain shell), pick or create a git worktree, go.
- The view is **tmux-like**: the operator talks to harness TUIs directly.
- The structure is the operator's mental model: one window per initiative,
  many tabs per window.
- The spatial surface (ENG-004) is this workspace's GPU overview/switcher —
  game-level graphics for managing terminal agents. Terminal text stays DOM
  (decision `0003` hybrid rule).

## Milestones

### W0.1 PTY foundation

Status: landed

Scope:

- node-pty in the Electron main process (one PTY per session), xterm.js in
  the renderer, IPC streaming (data, resize, exit), `@electron/rebuild`
  wired into the Electron build
- spawn a plain shell AND an interactive Claude Code session in a chosen
  working directory
- session-manager boundary: spawn / attach / write / resize / kill /
  serialize (decision `0005`)
- update `src/lib/architecture/manifest.ts` + `architecture.md` (doc
  contract) when the subsystem lands

Acceptance criteria:

- Claude Code's TUI is fully usable inside an Exawatt tab (colors, cursor,
  resize, scrollback); same for vim and htop
- killing the tab kills the PTY process tree; no orphans

Progress log (landed 2026-07-02):

- `electron/main/pty/session-manager.ts`: PTY-per-session owner (spawn /
  write / resize / kill / list / buffer / serialize) with a ~200 KB
  scrollback ring buffer per session so late-attaching panes and renderer
  reloads replay output. Harness CLIs run through the user's login shell so
  PATH resolves like a real terminal. `pty-ipc.ts` bridges to the renderer;
  app `before-quit` kills all sessions (no orphans).
- `/workspace` route + `WorkspaceClient`: ignite buttons (Claude Code /
  Codex / Shell) with a working-dir input, tab strip with harness-colored
  diamonds, cmd+T / cmd+W / cmd+1-9. Panes stay MOUNTED when inactive
  (CSS-hidden) so no output is lost on tab switch; on web it renders a
  "desktop app required" notice (no hydration branch — electron detection
  runs post-mount).
- Verified via Playwright's Electron driver: shell echo round-trip
  (keystrokes → PTY → xterm buffer), real Claude Code TUI boots and renders
  in a tab, tab switch preserves buffers, zero page errors.
- Build note: `pnpm electron:rebuild` (@electron/rebuild) needs network for
  Electron headers; offline fallback is `node-gyp rebuild --nodedir=<extracted
  headers>` inside the node-pty package (headers fetchable via curl from
  electronjs.org/headers). node-pty resolves `build/Release` BEFORE
  `prebuilds/`, so the Electron-ABI build wins; a fresh install wipes
  `build/` and the rebuild must be re-run.
- Known W0.2 targets from this pass: initiative windows, worktree
  create/pick in the ignite flow, layout persistence, richer tab titles.

Day-1 bar (operator question pending; proceeding on assumption): all four
candidates are treated as must-haves — full TUI fidelity, restart
persistence of layout, one-gesture worktrees, Spaces-speed switching.

### W0.2 Workspace parity

Status: active-build

Scope:

- initiative-labeled windows containing session tabs (thin ENG-005 slice)
- the ignite flow: harness picker + worktree create/pick in one gesture
- restart persistence: layout, names, worktrees, working dirs restored
  (processes are not preserved in v0)
- fast keyboard: initiative/window/tab switching at macOS-Spaces speed

Acceptance criteria:

- the operator can reconstruct their current macOS setup (2+ initiatives,
  several tabs each, 1–6 agents) inside Exawatt in under five minutes
- day-1 must-have list confirmed with the operator (open question below)

### W0.3 Fleet truth

Status: planned

Scope:

- per-session status detection (running / waiting-on-input / blocked /
  done) normalized into FleetState alongside the existing mock + headless
  paths (ENG-003 adapter boundary)
- `/fleet` and `/fleet/spatial` show real sessions truthfully

Acceptance criteria:

- unblocks ENG-004 V1.3 (live data on the spatial surface)

### W0.4 Context layer

Status: planned

Scope:

- window/tab naming; auto-summarized micro-context subtitles ("what was I
  working on here?") from recent scrollback via a cheap model call
- context-augmentation groundwork for the 1–6 coding-agent case

### W0.5 Spatial cockpit

Status: planned

Scope:

- the ENG-004 surface as the daily overview/switcher over live terminal
  agents: sectors = initiatives, nodes = sessions; click/keys jump to the
  terminal tab

## Open questions

- Day-1 must-have bar for the operator to switch daily work into Exawatt
  (candidates: full TUI fidelity; restart persistence of layout; worktree
  helpers; global-hotkey-grade switching) — pending operator confirmation.
- Codex interactive specifics (TUI behavior under PTY) to validate in W0.1.
