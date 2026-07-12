# 0008 Package the privileged Electron renderer locally

Date: 2026-07-10
Status: accepted

## Context

The current production Electron shell loads `https://exawatt.ai` while its
preload exposes local PTY, workspace, settings, and authentication commands.
This separates the visible UI version from the installed app version and gives
remotely delivered JavaScript a privileged bridge to local agent processes.

The daily-driver app must be understandable as one installed product version.
The future hosted interface remains important, but it does not need local PTY
privileges and should not define the desktop trust boundary.

## Decision

- The installed Electron app packages and loads its own renderer code.
- Production Electron opens the packaged workspace directly and does not load
  the hosted Exawatt site as its primary renderer.
- The desktop renderer and Electron main/preload code ship as one tested build
  identified by a version and git commit SHA.
- External and hosted content opens without the local PTY preload bridge.
- The packaged renderer keeps context isolation, sandboxing, a restrictive CSP,
  navigation controls, narrow preload methods, and IPC sender validation.
- Near-term dogfood delivery uses a one-command, agent-closeout install to
  `/Applications`. Product distribution advances to signed/notarized CI builds
  and `electron-updater`; the local copy is not the long-term updater.

## Consequences

- Renderer changes no longer depend on a separate website deployment before the
  installed app reflects them.
- Offline launch and packaged-app tests become required daily-driver behavior.
- The build must package the Next renderer and native `node-pty` dependencies.
- Hosted and desktop surfaces may share source and UI models, but their delivery
  and privilege boundaries are explicit.
- A running app is never silently restarted for an update because its PTY
  processes share the app lifecycle. ENG-018 later adds explicit coordinated
  checkpoint-and-stop before update restart, not process detachment (decision
  `0012`).

## Alternatives rejected

1. Keep loading `exawatt.ai` and rely only on context isolation. This preserves
   version skew and still exposes purpose-built privileged preload methods to
   remotely delivered code.
2. Add a background LaunchAgent that watches `master`. The operator explicitly
   rejected persistent background build automation; the agent landing `master`
   already has the right closeout moment.
3. Build full release infrastructure before dogfood. Correct long term, but it
   unnecessarily delays the installed daily-driver loop. It remains a named
   near-term work packet with signing, notarization, release metadata, and
   staged update delivery.
