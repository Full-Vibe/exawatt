# Session lifecycle

An Exawatt Session is durable even when its local process is not. Quitting the
desktop app stops local agents and shells after confirmation. Exawatt does not
install a daemon, LaunchAgent, or other background process to keep them alive.

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

Claude Code and Codex resume only by the exact provider conversation identity
saved for that Session. Exawatt does not guess from the latest conversation or
working directory. Electron main writes that identity to its own atomic local
index as soon as the provider allocates or reveals it. Older identity-less
Sessions repair automatically only when the saved opening task has one unique
provider match; otherwise the pane clearly asks the operator to reconnect a
conversation.

Retained terminal output is labeled **Saved terminal history · read-only** so a
stopped Session cannot be mistaken for an interactive terminal.

## Closing and reopening

Closing a meaningful tab archives its Session identity, Project, goal, provider
conversation ID, and retained terminal history for 14 days. **⌘⇧T** takes the
newest entry from that ledger and restores it as the active stopped tab; repeated
presses walk backward through the close order. If its Project group is no longer
open, restore recreates the group. Restore never starts a provider or shell
process. **⌘K** also exposes each recoverable Session by name.

Draft tabs and never-started Agents contain no durable conversation and keep the
fast discard behavior. A draft becomes durable UI state after any explicit
composer choice, not only non-blank task text; its complete launch configuration
survives tab switches and restarts. Once a recoverable entry expires, Exawatt reaps its
retained terminal history; provider-owned history remains governed by the
provider.

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

## Local data

Retained terminal history is machine-local, private to the current OS account,
and bounded to the latest 4 MB per Session. Closing keeps that history through
the 14-day recovery window; expiry removes it. Provider-owned conversation
history remains governed by the provider.
