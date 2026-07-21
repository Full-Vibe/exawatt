# Project Roadmap Lens

Roadmap item: ENG-017

## Outcome

From the workspace, "what is this agent working on, and what's next in this
Project" answers itself without opening the repo's docs. Each Project's
roadmap stays canonical, durable, and malleable in that Project's repo;
Exawatt reads and visualizes it and never owns it. Deleting Exawatt loses no
project state.

The lens ships as a keyboard-first, read-only roadmap rail in the workspace,
scoped to the focused Project cluster, built on a shared parser and view-model
that a future spatial/GPU expression consumes unchanged.

Source: operator dogfood interview 2026-07-10 and operator design interview
2026-07-11. Durable product conclusions are in
`docs/product/operator-workflow.md`.

## Fixed decisions

- **Published convention, tolerant parser.** Exawatt publishes the roadmap
  convention (`docs/product/reference/roadmap-convention.md`, decision
  `0011`); compatible repos adapt to it. The parser applies a published alias
  table (Exawatt's own roadmap is conformant without edits), reports
  unrecognized structure as counted diagnostics with line anchors, and never
  invents items. It does not learn legacy formats.
- **Pure markdown, no sidecar.** The convention is a markdown grammar, not a
  parallel yaml/json file. Agents author roadmaps as markdown; a second
  machine file would drift the day an agent edits the markdown, and read-only
  Exawatt could not resync it.
- **Linear single queue in v1.** One sequential queue per Project,
  deliberately enforcing canon linear execution. Multi-track roadmaps are
  future; the spec reserves a frontmatter pointer.
- **The queue is the spine; sessions decorate it.** Live sessions render as
  chips on the item they execute. Link confidence is a rest state: solid
  border for declared-at-launch, dashed for inferred, evidence on hover.
  Ambiguous or unmatched sessions stay visibly unmapped — never guessed.
- **Closed-vocabulary linking.** Inference only matches ids/titles already
  present in the parsed roadmap, so injected text in AI-generated summaries
  can at worst mislink a badge, never invent an item. Precedence: declared >
  branch/worktree token (high) > title/context/commit id (medium) > fuzzy
  title (low).
- **Read-only is a trust posture.** No editing, no assignment, no drag
  handles, no checkboxes. The rail's footer states what file it reads and
  that Exawatt never writes it. The only edit path is opening the file in the
  OS editor. Queue management is explicitly the ENG-013 future arc.
- **Declared links are view annotations.** Declare-at-launch ids persist on
  the tab in machine-local `workspace.json` (decision `0010` identity/layout
  split), never in the repo and never in Supabase.
- **Parsing runs in the renderer** inside `@exawatt/core`, following the
  `LocalSessionsTransport` pattern. Electron main stays a minimal privilege
  boundary exposing dumb validated IPC: `roadmap:read`,
  `roadmap:session-evidence` (git branch/worktree/commit subjects per cwd),
  and `roadmap:watch`/`roadmap:file-changed` (dir-level watch, debounced).
  Main compiles with plain tsc and cannot import `@exawatt/core`; that build
  conversation belongs to ENG-018's durable Session boundary; PTYs remain in
  Electron main per decision `0012`.
- **Shared view-model.** `buildRoadmapLens` in `@exawatt/ui-model` is pure
  and encodes no DOM geometry. The workspace rail is its first consumer; a
  horizontal strip or spatial/R3F expression consumes the same model later.

## Design canon (workspace rail)

- **Feed line.** A vertical spine in the Project's identity color with items
  as stations: shipped compressed to a count, one dominant "now" card
  carrying session chips, next rows at mid density, later stubs dim.
  Information resolution falls off with distance from now — the altitude
  principle inside one panel.
- **⌘B summon** with a three-state cycle: closed → open and focused; open but
  unfocused → focus; focused → close and return focus to the active terminal.
  The rail is a `complementary` landmark, so global workspace verbs pass
  through. Inside: arrows/`j`/`k` rove, Enter/→ drills queue → item detail →
  inline milestone expansion, Esc/← backs out one level, Enter on a chip
  jumps to that terminal, `o` opens the roadmap file, `g` jumps to the now
  card.
- **Reflow rule** (ENG-015 S3 lesson): the terminal stage resizes once,
  instantly; only rail contents animate (transform/opacity, exposé stagger,
  `motion-reduce` parity). On narrow windows the rail floats as an overlay so
  terminals never reflow.
- **Collapsed 36px spine strip** preserves the health signal: now-node,
  remaining count, amber badge when the queue is empty or sessions are
  unlinked.
- **The empty queue is the hero state.** "Queue empty — nothing is next in
  this project. Agents here will idle when they finish." with an amber
  pulsing terminus. Queue health is the point of the feature.
- **Honest degradation states**: no roadmap found (lists paths checked),
  parse-degraded ("showing 7 recognized" with diagnostics), stale parse
  (last good render dimmed with timestamp). Partial truth beats silence.
- **Hero motion is queue advance**: on file change the shipped item
  compresses into the shipped count, the next item expands into the now
  slot, and the spine glow steps down one station; reorders FLIP.
- **Normal-case text everywhere.** The existing all-caps HUD `Label` and
  `StatusPill` atoms are not reused; the rail gets a normal-case status pill.
  Display vocabulary: `active / next / later / shipped / parked` plus a
  `blocked` badge. Kanban components are not reused (drag affordance implies
  editing).
- **Reciprocal chip** in the active-session context bar shows the linked item
  id and opens the rail drilled to that item, so the first exit criterion
  holds even with the rail closed.

## Ownership boundaries

- The roadmap convention spec is public-safe product reference; per-repo
  adaptation edits happen in those repos, not here.
- Queue management, assignment, and any repo writes remain ENG-013 territory.
- The spatial expression of the lens belongs to the parked spatial track
  (ENG-004); this project only guarantees the view-model it would consume.
- Durable Project registry and switching remain ENG-015; the rail reads the
  focused Project the workspace already resolves.

## Execution order

S0-S5 landed 2026-07-11. The second arc (S6-S10, below) makes the lens
felt; operator dogfood continues throughout.

- S0 Canon: roadmap entry updated, this doc created.
- S1 Convention + parser: spec doc, decision `0011`,
  `packages/core/src/roadmap/{types,parse}.ts`, fixture tests (exawatt
  excerpt, conformant sample, near-miss, garbage).
- S2 Read-only rail: `electron/main/roadmap/` read IPC + preload,
  `packages/ui-model/src/roadmap-lens.ts`, `src/components/roadmap/`
  components, ⌘B wiring, all designed states, trust strip, architecture
  docs/manifest updates.
- S3 Inference linking: `packages/core/src/roadmap/link.ts`,
  `roadmap:session-evidence` IPC, confidence chips, unmapped shelf,
  context-bar reciprocal chip.
- S4 Declare-at-launch: `LaunchOptions.roadmapItemId`, launch-controls
  picker, `workspace.json` v3→v4 migration, declared-overrides-inferred;
  a stale declared id falls to the visible unmapped shelf.
- S5 Live watch + polish: dir-level watcher + change broadcast, header
  sweep + FLIP motion, workmusic and compliance-intel adapted to the
  convention, degradation verified against unadapted ucp-list.

Work happened in a dedicated worktree and integrated to `master` per slice.
The end-to-end evaluator is `scripts/roadmap-rail-eval.mjs` (21 checks).

## Second arc: make the lens felt (S6-S10)

Added 2026-07-11 after an operator UX interview plus an external research
pass (Linear, GitHub Projects/sub-issue pills, Devin command center, Copilot
mission control, Cursor background agents, Codex cloud, Conductor, VS Code
status-bar doctrine, Zellij, Warp blocks, ProdPad Now/Next/Later,
Backlog.md/xit/todo.txt). Finding: S0-S5 is correct but not FELT — the rail
rests as a low-signal 36px sliver, session links rarely engage in real use,
and a read-only panel summoned by ⌘B never earns a glance habit.

Operator decisions (2026-07-11), recorded so they are not re-litigated:

- **Resting posture: collapsed, but signal-rich.** Do not open the rail by
  default; make the strip itself readable (a per-item spine, not a count).
- **Work-first sequence, always.** The lens is an ordered flow answering
  "where are we, what's next, what's shipped, what's active, what's
  blocked" — no dates, no gantt precision; position is the schedule.
  Sessions overview and Spatial are the AGENT-FIRST views; they mirror item
  context instead of the rail inverting to an agent list.
- **Read-only for now.** The manipulable lens (feed items to agents,
  reorder, transitions) is wanted but gated on design play with disposable
  prototypes and multiple options; ship nothing until the operator accepts
  a top-notch interaction design.
- **Starving is attention.** Blocked items and empty queues flow through
  the existing needs-you pipeline — one attention truth, no second machine.

Research-backed rules the second arc holds to: "current" = live session
ATTACHED, "next" = queue position (Linear's inferred-diamond lesson);
honest n/m milestone fractions, never blended percentages; nominal states
stay visually quiet — color only for blocked/starving/parse trouble
(VS Code last-resort rule); agent→item→terminal is one keypress each way
(Copilot chain); mid-task progress is current milestone + elapsed time,
never a percent (Cursor/Devin).

### S6 Signal-rich strip

Work: replace the count-sliver with a vertical spine, one node per queue
item in sequence — shipped (filled, dim), now (attachment-marked with a
subtle activity pulse), next/later (hollow), blocked/starving (amber, the
loudest pixel); keyboard/hover peek shows id + title without opening;
strip click/⌘B unchanged. The strip must satisfy the "across the room"
test: roughly where are we, and is anything wrong.

Acceptance: with the rail collapsed, a blocked item and the current item
are identifiable at a glance in a screenshot at 1400x900; nothing animates
except the current node's pulse (reduced-motion: none).

### S7 Sequence-first rail

Work: agent chips with elapsed time on every attached row (hero-only
today); n/m fraction pills on all rows; a compact header sequence bar
(shipped ▰ / now ● / next ○); suppressed nominal color per the status
discipline; drill-in milestone expansion (the deferred R1→R2 level: ↑↓
roves milestones inside the detail panel).

Acceptance: the five questions are answerable from one open-rail
screenshot; drill reaches an individual milestone by keyboard.

### S8 Attention integration

Work: two new attention sources — item-blocked (a linked session on a
blocked item, or a `blocked` item with no session) and project-starving
(queue empty while sessions are live in that Project) — emitted into the
existing attention system (⌘J queue, tab badges, FleetState mirror,
default-off native notifications). No new notification machinery.

Acceptance: emptying a fixture roadmap while a session runs produces a
needs-you event that ⌘J reaches; clearing it clears the event.

### S9 Agent-first mirrors

Work: Sessions overview tiles and ⌘K switcher rows carry the linked item
id + milestone fraction; the spatial agent piece adopts the same chip when
ENG-004 unparks (view-model only until then).

Acceptance: a session declared on an item shows that item in the exposé
tile and the switcher row with no rail open.

### S10 Manipulable-lens design play (gated)

Work: disposable prototypes only — feed-an-item (Enter on an unclaimed
item offers harness pick + optional worktree + seeded kickoff prompt
referencing the roadmap file; declared link on launch), reorder, and
status-transition interactions; present 2-3 UI options per gesture in
play sessions. The repo file remains the only truth; any accepted design
ships as a NEW milestone with its own acceptance, bridging toward ENG-013.

Acceptance: operator has played with at least two interaction options per
gesture and explicitly accepted or rejected each; decisions recorded here.

**Round-1 verdict (operator, 2026-07-12): presentation REJECTED.** Quote-level
findings: the lab and the shipped lens read as "UI vomit" — can't tell what
you're looking at or what to do; hierarchy is bad; too dense; fonts "too
geeky and monospace and Star Trekkie"; the filled-vs-hollow spine dots are a
bad affordance ("random dots… doesn't make any sense to me as a user").
Consequence: the manipulable-lens gestures stay gated, and the VISUAL
language itself reopened. Round 2 (same day) leads the lab with three
opinionated directions — **Brief** (editorial status page: plain sentences,
checkmark checklists, progress bars), **Focus** (one giant answer: current
item + next milestone, rest compressed), **Journey** (horizontal
left-to-right track: shipped → you are here → next → later, detail on
click) — each with its own collapsed-strip proposal (title-bar chip / plain
words / minified track) so the dot rail has real challengers. All three read
the same `RoadmapLensView`; the shipped design is demoted to a comparison
panel. Awaiting operator verdict; the winner graduates into the real rail
as S11.

**Round-2 verdict (operator, 2026-07-12): wholesale replacement REJECTED —
refine the shipped design instead.** The three-direction lab read as too
much at once ("hard to grok what's going on with our new examples"), plus a
lab usability bug: clicking a state chip scrolled the page (the rail's
selection scrollIntoView fired on every re-render). Resolution: **S11 =
incremental legibility refinement of the shipped rail/strip**, borrowing the
directions' vocabulary without changing the structure — landed same day, see
progress log. The directions module was retired (git history keeps it); the
lab is back to the real strip + rail against fixture states.

**Round-3 operator decisions (2026-07-12), pre-play vocabulary + scope:**

- **The verb is ASSIGN, not feed.** "Assign to an agent" everywhere the
  gesture appears; the reorder gesture is accepted as a concept.
- **The progress gestures must be self-explanatory.** "Check milestones" and
  "cycle status" meant nothing to the operator. Relabeled "Record progress":
  Option A "Space — mark the next milestone done" (edits `- [ ]` → `- [x]`
  in roadmap.md), Option B "s — advance the item toward shipped" (steps the
  `Status:` line). Every prototype now carries a one-sentence explainer and
  toasts say exactly what file edit would happen.
- **The lens stays project-scoped; Escape backs out.** Escape ladder landed:
  drill → queue → collapsed strip + terminal focus. Switching projects
  re-scopes the rail (already true).
- **Multi-project roadmap truth is DEFERRED, not rejected.** The operator
  agrees in principle but wants the single-project lens built up and the
  direction refined before committing to a global, cross-project layer. Do
  not start it without a fresh operator conversation.

## Progress log (second arc)

- 2026-07-20, S12 landed (operator: "roadmap only visible in Sessions — the
  zoomed-out view"): the lens re-homed to the Sessions altitude. The rail is
  a permanent docked panel in the Sessions overlay, scoped to the overview's
  SELECTED Project — roving across tiles re-scopes the plan (the
  multi-project answer without a merged queue); below 1100px it becomes a
  ⌘B-summoned drawer. The Terminal view carries no rail and no collapsed
  strip; it keeps the per-session context chip (now summoning Sessions
  drilled to the item), declare-at-launch, and the S8/S9 mirrors. ⌘B is
  "open Sessions with the roadmap focused" from anywhere and toggles
  tiles ↔ rail focus inside Sessions; Escape backs out drill → queue →
  tiles; starving ⌘J lands on the Sessions rail; a palette row ("Open the
  Project roadmap") makes it ⌘K-discoverable. Implementation notes:
  cross-surface summons park in a freshness-windowed module store
  (StrictMode's double-mount broke consume-once), the overlay's entrance
  and selection-clamp focus yield to a summoned rail, and mouse-enter
  selection is disarmed during entrance (Chromium re-dispatches synthetic
  mouse events under a stationary cursor, which let the parked pointer
  steal the roving selection on mount). Verified by the rewritten
  `scripts/roadmap-rail-eval.mjs` (28 checks green: summon/focus grammar,
  content, live update, drill + milestone roving, selection re-scoping,
  declared chips, blocked attention, starving jump, no-roadmap and
  real-repo states, reciprocal drill).

- 2026-07-12, round-3 decisions applied (see decisions above): prototypes
  renamed to the ASSIGN vocabulary with plain-language options, per-gesture
  explainers, and concrete would-write toasts (names the milestone it would
  check off); rail Escape ladder landed — Escape at queue level collapses to
  the strip and returns focus to the terminal (project-scoped back-out), with
  a new rail-eval check (`escCollapsesRail`, 31 checks). ENG-003 marked
  operator-hold in the roadmap; multi-project lens deferral recorded.

- 2026-07-12, S11 landed (operator round-2 verdict: refine the shipped
  design, don't replace it): the rail keeps its structure and gains the
  directions' legibility vocabulary — plain-language group headings ("Now",
  "Up next", "Later") over the queue; hero card gets a thin progress bar,
  "Next up: <milestone>" in sans, and an amber "Blocked — <reason>" line
  when blocked (the reason beats the milestone for actionability); drill
  milestones render as readable checkmark circles (✓ done / hollow open /
  dashed struck-through retired) with "Milestones · 3 of 5 done"; status
  pills and section labels moved from lowercase mono to capitalized Geist
  Sans ("Active", "Blocked", "Scope"…); status-token jargon is stripped
  from prose (`statusNoteProse` in `roadmap-format.ts` — "active-build"
  never renders as a sentence); footer says "Read-only — Exawatt reads this
  file, never writes it"; strip/sequence shipped glyph ▰ → ✓. **Bug fix**:
  the rail's selection scrollIntoView now runs only while the rail owns
  focus — it used to scroll the page on any re-render (the lab's state
  chips jumped the viewport; same hazard existed in the workspace).
  Directions module retired; lab simplified back to strip + rail. Gate:
  418 tests, type, lint, electron compile, 30-check rail eval (assertions
  updated to the new copy), spine eval, screenshots of all states + drill.

- 2026-07-12, S10 round 2 (after the operator's round-1 rejection, recorded
  above): rebuilt `/hud-gallery/roadmap-lab` around three design directions
  (`directions.tsx` — Brief / Focus / Journey, each with a collapsed-strip
  proposal), calm palette + Geist Sans instead of the HUD mono wash, the
  shipped rail demoted to a "Current (shipped)" comparison panel, gesture
  prototypes kept below. Presentation-only; no state writes. Also fixed the
  BLOCKED fixture's duplicate `Status:` line (the reason never parsed) and
  taught the directions to strip status tokens and "(landed)" markers out of
  prose. Screenshot-iterated all six key states in the running Electron app
  (three rounds; fixed strip-caption collisions, starving mislabeled as "no
  roadmap", journey track overflow). Awaiting operator verdict → S11.

- 2026-07-12, product-lens pass (drove the real app against the real exawatt
  roadmap): the hero card advertised **W0.5 — a rescoped milestone — as the
  next milestone** because the parser only knew done/pending. Convention v1
  now defines *retired* milestones (`(rescoped …)`, `(retired …)`,
  `(dropped …)`, `(superseded …)`, `(cut …)`): never advertised as next,
  excluded from progress fractions (they were not accomplished and are no
  longer owed), still visible struck-through in the drill view
  (`roadmap-convention.md`, `parse.ts`, `RoadmapItemView.milestonesTotal`,
  parser + lens tests). Also: rail trust line now says "5h ago" /
  `YYYY-MM-DD` instead of an ambiguous bare clock time for older mtimes.
  Verified end-to-end via a temp Electron eval (hero skips retired, 1/2
  fraction, drill strikethrough) plus the full 30-check rail eval.

- 2026-07-11, code review + Sessions-overview fix: two adversarial reviews of
  the D8-D10 + S6-S10 change set (0 P0). Fixed: **security** — `pty:open-path`
  now takes an opt-in `contain` mode (roadmap `Project doc:` bullets are
  untrusted repo content; a malicious roadmap could point a chip at
  ~/x.command and have a click launch it — now rejected via realpath
  containment, unit-tested in `electron/main/contained-path.test.ts`);
  the ⌘J roadmap-blocked walk no longer dead-ends on the active tab
  (`orderedRoadmapJumpTargets`, tested) and the Session-menu + palette rows
  run the SAME ladder as the key (JUMP_ATTENTION_EVENT ownership moved to
  WorkspaceClient); workspace-verb shift-aliases (⌘⇧T/⌘⇧W) now match only
  after explicit bindings so a rebind can't be shadowed; a modifier-less
  keystroke in a text surface can never trigger a mis-rebound verb; the strip
  budget honestly caps node count (unmapped counted, no negative budget);
  duplicate roadmap ids no longer collide React keys; corrupt
  `recentProjects` is tolerated on restore; exposé mirror label truncates;
  `top-nav-mobile` legacy links come from the manifest (killed the last
  "Dashboard" vs "Lattice" drift); `Object.hasOwn` for the menu-sync guard.
  Plus the operator-reported bug: the Sessions overview now shows EVERY tab —
  stopped/ended ones dimmed with their lifecycle word and still openable
  (was filtered to live PTYs only, pre-ENG-018).
  Two findings DEFERRED with rationale: (a) roadmap-blocked tab badges show
  only for the active project because the lens is active-project-scoped —
  cross-project roadmap attention needs a multi-project lens (future); PTY
  bells still badge across projects. (b) Session/Go menu items stay enabled
  off-/workspace and are silent no-ops there — the data-loss case
  (close-tab from /settings) is verified impossible (no listener off-surface);
  disabling per-route needs route→main threading, deferred as polish.

- 2026-07-11, S8+S9 landed; arc verified end-to-end: roadmap-derived
  attention (`packages/ui-model/src/roadmap-attention.ts`, 3 tests) merges
  into the workspace needs-you map — blocked-with-agent badges the tab, ⌘J
  walks PTY attention → roadmap-blocked → starving-opens-the-rail; native
  notifications stay PTY-only for now (roadmap parse is renderer-side;
  main-side parse is the noted follow-up if dogfood wants toasts for
  starvation). S9 mirrors: exposé tiles and ⌘K switcher rows show the
  linked item (declared ids cover every project via the layout —
  `extractRoadmapItemIds`; the active project's lens enriches labels,
  fractions, inferred styling). `roadmap-rail-eval` grew from 21 to 30
  checks (strip spine/current/blocked, sequence bar, milestone roving,
  chip rows, blocked badge, exposé mirror, starving ⌘J) and its inference
  check now uses a deterministic git fixture (branch carries the item id)
  instead of this checkout's agent-churned history. Full gate: 369 tests,
  type, lint, electron compile, spine eval, rail eval, screenshots.
  S10 NEXT ACTION (any agent or the operator): open
  /hud-gallery/roadmap-lab on a dev server, play the three gestures
  (feed A/B, reorder A/B, milestones A/B) across fixture states, record
  accept/reject verdicts here, then scope the accepted design as S11.

- 2026-07-11, S6+S7 implemented (worktree eng017-arc2): strip spine model in
  `packages/ui-model/src/roadmap-strip.ts` (pure, 5 unit tests: current-by-
  attachment, now-station fallback, shipped-then-later compression, starving,
  blocked/attention flags) rendered by `RoadmapStripSpine`; `roadmap-node-
  pulse` keyframes; header `RoadmapSequenceBar` (same model, 24-glyph cap);
  chips now render on every attached now/next row; fraction pills on all
  variants; next/later pills went neutral (color discipline); milestone
  roving in the drill (↑↓/jk, `data-roadmap-milestone`). Roadmap LAB landed
  at `/hud-gallery/roadmap-lab`: markdown fixtures through the real parser
  (`lab-fixtures.ts` — mid-flight/blocked/starving/huge/warnings/fresh/none/
  error) + S10 mock prototypes (feed inline/dialog, move-mode/direct
  reorder, milestone check/status cycle). Screenshot-verified: mid-flight,
  blocked, starving, huge. Drive-by: fixed master-red `expose-overlay.test`
  fixtures missing ENG-018's new WorkspaceTab fields. Eval extension +
  milestone status flips happen at arc integration.

## Verification

- Parser, linker, and view-model carry vitest unit tests in their packages.
- The rail is screenshot-iterated on localhost across all designed states
  before pushing; keyboard walk covers the ⌘B cycle, drill in/out, chip
  jump, and Escape semantics; Electron E2E runs via `withElectronApp`.
- Exit-criteria check: with two live sessions on ENG-branded branches, the
  rail shows both chips on the correct items and the next item without
  opening any repo doc.
- The v3→v4 `workspace.json` upgrade is covered by
  `workspace-persistence.test.ts` and a manual restore.
