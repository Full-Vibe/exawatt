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

The adjacent permission selector controls how much autonomy the new Agent
receives:

- **Prompt:** keep operator approval in the loop.
- **Auto-review:** let the harness's safety reviewer handle routine actions and
  block risky ones.
- **YOLO:** bypass harness approvals and sandboxing.

New Project-and-source combinations start on **YOLO**. Exawatt remembers a
separate personal choice for each Project and Agent Source, so Claude Code and
Codex can use different policies in the same Project. YOLO gives the Agent full
machine access; use Prompt or Auto-review when that is not appropriate.

## Quitting and returning

When local Sessions are running, quitting Exawatt asks before stopping them.
Their layout, exact agent conversation identity, and retained terminal history
return on the next launch, but nothing resumes automatically. Use **Resume All**
for agents or **New Shell Here** for an individual stopped shell.

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
