# Getting Started With Exawatt

Exawatt is a command center for agents.

The first version focuses on making local agent control clearer, more beautiful, and easier to trust. Future versions will command hosted and multi-source fleets.

## Projects and Agents

Use **Open Project** to select a known Project, browse to one folder, or review
folders from an optional parent-directory import. Opening a Project only changes
the working context; it does not start a shell or Agent.

Inside a Project, the Agent composer accepts an optional first task and shows the
Agent Source that will run it. Exawatt remembers the last source used in each
Project, while keeping the choice visible and changeable. A blank task starts an
interactive Agent Session. Plain shells remain available as a separate Project
tool.

Closing the last Agent leaves the empty Project composer visible for a few
seconds, then retracts the Project from the open workspace. Reopen it from the
Project chooser with **⌘N**. **⌘W** closes the active Agent tab, or closes the
active Project when it is already empty. A Project's right-click menu also
offers **Close project**; Exawatt confirms first when that would close remaining
Agent tabs.

The adjacent model and effort selectors show the capability pair that will be
requested for the new Agent. Exawatt resolves the current Codex catalog,
model-specific effort levels, and configured defaults, or the current Claude
Code settings/account defaults, without rewriting either harness's
configuration. Changing either value overrides only this new Agent; both
choices stay with a saved draft while you move between tabs. Effort trades
speed and spend for reasoning depth, and changing models updates its valid
choices and default.

The adjacent permission selector controls how much autonomy the new Agent
receives:

- **Ask first:** keep operator approval in the loop.
- **Auto-review:** let the harness's safety reviewer handle routine actions and
  block risky ones.
- **YOLO:** bypass harness approvals and sandboxing.

New Project-and-source combinations start on **YOLO**. Exawatt remembers a
separate personal choice for each Project and Agent Source, so Claude Code and
Codex can use different policies in the same Project. Changing the selector
saves that pair immediately; starting an Agent is not required. YOLO gives the
Agent the broad machine access available to the harness process; use Ask first
or Auto-review when that is not appropriate. Exawatt sends this choice to the
selected harness, which owns the current approval and sandbox behavior. Exawatt
does not independently inspect or block every downstream tool action today. If
saved preferences cannot be read, Exawatt visibly falls back to Ask first
instead of silently broadening access.

In the Session strip, the teal half-circle means the Agent is working and the
green circled check means its turn finished. Finished is stable: an idle TUI
redraw cannot change the check back to working. Typing the next instruction
opens the next turn. The dashed circle means a new Agent has not received work
yet; a plain hollow circle is a quiet shell.

## Quitting and returning

When local Sessions are running, quitting Exawatt asks before stopping them.
Their layout, exact agent conversation identity, and retained terminal history
return on the next launch, but nothing resumes automatically. Use the workspace
recovery action, such as **Resume 4 Agents**, or **Resume This Agent** in one
stopped pane. A stopped shell offers **Start New Shell**. If an older Session is
missing its exact provider identity, Exawatt labels it **Reconnect needed**
instead of guessing.

See the [Session lifecycle reference](../reference/session-lifecycle.md) for the
state and persistence contract.

## Modes

Exawatt has two first-class modes:

- **Live Mode:** connect to real Agent Sources such as local OpenClaw.
- **Demo Mode:** run realistic scenarios without live agents.

Both modes should exercise the same interface concepts.

## Core Concepts

- **Workspace:** where your agents, initiatives, context, secrets, and spend live.
- **Initiative:** a durable high-level goal.
- **Agent:** a worker pursuing useful work.
- **Session:** one execution episode for an Agent.
- **Context Signal:** a data stream that can inform work.
- **Decision:** a scoped choice that should improve future behavior.
- **Consumption:** cost, tokens, energy, time, and other resource usage.

See `docs/product/concepts.md` for canonical definitions.
