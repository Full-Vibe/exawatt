# Delegation Visibility — Subagents as Fleet Truth

Roadmap item: ENG-023

This is execution detail for ENG-023, not a separate roadmap. The **design pass
ran 2026-07-27** with the operator; its conclusions are recorded on the roadmap
item, and this doc holds the durable evidence and contracts behind them.

## Why this doc exists

The roadmap item began as a direction capture, not a plan. It arrived with
enough verified on-disk evidence that the design pass could argue about
presentation rather than about whether the data exists. That evidence is durable
execution detail, so it lives here and the roadmap keeps the contract.

## Design pass — 2026-07-27

Operator session. Four decisions were taken; every mechanism claim below was
verified end-to-end on the operator's machine during the pass, not reasoned
about. The capture-time evidence (on-disk layout, corpus counts) is preserved in
the verbatim log further down; where the two disagree, this section wins,
because the capture-time framing assumed a file reader and the pass replaced it.

### D-A Mechanism: a harness event channel, push-primary

The capture framed this as reading `~/.claude/projects/<slug>/<sessionId>/subagents/`.
**That framing is superseded.** Claude Code exposes delegation as documented
lifecycle hooks, and Exawatt can subscribe per launch without touching the user's
configuration. The harness reports its own delegation; Exawatt does not go
looking for it.

Verified during the pass (Claude Code 2.1.206):

| Property                                           | Result                                                                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Hooks injected via `claude --settings <file>` fire | yes — `SessionStart`, `SubagentStart`, `SubagentStop` all delivered                                                          |
| `SubagentStart` payload                            | `agent_id`, `agent_type`, parent `session_id`, `prompt_id`, `cwd`, `transcript_path`                                         |
| `SubagentStop` payload                             | the above plus **`agent_transcript_path`**, `last_assistant_message`, `permission_mode`, `background_tasks`, `session_crons` |
| `PreToolUse` with matcher `Agent\|Task`            | fires in the PARENT carrying `tool_input.description` — the operator-legible child label, at spawn                           |
| `PostToolUse` inside a child                       | carries `agent_id` + `agent_type` — live per-child activity is available as push                                             |
| `type: "http"` hooks                               | POST the payload with custom headers to a loopback listener; no helper binary needed                                         |
| Injected settings vs the user's own project hooks  | **merge additively** — a project `.claude/settings.local.json` hook and the injected hook both fired                         |
| Dead listener (Exawatt closed or crashed)          | **fails open** — the Session completed normally in 9.7 s                                                                     |

Two consequences:

1. **Path discovery leaves the critical path.** `SubagentStop` hands Exawatt the
   child's transcript path. There is no slug derivation, no directory-layout
   assumption, and no `~/.claude` hardcoding in the live path — which is what
   makes this safe to ship to users who are not the operator. The on-disk reader
   remains as a **fallback** for history and for Sessions Exawatt did not launch,
   and that fallback already resolves `CLAUDE_CONFIG_DIR` / `CODEX_HOME` from the
   spawned process environment (`electron/main/pty/agent-models.ts`), not from a
   hardcoded home directory.
2. **The channel is not delegation-specific.** It is a general source-agnostic
   observation seam — turn boundaries, notifications, permission requests, and
   compaction are all available through it. Delegation is its first consumer, not
   its purpose. Operator framing during the pass: push "is the most future-proof
   and supports some of our longer-term goals as well."

### D-A2 The channel is a capability, not an assumption

Three mechanisms exist across the harnesses Exawatt targets. The contract
describes which one a source supports; the UI never assumes.

| Source               | Delegation today                                                                        | Observation mechanism                                                                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code          | yes                                                                                     | **push** — injected `--settings` hooks (verified)                                                                                                                                                                                                  |
| Codex                | **none** — no Agent/Task tool; ENG-008 E0 measured 0 delegated records across 356 files | hooks exist and use the same JSON shape, but are **trust-gated**: Codex persists a `trusted_hash` per hook file in `config.toml` and needs `--dangerously-bypass-hook-trust` to skip. Exawatt must not silently inject. Future: `codex app-server` |
| OpenClaw             | unknown                                                                                 | **protocol** — gateway events (`packages/core/src/oc`), a third mechanism under the same contract                                                                                                                                                  |
| Demo Scenario Source | simulated                                                                               | same view model, clearly simulated provenance                                                                                                                                                                                                      |

A source therefore declares delegation as `observable: false` (Codex today),
not as zero children. Absent capability reads as absent — confirmed by the
operator — and never as an empty state, a zero count, or a broken surface in a
parallel first-class regime.

### D-B State model: two independent facts, no new light

The pass established that Exawatt today collapses three distinct situations into
one `Active` light. Measured event ordering from a real delegating Session:

```
658.24  UserPromptSubmit          parent turn opens
662.06  SubagentStart  ac1ac…     child starts
663.46  Stop (parent)             parent finished its OWN turn
737.21  SubagentStop   ac1ac…     child finishes — 74 s later
737.29  UserPromptSubmit          the child's result re-opens the parent turn
743.74  Stop (parent)
```

For 74 seconds the parent was **idle and available** while its child worked.
Operator framing: _"'Active but you can talk to me because my subordinates are
busy' is different from 'Active and you can only enqueue a message.'"_

Both facts are independently push-observable and must stay independent, exactly
as `reference/agent-state.md` requires ("Attention, Agent turn state, Session
process lifecycle, plan position, and freshness remain independent facts even
when a view composes them into one row"):

- **Own turn** — `generating` between `UserPromptSubmit` and `Stop`; `available`
  after `Stop`.
- **Delegated work** — outstanding `SubagentStart` minus `SubagentStop`.

Resolution, per the operator's explicit choice of _behavior only, no new light_:

- The **five-light protocol is unchanged**. No new state is added to the reviewed
  Off / Active / Result / Needs You / Fault vocabulary. Existing states receive
  more correct inputs; the vocabulary does not grow.
- **Terminal** answers _"can I talk to it?"_. The light continues to describe the
  Session's own turn. The composer simply behaves correctly: input while
  `available` sends immediately even with children running; input while
  `generating` enqueues, as today. The affordance lives in the input, not in a
  new glyph.
- **Sessions and Spatial** answer _"is this work moving?"_. A Session with running
  children never reads as finished. Operator framing: _"if the team is working
  they're working."_
- Delegation renders as a **separate additive channel** — child **dots, not
  counts**, per the established UI preference — in a constant footprint, so a
  child appearing or finishing never shifts a row (the D24 rule).
- The concrete correctness fix: `attention-monitor` must not raise `turn-end`
  while children are outstanding. Byte quiescence currently reports a delegating
  parent as a finished turn, which is the bug this item exists to kill.

### D-C Altitude sequence

The operator ranked the jobs: _"1 primarily. But all broadly. I don't care about
4 so much (but I suppose there should be a way to zoom into a child agent as
well in the future)."_

- **D1 — "Is that quiet tab done, or waiting on children?"** The first slice.
  Event channel, capability contract, the two-fact state model, the attention fix,
  and child dots in Terminal and the tab strip. Sessions and Spatial consume the
  same derivation from `session-status.ts`, so no delegating Session reads as
  finished anywhere, without designing a new surface yet.
- **D2 — Terminal delegation detail.** The per-child rail: type, the child's own
  description, elapsed, state; the child's result readable here.
- **D3 — Fleet topology and child zoom.** Sessions and Spatial gain real
  delegation topology (ENG-004's stated mandate), including entering a child.
- **Not scope.** A results-collection surface. The operator explicitly deprioritized
  it; the results themselves remain reachable in Terminal.

### D-D Content boundary

Delegated labels and results are message content, which the ENG-008 consumption
parse deliberately never reads. Measured on the operator's own corpus:

|        | Example                                          | Size                    |
| ------ | ------------------------------------------------ | ----------------------- |
| label  | `Find project open/switch in Exawatt`            | 29–36 characters        |
| result | a full markdown report naming files and findings | 7,148–10,401 characters |

Decision: **labels everywhere, result readable in Terminal only, nothing sent
off-machine.** Labels are chips; results are multi-KB documents describing a
private codebase, and holding them would put a permanent asterisk on the
otherwise trivially auditable claim that Exawatt keeps only names and numbers.
Results stay in the Electron main process and are never routed to the ENG-021
summarizer or any other network path. Reversible: D3's child zoom is the
deliberate next step past this line, taken knowingly rather than by drift.

### D-E Risks this pass accepted

- **Hook injection is configuration that executes code.** Exawatt injects its
  own hook file; the user must be able to inspect exactly what is injected, and
  the file belongs in Exawatt's own state directory with restrictive permissions.
- **Loopback listener is an attack surface.** Bind 127.0.0.1 only, ephemeral
  port, per-Session bearer token, bounded payload size, reject non-loopback.
- **Hook latency is the operator's latency.** Every injected hook runs inside the
  harness turn. Keep them a single loopback POST with a short timeout and
  fail-open semantics — verified above, and a permanent regression gate.
- **`--settings` is a CLI contract that can change.** Probe the capability at
  launch and degrade to the pull reader rather than assuming.
- **No activity exhaust.** `PostToolUse` inside children is available and is
  deliberately NOT subscribed in D1. `reference/agent-state.md` requires grouped,
  meaningful Events over per-tool streams, and a child-by-child tool ticker at
  Sessions altitude would be a regression.
- **Unverified.** Whether `--settings` applies on `--resume`, and the behavior of
  `background_tasks` / `session_crons` (reported by `SubagentStop`, out of scope
  here but the same channel would carry them).

## D1 implementation — landed 2026-07-27

### What runs

`electron/main/harness-events/` is the new seam, all of it pure Node and unit
tested without Electron:

| Module                   | Role                                                                                                                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `channel.ts`             | one loopback listener for the app; one opaque token per launch. The token — not a session id, path, or provider identity — maps an event back to a Session, which is why nothing here knows where a harness keeps its state |
| `claude-hooks.ts`        | builds the injected settings document and normalizes payloads into the shared vocabulary                                                                                                                                    |
| `delegation-state.ts`    | the two-fact reducer; returns the same reference on a no-op so a broadcast can be skipped                                                                                                                                   |
| `delegation-monitor.ts`  | per-Session truth, published as `pty:delegation`                                                                                                                                                                            |
| `hook-settings-store.ts` | per-launch settings files, `0600`, in Exawatt state, swept on startup                                                                                                                                                       |

Integration is deliberately thin. `harness-registry.ts` gained a `delegation`
capability and an `eventChannelInvocation`; `buildHarnessCommand` gained a
`wiring` options bag rather than a ninth positional; `session-manager`
subscribes before spawn and releases on exit and kill; `pty-ipc` broadcasts
changes and rides delegation along on `pty:list` so a reload adopts live
children instead of waiting for the next one to start or finish.

### The correctness fix

Two places, because suppressing the attention signal alone was not enough:

- `attention-monitor` withholds `turn-end` while children are outstanding, and
  gains `noteHarnessTurnStart` so a REPORTED turn boundary reopens the settled
  latch. This matters most for the turn a returning child opens — no keystroke
  precedes it, so nothing else would have reopened it.
- `sessionGlyphState` treats delegated work as working. Without this the light
  still derived `done` from a quiet parent, and every surface reads this one
  function, so Terminal, Sessions, and the ⌘K switcher were corrected together
  rather than one at a time.

### Correction to the design pass

The pass listed "typing into a parent whose own turn has ended sends
immediately" as an exit criterion. **Exawatt never gated input.**
`terminal-pane` wires `term.onData` straight to `pty.write`, so queueing is
entirely the harness TUI's own behavior and there was nothing to build. The
availability fact is real and observable — it simply needed no code, which is
also why the operator's "behavior only, no new light" choice cost nothing.

### Verification

`pnpm eval:electron:delegation` (12 checks) drives the whole pipeline in the
real app. Its harness is a fixture, but not a mock of Exawatt: it parses the
ACTUAL injected `--settings` document and posts the ACTUAL hook payload shapes
captured from Claude Code 2.1.206, so everything from settings file to rendered
dots is production code. It asserts, among others, that the settings file lands
in Exawatt state and not the user's harness config, that a quiet parent with a
live child still reads as working with no turn-end raised, that a `Stop`
carrying an `agent_id` does not move the parent, that children arriving never
resize the row, that a child's report body never reaches a surface, and that a
source with no delegation capability renders nothing at all.

Real-harness proof, same day: a genuine Claude Code session spawning a genuine
Explore subagent reported
`{ownTurn: "generating", children: [{agentType: "Explore", …}]}` through
Exawatt's own IPC, held `working` with `attention: null` for the whole life of
the child, and cleared its dots when the child finished.

Regression: full suite (941), lint, both typechecks, plus the Project/Agent
launcher and navigation-spine evals, since the launch command and three status
surfaces changed.

### Visual decisions

Dots are 3 px with a 3 px gap — gap wider than the dot so a cluster reads as
separate workers rather than as an ellipsis after the title — vertically
centered against the status light, capped at five with the exact number kept in
the tooltip and accessible name. The cluster is a constant width for its cap, so
children arriving and finishing never resize the row; it appears with the first
child and leaves with the last, the same conditional footprint the harness and
pinned marks already use. Motion is one slow breath, staggered per dot, off
under reduced motion.

The elastic Project / Initiative ribbon (ENG-016 D41, decision `0022`) consumes
this truth without changing its altitude: child dots stay on the parent
Initiative-shaped tab, and delegated activity participates in the compact
Project-level working signal when that Project is collapsed. A child never
creates a top-level ribbon tab merely because the harness exposed it. D3 may
make child topology directly navigable in Sessions and Spatial; that future
zoom does not invalidate the Terminal aggregation boundary.

### Post-landing review — 2026-07-27

A read-through of the landed diff found three defects that the D1 tests and eval
had not covered, because all of them asserted delegation-PRESENT behavior and
none asserted what happens when there is nothing to draw.

1. **Empty flex child padded every non-delegating row.** The dots were wrapped
   in a colored `<span>` at both call sites. `DelegationDots` returns `null`
   correctly, but the wrapper survived as a zero-width flex child, and the tab
   row's `gap-1.5` then added ~6 px to every agent tab that was not delegating —
   a silent regression to a tuned strip. Fixed by giving `DelegationDots` a
   `color` prop so it owns its own styling and no wrapper exists. Locked in by a
   test asserting the tab chrome has no empty element children.
2. **A hook delivery could throw in the main process.** `request.on('error')`
   and `request.on('end')` can both fire for one request; the second
   `writeHead` throws `ERR_HTTP_HEADERS_SENT` from inside an event handler.
   Fixed with a one-shot guard plus a `writableEnded` check and a try/catch.
   Locked in by a test that aborts a request mid-flight and asserts no
   `uncaughtException`.
3. **A second push source would have been parsed as Claude.** `session-manager`
   hardcoded `claudeHookEvent` / `claudeHookSettings` for any harness declaring
   an event-channel invocation. The settings document, the launch flag, and the
   payload parser are one decision, so they now live together as
   `HarnessEventChannelBinding` on the harness descriptor, and `session-manager`
   no longer imports any provider module.

Also hardened: a post-bind socket error no longer nulls a still-open listener
(which would have left new launches unsubscribed while the server leaked), and
the eval's first two waits carry cold-compile headroom so a cold dev server
reports real failures instead of a Next build.

**Known and accepted:** if the listener is up when a child starts but down when
it stops, that Session keeps a stale dot until its process exits. The window is
narrow (the app must go down and come back while the same PTY survives, which
rehydration does not do — a resumed Session gets a fresh id and empty state) and
closing it would require a timeout heuristic, which is exactly the guessing this
feature exists to replace.

### Deliberately not built

`PostToolUse` is available and would give live per-child activity. It is not
subscribed: `reference/agent-state.md` promotes meaningful Events over per-tool
streams, and a child-by-child ticker at Sessions altitude would be a regression.
Child descriptions (`PreToolUse` on `Agent`, or the sibling `meta.json` reachable
from the transcript path the hook already hands over) are D2's input, not D1's.

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
