# Session lifecycle

An Exawatt Session is durable even when its local process or observation path
is not. Quitting the desktop app stops local Agents and shells after
confirmation. Exawatt does not install a daemon, LaunchAgent, or other
background process to keep them alive. Remote Agents are different: quitting
disconnects Exawatt but does not stop source-owned execution.

## States

- **Running** — the local process is active.
- **Stopped** — Exawatt saved state and stopped the process during an explicit
  quit or update.
- **Interrupted** — the prior app run ended without completing its checkpoint.
- **Exited** — the process ended on its own.
- **Resuming** — Exawatt is starting a replacement process for the exact saved
  provider conversation.
- **Failed** — that replacement process could not start.

These process states are separate from an Agent's turn state. A teal
half-circle means the current turn is working; a green circled check means the
turn finished. Electron main latches a finished Agent turn so later provider
redraws, title changes, or terminal protocol replies cannot reopen it. Only a
guaranteed operator interaction begins the next turn. Shells have no turn
boundary and continue to derive working/quiet from output.

The context subtitle is separate from both process and turn state. It is a
durable re-entry cue for the Session's reason for existing. Submitted operator
instructions—not PTY output volume—may refresh it. Related instructions keep
the current cue; a genuine topic pivot replaces it. Hosted inference failure
retains the last good cue. A meaningful launch instruction may appear
immediately while inference is pending; attachment-only launches use **New
agent** rather than exposing an image or temporary-file URI.

## Relaunch

Relaunch restores Projects, tabs, status, and retained terminal history without
starting work. The workspace recovery bar defaults to the selected Project and
names its eligible-Agent count. Its scope menu can narrow recovery to the
selected Agent or broaden it to all Projects. Every scope starts eligible agent
Sessions sequentially and never starts shells. A stopped shell offers **Start
New Shell** instead. An individual stopped Agent offers **Resume This Agent**.

Recovery is reachable without the pointer. **⌘⌥R** resumes the selected Agent
and **⌘⌥⇧R** resumes the bar's own default scope; both are rebindable, both
appear in **⌘K** only while something is paused, and neither changes what
recovery does — they are a keyboard surface over the scopes above.

Claude Code and Codex resume only by the exact provider conversation identity
saved for that Session. Exawatt does not guess from the latest conversation or
working directory. Electron main writes that identity to its own atomic local
index as soon as the provider allocates or reveals it. Older identity-less
Sessions repair automatically only when the saved opening task has one unique
provider match; otherwise the pane clearly asks the operator to reconnect a
conversation.

Retained terminal output is labeled **Saved terminal history · read-only** so a
stopped Session cannot be mistaken for an interactive terminal.

## Remote attachment and return

Remote execution lifecycle is source-owned and separate from Exawatt's
connection lifecycle. A configured source may report its own Agent and Session
state; Exawatt also records whether its observation path is `Live`,
`Reconnecting`, `Stale`, or `Unavailable`. Those connection labels never imply
that work stopped.

Closing a remote Agent tab or quitting Exawatt closes the local view only. On
relaunch, Exawatt restores the same Agent and Project mapping, reconnects to the
same configured source, replaces cached views from authoritative Agent,
Session, transcript, task, and active-run snapshots, then reconciles new events
by stable source identity. Connection-local event sequence is never treated as
a durable replay cursor. The source-qualified identities prevent reconnect
from duplicating the coworker, replaying a turn, or guessing from a display
name.

Opening a remote Agent resolves its source-declared primary conversation rather
than the most recent Session. For OpenClaw that role is the configured Agent's
exact `main` Session. Background channel, cron, task, or subagent activity may
appear in the Agent's work stack but cannot silently steal the normal composer.

`Reconnect` repairs observation. `Disconnect` removes or disables the
connection. `Pause`, `Resume`, `Stop current work`, and `Abort` operate the
source only when its adapter declares exact support and the runtime confirms
the capability. Exawatt never describes a disconnect as a pause or a fresh
context as a resume.

Detaching an imported Agent removes its Exawatt projection after confirmation
but leaves the remote Agent, configuration, workspace, Sessions, automations,
and credentials intact. Decision `0037` owns the reversible mapping contract.

## Closing and reopening

Closing a meaningful tab archives its Session identity, Project, goal, provider
conversation ID, and retained terminal history for 14 days. **⌘⇧T** takes the
newest entry from that ledger and restores it as the active stopped tab; repeated
presses walk backward through the close order. If its Project group is no longer
open, restore recreates the group. Restore never starts a provider or shell
process. **⌘K** also exposes each recoverable Session by name.

Draft tabs and never-started Agents contain no durable conversation and keep the
fast discard behavior. A draft becomes durable UI state after any explicit
composer choice, not only non-blank task text; its exact launch snapshot survives
tab switches and restarts. The snapshot is not itself a reusable Launch
Configuration and does not train Project ranking. Once a recoverable entry
expires, Exawatt reaps its retained terminal history; provider-owned history
remains governed by the provider.

The tab is currently the workspace ribbon's Initiative-shaped projection of this
Session. Closing the last tab does not implicitly close its Project: the empty
Project remains open and later settles into the compact dormant tail. `⌘W` on
that selected empty Project is the explicit Project close.

## Starting from a recent conversation

The new-Agent page lists recent provider conversations for the active Project.
Each row shows a short title and bounded handoff; Exawatt keeps the full Claude
Code or Codex identity internal. Selecting the row resumes that exact provider
conversation in its original nested directory or live worktree. When Exawatt
also has saved Session history, the current new-tab draft becomes that Session
in the same gesture; the saved entry remains recoverable if provider launch
fails. A saved row with no exact provider identity reopens retained history
without guessing. Selecting **Fresh** starts a distinct Agent with the short
handoff and original ID in its initial task.

Discovery is local-first. Provider-native titles and machine-local cached
labels appear without a network request. When a provider has no usable title,
a signed-in desktop may ask Exawatt to generate one from a bounded set of short,
operator-authored excerpts. Common credentials are redacted on-device first,
and Settings can disable hosted labels entirely. The hosted boundary applies a
per-user quota and does not persist the excerpts. Failure, quota exhaustion, or
offline use leaves the local fallback in place and never blocks a new Agent or
exact resume. Provider or generated metadata that narrates the model's process
(for example, “Based on my exploration…”) is discarded in favor of the saved
operator goal.

## Cloning to another Agent

A started Agent Session's context menu and **⌘K** expose **Clone to…** and each
available Agent Launch Configuration. The selected target is exact: configured
Agent Source, source-native model, and effort or variant. Shell and unavailable
configurations are excluded.

Clone creates a distinct new Agent and Session. Exawatt gives it a bounded,
Exawatt-owned goal/context handoff derived from the original Session, leaves the
original untouched, and passes no provider conversation or resume identity.
There is no live process migration, shared conversation state, automatic
failover, or source substitution. The new Session succeeds or fails as an
ordinary fresh launch, and only success updates that Project's Launch
Configuration frecency.

## Local data

Retained terminal history is machine-local, private to the current OS account,
and bounded to the latest 4 MB per Session. Closing keeps that history through
the 14-day recovery window; expiry removes it. Provider-owned conversation
history remains governed by the provider.
