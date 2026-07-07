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

Status: active-build

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

(entries land here as milestones ship)
