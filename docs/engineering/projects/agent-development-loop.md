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

The active follow-up makes delivery composable at fleet scale by removing the
measured contention rather than serializing verification: dogfood leaves the
delivery critical section, a FIFO ticket makes the wait fair and the lock
hold seconds long, and a cheap repository-owned floor reruns on the exact
tree at the head of the queue when the base moved. Expensive verification
stays parallel in the authors' worktrees. `pnpm agent:land` remains the sole
public delivery entrypoint; queue, policy, and post-integration work are
internal modules rather than new package-script verbs.

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
  ref is necessarily sequenced; the FIFO ticket order is infrastructure, not
  a lead agent and not an owner of product decisions.
- Candidate, integration, and post-integration work are separate pipelines. A
  candidate may fail without blocking other authors; the exact-tree floor at
  the head of the queue proves the tree to be integrated; dogfood consumes
  integrated commits without holding the integration critical section.
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
`master` moved. H7 repairs the baseline and H10 moves this composition
evidence to the exact pre-integration tree via the cheap changed-path floor;
the hosted check remains as batched post-integration evidence.

The earlier note below about two green branches composing a red master was
directionally correct but proposed only a cheap post-fetch check or advisory
lock. The audit supersedes that narrow hypothesis. An advisory lock already
exists, is unfair, and holds an unrelated artifact build; another check inside
that lock would serialize more expensive work without creating a durable
queue or a repository-owned verification policy.

## Accepted delivery architecture — 2026-08-03, amended same day

Decision `0030` adopts a three-stage delivery model. Its same-day amendment
reordered the mechanism after checking the design against the audit's own
arithmetic: the dominant measured cost is contention (113 stale-base and
dirty-checkout stops) rather than composition (three failures — corrected
2026-08-03 from an initial count of two: the historical `rawTokens`
type-check break, the `ExposeOverlay` provider miss, and the roadmap parser
own-corpus expectation — all catchable by cheap always-on checks on the
rebased tree, one by type-check and two by fast vitest), and a width-one sequencer
running full matrices would put MORE work on the critical path than today's
parallel verification outside the lock — 78 landings on the peak day at even
five serial gate minutes is 6.5 hours of queue. The elected-coordinator
sequencer is retained as a measured contingency, not built as the first mile.

### Candidate: decentralized and cheap to abandon

An agent verifies the repository-defined floor for its changed paths in its
own worktree, in parallel with every other author, pushes the immutable
`agent-attempts/*` ref, and takes a FIFO ticket. Expensive verification stays out
here, where it serializes no one. Pull requests are a possible future
envelope for status and human review, but are not the architecture.

### Integrate: fair, short, and exact where it matters

Tickets are served strictly in order. The lander at the head of the queue
holds the delivery lock for seconds: fetch, ancestor check, non-fast-forward
push. Only if `origin/master` moved since the candidate's verification does
it rerun the cheap exact-tree floor (generated route types, type-check, fast
tests chosen by changed-path policy) on the rebased tree — the scope that
would have caught all three audited composition failures. The mechanism is
explicit: the rebase happens in the author's own bootstrapped worktree, the
only checkout guaranteed clean and dependency-complete; every push of the
candidate is a new creation-only immutable attempt ref, so published
history is never rewritten and the integrated SHA always equals the
ticket's current pushed attempt. There is no separate gate checkout — a
fresh detached worktree would need its own dependency bootstrap and would
not be lightweight. A failing floor is a terminal candidate result with
actionable evidence; the next ticket proceeds, and no other author rebases
or repeats a matrix because of it. The shared `master` checkout is off this
path entirely: it receives a best-effort non-blocking sync after
integration and can no longer stop a landing by being dirty.

`agent:land` blocks until its ticket reaches a terminal result so it reports
`integrated` precisely. Blocking is cheap because waiting is idle — no
rebasing, no reverification — and holds are seconds.

### Post: supersedent artifacts

Dogfood is requested by Electron-facing candidates but built by a detached
installer outside the delivery lock, from an immutable integrated snapshot,
coalesced to the newest useful `master`: build when the queue drains, or
after a bounded ten-minute maximum wait so a continuous queue cannot starve
dogfood. The landing returns at integration. Installation keeps its existing
semantics — stage `/Applications/Exawatt.app` atomically without restarting
the running app, with the in-app notice offering a restart when convenient
(operator-confirmed 2026-08-03). A new commit may make another build
necessary, but never makes integration wait for the current build. Signature
verification remains unchanged.

## Queue backend — operator decision 2026-08-03

Build the lightweight coordination layer in the repository. The operator does
not want a paid GitHub plan or a hosted merge-queue dependency; this explicitly
supersedes the same-day recommendation to trial Mergify, regardless of its
current free tier. Pull requests are not required for machine-only delivery.

The first-mile backend is machine-local because today's competing agents and
worktrees share one Mac (operator-confirmed 2026-08-03: this Mac for now,
remote writers eventually):

- FIFO tickets, heartbeats, terminal results, and append-only metrics live
  under the repository's common Git directory, shared by every worktree but
  never committed
- every submitted candidate is pushed first to an immutable remote attempt ref
  under `agent-attempts/*`, so a local process crash cannot lose the code even
  though queue order itself is local; published attempts are never force-updated
- a very short queue-admission critical section allocates monotonic tickets;
  verification and integration never run while that admission lock is held
- there is no coordinator (amended 2026-08-03): the `agent:land` process at
  the head of the queue integrates its own candidate, then exits. Waiting at
  a ticket is idle — no rebasing, no reverification, no lock polling races
- ticket state transitions are compare-and-swap with ownership epochs, so
  every ticket reaches exactly one terminal result and a superseded owner's
  late write cannot contradict it
- a head ticket may be taken over by a waiter only when its owner pid is
  dead. A live pid with a stale heartbeat is surfaced to the operator, never
  auto-taken: the 2026-07-27 load-average-425 incident proves this machine
  stalls healthy processes for minutes, and a heartbeat-only trigger would
  create duplicate ownership under exactly the load that needs the queue
  most. The remote's non-fast-forward refusal makes a mistaken takeover a
  retry, never a wrong `master`, and after any ambiguous push the lander
  reconciles by checking whether its attempt is reachable from
  `origin/master` before recording a terminal result. If an external writer
  moves the remote mid-landing, the head lander retries on the new base
  itself — the author never re-enters a rebase cycle
- `agent:land` blocks until its ticket reaches a durable terminal result so
  it can report `integrated` precisely; blocking is acceptable because holds
  are seconds once dogfood leaves the lock
- the current guarded direct fast-forward implementation remains an
  operator-only recovery mode during rollout

The elected-coordinator sequencer from decision `0030`'s original text is the
contingency this backend is shaped to grow into — the ticket store is exactly
the seam it would consume. It activates only on the H11 verdict (persistent
stale loops, red integrations, or p95 queue wait above the bound) or when
remote writers arrive and end the local queue's authority. The queue
interface therefore stays transport-neutral at its boundary; that is
architectural room, not active hosted work.

Keep this infrastructure small: no HTTP service, database, always-on daemon,
coordinator process, queue UI, pull-request automation, or second package
command. The implementation is a ticket store, head-of-queue integration
inside `agent:land`, the changed-path floor, and tests behind the existing
command.

The authoritative operator/agent runbook is
[`docs/engineering/agent-delivery.md`](../agent-delivery.md). It records the
implemented state layout, exact check classifier, ticket lifecycle, status
vocabulary, metrics schema, dogfood supersedence boundary, and safe recovery
actions; this project doc remains the roadmap narrative and measurement record.

GitHub Actions stays within the repository's included Free-plan minutes as
repaired, batched, post-integration evidence: a Linux run on the latest
integrated `master` with obsolete in-progress runs cancelled, not a
per-candidate serial gate. The arithmetic forbids more on this plan — 2,000
included minutes at the observed four-to-six-minute runs is roughly thirteen
gated candidates per day against 78 landings observed on the peak day. H7
measures minutes; projected exhaustion pauses or reshapes the batch cadence
explicitly, and it never buys an overage or silently drops required
evidence. No queue milestone assumes paid Actions capacity, and merge
authority never depends on a hosted result in this plan.

## Active milestone plan

Amended 2026-08-03 with decision `0030`'s contention-first amendment. The
order is the leverage order: dogfood out of the lock is most of the win, the
FIFO ticket makes the remainder fair, the floor makes it exact, and the
verdict milestone decides whether the sequencer contingency is ever built.

- **H7 CI truth, measurement, and the retry trap:** classify the current CI
  failures, repair the Linux baseline, fix the legacy rebase trap
  (`agent:land` ordinary-pushes an already-published candidate branch whose
  history the prescribed rebase rewrote — use a lease-protected update or a
  per-attempt ref), add cancellation for obsolete candidate runs, and record
  queue wait (p50/p95), lock-hold duration, stale-stop count, floor failures,
  Actions minutes, and dogfood freshness from one schema. Exit when ten
  consecutive current-master Linux runs are green and the measurements are
  emitted. Nothing else blocks on H7; H8 proceeds in parallel.
- **H8 Supersedent dogfood:** remove dogfood from the delivery lock — the
  single biggest lever, since its builds dominated the 2.2-minute median
  hold. A detached installer coalesces Electron-facing requests to the newest
  useful `master` on queue drain with a ten-minute ceiling, builds from an
  immutable integrated SHA, and preserves stage-without-restart semantics and
  the in-app restart notice. The landing returns at integration. Exit when a
  burst of at least ten eligible landings advances `master` with lock holds
  measured in seconds, installs the newest required snapshot within the
  ceiling, and never replaces the app with an unverified or unintended build.
- **H9 FIFO ticket queue:** monotonic tickets under the common Git
  directory; the head lander integrates itself; compare-and-swap ticket
  transitions with ownership epochs; takeover only on a dead owner pid
  (live-pid stale heartbeats surface to the operator, never auto-take); an
  operator-only bypass; the shared `master` checkout demoted to a
  best-effort post-integration sync that cannot block a landing. Requires
  H7's attempt-ref fix, and authority is never floorless: until H10 lands,
  a base-moved head landing reruns a hardcoded static floor (generated
  route types, type-check, fast delivery tests) on the rebased tree. Exit
  when stress trials acquire strictly in ticket order, a killed head lander
  is taken over without duplicated integration or a lost candidate, a
  surviving-but-stalled head lander is NOT taken over, no orphaned
  candidate can disappear without a terminal result, and a dirty shared
  checkout no longer stops anyone.
- **H10 Exact-tree floor and changed-path policy:** a repository-owned
  classifier selects the always-on cheap floor (generated route types,
  type-check, fast tests) plus explicit conditional Electron, browser, R3F,
  CI, and documentation checks from the changed paths; callers may add
  evidence but cannot weaken the floor; the head lander reruns exactly the
  floor when the base moved since candidate verification, replacing H9's
  hardcoded static floor. Exit when only a commit whose exact integrated
  tree passed the declared floor can reach `master`, the evidence is
  attached to the candidate identity, and regression tests pin all three
  audited composition-failure classes.
- **H11 Measured verdict:** run 30 representative landings and compare the H7
  schema against the audit baseline. "No red integrations" is defined
  observably — batched, cancellable CI cannot see every intermediate commit,
  so the criteria are zero exact-floor escapes (no landing's floor run fails
  against already-integrated `master`) and every completed queue-drain Linux
  batch green. Exit green when the 30 landings show zero stale-base
  re-verification loops, zero floor escapes, all-green drain batches, p95
  queue wait under three minutes at comparable load, and lower Actions
  minutes per integrated commit; otherwise exit with an explicit decision
  activating the `0030` elected-coordinator sequencer contingency. Remote
  writers arriving before this verdict force the contingency evaluation
  early.

Rollback is one switch: stop admitting local tickets, drain or cancel queued
candidates, and return `agent:land` to the guarded direct fast-forward path.
Remote candidate branches remain recoverable throughout. The existing delivery
tests remain the recovery floor during the rollout.

## Findings log

- 2026-08-04, unit-test throughput was separated into dedicated execution
  regimes instead of one root-level jsdom project. Electron and pure TypeScript
  app tests now run in Node; eight browser-contract `.ts` suites carry an
  explicit `.dom.test.ts` name beside the React suites. Core and UI-model use
  the threads pool, while only UI-model disables isolation: randomized-order
  stress stayed green there, but the same experiment in core exposed leaked
  module mocks and was rejected. The 1,389-line Agent composer suite was split
  by launching, source/model policy, interaction/draft, and recent-conversation
  behavior, cutting its measured local Vitest duration from 10.31s to 4.06s
  under the same worker cap.

  CI now uses both CPUs on the dedicated private runner instead of inheriting
  the local fleet-safe 25% cap, and restores Node's compile cache. Local full,
  changed, and related commands keep the composable cap and share that cache;
  the H10 related-test floor calls the same cached command. `test:changed` is an
  immediate dependency-graph feedback loop, not a claim that file-level
  relatedness is the final architecture. ENG-039 records the larger accepted
  direction: explicit source modules own their public contracts, runtime
  boundaries, and layered suites, and verification eventually closes over the
  module graph.

- 2026-08-03, the contention-first H7–H10 implementation landed behind the
  existing `pnpm agent:land` entrypoint without a new public command or hosted
  dependency. Delivery state now lives under the common Git directory as
  monotonic FIFO tickets with atomic per-ticket transitions, ownership epochs,
  heartbeats, dead-PID-only recovery, immutable per-attempt remote refs, and a
  v1 JSONL metric stream. The head lander rebases in its own bootstrapped
  worktree, republishes the new immutable attempt, reruns the repository-owned
  floor on that exact tree, and holds the legacy delivery lock only for the
  final fetch/non-force push. The shared `master` checkout is best-effort
  post-integration state and a dirty checkout cannot reject a landing. A
  guarded `--direct` path requires the operator-only
  `EXAWATT_AGENT_LAND_ALLOW_DIRECT=1` switch.

  Dogfood is now a separate latest-state consumer: an integrated landing writes
  one superseding request, starts a short-lived detached worker, and returns.
  The worker waits for queue drain or the ten-minute ceiling, builds an
  immutable integrated SHA under the independent installation lock, and checks
  the desired SHA immediately before staging and before the atomic swap. The
  existing signed snapshot, packaged smoke, atomic replacement, and
  stage-without-restart contracts remain intact.

  Local validation covered 32 concurrent admissions, CAS fencing and one
  terminal result, no takeover of a live owner, dead-owner recovery with its
  remote attempt preserved, a real two-lander FIFO race with automatic rebase,
  a dirty shared checkout, queue-drain and ceiling behavior, supersedence during
  a build, conditional policy composition, and CI cancellation. H7's ten green
  current-master Linux runs, H8's ten-candidate production burst, H9's
  production killed-head/sustained-load evidence, and H11's 30 representative
  landings remain observation work; implementation success is not being
  mistaken for those exit criteria.

- 2026-08-03, the H7 flake sweep removed wall-clock guesses from the affected
  filesystem and process-lifecycle unit tests. Session-history overlap tests
  now wait for the mocked atomic rename to begin before racing a newer write or
  deletion, and the process-group test waits for `ps` to report the detached
  group leader before exercising shutdown. Renderer consumer tests also hold
  unrelated goal-visual hydration pending and mock the separately-tested Agent
  Sources surface; the Settings harness flushes its own asynchronous system
  shortcut read inside React `act`. This removes late state updates and makes
  each assertion wait on the event it actually needs. A 280-second host pause
  during the broader sweep reproduced the 2026-07-27 contention signature, so
  no global or per-test timeout was raised; the suspect header test passed in
  isolation. H7 remains open for its ten-current-master-Linux-run and delivery
  metrics exit criteria.

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
durable fix is a repository-owned policy floor attached to the exact tree at
the head of the delivery queue (decision `0030` as amended). This record
remains because it is the first observed product failure from the delivery
model, not because its initial race theory remains active.
