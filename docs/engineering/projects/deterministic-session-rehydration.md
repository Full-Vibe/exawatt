# ENG-018 Deterministic Session Rehydration

This document is execution detail for roadmap item ENG-018. The roadmap remains
the singular sequence authority.

## Outcome

Exawatt can quit, crash, update, and relaunch without losing the operator's
logical Session map. Local processes stop. The workspace, exact source identity,
lifecycle state, and the latest 4 MB of terminal history restore without
starting work. The operator resumes agents explicitly.

## Contracts

- The existing stable tab ID becomes the durable Session ID in workspace v5.
- PTY runtime IDs are ephemeral; Claude/Codex conversation IDs are exact source
  identities. The three are never substituted for one another.
- Lifecycle is `running`, `stopped-clean`, `interrupted`, `exited`, `resuming`,
  or `failed`.
- History is machine-local, atomically replaced, permission-restricted, bounded
  per Session, and removed only when the Session is permanently deleted.
- Resume All is explicit, sequential, and agents-only. It never starts shells.
- Exact resume never guesses from latest conversation or cwd.

## User interaction

- Live Sessions carry compact Running status; restored Sessions carry Stopped
  or Interrupted status with accessible names and explanatory tooltips.
- `Cmd-Q` with live processes presents one native warning: “Quit Exawatt and
  stop N agents?” with a one-sentence persistence/resume explanation and Cancel
  / Quit and Stop actions. Shell counts appear when relevant.
- No-process quit has no prompt. Cancel changes nothing.
- Relaunch has no modal. A contextual “N agents ready to resume” notice offers
  Resume All. Individual agents offer Resume; shells offer New Shell Here.
- Restart to Update uses the same coordinator with restart-specific copy.
- Corrupt or failed Sessions remain isolated and actionable without blocking
  other restores.

## Work packets

1. S0 canon: roadmap, concepts, architecture/manifest, decision `0012`, and this
   implementation contract.
2. S1 durability: workspace v5, durable lifecycle model, disk history store,
   periodic checkpoints, clean-run marker, migration and corruption tests.
3. S2 shutdown: reentrant main-process coordinator, native quit alert, flush,
   bounded process termination, window-close distinction, and updater routing.
4. S3 rehydration: retained-history preload, compact status UI, exact individual
   resume, sequential agents-only Resume All, locking, and localized failures.
5. S4 proof: packaged UI checks, process/orphan checks, crash recovery, and a
   signed multi-agent version-to-version update.

Each packet is independently reviewed, tested, committed, rebased, and
integrated before the next packet proceeds.

## Acceptance evidence

Automated tests cover migrations, atomic storage, caps/permissions, corrupt
records, lifecycle transitions, shutdown reentrancy, cancel/confirm behavior,
resume locking, exact-ID commands, no-spawn restore, agents-only Resume All,
update routing, keyboard/focus, accessibility names, and compact/large layouts.

Literal acceptance uses an isolated fixture repo with two real Claude Sessions,
two real Codex Sessions, and one shell. It proves cancel keeps all work alive;
confirmed quit leaves no orphan; relaunch restores layout and history; Resume
All restores the four exact conversations but not the shell; forced termination
marks interrupted work; one corrupt checkpoint does not block the others; and a
signed update checkpoints, stops, installs, relaunches, and resumes exactly.
Record versions, screenshots, outcomes, and redacted identity hashes here. Mock
tests are necessary but not sufficient.

## Deferred semantic closeout

ENG-019 follows ENG-003. It adds source-aware atomic-turn completion and
versioned repo handoffs under `.exawatt/sessions/`, with user/shared/local policy
precedence. Exawatt reports repository-instruction compliance but does not run
git for agents.
