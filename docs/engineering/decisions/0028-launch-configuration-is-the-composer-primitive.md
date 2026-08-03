# 0028 The Launch Configuration is the composer's primitive

Date: 2026-08-03
Status: accepted

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
- **Agent Types.** ENG-028's frame — the Type is the worker, the harness is only
  the engine — needs a home in the composer. Adding a sixth dropdown for it
  would be the wrong answer to a row that is already too dense.

The operator's framing on 2026-08-03: engine chips and named presets should be
*"same-class citizens… so in the future we can have automatically frecent
engines / presets in the same sort of row / ribbon. It should be super easy to
use tab / arrows to pick a new config (engine + agent specialty type +
harness + intelligence + etc.) or create a custom new one + frecents."*

## Decision

The composer's primary control is a **frecency-ordered ribbon of Launch
Configurations**. A Launch Configuration is one selectable thing that carries a
whole launch, and it replaces the row of independent selectors.

- **Identity is harness + model + effort + Type.** Permissions and the
  worktree/branch decision stay per-launch modifiers outside the configuration,
  so the ribbon does not multiply into `Kimi`, `Kimi + worktree`, and
  `Kimi + YOLO` as three chips of the same thing.
- **A chip is labelled model-first with the harness as its glyph and brand
  colour** — `◈ Opus 5 · High`, `◇ Kimi K3`, `▣ Shell`. The model is the axis
  that actually varies between configurations; the harness is usually implied by
  it and is carried by the glyph without spending a word. A *named*
  configuration displays its name instead (`⚡ Reviewer`), with its axes visible
  on selection.
- **Shell is a peer chip, not an icon.** A blank terminal is a Launch
  Configuration whose harness is `shell`; it appears in the same ribbon, reached
  by the same arrows, started by the same Enter. `⌘⌥T` remains the direct
  one-stroke gesture.
- **Arrows move across chips; Tab dives into the selected chip's axes.** Each
  axis (harness, model, effort, Type, permissions, worktree) is a tab stop.
  Changing any axis **forks an unsaved configuration** which immediately enters
  frecency. There is therefore no separate "create a configuration" flow: you
  reach a new configuration by editing an existing one, and naming it is
  optional and later.
- **Frecency is per-Project over one shared pool.** A configuration exists once
  in the app; each Project ranks the pool by the operator's own use *there*.
  This extends the existing per-Project memory of source and permission mode
  rather than inventing a second memory.
- **A named configuration is the on-ramp to an Agent Type.** Naming is the
  moment a launch stops being a set of settings and starts being a worker; when
  ENG-028 T2 ships the Type format, a named configuration is what gains
  identity, instructions, and required tools. The Type axis renders as an
  ENG-026 `announced` affordance until then — one honest empty slot inside the
  editor, not a sixth dropdown in the row.

## Consequences

- ENG-016 D35's visible model/effort selector row is **superseded as a
  presentation**. Its substance is preserved and strengthened: every axis stays
  visible, every default keeps its named provenance, and nothing about the
  launch becomes implicit. Recorded in the roadmap's Amendment chain.
- ENG-028 T1's composer entry point moves from a standalone `/agent-types` icon
  into the Type axis of the configuration editor, which is a contextually
  correct anchor rather than an adjacent one.
- The "continue this work on another configuration" gesture (ENG-037's cheap
  half) has an obvious home and an obvious vocabulary the instant configurations
  exist: it is a relaunch onto a different chip with a handoff prompt, using
  machinery `freshConversationPrompt` already provides. ENG-037's true
  freeze-and-reinflate remains unshaped.
- Anything the ribbon can do must also be reachable from `⌘K` (the palette is a
  complete backstop), and the ribbon is the visible first-class home (the
  palette is never the IA).
- Risk accepted: two representations of one state — chip and axis strip — can
  disagree if they are not derived from a single selector. The implementation
  keeps one source of truth for the active configuration and renders both from
  it; a divergence here is a defect, not a tuning question.
