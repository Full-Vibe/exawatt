# Agent state at a glance

Agent state is not one status enum. It is a source-agnostic projection of
several independent facts about an Agent and its current source contexts:
whether it needs attention, what work it represents, what meaningfully
changed, where it is in its intended work, and how fresh the observation is.

Keeping these facts separate matters. A Session can be running but blocked,
finished with a result that has not been reviewed, stopped with durable state,
or actively producing output without exposing a structured plan. Exawatt
should preserve those distinctions rather than compressing them into a vague
label such as `active` or an invented completion percentage.

## Region / question model

At a fleet-comparison altitude, every visual region should answer one operator
question.

| Region    | Question answered                               | Preferred evidence                                                                 |
| --------- | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| Attention | Does this need me now?                          | an Approval, question, blocker, error, unseen result, or policy boundary           |
| Identity  | Which coworker and work is this?                | Agent, Project, durable context cue, source, and placement                         |
| Now       | What is happening or what meaningfully changed? | current activity plus the latest meaningful Event                                  |
| Plan      | Where is it going next?                         | current named step and ordinal position in a mutable plan                          |
| Freshness | How old is this picture?                        | age of the latest meaningful Event and an explicit stale or disconnected condition |

This is a projection contract, not a fixed table schema. Compact views may
combine regions, larger views may give them more space, and a source may leave a
region unknown. The questions remain stable even when presentation changes.

## Altitude determines detail

The same underlying truth should be projected differently by command altitude:

- **Agent** explains one coworker and its relevant source contexts. It owns the
  main conversation, commands, evidence, retries, tool detail, steering, and
  complete Event history.
- **Team** compares open Agents. It should be a dense, stable set of
  comparable tiles or rows that lets an operator find attention, reorient, and
  choose where to zoom in.
- **Fleet** allocates attention across Projects and larger fleets. It should
  emphasize pressure, topology, delegation, and leverage rather than repeat the
  Team table.

Team does not contain a second, expanded Agent-detail state. Focus or hover may
select an item, but activating it navigates to that exact Agent and its primary
context at the Agent altitude. Returning to Team should restore the prior
Project, ordering, and row position so the zoom-out/zoom-in loop preserves
orientation.

## Meaningful Events, not activity exhaust

The **Now** region should promote only Events that change the operator's mental
model of the work. Useful event verbs include:

- **Oriented** — established the relevant scope or constraints;
- **Found** — discovered information that changes the path;
- **Decided** — selected among meaningful alternatives;
- **Revised** — changed the plan or approach;
- **Progressed** — crossed a named work boundary;
- **Delegated** — created or handed work to another Agent;
- **Blocked** — cannot continue without a dependency or intervention;
- **Asked** — needs an answer, Approval, credential, or taste call;
- **Recovered** — resumed from a failure or restored durable state;
- **Completed** — reached the intended outcome;
- **Stopped** — execution ended or was deliberately suspended.

Ordinary reads, searches, shell commands, tool calls, file changes, and test
results are evidence beneath an Event. They belong in Terminal or an Artifact
unless one of them creates a meaningful state transition. Repeated low-level
activity should be grouped rather than allowed to displace the reason the work
matters.

One present-tense activity sentence and one latest meaningful Event are enough
at the Team altitude. Unknown activity must remain unknown; Exawatt should not
manufacture a narrative from terminal byte volume.

Event kinds are domain vocabulary, not operator-facing eyebrow copy. A compact
surface should present the meaningful change in plain language instead of
exposing unexplained labels such as `ASKED`, `RECOVERED`, or `DECIDED`.

The Session's why/goal is the same durable context summary shown in Terminal.
Sessions must reuse that content and quiet, Project-tinted typographic treatment
rather than invent a second summary. Agent Source and turn state may condense to
their shared glyphs when hover tooltips and accessible names preserve meaning.
Visible Session identity is total: a durable context label wins, an explicit
operator rename stays primary, and **New agent** is the final Agent fallback.
Source and status glyphs may support that text but may never become an
icon-only tab or card.

That context label is stable across necessary subtasks and direct
continuations. It changes when newer work establishes a distinct durable
purpose that could stand as its own Initiative, even within the same app,
Project, or Session.

Raw terminal lines are inspection evidence, not Session meaning. Model/context
meters, permission modes, prompts, branch state, command output, and transcript
tails stay in Terminal; they must not be copied into Sessions cards. Until a
source exposes structured activity or meaningful Events, Sessions presents
only the current state it actually knows and says **No plan reported** when the
plan channel is absent.

## Plans are mutable named steps

Plan state should use a current named step plus an explicit ordinal such as
`Decide ownership` and `Step 3 of 5`. A visual spine is optional, but only when
the surface has room to label what it represents; compact Sessions tiles must
not use unexplained bars as shorthand for plan position. Plan state should not
imply a stable percentage because Agents revise plans, discover new work, and
remove invalid steps.

When a plan changes materially, **Revised** becomes a meaningful Event. When a
source exposes no plan, the UI says so instead of inferring one from files,
commands, or elapsed time.

## Attention, connection, and lifecycle stay independent

Attention, Agent turn state, Session process lifecycle, source connection,
placement, plan position, and freshness are separate channels:

- attention answers whether the operator has leverage now;
- turn state answers whether an Agent is working, finished, or not yet started;
- process lifecycle answers whether the Session runtime is running, stopped,
  interrupted, exited, resuming, or failed;
- connection answers whether Exawatt's observation path is live, reconnecting,
  stale, or unavailable;
- placement answers whether the configured source is local, customer-hosted,
  or Exawatt-hosted;
- plan position answers what named boundary comes next;
- freshness answers when Exawatt last received meaningful evidence.

Compact relative ages include the explicit `ago` suffix and expose the fully
formatted observation time on hover. Freshness belongs with the observed
current-state evidence, not beside a future-facing `Next` label.

Sessions typography must remain legible at comparison distance. Operational
sentences and goals use the readable body tiers; micro type is reserved for
short labels and secondary metadata rather than the information an operator is
expected to scan.

Views can compose these channels into a concise signal, but data and adapters
must not collapse them into one lossy status. Demo Mode and every live Agent
Source should feed the same projection contract, with explicit unknowns for
capabilities a source does not expose.

For remote Agents, an unavailable connection never implies stopped work.
Closing or quitting Exawatt ends observation only; the source may continue and
the next connection resnapshots authoritative state before reconciling new
events. Placement uses quiet metadata, never D40 status color. Session/context
history stays beneath the coworker unless a meaningful Event, result, fault, or
human gate promotes it. Opening the coworker returns to its source-declared
primary conversation; background activity never silently retargets that role.

## Attention navigation uses visible state

The needs-you projection is also the navigation contract. `⌘J` walks the
oldest visible needs-you Session and repeated presses continue through that
queue. With no visible target, the command is unavailable and navigation stays
where it is. A completed turn's Result light is not a needs-you target. Roadmap
starvation, empty queues, and other useful but non-urgent states remain
discoverable through their owning surface instead of silently borrowing the
attention command.

When sources collide for one Session, semantic precedence applies before
navigation or rendering: a bell or roadmap block remains needs-you even if a
turn-end result arrives later. Within the winning class, the oldest timestamp
sets queue order. The marker, command availability, and jump target all consume
that merged projection.

The persistent hint bar, command palette, and native Session menu project the
same target availability. Passive hints omit inapplicable commands; interactive
menus retain useful discoverability by disabling the command and naming the
missing prerequisite.

## Research basis

The model generalizes patterns found across agent products and durable workflow
systems:

- [GitHub's Agents tab](https://github.blog/changelog/2026-01-26-introducing-the-agents-tab-in-your-repository/)
  separates a session list from the selected session flow and groups similar
  tool calls.
- [Warp Oz Runs](https://docs.warp.dev/platform/oz-web-app/) centralizes
  concurrent runs with status filters and transcript drill-in.
- [Devin Session Insights](https://docs.devin.ai/product-guides/session-insights)
  promotes significant, color-coded events and recovery moments, while
  [Interactive Planning](https://docs.devin.ai/work-with-devin/interactive-planning)
  treats plans as reviewable and changeable before execution.
- [Inngest run inspection](https://www.inngest.com/docs/platform/monitor/inspecting-function-runs)
  and [Temporal Event History](https://temporal.io/changelog/updated-event-history-timeline-view-is-now-available)
  use dense run lists that drill into step/event history, retries, and failure
  evidence.
- [LangSmith trace views](https://docs.langchain.com/langsmith/view-traces)
  separates normalized messages, turns, and details while grouping repeated or
  parallel tool calls.
- [Linear display options](https://linear.app/docs/display-options) reinforces
  stable list views whose grouping, ordering, and visible properties can change
  without changing the underlying work model.

The durable conclusion is the separation of comparison from inspection:
fleet-level state answers where attention should go; Session detail explains
what happened after the operator goes there.
