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
  conversation belongs to ENG-018's detachable backend if it ever becomes
  necessary.
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

All six slices landed 2026-07-11; operator dogfood remains before the
roadmap item is called done.

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
