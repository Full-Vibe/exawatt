# Stellar Small-Fleet Command (1–10 agents)

Roadmap item: ENG-015

The excellence arc on top of ENG-002 parity: make operating one to ten
parallel agents genuinely stellar before any long-arc work. The investment
target is the TERMINAL regime — the "solid, robust, approachable" AI-native
tmux++ — while the AgentField map (ENG-004) diverges separately toward an
RTS-style at-scale command surface. Both stay long-lived runtime regimes
over the same session/fleet system.

Operator intent (2026-07-06): "I want the UI for managing one to multiple
to up to ten agents to be really stellar, excellent, and top-notch …
keyboard shortcuts and also the game style slick UI … before we get to the
long arc stuff." Stellar = attention & notifications + speed of control +
visual juice & game feel + context at a glance + research-backed
context-switching support ("help the human operator easily go between
contexts and be productive as he pages in dramatically different active
contexts").

Standing constraints: generic for any user (no operator-bespoke tuning —
personal taste routes to future settings), no all-caps text, keyboard-first
and accessible, reduced-motion respected, quality over fanciness.

## Milestones

### S1 Attention system

Status: landed 2026-07-06

The single highest-leverage capability at 4+ agents: never discover a
stalled or asking agent late.

Scope:

- main-process attention monitor over the PTY stream, two signal classes:
  - explicit: BEL (`\x07`) and terminal notify sequences (OSC 9, OSC 777)
    from any session — these are what harnesses and TUIs already emit
  - inferred (harness sessions only, not shells): a work burst followed by
    output quiescence = turn boundary → "may need you". Thresholds
    env-tunable; expect dogfood tuning. Shells stay bell-only (quiet is
    their normal state)
- attention clears when the operator looks (tab focused) or answers
  (writes to the PTY); the focused session never accumulates attention
- surfaces: pulsing badge on the tab + count on the initiative chip;
  oldest-first attention queue with a jump shortcut (⌘J cycles); macOS dock
  badge count + single bounce when the app is unfocused
- fleet truth: attention maps into FleetState so the board and the map
  show the same "needs operator" state the tab strip does (closes the W0.3
  honesty note: quiet-but-waiting no longer reads as plain idle)

Acceptance criteria:

- a bell or a finished work burst in an unfocused session badges within
  ~2s and enters the queue; focusing it clears everywhere (tab, dock,
  fleet) within a second
- ⌘J jumps to the oldest needs-attention session; repeated ⌘J walks the
  queue
- pure TUI redraw noise (escape-heavy spinners) does not false-positive
- dock badge reflects the live count; no badge when all clear

### S2 Command velocity

Status: landed 2026-07-09

Scope:

- global fuzzy session switcher (builds on the existing ⌘K palette):
  sessions + initiatives searchable by name, project, and micro-context;
  live status in the result rows; ≲2 keystrokes to anywhere
- split panes: two sessions side by side (the "watch one, drive one" case)
- complete no-mouse audit: every daily action (ignite, close, rename,
  color, worktree, jump) reachable by keyboard
- shortcut discoverability: an in-app cheat-sheet overlay (⌘/)

### S3 Exposé, motion & discoverability

Status: landed 2026-07-10

Scope (reshaped by dogfood round 4 — discoverability first-class):

- ⌘O exposé overview: all sessions as rich tiles (stable slots, keyboard
  driven, staggered entrance motion), DOM-rendered per decision `0003`
- discoverability: persistent bottom key-hint bar + hints in the empty
  state; workspace verbs in the ⌘K palette with their chords
- hover/pressed states on tabs; forced dark theme; "launch" language;
  devIndicators off; terminal font setting (userData settings.json)
- respects prefers-reduced-motion throughout; pane-content switch
  animation deliberately skipped (terminals reflow badly under motion)

### S4 Context paging

Status: active-build — re-entry recap is the first implementation slice;
remaining candidates stay in the idea bank below.

The deep layer: the operator's real bottleneck at 5–10 agents is not the
software, it's human working memory — paging a mental context back in
after minutes away. Design for recognition over recall, changes over
restatements, and delivery at boundaries.

Starting hypothesis (operator, 2026-07-10; explicitly reversible): begin
with the least noisy behavior. Ordinary progress and successful completion
remain visible in status surfaces but do not interrupt. Non-critical updates
wait for a natural pause, agent switch, or exposé visit. Work that has stopped
for input or an error may enter the attention queue immediately, but must not
steal focus. Tune or replace this policy from dogfood evidence rather than
treating it as a permanent notification contract.

The first S4 implementation slice should prioritize the re-entry recap and
change-since-last-visit digest. Emblems, spatial anchors, batching, and the
cross-surface status grammar remain candidates to evaluate after that loop is
useful.

First-slice acceptance criteria:

- leaving a session records a scrollback checkpoint; returning after at least
  two minutes and meaningful new output summarizes only what changed while
  away
- the recap appears only over the session being revisited, never as a
  background completion notification and never by stealing focus
- ordinary short switches and insignificant output remain silent
- the first keystroke dismisses the recap without consuming the keystroke;
  typing or switching before generation completes suppresses stale output
- one summarizer call runs globally, using the existing authenticated CLI and
  failure cutoff; thresholds remain environment-tunable for dogfood

## Context-paging idea bank (research-grounded)

Ranked roughly by conviction × cost. These are candidates, not commitments;
S4 planning picks from here.

1. **Visual identity anchors — per-initiative generated emblems.**
   Recognizing a familiar image is near-instant and pre-attentive; reading
   a text summary is serial and slow (picture-superiority effect). Give
   every initiative a deterministic generative emblem (constellation /
   circuit / sigil style SVG seeded from the project, drawn in the project
   color — offline, instant, generic; no AI image dependency), shown
   everywhere the initiative appears: group chip, switcher rows, exposé
   tiles, map sector. The operator's brain keys "Cortex EHR" to a shape+
   color pair instead of re-reading a label. Later upgrade: optional
   AI-generated artwork per initiative.

2. **Stable spatial addresses.** Human spatial memory is strong and free:
   people find things by WHERE they live. Initiative order, ⌘1..9
   assignments, exposé grid slots, and map sector positions never
   auto-reshuffle; new projects append, they don't reorder. "Position" is
   part of the context key — reshuffling silently destroys it.

3. **Re-entry recap card ("previously on…").** On switching into a session
   that's been backgrounded more than a few minutes, a transient overlay
   card: the goal (micro-context), what happened while you were away, and
   what the agent needs now. Dismisses on first keystroke, never blocks
   input. Episodic-memory cueing: a 2-second recap rebuilds mental state
   far cheaper than scrollback archaeology.

4. **Delta digests, not restatements.** Evolve the W0.4 summarizer from
   "what is this session doing" to "what CHANGED since you last looked"
   (we know last-focused timestamps): "3 turns; edited auth.ts + 4 files;
   tests green; now asking about migration order." Change-relative
   information is smaller and matches how the brain updates a model it
   already holds.

5. **Boundary-batched interruptions.** Interruption research (Iqbal &
   Horvitz) shows interruptions delivered at task boundaries cost far less
   to recover from than mid-task ones. Non-critical attention signals
   accumulate quietly while the operator is actively typing in a focused
   session and present when they pause or switch; explicit bells stay
   immediate.

6. **One status grammar, redundantly coded.** A single visual language for
   agent state across tab strip, exposé, switcher, board, and map: color +
   icon + motion encode each state redundantly (colorblind-safe, readable
   in peripheral vision). The operator's peripheral vision becomes a
   monitoring instrument — glancing costs nothing.

7. **Earcons (exploratory, off by default).** Subtle per-initiative sound
   signatures for attention events, so audition carries part of the
   monitoring load. High risk of annoyance; behind a setting if ever.

8. **Switch-cost telemetry (exploratory).** Local-only counts of context
   switches and dwell times to tune defaults (badge thresholds, recap
   trigger time). Only if it stays invisible and local.

## Open design question: exposé and AgentField

The terminal workspace and AgentField keep their deliberately distinct jobs
and visual identities for now. The operator is considering whether exposé
could become a middle zoom level in a broader continuum: terminal focus near,
live session tiles in the middle, and AgentField far away. This could make the
surfaces feel connected without turning them into one visual regime.

This is an exploration, not an implementation decision. Preserve the current
regime switch and route boundaries until dogfooding clarifies whether a literal
zoom transition improves navigation or only adds motion and coupling.

## Progress log

S4 re-entry recap, first slice (landed 2026-07-10):

- Main-process scrollback now carries absolute cursors across bounded-buffer
  trimming. Leaving a tab or the app records a cursor and time; returning
  consumes only output produced since that checkpoint.
- `ContextSummarizer` adds a delta-specific prompt behind the existing
  authenticated CLI, global one-call limit, timeout, and failure cutoff. The
  default trigger is two minutes away plus 200 cleaned characters; both are
  environment-tunable for dogfood.
- Recaps are deliberately quiet: no background completion event. A compact
  "While you were away" card appears only over the active session, includes
  the existing micro-context when available, never steals focus, and
  disappears on the first keystroke without consuming it.
- Human typing gained an explicit `pty:engage` signal from xterm `onKey`.
  Raw `pty:write` cannot cancel a recap because it also carries automatic
  terminal protocol replies; conflating the two made the first live smoke
  suppress valid recaps.
- Stale work is guarded at both ends: typing, switching, or losing focus while
  generation is pending invalidates the result, and the renderer accepts a
  recap only for its current active session.
- Verified: 236 unit/component tests, type-check, lint, Electron compile,
  production Next build, and a live two-session Electron smoke with screenshot
  review and first-key dismissal.

S4 post-land review (2026-07-10):

- Explicit input now carries a per-session version, so a keystroke that beats
  asynchronous focus IPC still suppresses the pending recap. An exiting
  session also invalidates its in-flight recap instead of publishing stale UI.
- The summary sweep interval clamps to one second; an explicit zero can no
  longer create a hot timer.
- Regression coverage exercises early input, mid-generation exit, and the
  interval floor. Full verification after rebasing current `master`: 250 tests, lint,
  type-check, Electron compile, production build, and live Electron font
  refresh/sizing smoke.

S3 Exposé, motion & discoverability (landed 2026-07-10, dogfood round 4):

- ⌘O exposé (`expose-overlay.tsx`): every live session as a tile —
  project-color frame, harness mark, title, project, micro-context,
  needs-you pulse, and the LAST LINES of scrollback (`scrollback-preview.ts`,
  ANSI-stripped incl. private-byte CSI like kitty's `ESC [ > 4;1 m` —
  found leaking into previews on the first screenshot pass). Arrows move
  (column-aware), Enter/click drop in, Esc/⌘O close, focus returns to the
  terminal. Stable slots (spatial memory), staggered entrance, reduced-
  motion respected. role=dialog so workspace ⌘-verbs are guarded while
  open.
- Discoverability (the "how is this better than tmux" answer): a slim
  bottom key-hint bar (⌘K/⌘O/⌘T/⌘D/⌘J/⌘E/⌘⇧M/⌘/) mirroring the spatial
  map's legend, the same hints in the empty state, and a Workspace group
  in ⌘K (overview / rename / change color / split / jump to needs-you /
  close tab / switch to map) — each row fires the same event its chord
  does, with the chord shown.
- Round-4 fixes: app forced dark (`<html class="dark">` — the ⌘K palette
  was following OS light mode over the dark HUD); Next devIndicators off;
  "ignite" retired from the UI ("+ Claude Code" buttons, "Launch a new …
  session in …" tooltips, "New Claude Code session in the active project"
  palette rows — ignite stays internal vocabulary); tab hover/pressed
  feedback (brightness lift, press scale, close-× reveals on hover).
- Terminal font setting: `<userData>/settings.json` →
  `{ terminal: { fontFamily, fontSize, lineHeight, letterSpacing } }` (main: settings-store.ts,
  `settings:get` IPC); panes are born with the effective font, refresh it
  after app refocus, and use it for spawn estimates. Root cause of the
  operator's mismatch:
  Terminal.app profile "Jake" runs MesloLGS for Powerline 14 vs our
  SF Mono 13 — their local settings.json now carries Meslo 14 at
  lineHeight 1.0 (Terminal.app uses the font's OWN metrics; Meslo LG
  variants tune the gap internally, so 1.25 reads visibly taller); the
  CODE default stays the native stack (genericize rule). Exercised
  end-to-end in the smoke (test userData settings.json → xterm options).
  GOTCHA (found in dogfood round 5): the dev app's userData is
  `~/Library/Application Support/exawatt` (package.json name), NOT
  `.../Electron` — a settings.json in the wrong dir silently does
  nothing. The second mismatch was lifecycle: settings were cached for the
  renderer lifetime and existing xterms never updated, so an override written
  during dogfood appeared broken until a full app restart. Existing panes now
  update on app refocus. Dogfood round 6 corrected the earlier metric-only
  verification: although both surfaces select
  `MesloLGSForPowerline-Regular` at 14 with an 18px line box, Terminal.app
  quantizes its cell advance to 8 points while xterm retained the font's
  8.427px fractional advance. The inherited app-wide grayscale smoothing
  also made xterm visibly thinner. Terminal panes now restore platform text
  smoothing, and `letterSpacing` lets the operator align Chromium's cell
  grid with the native terminal (`-1` on this Retina Mac).
- Dogfood round 6 verification: an identical native Terminal.app/xterm glyph
  sample at 2x scale, live computed-style and xterm-dimension inspection, 255
  tests, lint, type-check, Electron compile, and the production Next build.
- Executed in an own git worktree per the new operator workflow rule
  (parallel agents share this repo).
- Verified: 226 unit tests (5 new preview tests incl. the private-byte
  CSI regression), type-check, lint, electron compile, 11/11 live smoke
  from the worktree's own dev server (hint bar, forced dark, live font
  setting, exposé open/navigate/enter, dark palette, palette split
  pin+unpin, launch wording), screenshots reviewed.

S2 Command velocity (landed 2026-07-09):

- ⌘K session switcher: the palette gains a Sessions group — every live
  session with its project-colored diamond, harness mark, title, project,
  micro-context subtitle, and a live one-word status (needs you / working
  / idle / exited; needs-you rows first, oldest flag first, then by output
  recency). Fuzzy-matches on title + project + micro-context. Pure row
  logic in `switcher-rows.ts` (unit-tested); `lastDataAt` added to
  PtySessionInfo for the working/idle read.
- Palette ↔ workspace plumbing (`session-jump.ts`): requests travel as a
  window event (workspace mounted) AND a pending slot consumed on mount
  (palette → navigate → mount), so switching works from any route.
- Palette ignite commands: "Ignite Claude Code / Codex / Shell here" land
  in the active initiative via the same channel; `igniteHere()` is now the
  one dir-resolution path (⌘T, palette, events).
- ⌘K/⌘/ are RE-BOUND in the workspace key layer: the global chord engine
  ignores keystrokes from inside xterm's hidden textarea, so palette and
  cheat-sheet must be reachable from where the operator lives. Workspace
  verbs now also skip keystrokes owned by an open dialog (⌘W in the
  palette must not close a terminal tab).
- ⌘D split panes: pins the active tab; whatever you switch to renders LEFT
  (driven, keyboard) beside the pinned tab RIGHT (watched) — cross-project
  splits included; ⌘D unpins; pin survives restarts (persisted with the
  layout, pruned when the tab closes); ◧ marker in the strip; panes stay
  absolutely positioned so the existing ResizeObserver/fit path absorbs
  the geometry change; clicking the watched pane activates it.
- ⌘E renames the active tab inline (same editor + swatches as
  double-click).
- ⌘/ cheat-sheet: help modal gains a static Terminal Workspace section
  (the workspace chords are handled outside the registry — registering
  them would double-fire); ⌘/ also bound globally.
- Ignite-controls fix (found by the smoke): an ignite resolving no longer
  clobbers a directory typed while the spawn was in flight (edit-sequence
  guard).
- Verified: 220 unit tests (6 new switcher-row tests), type-check, lint,
  electron compile, 12/12 live Playwright smoke (switcher from inside a
  terminal, filter → cross-project jump, palette ignite, split geometry
  50/50, unsplit, ⌘E rename, ⌘/ sheet), screenshots reviewed.
- Known follow-up: the palette dialog still wears the light shadcn theme —
  jarring over the dark HUD; restyle in S3 (exposé & motion / chrome
  pass).

S2 review round (high, workflow, 10 findings — all fixed 2026-07-10):

- Split structural fixes: clicking the watched pane no longer collapses
  the split — the split pair is now (companion = last active non-pinned
  tab) LEFT + pinned RIGHT, so activating the pinned pane just moves the
  keyboard (you can finally copy out of it); hidden panes FREEZE their PTY
  size (an invisible element keeps full-container geometry, so every tab
  switch was SIGWINCHing background sessions to the wrong width and
  garbling TUI scrollback — reveal refits).
- Palette↔workspace protocol: requests now defer until the workspace is
  `ready` (an ignite selected during initial load errored spuriously and
  was lost); consumed-when-ready even on failure; pending slots carry a
  15s TTL so a slot surviving an unmount can't yank the workspace to an
  old session minutes later.
- Palette: session rows reset on close (stale rows listed dead sessions on
  reopen and Enter on one did nothing).
- ⌘D on a dead pin now pins the current tab (was: silently consumed the
  press clearing an invisible stale pin).
- Branch field gained the same in-flight edit guard as the dir field.
- Rename commit/cancel hands focus back to the active terminal (⌘E flow
  left the keyboard on <body>).
- ⌘K/⌘/ in the workspace layer resolve from the shortcut registry (user
  rebinds now work inside terminals too).
- Switcher sort: an exited session with a stale attention flag sorts by
  recency among exited rows (was: epoch-vs-negated-ms key mixing).
- Re-verified: 221 unit tests, type-check, lint, electron compile, 13/13
  live smoke (new check: clicking the watched pane keeps the split).

S3 review round (high, workflow, 10 findings — all fixed 2026-07-10):

- CRLF handling: stripAnsi turned \r\n into DOUBLE newlines, so every
  exposé preview rendered sparse with bogus blank lines (PTY scrollback is
  CRLF) — fixed in the preview AND the context summarizer.
- Font/revive race: auto-revive could spawn PTYs with DEFAULT cell metrics
  while a custom font was still loading — the exact init-width race the
  spawn estimate exists to kill. Font resolution moved to a shared
  `terminal-font.ts` loader; the revive path AWAITS the same promise the
  render gate uses.
- Exposé modality: the overlay covered only the panes area — the tab strip
  stayed clickable underneath, switching terminals invisibly. Now mounted
  at the workspace root; backdrop click closes.
- Exposé selection starts on the ACTIVE session (⌘O → Enter returns you
  where you were; it jumped to tile 0 before), stays clamped when sessions
  exit while open, previews fetch for tiles that appear mid-open (revive),
  and the column math no longer undercounts (trailing-gap off-by-one).
- Palette "Overview" honors the same no-sessions guard as ⌘O (was: dead
  dark screen on an empty workspace).
- Forced dark now sets `color-scheme: dark` — native scrollbars, form
  controls, and autofill follow the app instead of a light OS.
- Close-× regains visibility on keyboard focus (hover-only reveal broke
  the keyboard path).
- Re-verified: 227 unit tests, type-check, lint, electron compile, 12/12
  live smoke (new checks: overview starts on the active session).

S1 Attention system (landed 2026-07-06):

- `electron/main/pty/attention-monitor.ts`: pure-Node detection engine over
  the manager's data stream. Bell class: raw BEL and OSC 9 / OSC 777
  notifications — with an OSC-aware scanner, because BEL also TERMINATES
  OSC sequences (every title update ends in one); sequences split across
  chunks are carried per-session (bounded) and re-scanned, including the
  `ESC` / `]` split landing exactly on a chunk boundary. Turn-end class
  (harness sessions only, shells are bell-only): a work burst
  (≥ EXAWATT_ATTENTION_MIN_BURST raw bytes, default 600) followed by
  quiescence (≥ EXAWATT_ATTENTION_QUIET_MS, default 4000) flags "may need
  you"; the burst is consumed at the boundary either way (no re-flag
  loops); a 20s spawn grace keeps auto-revived tabs from lighting up en
  masse at app start. EXAWATT_ATTENTION=0 disables. 16 unit tests.
- Focus contract: "looked at" = the session's tab is active AND the app
  window has OS focus (`pty:focus` from the renderer + browser-window-
  focus/blur in main). The watched session never flags; looking clears;
  typing while looking clears. The active tab behind another app STILL
  flags — the single-tab case this system exists for.
- Surfaces: pulsing amber dot on the tab + amber count on the initiative
  chip; ⌘J jumps to the OLDEST flagged session (repeat walks the queue —
  each focus clears, surfacing the next); macOS dock badge carries the
  count and bounces once when the app is unfocused.
- Fleet truth: `attention` rides `pty:list` into LocalSessionsTransport —
  an alive flagged session maps to status 'blocked' + `blockerInfo`
  (input_needed), so board and map show the SAME needs-you truth as the
  tab strip. Closes the W0.3 honesty note (quiet-but-waiting ≠ idle).
- Regime switching (operator ask, same day): ⌘⇧M flips terminal workspace
  ↔ spatial map from anywhere, both directions — bound in the workspace
  key layer (terminals swallow chord-engine keydowns) AND as a global
  shortcut (`toggle-regime`, shows in the ⌘K help modal); both compute the
  same target so double-fire is idempotent.
- Infra: vitest config gained an `app` project — the packages/* glob had
  silently skipped ALL src/ + electron/ tests (extends concatenates
  includes, so packages are excluded there to avoid double runs).
- Verified: 210 unit tests (16 monitor + 3 fleet-mapping new), type-check,
  lint, electron compile, and a 13/13 live Playwright smoke against the
  real app: bell in an unfocused tab → badge + group count + dock "1" →
  ⌘J selects it and clears everywhere (renderer, main, dock) → ⌘⇧M to the
  map (both real sessions render as sector nodes, Live badge) → ⌘⇧M back,
  sessions intact, zero page errors. Screenshot-verified badge chrome.
- Known follow-up (S-later): turn-end thresholds need dogfood tuning
  against real Claude Code rhythm; notification text from OSC payloads is
  captured as a bell but not yet surfaced as the reason string.

Review round (high, workflow, 10 findings — all fixed same day):

- Window-focus blindness (the big one): the active tab suppressed flags
  even with the app backgrounded — the single-tab "operator in a browser"
  case never flagged. Fixed: "looked at" = active tab AND OS window focus
  (browser-window-focus/blur wired in main; renderer optimistic clear
  gated on document.hasFocus()).
- xterm auto-replies (cursor/device queries answered by hidden panes,
  backlog replay) cleared flags via `pty:write` with zero operator
  engagement. Fixed: input only clears the WATCHED session.
- Stale 'blocked': a flagged session that resumed streaming stayed blocked
  forever on the fleet surfaces. Fixed: substantial post-flag output
  (≥ minBurst) self-clears — a bell mid-run is not a blocker; the resumed
  burst re-flags at its own quiet boundary.
- Phantom bells: capping an oversized split OSC (8KB OSC 52 clipboard,
  OSC 1337 images) dropped the ESC ] introducer, so the terminator BEL
  read as a real bell. Fixed: the introducer survives the cap.
- ⌘⇧M double-push (duplicate history entry when both key layers saw the
  chord): both the workspace layer and the chord engine now skip
  `defaultPrevented` events.
- Seeding race re-adding cleared flags on reload: clears observed between
  the pty:list snapshot and the seed merge now tombstone the id.
- `Number(env) || default` silently discarded an explicit 0: envInt()
  honors 0.
- Cleanup: test files excluded from the electron production build
  (`**/*.test.ts` in electron/tsconfig exclude; stale dist artifacts
  removed); vitest root include removed so each project's include actually
  governs; preload's four copy-pasted IPC subscribe wrappers collapsed
  into one generic `subscribe<T>(channel)` factory.
- Re-verified after fixes: 214 unit tests (20 monitor — 4 new regression
  cases), type-check, electron compile, 13/13 live smoke re-run.
