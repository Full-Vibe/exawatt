# Getting Started With Exawatt

Exawatt is a command center for agents.

The first version focuses on making local agent control clearer, more beautiful, and easier to trust. Future versions will command hosted and multi-source fleets.

## Projects and Agents

Use **Open Project** to select a known Project, browse to one folder, or review
folders from an optional parent-directory import. Opening a Project only changes
the working context; it does not start a shell or Agent.

Inside a Project, the new-Agent page stays deliberately small: an optional first
task, two-to-four whole Agent setup cards, **More**, and **Start**. Each card is
an exact configured source, source-native model, and effort or variant. A blank
task starts an interactive Agent Session. The fast paths are:

- **⌘T**, type, **Enter** to start the selected Agent.
- **⌘T**, use **⌥↑/↓** before typing to cycle the whole Agent choice, then type
  and press **Enter**.
- **⌘⌥T** to open Shell directly, then type the shell command and press
  **Enter** in the terminal.

The card row supports Left/Right and Home/End. ArrowDown opens the selected
card's attached drawer and focuses its first control. The drawer exposes Engine,
searchable Model, Thinking, and Permission as one-parameter edits. **More**
opens the complete Agent and Shell catalog with Pin, Rename, Delete, worktree,
roadmap, and quick naming controls; the same choices are searchable from **⌘K**.
Naming a setup creates a friendly preset, not a new Agent Type.

Exawatt learns the order separately in each Project. Only a successful Agent or
Shell launch changes that Project's frecency; selecting, editing, naming,
abandoning, or failing to start does not. Pins are Project-local and remain
above the learned order. Unavailable configurations stay visible with the exact
missing fact and cannot Start; Exawatt never substitutes another model or
source silently.

Shell remains a distinct Project tool available through **More**, **⌘K**, and
**⌘⌥T**. It has no Agent Source, model, effort, Agent Type, or Agent permission,
receives no task text, and cannot be a Clone target.

Open **Settings → Agent Sources** to inspect the source registry. Local Claude
Code, Codex, and OpenCode show installation, sign-in, minimum account identity,
version, model-discovery method, capabilities, and enforcement ownership without
moving their credentials into Exawatt. Facts identify whether they were observed,
declared by the adapter, or simulated. Local OpenClaw reports gateway
configuration separately and claims reachability only after its protocol status
check succeeds. Demo Mode labels its facts as simulated. Use **Recheck** after
changing a CLI or gateway. A source-owned sign-in action opens as a terminal tab and
Settings checks again while the flow completes; a missing CLI links to its
installation guide. Registry failures remain visibly stale or unavailable and
cannot enable Agent launch.

### Coming next: connect existing OpenClaw Agents

The first hosted-agent milestone connects to Agents already running on your
infrastructure. **⌘N → Connect existing Agent…** will add an OpenClaw source,
test a saved SSH alias or supported Gateway endpoint, discover configured
Agents, and let you map each one to a renameable Project. Connecting observes
existing work; it does not provision a server, start an Agent, or edit the
remote installation.

One configured OpenClaw Agent appears as one coworker. Its main conversation,
channels, scheduled runs, and helper contexts remain beneath it instead of
becoming duplicate Agent cards. Agent name and responsibility lead; **Remote**
and **OpenClaw** remain clear secondary identity.

The first slice is read-only. Closing Exawatt leaves remote work running, and
relaunch reconnects to the same Agent and catches up. Commanding the main
conversation follows as the next milestone, using the same Agent, Team, and
Fleet surfaces rather than a separate cloud roster.

That reconnect path is deliberately different from local pause-and-resume.
Pausing a local Agent preserves its exact resumable Session while its process
is stopped. Closing a remote Agent merely detaches the Exawatt view: reopening
reattaches and shows the progress made while Exawatt was gone. A remote
**Pause Agent** control will not appear until OpenClaw can report exactly what
it halts and prove that the same work can resume; Exawatt will not substitute a
prompt, cron toggle, or VPS shutdown for that guarantee.

Exawatt uses the local harness account you already signed in with. When Claude
Code, Codex, or OpenCode is entitled through a compatible source-owned account,
you do not
need to switch to API billing or add a separate provider token to Exawatt;
normal provider plan limits still apply. Exawatt never turns an observed token
count into a claim about billing or remaining plan capacity.

The Project ribbon stays one row high. Projects fold into counted containers,
the active Project's tabs shrink when needed, and the row scrolls only as a last
resort; no Project or Agent disappears from the strip.

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

The selected setup card shows the exact capability pair that will be requested
for the new Agent. Exawatt resolves Codex's live catalog,
model-specific effort levels, and configured defaults. For Claude Code it asks
the installed CLI for the same rows its native `/model` menu renders — the
account-aware catalog, each row's `--model` value, and the effort levels that
model accepts — so the two lists cannot drift. It does not ship a provider list
that can go stale or rewrite either harness's configuration. Changing a value overrides
only this new Agent; both
choices stay with the existing composer draft while you move between tabs.
Successfully launching or explicitly naming the choice adds its structurally
deduplicated identity to the reusable pool; merely editing the composer does not.
Effort trades
speed and spend for reasoning depth, and changing models updates its valid
choices and default. Worktree/branch and roadmap-link choices are part of the
same saved draft rather than transient popover state.

The drawer's Permission choice controls how much autonomy the new Agent receives:

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

A started Agent tab's context menu and **⌘K** offer **Clone to…** with the exact
available Agent configurations. Clone starts a distinct new Agent Session with
a bounded, Exawatt-owned goal/context handoff. The original Session remains
untouched, and Exawatt passes no provider resume identity or live conversation
state to the new source. This is a fresh handoff, not migration, failover, or
resume.

## Quitting and returning

When local Sessions are running, quitting Exawatt asks before stopping them.
Their layout, exact agent conversation identity, and retained terminal history
return on the next launch, but nothing resumes automatically. The recovery bar
resumes the selected Project by default, leaving other Projects paused. Its
scope menu can instead resume the selected Agent or every eligible Agent across
all Projects. A stopped pane also offers **Resume This Agent**; a stopped shell
offers **Start New Shell**. If an older Session is missing its exact provider
identity, Exawatt labels it **Reconnect needed** instead of guessing.

Both recovery scopes are keyboard verbs too. **⌘⌥R** resumes the selected
Agent; **⌘⌥⇧R** resumes the same scope the bar's one-click control would —
the selected Project, or every Project when this one has nothing paused. Both
appear in **⌘K** while something is paused, and both are rebindable in
Settings, so the chord the bar shows is always the chord you have.

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
- **Agent:** the durable coworker you name, open, and direct.
- **Session:** a context-bearing execution record beneath an Agent.
- **Context Signal:** a data stream that can inform work.
- **Decision:** a scoped choice that should improve future behavior.
- **Consumption:** cost, tokens, energy, time, and other resource usage.

See `docs/product/concepts.md` for canonical definitions.
