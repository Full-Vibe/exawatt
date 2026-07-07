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

Status: next

Scope:

- global fuzzy session switcher (builds on the existing ⌘K palette):
  sessions + initiatives searchable by name, project, and micro-context;
  live status in the result rows; ≲2 keystrokes to anywhere
- split panes: two sessions side by side (the "watch one, drive one" case)
- complete no-mouse audit: every daily action (ignite, close, rename,
  color, worktree, jump) reachable by keyboard
- shortcut discoverability: an in-app cheat-sheet overlay (⌘/)

### S3 Exposé & motion

Status: planned

Scope:

- exposé-style overview: all sessions as live tiles in a zoomable grid
  (initiative-clustered, stable slots), one key in/out; click or keys drop
  into the session — game-feel depth and spring motion, DOM-rendered per
  the decision `0003` hybrid rule
- animated tab/initiative switching (motion communicates direction and
  hierarchy, not decoration); full pass on chrome depth/transitions
- respects prefers-reduced-motion throughout

### S4 Context paging

Status: planned — idea bank below; cheap pieces may ride along earlier
phases (e.g. emblems with S3).

The deep layer: the operator's real bottleneck at 5–10 agents is not the
software, it's human working memory — paging a mental context back in
after minutes away. Design for recognition over recall, changes over
restatements, and delivery at boundaries.

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

## Progress log

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
