# ENG-018 Deterministic Session Rehydration

This document is execution detail for roadmap item ENG-018. The roadmap remains
the singular sequence authority.

## Outcome

Exawatt can quit, crash, update, and relaunch without losing the operator's
logical Session map. Local processes stop. The workspace, exact source identity,
lifecycle state, and the latest 4 MB of terminal history restore without
starting work. The operator resumes agents explicitly.

## Contracts

- Workspace v5 stores an explicit durable Session ID. Migrated v4 tabs seed it
  from the stable tab ID; new Sessions receive a separate UUID.
- Tab IDs are UI identity, PTY runtime IDs are ephemeral, and Claude/Codex
  conversation IDs are exact source identities. None are substituted for one
  another.
- Lifecycle is `running`, `stopped-clean`, `interrupted`, `exited`, `resuming`,
  or `failed`.
- History is machine-local, atomically replaced, permission-restricted, bounded
  per Session, journaled between bounded compactions, and removed only when the
  Session is permanently deleted. Disk writes are serialized with deletion.
- Workspace saves are serialized in invocation order. Shutdown first persists
  Sessions as running, verifies process death, then commits stopped-clean; an
  incomplete shutdown remains conservatively interrupted.
- Codex discovery reads bounded rollout prefixes, tolerates provider file churn,
  and associates parallel launches by provider launch time while preserving PTY
  input order.
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

1. S0 canon (landed 2026-07-11): roadmap, concepts, architecture/manifest, decision `0012`, and this
   implementation contract.
2. S1 durability (landed 2026-07-11): workspace v5 (advanced to v6 by ENG-016 D34 for explicit
   tab-title ownership), durable lifecycle model, disk history store, periodic checkpoints,
   clean-run marker, migration and corruption tests.
3. S2 shutdown (landed 2026-07-11): reentrant main-process coordinator, native quit alert, flush,
   bounded process termination, window-close distinction, and updater routing.
4. S3 rehydration (landed 2026-07-11): retained-history preload, compact status UI, exact individual
   resume, sequential agents-only Resume All, locking, and localized failures.
5. S4 proof (landed 2026-07-11): packaged UI checks, process/orphan checks, crash recovery,
   authenticated provider round trips, and a signed multi-agent version-to-version update.

Each packet is independently reviewed, tested, committed, rebased, and
integrated before the next packet proceeds.

## Acceptance evidence

Automated tests cover migrations, atomic storage, caps/permissions, corrupt
records, lifecycle transitions, shutdown reentrancy, cancel/confirm behavior,
resume locking, exact-ID commands, no-spawn restore, agents-only Resume All,
update routing, keyboard/focus, accessibility names, and compact/large layouts.

Literal acceptance uses an isolated fixture repo with two Claude Sessions, two
Codex Sessions, and one shell. It proves cancel keeps all work alive; confirmed
quit leaves no orphan; relaunch restores layout and history; Resume All restores
the four exact conversations but not the shell; forced termination marks
interrupted work; one corrupt checkpoint does not block the others; and a signed
update checkpoints, stops, installs, relaunches, and resumes exactly. Mock tests
are necessary but not sufficient.

Recorded 2026-07-11 evidence:

- `pnpm test`: 56 files and 382 tests passed. `pnpm lint`, `pnpm type-check`,
  `pnpm electron:compile`, and the unpackaged production build passed.
- `pnpm eval:electron:lifecycle` passed repeatedly against the packaged app with
  two Claude fixtures, two Codex fixtures, and one real shell. It covered quit
  cancellation, confirmed process-group death, five retained histories,
  isolated corrupt-history handling, no-spawn relaunch, four exact resumes,
  explicit shell recreation, and SIGKILL recovery. Screenshots were inspected
  at 1400×900 and 800×600.
- `pnpm eval:electron:resume`, `pnpm eval:electron:terminal`, and
  `pnpm eval:electron:packaged` passed: four saved IDs resumed exactly, 20,000
  terminal lines remained searchable, text/image paste worked, and the packaged
  renderer/preload/PTY round trip remained intact.
- `pnpm eval:electron:real-harness` drove the installed authenticated Claude and
  Codex CLIs through their real trust prompts and received exact response
  markers. Redacted SHA-256 identity prefixes: Claude `3d44e57598d1`, Codex
  `5ec23f788f6a`.
- GitHub Actions runs `29176594128` and `29176725689` built, Developer ID signed,
  notarized, stapled, verified, and published `v0.1.4` and `v0.1.5`. The downloaded
  `v0.1.4` baseline independently passed `codesign`, Gatekeeper, and notarization
  assessment.
- `EXAWATT_BASE_APP_PATH=… EXAWATT_EXPECTED_UPDATE=0.1.5 pnpm
  eval:electron:update` passed the public Supabase feed from signed `0.1.4` to
  signed `0.1.5`: five live Sessions were checkpointed and stopped, the bundle
  replaced and relaunched automatically, all five histories restored without
  spawning, four exact agents resumed, the shell remained stopped, and no agent
  or shell process survived either shutdown boundary.

Hardening review and evidence, 2026-07-12:

- Closed six review findings covering rollout churn, first-submit input order,
  concurrent history/workspace writes, premature clean-state persistence, and
  scrollback write amplification. Regression tests delay atomic renames, overlap
  flush/delete/save calls, rotate rollout files, and exercise a 16 MB rollout.
- The production Codex catalog on 293 rollout files totaling 1.37 GB improved
  from 2.34 seconds / about 704 MB RSS to 98 ms / about 68 MB RSS while returning
  the same 18 Project candidates.
- `pnpm lint`, `pnpm type-check`, `pnpm electron:compile`, and all 409 tests
  passed. The unsigned packaged production build and five-Session lifecycle
  evaluation passed, including cancel, verified quit, journal replay, corrupt
  history isolation, four exact resumes, shell exclusion, crash recovery, and
  modal-free quit from a non-workspace route.
- The authenticated real-harness evaluator passed against installed Claude and
  Codex CLIs and captured an exact new Codex identity through the bounded catalog.

## Deferred semantic closeout

ENG-019 follows ENG-003. It adds source-aware atomic-turn completion and
versioned repo handoffs under `.exawatt/sessions/`, with user/shared/local policy
precedence. Exawatt reports repository-instruction compliance but does not run
git for agents.
