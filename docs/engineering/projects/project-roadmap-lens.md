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

Work: linked Sessions on blocked items enter the existing visible attention
system (`⌘J` queue and tab badges). Project starvation (queue empty while
Sessions are live in that Project) remains a roadmap-owned state reached
explicitly with `⌘B`; it does not borrow the needs-you command or marker. No
new notification machinery.

Acceptance: a linked blocked Session produces a visible needs-you state that
`⌘J` reaches and clearing it clears the state. Emptying a fixture roadmap while
a Session runs leaves `⌘J` in Terminal; `⌘B` opens Sessions and shows the empty
queue state.

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
  tiles; a palette row ("Open the Project roadmap") makes it
  ⌘K-discoverable. D39 later removed the hidden starving-`⌘J` route so the
  attention shortcut now follows visible needs-you state only. Implementation notes:
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
  WorkspaceClient); the then-current workspace-verb shift aliases (⌘⇧T/⌘⇧W)
  now matched only after explicit bindings so a rebind couldn't be shadowed
  (D39 later assigned ⌘⇧T explicitly to closed-tab recovery); a modifier-less
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
  into the workspace needs-you map — blocked-with-agent badges the tab, and
  ⌘J walks PTY attention → roadmap-blocked. The original
  starving-opens-the-rail fallback was retired by D39/decision `0020`; native
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

## Third arc: the roadmap you actually want to use (S13, design pass 2026-08-03)

Design pass for S13, held with the operator on 2026-08-03. S13 was captured 2026-08-02 as "deliberately unshaped"; this section shapes it. Nothing here is a new roadmap item — S13 gains sub-milestones and S10's ASSIGN gate finally gets its gesture.

### The complaint, in the operator's words

> "UI/UX on the roadmap in general is pretty bad — selecting something is just like a huge horrible wall of text, which really sucks. There's a bunch of other navigability issues and linkage and liveness and too much copy… I want to be able to navigate and manipulate and check out the roadmap very smoothly, very easily, like a beautiful Linear app, like Backlog or Gantt chart."

And the concrete failure that triggered it: an agent was actively working ENG-032 (VS Code theming) while the lens showed its Session as **not linked to an item**. That is a shipped defect in S3's inference linking, not a design gap — see the queued work below.

### Decided

**Form: a sequenced list, with time as a lens.** The list is the home view — ordered, dense, keyboard-walkable, no invented dates. Dates are "kind of irrelevant in an agentic coding world" (operator) though future customers may need them, so the model must not foreclose them: real elapsed and activity data may overlay the list to give the Gantt feeling honestly. Never synthesize a future date the repo does not contain.

**Detail: progressive prose, high-level first.** Selecting an item opens with what and why at the highest level — the operator's bar is **grokking it in under five seconds** — and deepens on demand. The current behavior (dumping status paragraph, scope bullets, exit criteria, and every milestone at once) is the thing being fixed. State (milestone checklist, attached agents, what is blocking, recent commits) outranks contract prose in the opening view; scope and exit criteria live one level down.

**Backlog: one list, backlog is a state.** Researched 2026-08-03 rather than invented. The 2026 consensus is that roadmap and backlog are two layers of one planning system, not two documents, and the strongest practical rule is one tracker — do not split defects from work. Linear implements exactly this by making Backlog a *status* rather than a separate view. Applied here:

- everything is one queue; `backlog` is a state for items not yet sequenced
- a defect with an owning item hangs off that item **and** appears in the backlog lane — one record, two ways in. The operator's "bugs on their item" and "a bug backlog" options were never alternatives
- **provenance is visible** (operator requirement): every backlog row shows where it came from — quick-capture feedback, operator triage, an incident record — and its owning item. "I want to be able to see bugs clearly and also source"
- this maps onto the ENG-025 triage taxonomy that already exists: kernel → new roadmap item; small fix / incident candidate → backlog row against an owning item

**Home: the Team-altitude panel stays** (operator). No new tab, no new destination. The panel gets better rather than graduating into a surface.

The column is narrow, and the panel now has to hold a queue, a backlog, item detail, and launch gestures. The operator relaxed the constraint rather than the scope: *"We can also x-expand the panel slightly when it has focus if we need more space."* So the panel is **ambient when glanced at and wider when focused** — the same lens at two densities, which is the pattern the app already uses between an altitude and its overview.

Even expanded it is a column, not a page, so navigation stays single-focus: the queue is the resting view, selecting an item slides its detail over the list with a back gesture, and one thing is legible at a time. A permanently split column would halve the room for exactly the detail view the operator called unreadable.

**Backlog storage: short entries in the repo's roadmap file** (operator, 2026-08-03). Chosen over a separate defect file or reading the feedback database directly, because it keeps one tracker, keeps the backlog repo-owned like every other piece of project state, and works for any adopting repo rather than only the operator's own account.

An entry is a heading, the item it belongs to, and its provenance — no scope, no exit criteria:

```markdown
## Backlog

### Codex tab shows finished while the agent is still working
Status: bug · ENG-016 · quick-capture 2026-08-03
```

Three consequences that must land together, because doing any one alone leaves the model incoherent:

1. **The published convention and the parser need `backlog` as a queue status distinct from `later`.** Today `## Backlog` is a recognized *synonym* for `## Later` (`roadmap-convention.md` → Queue sections), so the distinction the operator asked for does not survive parsing. The change is additive and degrades gracefully — an older parser reading a newer file still resolves `later` — but the convention is **published** and other repos adopt it, so this is a versioned spec change with a migration note, not a private edit. Change the spec and the parser in the same slice; never ship a spec that describes behavior the parser lacks.
2. **The ENG-025 triage protocol gains a target.** A small fix or incident candidate writes a backlog entry in the roadmap file *and* keeps its diagnostic narrative in the owning item's project doc. The entry is the machine-readable pointer; the doc note is the reasoning. The three rows triaged on 2026-08-03 into `daily-driver-adoption.md` are the worked example — each has real diagnostic content that does not belong in a one-line entry, and each is currently invisible to any UI.
3. **The lens renders both as one record set**, with provenance visible on every backlog row so the operator can see at a glance what came from quick capture, what from triage, and what belongs to which item.

**Assignment: launch from the item.** Select an item, press a key, an agent starts on it — pre-filled with the item as its task and **linked by construction**, so inference never has to guess. Attaching an already-running agent is the secondary path. This is S10's long-gated ASSIGN verb, and it inverts the linkage problem: today the lens guesses which item an agent is on; after this, the operator says so at launch.

**Liveness: three signals** (operator selected all three):

- progress moves as commits land — checkmarks and progress fill visibly, as it happens, not silently between visits
- agents visibly attached and working, with elapsed time and turn state, updating continuously — the roadmap doubles as a fleet view organized by work rather than by project
- a recent-change trail — "ENG-032 T0 landed 2h ago" — so returning after hours pages the work-world back in

### Boundary: what writes, and what does not

RESOLVED 2026-08-03 by decision `0029` — the operator lifted the read-only gate: *"Yes indeed, manipulate roadmap state in the repo. Maybe pop a permission dialog with always allow / don't ask me again."*

- **launch-from-item and attach are LOCAL annotations**, exactly like S4's declare-at-launch (`workspace.json`). No repo file is touched.
- **reordering, status changes, and milestone ticks now write the repo file**, under decision `0029`'s six constraints: sequence and state only (never prose, never item creation); declared conformance required; Exawatt writes the file and never runs git; permission rides the Project's launch policy behind its own seam; concurrent modification is refused rather than merged; and the operator sees the edit animate in place with an inline pending/applied/failed state and a short undo window.
- **Read the decision before implementing.** Two things there are easy to get wrong: "commit" in the operator's phrasing means the write being applied, NOT authorization for Exawatt to run `git commit` (that would reverse ENG-019 and needs its own decision); and permission is *modeled* separately even though it *resolves* through the launch policy today, so the two can be split later without a refactor.

### Repo readiness (S13.6) — mostly already built

The operator asked for "a publishable spec to make a repo Exawatt-ready and manipulable… nice and green in the roadmap view, or a small warning icon with hover tooltip / remediation-agent-spawn gesture if the repo is not natively Exawatt compatible," and added that capturing it was enough if it did not exist.

Most of it does exist. `docs/product/reference/roadmap-convention.md` is the published spec (S1, decision `0011`), the parser already distinguishes a **declared-conformant** file from one it read on a tolerant best-effort basis, and it already emits positioned diagnostics instead of guessing (S1, S5). What is missing is purely the surfacing:

- conformance state visible in the lens — conformant reads as unremarkable, non-conformant carries a small honest marker
- the parser's existing diagnostics readable in place, so "what is wrong with my roadmap" is answerable without running a script
- a gesture that launches an agent to adapt the repo to the published convention — the operator's "remediation-agent-spawn", which composes naturally with S13.3's launch-from-item since both start an agent with a pre-filled task

This milestone also carries S13.5's gate: conformance is what decides whether a roadmap is manipulable at all, so the badge is not decoration — it explains why the write gestures are or are not available.

### Queued work (defects, not design)

- **S3 inference linking fails on a real case.** An agent working ENG-032 in a worktree showed as unmapped while the matcher looks for the declared id in branch, worktree, title, context summary, and commit subjects. Reproduce against the operator's live theming Session before changing the matcher — the cause may be worktree cwd resolution rather than the matcher itself. Launch-from-item (S13.3) reduces the blast radius but does not excuse the bug: Sessions Exawatt did not launch still depend on inference.

## Roadmap milestone log (moved from roadmap.md, 2026-07-24)

On 2026-07-24 `docs/engineering/roadmap.md` was compressed to its contract —
status, concise scope, exit criteria, a one-line milestone list, and links —
so the top-level sequence is readable in one screen. The milestone narratives
and status history that lived in the roadmap until that date are preserved
verbatim below, exactly as written, including their dates. The roadmap remains
canonical for sequence and status; this log is the durable execution detail it
points to. Nothing here is new material: it is the ENG-017 roadmap entry as it
stood on 2026-07-24.

<!-- Verbatim: docs/engineering/roadmap.md ENG-017 entry, 2026-07-24. Do not reword. -->

### ENG-017 Project roadmap lens

Status: active-build — S0-S11 landed through 2026-07-12; RE-HOMED 2026-07-20 (operator, landed same day): the lens's home moved from the Terminal view to the Sessions altitude (S12) — Sessions is the zoomed-out view and the roadmap is zoomed-out context; Terminal keeps only per-session mirrors. Earlier framing: INFLATED 2026-07-11 (operator UX interview + external research pass) with a second arc S6-S10: the built rail is correct but not yet FELT — it rests as a low-signal sliver, linking rarely engages, and it only reads. The second arc makes the lens ambient, sequence-first, attention-integrated, and mirrored into the agent-first surfaces. Design resolved 2026-07-11 (operator design interview; created 2026-07-10, operator dogfood interview). The operator's stated goal for parallel agents is that each one "has enough food to eat" — a well-defined roadmap it can execute autonomously for hours, eventually days. That state stays canonical, durable, and malleable **in each project's repo** (roadmap docs exactly like this file); Exawatt does not own it. What Exawatt adds is a really good visualization of it: the roadmap sequence within each Project and what each agent is currently chewing through, as part of context-at-a-glance. Design resolution: a keyboard-first, read-only roadmap rail in the workspace, scoped to the focused Project, built on a shared view-model that a future spatial/GPU expression consumes unchanged.

Scope:

- publish the Exawatt roadmap convention (`docs/product/reference/roadmap-convention.md`) and read it with a tolerant, diagnostic-honest parser; repos adapt to the published convention, and the parser reports unrecognized structure instead of guessing (amended 2026-07-11 from "stay format-tolerant rather than inventing a proprietary format" — the operator wants a published markdown convention as the definition API compatible repos target)
- linear single queue per Project in v1 — deliberately enforces canon sequential execution; parallel/multi-track roadmaps recorded as future
- visualize sequence, status, and what each live session is executing; link sessions to items by inference (branch, worktree, title, context summary, commit subjects — with visible confidence and evidence) plus optional declare-at-launch; unmapped sessions stay visibly unmapped, never guessed
- read-only first: no editing, no assignment from Exawatt; declared links are machine-local view annotations (`workspace.json`), never repo writes
- operator decisions (2026-07-11 UX interview): the resting posture stays COLLAPSED but the strip must carry real signal (a readable per-item spine, not a count); the lens is WORK-FIRST — always a sequence answering "where are we, what's next, what's shipped, what's active, what's blocked" (no dates, no gantt precision — position is the schedule); Sessions overview and Spatial are the AGENT-FIRST views and should mirror item context rather than the rail inverting to agents; blocked items and empty queues ("starving") join the existing needs-you attention pipeline — one attention truth
- current-vs-next semantics (research-backed): "current" is whatever has a live session ATTACHED; "next" is position in the queue; progress renders as honest n/m milestone fractions, never blended percentages; nominal states stay visually quiet — color is reserved for blocked/starving/parse trouble
- the manipulable lens (feed an item to an agent from the rail, reorder, status transitions) is DESIRED but gated on design play: explore as disposable prototypes first, ship nothing until the operator accepts a top-notch interaction design; the repo file stays the only truth either way
- future arc, recorded for direction and explicitly not built now: Exawatt manages the queue and assigns agents to it (bridges toward ENG-013), and non-code work classes (marketing, customer outreach, email inboxes — today the operator's work is 80–95% coding agents) flow through the same queue

Exit criteria:

- from the workspace, "what is this agent working on, and what's next in this Project" answers itself without opening the repo's docs
- the visualization reads from repo state; deleting Exawatt loses no project state
- the collapsed strip alone answers "roughly where are we, and is anything blocked or starving" from peripheral vision
- a blocked item or an empty queue reaches the operator through the same attention system as terminal bells (⌘J, badges, optional notifications)
- linked-session context (item id + milestone fraction) is visible on the agent-first surfaces (Sessions overview tiles; Spatial when unparked)

Milestones:

- S0 Canon (landed 2026-07-11): this entry updated from the shaped design pass; project doc created.
- S1 Convention + parser (landed 2026-07-11): published convention spec, decision `0011`, `@exawatt/core` roadmap parser with fixture tests; exawatt's own roadmap parses conformant with zero edits.
- S2 Read-only rail (landed 2026-07-11): validated main-process read IPC, ui-model lens, workspace rail (⌘B summon cycle, keyboard-first queue walk, drill-down, designed empty/none/error states, trust strip), verified by an Electron eval (`scripts/roadmap-rail-eval.mjs`) across fixture and real repos.
- S3 Inference linking (landed 2026-07-11): closed-vocabulary matcher with id-boundary matching and ambiguity-means-unmapped, per-cwd git evidence IPC (branch/worktree/commit subjects), confidence-encoded session chips (dashed = inferred, evidence tooltips), unmapped shelf, context-bar reciprocal chip that opens the rail drilled to the item.
- S4 Declare-at-launch (landed 2026-07-11): optional "working on" picker in launch controls (only while the dir follows the active Project), `workspace.json` v3→v4 tab annotation with chained v1→v4 migration tests, declared-overrides-inferred; a declared id the roadmap no longer contains falls to the visible unmapped shelf.
- S6 Signal-rich strip (landed 2026-07-11): redesign the 36px collapsed strip from a count into a readable spine — one node per queue item in sequence (shipped/now/next glyphs), the current-item node marked by session ATTACHMENT with a subtle activity pulse, blocked/starving as the loudest pixel, hover/keyboard peek; the strip is the resting posture, so it carries the whole "where are we / anything wrong" answer.
- S7 Sequence-first rail (landed 2026-07-11): the open rail answers the five questions at a glance — agent chips with elapsed time on EVERY attached row (not just the hero), n/m fraction pills throughout, a compact sequence bar in the header (shipped ▰ now ● next ○), suppressed nominal color per the status-discipline rule, and drill-in milestone expansion (the deferred R2 level).
- S8 Attention integration (landed 2026-07-11, renderer-side): blocked items and queue-empty starvation become first-class needs-you events flowing through the existing attention pipeline (⌘J queue, tab badges, FleetState mirror, default-off native notifications) — no second notification machine.
- S9 Agent-first mirrors (landed 2026-07-11): Sessions overview tiles and the ⌘K switcher rows carry the linked item id + milestone fraction; Spatial agent pieces adopt the same chip when ENG-004 unparks — the lens's data reaches every surface that answers "what is this agent doing".
- S10 Manipulable-lens design play (visual-language question RESOLVED 2026-07-12 — round 1 rejected the shipped presentation as dense/mono/unclear dots; round 2's three replacement directions were also rejected: operator chose "keep the shipped version, refine it"; the directions module is retired; the manipulable GESTURES remain gated on a future play session): read-only stays canon until an interaction design is accepted (bridges toward ENG-013).
- S12 Sessions-altitude home (operator, 2026-07-20; landed 2026-07-20): the roadmap lens re-homes to the Sessions overview — the zoomed-out altitude is where "where are we, what's next" belongs — and leaves the Terminal view entirely (no rail, no collapsed strip; Terminal keeps only the per-session context-bar chip, declare-at-launch, and the S8/S9 attention + tile mirrors). The rail docks as a permanent panel in the Sessions overlay, scoped to the overview's SELECTED Project (roving between tiles re-scopes the plan — the multi-project answer without a merged queue). `⌘B` becomes "open Sessions with the roadmap focused" from anywhere, toggling focus between tiles and rail inside Sessions; the context chip and starving-attention jumps land in Sessions drilled to their item. Read-only posture, keyboard grammar, and repo-file truth are unchanged.
- S11 Legibility refinement of the shipped rail (landed 2026-07-12): plain-language group headings (Now / Up next / Later), hero progress bar + "Next up:" milestone line + amber "Blocked — reason" line, checkmark milestone checklist with retired strikethrough, capitalized sans pills and section labels, status-token jargon stripped from prose, honest read-only footer, ▰→✓ shipped glyphs; selection scrollIntoView now requires rail focus (was scrolling the page on re-render). Same-day round 3: the manipulable verb is ASSIGN (not feed), progress gestures relabeled in plain language, and Escape backs out of the project-scoped lens (drill → queue → strip + terminal); multi-project roadmap truth explicitly deferred by the operator pending direction refinement.
- S5 Live watch + polish (landed 2026-07-11): dir-level file watch with debounced change broadcast (survives atomic saves and git rewrites), header sweep + FLIP row motion on reparse, workmusic and compliance-intel adapted to the convention (both parse declared-conformant with zero warnings), honest degradation verified on unadapted ucp-list (none-conformance, counted unparsed lines).

Project doc:

- `docs/engineering/projects/project-roadmap-lens.md`
