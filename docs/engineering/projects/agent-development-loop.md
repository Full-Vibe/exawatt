# Agent Development-Loop Hardening

Roadmap item: ENG-022

This is execution detail for ENG-022, not a separate roadmap. It holds the
diagnosed friction, the bootstrap and preflight contracts, and the regression
pins that keep an agent's first Electron eval honest in a fresh worktree.

## Outcome

A fresh agent worktree reaches a passing Electron eval with exactly
`pnpm worktree:setup` + `pnpm dev -p <port>` + `EXA_BASE=... pnpm eval:...`.
Native-binding, environment, and wrong-tree failures surface as actionable
remedies instead of bare platform errors or, worse, a green run against the
wrong checkout.

The active follow-up makes delivery composable at fleet scale: agents prepare
and submit independently, one fair sequencer verifies each exact candidate
state, integration never waits on a dogfood build, and one repository policy
chooses the verification floor. `pnpm agent:land` remains the sole public
delivery entrypoint; queue, policy, and post-integration work are internal
modules rather than new package-script verbs.

## Ownership boundaries

- This item owns the agent development loop, not product behavior. Fold new
  agent-loop friction here rather than into product roadmap items.
- The harness refuses ambiguous conditions instead of guessing: a dev server
  whose `repoRoot` realpath differs from the tree under test is refused, and
  only an identity-less (older or production) server is tolerated, with a
  warning.
- Launch resilience is bounded to the one observed Playwright transient. A
  second failure surfaces rather than retrying into a loop.
- Authorship and submission stay decentralized. Mutation of one ordered Git
  ref is necessarily sequenced; the sequencer is infrastructure, not a lead
  agent and not an owner of product decisions.
- Candidate, gate, and post-integration work are separate pipelines. A
  candidate may fail without blocking other authors; a gate proves the exact
  tree to be integrated; dogfood consumes integrated commits without holding
  the integration critical section.
- Repository-owned policy provides a conservative verification floor from the
  changed paths. Callers may add evidence but cannot select a weaker floor.
- Preserve the existing immutable build snapshot, atomic app replacement, and
  stale-base refusal. The contention problem is orchestration around those
  sound primitives, not a reason to weaken them.

## Delivery contention audit — 2026-08-03

The operator noticed repeated agent reports that a full verification pass had
finished only for `origin/master` to move, and that agents were waiting behind
another dogfood build. The logs and repository state confirm a system-level
problem rather than isolated unlucky landings:

- in the sampled roughly two-week delivery log, 182 landings succeeded while
  90 stopped on a stale `origin/master` and 23 stopped on a dirty shared
  checkout; a stale stop therefore occurred about once for every two
  successful landings
- the peak observed submission pressure was 17 active sessions in one
  five-minute bucket; 78 commits landed on 2026-08-03
- 58 dogfood installs appeared in the sample; 53 paired lock intervals held
  the shared delivery lock for about 2.5 hours in aggregate, with a 2.2-minute
  median interval
- the existing directory lock is mutual exclusion, not a queue: a temporary
  seven-waiter stress test produced non-FIFO acquisition order in all 20 runs,
  so an agent's wait time does not preserve its place
- 143 Codex compactions appeared in the sample; repeated verification and
  wait/rebase cycles are consuming both machine time and agent context
- the local-queue decision amendment reproduced the retry trap live: its first
  landing waited about ninety seconds, stopped because `master` moved, rebased,
  reran all 46 delivery tests, then failed because `agent:land` uses an ordinary
  push for the already-published agent branch whose history the prescribed
  rebase rewrote. The legacy recovery path needs a lease-protected candidate
  update or unique attempt ref; the queue path avoids the trap by never
  rewriting a submitted candidate

The GitHub side is amplifying the local loop. The latest 100 CI runs inspected
were all post-push runs rather than pull-request gates. Of the 98 completed
runs, 11 passed and 87 failed; the runs generally took four to six minutes.
August usage had already reached 609 Linux minutes (576 on August 3) against
the Free plan's 2,000 included monthly minutes. CI currently catches useful
Linux/runtime and timing failures, but an 89% red post-merge signal cannot be
made the merge gate until its baseline is repaired.

The tail of the sample also rules out treating CI as disposable duplication.
After ten consecutive green runs, later integrated commits failed on two real
cross-change contracts: `ExposeOverlay` was rendered without the newly required
goal-visual preference provider, and a roadmap backlog addition did not update
the parser's own-corpus expectation. The Linux gate found both only after
`master` moved. H7 repairs the baseline and H9 moves this composition evidence
to the exact pre-integration tree; they do not remove the hosted check.

The earlier note below about two green branches composing a red master was
directionally correct but proposed only a cheap post-fetch check or advisory
lock. The audit supersedes that narrow hypothesis. An advisory lock already
exists, is unfair, and holds an unrelated artifact build; another check inside
that lock would serialize more expensive work without creating a durable
queue or a repository-owned verification policy.

## Accepted delivery architecture — 2026-08-03

Decision `0030` adopts a three-stage delivery model.

### Candidate: decentralized and cheap to abandon

`pnpm agent:land` validates a clean `agent/*` worktree, derives the required
checks from repository policy, runs the fast candidate floor, pushes the
immutable branch, and submits a queue record. Submission gives the candidate a
stable identity and position; it does not hold a terminal or the delivery
lock while earlier work runs. Pull requests are a useful envelope for status,
diffs, and future human review, but are not the architecture itself.

### Gate: fair and exact

One FIFO sequencer constructs the candidate on the current accepted base and
runs the integration gate on that exact tree. Only the sequencer advances
`master`. A failing candidate is removed with actionable evidence and the next
candidate proceeds; other authors do not rebase and repeat a full matrix merely
because an earlier candidate landed.

Start with a speculative window of one and no batching. The present CI failure
rate makes wider speculation mostly waste. After the gate is trustworthy, it
may grow an adaptive speculative window: expand after sustained green runs and
contract immediately after a failure, following the proven merge-train/Zuul
shape rather than fixing concurrency at today's unusually high load.

### Post: supersedent artifacts

Dogfood is requested by Electron-facing candidates but built outside the
integration lock from an immutable integrated snapshot. The coordinator
coalesces requests to the newest useful `master`: build when the queue drains,
or capture a snapshot after a bounded ten-minute maximum wait so a continuous
queue cannot starve dogfood. A new commit may make another build necessary,
but never makes integration wait for the current build. Atomic install and
signature verification remain unchanged.

## Queue backend — operator decision 2026-08-03

Build the lightweight coordination layer in the repository. The operator does
not want a paid GitHub plan or a hosted merge-queue dependency; this explicitly
supersedes the same-day recommendation to trial Mergify, regardless of its
current free tier. Pull requests are not required for machine-only delivery.

The first-mile backend is machine-local because today's competing agents and
worktrees share one Mac:

- queue records, coordinator lease/heartbeat, terminal results, and append-only
  metrics live under the repository's common Git directory, shared by every
  worktree but never committed
- every submitted candidate is pushed first to its immutable remote `agent/*`
  branch, so a local process crash cannot lose the code even though queue order
  itself is local
- a very short queue-admission critical section allocates monotonic tickets;
  verification and integration never run while that admission lock is held
- one detached, short-lived coordinator is elected with a recoverable lease;
  it drains the queue and exits rather than becoming a daemon. Any waiting
  `agent:land` process may restart it after a stale heartbeat
- the coordinator owns an isolated reusable gate worktree. For each ticket it
  reconstructs the candidate's submitted commits on the latest accepted
  `master`, records conflicts as a terminal candidate failure, runs the policy
  gate on that exact tree, and advances `master` with a normal non-force push;
  if an external writer moves the remote during the gate, the coordinator
  invalidates that evidence and retries the ticket on the new base rather than
  sending the author through another rebase cycle
- the submitting `agent:land` waits on its durable result record so it can
  report `integrated` precisely, but it does not rebase, rerun, or hold the
  sequencer. Multiple waiters can monitor/recover the same coordinator safely
- the current guarded direct fast-forward implementation remains an
  operator-only recovery mode during rollout

The queue interface remains transport-neutral at its boundary so a future
multi-machine fleet can replace local storage with a remote sequencer. That is
architectural room, not active hosted work.

Keep this infrastructure small: no HTTP service, database, always-on daemon,
queue UI, pull-request automation, or second package command. The implementation
is a ticket store, a recoverable worker, the exact-tree policy, and tests behind
the existing `agent:land` command.

GitHub Actions may continue using the repository's included Free-plan minutes
for a Linux exact-candidate check: the coordinator pushes a disposable gate ref
and waits for its status before advancing the identical SHA. Repository policy
decides when that platform check is material; documentation-only candidates do
not consume a full hosted matrix. H7 measures minutes and keeps platform gates
inside the included allowance through change policy and, once proven safe,
batching. If projected use exceeds that allowance, the gate pauses or is
reshaped explicitly; it never buys an overage or silently drops required
evidence. No queue milestone assumes paid Actions capacity.

## Active milestone plan

- **H7 CI truth and measurement:** classify the current CI failures, repair the
  Linux baseline and the legacy rebase/remote-candidate retry trap, add
  cancellation for obsolete candidate runs, and record queue wait,
  candidate/gate duration, stale-stop count, gate failures, Actions minutes,
  and dogfood freshness. Exit when ten consecutive current-master full gates
  are green and the measurements are emitted from one schema.
- **H8 Local shadow queue:** extract ticket storage, the coordinator lease, and
  terminal result records behind internal modules used by `agent:land`;
  exercise FIFO order, crash recovery, candidate cancellation, and an
  operator-only bypass in temp repositories. Mirror real submissions without
  changing their current integration path. Exit when tickets retain order, a
  killed coordinator resumes without duplicating integration, and no orphaned
  candidate can disappear without a terminal result.
- **H9 Exact-candidate gate and policy:** move the verification floor into a
  repository-owned change classifier, with a small always-on safety spine and
  explicit conditional Electron, browser, R3F, CI, and documentation checks.
  Callers can request extras. Exit when only a commit that passed the declared
  policy on its current-base candidate can reach `master`, and the evidence is
  attached to that candidate identity.
- **H10 Authoritative local sequencer:** have the existing `agent:land`
  entrypoint push the immutable candidate, allocate a ticket, ensure the
  short-lived coordinator is healthy, and wait for its result. Start at gate
  width one with batching off. Enable batching or speculative checks only after
  measured green rate and queue latency justify them. Exit after 30
  representative landings with zero stale-base re-verification loops, zero red
  integrations, successful coordinator crash recovery, and lower Actions
  minutes per integrated commit than the audit baseline.
- **H11 Supersedent dogfood:** remove dogfood from the master-delivery lock,
  coalesce Electron-facing requests on queue drain with a ten-minute ceiling,
  and build from an immutable integrated SHA. Exit when a burst of at least ten
  eligible landings advances `master` without dogfood lock contention, installs
  the newest required snapshot, and never replaces the app with an unverified
  or unintended build.

Rollback is one switch: stop admitting local tickets, drain or cancel queued
candidates, and return `agent:land` to the guarded direct fast-forward path.
Remote candidate branches remain recoverable throughout. The existing delivery
tests remain the recovery floor during the rollout.

## Findings log

- 2026-08-03, Playwright 1.61's managed macOS browser revisions were all
  ad-hoc signed: the outer Chrome for Testing app and its network-facing helper
  had no Team Identifier, their designated requirements were CDHash-only, and
  strict verification failed. Little Snitch 6.4.1 therefore stalled short-lived
  browser connections behind approval alerts, while Playwright upgrades changed
  both the cache path and CDHash. Three distinct browser PIDs on 2026-08-02 used
  the exact same revision/path within 78 minutes, falsifying fresh bundle IDs as
  the cause of same-revision repeats; process-pair/profile/pending-alert scope
  remained external rule-state variables and is no longer an operator burden.
  The agent loop now owns `scripts/lib/qa-browser.mjs`: on macOS it prefers
  signed Google Chrome, falls back to signed Brave, verifies the main and
  network-helper Team identity, and refuses managed Chrome for Testing unless
  an agent explicitly opts into `EXAWATT_QA_BROWSER_ALLOW_UNSTABLE=1` for a
  compatibility check. `pnpm worktree:setup` runs the identity-only doctor;
  `pnpm qa:browser:smoke` drives hosted Exawatt or `EXA_BASE`. All checked-in
  Chromium evals consume the same boundary. A recursive Developer ID re-sign
  experiment passed cryptographic verification across Chrome 148/149 but broke
  renderer startup because Chromium helpers need role-specific hardened-runtime
  entitlements, so cache re-signing is rejected rather than shipped half-safe.
  Full evidence and rerun commands live in incident `0002`.

- 2026-08-02, rebasing across route removals left `.next/types/validator.ts`
  referring to pages that no longer existed. `pnpm type-check` then failed on
  generated history rather than the checked-out source until a production
  build happened to clean it. The type-check command now runs Next's supported
  `next typegen` step first, making generated route types an owned input instead
  of ambient build state.

- 2026-08-02, `.env.local` copying was idempotent only when “a file exists” was
  treated as success; rerunning `pnpm worktree:setup` never refreshed a stale
  worktree snapshot, and the live context-label command did not load the file
  it required. A linked worktree bootstrap now pulls Vercel Development values
  directly into that worktree, avoiding shared-file races; if Vercel or the
  network is unavailable it refreshes from the main checkout's last good
  snapshot and says so. Snapshot synchronization is content-idempotent,
  permission-bounded to `0600`, and covered by delivery tests. The live label
  command explicitly loads `.env.local` while still accepting an exported key
  in CI.

- 2026-07-27, concurrent-agent load makes timing tests lie. During the ENG-015
  S1.1 pass the machine reached **load average 425** with several agent
  worktrees and dev servers running. Effects, all environmental and none
  reproducible once load cleared: five `waitFor`-based renderer tests failed
  (`_home-hero`, `settings-client`, `session-state-tile-study`,
  `command-navigation-provider`, `launch-controls`), each taking 5-25s where
  they normally take milliseconds; a Next dev server took **114s** to compile
  `/workspace`, which blew past `assertDevServerServesTree`'s 15s identity
  check and reported "no dev server answering" for a server that was healthy;
  and Playwright Electron launches timed out outright. **Diagnosis before
  fixing: run the suspect files in isolation and check `uptime` first.** A
  failure that vanishes in isolation and correlates with load is not a
  regression. Do not "fix" a product test by loosening its timeout on this
  evidence.

- 2026-07-27, Electron evals need cold-compile headroom on their FIRST waits.
  A cold dev server compiles the workspace route on first hit, so the opening
  `[data-command-altitude]` and `[data-agent-composer]` waits can exceed the
  default timeout and report a spurious failure. `electron-turn-truth-eval` and
  `electron-delegation-eval` give exactly those two waits 90s and leave every
  later wait short, so real failures still surface fast. New evals should copy
  that shape rather than raising the global default.

- 2026-07-27, driving a real interactive Claude session: use the Electron eval
  harness, not `expect`. Three `expect`-driven attempts produced no output from
  the CLI at all, while the same task through `withElectronApp` worked first
  try. The harness also gives the production IPC surface (`pty.list()`,
  `pty.write`) to assert against, which is what made the S1.1 before/after
  measurement possible.

## Roadmap milestone log (moved from roadmap.md, 2026-07-24)

On 2026-07-24 `docs/engineering/roadmap.md` was compressed to its contract —
status, concise scope, exit criteria, a one-line milestone list, and links —
so the top-level sequence is readable in one screen. The measurements,
restructure detail, and status history that lived in the roadmap until that
date are preserved verbatim below, exactly as written, including their dates.
The roadmap remains canonical for sequence and status; this log is the durable
execution detail it points to. Nothing here is new material: it is the ENG-022
roadmap entry as it stood on 2026-07-24.

<!-- Verbatim: docs/engineering/roadmap.md ENG-022 entry, 2026-07-24. Do not reword. -->

### ENG-022 Agent development-loop hardening

Status: done (initial pass) — created 2026-07-21 from friction hit while landing D26: a fresh worktree failed its first PTY spawn with a bare `posix_spawnp failed.` (node-pty's native binding is never built — pnpm blocks dependency build scripts and Electron needs its own ABI), untracked `.env.local` didn't follow the worktree (Supabase-backed dev routes 500), a first Electron eval launch failed transiently with Playwright's "Process failed to launch!", and nothing verified that the dev server an eval pointed at actually served the tree under test — with parallel agent worktrees, a stale `EXA_BASE` silently exercises the WRONG checkout.

Landed 2026-07-21:

- `pnpm worktree:setup` — idempotent one-command bootstrap (install, `.env.local` copy from the main checkout, node-pty Electron rebuild when the binding is missing, Electron main compile); referenced from AGENTS.md's worktree rule
- eval-harness preflights in `withElectronApp`: the node-pty binding is asserted BEFORE launch (actionable remedy instead of the per-spawn `posix_spawnp` banner), and any `EXAWATT_DEV_URL` launch verifies the new dev-only `/api/dev-identity` route (public-prefixed, 404 outside development) — the harness refuses a dev server whose `repoRoot` realpath differs from the tree under test, fails fast with a start-a-dev-server remedy when nothing answers, and refuses an UNHEALTHY server (only a 404 identity-less older/prod tree is tolerated, with a warning) — the unhealthy case was diagnosed live during this pass when a stale `next-server` child survived its parent's kill after the D26 worktree was deleted and kept answering 500 on the port
- bounded launch resilience: one sweep-orphans-and-retry on Playwright's "Process failed to launch!" (the observed transient), never more — a second failure surfaces
- `scripts/electron-eval.test.mjs` (in `test:agent-delivery`) pins the preflight and identity-guard behaviors, including the WRONG TREE refusal and the tolerated identity-less (older/prod) server
Exit criteria: a fresh worktree reaches a passing Electron eval with exactly `pnpm worktree:setup` + `pnpm dev -p <port>` + `EXA_BASE=... pnpm eval:...`, and pointing an eval at the wrong tree's dev server fails loudly instead of testing the wrong code — both validated 2026-07-21 (this item was itself landed from a worktree bootstrapped by the script; the split eval re-ran green through the guarded harness).

Sequencing: independent; extend as new agent-loop friction is diagnosed (fold future findings here rather than into product items).

## Historical friction evidence — 2026-08-03: green evidence composed a red master

Observed during the ENG-008 arc: `e52fc0f` made `FleetAgentView.rawTokens`
required while a near-simultaneous landing added a gallery fixture that did not
carry the field; each branch verified green in its own worktree, but their
composition left `pnpm type-check` red on master for ~80 minutes until a
forward-fix (`10d5be7`). The exact historical interleaving was not recovered.
Inspection during the broader audit corrected the initial mechanism claim:
`agent-land` already acquires mutual exclusion, fetches again, and refuses a
branch that no longer contains `origin/master`, so two same-base candidates do
not both pass that final guard. The red composition instead demonstrates that
verification chosen and reported per branch was not durable evidence for the
exact later candidate state (for example, after the required rebase), or did
not include the affected type gate.

The earlier candidate remedies—another cheap check or an advisory lock—are
superseded by decision `0030`. The lock already exists and is non-FIFO; the
durable fix is a repository-owned policy gate attached to the exact tree the
sequencer will integrate. This record remains because it is the first observed
product failure from the delivery model, not because its initial race theory
remains active.
