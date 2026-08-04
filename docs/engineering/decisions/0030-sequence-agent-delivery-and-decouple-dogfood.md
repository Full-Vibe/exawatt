# 0030 Sequence agent delivery and decouple dogfood

Date: 2026-08-03
Status: accepted architectural direction; hosted queue authority requires an operator-approved trial

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

Keep the queue transport replaceable. The first hosted proof candidate is
Mergify because its current free tier includes the full merge queue for private
teams of up to five active contributors, whereas GitHub's native private-org
queue requires Enterprise Cloud. Mergify is not granted merge authority by
this decision: H7 must first restore a green CI baseline, then H8 runs it in
simulation while the internal shadow queue mirrors real submissions, and the
operator approves the GitHub App permissions before H10 begins. A
repository-local FIFO backend is the contract test double and fallback, not
the preferred permanent coordinator.

Retain an explicit operator-only guarded direct fast-forward path for incidents
and rollback. It is a recovery mechanism, not a second normal delivery path.

## Consequences

- Agents stop spending context on repeated wait/rebase/full-verify loops; a
  failed candidate reports once and the next queue entry proceeds.
- Pull requests may become normal machine-generated delivery envelopes even
  without human review. This is intentional traceability, not a return to a
  human approval bottleneck.
- GitHub Free cannot enforce branch protection for this private repository, so
  the trial initially relies on the repository contract to prevent ordinary
  direct pushes. GitHub Team is the smallest later upgrade that adds
  enforceable private-repo protection, but it still does not provide GitHub's
  native private-org merge queue.
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
  keep as a later hardening choice if the PR-backed trial proves valuable.
- **Permanent repository-local coordinator.** Viable while every writer shares
  one Mac, but makes Exawatt own recovery, status, and fairness infrastructure
  and does not extend naturally to remote agents.
- **Dogfood every integrated commit.** Rejected: installation is a latest-state
  artifact, and rebuilding intermediate master states adds latency without
  improving integration safety.
