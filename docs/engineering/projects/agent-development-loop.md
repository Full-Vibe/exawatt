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

- 2026-09-24, BUG-221 (sweep) and BUG-222: **every eval now waits for
  hydration, and none counts output a redraw can repeat.** A read-only audit
  of about 70 scripts found three groups. (1) 15 sites dispatched
  `exawatt:open-project` after `[data-command-altitude]`, the "Open Project"
  button, a "Loading…" probe or a 1.2 s sleep; `use-workspace-requests.ts`
  drops the event until the workspace is ready and nothing replays a raw
  dispatch, so each lost event is a composer timeout. `openFixtureSession`
  (clone-context, delegation, model-change, project-pause, turn-truth) had
  documented exactly this and used the button as the ready signal, which
  renders before hydration too. All now call `waitForWorkspaceReady()`; the
  lifecycle and idempotency `pageFor` helpers do it once, so their relaunch
  "spawned nothing" reads also come after the layout restores. (2) Saves
  raced by the app's own: spine now seeds while `/leaderboard` is showing
  (the workspace is unmounted and its flush already sent); lifecycle waits
  for `workspace.json` to carry the crash shell before SIGKILL instead of
  700 ms; recents polls for the first save carrying the resumed tab instead
  of 500 ms; project-agent waits for hydration before the chooser on its
  relaunch (a Project opened earlier was replaced by the restored layout)
  and reads the native menu until availability is published instead of
  100 ms. (3) Output counts: real-harness asked for a reply token its prompt
  contained and counted at least three copies, which echoes and input-line
  repaints can supply with no reply, so the prompt now spells the token out
  and the check is presence; terminal-fundamentals' scrollback wait was an
  async `waitForFunction` (it never waited; a 3 s sleep did) demanding two
  copies of a line awk prints once, and now waits for that line in xterm's
  buffer; its menu check compared shell output byte for byte after 250 ms
  and now records xterm's own `onData` while the menu is open
  (mutation-checked: one injected arrow key fails it, named). Verified: every
  enforced gate these files owe, run directly (project-agent, recents,
  spine, roadmap rail, agent-sources, tenancy, delegation, turn-truth,
  lifecycle, idempotency), plus clone-context, model-change, project-pause,
  interaction-performance and terminal-fundamentals (clipboard restored).
  Not run: real-harness (paid provider turns) and product-update (a signed
  baseline); their edits are the hydration wait and, for real-harness, the
  reply token. Not touched: `electron-context-label-feedback-eval.mjs`'s
  seed race, since that quarantined eval is being rewritten by the BUG-216
  repair in flight. BUG-222: turn-truth failed once in six runs at "the
  reported operator gate", twelve checks after the only step this change
  touches (master's fixture passed twice, this one three times). Cause: the fake Claude's stdin handler was async, so `ask` and
  `permission` posted concurrently, and `delegation-state.ts` keeps the
  first report of a gate. A probe that holds the first post open for 300 ms
  showed master's fake with both posts in flight and `permission_prompt`
  answered first; the fixed fake queues each command behind the previous
  one, and turn-truth then passed five of five. The first landing of this
  sweep then failed `eval:electron:project-agent` at its permission-menu
  keyboard step, the same shape one level down: the option menu takes focus
  a frame after opening (`onOpenAutoFocus` in a requestAnimationFrame) and
  the eval pressed ArrowUp as soon as the listbox existed, so a late frame
  sent the key to the trigger. With rAF delayed 400 ms the old step times out
  exactly as the landing did; the eval now waits for the list to own focus
  and an active option, and passes under the same delay.

- 2026-09-24, BUG-221: **two workspace evals acted before the workspace
  had loaded, and one counted text a redraw can repeat.** Measured, not
  inferred. A probe replaying `eval:workspace:split`'s old sequence (seed
  written with `workspace.save` from the page, `page.reload`, wait for
  `[data-workspace-stage]`, press ⌘⌥T) at load 19 lost its seed in 1 of 4
  runs: the saved layout read back `[]`, the reload restored no Projects, and
  ⌘⌥T had no Project to open a shell in. The app's own first save fires
  400 ms after hydration (`use-workspace-persistence.ts`) and the old page
  keeps running while `reload` fetches the new document, so that save can
  land after the seed. `[data-workspace-stage]` and `[data-command-altitude]`
  both render before hydration, so neither is a readiness signal.
  `eval:workspace:draft` had the same seed race, pressed ⌘⌥1 on relaunch right
  after the stage rendered, and counted pastes in `pty.buffer`, which is
  terminal OUTPUT: a second probe wrote one paste once while zsh owned the
  line, moved the cursor, and read it three times in the buffer. Its fixed
  sleeps (1.5 s for the shell, 0.5 s for `cat`, 0.75 s twice to settle, 0.9 s
  for the debounced save) stood in for all of it. Repair: the stage carries
  `data-workspace-ready` once hydration lands and the load-failure panel
  `data-workspace-load-failure`; `waitForWorkspaceReady()` in
  `scripts/lib/electron-eval.mjs` waits for either and fails naming a load
  failure, and `seedWorkspaceLayout()` writes `workspace.json` before launch
  (an external-teardown retry re-applies it). Both evals seed on disk and
  wait for the marker. The draft eval hands the PTY to
  `stty -echo -icanon && cat > <file>` once the shell has printed, waits for
  the file, counts each paste in that recording, and settles on a sentinel
  written through `pty.write` after the paste (writes from one renderer reach
  main in order, and a text paste writes in the task that receives it). Its
  empty-draft check opens the Empty Project's draft first and reads the first
  save that carries the Alpha draft's text, which is necessarily a later
  save. Mutation-checked: a second write of the paste fails "⌘V pastes
  exactly once". Evidence: each eval five times in a row, all green, at load
  12 to 22 and again at load 3 to 4. A read-only audit of every eval found
  the same shapes elsewhere, chiefly `exawatt:open-project` dispatched after
  a pre-hydration marker: `use-workspace-requests.ts` drops the event until
  the workspace is ready, and only the product's `requestOpenProject` sets
  the slot that replays it. Those follow.

- 2026-09-24, BUG-220: **no surface gate covered the workspace state.** The
  ENG-039 split moved hydration, persistence, restore, Recently closed,
  launch and runtime out of `use-workspace-state.ts` into
  `workspace-state/`, and neither the hook nor any module matched a
  `SURFACE_GATES` entry, so a restore or reopen change owed no Electron eval.
  Each module is now routed to the gates whose scripts drive it, read from
  the scripts rather than from the gates' names: project-agent opens,
  launches, closes and reopens, jumps to attention, drives palette requests,
  and reloads and relaunches, so it owes every module; recents seeds
  `closed-sessions.json`, relaunches a row exactly, asserts the ledger and the
  draft are consumed only after launch, and reads the saved layout back;
  split restores a seeded layout, pins, switches Projects, launches and
  watches an exit; project-pause and model-change drive the runtime verbs and
  read `workspace.json`; clone-context is a launch; lifecycle and idempotency
  are the relaunch evals, so they own hydration and restore; the quarantined
  exact-resume gate owns the resume verbs. `eval:workspace:draft` stays
  manual because it overwrites the system clipboard. Unit tests beside the
  modules owe nothing. A new `delivery-policy.test.mjs` case derives the
  module list from the directory, so a module added later owes project-agent
  without an edit; mutation-checked by removing that route.

- 2026-09-24, BUG-219: **the landing now reinstalls before any floor checks a
  stale tree.** Ticket 476 (the ENG-039 split) was admitted on
  `ea23a4a9`, rebased at the head onto `45418b49`, which carried
  `e3115004`'s jsdom 27.4 lockfile bump, and failed `test:agent-delivery` in
  the rebase re-check; the same change integrated as ticket 477 minutes
  later. Nothing between the rebase and the re-check compared the install
  with the lockfile, although `install-freshness.mjs` already could.
  `reinstallWhenStale` now does, for the worktree lane only: before the
  candidate floor (so a submitter's stale install is repaired, or refused
  before a ticket exists) and after every head rebase. It runs the frozen
  install `install-dogfood.mjs` uses, re-checks, and rebuilds node-pty when
  the install removed a binding the tree had, as `worktree:setup` would.
  Workspace links and pnpm patches need nothing extra: they are the
  lockfile's `importers` and `patchedDependencies` hash, and the built
  `@exawatt/core` types are rebuilt by `type-check` and `electron:compile`
  themselves. The docs lane is excluded because its checkout borrows another
  checkout's `node_modules`. `scripts/landing-reinstall.test.mjs` drives real
  queues with a `pnpm` stand-in whose checks fail on a stale install: a queue
  rebase that changes the lockfile reinstalls exactly once, before the
  re-check, and passes; one that does not reinstalls nothing; a stale
  submission reinstalls before its first check; an unsatisfiable lockfile
  stops before admission. With the reinstall removed, the first case fails
  exactly as ticket 476 did.

- 2026-09-24, BUG-208, BUG-210, BUG-211 (H20): **every verification
  command has a route, and a test says so.** `theme:check` was repaired on
  2026-08-17 (BUG-059) and red again on 2026-08-18 (`f4de31cb`), and it stayed
  red for five weeks because no landing check, gate or CI step ran it. The same
  day found `eval:electron:project-agent`, `eval:navigation:spine` and the
  stale-async ratchet red on master for the same reason. An audit of all 110
  verification commands in `package.json` (`lint`, `type-check*`, `test*`,
  `eval:*`, `verify:*`, `qa:*`, `security:*`, `*:check|audit|scan|proof`),
  deriving what runs each from the floor over every tracked path, the gate map,
  the pre-push hook and `ci.yml` (including what those run in turn, a Node test
  list inside a larger one, and a Vitest subset of the suite `test:ci` runs
  whole), found 46 run by nothing. Dispositions:
  - Floor, by changed path: `theme:check` (anything under `src/`, `themes/`,
    `packages/ui-model/`, the generator or the ratchet; about two seconds),
    `agent-sources:check` and `icon:check` (their one editable source, the
    generator or an output), `company:proof` (`company/` or the composition
    scripts; thirteen seconds). Into `test:agent-delivery`:
    `check-production-theme-literals.test.mjs` (0.7 s) and the private
    `public-repository-security.test.mjs` (0.04 s). Nothing was added to the
    unconditional floor. `icon:check` was already enforced indirectly, since
    `app-icon.test.mjs` calls it at import; routing it by path keeps the
    derivation honest.
  - CI: `security:secrets`, the pinned gitleaks over the whole history
    (`fetch-depth: 0`, seven seconds). `gitleaks.yml` runs only where the
    repository is public, so nothing had scanned the private history.
    `theme:check`, `agent-sources:check` and `icon:check` run in CI too.
  - Enforced gates, each run green on master first: `eval:hero-board`,
    `eval:typography-stability`, `eval:spatial`, `eval:spatial:pointer`,
    `qa:browser:smoke`, `eval:electron:offline`, `eval:electron:delegation`,
    `eval:electron:turn-truth`, `eval:electron:tenancy`,
    `eval:community:network` (builds its own package, like
    `eval:electron:packaged`). `eval:typography-stability` and
    `eval:navigation-paint` had failed at their first step since ENG-031 W6
    moved Architecture to the footer; both now click the footer link.
  - Quarantined gates, red on master: `eval:navigation-paint` (BUG-212, a
    real light header frame once the eval could run), `eval:navigation:electron`
    (BUG-213), `eval:electron:grok-source` (BUG-214),
    `eval:electron:appearance` (BUG-215), `eval:electron:context-labels`
    (BUG-216), and `eval:electron:resume`, `eval:electron:chrome` and
    `eval:electron:session-parity`, which cannot build the package they need
    (BUG-217).
  - Manual, 21, each with its reason in the table: production accounts and
    paid APIs, signed builds and live feeds, real signed-in CLIs, real
    customer Gateways, the operator's real corpus, host-load timing probes,
    and `eval:electron:terminal` and `eval:workspace:draft`, which overwrite
    the operator's system clipboard on every run.

  The table is `VERIFICATION_ROUTES` in `delivery-policy.mjs`, beside
  `SURFACE_GATES`. `delivery-policy.test.mjs` fails on an unclassified command,
  a stale entry, a route that does not run the command (the first of landing,
  gate, CI that does is its route), a manual entry without a reason, and a
  Vitest subset naming a file no project includes. That last check found
  `eval:context-labels` naming `src/app/api/context-labels/route.test.ts`,
  which moved to the company overlay on 2026-08-17; Vitest ignored the stale
  filter and ran three of the four files. Eight mutations, all killed:
  an unclassified command, `theme:check` unrouted from the floor, a stale
  entry, the spine gate without `src/app/layout.tsx`, the rail gate without
  its own script, a manual entry with no reason, a false gate claim, and a
  Vitest subset naming a moved file. The projected public tree omits
  company-only commands, so it keeps only the classification check.

  **The spine gate after `7f29f131`.** Not waived: that landing's only waiver
  was `eval:roadmap:rail`. The gate asserts the `Agent` and `Fleet` document
  titles, whose template lives in `src/app/layout.tsx`, and its
  match set did not name that file, so the landing was never asked for it.
  That is the fourth instance of the BUG-058 pattern (a gate's map is written
  from the surface it is about; its script asserts more). Two parts are now
  mechanical: a gate owns its own script (ten did not), and a gate owns every
  repository source file its script names (`d5549be8` had written
  `src/app/layout.tsx` into the spine eval's comment; Grok's
  `grok-paths.ts` was named by the agent-sources eval). The titles' owners
  `src/app/workspace/page.tsx` and `src/app/fleet/spatial/layout.tsx` joined
  too.

  **BUG-210, `eval:roadmap:rail`.** Product, not eval. Reproduced on a
  detached `origin/master` worktree, then timed: after Start the declared tab
  stayed `draft` for about ten seconds inside the eval against half a second
  in a fresh app, and a declared link exists only for a live tab. `pty:create`
  reads the launch-scope registry, served for five minutes only while every
  source is settled; Qwen Code (landed that morning) is installed and signed
  out on the operator's machine, so the window stayed at five seconds and
  every Start after that paid a full probe of all five harnesses (5.7 to
  6.6 s measured, more under load). The gate had passed at 01:56 UTC that day,
  before Qwen landed, and was then waived by hand. The gate now answers for
  the launched source from its own fresh live `ready` fact; anything else takes
  the whole-registry path unchanged. The unchanged eval passed twice at load
  23 and 65, then the eval was changed to wait for the live Session instead of
  1.5 s, and passed twice more. Its surface gains the launcher's roadmap
  control, the declared-link projection and its script.

- 2026-09-24, BUG-218: the two renderer tests the floor flagged as suspected
  flakes at load 35.9 (`privacy-settings`, `session-state-tile-study`) spent
  their time in jsdom's style engine, not in their own logic. A CPU profile of
  the tile study put 46% of it in `getComputedStyle` and 29% in building
  css-tree errors. jsdom 27.2's `cssstyle` 5.3.3 re-validates every declaration
  through css-tree on every style write and every `getComputedStyle`, with no
  memo, and tries a shorthand such as `background: rgba(...)` against each
  longhand. Each miss builds a `SyntaxMatchError` whose stack css-tree formats
  at once (`Object.assign` reads its `stack` getter), through Vitest's
  source-mapping `prepareStackTrace`: one study render and one role query
  raised 439 of them. Role queries (a visibility check per candidate and per
  ancestor) and `toBeVisible` (per ancestor) call `getComputedStyle` hundreds
  of times per test, so assertions paid as much as renders. Import graphs,
  `waitFor` polling and real timers were measured and were not the cost.
  Two fixes. (1) A lockfile-only update inside the declared `^27.2.0`: jsdom
  27.4.0, whose `cssstyle` 5.3.7 memoizes validation and parsing, and css-tree
  3.2.1; `package.json` is unchanged. Across the 880 DOM tests, interleaved
  runs put the median test at 0.83x its old time. (2) Two tests walked a
  contract list inside one timeout: the Privacy disclosure test (8 controls, 5
  visibility checks each) and the Connect voice test (8 walks through the
  dialog; it also timed out at 5.6 s in a full-suite run during this work).
  Each is now one test per item, so a failure names the control or failure
  class; mutation-checked (a hidden disclosure on one control, an em dash in
  one failure headline: each fails exactly its own case). Measured with 12
  concurrent copies of the three files at load 13 to 93, before and after:
  the Privacy disclosure test timed out in 21 of 24 runs, and its slowest case
  now takes 1.3 s; the Connect voice test timed out in 23 of 24, now 0.4 s a
  case; the tile study's slowest went from 4.1 s to 2.0 s; zero failures in 24
  runs. Alone (one worker, interleaved): Privacy 566 ms to 310 ms for the
  first case and 53 to 78 ms for the rest; Connect voice 955 ms to at most
  131 ms; tile study 221, 169 and 376 ms to 147, 132 and 276 ms. The tile
  study's first test did not move alone (about 500 ms at load 13 to 50): the
  first test in every jsdom file also pays that file's cold start (JIT,
  jsdom's default stylesheet, the first render).
  Measured slowdown at load 30 was about 12x, so the margin that matters is
  about a tenth of the timeout, not 40%. No test in two full-suite runs
  exceeded 40% of its timeout; 24 exceeded 500 ms, led by
  `agent-source-registry-cache` (real shell probes, 1.7 s),
  `demo-workspace-client` W6 (1.4 s), the goal-visuals bench (21 tiles for one
  assertion, 1.3 s), `agent-source-registry`'s OpenCode seam probe (1.2 s),
  the gallery's keyswitch workbench (1.0 s), `settings-client`'s shortcut
  policy (1.0 s) and `launch-controls.launching`'s six-menu drafts walk
  (1.0 s). None shares the loop shape; they are listed, not changed. Proposed,
  not built: record per-test durations from the floor's Vitest checks in
  `metrics.jsonl` and report tests whose median passes a tenth of their
  timeout. A duration gate would flake by construction, and `scripts/` was
  being changed on another branch.

- 2026-09-24, BUG-205: the stacked landing, ticket 466 (`516dccb9`),
  showed that a head rebase re-ran the repository floor and never a declared
  surface gate, so gate evidence could describe a tree that never integrated.
  `surfaceGateRecheck` intersects each declared gate's `SURFACE_GATES` match
  set with `git diff --name-only <last verified base> <new base>`; an
  intersecting gate joins the head's rebase re-check (same environment,
  reserved slot), and the rest keep their pre-rebase evidence. Verdicts go to
  the landing output, a `gate_recheck` metric, the ticket's `gateRechecks`, and
  `gates=rerun:...,stood:...` on the status line. A re-run gate's failure
  appends the range and paths that forced it plus `EXA_BASE`, so a dev server
  that idled out while the ticket waited is named, not skipped. Replayed on
  466's real rebase (`8918c2a6..698c1e79`, 25 paths): of 13 declared gates,
  `eval:electron:connected-fleet`, `eval:electron:lifecycle`,
  `eval:workspace:chrome` and `eval:workspace:split` would have re-run
  (`workspace-client.tsx`, and for connected-fleet the gateway, preload and
  remote-agent files); nine stood. `scripts/gate-recheck.test.mjs` drives real
  queues: an upstream change on a declared gate's surface re-runs that gate at
  the head while another declared gate stands; an unrelated upstream change
  re-runs neither and reports both as stood; and a gate whose dev server went
  away while its ticket waited fails the ticket naming the gate and
  `EXA_BASE`. Six mutations, all killed.

- 2026-09-24, BUG-204: the fifth change reserves one machine slot for the
  queue head. Everyone behind the head waits on its rebase re-check, and in
  September the head waited for a slot in 9 of 36 rebases, 30 minutes in
  total, behind candidates' first checks. `acquireMachineSlot({ queueHead })`
  tries a reserved `-head` slot first and then the pool; no other caller can
  take the reserve, and with one head it adds at most one concurrent check.
  `runDeliveryChecks` passes it only for the head's rebase phase and now
  records `slotMode` and `slotWaitMs` on every `floor_check`, so the next
  measurement reads slot queues directly. `scripts/machine-slots.test.mjs`
  pins the reserve (a candidate waits, the head does not, a second head-priority
  request waits, a freed reserve stays closed to non-head work), and
  `scripts/queue-head-slot.test.mjs` drives a real queue with one pool slot
  held by a candidate's first check: the head rebases, re-checks with
  `slotMode: acquired` and integrates while a new candidate's floor is still
  waiting for the pool. Four mutations, all killed. Together the five changes
  close H19; `test:agent-delivery`, 52% of all check time, is the open lever
  if check time is ever what dominates.

- 2026-09-24, BUG-203: the fourth change makes the commonest conflict merge
  and the duplicate-id half impossible to create. 13 of the 20 September
  conflict deaths were two pure insertions at one spot in a log, and in 4 of
  them both sides had also taken the same id. The `exawatt-append` driver
  (`scripts/merge-append-docs.mjs` over `scripts/lib/append-merge.mjs`) lets
  `git merge-file` decide first and only acts on its conflicts: it takes each
  side's hunks from git's own `-U0` diff headers (content from the side's
  text, never the diff body), groups hunks that overlap or touch as git does,
  and resolves a group only when it is one pure insertion from each side at
  the same base position, master's first, and only when no BUG, FIX, D,
  incident or decision id is introduced by both sides anywhere in the file.
  Everything else keeps git's markers byte for byte and says why on stderr; a
  driver that fails falls back to `git merge-file`. `.gitattributes` scopes it
  to the roadmap, `docs/engineering/projects/*.md` and the incidents index.
  `agent:land` passes it by absolute path with `git -c` on the head rebase
  and on both probes, which read attributes from the target master with
  `--attr-source`; `pnpm hooks:install` (now `scripts/hooks-install.mjs`,
  run by `worktree:setup`) writes a relative form into the common config that
  falls back to `git merge-file` in a tree without the script. `pnpm id:next`
  (`scripts/lib/id-counter.mjs`) keeps `next-id.json` beside `next-ticket.json`
  under a short directory lock and allocates past the highest id on origin's
  master and on every queued attempt. Replayed over the 20 September conflicts
  in a scratch shared clone: 7 merge; 414, 415, 421 and 422 are refused on
  exactly their duplicate ids (incident `0021` twice, incident `0023` with
  BUG-141, BUG-141 and BUG-142); 381 stays a conflict because its third
  commit deletes a line at the anchor, which is not an append; 405 is in
  `scripts/`, outside the scope; the 7 real overlaps all still conflict. This
  branch's own rebase onto `8918c2a6` hit the case live, two findings above
  one anchor in this file, and the driver's result is byte-identical to the
  hand resolution. `scripts/append-merge.test.mjs` pins hunk parsing and id
  extraction, then proves on real rebases that same-anchor entries merge in
  order while a duplicate `BUG-n` and a real overlap keep their markers, that
  the probe reaches the same verdicts, that the installed command keeps markers
  where the driver is absent, that two queued tickets appending at one anchor
  both land while a third reusing an id is refused early, and that `id:next`
  allocates past master, a hand-picked id and a queued ticket, and hands eight
  concurrent callers eight distinct ids. Ten mutations, all killed.

- 2026-09-24, BUG-202: the third change asks the head's rebase question
  before the head does. 20 of the 38 September deaths were head rebase
  conflicts; those tickets spent 2.3 hours queued in total and died within a
  second of reaching the head. `scripts/lib/conflict-probe.mjs` replays a
  change's commits onto a given `master` with `git merge-tree --write-tree`,
  each against its own parent as the base and chaining the trees, the way
  `git rebase` applies them, so a commit that conflicts is caught even if a
  later one undoes it; it writes objects only, never the worktree, index or a
  ref. `agent:land` runs it before the candidate floor, where a conflict is
  refused with no ticket taken, and every `EXAWATT_AGENT_LAND_PROBE_SECONDS`
  (30) while the ticket waits, against origin's `master` read into the
  checkout's own `FETCH_HEAD` (`--refmap=`), so waiters never contend for the
  `origin/master` ref lock the head's fetch needs. A conflict fails the waiting
  ticket with `probeConflict` (base, first conflicting commit, paths) in its
  result and a `probe_conflict` metric. A probe that cannot run is announced
  and the head's rebase still decides. Replaying September's 20 conflicted
  tickets in a scratch shared clone against every `master` commit that landed
  while each waited: the probe reaches the head's verdict on all 20, would have
  failed them 2.2 of their 2.3 queued hours earlier (421 and 422 alone waited
  67 and 61 minutes), and 10 of the 20 already conflicted when their candidate
  floor began, 45 minutes of floor time that now never runs.
  `scripts/conflict-probe.test.mjs` pins the replay (commit-by-commit, nothing
  on disk touched) and drives a real queue: with the head held at the delivery
  lock, a waiter whose file master rewrote leaves as `failed` while the head is
  still `integrating`, a clean waiter keeps its place and both land; a change
  that already conflicts is refused before any floor check or admission; a
  zero interval turns the probe off. Six mutations, all killed.

- 2026-09-24, BUG-201: the second change turns the public latch from a
  death into a wait. 11 of the 38 September deaths were the latch, 10 on one
  night and 6 of those after a complete re-check, because the head met the
  latch inside its final critical section, after rebasing and re-running its
  floor, and failed with something its owner could not fix. The head now asks
  `checkPublicLatch` before any rebase: no public remote costs nothing,
  otherwise inside the delivery lock it honours a maintenance hold or repairs
  the pending catch-up of the integrated tip. A latch holds the head in
  `holdWhilePublicLatched` (`scripts/lib/queue-hold.mjs`), classified by
  BUG-197's `publicLatch` record rather than re-derived: a transient latch is
  retried on a doubling backoff, and a deterministic one is not re-projected
  on a timer but re-checked when the source lock, the maintenance hold, or
  `origin/master` moves, with a ten-minute backstop. The hold is bounded
  (120 minutes, `0` fails at once as before) and visible: `HOLD` with the full
  diagnosis, `STATUS held=public-latch:<m>` lines, a `hold` record on the
  ticket, and every waiter printing that the head is holding. Past the bound
  the ticket fails with `STATUS failed=public-latch` naming the commit, path,
  check and recovery, and its terminal result and `queue_terminal` metric carry
  the record. `scripts/queue-hold.test.mjs` pins the policy with a fake clock
  and drives two real queues with a public remote: a transient latch holds
  ticket 3 while ticket 4 reports it and keeps its place, and both integrate
  once the remote recovers, with no failed or resubmitted ticket; the
  2026-09-24 unrenderable-commit shape fails only past a 0.6-second bound with
  the latch in its terminal record, then, landed again, holds until the
  operator enables a maintenance hold and integrates with `public=held`. The
  four existing public-delivery tests that pin what a latch refuses run with a
  zero bound. Eight mutations, all killed.

- 2026-09-24, BUG-197: **a latched landing now names the commit that latched
  it, whether a retry can clear it, and the exact recovery.** Tickets 452 to
  456 were refused with "pending public projection catch-up did not publish;
  private master remains latched before the new candidate" and nothing else,
  and several sessions spent real time working out what it meant. The cause
  was a renderer refusal inside the catch-up's replay of `0cbcb226`, but
  `recordPublicProjectionFailure` recorded every failure that was not a
  non-fast-forward as `pending`, the state for a push that did not happen, so
  the source lock implied a retry would clear it and nothing named the commit.
  Now every renderer refusal carries its check (`markdown-seam`,
  `public-variant-directive`, `forbidden-reference`, and so on),
  `renderRecipeOutput` adds the path and recipe, and the projector adds the
  private commit whose blob refused (in `applyPublicCommitChanges` and
  `materializePublicSnapshot`, which between them cover replay, the tip,
  anchor verification and catch-up). A failure is `deterministic` only when
  that is proven, by a render refusal or a non-fast-forward, and `transient`
  otherwise. The refusal gives one fact per line: the commit, file and check;
  the failure class; for a deterministic failure the exact
  `pnpm open-source:catchup -- --source <origin/master> --expected-public-sha <public tip>`
  preview and a pointer to the operator-only execute step; and the renderer's
  own reason. The source-lock record (still `pending`, since the latch policy
  is unchanged) and the `public_projection` metric carry `failure` and
  `unrenderable`, and the thrown error carries the whole record as
  `publicLatch`, for the queue hold that will report it on `STATUS` and in the
  ticket's terminal metric. `public-delivery.test.mjs` builds tonight's shape
  in a fixture (one direct push that cannot render, a second that repairs the
  tree, then a normal landing) and asserts every field; each is
  mutation-verified.

- 2026-09-24, BUG-200 (landing-queue measurement, 89 September tickets):
  67% of landing wall time, 10.9 of 16.3 hours, went to tickets that then
  failed. 38 died: 20 on rebase conflicts, 11 on the public latch, 6 on a
  check failure after rebase, 1 dead owner. 20 of the 132 September `master`
  commits skipped the queue, and they caused 13 of the 38 deaths and every
  repeat rebase at the head; ticket 445's "attempt 4" was three direct pushes
  in 25 minutes while it held the head. Re-checks after a base move were only
  18% of check time (only the head re-checks, so compute is already O(N)),
  which rules out a merge train or scoped re-checks as the lever. The lever
  is deaths, so five changes land in order, one commit each. The first closes
  the side door. BUG-195 put the docs checks in front of a direct push, which
  kept bad docs out but let a good push move the base under the head, so
  `agent:land -- --docs` now carries documentation through the queue from any
  checkout with no worktree or setup. It refuses unless every changed path is
  Markdown or under `docs/`, runs `classifyDocsChecks` in parallel on the
  exact commit in a temporary detached checkout that borrows the invoking
  checkout's `node_modules`, admits a `lane: "docs"` ticket, and re-runs only
  the docs checks when it rebases at the head. The invoking checkout, often
  the shared `master`, is never rebased and never has to be clean; afterwards
  it moves by `git reset --keep`, which refuses rather than overwrite another
  session's edit. The pre-push hook now refuses every push to origin's
  `master` except the SHA `agent:land` states: its floor-verified final push
  or the operator-gated `--direct` path. `scripts/docs-lane.test.mjs` drives
  this tree's real `agent-land.mjs` and hook against a bare local origin: a
  direct docs or code push is refused and origin does not move; the lane
  lands a docs commit from a shared checkout holding another session's dirty
  and untracked files and leaves them intact; it rebases onto a moved master
  and re-runs the docs checks, not the full floor; and it refuses code and a
  failing docs check before taking a ticket.

- 2026-09-23, BUG-195: the docs-only in-place path to `master` is sanctioned
  so the operator's question is answered before any landing, and it ran no
  landing check at all. Three pushes on it broke things the floor would have
  refused: `e4b35dcf` and `23a6b2f8` wrote public-variant directives the
  projector rejects (BUG-131), and `0cbcb226` doubled one blank line before
  `### BUG-163`, so the public roadmap rendered with a seam, recipe-renderers
  failed eight subtests on master's own roadmap, and every queued landing
  failed its rebase checks until `594df51c`. The latency reason stands; the
  missing piece was a guard fast enough to sit in front of a push.
  `pnpm docs:check` runs the floor's own docs checks (`classifyDocsChecks`:
  recipe renderers, the roadmap contract, path classification, and the public
  content scan of the changed paths) in parallel and unslotted, about five
  seconds with the renderer test as the critical path. The versioned
  `.githooks/pre-push`, installed by `pnpm hooks:install` into the common
  config and re-asserted by `worktree:setup`, runs it on any push to origin's
  `master` that changes docs, and refuses it naming the failing check. It
  refuses before checking when the pushed commit is not the checkout or the
  checkout is dirty, since a pass over other files proves nothing.
  `agent:land` excuses exactly the SHA its floor verified, and `--direct` is
  not excused. `scripts/docs-check.test.mjs` pushes to a local bare remote
  through the real hook: the recreated `0cbcb226` seam is refused on
  `recipe-renderers` and the remote does not move, a clean roadmap edit
  passes, a push with no docs changes never starts the check, and a floor
  signal for a different SHA does not excuse the seam. Disabling the hook
  turns the seam test red.

- 2026-09-23, H18 follow-up (BUG-160): the first thing the delivery-script
  pins caught once BUG-136 put them in CI was a fixture more capable on the
  operator's machine than on the runner. A test committed in a clone of its
  fixture repository; the clone had no local identity, and git used the
  operator's global one or guessed his name from the account record. The
  runner has neither. The obvious local reproduction, an empty `HOME` with
  `GIT_CONFIG_GLOBAL=/dev/null`, still passed, because git's guess needs no
  config file. Only `user.useConfigOnly=true` reproduced it, and under that
  setting the unmodified suite failed exactly the one test CI failed. Identity
  was only the first case. Every test fixture could equally have depended on
  the host's default branch, signing, hooks path, push defaults, or global
  excludes. The repair is at the boundary rather than in the test: one
  helper, `scripts/lib/hermetic-git.mjs`, is the only way test code runs git.
  It reads no host config and never guesses an identity. A tripwire in
  `suite-environment.test.mjs` refuses a direct `git` spawn in any test or
  fixture module. Mutation-verified: restoring the original test file turns
  the tripwire red and names it, and dropping `useConfigOnly` or the global
  isolation from the helper turns its contract test red.

- 2026-09-13, H18: an audit of the checks every other change is judged by
  found five defects of one shape: the check reads as coverage and is not.
  The batch CI red since 2026-09-11 read as a content scanner that died
  silently; the scanner had passed and the production audit had failed,
  hidden because the gate echoed 1,558 paths as one 67 KB log line that
  `gh run view --log` cannot read past (BUG-135, incident `0022`). The
  delivery-script pins never ran in CI and the BUG-057 lint rule never ran on
  landing (BUG-136). Consumer-less exports had grown 13% since the August
  sweep with nothing refusing the next one (BUG-137, `pnpm exports:check`).
  Four dependencies had no importer. Two incident records shared one number.
  Every repair is a check, not a rule to remember: the roadmap entries name
  the test that pins each.

- 2026-08-20, H16: the Fleet study's post-integration dogfood request exposed
  that official local custody had been closed in prose but never in execution.
  The detached worker failed before build because `electron:install-dogfood`
  required an official artifact without declaring the `official` distribution
  profile. The documented bootstrap could not repair it: Vercel's SENSITIVE
  environment rows are deliberately non-readable after creation, so both
  `env pull` and the decrypted-value API withhold the contract. This was not a
  transient CLI failure and retrying `/dev/stdout` through a temporary file
  only made the real `[SENSITIVE]` result visible.

  The package command now declares the profile it requires, and the installer
  resolves it through the shared distribution-input boundary before package
  identity is selected; the first repaired worker caught that the installer's
  remaining direct env read still bypassed the file. Local bootstrap comes
  from the exact artifact already entrusted to the machine: the installed
  app is fully verified against the dogfood Developer ID Team, the one embedded
  canonical contract whose bytes equal `distribution.sha256` is selected, its
  Exawatt identity/update capability is pinned, and the value is atomically
  installed outside every worktree at mode 0600 without entering output. A
  fixture app proves seal mismatch refusal; a black-box process test proves an
  unsafe existing file is replaced with exact permissions. The live installer
  then recovered the current official schema-v1 app successfully. Incident
  `0017` and ENG-030 WP-C carry the corrected custody record.

- 2026-08-20, H17: H16's first end-to-end worker passed official custody and
  then failed in the immutable build snapshot before packaging: `pnpm install`
  linked `@exawatt/core` without creating its `dist-cjs` runtime, while
  `build-dogfood.mjs` tried to resolve the distribution contract before its
  later `electron:compile` step built that runtime. The build entrypoint now
  bootstraps core before distribution resolution, so manual, detached, and
  future callers share the same fresh-checkout invariant. A regression pin
  asserts the prerequisite precedes the resolver instead of merely asserting
  that both commands exist.

- 2026-08-18, BUG-090: the floor's named test failures were the machine's, not
  the author's, and it took six landing attempts and most of an evening to
  establish that once. `agent:land` selects `test:related` from the changed
  paths, and for a module the whole app imports — the distribution contract in
  `packages/core` is the worked example — that pulls a large `app-dom` set
  whose tests fail by TIMEOUT at five to seven seconds under load. Four concurrent worktrees is the documented normal state, and a sibling
  running `electron-builder` pushes the load average past 150. The failing
  identities changed between runs on identical code (six one run, eight the
  next, two different ones on a clean `origin/master` control), which is the
  proof that none of them was a defect. The damage was the misreport, not the
  delay: named failures read as "your change broke these", and a capable agent
  nearly went hunting in unrelated surfaces.

  The floor now runs the diagnostic `agent-delivery.md` already prescribed. A
  failed vitest check re-runs exactly the files it named, once, in a single
  worker (`pnpm test:alone`). Every file passing alone is `flaked`: the floor
  continues, and the flake is reported on the `STATUS` line, in the ticket
  evidence, and in `metrics.jsonl` with the file identities, the failing test
  names, and the load average at both runs, tallied per file so a genuine
  defect hiding behind flakiness — which returns to the SAME file while
  contention moves around — stays findable. Any file failing again fails the
  landing and is named separately from the ones that did not. A rerun that ran
  none of its files is inconclusive and the original failure stands; a failure
  naming no file is the first intermittent (a dead worker) and is not re-run;
  more than 25 failing files is a break, not contention.

  No timeout was raised, and the 25% worker cap is untouched: decision `0030`
  keeps the suite bounded, and a longer timeout makes every real failure slower
  to surface. A concurrency-aware admission gate was rejected on `0030`'s own
  arithmetic (it serializes expensive verification back into the critical path,
  and the evidence includes a landing that waited for load 12 and still failed);
  narrowing the `test:related` selection was rejected as weakening the floor for
  a machine condition, and belongs to ENG-039's module-owned verification;
  quarantining the `app-dom` files was rejected because their identities are not
  stable, so there is nothing to quarantine but the coverage itself.

- 2026-08-16, the operator's 90% Actions alert proved H7 had implemented only
  cancellation, not the batching its accepted contract already required. The
  month held 336 Exawatt CI runs and three macOS releases; 96 runs were
  cancelled, but GitHub still rounds each started job up to a whole minute.
  Exawatt accounted for $10.508 of the Full-Vibe organization's $12.302 gross
  Actions usage, and the latest 67-run landing burst alone consumed 289 Linux
  minutes despite 57 cancellations. The release workflow was not the owner:
  its three deliberate macOS runs accounted for 22 minutes / $1.364.

  H7's missing half now exists. `master` no longer triggers hosted CI. Every
  normal `agent:land` integration replaces one common-Git-dir request, and a
  detached worker advances `refs/heads/ci-batches/master` to the newest
  integrated SHA only after queue drain, a 60-second quiet window, and a
  two-hour minimum paid-dispatch interval. At the measured four-to-six-minute
  duration this bounds automatic CI to twelve runs per day, while PR and
  manual runs remain available. Same-ref cancellation stays as the last race
  guard, not the batching mechanism. Local exact-tree checks remain merge
  authority; hosted Linux remains delayed composition evidence. H7 still owes
  ten consecutive green completed batches and H11 still owns the 30-landing
  cost/verdict window.

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

- 2026-08-16, ENG-030 D6 narrowed H4's environment fallback for the public
  repository boundary. Environment hydration is now an optional setup stage:
  an unlinked checkout says it is taking the community-safe no-op and never
  copies the main checkout's `.env.local`. Only a checkout with a local Vercel
  link attempts a pull, and only that linked context may fall back to its own
  permission-bounded last-good snapshot. Dependency installation, macOS
  signed-browser identity, node-pty readiness, and Electron compilation remain
  required stages. Hermetic setup tests pin both the optional paths and
  fail-visible required stages.

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
