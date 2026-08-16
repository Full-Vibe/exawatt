# 0028 The Launch Configuration is the composer's primitive

Date: 2026-08-03
Status: accepted

Amended: 2026-08-03 after the operator's lightweight-launcher review. The
configuration ribbon remains the primitive, but the always-visible editor,
unsaved-configuration lifecycle, edit-driven frecency, `⌘S` naming chord, and
"naming creates a Type" boundary are superseded below.

Amended: 2026-08-16 by decision `0037`. Agent remains the coworker instance;
Agent Type is the reusable blueprint describing what kind of worker it is, and
the harness remains the engine. The optional Type axis below is unchanged.

## Context

The Agent composer today asks the operator to assemble a launch out of five
independent controls every time: Agent Source, model, effort, permissions, and
an options popover (worktree, branch, roadmap link) — plus an unlabelled shell
icon tucked at the far right and an `/agent-types` link that is a preview
anchor. Each control is individually well-built and provenance-honest (ENG-016
D35, ENG-003 S1), and together they make the most common act in the product —
starting an Agent — a five-decision form.

Two pressures converge on it:

- **Engine plurality.** Decision `0027` adds a third launchable source, and with
  it OpenRouter, Kimi, and local models. The flat model `Select` that works for
  six Claude rows does not work for a catalog of hundreds, and the axis count
  grows rather than shrinks.
- **Agent Types.** ENG-028's frame — the Agent is the coworker, its Type
  describes the worker kind, and the harness is only the engine — needs a home
  in the composer. Adding a sixth dropdown for it
  would be the wrong answer to a row that is already too dense.

The operator's framing on 2026-08-03: engine chips and named presets should be
_"same-class citizens… so in the future we can have automatically frecent
engines / presets in the same sort of row / ribbon. It should be super easy to
use tab / arrows to pick a new config (engine + agent specialty type +
harness + intelligence + etc.) or create a custom new one + frecents."_

## Decision

The composer's primary control is a **frecency-ordered ribbon of Launch
Configurations**. A Launch Configuration is one selectable thing that carries a
whole launch, and it replaces the row of independent selectors.

- **Identity is configured Agent Source + source-native model + exact effort or
  variant + optional Type.** The configured source identity matters because
  two instances of one harness may have different endpoints, accounts,
  catalogs, and readiness. Harness remains derived launch and presentation
  data. Permissions, worktree/branch, and roadmap association stay per-launch
  modifiers outside the configuration, so the ribbon does not multiply into
  `Kimi`, `Kimi + worktree`, and `Kimi + YOLO` as three things. Editing those
  modifiers never forks a configuration.
- **A chip is labelled model-first with the harness as its glyph and brand
  colour** — `◈ Opus 5 · High`, `◇ Kimi K3`, `▣ Shell`. The model is the axis
  that usually varies; the harness is carried compactly by the glyph while the
  accessible name states the complete identity. A named configuration displays
  its friendly preset name instead (`⚡ Reviewer`). Harness brand colour stays an
  identity accent, not a status or action fill.
- **Shell is a peer launch choice, not an Agent configuration disguised as
  one.** The domain is a discriminated Agent-or-Shell union. Shell has no model,
  effort, Type, or Agent permission axes, but it appears in the same ribbon and
  remains reachable through the direct `⌘⌥T` gesture. Task text is never sent to
  Shell.
- **The page stays a launcher, not an Agent builder.** Its normal launch-control
  area is the task field, one compact ribbon, and Start. There is no
  always-visible axis editor, configuration Draft badge, or preset-management
  panel. The existing Project-scoped recent-conversation browser remains
  secondary content with its plain-arrow and Enter semantics unchanged. `⌘T`
  focuses the task so typing and Enter remain the zero-setup path. While the
  task owns focus, `⌥↑/↓` cycles whole configurations instead of cycling only
  the source; visible help teaches that fast path. The standard accessible path
  is one radio-like ribbon tab stop with Left/Right selection. A compact
  Customize action exposes source, model, effort, future Type, and initial Name;
  each Agent configuration chip/All row owns Pin/Unpin, Rename, and Delete in
  its secondary menu. Shell owns Pin/Unpin only and cannot be renamed or
  deleted.
- **There is no Launch Configuration draft lifecycle.** Identity edits may ride
  the existing composer draft tab's exact launch snapshot, including across a
  restart, but that snapshot is not a reusable configuration and never enters
  the pool or rank by itself. Closing the draft without a successful launch or
  explicit naming leaves no reusable configuration behind. A successful launch
  structurally deduplicates or adds the configuration; naming explicitly saves
  the current combination as a reusable preset through one short secondary
  action.
- **Frecency is per-Project over one shared pool.** A configuration exists once
  in the app; each Project ranks the pool by successful launches _there_.
  Selection, navigation, editing, naming, failed launch, and abandoned work do
  not increase frecency. Project-local pins sit above learned results, and the
  order freezes while the operator interacts so a focused target never moves.
  Reranking applies on the next composer entry. This extends the existing
  per-Project memory of source and permission mode without conflating policy
  with configuration identity. The singleton Shell launch target participates
  in the same Project ordering and may be pinned; a successful Shell launch is
  its only usage signal. This does not make Shell an Agent configuration.
- **Naming creates a friendly preset, not an Agent Type.** A future Type may be
  selected as one identity axis, but naming alone makes no claim about identity,
  instructions, tools, or portability. The Type entry remains an ENG-026
  `announced` affordance until the Type mechanism ships. There is no global
  `⌘S` naming command in this slice.
- **The ribbon is a bounded working set with a visible complete route.** It is
  one non-wrapping row whose visible count follows measured chip widths rather
  than a fixed number. A visible **All configurations…** disclosure reaches the
  complete catalog; `⌘K` mirrors the same catalog and is never its only home.

## Consequences

- ENG-016 D35's visible model/effort selector row is **superseded as a
  presentation**. Its substance is preserved and strengthened: every identity
  choice remains inspectable through quiet Customize, every default keeps its
  named provenance, and nothing about the launch becomes implicit. Recorded in
  the roadmap's Amendment chain.
- ENG-028 T1's composer entry point moves from a standalone `/agent-types` icon
  into the announced Type entry inside Customize, which is a contextually
  correct anchor rather than an adjacent one.
- The cheap cross-source continuation gesture is **Clone to…**. It creates a new
  Agent Session on a chosen available Agent configuration using a bounded
  handoff prompt, leaves the original Session intact, and never passes a
  provider resume identity. Its explanatory copy may say "continue with" or
  "starts a new Agent with a handoff"; it does not imply live migration. Shell
  is not a clone target. The true freeze-and-reinflate problem remains
  separately unshaped.
- Anything the ribbon can do must also be reachable from `⌘K` (the palette is a
  complete backstop), and the ribbon is the visible first-class home (the
  palette is never the IA).
- Risk accepted: ribbon, secondary editor, palette, native commands, and Clone
  can disagree if they do not derive from one selector and one launch command.
  The implementation keeps one source of truth for the selected configuration;
  divergence is a defect, not a tuning question.
