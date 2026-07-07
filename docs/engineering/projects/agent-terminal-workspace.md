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
- Terminal text and controls stay DOM (decision `0003` hybrid rule).
  AMENDED 2026-07-06 (operator): the spatial surface is NOT this
  workspace's overview/switcher — the regimes deliberately diverge. This
  regime's excellence arc (attention, speed, exposé/motion, context
  paging) is ENG-015 (`stellar-small-fleet.md`); the map evolves
  separately (ENG-004) toward an RTS-style at-scale command surface.

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

W0.4 progress log (landed 2026-07-03):

Known limitation (dogfood round 3): auto-revive uses `claude --continue` /
`codex resume --last`, which resume the MOST RECENT conversation in that
directory — including conversations started outside Exawatt (e.g. iTerm).
Revived tabs now announce this with a dim marker line. Follow-up: capture
the harness session id at ignite time and revive with `claude --resume
<id>` so Exawatt only ever resumes its own threads.

- Micro-context subtitles: `electron/main/pty/context-summarizer.ts`
  periodically summarizes each session's recent scrollback into a ≤8-word
  subtitle. Engine = the operator's authenticated `claude` CLI (`-p`,
  haiku) through the login shell — zero key management. Cost discipline:
  one in-flight call globally, one session per sweep (most fresh output
  wins, counter consumed either way so escape-heavy TUIs can't starve
  others), ≥400 new bytes to qualify, 3 consecutive failures disable it
  for the run. Scrollback is ANSI-stripped and FENCED as untrusted in the
  prompt; output is sanitized (first line, control chars stripped, 64-char
  cap). Timeout kills the whole process group (detached spawn) so no
  orphaned CLI burns quota. Env: EXAWATT_SUMMARIES=0,
  EXAWATT_SUMMARIZER_CMD (tests inject a fake), EXAWATT_SUMMARY_SWEEP_MS.
- Summaries flow BOTH ways: `pty:context` events + `contextSummary` on
  `pty:list` → tab subtitles in the strip, and through
  LocalSessionsTransport into FleetState as the agent's goal — the spatial
  map's hover already answers "what was I working on here?". This module
  is the context-augmentation seam for later W-milestones.
- Naming: double-click renames tabs and initiative labels inline
  (Enter/blur commit, Escape cancels — blur-on-unmount commit bug fixed);
  tab renames propagate to the PTY session (`pty:rename`) so fleet and
  workspace agree on identity; initiative renames persist; project color
  now keys on the DIRECTORY so renames keep the hue.
- Hermetic smokes: EXAWATT_USER_DATA (gated on EXAWATT_TEST) isolates
  test userData from the operator's real layout.
- Review round (high, 10 findings): starvation + lost-counter +
  orphaned-process + prune-leak in the summarizer, Escape-commit,
  ungated userData override, rename-not-propagated — all fixed; 2
  accepted with rationale (goal IS the micro-context by design; one-time
  hue shift from color rekeying).
- Verified: 6/6 smoke (subtitle renders, summary lands as fleet goal via
  a fake summarizer, both renames + reload persistence), real `claude -p
  --model haiku` one-shot validated on-machine, 191 tests, full battery.

Dogfood feedback round 3 (2026-07-03, all fixed + verified):

- devtools no longer auto-open (opt-in: EXAWATT_DEVTOOLS=1; ⌥⌘I anytime)
- revived tabs announce themselves with a dim marker line (the "picked up
  an existing thread" surprise — see Known limitation above)
- no all-caps text anywhere (tab strip, spatial sector labels) — standing
  operator style rule
- DISTINCT per-project colors: least-used-first palette assignment at
  group creation (hash collisions produced two pink projects), persisted
  with the layout; inline 10-swatch color picker appears with the
  double-click rename editor (mousedown so picking never commits the edit)
- Claude Code / Codex ignite buttons wear their brand colors (Anthropic
  terracotta #D97757 / OpenAI neutral)
- terminal font is a NATIVE-FIRST stack ("SF Mono", Menlo, Monaco,
  Consolas, ...) instead of the site's display mono — generic for every
  user, per the operator's genericize directive; a font setting is the
  future home for personal taste
- macOS traffic lights no longer occlude the logo (84px header inset in
  Electron; the header doubles as the window drag strip)
- PARALLEL-REGIMES reframe folded into roadmap + operator-workflow: the
  terminal workspace is a first-class AI-native tmux++ regime developed in
  parallel with the spatial regime — independent skins over one system

Dogfood feedback round 2 (2026-07-03, all fixed + smoke-tested + reviewed):

- Claude/agent TUIs no longer render at partial width: sessions SPAWN at the
  pane's estimated size (cols/rows passed to create — TUIs read terminal
  size during init and can miss a resize sent before their WINCH handler
  exists), and a 1.5s wiggle-resync (rows−1 → rows) forces REAL SIGWINCHes
  (a same-size TIOCSWINSZ emits none — found by review) to correct any
  estimate drift.
- ⌘⇧[/] now rotates the GLOBAL tab ring, crossing project boundaries
  (operator-amended from within-initiative); stale-active fallback recovers
  in place instead of yanking to another project.
- Canonical brand marks (Claude starburst, OpenAI knot; Simple Icons/Tabler,
  permissive licenses) replace the generic lightning glyphs, typed as the
  icon column of the harness registry.
- Deprecated /projects route deleted (+ orphaned project CRUD components);
  ⌘K palette and g-w chord now navigate to /workspace; post-auth lands on
  /workspace in the desktop app and /fleet on web (unified). Known
  consequence, accepted: legacy /board & /dashboard demo surfaces lost
  their project-creation entry point (they are retirement candidates).
- Review round (high, 10 distinct findings, all addressed): dangling
  persisted activeTabId blanking the pane area on restore (fixed at save +
  restore), the inert resync (wiggle), cell-metric duplication (derived
  from the terminal font config), palette dialog a11y title, fit/resize
  dedup into one syncSize path, stale model comments corrected.

Dogfood feedback round 1 (2026-07-02, all fixed + smoke-tested):

- default shell is now the USER'S login shell resolved via directory
  services first (`dscl … UserShell`) — the SHELL env var lies when the app
  is launched from a different shell or a harness; the resolved shell is
  also exported as SHELL inside sessions
- `~` / `~/path` working dirs expand in the main process; invalid dirs fail
  BEFORE spawn with a structured error surfaced as a dismissible banner
  (previously: node-pty spawned into a bad cwd and died instantly with no
  output — this is what made Codex look broken)
- session exit markers are appended to the main-process buffer (not just
  live-streamed) so a pane attaching after a fast death shows what happened
- ⌘⇧[ / ⌘⇧] cycle tabs (wraps); shortcuts extracted to
  `use-workspace-shortcuts.ts`, harness registry to `harnesses.ts`
- header nav gained a Workspace link (always in Electron; for authed web
  users too) — you can leave to /fleet/spatial and come back; sessions are
  re-adopted from the main process with buffers intact

Quality/robustness review round (2026-07-02): a high-effort multi-agent
code review of the PTY/workspace code surfaced 10 confirmed defects, all
fixed and re-verified: terminal-pane unmount race (incremental cleanup +
post-await disposed checks), default-shell validation with executability
fallback chain (async, off the main loop), async cwd stat (network mounts
can no longer freeze the app), scrollback trim resync at line boundaries +
exit markers through the trimmed path, onExit-after-kill no longer
resurrects buffers or re-broadcasts, ⌘⇧T/⌘⇧W restored, preventDefault only
when a chord actually applies (and the hook detaches on the web fallback),
HARNESS_ORDER derived from the registry, shortcuts doc-comment made
truthful.

Day-1 bar (operator question pending; proceeding on assumption): all four
candidates are treated as must-haves — full TUI fidelity, restart
persistence of layout, one-gesture worktrees, Spaces-speed switching.

### W0.2 Workspace parity

Status: landed

Scope:

- directory-required ignite: a project directory is mandatory (NO silent
  home-dir fallback — home is meaningless as an initiative and harness
  trust never sticks there, see the 2026-07-02 re-prompting diagnosis);
  the last-used directory is remembered and prefilled
- directory = project: the working directory (repo root / worktree) is the
  grouping key mapping sessions to a Project/Initiative — a resolvable
  Project / Context Group lens per `docs/product/concepts.md`
- tab clustering + color: same-project tabs share a stable color and sit
  adjacent; different projects get distinct colors (transitional UI on the
  way to the W0.5 world map)
- initiative-labeled windows containing session tabs (thin ENG-005 slice)
- the ignite flow: harness picker + worktree create/pick in one gesture
- restart persistence: layout, names, worktrees, working dirs restored
  (processes are not preserved in v0)
- fast keyboard: initiative/window/tab switching at macOS-Spaces speed

Acceptance criteria:

- the operator can reconstruct their current macOS setup (2+ initiatives,
  several tabs each, 1–6 agents) inside Exawatt in under five minutes
- igniting without a project directory is impossible; the last-used
  directory prefills; tabs visibly cluster by project with stable colors
- no harness re-prompts for trust across app restarts when working in a
  real project directory
- day-1 must-have list confirmed with the operator (open question below)

Decisions (operator, 2026-07-02):

- ONE app window; initiatives are groups inside it (⌘1..9 switches
  initiative, ⌘⇧[/] rotates the global tab ring across projects — amended per operator 2026-07-03). Real-OS-windows-per-initiative
  rejected; optional pop-out may come later.
- Auto-revive on app restart: agent tabs respawn automatically, resuming
  their previous conversation in that directory (`claude --continue`,
  `codex resume --last`); shells respawn plain.
- Worktree convention: sibling container `<repo>-wt/<branch-dirname>/`,
  branch auto-named `agent/<MMDD>-<HHmm>` and editable in the ignite flow.

Progress log (landed 2026-07-02):

- main: `pty/project-resolve.ts` — directory → Project resolution via
  `git rev-parse --git-common-dir` (WORKTREES map to their main repo's
  group) with non-git dirs as their own project; one-gesture
  `createWorktree` (sibling container convention); `workspace-store.ts` —
  renderer-owned versioned layout JSON in userData (atomic tmp+rename).
  `PtySessionInfo` gained projectDir/projectName; `create` gained `resume`.
- renderer: `use-workspace-state.ts` owns the model — initiative groups
  keyed by projectDir, tabs with stable ids across revives, debounced
  persistence (exited tabs pruned), mount flow that ADOPTS live sessions
  (renderer reload) and AUTO-REVIVES dead ones sequentially (app restart).
  `tab-strip.tsx` renders numbered, project-colored group clusters
  (deterministic palette hash in `project-colors.ts`); `ignite-controls.tsx`
  is the ignite gesture (required dir following the active initiative,
  worktree toggle + branch field). Shortcuts rewired: ⌘1..9 = initiative,
  ⌘⇧[/] = tabs within, ⌘T = shell in the active initiative.
- Verified via a Playwright Electron RESTART cycle: forced-dir error,
  two-project grouping, worktree lands in the main repo's group,
  initiative keys, layout restore after full app relaunch, all sessions
  auto-revived and interactive — 7/7, zero page errors.

### W0.3 Fleet truth

Status: landed

Scope:

- per-session status detection (running / waiting-on-input / blocked /
  done) normalized into FleetState alongside the existing mock + headless
  paths (ENG-003 adapter boundary)
- `/fleet` and `/fleet/spatial` show real sessions truthfully

Acceptance criteria:

- unblocks ENG-004 V1.3 (live data on the spatial surface)

Progress log (landed 2026-07-03):

- `@exawatt/core` gained `LocalSessionsTransport`: written against a minimal
  injected `LocalSessionsSource` (structurally satisfied by the Electron
  preload PTY API — core never imports Electron types, per the ENG-003
  boundary). Pure `sessionStatus`/`sessionToAgent` mapping: exited →
  complete (code 0) / error; alive → working when output landed within 15s,
  else idle. Activity events are coalesced (≤1 upsert/s/session), a 5s poll
  reconciles new sessions, closed tabs (`FleetManager.removeAgent`, new),
  and working→idle decay; no-op upserts are skipped.
- Fleet provider: in the desktop app, local sessions ARE the fleet (isLocal
  mode — no mock noise, badge reads Live, DemoControls hidden, cron guarded
  off until OC/ENG-003); the web app keeps Demo Mode / OC untouched.
- Honesty note: waiting-on-input/blocked detection from TUI output patterns
  is deliberately NOT guessed in v1 — quiet interactive sessions read
  'idle'. Blocker detection is a W0.4+/attention-layer follow-up.
- Verified end-to-end in the app: two sessions in two projects → /fleet
  board lists them (no demo agents), /fleet/spatial renders real sectors
  (FLEETREPO/TMP, 2 instanced nodes, Live badge), working→idle decay after
  silence, closed tab leaves the fleet within one poll — 7/7, zero page
  errors. 190 tests (7 new transport tests).

### W0.4 Context layer

Status: landed

Scope:

- window/tab naming; auto-summarized micro-context subtitles ("what was I
  working on here?") from recent scrollback via a cheap model call
- context-augmentation groundwork for the 1–6 coding-agent case

### W0.5 Spatial cockpit

Status: stale — RESCOPED 2026-07-06 (operator) and retired as an ENG-002
milestone. The regimes deliberately diverge: the terminal regime's
excellence phases are ENG-015 (`stellar-small-fleet.md`); the map's
evolution toward an RTS-style at-scale unit-selection surface is ENG-004.
The earlier "tab strip demotes to a secondary affordance" framing is
superseded — both regimes are long-lived, user-selectable. Live sessions
already render on the map (W0.3); driving sessions FROM the map returns as
ENG-004 work when that regime's identity firms up.

ENG-002's remaining exit: the dogfood week (the operator runs their real
daily work inside Exawatt without falling back to iTerm).

## Open questions

- Day-1 must-have bar for the operator to switch daily work into Exawatt
  (candidates: full TUI fidelity; restart persistence of layout; worktree
  helpers; global-hotkey-grade switching) — pending operator confirmation.
- Codex interactive specifics (TUI behavior under PTY) to validate in W0.1.
