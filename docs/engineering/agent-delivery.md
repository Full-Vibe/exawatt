# Agent delivery operations

This is the operational reference for Exawatt's local multi-agent delivery
system. It documents what the current scripts do and how to operate or recover
them. Decision `0030` owns the architectural tradeoff; ENG-022's
[`agent-development-loop.md`](projects/agent-development-loop.md) owns the
milestones and measured rollout; the scripts and tests remain executable truth.

The system is deliberately local and lightweight. It coordinates worktrees
that share one Git common directory. It does not use pull requests, a hosted
merge queue, a database, a daemon, or paid GitHub features. Remote or
multi-machine writers are outside this backend's authority and trigger the
sequencer-contingency review in decision `0030`.

## Normal agent contract

1. Create an `agent/<slug>` sibling worktree from `origin/master` and run
   `pnpm worktree:setup` in that worktree.
2. Implement and verify proportionally to the change. Commit every intended
   file and leave the worktree clean.
3. Run `pnpm agent:land -- --verify <extra-script>`. Repeat `--verify` for
   relevant evidence not already selected by the repository floor. Add
   `--dogfood` for Electron-facing changes.
4. Leave the process running until it reports a terminal result. Waiting for a
   FIFO turn is idle and holds no delivery lock.
5. After verified integration, remove the temporary worktree and local branch.
   The command deletes the ticket's remote attempt refs by default.

`worktree:setup` has four required boundaries: dependency installation, the
signed-browser identity check on macOS, a node-pty rebuild when its Electron
binding is absent, and Electron main compilation. Any required boundary fails
the command visibly. Development environment hydration is intentionally
optional: an unlinked checkout prints a community-safe no-op and never copies
another checkout's `.env.local`; a linked checkout pulls through an available
Vercel CLI and may use that same linked checkout's `0600` last-good snapshot
when the CLI, access, network, or service is unavailable. This keeps a clean
public clone self-sufficient without taking away the operator's linked-worktree
convenience.

`--verify` strengthens the candidate evidence; it does not define the minimum
floor. The repository always owns that floor. `--keep-branch` retains immutable
attempt refs for diagnosis. `--direct` is an operator-only incident path, not a
second normal workflow.

## A known intermittent

`pnpm test:run` has exited non-zero three times across 2026-08-07..13 with
**no failing test named** — the summary line reported every test passing and
the process still failed — and passed on the very next run each time, plus
five consecutive clean runs when chased deliberately. Every occurrence was on
a machine also running a dev server and browser evals, which is exactly the
contention the 25% worker cap exists to bound, so the leading theory is a
worker timeout or teardown error rather than a flaky assertion.

Recorded rather than closed. If it recurs, capture the FULL output (not the
tail): a run that fails with no `×` line is an unhandled error or a dead
worker, and that distinction is the whole diagnosis.

## A second intermittent: named failures under machine load

Distinct from the one above, and the distinction is the diagnosis. That one
fails with NO failing test named. This one names several — typically
`launch-controls.*` and `hud-gallery/page.test.tsx` — and every named file
passes when run alone.

The cause is contention, not code. On 2026-08-17 a full `pnpm test:run`
reported five failures at a load average of 212–308, with two agents building
Electron and Next concurrently and 26 orphaned renderer servers alive
(BUG-070). Each named failure passed in isolation immediately afterwards.

Before "fixing" a red suite, check `uptime`. Above roughly 30, DOM tests are
timing the machine rather than the code. Re-run the named files alone; if they
pass, the suite result is contention and the correct action is to stop adding
load, not to edit tests. The cheap checks that stay honest under load are
`pnpm publication:check` and a targeted `pnpm test:related <paths>`.

## Surface gates

The repository owns 31 eval gates and the changed-path floor routes to one.
That is structural, not neglect: every browser and Electron eval needs a dev
server the floor does not own (`EXA_BASE`), so it cannot run them unattended.
The consequence was that the most motion-sensitive surfaces in the app could
change and land with no gate run at all, as long as the author forgot — and
forgetting was silent.

So the floor does not run these; it requires them to be **declared**.
`missingSurfaceGates` in `scripts/lib/delivery-policy.mjs` maps changed paths
to the gates they owe. `agent:land` refuses before any expensive work, naming
the gate, the files that triggered it, and the exact commands:

```text
pnpm dev -p <free-port>
EXA_BASE=http://localhost:<port> pnpm eval:workspace:ribbon:bench
pnpm agent:land -- --verify eval:workspace:ribbon:bench
```

A gate whose own script is red is `quarantined` in the map with the backlog
id that will repair it: announced on every landing that touches its surface,
never enforced. Deleting the entry instead would throw away the fact that the
surface owes evidence at all. The first routing pass quarantined two
(BUG-010, BUG-011) — both had been broken since D49 without anyone knowing,
which is the same disease one layer down. Both were repaired the same week
and are enforced again; nothing is quarantined today, and the mechanism
stays for the next red gate.

A gate that genuinely does not apply is waived on purpose with
`--waive-gate <id>`; both the refusal and the waiver append a metric
(`surface_gate_refused`, `surface_gate_waived`), so skipped evidence stays
visible instead of vanishing. Adding a gate is a data edit to `SURFACE_GATES`.

## Three-stage flow

| Stage     | Parallel or serialized               | Durable identity                                                        | Completion boundary                                                                                                   |
| --------- | ------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Candidate | Parallel in each author's worktree   | committed candidate SHA and immutable `refs/heads/agent-attempts/*` ref | candidate floor passes and a FIFO ticket is admitted                                                                  |
| Integrate | FIFO; only the head mutates `master` | ticket number, ownership epoch, current attempt SHA/ref                 | exact current attempt is reachable from `origin/master` and the ticket is terminal `integrated`                       |
| Post      | Detached and superseding             | newest requested integrated SHA                                         | hosted CI is dispatched for the latest eligible batch; requested Electron work separately records `dogfood_installed` |

The shared `master` checkout is not in the integration path. After a successful
remote push, `agent:land` fetches and fast-forwards it only when it is clean and
compatible. A dirty, absent, or stale shared checkout produces a warning and
cannot turn a successful remote integration into a failure.

## Candidate and repository-owned floor

`scripts/lib/delivery-policy.mjs` classifies paths changed from the candidate's
merge base. Checks run before admission and their result, duration, phase, and
candidate SHA enter both the ticket evidence and the JSONL metric stream.

| Condition                                                                               | Required check                                                                                                |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Every candidate                                                                         | fail-closed path classification, public-bound content scan, `pnpm type-check`, and `pnpm test:agent-delivery` |
| Changed JavaScript or TypeScript                                                        | related Vitest selection, bounded to 25% workers                                                              |
| `electron/**`, `packages/core/**`, Electron builder config, or Electron/dogfood scripts | `pnpm electron:compile`                                                                                       |
| Playwright or stable-browser boundary                                                   | `pnpm qa:browser:doctor`                                                                                      |
| Fleet spatial or R3F evaluation code                                                    | `pnpm eval:r3f`                                                                                               |
| `docs/engineering/**`                                                                   | canonical roadmap parser/link tests                                                                           |
| Each caller `--verify <script>`                                                         | that package script, once, as additional candidate evidence                                                   |

The command rejects an unknown extra script and forbids recursive delivery or
dogfood installation as verification scripts. Verification must not dirty the
worktree. Expensive checks may remain candidate-only evidence; when a base
moves, the exact-tree rerun is the repository classifier's complete current
floor, not the caller's arbitrary extra list.

After candidate checks, the lander creates a new immutable remote attempt ref.
It never force-updates published candidate history. A rebase creates a new SHA
and a new attempt ref, preserving the previous attempt for audit/recovery until
successful cleanup.

## Queue state and lifecycle

All worktrees in one clone resolve the same state root:

```text
<git-common-dir>/exawatt-delivery/
├── next-ticket.json
├── admission.lock/
├── queue/<ticket-id>.json
├── ticket-locks/<ticket-id>.lock/
├── metrics.jsonl
├── ci-batch-request.json          # present only while hosted evidence is owed
├── ci-batch-request.lock/
├── ci-batch-dispatch.json         # last paid dispatch for cadence control
├── ci-batch-worker.lock/
├── dogfood-request.json          # present only while work remains
├── dogfood-request.lock/
├── dogfood-worker.lock/
└── public-source-lock.jsonl     # present only once a public remote is configured
```

The short admission lock advances the counter before writing the ticket. A
crash may leave a harmless ticket-number gap but cannot allocate the same
number twice. Ticket writes use temporary-file rename; transitions are
serialized per ticket and compare the ownership token and epoch. Terminal
states are immutable.

Normal states are:

```text
queued → integrating → integrated
                    ↘ failed

dead owner → recovering → integrated (attempt already reached master)
                       ↘ failed (attempt ref preserved)
```

Every owner writes a heartbeat while its process is alive. A waiter may claim
the head only when the recorded PID is dead. Claiming increments the ownership
epoch and changes the token, fencing late writes from the prior owner. A live
PID with a heartbeat older than 60 seconds emits `stale_owner` and a warning but
is never automatically taken over; this machine has demonstrated multi-minute
healthy-process stalls under extreme load.

Dead-owner reconciliation fetches `origin/master` before deciding the terminal
result:

- if the ticket's current attempt is reachable, it records `integrated` exactly
  once, recreates its hosted-CI request, and recreates any requested dogfood
  work;
- otherwise it records `failed` and preserves the immutable attempt ref. It
  does not silently discard the code or guess how to integrate an abandoned
  worktree.

## Head-of-queue integration

When its ticket becomes head, the author process fetches `origin/master`.

- If the remote base is already an ancestor of `HEAD`, candidate evidence is
  evidence for the exact attempted tree.
- If not, the process rebases its own bootstrapped worktree. A conflict is
  aborted and becomes a terminal failure. A clean rebase gets a new immutable
  attempt ref and reruns the repository floor against the rebased tree.
- The process then acquires the repository delivery lock for only the final
  fetch, ancestor check, and non-force `HEAD:master` push.
- If another writer wins that final race, the lock is released and the same
  head ticket repeats the fetch/rebase/floor loop; the agent does not exit into
  a conversational retry cycle.
- If push output is ambiguous, the process fetches and checks attempt
  reachability before choosing a terminal result.

The delivery lock is a directory under the operating system's temporary
directory, keyed by a hash of the Git common directory. It is final-push mutual
exclusion, not queue order and not a dogfood lock. The remote's ordinary
non-fast-forward refusal remains the last race guard.

Success output distinguishes:

- `implemented=<sha>`: the original committed candidate;
- `verified=<checks>`: repository floor plus caller extras that passed;
- `pushed=<ref>`: the current immutable remote attempt identity;
- `integrated=<sha>`: the exact SHA now reachable from `origin/master`;
- `ci=queued|unsupported-remote|queue-failed`: whether the superseding hosted
  evidence request was accepted; it is not a hosted verdict;
- `installed=not-requested|queued|queue-failed`: post-integration request state,
  not proof that the app is already installed;
- `public=published|pending|refused`: what the public projection did. The field
  is absent entirely when no public remote is configured, which is the default.

## Batched hosted CI

Every normal GitHub-backed integration atomically replaces one CI request with
the newest integrated SHA and starts a detached consumer. It does **not** run a
hosted job from the `master` push. The worker waits until all three conditions
are true:

- the local delivery queue is drained;
- no newer integration has replaced the request for 60 seconds;
- the last paid dispatch is at least two hours old.

The two-hour floor is the budget boundary from ENG-022's measured arithmetic:
at the observed four-to-six-minute job duration it caps automatic dispatch at
twelve per day instead of the 78 landings observed on a peak day. There is no
maximum-wait escape hatch. A continuously busy queue may delay hosted evidence
because the exact local floor, not GitHub Actions, owns merge authority. An
urgent operator check remains available through the workflow's manual dispatch.

When eligible, the worker fetches current `origin/master` and advances the
ordinary fast-forward ref `refs/heads/ci-batches/master` to that exact SHA.
Only pushes to that ref, pull requests, and manual dispatch trigger
`.github/workflows/ci.yml`; ordinary `master` pushes do not. The workflow's
same-ref concurrency still cancels an obsolete batch if a later eligible batch
overtakes it. A branch ref is used instead of a GitHub API token so the worker
needs only the Git push authority `agent:land` already proves.

The request is removed only after the batch ref is current. A failed push emits
`ci_batch_failed` and leaves the request recoverable; the next normal landing
starts another worker. The guarded `--direct` recovery path intentionally
bypasses post work, so an operator using it must manually dispatch CI when
hosted evidence is required.

## Superseding dogfood

`--dogfood` runs after terminal integration. It verifies that the requested SHA
is an ancestor of `origin/master`, atomically replaces one request record, and
starts a short-lived detached worker. Repeated Electron landings update the
same record; they do not form an app-build backlog.

The worker begins when the delivery queue drains, or when the oldest pending
request reaches ten minutes. A worker lock prevents duplicate consumers. The
installer holds only the install-target lock, creates a detached Git snapshot
at the requested SHA, installs frozen dependencies, builds/signs the dogfood
artifact, runs packaged smoke, and verifies the recorded build SHA. Immediately
before staging and again before atomic replacement, it rereads the request. If
a newer SHA superseded the build, the stale artifact cannot replace the app and
the worker continues with the newer request.

Installation preserves the established safety boundary: stable Developer ID
Team and identifier, hardened runtime and timestamp checks, nested-code
verification, same-volume atomic exchange, deterministic interrupted-swap
recovery, and no automatic restart of the running app. The request is removed
only after successful installation; `dogfood_installed` records freshness. A
failure emits `dogfood_failed` and leaves the request recoverable for a later
worker.

For closeout requiring installation proof, check either the metric stream or
the machine-local update state and compare its `installedSha` to the requested
integrated SHA. A landing's `installed=queued` line alone is insufficient.

## Public projection

ENG-030's two-repository mechanism gives the landing one more step, and only
when a Git remote named `public` exists. **No such remote means no projection,
no output, and no state**: the landing is the landing it was before the step
existed. That is the configuration today.

When one is configured, the step runs after the private `master` push and
before the ticket closes, **inside the delivery lock** that already serializes
`master` pushes, so two landings cannot race the public remote. It projects
the exact integrated SHA with `scripts/lib/public-projection.mjs` (Gate A
decides what is public; recipes render the GENERATED variants), asserts the
public remote's `master` is an ancestor of the projection, pushes without
force, and appends the `{privateSha, publicSha}` pair to the source lock.

Three outcomes, and none of them fails the landing, because the private push
already succeeded and is the source of truth:

| Outcome     | Meaning                                                                                | Response                                                                                   |
| ----------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `published` | the public repository holds the projection of this exact private commit                | none; the report names what it did NOT receive (recipes with no renderer yet)              |
| `pending`   | the pair is recorded and the push did not happen (network, outage, missing dependency) | none; the next landing's projection fast-forwards past both                                |
| `refused`   | the projection does not descend from public `master`                                   | a manifest reclassified history; `pnpm open-source:reseed` is the only path that may force |

The source lock is `public-source-lock.jsonl` under the delivery state root,
not a tracked file: the projector runs after the private push, so a tracked
lock would need a commit after the landing — dirtying the landed tree and
demanding a projection of its own. It is provenance, not authority; the
mapping is recomputable, because projection is a pure function of source
history.

`pnpm open-source:reseed` is the deliberate non-fast-forward path. It requires
`EXAWATT_OPEN_SOURCE_ALLOW_RESEED=1`, the exact `--confirm reseed-public-history`
token, and a written `--reason`; it refuses when the projection would
fast-forward; it forces exactly once, leased against the tip it observed; and
it records the reason in the source lock.

`pnpm contribution:pull -- <pr-number>` is the inbound path. Public `master` is
never merged into by a human — that would end the fast-forward property — so an
approved pull request is fetched, refused unless its CLA check is green,
applied onto a fresh `agent/contrib-<n>` worktree with `git am --3way`, and
handed to the normal landing floor. `git am` preserves authorship, so the
contributor's own commit is what the projector publishes.

## Metrics and rollout verdict

`metrics.jsonl` is append-only schema version 1. Current event types are:

| Event                                                                                                         | Important fields                                                         |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `floor_check`                                                                                                 | candidate/ticket SHA, check ID, candidate/rebase phase, status, duration |
| `queue_admitted`                                                                                              | ticket ID/number and candidate SHA                                       |
| `stale_owner`                                                                                                 | ticket, live PID, heartbeat age; no takeover occurred                    |
| `stale_stop`                                                                                                  | prior and current bases before an automatic rebase                       |
| `queue_terminal`                                                                                              | status, queue wait, integrated SHA or failure/recovery detail            |
| `integration_lock`                                                                                            | final critical-section duration                                          |
| `ci_batch_requested` / `ci_batch_started` / `ci_batch_superseded` / `ci_batch_dispatched` / `ci_batch_failed` | desired/dispatched SHA, sequence, freshness, supersession, or failure    |
| `dogfood_requested` / `dogfood_started` / `dogfood_superseded` / `dogfood_installed` / `dogfood_failed`       | desired SHA, sequence, freshness, supersession, or failure               |
| `actions_run`                                                                                                 | run ID/SHA, conclusion, elapsed billable-minute evidence                 |
| `public_projection`                                                                                           | projection state, private/public SHA pair, duration                      |
| `public_reseed`                                                                                               | deliberate non-fast-forward: SHA pair, replaced public tip, reason       |

`summarizeDeliveryMetrics` computes integrated and failed counts, queue p50/p95,
lock p95, stale-stop and floor-failure counts, Actions minutes, and dogfood
freshness p95. ENG-022 H11—not an individual successful landing—owns the
30-landing verdict: zero exact-floor escapes, every completed queue-drain Linux
batch green, no stale-base conversational loops, p95 queue wait below three
minutes at comparable load, and lower Actions minutes per integrated commit.

Local delivery, CI batching, and dogfood code emit their events directly.
`actions_run` is appended by the measurement pass after a hosted run completes
because the machine-local queue is intentionally not a GitHub Actions
dependency. Its absence does not change merge authority, but it does mean the
H7/H11 cost sample is incomplete.

GitHub Actions is post-integration evidence, never merge authority. Same-ref
runs cancel obsolete in-progress work. A cancelled intermediate run is expected
during a burst; the completed run on the latest queue-drain SHA must be green.

## Recovery runbook

| Symptom                                                          | Safe response                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate verification fails before admission                    | Fix the root cause in the same worktree, commit, and run `agent:land` again. No ticket exists yet.                                                                                                              |
| Automatic rebase conflicts                                       | The rebase is aborted and the ticket is terminal `failed`. Fetch/rebase the author branch normally, resolve and verify it, commit if needed, then submit a new ticket. The failed attempt ref remains evidence. |
| Queue head has a live PID and stale heartbeat                    | Wait and inspect machine load/process health. Never delete its ticket or lock. If the operator establishes that it is irrecoverably wedged, terminate that exact PID; the next waiter will reconcile it.        |
| Queue head owner is dead                                         | No manual mutation is needed. The next waiter/lander claims a new epoch, checks remote reachability, and records exactly one terminal result.                                                                   |
| Process died during or after push                                | Start or continue another normal landing. Dead-head reconciliation treats the attempt as integrated only if fetch proves it reachable from `origin/master`; otherwise the attempt remains preserved.            |
| Shared `master` is dirty or stale                                | Leave it alone. Remote integration is authoritative and already succeeded; clean/sync the shared checkout only when its owner can do so safely.                                                                 |
| Attempt-ref cleanup warns after integration                      | First prove the attempt SHA is reachable from `origin/master`, then delete that exact remote `agent-attempts/*` ref. Never use a broad branch pattern.                                                          |
| CI batch request remains after a failure                         | Inspect `ci_batch_failed`; a later normal landing restarts the detached worker. For urgent evidence, manually dispatch `CI` at `master`. Do not delete request or cadence state to manufacture a green signal.  |
| Dogfood request remains after a failure                          | Inspect the `dogfood_failed` event and existing incident records. A later eligible request starts another worker. Do not delete the request to make the warning disappear.                                      |
| A remote/multi-machine writer bypasses this common Git directory | Stop treating local FIFO order as global authority and evaluate decision `0030`'s sequencer contingency.                                                                                                        |
| A landing reports `public=pending`                               | Nothing. The private landing is integrated; the next landing's projection fast-forwards past both. Investigate only if it repeats, and read the reason in the source lock.                                      |
| A landing reports `public=refused`                               | The projection no longer descends from public `master`. Establish which manifest change reclassified history, then run `pnpm open-source:reseed` with that reason. Never force the public remote by hand.       |

Do not hand-edit `next-ticket.json`, ticket files, ownership epochs, terminal
results, or request state during ordinary recovery. These are durable machine
state, not scratch files.

## Operator-only direct recovery

The guarded bypass is:

```sh
EXAWATT_AGENT_LAND_ALLOW_DIRECT=1 pnpm agent:land -- --direct
```

It still requires a clean committed `agent/*` worktree whose `HEAD` is a current
fast-forward of `origin/master`, and it still uses the final delivery lock and a
non-force push. It bypasses queue admission, repository-floor execution,
dogfood request handling, ticket metrics, and normal attempt cleanup. Use it
only for a diagnosed queue incident or explicit rollback—not to avoid waiting,
verification, or a live owner's ticket.

## Executable ownership

- `scripts/agent-land.mjs`: end-to-end candidate, queue wait, rebase, integrate,
  status, and post request orchestration.
- `scripts/lib/delivery-queue.mjs`: ticket allocation, atomic transitions,
  ownership fencing, terminal results, and dead-owner claims.
- `scripts/lib/delivery-policy.mjs`: changed-path floor and check evidence.
- `scripts/lib/delivery-state.mjs`: common-dir paths, atomic JSON, metrics, and
  rollup calculations.
- `scripts/lib/delivery-lock.mjs`: final integration and app-target directory
  locks.
- `scripts/lib/ci-batch.mjs` and `scripts/ci-batch-worker.mjs`:
  superseding CI request, queue-drain/cadence eligibility, and the dedicated
  remote batch ref.
- `scripts/lib/dogfood-queue.mjs`, `scripts/dogfood-worker.mjs`, and
  `scripts/install-dogfood.mjs`: superseding request, detached consumption, and
  verified atomic install.
- `scripts/lib/public-delivery.mjs`, `scripts/lib/public-projection.mjs`,
  `scripts/lib/public-source-lock.mjs`, and `scripts/open-source-reseed.mjs`:
  the outbound projection, its fast-forward refusal, the recorded SHA pairs,
  and the single deliberate force path.
- `scripts/contribution-pull.mjs`: the inbound contribution path and its CLA
  refusal.
- `scripts/agent-land.test.mjs`, `scripts/ci-batch.test.mjs`,
  `scripts/delivery-queue.test.mjs`, `scripts/delivery-policy.test.mjs`,
  `scripts/dogfood-queue.test.mjs`, `scripts/dogfood-delivery.test.mjs`,
  `scripts/public-delivery.test.mjs`, and `scripts/contribution-pull.test.mjs`:
  the regression and stress contract, collected by
  `pnpm test:agent-delivery`.
