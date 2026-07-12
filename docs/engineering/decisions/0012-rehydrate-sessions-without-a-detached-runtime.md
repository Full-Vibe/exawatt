# 0012 Rehydrate local Sessions without a detached runtime

Date: 2026-07-11
Status: accepted

## Context

Decision `0005` chose Electron-main-owned PTYs for v0 and left tmux or a daemon
as a possible later upgrade. ENG-018 initially assumed that local agents needed
to survive an Exawatt restart. The operator clarified that processes should not
continue after explicit quit: quitting should warn, checkpoint, stop them, and
make their logical Sessions easy to resume later. Persistent companion
processes add installation, security, orphaning, version-skew, and lifecycle
cost without serving that requirement.

## Decision

- Keep PTYs owned by Electron main. Do not add tmux, a daemon, or LaunchAgent.
- Treat a Session as durable and a local PTY process as one incarnation of it.
- Persist exact provider identity, lifecycle metadata, and bounded terminal
  history under the app's machine-local data directory.
- Explicit quit and update restart use one coordinated checkpoint-and-stop path.
- Relaunch restores state without spawning. Operators resume agents explicitly;
  shells start fresh in the same directory.
- Resume is deterministic: exact provider identity or no automatic resume.

## Consequences

- Local work never silently continues after Exawatt quits.
- Crash and update recovery can be reliable without a privileged background
  component, but work in flight after the last checkpoint can still be lost.
- A future requirement for uninterrupted background agents must be justified
  and designed as a new source/runtime capability; it is not ENG-018.
- This decision supersedes only the designated-detachable-upgrade assumption in
  decisions `0005`, `0008`, and `0009`; their other conclusions remain active.

## Research basis

- VS Code distinguishes process reconnection from process revival and restores
  terminal content independently.
- iTerm2 uses long-lived servers specifically to keep jobs alive; that behavior
  is unnecessary when explicit quit stops work.
- Apple's macOS guidance reserves alerts for consequential actions and prefers
  contextual, nonmodal startup state.
