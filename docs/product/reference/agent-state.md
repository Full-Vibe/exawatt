# Agent state at a glance

Agent state is not one status enum. It is a source-agnostic projection of
several independent facts about an Agent and its current Session: whether it
needs attention, what work it represents, what meaningfully changed, where it
is in its intended work, and how fresh the observation is.

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
| Identity  | Which work is this?                             | Project, Agent or Session label, Agent Source, and durable context cue             |
| Now       | What is happening or what meaningfully changed? | current activity plus the latest meaningful Event                                  |
| Plan      | Where is it going next?                         | current named step and ordinal position in a mutable plan                          |
| Freshness | How old is this picture?                        | age of the latest meaningful Event and an explicit stale or disconnected condition |

This is a projection contract, not a fixed table schema. Compact views may
combine regions, larger views may give them more space, and a source may leave a
region unknown. The questions remain stable even when presentation changes.

## Altitude determines detail

The same underlying truth should be projected differently by command altitude:

- **Terminal** explains one Session. It owns transcript, commands, evidence,
  retries, tool detail, steering, and the complete Event history.
- **Sessions** compares open Sessions. It should be a dense, stable list that
  lets an operator find attention, reorient, and choose where to zoom in.
- **Spatial** allocates attention across Projects and larger fleets. It should
  emphasize pressure, topology, delegation, and leverage rather than repeat the
  Sessions table.

Sessions does not contain a second, expanded Agent-detail state. Focus or hover
may select a row, but activating it navigates to that exact Session in Terminal.
Returning to Sessions should restore the prior Project, ordering, and row
position so the zoom-out/zoom-in loop preserves orientation.

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
at Sessions altitude. Unknown activity must remain unknown; Exawatt should not
manufacture a narrative from terminal byte volume.

## Plans are mutable named steps

Plan state should use a current named step plus an ordinal such as `Decide
ownership · 3/5`. It may show completed, current, and pending steps as a compact
spine. It should not imply a stable percentage because Agents revise plans,
discover new work, and remove invalid steps.

When a plan changes materially, **Revised** becomes a meaningful Event. When a
source exposes no plan, the UI says so instead of inferring one from files,
commands, or elapsed time.

## Attention and lifecycle stay independent

Attention, Agent turn state, Session process lifecycle, plan position, and
freshness are separate channels:

- attention answers whether the operator has leverage now;
- turn state answers whether an Agent is working, finished, or not yet started;
- process lifecycle answers whether the Session runtime is running, stopped,
  interrupted, exited, resuming, or failed;
- plan position answers what named boundary comes next;
- freshness answers when Exawatt last received meaningful evidence.

Views can compose these channels into a concise signal, but data and adapters
must not collapse them into one lossy status. Demo Mode and every live Agent
Source should feed the same projection contract, with explicit unknowns for
capabilities a source does not expose.

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
