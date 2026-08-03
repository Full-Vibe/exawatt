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
tool. **⌘T** opens a new Agent tab; **⌘⌥T** opens a shell directly.

The ribbon keeps Project structure compact. The selected Project expands to
show its Initiative-shaped Agent tabs; inactive Projects stay collapsed unless
you use the small diamond or **Keep expanded** menu action. That preference
survives restart. The ribbon uses at most two rows; **+N** opens the existing
overview when more work exists than fits.

Closing the last Agent leaves the empty Project and composer open. After a short
inactive dwell, its compact header slides into the dormant tail instead of
remaining between active work. Selecting it restores its manual position and
starting an Agent repopulates the same Project. **⌘W** closes the active Agent
tab, or explicitly closes the active Project when it is already empty. A
Project's right-click menu also offers **Close project**; Exawatt confirms first
when that would close remaining Agent tabs. The first composer edit becomes a
draft Agent tab, so new launch work is durable. With the Project or Session chip
focused, **Shift+F10** opens the same action menu without a pointer. Arrow keys,
Home/End, and Tab move through or out of it; Escape returns focus to that chip.

Closing a meaningful Session keeps it in **Recently closed** for 14 days.
**⌘⇧T** restores the newest one as a stopped tab without starting its Agent or
shell process; press it repeatedly to restore older closed Sessions. The same
entries remain individually selectable from **⌘K**. Empty drafts and Agents
that never received work are discarded instead of entering recovery history.

The adjacent model and effort selectors show the capability pair that will be
requested for the new Agent. Exawatt resolves Codex's live catalog,
model-specific effort levels, and configured defaults. Claude Code currently
exposes its layered configuration and account default but not the account-aware
catalog behind its native `/model` menu, so Exawatt shows the exact configured
model when known, otherwise **Account default**, with **Choose in Claude
Code…** as the honest catalog path. It does not ship a provider list that can
go stale or rewrite either harness's configuration. Changing a value overrides
only this new Agent; both
choices stay with a saved draft while you move between tabs. Effort trades
speed and spend for reasoning depth, and changing models updates its valid
choices and default. Worktree/branch and roadmap-link choices are part of the
same saved draft rather than transient popover state.

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

**⌘J** jumps to the oldest Session with a visible needs-you marker. If no
Session needs you, it leaves the current Terminal in place. Commands that need
a Project, Session, split target, or recovery entry are hidden from the passive
key legend or shown disabled with a short reason in the command palette and
macOS Session menu.

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
