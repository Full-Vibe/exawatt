# 0030 Sequence agent delivery and decouple dogfood

Date: 2026-08-03
Status: accepted; local queue backend selected by operator 2026-08-03; amended
2026-08-03 to a contention-first backend — the elected-coordinator sequencer
is retained as a measured contingency, not the first mile

## Context

Exawatt deliberately supports many agents working in parallel, but every
landing still asks its agent to verify against a moving `origin/master`, race
for a polling directory lock, and often build the Electron dogfood app while
holding that same lock. The safety guard works: it refuses a stale candidate.
At current concurrency, however, refusal has become the normal coordination
mechanism.

The 2026-08-03 ENG-022 audit found 182 successful landings and 90 stale-base
stops in the sampled roughly two-week log. The lock acquired out of order in
all 20 seven-waiter stress runs. Fifty-three paired dogfood lock intervals held
the critical section for about 2.5 hours, with a 2.2-minute median. GitHub CI
was entirely post-merge in the latest 100 runs and 87 of 98 completed runs were
red, consuming 576 Linux minutes on August 3.

This is not solved by asking agents to coordinate conversationally. A single
Git ref is ordered state: authorship can be decentralized, but mutation needs
one sequencer if exact composition is to be proven once.

## Decision

Adopt three independently recoverable delivery stages behind the existing
`pnpm agent:land` entrypoint.

1. **Candidate:** an agent verifies the repository-defined fast floor, pushes
   an immutable `agent/*` candidate, and submits it. Submission records queue
   position and may use a pull request as its durable status envelope; the
   submitting process does not own integration.
2. **Gate:** integration is FIFO and exact where it matters (amended
   2026-08-03). Tickets are served strictly in order; the `agent:land`
   process at the head of the queue integrates its own candidate on the
   latest accepted base, rerunning the repository floor on the exact tree
   only when the base moved since candidate verification. Only the head of
   the queue mutates `master`, and it holds the delivery lock for seconds.
3. **Post:** dogfood consumes integrated commits outside the delivery lock.
   Electron-facing requests coalesce to the newest useful snapshot when the
   queue drains, with a ten-minute maximum wait so a continuous queue cannot
   starve installation.

The repository owns the verification floor. A caller may request additional
checks but may not choose a weaker set. Verification evidence is attached to a
candidate identity and exact tree, rather than reported as an unstructured list
of scripts an agent happened to run.

Keep the queue transport replaceable, but build the first authoritative backend
locally. On 2026-08-03 the operator rejected buying queue infrastructure and
chose a lightweight owned coordinator over the same-day Mergify recommendation:
*"No I don't want to buy anything, we can build the lightweight infra we
need."* This rejects the hosted dependency as well as a paid GitHub upgrade;
Mergify's free tier does not change the selected direction.

The local backend (amended 2026-08-03) stores monotonic FIFO tickets,
ownership epochs, terminal results, and metrics under the common Git
directory, with compare-and-swap state transitions so every ticket reaches
exactly one terminal result. There is no coordinator: the head lander
integrates in its own bootstrapped worktree. When the base moved, it rebases
there, pushes a new lease-protected immutable attempt ref for its ticket,
runs the floor on that exact tree, and advances `master` with a non-force
push; the integrated SHA must equal the ticket's current pushed attempt.
Takeover of a head ticket requires a dead owner pid — a live pid with a
stale heartbeat is surfaced to the operator, never auto-taken, because this
machine has stalled healthy processes for minutes under load (load average
425, 2026-07-27). After any ambiguous push, the lander reconciles by
fetching and checking whether its attempt is reachable from `origin/master`
before recording a terminal result.

GitHub Actions is repaired, batched, post-integration evidence using only
included Free-plan minutes: a Linux run on the latest integrated `master`
with obsolete in-progress runs cancelled, never a per-candidate serial gate
and never a holder of merge authority in this plan. The queue must remain
correct without paid minutes. H7 owns usage measurement; projected
exhaustion pauses or explicitly reshapes the batch cadence rather than
purchasing an overage or silently weakening required evidence.

### Superseded first-mile backend — 2026-08-03, retained as contingency

The originally selected backend below is superseded by the same-day
amendment and is NOT the build target. It is retained because it is the
shape the ticket store grows into if the amendment's activation triggers
fire (see the Amendment section).

> The local backend stores monotonic tickets, a recoverable coordinator
> lease, terminal results, and metrics under the common Git directory. It
> pushes the immutable remote candidate branch before admission,
> reconstructs each ticket on the latest accepted base in an isolated gate
> worktree, and advances `master` only after the exact-tree policy passes.
> The elected coordinator is short-lived and exits after queue drain; it is
> not a daemon. Waiting `agent:land` processes may recover a stale
> coordinator and read the same durable result safely. Begin with one
> candidate in flight and no batching; increase speculative width only
> after sustained green evidence. For material candidates, the coordinator
> may push a disposable gate ref and require a green hosted Linux result
> for that identical SHA.

Retain an explicit operator-only guarded direct fast-forward path for incidents
and rollback. It is a recovery mechanism, not a second normal delivery path.

## Consequences

- Agents stop spending context on repeated wait/rebase/full-verify loops; a
  failed candidate reports once and the next queue entry proceeds.
- Pull requests are unnecessary for machine-only delivery. Immutable remote
  candidate branches plus local ticket/result records provide the traceability
  this first mile needs without adding a second operator inbox.
- GitHub Free cannot enforce branch protection for this private repository, so
  the repository contract prevents ordinary direct pushes and the remote's
  normal non-fast-forward refusal is the final race guard. This is an accepted
  machine-local limitation, not a reason to purchase Team.
- A local queue is authoritative only while all writers share the common Git
  directory. Remote/multi-machine writers require a future backend, but the
  candidate/gate/post contracts do not change.
- CI must be repaired to be usable evidence, but merge authority never
  depends on a hosted result in this plan. A red post-merge suite is
  evidence, not a gate, and a batched signal cannot pretend to cover every
  intermediate commit.
- Existing immutable build snapshots, atomic app replacement, stable signing,
  and stale-base refusal remain. The queue changes orchestration, not artifact
  integrity.
- A dogfood app can briefly trail the newest integrated commit during a burst;
  the queue-drain trigger and ten-minute ceiling make that lag explicit and
  bounded instead of making every integration wait roughly two minutes.

## Alternatives considered

- **Keep direct fast-forwards and add another post-fetch check.** Rejected as
  the primary design: it serializes more work after an unfair race and still
  makes every later agent rebase when an earlier one lands.
- **Use the current directory lock as the queue.** Rejected: it guarantees
  exclusion but not FIFO order or durable queue position, and currently spans
  an unrelated dogfood build.
- **GitHub native merge queue.** Architecturally suitable and operationally
  disproportionate on the current private-org Free plan because it requires
  Enterprise Cloud.
- **GitHub Team plus branch protection.** Useful enforcement, not a sequencer;
  rejected by the operator for this problem because the queue must not require
  a purchase.
- **Mergify.** Its free tier made it a plausible first recommendation, but the
  operator selected owned lightweight infrastructure and no hosted queue
  dependency. Rejected for the active plan.
- **Permanent always-on local daemon.** Rejected: an elected worker can recover,
  drain, and exit, avoiding another background service while all current
  writers already share one machine.
- **Dogfood every integrated commit.** Rejected: installation is a latest-state
  artifact, and rebuilding intermediate master states adds latency without
  improving integration safety.

## Amendment — 2026-08-03: contention-first backend

A same-day review checked the selected backend against the audit's own
arithmetic and reordered the mechanism. The decision's contracts are
unchanged: three stages, one serialized `master` mutation, a repository-owned
verification floor that callers cannot weaken, supersedent dogfood, and no
purchased or hosted dependency.

Two observations drove the amendment:

- The dominant measured cost is contention, not composition. Stale-base and
  dirty-checkout stops occurred 113 times in the sample against three
  observed composition failures (corrected 2026-08-03 from an initial count
  of two): the historical `rawTokens` type-check break, the `ExposeOverlay`
  goal-visual provider miss, and the roadmap parser own-corpus expectation.
  All three were catchable by cheap always-on checks run on the rebased
  tree — one by type-check, two by fast vitest — not only by an Electron or
  hosted Linux matrix.
- A width-one sequencer running the full policy matrix serializes more work
  through the critical path than the current design, where expensive
  verification runs in parallel outside the lock. At the audit's peak of 78
  landings in a day, even five serial gate minutes per candidate is 6.5 hours
  of queue, and per-candidate hosted gating is arithmetically impossible
  inside Free-plan minutes (about thirteen four-to-six-minute runs per day
  against 78 landings).

The amended first mile therefore:

1. removes dogfood from the delivery critical section first, not last — its
   builds dominated the 2.2-minute median lock hold, and without them a
   landing holds the lock for seconds, which is what makes every other stop
   rare
2. replaces the elected short-lived coordinator with a FIFO ticket queue
   under the common Git directory in which the lander at the head of the
   queue integrates its own candidate. Ticket state transitions are
   compare-and-swap with ownership epochs; a head ticket may be taken over
   by a waiter only when its owner pid is dead — a live pid with a stale
   heartbeat is surfaced, never auto-taken, on the load-average-425 evidence
   that this machine stalls healthy processes. The remote's non-fast-forward
   refusal remains the guard that makes a botched takeover a retry, never a
   wrong `master`, and an ambiguous push is reconciled against
   `origin/master` reachability before a terminal result is recorded
3. keeps exact-tree evidence but scopes it to the cheap repository floor,
   rerun at the head of the queue only when the base moved since the
   candidate's verification (generated route types, type-check, fast tests
   selected by changed-path policy); the author's expensive matrix is never
   rerun there. The rebase happens in the author's own bootstrapped worktree
   — the only checkout guaranteed clean and dependency-complete — and every
   push of the candidate is a new lease-protected immutable attempt ref, so
   published history is never rewritten and the integrated SHA always
   equals the ticket's current pushed attempt
4. takes the shared `master` checkout off the landing path entirely — it
   receives a best-effort non-blocking sync after integration — eliminating
   the audit's 23 dirty-checkout stops
5. treats hosted Linux CI as repaired, batched, post-integration evidence
   inside included minutes: a run on the latest integrated `master` with
   obsolete runs cancelled, never a per-candidate serial gate, and never a
   holder of merge authority in this plan

The elected-coordinator sequencer with an adaptive speculative window is
retained verbatim above as the measured contingency: the ticket store is
deliberately the backend seam it would consume. Its activation triggers are
(a) the 30-landing verdict milestone still showing stale-base loops, red
integrations, or a p95 queue wait above the declared bound, or (b) the
arrival of remote writers — operator 2026-08-03: all writers share this Mac
for now, remote writers eventually — which ends the local queue's authority.

Dogfood semantics confirmed by the operator 2026-08-03: keep the existing
stage-without-restart install. The app bundle is replaced atomically on disk,
the running instance keeps running, and the in-app notice offers a restart at
the operator's convenience. The detached coalesced installer changes when the
build runs, not what installation does.
