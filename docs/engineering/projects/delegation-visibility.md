# Delegation Visibility — Subagents as Fleet Truth

Roadmap item: ENG-023

This is execution detail for ENG-023, not a separate roadmap. The **design pass
ran 2026-07-27** with the operator; its conclusions are recorded on the roadmap
item, and this doc holds the durable evidence and contracts behind them.

Current execution direction: [D6/D8 research brief, 2026-09-18](#2026-09-18--d6-and-d8-execution-brief-truthful-delegation-end-to-end).
Earlier sections are dated history where amended by that brief or the roadmap's
Amendment chain; D5.1 is implemented, D6/D8 remain planned.

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

| Source               | Delegation today                                               | Observation mechanism                                                                                                                                                                                                                                                                                 |
| -------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code          | yes                                                            | **push** — injected `--settings` hooks (verified)                                                                                                                                                                                                                                                     |
| Codex                | yes — current operator Sessions launch real parallel subagents | **protocol** — Codex 0.147.0 app-server exposes parent/child thread identity, descendant listing, collaboration tool-call state, and subagent activity items. The PTY/log adapter still declares this absent until D5 consumes that owned protocol; Exawatt must not infer it from local side effects |
| OpenClaw             | unknown                                                        | **protocol** — gateway events (`packages/core/src/oc`), a third mechanism under the same contract                                                                                                                                                                                                     |
| Demo Scenario Source | simulated                                                      | same view model, clearly simulated provenance                                                                                                                                                                                                                                                         |

A source therefore declares delegation from the adapter it is actually using,
not from a product-wide assumption. The current Codex PTY/log adapter remains
`observable: false`; the D5 app-server adapter will declare protocol
observation. Absent capability reads as absent — confirmed by the operator —
and never as an empty state, a zero count, or a broken surface in a parallel
first-class regime.

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

UNMATCHED `PreToolUse`/`PostToolUse` are available and would give live per-child
activity. They are not subscribed that way: `reference/agent-state.md` promotes
meaningful Events over per-tool streams, and a child-by-child ticker at Sessions
altitude would be a regression. D4 subscribes both MATCHED to `AskUserQuestion`
alone; the boundary is intact and now measured (see D4's verification). Child
descriptions (`PreToolUse` on `Agent`, or the sibling `meta.json` reachable from
the transcript path the hook already hands over) are D2's input, not D1's.

## D4 implementation — landed 2026-08-02

### The report

An operator screenshot pair: a `⌘4` tab showing a green Result light while
Claude Code sat on an `AskUserQuestion`, and the same tab showing the blue
Active rotor a moment later, after `⌘4` focused it. Neither reading was true,
and the operator's framing was the important part — "I often see bugs here in
this area, even after a few different bugfixing passes."

### Root cause — three defects, one event

1. **Inference was allowed to contradict the report.** `AttentionMonitor` was
   handed `setDelegationSource(id => isBusy(id))` — a boolean about CHILDREN.
   It could see neither the Session's own reported turn nor anything else, so
   byte quiescence went on concluding "turn finished" for a Session whose
   harness had reported `ownTurn: 'generating'`. D1 fixed this shape for
   children and left the parent's own turn unguarded.
2. **There was no state for "waiting on the operator."** `AskUserQuestion`
   fires no `Stop`, so the reported turn stays open while the Agent does
   nothing at all. No subscribed hook reported the gate, so the truthful
   `needs-you` light was unreachable — after focus cleared the bogus result the
   tab read "working — output streaming" indefinitely.
3. **The surface hid the contradiction until focus revealed it.**
   `sessionStatusLightState` short-circuited to `result` on a turn-end signal
   instead of going through `deriveStatusLightState`. Attention is an
   unseen-event overlay and is cleared by focus, so the disagreement underneath
   only became visible at the moment of focus — which is exactly what the
   operator saw and why it read as a race rather than as a lie.

### The durable rules

- **Reported outranks inferred AT THE SOURCE.** One `setReportedTurnSource`
  handing over the whole record, not one injection per fact. The narrowness was
  the bug; a new reported fact now corrects inference without new wiring.
- **Waiting on the operator is its own fact.** `blockedOn` sits beside
  `ownTurn` and `children`, independent of both, because an Agent parked on a
  question is genuinely mid-turn AND genuinely producing nothing.
- **Gate releases are reason-scoped**, with turn boundaries as a never-latch
  backstop, so an unrelated hook can never answer an open question and a
  dropped release can never strand one.
- **Attention is what has not been SEEN; the light is what is TRUE.** Focusing
  a Session changes the first and never the second. This is the invariant every
  case in `turn-truth-pipeline.test.ts` asserts.

Still no sixth light: a gate lands on the existing `needs-you`.

### Verification — measured against Claude Code 2.1.220, not assumed

Fixture evals cannot tell you whether the harness behaves as documented, and
this area had already survived several passes that were locally consistent and
globally wrong. So the mechanism was driven against the real binary:

- **Matchers genuinely scope HTTP hooks.** A run where Claude executed a `Bash`
  tool call posted `UserPromptSubmit -> PostToolBatch -> Stop` and NO
  `PreToolUse`/`PostToolUse`. The no-activity-ticker boundary is now a measured
  property, not a hope.
- **The matched path fires.** Re-aiming the same matcher at `Bash` produced
  `UserPromptSubmit -> PreToolUse[Bash] -> PostToolUse[Bash] -> PostToolBatch
-> Stop`, confirming payload fields (`tool_name`, `tool_use_id`) and ordering.
- **The reported bug, observed.** A real interactive session asked a real
  question and reported `UserPromptSubmit -> PreToolUse[AskUserQuestion] ->
Notification[permission_prompt]`, with **no `Stop`** — the root cause, live.

That last measurement corrected the design mid-flight. One question is
announced TWICE, six seconds apart, under two different names. The first draft
let a later `blocked` overwrite the gate's reason, which would have left
`PostToolUse[AskUserQuestion]`'s scoped release unable to match — a gate
stranded until the next turn boundary. **One wait is one gate, however many
times it is announced**: the first report wins until something releases it.

### Post-landing review — 2026-08-02

Reviewing D4 against the real harness turned up a regression D4 itself had
introduced, plus a pre-existing blindness at the altitude above it.

**The reclaim rule (a bug D4 shipped).** D4's first cut suppressed inference
whenever the harness reported a turn open. Measured afterwards, subscribing to
every documented hook: an ABORTED turn emits nothing at all — no `Stop`, no
`StopFailure`, no `SessionEnd`. `UserPromptSubmit` is the last word the harness
will ever say about it. So "the harness reported `generating`" is not proof of
life, and treating it as such left every interrupted tab spinning until the
operator's next prompt — the same lie as before, pointed the other way.

The corrected rule is narrower and is the durable one: **a reported-open turn
outranks inference only while something EXPLAINS its silence.** A running child
and an open operator gate both explain silence and both end with an event the
harness guarantees, so they are trusted indefinitely. A bare `generating` with
neither explains nothing, and after a generous window inference reclaims it by
applying an ordinary `turn-end` — one fact, changed once, seen by every surface
together.

The reclaim and the inferred raise are gated on ONE condition on purpose. Split
them and `⌘J` would offer a ready result during the window in which the strip
still read working, which is the same class of drift D4 exists to remove. The
burst that justifies the raise is also no longer consumed while deferring to a
live report: consuming it there left the eventual reclaim with no evidence, and
an aborted turn settled silently.

**The Project dot (pre-existing).** `deriveProjectRibbonSignal` re-derived
Session truth from raw `activity`/`attention` instead of consuming the shared
derivation, and had drifted from it: it could read "Results ready" for a Session
whose harness reported a turn still open, and — because focus clears the
attention record — for one parked on an unanswered question. A collapsed Project
shows only that dot, so it was the loudest remaining instance of the original
bug. It now routes every tab through `sessionStatusLightState` and encodes the
strongest light, so it inherits every correction automatically.

### The eval fixture and fail-closed source truth — 2026-08-02

`e21b4a2` made Agent Source truth fail closed: a source whose probes do not
answer is not launchable. Correct for the product, and it silently broke every
fixture-driven eval, because the fixture's fake harness answered no probes at
all — its `claude` held every invocation open forever, including
`claude --version` and `claude auth status --json`. Each eval run also LEAKED
those hung processes, which accumulated across runs.

The failure was almost undiagnosable from the outside: the composer's Start
button simply stayed disabled, Playwright reported a bare 25s "element is not
enabled", and nothing anywhere named the cause. `openFixtureSession` now reads
the source registry before clicking Start and fails with the actual per-fact
state, so the next person spends a minute on this rather than an hour.

Two lessons worth keeping:

- **A fake must answer what the real thing is asked, in the real shape.** A
  first pass at this returned a plausible-looking auth JSON rather than the one
  `parseClaudeAuthStatus` reads, so the source stayed degraded and the eval
  stayed red for a reason no output mentioned.
- **The fixture's fake binaries are emitted from template literals**, so an
  escape written for the outer file rather than the generated one produces a
  syntax error in the fake binary — which then fails EVERY probe at once and
  looks exactly like a hung app.

### Operator evidence — 2026-08-03: attention fired while children were live

Feedback row `3142884d-a98a-489f-b00f-de66e5311ca8` reports a regression in the
D1/D4 turn-truth contract: the Consumption-design Session showed the orange
needs-attention indicator and entered the `⌘J` queue after the parent Claude
agent finished its own turn, even though the parent was still waiting on three
running subagents. Navigating there therefore surfaced busy delegated work,
not a result or operator gate.

This is active-work evidence for ENG-023, not a new attention mode. The shared
derivation must continue to hold `working` while any child is live, must not
raise a ready-result attention record at the parent's turn end, and must keep
that Session out of `⌘J` unless an independent operator gate is genuinely open.
Diagnosis and execution remain queued for the owning turn-truth pipeline.

### Deliberately out of scope

`⌘J` still treats focus as "seen", so it will not walk back to a Session that
is still blocked once the operator has looked at it. The tab keeps its
`needs-you` light, so the state stays visible; changing the navigation queue's
seen-semantics is a separate decision about `⌘J`, not a status-indicator fix.

## D3 design pass — 2026-08-02: Sessions and Spatial visualization

Operator request, same day as the V3 spatial pass: "we need way better subagent
activity visualization in the Sessions tab, and Spatial should visualize way
better too" — accompanied by a screenshot of Claude Code's own background-agent
list (ctrl-o), which already shows per-child agent type, a live activity line,
and elapsed time while Exawatt's tiles showed presence dots alone. The harness's
own TUI out-informing the fleet surface is the gap this pass closes.

### What the CLI list gets right, and what it gets wrong for this altitude

The screenshot's list is the evidence base D3 starts from. Kept: one row per
child; the agent type; an operator-legible description; elapsed time. Rejected
for Sessions altitude, deliberately:

- **Live token counters.** Consumption truth belongs to ENG-008's parse and its
  delegated-share treatment. A per-child token ticker at comparison altitude is
  activity exhaust with digits, and the live channel does not carry usage — a
  fact worth preserving, not working around.
- **Second-granularity timers.** A tile grid where five timers tick every
  second is motion without meaning. Elapsed renders at minute granularity and
  updates on a slow tick; the exact start time lives in the tooltip.
- **A flat list detached from the parent.** The CLI shows children of one
  session. Sessions altitude shows children **on the parent's tile**, because
  the operator's question is "is this Session's team moving," not "enumerate
  processes."

### Sessions grammar — the child rail

When a Session's reported delegation has live children, its tile's **Now**
region carries a child rail under the current-activity sentence (which drops
from two clamped lines to one — the rail is worth more than the second line):

- one row per child, capped at three rows: with more than three children the
  rail shows two rows plus a final "and N more working" line, so the rail's
  vertical budget is a constant three rows inside one fixed tile footprint.
  (The tile grew once, 248→272px, to hold the full stack — the one deliberate
  geometry change of this pass.) The full census stays in the presence-dot
  tooltip AND in the tile's accessible name, which — because the tile is an
  `aria-label`ed button whose subtree is presentational to assistive tech —
  is the only place a screen-reader user hears the team at all.
- each row: a breathing dot in the Project color (the D1 dot, same 2600ms
  breath, same reduced-motion park), the source's own agent type in mono
  chrome-meta, the child's own description in readable sans, elapsed in
  tabular mono at the right edge.
- rows carry **labels only** — type, description, elapsed. No child results, no
  tool names, no token counts. The D-D content boundary is unchanged.
- the rail appears with the first child and leaves with the last, the same
  conditional footprint as the dots. `meaningfulChange` yields its line while
  the rail is present. Absent delegation capability renders nothing, as always.

The header presence dots stay exactly as D1 shipped them: the rail is detail
inside the tile, the dots remain the constant-footprint glance signal beside
the light.

### The description channel

D2 named `PreToolUse` matched to `Agent|Task` as the description's source; this
pass subscribes it. The hook fires in the PARENT at spawn — spawn IS the
`Delegated` meaningful Event, so this is one POST per delegation and the
no-activity-exhaust boundary holds (the D4 measurement proved matchers
genuinely scope delivery).

Correlation is heuristic by necessity: `SubagentStart` does not carry the
spawning `tool_use_id`. The reducer keeps a small pending-label list per
Session — `{toolUseId, agentType, description, at}`, deduped by `toolUseId`
(hooks are at-least-once), capped, cleared at either turn boundary — and a
`child-start` adopts the oldest pending entry whose `agent_type` matches (or
the oldest entry when types are unknown). A mismatch leaves `description: null`
and the row renders type-only: a missing label is absent, never invented.
Descriptions are truncated at ingestion to label length; they never leave the
label vocabulary.

### Spatial grammar — delegation topology as detail, not organizing idea

Per the V3 design pass, structure-and-belonging is NOT the board's purpose;
delegation arrives as detail at Team/Agent altitude. The grammar as landed:

- a delegating Agent piece gains **satellites**: one small instanced dot per
  live child in a row tucked **above** the piece (the space below belongs to
  the DOM control label), capped at the shared five, one draw call for the
  whole board. Satellites carry the **project accent** — they are the parent's
  team, not more status — and breathe on the V2.4 ambient gate, parking still
  under reduced motion / low power / hidden tab.
- the piece's DOM control copy gains the count and the team's kinds
  ("3 delegated · Explore, general-purpose") in the label and the accessible
  name. Full child descriptions stay at Sessions and Terminal altitudes — a
  board tooltip is not a roster. Aggregate pieces carry no satellites.
- the fleet transport treats running children as `working` with the same
  precedence as the tab strip (gate outranks team; team outranks a stale turn
  boundary), and `pty:delegation` pushes a re-list so the board tracks the
  harness instead of trailing the next poll tick.
- entering a child (child zoom) is **not** in this slice: it depends on D2's
  Terminal rail landing first so the zoom has a destination. The topology may
  render before it is navigable.

### Sequencing note

This executes D3's Sessions and Spatial halves ahead of D2's Terminal rail —
the operator asked for fleet-altitude legibility first, and the description
channel this builds is exactly D2's input, so the Terminal rail inherits it.
Child zoom remains open behind D2.

### Post-landing review — 2026-08-02

A three-perspective adversarial pass over the landed D3a/D3b commits found
seven defects worth fixing and several boundaries worth writing down. All
fixes landed the same day.

**Correlation must fail to ABSENT, and the first cut could fail to WRONG.**
Three reducer defects shared that shape:

1. A spawn label REDELIVERED after its child adopted it re-staged and was
   adopted by the next same-type sibling — an invented label. The ledger now
   tombstones adopted `tool_use_id`s (cleared at turn boundaries).
2. The staging cap evicted the OLDEST label, so a 17-spawn fan-out shifted
   the entire cohort onto its neighbors' labels. Correlation is positional:
   the cap now drops the INCOMING label, so overflow goes unlabeled instead
   of mislabeled.
3. `SubagentStart`/`SubagentStop` are separate HTTP POSTs, so a stop can
   outrun its start (or a start can be redelivered after the stop) — and the
   resurrected child had no removal path, wedging the Session as "team
   working" until process exit. Ended child ids are now tombstoned for the
   turn; a genuinely resumed child re-admits at the next turn-start.

**Other hardening from the same pass:** the monitor ignores hook stragglers
that land after a Session dropped (in-flight POSTs after a kill would have
recreated state nothing cleans) and no longer broadcasts a withdrawal for a
Session that never published; the `Agent|Task` matcher is anchored
(`^(Agent|Task)$`) so unanchored-regex matcher semantics cannot turn
superstring tools (`TaskOutput`, …) into per-call POSTs; label truncation
slices by code point, not UTF-16 unit; the delegation eval asserts the child
prompt is absent from the `pty:list` IPC payload itself, not just the DOM.

**Sessions tile:** the card's identity+Now regions now share one
`overflow-hidden` clipping band above a Next region that is pinned by
construction — extreme content (a two-line rename plus a context subtitle
plus a full rail) clips the rail's tail rather than the plan line, and the
context cue yields its second line while the rail is up. Reload no longer
resurrects a settled rail (the delegation seed gained the same
cleared-before-seed guard as attention and activity). A non-finite child
start time renders no elapsed rather than `NaNm`. Rail rows carry hover
tooltips with the full label and the exact start time, per agent-state's
freshness rule.

**Spatial:** the satellite instance buffer is sized to the layout's actual
budget (120 project-altitude pieces × 5 satellites = 600; drei silently
no-ops writes past `limit`), and the ambient park value sits ON the breath
curve so gate transitions never pop. The transport change-key includes
`agentType` with unit-separator framing so free-text labels cannot alias it,
and `pty:delegation` refreshes coalesce through one 150ms trailing timer.

**Recorded, not changed:**

- At demo scale, aggregate pieces and density fields carry no delegation
  signal — beyond the individual-piece budgets the board deliberately stops
  showing topology. Aggregation semantics belong to V2.1's parked truth half,
  not to this item.
- The fleet transport still ignores the record's `ownTurn` (the tab strip
  ranks it above byte inference; the board does not). Reported-turn parity
  for the fleet surfaces is a separate ENG-015 S1.1 follow-up, noted in the
  transport.
- Rail descriptions render one tier below body type (text-xs). That is a
  deliberate density trade inside a fixed three-row budget; the full text is
  in the row tooltip.

## D3c design brief — 2026-08-06: child units and lifecycle motion

**Subagents become visible units, not punctuation.** Operator dogfood compared
the Fleet board with its originating Claude Session: four distinct
`general-purpose` workers in the harness collapsed to four tiny dots above one
large parent tile. D3b is truthful, but its hierarchy is too recessive to convey
fan-out, leverage, or the fact that the work is being done by several Agents.
This brief supersedes D3b's tiny-satellite treatment at individual board
resolution; D3b's event truth, caps, accessible census, and one-draw-call
instancing remain the substrate.

### 1. Feature summary

At individual Fleet-board resolution, every live delegated child becomes a
recognizable unit from the same beveled hex family as its parent, targeted at
`0.78×` the parent's diameter rather than a dot. A thin Project-identity tether
and deterministic radial placement make parentage legible without reorganizing
the board into a delegation tree. This is an ENG-023 visualization milestone
that integrates through ENG-004's one persistent WebGL world.

### 2. Primary operator understanding

One glance should answer: **this Agent has fanned out into these workers, and
they are still working.** The operator should not need a tooltip or the
originating terminal to distinguish one parent with four children from one
ordinary Agent.

### 3. Design direction

The treatment is a living command board, not an orbit diagram and not an org
chart. It expresses Exawatt's commanding, lucid, kinetic design context through
restrained physical motion: solid related units, a quiet lineage connection,
and lifecycle transitions that explain spawn and exit. Project identity owns
the tether/rim; the existing D40 protocol owns status; no new color or light is
invented. The board remains WebGL/Three.js and decision `0007` restraint still
governs material and motion.

### 4. Layout strategy

- The parent keeps its stable board address and slightly stronger rim/scale.
  Children occupy pure, deterministic rosette slots around its upper and side
  perimeter; the lower label lane stays clear. The radial/floral composition
  echoes the already accepted board-arrival language without replaying that
  global entrance.
- One through five children render as individual child hexes. Above five, four
  individual units plus one same-family overflow lobe carry `+N`; the exact
  census and kinds remain in the DOM control/accessibility copy. The gallery
  study must compare a second ring against the overflow lobe before fixing the
  high-fan-out treatment, but it may not fall back to punctuation-sized dots.
- A hairline Project-accent tether runs parent edge → child edge at individual
  resolution. It fades before very-far aggregation so a large fleet never
  becomes a hairball. Tethers communicate lineage only; they do not imply
  message flow, status, or command authority.
- Children contribute to visible population mass. At the very-far boundary
  they agglomerate under the same F7 policy as top-level Agents rather than
  disappearing from the fleet census.

### 5. Key states

- **No observable delegation:** render nothing; absent capability stays absent.
- **First spawn:** one child emerges from the parent's edge into its stable
  slot; the tether establishes in the same transition.
- **Several live children:** each unit remains individually legible through the
  normal board resolution and carries only truth the source reports.
- **Overflow:** the high-fan-out treatment preserves exact count, mass, and
  accessible kinds without unbounded labels or draw calls.
- **Child stop/termination:** the departing child retracts along its tether and
  fades; unsupported success/failure semantics are never invented.
- **Altitude/camera change:** the constellation remains in the same world and
  morphs continuously with its parent. It never remounts from the origin.
- **Reduced motion / low power / hidden tab:** identical topology and census,
  with a short crossfade or immediate stable placement instead of spatial
  travel. No information disappears.
- **Redelivery, reordering, missing correlation:** retain D3b's fail-to-absent
  rule and stable child identity. An event anomaly may omit a unit; it may
  never attach the wrong label or animate the wrong child.

### 6. Interaction and motion model

- **Spawn:** begin at the parent's edge at reduced scale/opacity, then move to
  the deterministic slot with a critically damped spring (target settle
  `450–650ms`, no bounce/elastic overshoot). Cohort spawns stagger `40–70ms`
  with total stagger capped. Only transform, opacity, and the R3F tether
  endpoint animate; input remains live throughout.
- **Stop:** finish faster than entrance (`240–320ms`): status light extinguishes,
  tether retracts, and the unit folds toward the parent while fading. No
  particles, explosion, or decorative death effect.
- Existing siblings keep stable slots when another child starts or stops; the
  lifecycle event moves the affected unit, not the whole family. Camera follow
  continues to follow the selected parent/child under ENG-004's safe-zone
  policy and never dead-centers the constellation.
- A visible child is focusable by pointer, arrow navigation, and the Fleet DOM
  accessibility path. Focus reveals type, description, elapsed, and parent.
  Activate opens the parent Session until D2 provides the child-detail
  destination; D3c does not pretend the child is independently commandable and
  does not add it to **Direct N Agents**.

### 7. Content requirements

Board copy is limited to the child's source-reported type, short description,
elapsed time, and parent identity in hover/focus detail. Results, prompts, tool
calls, token tickers, and second-granularity timers remain out of Fleet. No
capability renders no affordance or zero-state copy.

### 8. Implementation and review sequence

1. Prototype the parent + `0/1/4/5/17` child states and spawn/stop timelines in
   `/hud-gallery` as an R3F study for operator review before production wiring.
   Include reduced-motion and low-power siblings.
2. Extend the pure board model with deterministic child slots, lineage edges,
   overflow policy, and stable identity. The R3F layer remains a damped
   executor; no lifecycle/layout policy lives inside `<Canvas>`.
3. Replace D3b's dot-only production treatment at individual resolution,
   preserve Demo/Live source parity, then retire the accepted gallery study.
4. Extend `eval:electron:delegation`, `eval:spatial`, pointer/keyboard probes,
   and scale fixtures before landing.

### 9. Acceptance and open review calls

- The four-child operator fixture visibly shows four child hex units and their
  parentage without hover; no dot-only substitute passes.
- Parent and child remain the same noun family, with child diameter no smaller
  than `0.70×` the parent in the accepted gallery treatment.
- Spawn and stop produce continuous frame sequences with no teleport, remount,
  input lock, or frame gap above the board's existing transition budget.
- A settled constellation adds no lifecycle frames; only genuine Active-state
  motion survives, and reduced-motion/low-power retain identical information.
- The Voltaic, 1k, and 10k scale matrix stays within the existing draw-call,
  label, memory, and p95 frame budgets; high fan-out cannot exhaust the
  instance buffer.
- Keyboard and screen-reader paths expose child identity, parent, count, and
  state without placing the WebGL canvas in the accessibility tree.
- Gallery review decides the exact child ratio within `0.72–0.82×`, whether the
  tether persists on parent/child focus only or throughout individual
  resolution, and overflow-lobe versus second-ring treatment. Those are visual
  tuning calls, not permission to return to tiny satellites.

## D3c landing — 2026-08-07: children are units

Landed with ENG-004 V3.4 in the one persistent WebGL board. D3b's event truth,
caps, accessible census, and instancing remain the substrate; only the
individual-resolution board treatment changed. D1's compact DOM dots are
untouched, as the brief required.

What shipped against §9's acceptance list:

- **Four children read as four workers.** The deterministic
  `/eval/t5-operations-board?fixture=fanout` rig renders the `0/1/4/5/17` states
  on one board; the four-child parent shows four hex units and their parentage
  without hover. No dot-only substitute survives at individual resolution.
- **Same noun family, `0.72x` the parent** — inside the accepted band and above
  the `0.70x` floor, pinned by a test.
- **Overflow preserves the census**: above five children, four individuals plus
  one same-family lobe carrying the exact remainder (`+13` for seventeen).
- **Deterministic rosette slots** across the upper and side perimeter, stopping
  at the horizontal so the parent's label lane stays clear. A test pins that
  invariant and caught a real defect during implementation.
- **Lineage without authority**: a hairline Project-identity tether. D40 keeps
  sole ownership of status; no new light or colour is invented, and the child
  body is the same Agent noun as its parent.
- **Peers, not a hierarchy** (2026-08-07, operator): children render at `0.92x`
  the parent and lineage rides a spoke from the parent centre rather than a size
  difference. D3c's `0.72–0.82x` band and `0.70x` floor are superseded — a
  delegated worker is not a lesser Agent. A child still is not independently
  commandable (it never joins **Direct N Agents**,
  and activating opens the parent Session); at peer scale that is a mismatch to
  resolve when D2 gives a child a destination.
- **Children carry the D40 Active mark** (2026-08-07, operator): a live child is
  working by definition, and without a mark it read as an empty silhouette
  rather than an Agent. Drawn by the same instanced layer as parents, so it is
  the same light at no extra draw call. Overflow lobes stay unlit — a single
  light cannot honestly speak for several Agents — and carry their count.
- **Finite lifecycle motion**: spawn emerges from the parent edge into its slot
  with a damped settle and capped cohort stagger; stop retracts faster along the
  same lineage. Existing siblings keep their slots. A settled constellation adds
  no frames, and reduced motion keeps identical topology and census with no
  travel.
- **Aggregation (historical implementation; superseded as a semantic contract by D6 below)**: aggregate pieces carry no delegation, so the very-far tier
  emits no units by construction and a large fleet never becomes a hairball.
  The 1k/10k tiers stay at six draw calls.
- **Accessibility**: every visible child is a focusable DOM control whose name
  carries type, description, elapsed, and parent. Activating opens the PARENT
  Session — D3c does not pretend a child is independently commandable, and
  children never join `Direct N Agents`. The board projection now carries the
  child's `startedAt` so elapsed is real rather than invented.
- **Panel parity**: the ENG-004 S4 selection panel lists the inspected Agent's
  delegated children with type, description, and elapsed, folding an over-cap
  list into an exact remaining count. Absent stays absent — an unreported
  description renders as such and never as a fabricated one.

**Historical tuning note, amended by the operator's `0.92x` decision above.**
§9 reserved three calls for gallery review. The initial ratio was `0.72x`; the orbit places each child just clear of the parent body,
close enough that a dense Project altitude stays legible and far enough that no
outline is needed to separate them; and the overflow lobe was chosen over a
second ring. The
operator's visual review of all three is still owed.

**Process deviation.** §8 step 1 asks for a `/hud-gallery` study before
production wiring. The states live in the deterministic eval rig instead, since
ENG-036's workbench rule would require retiring a study in the same change while
the eval fixture is permanent regression coverage. Recorded here so the
substitution is reviewable rather than silent.

## D5 evidence and execution contract — 2026-08-16

Operator dogfood corrected the old product-level conclusion: current Codex
Sessions do launch parallel subagents, but Exawatt's PTY/log adapter renders
none. The old measurement remains valid for that adapter and corpus; it cannot
be generalized to current Codex capability.

This is not a speculative scraping seam. `codex-cli 0.147.0` generates an
experimental app-server JSON Schema that exposes all of the stable nouns D5
needs:

- a `Thread` has `parentThreadId`, `agentNickname`, and `agentRole`;
- a subagent thread's source carries `parent_thread_id`, depth, nickname, role,
  and path;
- `thread/list` accepts `ancestorThreadId` and returns descendants at any depth;
- collaboration tool-call items carry sender and receiver thread IDs, requested
  model and reasoning effort, status, and last-known child states;
- subagent activity items carry child thread ID and `started`, `interacted`, or
  `interrupted` lifecycle kind.

D5 therefore adds a Codex app-server adapter under the existing source-declared
`protocol` mechanism; it does not add another event channel or another child
view model. The adapter must version-probe the protocol, correlate children by
thread IDs, resnapshot descendants after reconnect, and translate only
protocol-reported lifecycle into the D1/D3 surfaces. A controlled parent with at
least two live children is the runtime acceptance fixture. If the protocol is
unavailable or incompatible, the adapter declares delegation absent. Worktrees,
files, process trees, and terminal text remain forbidden evidence.

## D5 implementation — landed 2026-08-16

The Codex PTY remains the interactive Session owner. Electron starts one
separate read-side `codex app-server --stdio`, requires the installed 0.147+
protocol, and shape-validates every response it consumes. The Session's exact
provider thread ID anchors `thread/list`; explicit subagent source kinds are
required because the protocol's default list excludes spawned descendants.
Child turns and each immediate parent's subagent activity disambiguate live,
completed, and explicitly interrupted work at every tree depth.

The adapter reports exact child IDs into the existing `DelegationMonitor` and
therefore the existing Agent, Team, and Fleet projections. It does not add a
Codex-only view model or alter Codex's launch argv. A fresh Session lifecycle
event covers exact resumes whose provider ID exists before spawn; fresh Codex
Sessions attach through the existing exact-identity event. Reconnect discards
the cached observation and takes a new descendant snapshot. Unavailable,
timed-out, old, or malformed protocols withdraw children without emitting
`child-end`, so protocol loss cannot fabricate a ready-result signal.

Installed-runtime proof preceded implementation. The operator's Codex 0.147.0
app-server exposed the active TUI's parent and more than two live child threads
to an independent read-side process. That process reports externally owned live
turns as `interrupted` with a null completion timestamp; the immediate parent's
`started` / `interacted` / `interrupted` activity is the exact disambiguator.
The implementation reads those protocol fields only — never rollout files,
worktrees, process trees, or terminal text.

Verification on the rebased implementation tree:

- focused related suite: 141 tests;
- renderer type-check and Electron compile;
- `eval:electron:delegation`: 23 checks through the running Electron app,
  including two simultaneous Codex children at Agent, Team, and Fleet,
  exact-ID completion, protocol loss to absent without a result, and
  authoritative reconnect resnapshot.

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

## D7 Census coverage and expiry — landed 2026-09-16 (BUG-081)

**A reported child is a claim with coverage and an expiry, not a latch.** One
`census` owner now serves Codex's D5 snapshot and Claude Code's own boundary
census, and a census nothing vouches for expires instead of holding a tab's
spinner until the process exits.

### The report

Product-feedback `5d35a563`, 2026-08-18: "this Claude Code Fable tab looks
pretty finished; yet the tab shows as blue spinning with two subagent dots."
The inverse of BUG-001 on the arm decision `0018` had exempted from
self-correction.

### Root cause, established before building

Two independent read-only reviews of master, then a ledger probe over the
compiled monitors wired exactly as `pty-ipc` wired them. BUG-008's two repairs
were intact. The defect was the one exemption D4's review had written for
children: `silenceIsExplained` and `reclaimStaleReportedTurn` refused to
reclaim while `children.length > 0`, and the parent's `turn-end` deliberately
kept `children`, so the only exits were `SubagentStop` or process exit. On
master, `turn-start`, `child-start x2`, then silence:

```
scenario: abort (no Stop, no SubagentStop — an interrupted parent)
      0ms  child-start c1, c2   children=2 ownTurn=generating live=true  -> active
  12000ms  silence, +12s        children=2 ownTurn=generating live=true  -> active
 600000ms  silence, +600s       children=2 ownTurn=generating live=true  -> active
scenario: lost-stop (parent Stop arrived, both SubagentStop lost)
 600000ms  silence, +600s       children=2 ownTurn=available live=true   -> active
```

A stale census after a resume is structurally impossible (per-launch UUIDs,
ledger dropped on exit, post-drop stragglers ignored), which left the
roadmap's second hypothesis: a `SubagentStop` that never arrives.

### Measured on Claude Code 2.1.270 — 2026-09-13, the real harness

A pty-driven probe launched the installed `claude` under Exawatt's exact
injected settings (`claudeHookSettings` from the compiled adapter) and recorded
every hook POST with a timestamp plus the PTY's bytes per second. Four runs.

Natural completion, two `Explore` children counting files:

```
   6.11  UserPromptSubmit
  11.06  PreToolUse[Agent]                      spawn label
  12.15  SubagentStart  a912…  Explore
  13.99  SubagentStart  a9fd…  Explore
  17.01  Stop           background_tasks: [a912 running, a9fd running]
  18.59  SubagentStop   a912…  background_tasks: [a912, a9fd]   (pre-removal)
  18.65  SubagentStop   a385…  agent_type: ''   (an internal helper; never started)
  19.65  UserPromptSubmit                        the child's result reopens the turn
  20.31  SubagentStop   a9fd…  background_tasks: [a9fd]
  21.52  Stop           background_tasks: []
```

Three facts fall out. Subagents run in the background by default now, so the
parent's `Stop` precedes its children's stops (the D1 pattern, still).
Every `Stop` and `SubagentStop` carries `background_tasks`: `{id, type,
status, description, agent_type}` per running task, subagents and background
shells alike, with a `SubagentStop`'s list taken before the stopping agent is
removed. And `SubagentStop` fires for internal helper agents (prompt
suggestions) that never reported a start; the reducer's tombstone absorbs
those, as designed.

Byte rates, idle at the prompt (30 s windows, one integer per second):

```
no tasks running          [0, 0, 44, 0, 0, 0, 0, 0, 0, 0, 0, …]       total 44
two background children   [315, 209, 164, 211, 145, 203, 237, 87, 142,
                           4368, 726, 4982, 1064, 711, 710, 876, …]  total 26316
after everything, no tasks [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, …]   total 0
```

A parent with a live child is never byte-silent — the task footer redraws
every second, 87 B/s at the quietest second — and an idle prompt with none is
0 B/s. That is the whole coverage argument, and it is measured, not assumed.

The interrupt, ESC pressed 0.2 s after the second `SubagentStart` with the
parent still generating:

```
  15.24  ESC                        -> "Interrupted · What should Claude do instead?"
  35.24  20 s later: parentStop=0  realSubagentStop=0
         bytes/s [331, 183, 239, 304, 239, 301, 123, 182, 181, 313, …]
  86.58  SubagentStop  a042…        the children SURVIVED the interrupt
  89.48  UserPromptSubmit            its result reopens the parent turn
  94.40  Stop           background_tasks: [a160 running]
  97.07  SubagentStop  a160…
  98.53  UserPromptSubmit
 100.16  Stop           background_tasks: []
```

An aborted turn emits no boundary at all, confirming the 2.1.220 measurement.
On this version the background children outlive the interrupt and keep the
footer ticking, so the two dots are TRUE for another 70 s and the tab lands
when they return; a version, an ESC path, or a `/tasks` kill that ends them
without a `SubagentStop` leaves a census nothing vouches for, which is the
case the expiry exists for. The loopback hook's 2 s fail-open timeout makes a
lost stop an ordinary event on any version.

### The contract

- **One owner.** `reconcileCensus` in `delegation-state.ts` and the `census`
  event the `DelegationMonitor` applies. Codex's D5 snapshot
  (`reconcileReportedChildren`, BUG-093) now routes through it; a Claude
  `turn-end` or `child-end` carries the census the same payload reported and
  the reducer applies the boundary first, then the census, so a subscriber
  reading the record on the boundary already sees the reconciled children.
  A census admits a child the ledger never saw start (a lost
  `SubagentStart`), keeps what the ledger knows about a surviving child where
  the census is silent (elapsed never resets), overrides a tombstone (a
  snapshot is newer evidence than the delta it tombstoned), and withdraws a
  child the census omits without completing it. Only a child the source lists
  as `completed` may raise a result.
- **Coverage by the harness.** `claudeHookEvent` reads `background_tasks`
  off every `Stop` and `SubagentStop` (subagents only, `running` live,
  `completed` completed, anything else withdrawn; the `SubagentStop`'s own
  `agent_id` excluded). A lost stop cannot outlive the parent's next
  boundary; a lost start cannot hide.
- **Coverage by the PTY.** Between boundaries the parent renders its running
  team continuously. `reclaimStaleReportedTurn` now fires when silence
  crosses the existing stale bound (`REPORTED_TURN_STALE_FACTOR` x `quietMs`,
  12 s) with no operator gate open and either `ownTurn === 'generating'` or
  children reported — the same instant, one condition, so the queue and the
  light cannot disagree. The gate stays exempt.
- **Expiry withdraws, never completes.** `DelegationMonitor.reclaimStaleReport`
  applies one `turn-end` with an empty census: the turn closes and the
  children are withdrawn as one publication, no `child-end` is emitted for
  them, and the parent's already-reported `Stop` then delivers the result it
  had withheld (`noteHarnessTurnEnd`); a parent still reported generating is
  raised the ordinary way from its own burst.
- **Evidence.** `wireReportedTurnTruth` writes `delegation.census-expired`
  to `logs/main.jsonl` — session id, harness, child ids, agent types, the
  parent's reported turn, `quietMs`, `staleMs` — through
  `boundDiagnosticRecorder` (30/min, 500/run, one `.suppressed` and one
  `.exhausted` line), so the next report is a file read.
- **Unchanged on purpose.** Byte-quiescence thresholds, decision `0018`'s
  latch, the no-children reclaim, the gate exemption, and the no-report arm.

After the fix, the same ledger probe over the shipped wiring:

```
scenario: abort
   5000ms  silence, +5s    children=2 ownTurn=generating live=true  -> active
  12000ms  silence, +12s   children=0 ownTurn=available  live=false -> result, attention turn-end
  [12000ms] delegation.census-expired {"childIds":["c1","c2"],"ownTurn":"generating","quietMs":12000,"staleMs":12000,…}
scenario: lost-stop
  12000ms  silence, +12s   children=0 ownTurn=available  live=false -> result, attention turn-end
scenario: background (the PTY keeps speaking)
 120000ms  +120s           children=2 ownTurn=available  live=true  -> active
 120000ms  child-end c1, c2 (SubagentStop)   children=0 -> result, attention turn-end
```

### Where the wiring lives now

The coupling between the two monitors moved out of `pty-ipc` into
`electron/main/harness-events/turn-truth.ts` (`wireReportedTurnTruth`).
`pty-ipc` runs it in the app with `main.jsonl` as the sink;
`turn-truth-pipeline.test.ts` runs the same function over the same monitors
and the real render derivation, so the contract under test is the contract
that ships rather than a hand-mirrored copy — the drift the D4 review found
when a liveness rule was written on both sides of the IPC. An ENG-039
M1-shaped seam, taken as a bounded refactor demanded by the repair.

### Verification

- `turn-truth-pipeline.test.ts`, both directions, mutation-verified. Spinner
  lands: "a child whose end the harness never reports cannot spin the tab
  forever (BUG-081)". No premature green: "a child keeps the turn open for as
  long as the harness keeps rendering it" (three minutes of 87-byte footer
  ticks read `active` throughout; the child's own stop settles it). Restoring
  indefinite trust of children fails the first and four others; freezing the
  coverage clock while children are reported fails the second and four
  others; the tree as landed passes all. Plus: the lost stop healed by the
  next boundary with nothing logged, a census admitting a lost start, a
  `SubagentStop` census that does not resurrect its own child, and the
  measured 2.1.270 interrupt sequence end to end.
- `attention-monitor.test.ts` census coverage: expiry with evidence at the
  bound, same instant under a reported-open turn, ten minutes of rendering
  never expires, a gate never expires, nothing reported has nothing to
  expire.
- `delegation-state.test.ts` census reconciliation and
  `delegation-monitor.test.ts` census publication (one publication on
  reclaim, boundary census applied before subscribers see the boundary, no
  double `child-end`); `claude-hooks.test.ts` census parsing from the
  measured payloads; `turn-truth.test.ts` for the evidence trail and the
  recorder bounds.
- The fixture harness (`scripts/lib/harness-event-fixture.mjs`) now carries
  the measured census on `stop`/`done`, renders the measured footer every
  second while a child is live, and grew `halt` (the interrupt: children die,
  nothing posted) and `lose <id>` (a stop the loopback never received).
  `eval:electron:delegation` drives the interrupt (dots clear, Session lands,
  `main.jsonl` names b1/b2 and the silence), the covered child (11 s of
  rendering, never expired, no result raised, settles on its own stop), and
  the lost stop (retired by the next boundary's census with nothing logged) —
  all green on the real app, alongside every prior D1/D3a/D5 check and
  `eval:electron:turn-truth` unchanged.

### Deliberately not built

- Polling the child's transcript on disk for liveness. The harness reports
  its own delegation and Exawatt does not go looking for it (D-A1); the
  census on every boundary plus the PTY between boundaries is coverage the
  harness itself provides.
- Process-tree or CPU idleness as evidence. Forbidden for Codex by D5 and
  no better here; the PTY already carries the harness's own rendering.
- A longer, children-specific stale bound. The measured margin (a 1 Hz
  footer against a 12 s bound) does not justify a second instant on which
  the queue and the light could disagree; if a future harness renders a
  running team silently, the failure is bounded to the stale bound,
  self-corrects on the child's return, and is named in `main.jsonl`.
- Widening any timeout. The expiry fires on evidence the harness stopped
  rendering, never on elapsed time since the report.

### Adjacent, not taken

BUG-133 (an agent cannot say where Exawatt shows its subagents; Codex
0.153.4 refuses `thread/items/list`) and BUG-134 (Fleet drops children past
the aggregate budget and under filters), both filed 2026-09-15/16. Their
owner should design against the `census` event as the shared owner: a
narrower per-child Codex withdrawal is a census that omits the ambiguous
child; "unobservable" is a coverage declaration the census does not carry
and needs a new fact. `delegationIsLive` is unchanged (a zero-child record
still publishes `null`) but moved within `delegation-state.ts`.

## D6 evidence — a descendant can disappear from Fleet (2026-08-20)

Feedback `f472e9ce-8389-4678-b631-e8b12b7e0e63` and exact duplicate
`706c28da-d242-459a-9d99-14bc00869323` report the same Codex failure: a
second-level child exists in the app-server tree but is absent from Fleet. D5
already observes descendants at any depth, so D6 is a projection/correlation
repair: capture a depth-2 snapshot, keep immediate-parent lineage distinct from
root Session board scope, render every descendant exactly once at every
altitude, and survive reconnect/completion without flattening or inference.

## 2026-09-16 — BUG-133 half 2: isolate uncertainty and disclose observation health

**Keep verified children visible and tell the operator when coverage is incomplete.**
The operator authorized both repairs and confirmed the prior Session's three
subagents appeared in Fleet. That observation rules out a universal rendering
failure; it does not prove that every Codex version reports every live child.
No partner reply is requested. Half 1 (disclosed harness context) remains
unshaped; BUG-134 (aggregate/filter census loss) remains separately scoped.

### Execution contract

- Ownership: the Codex read adapter owns protocol interpretation and read
  failure scope. The existing DelegationMonitor owns child lifecycle. A
  source-agnostic `DelegationObservations` owner carries observation health to
  the Agent Source registry, independently of parent turn/attention state.
  This composes with the in-flight D7 census refactor without a competing
  reducer or a change to its lifecycle APIs.
- Sequence: settle every bounded child read; keep successful independent
  lifecycle reads; resolve ambiguous children only through their immediate
  parent's activity; publish the verified set atomically with no invented
  completions; publish complete/partial/unavailable coverage separately.
  Root lineage failure still withdraws that root. Failure to read one parent's
  activity invalidates only its ambiguous children. A missing activity is
  unknown, not a report of idle.
- Evidence: JSON-RPC method/code survives the client boundary. Unsupported
  method responses are distinguished from transient read failures; version
  comes from initialization, never a hardcoded version blacklist. Recovery
  comes from subsequent successful protocol reads. Observation status spans
  active roots; one healthy Session cannot conceal an unavailable sibling.
- Presentation: reuse the existing Agent Sources Delegation row and `FactRow`
  with observed provenance and explanation. No new surface, signal, color,
  or gallery grammar. Design-system rungs: settings operational neutrals,
  chrome-title/chrome-label and the existing reading-row spacing. Changes
  arrive over a narrow IPC subscription and current health overlays cached
  discovery. A successful empty census is distinct from a failed census
  without publishing an artificial `ownTurn: available` record.
- Boundary: observation failure does not block launch, stop a child, read local
  side effects, or create a turn-end event. No claim that Exawatt can restore
  lifecycle authority that the installed provider refuses.

Acceptance: failed child reads preserve independently verified siblings at
Agent/Team/Fleet; failed parent activity does not erase other parents; unknown
children are withdrawn without completion; empty success, partial, unavailable,
recovery, identity change and exit have explicit coverage behavior; source
Settings receives the same runtime truth; bounded concurrency remains intact.

Verification: 49 focused protocol/coverage/Settings tests passed, the source
registry's 19 tests passed, type-check and Electron compilation passed.
`eval:electron:delegation` passed 30 pipeline checks, including an actual refused
JSON-RPC, surviving sibling, source-row rendering, and recovery pushed into an
open Settings page. `eval:electron:agent-sources` passed registry, source-owned
launch/resume, responsive Settings and theme checks. The source-row screenshot
was visually inspected at 1200×760. Normal delivery reruns the required gates on
the integrated candidate and queues dogfood installation; queued is not installed.
The provider limitation remains open: this repairs isolation and disclosure,
not the missing upstream authority.

## 2026-09-18 — D6 and D8 execution brief: truthful delegation end to end

**Give agents truthful Exawatt context and preserve every observed worker through the UI.**
This is planning, not a shipped capability. The operator requested researched,
holistic improvements for BUG-133 half 1 and BUG-134, with parallel execution-ready
work. D6 owns population/lineage/query/projection; D8 owns disclosed launch context.
They share evidence vocabulary, not a new orchestration service. ENG-028 Types,
ENG-029 coordination, and D2 independent child conversation remain separate.

### Current evidence and ownership

Research baseline: integrated `9aeae5a7`, 2026-09-18. The operator and suggestions
feedback lanes both contained zero untriaged rows; this pass promoted no inbox
rows. Four independent investigations covered launch architecture, installed
provider mechanisms, population selectors, and the user journey. Local probes
were read-only; no model requests, credentials changes, or user configuration
writes were made. Recheck installed versions before implementation.

| Finding | Current evidence / consequence |
| --- | --- |
| D5.1 is integrated | `563dcd72` / decision `0040`: verified siblings survive failed reads; source Settings exposes observation health. This does not supply natural-language context or repair aggregation/filtering. |
| Context and task have different owners | `harness-command.ts` validates operator `initialPrompt` and rejects it on exact resume; `session-manager.ts` wires integrations before spawn. Context must never become a fake task or replayed turn. |
| Filter precedes child representation | `ui-model/src/index.ts::filterFleetState` matches parents only; `seedDelegationUnits` requires a visible parent. The matching child is never independently considered. |
| Geometry incorrectly owns semantics | `spatial-board.ts` truncates child metadata to five, aggregates parent counts only, and the Fleet inspector reads the capped piece. Aggregate visibility/counts also ignore parent filter matches in some paths. Repair the shared query/summary boundary, not just child dots. |
| Lineage is dropped upstream | Codex reads `parentThreadId` to resolve activity, then omits it from `ObservedChild`/published children. `AgentDelegatedChild` has no immediate-parent field. Geometry cannot reconstruct a source fact discarded here. |
| Identity and propagation need repair | Child activation looks up bare child ID although board IDs are root-scoped. The local transport's dedupe key omits start time, and would miss added lineage/coverage unless amended. |
| Provider support is operation-specific | Additive fresh-launch syntax does not establish safe resume, custom-agent composition, or child inheritance. Matrix below records actual evidence. |

Adjacent candidates are **not integrated dependencies** merely because their docs
say “landed.” Inspect ancestry at pickup, do not cherry-pick or alter their worktrees:

| Candidate lane | Reuse boundary |
| --- | --- |
| `agent/delegation-census` (`85bfd314` at research) / D7, BUG-081 | Shared lifecycle census/expiry owner. D6 consumes/reconciles that owner after integration; it must not create another lifecycle reducer. `agent/quick-update` also carries this work; establish its current delivery state first. |
| `agent/fix-renderer-blockers` (`900a8a00`) / BUG-145 | Corrects unreported **parent** status counts in selection. Preserve it in the common summary; it does not fix BUG-134. Its BUG-133 metadata repair must survive roadmap reconciliation. |
| `agent/fleet-excellence` / ENG-004 | Filter-empty versus fleet-empty behavior and keyboard ownership are adjacent candidates. Reuse after reconciliation; do not recut their UX. |
| `agent/command-surfaces`, `agent/lifecycle-vocabulary` | Resolve new inspection/navigation entry points through the current command and lifecycle contracts rather than adding local menu or status derivations. |

### Shared architectural contract

Keep five distinct facts: **operator task, supplied environment context,
source-observed delegated membership, observation coverage, and UI representation**.
Neither a prompt receipt nor an aggregate mark proves lifecycle. A lost read is
not completion; a successful zero census is not missing coverage; a contextual
parent is not a matching result; a drawn worker is not automatically commandable.
Decision `0041` records the proposed decomposition and its review boundary.

The common product outcome is that an operator can delegate, find the observed
workers, understand limits, and return to the owning Session without stopping
work to recreate it manually. First-time users should not need to understand
provider internals. Frequent operators need quiet, stable density and short facts.
This expresses the existing commanding/lucid/kinetic design context through
accurate evidence and purposeful navigation, not more permanent chrome.

### D8 — disclosed, source-owned launch context

**Use one typed launch contribution, never natural-language interception.**
`Launch Configuration` remains the reusable launch choice, `Agent Type` remains
a future portable worker blueprint, and this contribution is only environmental
context supplied by Exawatt. Do not introduce another top-level product noun.

Main-process composition owns one bounded, versioned text contribution containing:
Exawatt identity; the relationship of this Session to its Project; the distinction
between source-created delegated work and separately launched Sessions; stable,
conditional navigation guidance; and the limits of observation and control.
Source adapters own encoding through a declared safe mechanism. The same renderer-
safe receipt serves disclosure; UI does not reconstruct the prompt independently.

Content intent, not a frozen test string: source-reported children may be inspected
in Fleet under their owning Session; child activation can open that parent;
Agent Sources reports observation coverage; children do not automatically acquire
separate tabs. Never claim current counts, visibility, completion, UI focus,
independent interaction, or ability to navigate on the operator's behalf. A model
may explain where to go; this work gives it no new UI-control authority.

Delivery evidence is distinct from source capability. Represent prepared text,
actually supplied mechanism, and **verified model-visible context** separately.
A successful process spawn or argv construction proves only supply. A receipt
records template revision/digest, launch operation, mechanism, evidence basis,
bounded exact Exawatt-authored text and reason when omitted, unsupported,
conflicted or failed. Never retain or expose the composed provider value when it
contains user instructions. Bind receipts to durable Session ID, launch generation,
source/version and timestamp; reject stale asynchronous receipt updates.
Historical receipts are not proof that a resumed process adopted new instructions.
Do not label a source “context aware” based only on a flag or a plausible answer.

Privacy/ownership contract:

- V1 contains product-authored environmental facts, not arbitrary repo content,
  other Project names, inventory, absolute paths, prompts/results, provider config,
  credentials, hook tokens, or analytics IDs. The harness already has its cwd;
  duplicating sensitive context is unnecessary. Treat any later user-authored
  contribution as quoted data, never privileged instructions.
- Preview and inspection show exactly what Exawatt supplies and make clear it
  travels through the chosen provider. Keep the model-readable artifact separate
  from token-bearing hook settings. Never expose those settings as prompt text.
- Proposed hard bound: 4 KiB UTF-8 per contribution, with a normal copy target
  below roughly 400 estimated tokens. Estimate is not a model-independent token
  guarantee. Oversize input fails compilation visibly, never silently truncates.
- Reuse app-owned, owner-readable per-launch file lifecycle where a file is needed;
  cleanup on failed spawn/exit/startup residue. Keep any retained safe receipt with
  the existing Session record and its retention owner, not an unbounded new ledger.
  Retain the current receipt and only an explicitly
  bounded prior receipt if needed; Session forget/reap clears both.
  Declare its size class under decision `0039` before adding persistent storage.
- Preserve provider defaults, effective user/project instructions, selected custom
  agent, permissions, tools, hooks and sandbox. No global/project config mutation,
  `AGENTS.md` edits, provider-home substitution, terminal typing, or task-prefix hack.
- Context is optional environment assistance. A conflict omits it with a reason
  while preserving ordinary launch. If a future Type requires context delivery,
  ENG-028 owns that stronger launch requirement; do not invent it here.

#### Provider research matrix (read 2026-09-18)

| Source / locally observed version | Evidence and candidate mechanism | Shipping gate |
| --- | --- | --- |
| Claude Code 2.1.274 | Official CLI supports additive `--append-system-prompt[-file]`. Existing `--settings` owns hook composition. | Fresh launch must preserve defaults/hooks. Resume normally reuses its first-request prompt snapshot until compaction; neither new argv nor a new file proves immediate adoption. Do not silently switch snapshot policy. Child-specific append flags are print-only, not proof of interactive inheritance. |
| Codex 0.154.0 | `-c developer_instructions=…` is accepted by fresh/resume CLI; official config describes additional instructions. | It is a **scalar override**, not a merge with the user's existing key. Prove safe effective-config composition, correct precedence, resume adoption, and deduplication. If preservation cannot be established, disclose conflict/unverified support. Never substitute `model_instructions_file`, which replaces built-in instructions. |
| OpenCode 1.18.30 | Existing `OPENCODE_CONFIG_CONTENT` seam can carry instruction-file paths; official rules combine configured files with `AGENTS.md`. | Prove cross-layer array composition, managed-setting precedence, custom-agent/default-prompt preservation and resume. Preserve the existing refusal to overwrite occupied inline config. Do not assume agent `prompt` is additive. |
| Grok Build 1.0.3 | Installed help exposes additive interactive `--rules`; the official reference also documents its `--append-system-prompt` alias. | Prove fresh/resume behavior and permission/tool invariance. Its missing injectable delegation hooks do not mean context is unsupported. Do not use replacing `--agent`; that rejection remains binding. |
| OpenClaw, local or hosted | Connected sources attach existing coworkers outside the local PTY launch union. | Do not retrofit or mutate their prompts. Mark not applied for attachment. A future source-owned launch/write capability needs its own proof and custody. |
| Custom / shell / Demo | Custom is not currently a runnable adapter; shell is deliberately not an Agent; Demo is a first-class source. | No text for shell. No invented custom capability. Demo simulates the same contract and receipts through its source adapter, without provider invocation. |

Primary references, with read date above:
[Claude CLI and resumed prompt snapshots](https://code.claude.com/docs/en/cli-reference#system-prompt-flags-in-resumed-conversations),
[Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference),
[Codex subagent configuration](https://learn.chatgpt.com/docs/agent-configuration/subagents),
[OpenCode configuration precedence](https://opencode.ai/docs/config/),
[OpenCode rules](https://opencode.ai/docs/rules/),
[OpenCode agents](https://opencode.ai/docs/agents/),
[Grok CLI reference](https://docs.x.ai/build/cli/reference).
These are mechanisms, not evidence that Exawatt already applies them. Local help
and official docs differ; absence from help is not proof of absence.

#### Lifecycle matrix and provider proof

| Path | Required behavior |
| --- | --- |
| Fresh | Compose once in main before the operator task; preserve task bytes, selected source and exact identity capture. |
| Exact resume | Keep provider conversation identity and no extra user turn/task replay. Verify immediate adoption separately from after-compaction adoption. Otherwise show historical, not supplied, or supplied-but-adoption-deferred/unverified context honestly. |
| Clone or fresh continuation | Build target-source context anew; existing handoff remains the task. Do not copy old receipts, tokens, injection syntax or stale capability assertions. |
| Recovery after app restart | Re-evaluate delivery for the new process; metadata-only `statedTask` and subtitle remain unsent. A stored receipt is historical evidence only. |
| Already-running / external | No keystroke retrofit. No claim of delivery. |
| Delegated child | Do not promise inheritance. Verify default/custom/nested child configurations separately; children receive no parent control credentials or false independent Exawatt Session identity. |
| Compaction / configuration update | Probe retention and deduplication; record changes without replacing unrelated instructions. No silent switch of provider prompt-snapshot policy. |

Use isolated temporary canary configuration, source-native debug facilities where
available, and actual launch commands. Inspect only sanitized canary preservation
results, never log real effective configuration. Codex `debug prompt-input` and
OpenCode `debug config` / `debug agent` are possible evidence tools, not assumed
universal APIs. Read-only debug inspection may establish prompt assembly; any
remaining model-comprehension check is a small explicit manual acceptance probe,
not a probabilistic CI assertion that an answer contains “Fleet.” BUG-133 cannot
close on Claude-only support: the affected Codex path must meet its delivery and
preservation contract or remain explicitly partial/open.

### D6 — census first, query second, representation last

**One source-neutral roster owns membership; geometry never owns truth.**
The pipeline is source report → existing lifecycle reconciliation → normalized
root-scoped census and coverage → entity query → summaries and representation
buckets → DOM/WebGL. Preserve source-observed immediate parent independently from
the root Session used for navigation. Unknown lineage stays unknown; cycles and
missing ancestors fall back to the known root for navigation only. Retain an
invalid/unknown lineage fact; never draw the fallback as an asserted immediate-
parent edge. Reject self/cross-root edges and resolve parent IDs only in scope.

Identity must distinguish source instance, durable root Session and provider child
ID; use launch/connection generations to reject stale observations, not as a
replacement for durable Session identity. Resolve any provider ID-reuse semantics
in the source adapter before publishing a new child incarnation. Same provider ID under two roots must never collide; opaque ID equality alone
cannot select a child. Retain metadata/time/lineage changes through transport
change detection. Do not infer ancestry from labels, paths, screen proximity, or
arrival order. Consume D7 if integrated; otherwise reconcile its contract with
its owner before editing shared lifecycle files.

Counts and filtering:

- Maintain separate parent Agent count, observed delegated-run count, matching
  counts, contextual-anchor set and coverage. Adding children never inflates
  commandable Agent count or double-counts Consumption. Project footprint retains
  its current Agent-population meaning; semantic census repair is not a circle-
  area redesign.
- Match each entity independently. Search and status conditions must hold for the
  **same entity**; do not combine a parent's text match with a child's status.
  Child fields are source-reported labels/type and known live-work fact, not the
  parent's goal/status copied into a pretend independent Agent.
- Recommended query semantics: parent-only match returns the parent as a match;
  its nonmatching children remain accessible as surrounding delegation context
  in inspection, not silently counted as matches. Child-only match retains its
  root/known ancestors as labeled context anchors, excluded from matching and
  bulk-command counts. With neither text nor status filters, return all observed
  members within the selected scope. Context anchors remain explicitly inspectable
  and openable. Scope filters constrain
  both kinds consistently. Gallery review must confirm the context-anchor reading.
- A blocked parent can have working children. Current child contract proves live
  delegated work, not a complete per-child fault/approval/status taxonomy. Derive
  only that known live fact; unknown status never inherits the parent's status.
- Total and matching summaries come from the same full roster, including unknown
  parent statuses. Repair the aggregate-parent filter mismatch alongside children.
  Do not let an aggregate claim unfiltered totals are query matches.

Representation and navigation:

- Budgets constrain individual glyphs, labels, tethers and accessible rendered
  rows, not membership. Every matching child belongs to exactly one individual,
  overflow or aggregate representation bucket. Buckets retain resolvable member
  identities independently from capped drawing metadata.
- Far aggregates report parent/delegated counts separately. A verified count with
  partial coverage is a known lower bound, not “the total.” Do not invent a number
  of missing children. Unknown children are not fabricated census entries.
- Inspector/roster reads the full selector, not `piece.delegation.children`.
  Overflow opens an existing parent/Project inspection path with bounded paging
  or virtualization, where every member is searchable and reachable. No inert
  “N more” endpoint and no DOM node per worker at fleet scale.
- Selection resolution uses scoped identities. Preserve focus/selection across
  layout changes; if a child withdraws, move to its surviving known parent/root
  or existing stable board fallback with an accessible explanation. Withdrawal
  never means completion. Opening a child still opens its owning parent Session
  until D2 proves an independent provider destination.
- Keep one persistent WebGL world, stable Project placement under filters and
  camera altitude, bounded draw calls and allocation proportional to roster size.
  Reuse renderer primitives and current peer-scale treatment. R3F is an executor,
  not a second census, status or query implementation.

Coverage must reach the place it qualifies. D5.1's source-wide fact cannot be
relabeled as a particular root's health. Extend the existing observation owner to
publish a renderer-safe root-scoped fact (and derive the source rollup from it),
retaining empty success separately from unknown, partial, unavailable and stale
observations. Push updates, reconnect and identity/drop behavior use existing
Session/transport channels. Do not make a new poller or turn-state field.
Where an adapter cannot prove completeness, its known children remain useful but
its coverage must not default to complete. Read the local census owner and
source freshness rather than applying one invented provider-independent timeout.

### Confirmed UX direction and review scenes

Operator confirmation (2026-09-18): direction accepted, with “we don't need to
be super verbose with the disclosure part — I'm fine if it's silent.” Normal
launch/context delivery is silent by default. No mandatory preview, disclosure
row, acknowledgement or success message. Exact safe context and delivery evidence
remain available on demand through existing details; receipt plumbing is not a
reason to add chrome. Explain a material visibility limitation concisely where
it matters. This amends the mandatory prelaunch preview below, not instruction
preservation or evidence truth. Gallery review is still owed for new visuals.

Primary user action: **find the delegated worker and reach its owning work**.
The default healthy case keeps current quiet indicators. No success banner, new
status light, persistent global warning, setup wizard, or independent agent-control
surface is proposed.

| State / interaction | Proposed use of existing surfaces |
| --- | --- |
| Before launch | Silent by default. Optional inspection through existing launch details may show prepared context; no new default disclosure row or required preview. Revalidate any opened preview when configuration changes; preview is not delivery. |
| Running / resumed / failed context delivery | On-demand inspection through existing Session details/context actions can expose the receipt; reuse that view for optional launch inspection. No automatic success notice or receipt presentation. Keep inspection reachable for omitted/unsupported/failed delivery and zero children. Source-level support stays in Agent Sources; it is not a Session receipt. |
| Complete, zero children | No fake workers; ordinary empty delegation state remains quiet and distinguishable from unavailable coverage. |
| Complete, children present | Existing Agent/Team indicators and Fleet child units; inspection reaches full roster. |
| Partial/unavailable/stale | At most one neutral coverage fact/link in the existing parent Delegated/metadata area, also reachable with zero observed children. Source detail provides the explanation. Mixed-source scope never lets one healthy source hide another. |
| Child-only match | Child remains findable; parent is legible lineage context with explicit non-match treatment, not dimmed below contrast requirements. |
| Aggregate / overflow | Separate known parent/delegated counts; activation drills into existing inspection with full matching roster. |
| No query matches | Existing filtered-empty grammar; source coverage remains reachable and zero matches does not claim zero workers. |
| Navigate to source detail and back | Preserve Project/parent selection and filter intent through current navigation authority. Do not hardcode shortcuts in injected text; use stable product destinations. |

Use `docs/engineering/design-system.md`: existing chrome-title/label controls,
chrome-meta one-line fact, semantic/HUD dim roles, operational p-3/p-4 and gap-2/3.
Coverage gets no D40 light, fault hue, readiness dashes, Consumption hatch or
ambient animation. Review Air, Night, Classic, maximum interface scale, narrow
layout, reduced motion, low power, keyboard focus and screen-reader output.
The `.impeccable.md` context is interpreted through this newer design canon, not
as permission to reintroduce a dark-only presentation.

Gallery proof is a temporary extension of the current board/launcher workbench,
with real DOM and R3F siblings driven by **one fixture** where both are affected.
Required scenes: 0/1/4/5/17 children; child-only and parent-only query; conjunction
trap; working child/blocked parent; healthy zero vs unavailable zero; partial
coverage with survivors; mixed sources; colliding raw IDs; depth-two lineage and
unknown ancestry; below/at/above each imported rendering budget; selection and
focus through aggregation, filter changes and withdrawal. Do not duplicate
production components into a study. Retire the study when accepted behavior ships.

Review decisions still needed: quiet on-demand inspection placement; how a
context-only parent is labeled; aggregate count composition; the one place-of-use
coverage link. These are visual/interaction choices, not reasons to defer the
identity, preservation, census and privacy invariants. The direction is operator-
confirmed with silent-by-default context delivery; gallery acceptance is still
required before production wiring.

### Executable sequence, parallel lanes and exit criteria

| Milestone / owner | Scope and files | Dependencies and acceptance |
| --- | --- | --- |
| D6.1 — evidence model owner | `core/src/types/agent.ts`, local/Demo transports, existing delegation/observation owners, Codex normalization. Preserve identity, root vs immediate-parent lineage, full roster and scoped coverage. | Reconcile D7 and BUG-145 candidates first. Fixtures prove collision-free identity, unknown ancestry, metadata/coverage propagation, zero-vs-unknown, no invented completion; no renderer changes required. |
| D6.2 — query/model owner | Focused pure census/query/summary selectors in `ui-model`; migrate parent-only `filterFleetState` use at Fleet deliberately rather than changing unrelated consumers silently. | D6.1 contract stable. Match/context sets, scope summaries and conservation tests pass for parents and children; Consumption/command semantics unchanged. |
| D6.3 — UX owner | Shared-fixture DOM/R3F gallery, existing selection/overflow/full-roster paths and source-detail return journey. | Can prototype against D6.1 contract while D6.2 develops. Operator review chooses the new visual/interaction grammar. No new production visuals before acceptance. |
| D6.4 — integration owner | `spatial-fleet-client`, board projection/target resolution, existing DOM panel, keyboard and canvas consumers. | D6.2 + accepted D6.3. Remove capped-geometry semantic reads and bare-ID lookup. Prove identical match membership and census at every budget/altitude in Live and Demo. BUG-134 and BUG-094 close only against this proof. |
| D8.1 — launch contract owner | Core capability/receipt contract, main-process composer, `harness-command`, `harness-registry`, `session-manager`, safe artifact lifecycle. | Can proceed independently of D6. Refuse hidden task/policy mutation; test fresh/resume/clone/recovery/cleanup boundaries. Agree contract with provider lanes before shared-file edits. |
| D8.2 — provider evidence lanes | Isolated source-specific probes and adapters for Claude, Codex, OpenCode, Grok, each with a capability evidence matrix. | Parallel research/probes; one launch-contract owner integrates shared registry changes. Codex instruction preservation/resume is the highest-risk release gate. No unsupported inheritance promise or automatic policy workaround. |
| D8.3 — disclosure/integration owner | Existing launcher/Session inspection/Agent Sources receipt projections; source-specific fixture launch tests. | D8.1 + proven provider cells + UX review. On-demand inspection matches actual supplied text; no secrets/task leakage; unsupported cells inspectable; normal delivery stays silent. Stable conditional orientation may ship independently; guidance to new D6 drill behavior waits for D6.4. |
| D8.4 — acceptance owner | Small installed-provider evidence packet and packaged Electron journey, tied to immutable SHA/provider versions. | Fresh and resume assessed separately, including safe user-config preservation. BUG-133 half 1 remains open until the Codex report is resolved; a Claude-only rollout is partial. |

One owner edits each shared file at a time. Provider research, census selectors,
and the UX study can run in parallel after their DTO contracts agree; adapters do
not independently redesign common launch APIs. No milestone depends on building
all Types, a coordination bus, new autonomous UI tools, or independent child chat.
Each implementation handoff must record baseline SHA, exact allowed paths,
fixtures, passed commands, remaining review decisions and actual delivery state.

### Verification and rollout contract

- Property/invariant tests: unique census membership; exact partition of matching
  children across individual/overflow/aggregate buckets; parent counts unaffected
  by child additions; context anchors excluded from matches/bulk-command targets; same-entity
  query conjunction; filter clear restores membership; budget changes preserve
  counts and root navigation; child beyond slot five remains discoverable; no
  Consumption duplication; source-total coordinates remain stable under filters.
- Transport/lifecycle tests: changed labels/time/lineage/coverage reach consumers;
  root identity generations reject stale updates; reconnect replaces authority;
  withdrawal is not completion; unknown parent edges stay unknown; complete zero
  remains distinct from no report. Use existing D5.1/D7 tests, not a second truth
  reducer. Validate invalid/cyclic lineage without recursion hazards.
- Repair existing test premises: assertions that children vanish with an excluded
  parent, aggregate geometry implies no census, or semantic roster ends at the
  rendering cap are obsolete. Keep the actual protection—bounded graphics—while
  adding full-membership assertions. Never pin today's copy or exact layout sizes.
- Launch tests: exact task bytes/identity preserved; provider instruction canaries
  survive composition; hooks/permissions/custom-agent choices unchanged; receipts
  match the actual payload; no cross-launch contamination; UTF-8 bound and safe
  cleanup; fresh/resume/clone/recovery/compaction evidence distinguished. Fixtures
  consume actual adapter-generated configuration, not a parallel test-only path.
- Relevant gates per changed surface: `eval:electron:delegation`, source/launcher
  and resume gates; board/spatial and `eval:r3f` for Canvas changes; keyboard/DOM
  parity and packaged connected-source gate when preload/shared transport changes.
  Read `SURFACE_GATES`, do not copy a frozen gate list as a waiver. Use each
  implementation worktree's own dev server and stable signed browser boundary.
- Scale is a semantic and allocation contract: test around imported budgets and
  large roster probes; bounded rendered objects/rows, linear census construction,
  cached stable identities, no per-frame scan of the full roster. Use allocation
  probes and the existing board eval, not host-dependent duration assertions.
- Deliver model-first, then reviewed UI, then source support per proven lifecycle
  cells. A failed optional context contribution degrades to an honest receipt;
  a failed census observation withdraws only unsupported claims. Rollback must
  preserve user configuration and retain useful known children, not restore silent
  disappearance or claim capabilities unavailable on the installed source.
- After installed evidence proves the complete delegate → find → inspect journey,
  record that evidence in roadmap progress and link it from marketing/ideas. No
  “all harnesses,” independent child chat, or complete visibility claim before
  those capabilities are evidenced.

This brief plans the improvements; it does not mark either bug fixed or any
provider delivery path implemented. The operator confirmed the UX direction with
silent-by-default context delivery on 2026-09-18; production gallery acceptance
remains a distinct later checkpoint.

### Historical report preserved from the roadmap

The following is the 2026-09-16 diagnosis, not current capability or delivery
state. D5.1 subsequently repaired isolation and source disclosure; D6/D8 above
supersede the unshaped remedies. The partner's exact installed version was not
verified, so the historical assertion that both users ran the same version is
not evidence about that machine. Current keyboard navigation includes children;
D3c's old skip-child wording is superseded, while bulk-command exclusion remains.

#### Original BUG-134: Delegated children vanish from the Fleet census with no trace at aggregate resolution and under any filter

Status: open · ENG-023 · found 2026-09-16 while reading the child-render path
for BUG-133, not from a live report.

Two drop paths, both silent, both in `packages/ui-model/src/spatial-board.ts`:

1. Aggregate pieces carry no delegation (`:1092`), so past any of the
   individual-resolution budgets — 240 fleet Agents, 64 per zone, 24 Projects
   (`:1186`, `:1317`, `:1328`) — children stop rendering AND stop counting.
   They are not in `statusCounts` either (`:356`, top-level Agents only), so
   they leave no dot, no census, and no "+N delegated" line. D3c §4 says
   children contribute to visible population mass; above the budget they
   contribute nothing at all. Absent reads the same as zero, which is the
   rule this repo keeps relearning.
2. `seedDelegationUnits` requires the PARENT visible (`:1783`), and fleet
   filtering runs over parents only
   (`src/components/fleet/spatial/spatial-fleet-client.tsx:163`, `:198`), so
   any search or status filter that excludes a parent silently removes every
   one of its children — including children that match the filter themselves.

Both are exact-census violations rather than layout bugs; the overflow lobe
already proves the board can say "+13 more" honestly. Shape the fix in a
design pass with the D3c brief in hand.

#### Original BUG-133: An agent asked about its own subagents cannot tell the user where Exawatt shows them

Status: open · ENG-023 · found 2026-09-14 in a design partner's Slack report
with a screenshot; the context half touches ENG-028.

What happened: in a Project Session running Codex CLI, the partner asked the
agent to spin up specialist subagents. It staffed "Wave 1" and sat on
"Waiting for agents / No agents completed yet". The partner asked "why can't
I see the agents independently here?" The agent answered that they run as
internal child workers of the conversation, not as separate user-facing chats
or tabs. The partner interrupted it, stopped the children, and asked for a
script to spin the agents up by hand. The partner then checked Fleet, and
Fleet showed no child units for that Session.

Two defects, one report:

1. **The harness has no idea it is running inside Exawatt.** Its answer is
   true from where the harness sits and wrong for this user. Exawatt exists to
   show those children, but the agent cannot say "look at Fleet" or "switch to
   that tab", so its honest answer taught the user to give up on delegation.
   Operator direction, left unshaped until a design pass: give Exawatt-launched
   agents their context, either by injecting it at launch (the per-launch
   settings seam from ENG-023 D1 that ENG-028 Types build on) or by
   intercepting delegation and visualization questions. Whatever is injected
   must stay user-visible, per ENG-023's disclosure exit criterion.
2. **Fleet showed no children for a delegating Codex Session.** ENG-023 D5 is
   supposed to render these. DIAGNOSED 2026-09-16 by reading the adapter; the
   build version the partner was on does not matter, because the defect is in
   the installed provider, not in the app. A second read-side app-server
   reports turns owned by the interactive TUI as `interrupted` with a null
   `completedAt`, so every genuinely live child is ambiguous by construction
   (`electron/main/harness-events/codex-app-server.ts:711-715`) and must be
   disambiguated through the immediate parent's `thread/items/list` activity
   (`:733-749`). Codex 0.153.4 advertises that method and answers
   method-not-supported, measured independently by the native-source
   investigation and recorded at
   `docs/engineering/projects/daily-driver-adoption.md:6904-6909`. The
   rejection propagates through `fulfilledReads` (`:564-571`), which rethrows
   rather than degrading, so ONE refused read aborts the whole session
   snapshot and the adapter withdraws every child to absent. Withdrawal is
   correct behavior — D5 refuses to invent a census it cannot authorize — but
   the result is that Codex delegation is currently unobservable on the
   provider version the operator and the partner both run, and nothing says so
   anywhere in the product. Two consequences worth separating: the adapter has
   no per-child isolation (one bad child withdraws its healthy siblings,
   `:696-722`), and a Codex record with zero children publishes as `null`
   rather than as an empty census, so every surface silently falls back to
   byte inference (`electron/main/harness-events/delegation-state.ts:167-176`;
   Codex has no `eventChannel` binding, so children are the only fact that can
   make its record live).

Order: half 2 first, and it is now a question of what Exawatt can honestly say
when a provider withholds the authority D5 needs — not a rendering fix. Half 1
only helps once the surface it points at is truthful.

Half 2 repaired (2026-09-16, operator-approved): isolate child
and parent-activity read failures, retain verified siblings, and disclose
complete/partial/unavailable delegation observation in the existing Agent
Sources capability row. Keep observation health independent of turn and launch
truth. The operator confirmed the prior Session's three subagents were visible.
[Execution contract](#2026-09-16--bug-133-half-2-isolate-uncertainty-and-disclose-observation-health).
Half 1 remains unshaped; the provider's withheld authority is not repaired by
this application change. BUG-134 remains separate.

### 2026-09-23 — A running monitor must not imply input required (BUG-145)

Operator feedback `b2b53b9b-2e70-4a04-8bce-397ca6c8a520` on 0.1.13 reports amber
attention while Claude Code still has one monitor running. Classified small
fix under ENG-023; queued diagnosis. The attached screenshot shows both the
amber Agent tab and the provider's “1 monitor still running” footer; it does
not establish the underlying event ordering. Investigate monitor coverage and
attention precedence through the existing shared lifecycle owner, adjacent to
D6/D8 work, rather than treating this as another timeout adjustment. Acceptance:
background work alone never asserts input required; actual approval/input
requests remain visible. A richer mixed running/input-ready state is explicitly
deferred by the operator, not a prerequisite for correcting false attention.
