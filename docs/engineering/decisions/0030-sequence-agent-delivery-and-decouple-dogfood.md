# 0030 Sequence agent delivery and decouple dogfood

Date: 2026-08-03
Status: accepted; local queue backend selected by operator 2026-08-03

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
2. **Gate:** one fair FIFO sequencer constructs the candidate on the latest
   accepted base and runs repository-owned policy on that exact tree. Only the
   sequencer mutates `master`. Begin with one candidate in flight and no
   batching; increase speculative width only after sustained green evidence.
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

The local backend stores monotonic tickets, a recoverable coordinator lease,
terminal results, and metrics under the common Git directory. It pushes the
immutable remote candidate branch before admission, reconstructs each ticket
on the latest accepted base in an isolated gate worktree, and advances `master`
only after the exact-tree policy passes. The elected coordinator is short-lived
and exits after queue drain; it is not a daemon. Waiting `agent:land` processes
may recover a stale coordinator and read the same durable result safely.

GitHub Actions remains an optional platform gate using only included Free-plan
minutes: for material candidates, the coordinator may push a disposable gate
ref and require a green Linux result for that identical SHA. The queue must
remain correct without paid minutes, and documentation-only changes do not run
the full hosted matrix. H7 owns usage measurement; projected exhaustion pauses
or explicitly reshapes the platform gate rather than purchasing an overage or
silently weakening required evidence.

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
- CI must be repaired and split into candidate/gate responsibilities before
  queue authority moves. A red post-merge suite is evidence, not a gate.
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
