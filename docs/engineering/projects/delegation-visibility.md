# Delegation Visibility — Subagents as Fleet Truth

Roadmap item: ENG-023

This is execution detail for ENG-023, not a separate roadmap. The direction is
**deliberately unshaped pending a design pass**; this doc holds the feasibility
evidence gathered at capture time and the boundaries the pass inherits. Do not
shape scope, altitudes, or slices here — that happens in the design pass, and
its conclusions land back on the roadmap item.

## Why this doc exists

The roadmap item is a direction capture, not a plan. It arrived with enough
verified on-disk evidence that a future design pass can argue about
presentation rather than about whether the data exists. That evidence is
durable execution detail, so it lives here and the roadmap keeps the contract.

## Roadmap milestone log (moved from roadmap.md, 2026-07-24)

On 2026-07-24 `docs/engineering/roadmap.md` was compressed to its contract —
status, concise scope, exit criteria, a one-line milestone list, and links —
so the top-level sequence is readable in one screen. The direction narrative,
feasibility evidence, and boundaries that were captured directly in the roadmap
on that date are preserved verbatim below, exactly as written. The roadmap
remains canonical for sequence and status; this log is the durable execution
detail it points to. Nothing here is new material: it is the ENG-023 roadmap
entry as it stood on 2026-07-24.

<!-- Verbatim: docs/engineering/roadmap.md ENG-023 entry, 2026-07-24. Do not reword. -->

### ENG-023 Delegation visibility — subagents as fleet truth

Status: planned — captured 2026-07-24 from the operator question "can we
visualize these subagents in Exawatt's UI surfaces, first-party?". Direction
accepted; **deliberately unshaped pending a design pass**. Do not shape scope,
altitudes, or slices outside that pass.

Direction: a Session that has delegated work is not one Agent. Today Exawatt
counts tabs, so a tab reading "1 agent" can be four Opus children editing four
files in three worktrees, and the strip, exposé, and board all report one. Every
concept this touches is already canon and unimplemented — `concepts.md` ("Agents
can create or coordinate subagents when their source supports it"),
`reference/agent-state.md` (the `Delegated` Event verb; Spatial "should emphasize
pressure, topology, delegation, and leverage"). The gap is a reader, not a
vocabulary.

Feasibility (verified against Claude Code 2.1.206 on 2026-07-24, so a design pass
argues about presentation, not whether the data exists):

- Claude Code writes each delegated run to
  `~/.claude/projects/<slug>/<sessionId>/subagents/agent-<id>.{jsonl,meta.json}`.
  `meta.json` lands at spawn with `agentType`, an operator-legible `description`,
  the parent `toolUseId`, and `spawnDepth` — delegation is a tree, not a list
  (depth 2 already occurs locally). The `.jsonl` is appended LIVE; the live
  `tasks/<agentId>.output` path is a symlink to it, so tailing is exact, not
  polled guesswork.
- Exawatt already knows the exact path with no scraping: `claude` is
  `allocatesFreshSessionId`, so `session-manager` allocates the `--session-id`
  it will find on disk. `ClaudeConversationAdapter` already reads that root and
  already filters `isSidechain` — this is the same reader, kept instead of
  discarded.
- Lifecycle is structured, not inferred: spawn (meta write) → running (appends,
  each carrying model, tool_use, `cwd`, `gitBranch`, exact token usage) →
  finished (a `queue-operation` `<task-notification>` in the PARENT transcript
  with `<status>`, summary, and the full result). Agents are resumable, so an
  agent may leave and re-enter the running state.
- Two adjacent first-party sources surfaced in the same survey and belong in the
  same design pass rather than a separate hunt: `~/.claude/tasks/<sessionId>/*.json`
  (structured plan items with `subject`/`activeForm`/`status` — real evidence for
  agent-state's **Plan** region, which only ENG-017 roadmap linkage feeds today)
  and `<sessionId>/workflows/wf_*.json` (a whole fan-out's phases plus per-agent
  `label`/`model`/`state`/`attempt`/`lastToolName`/`promptPreview`; one local run
  records 28 agents and 1.4M tokens).
- Corpus for building and regression: 230 delegated runs across 59 local Sessions
  already on disk.

Why it is worth a pass beyond the visualization itself:

- It is the first STRUCTURED truth Exawatt would hold about a Claude Session.
  Attention (`attention-monitor`), turn state, and context labels are all derived
  from raw PTY bytes today; a transcript reader is a shared upgrade path, and the
  turn-state question "is a quiet parent finished, or waiting on four children?"
  is currently unanswerable by byte quiescence alone.
- Consumption (ENG-008) cannot be honest while the majority of token spend is
  invisible: the delegated runs measured above dwarf their parents' own usage.

Constraints the design pass inherits (not scope, but boundaries):

- Source-capability honesty (ENG-003 / `reference/agent-sources.md`): Codex writes
  no equivalent on-disk delegation record. Absent capability must read as absent,
  never as an empty or broken surface in a parallel first-class regime.
- `reference/agent-state.md` already forbids what this could easily become: the
  **Now** region promotes meaningful Events, not activity exhaust. A delegation
  surface that streams children's tool calls is a regression, not a feature.
- Provider-shape fragility is real and already survived once — the older inline
  `isSidechain` record shape is gone from local history in favor of the
  `subagents/` directory. Treat the layout as an adapter behind a capability
  probe that degrades silently, never a parsing assumption in UI code.
- Delegated prompts and results carry full source. They stay main-process and
  local unless they pass the same redaction contract as ENG-021's Objective
  Engine.
- Watch cost is bounded by construction: tail by byte offset with the catalog's
  existing bounded-read helpers; never re-parse a growing transcript.

Sequencing: after the design pass, and behind the active daily-driver arc
(ENG-015 / ENG-016 / ENG-021). Feeds ENG-004's delegation-topology mandate and
ENG-008 Consumption; the source-capability boundary belongs to ENG-003.
