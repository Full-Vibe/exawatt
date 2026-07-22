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

## Relaunch

Relaunch restores Projects, tabs, status, and retained terminal history without
starting work. **Resume All** starts only eligible agent Sessions, sequentially.
It never starts shells. A stopped shell offers **New Shell Here** instead.

Claude Code and Codex resume only by the exact provider conversation identity
saved for that Session. Exawatt does not guess from the latest conversation or
working directory.

## Starting from a recent conversation

The new-Agent page lists recent provider conversations for the active Project.
Each row shows its full Claude Code or Codex conversation ID plus a short title
and handoff. Selecting the row resumes that exact provider conversation;
selecting **Fresh** starts a distinct Agent with the short handoff and original
ID in its initial task.

Discovery is local-first. Provider-native titles and machine-local cached
labels appear without a network request. When a provider has no usable title,
a signed-in desktop may ask Exawatt to generate one from a bounded set of short,
operator-authored excerpts. Failure or offline use leaves the local fallback in
place and never blocks a new Agent or exact resume.

## Local data

Retained terminal history is machine-local, private to the current OS account,
and bounded to the latest 4 MB per Session. Permanently closing a Session removes
that retained history. Provider-owned conversation history remains governed by
the provider.
