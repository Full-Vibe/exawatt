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

Documentation alone takes the docs lane instead: commit it in whatever
checkout it was written in and run `pnpm agent:land -- --docs` (see "Docs lane
and the master push guard"). Nothing else may push to `master`.

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

Every floor run holds one machine slot while its checks execute (ENG-022
H15, `scripts/lib/machine-slots.mjs`): a small machine-wide pool bounds how
many floors, full test runs, and builds compute at once, so concurrent
worktrees queue briefly instead of inflating each other's check durations by
two orders of magnitude. The slot token is exported to child commands, making
nested heavy commands reentrant. The pool is QoS, never a gate — acquisition
failure or a 20-minute wait proceeds UNSLOTTED with a warning naming the
holders, dead holders are reclaimed by PID, and `EXAWATT_MACHINE_SLOTS=0`
disables the pool on a machine.

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

Since BUG-090 the floor says this itself. A vitest check that exits non-zero
and names no failing test file is reported as exactly that — an unhandled
error or a dead worker, which no rerun can narrow — and nothing is re-run for
it. The second intermittent below is the one the floor acts on.

## A second intermittent: named failures under machine load

Distinct from the one above, and the distinction is the diagnosis. That one
fails with NO failing test named. This one names several — typically
`launch-controls.*` and `hud-gallery/page.test.tsx` — and every named file
passes when run alone.

The cause is contention, not code. On 2026-08-17 a full `pnpm test:run`
reported five failures at a load average of 212–308, with two agents building
Electron and Next concurrently and 26 orphaned renderer servers alive
(BUG-070). Each named failure passed in isolation immediately afterwards.

**Control evidence, 2026-08-18.** A landing failed `test:related` with six
named `app-dom` failures. Re-running the SAME files on a detached clean
`origin/master` worktree, with none of the branch's changes, failed too — with
TWO DIFFERENT tests. Different failures from the same code on consecutive runs
is the proof that neither set is a real defect: a break is deterministic, and
these are not. The branch under test only changed an icon path.

So the diagnostic is two steps, and the second is the one that settles it:
re-run the named files alone, and if that is ambiguous, run them against a
detached `origin/master` worktree. A failure that reproduces on clean master
is not yours. A failure whose IDENTITY changes between runs is nobody's.

**The floor now runs the first step itself (BUG-090).** A failed vitest check
re-runs exactly the files it named, once, in a single worker
(`pnpm test:alone <files...>`, which is also the hand command for the manual
diagnostic). No timeout is raised anywhere; the rerun changes what the floor
BELIEVES about a failure, never how long a test may take.

| Rerun outcome                     | Floor result | What the author reads                                                                                                      |
| --------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| every named file passes alone     | `flaked`     | `SUSPECTED FLAKE`, the files, the failing test names, both load averages; the floor **continues** and the landing proceeds |
| any file fails again              | `failed`     | which files failed AGAIN in isolation (deterministic, and the author's), listed separately from the ones that did not      |
| the rerun ran none of those files | `failed`     | inconclusive; the original failure stands, because a rerun that matched nothing is not evidence of a flake                 |
| more than 25 files failed         | `failed`     | too wide for a targeted rerun; dozens of files failing at once is a break, not contention                                  |

A flake is reported, never swallowed: it appears in the check stream, in the
ticket's evidence, on the landing's `STATUS` line as `flaked=<check>:<n>`, and
in `metrics.jsonl` as a `floor_check` event with `status: "flaked"` carrying
the file identities, the failing test names, and the load average at the
failure and at the rerun. `summarizeDeliveryMetrics` tallies flakes per file,
because a real regression hiding behind flakiness returns to the SAME file
while contention moves around. Repeated flakes on one file are a defect to
chase, not noise to accept.

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

## Docs lane and the master push guard

Only `agent:land` moves origin's `master` (BUG-200). In September 20 of 132
`master` commits skipped the queue, most of them documentation pushed straight
from the shared checkout so an operator's answer would not wait for a landing.
They caused 13 of the 38 ticket deaths and every repeat rebase at the queue
head: ticket 445 held the head through three direct pushes in 25 minutes.
BUG-195's check-before-push kept bad docs out; it could not keep a good push
from moving the base out from under the head.

`pnpm agent:land -- --docs` is the fast path that replaced the push. Run it
from the checkout where the docs were committed, including the shared
`master`; it needs no agent worktree and no `worktree:setup`.

- It refuses unless every path changed since `origin/master` is Markdown or
  under `docs/`, and it takes no `--verify`, `--dogfood`, or `--waive-gate`.
- It opens a temporary detached checkout of the exact commit in the OS temp
  directory, borrowing the invoking checkout's `node_modules` through links,
  and does every git mutation there. The invoking checkout is never rebased
  and never has to be clean; other sessions' uncommitted edits in it are safe.
- It runs the docs checks from `classifyDocsChecks` (the recipe renderers, the
  roadmap contract when `docs/engineering/**` changed, path classification,
  and the public content scan of the changed paths), in parallel and without
  a machine slot, in about five to twenty seconds. They are recorded as
  `floor_check` events with `lane: "docs"`.
- It takes a queue ticket (`lane: "docs"`) and from then on is an ordinary
  ticket: it waits its turn, rebases at the head, re-runs the docs checks on
  the rebased tree, and pushes with the floor-verified SHA.
- After integration it moves the invoking checkout to the integrated commit
  with `git reset --keep`, only when that checkout still points at the landed
  commit. `--keep` refuses rather than overwrite an uncommitted edit; the
  landing then says so and leaves the checkout for its owner. The status line
  ends in `lane=docs`.

`pnpm docs:check` runs the same checks on the working tree, in about five
seconds, before a commit. Stage first: path classification reads the index.

The versioned hook `.githooks/pre-push` enforces the single writer.
`pnpm hooks:install` sets `core.hooksPath=.githooks` in the common Git config,
which covers the main checkout and every worktree; `worktree:setup` runs it,
so the setting re-asserts itself. A relative path means each checkout runs its
own tree's hook. Any push to origin's `master` is refused, docs or code, and
the refusal names both lanes. Two variables excuse exactly one SHA each:
`agent:land` sets `EXAWATT_AGENT_LAND_FLOOR_SHA` on its final push to the SHA
its floor just verified, and the operator-gated `--direct` path sets
`EXAWATT_AGENT_LAND_DIRECT_SHA` to the SHA it pushes. Deleting `master` is
refused too. Every push that does not target a master ref returns from the
shell before node starts. `git push --no-verify` is for the recovery path
only, such as a repair while the queue itself is broken; the ordinary answer
to a refusal is the docs lane or a worktree.

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
| Every candidate                                                                         | fail-closed path classification, public-bound content scan, `pnpm lint`, `pnpm type-check`, and `pnpm test:agent-delivery` |
| Changed JavaScript or TypeScript                                                        | the consumer-less export check (`pnpm exports:check`: a NEW export must have a consumer; existing ones are not counted), then the related Vitest selection, bounded to 25% workers, with one isolated rerun of any file it names failing |
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
├── next-id.json                  # `pnpm id:next` (BUG-203)
├── id-counter.lock/
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
   ↓         ↓ ↑    ↘ failed
   ↓   holding (public latch; bounded)
   ↘ failed (the conflict probe: the head's rebase would conflict)

dead owner → recovering → integrated (attempt already reached master)
                       ↘ failed (attempt ref preserved)
```

`holding` is not a separate status: the head stays `integrating`, its ticket
carries a `hold` record (`kind`, `since`, `failure`, `summary`) while it waits,
and the record is removed when the hold ends. See "Head-of-queue integration".

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

- It first asks whether public publication lets a private landing proceed
  (BUG-201), BEFORE any rebase or re-check. With no public remote this costs
  nothing. Otherwise, inside the delivery lock, it honours a maintenance hold
  or repairs a pending catch-up of the already-integrated private tip. If
  that is latched, the head **holds**; it does not fail. See "The public
  latch holds the queue" below.
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

### Same-anchor log insertions merge

13 of September's 20 conflict deaths were two pure insertions at the same spot
in an engineering log: two backlog entries, two findings, two incident index
lines. For an append-only log either order is right. In 4 of the 13 both
sides had also taken the same id, and that is a real conflict.

The `exawatt-append` merge driver (BUG-203, `scripts/merge-append-docs.mjs`
over `scripts/lib/append-merge.mjs`) resolves exactly that shape.
`.gitattributes` scopes it to `docs/engineering/roadmap.md`,
`docs/engineering/projects/*.md` and `docs/engineering/incidents/README.md`.

- git's own merge runs first; a clean result stands untouched.
- Otherwise every conflicting region must be one pure insertion from each
  side at the same base position, in git's own `-U0` diff (no base line
  edited or removed by either side). Both are kept, `master`'s first, then the
  ticket's; identical insertions are kept once.
- Neither side may introduce a BUG, FIX, D, incident or decision id the other
  side also introduces (present in its inserted lines, absent from the base).
- Anything else leaves git's conflict markers exactly as git wrote them, and
  the driver says why on stderr.

`agent:land` passes the driver explicitly (`git -c merge.exawatt-append.*`,
by absolute path to its own tree's script) on the head's rebase and on both
conflict probes; the probes read attributes from the `master` they replay
onto (`--attr-source`), as the rebase does. `pnpm hooks:install` (run by
`worktree:setup`) writes the same driver into the common git config for
manual rebases, as a relative command that falls back to `git merge-file`
when a tree predates the script, so a driver that cannot start never leaves a
conflict without markers.

Replayed over September's 20 conflict deaths: 7 now merge; the 4 duplicate-id
cases (incident `0021` twice, incident `0023` with BUG-141, BUG-141 and
BUG-142) still conflict, as they must; one pure insertion stays a conflict
because a later commit of that ticket deleted a line at the anchor; one was
in `scripts/`, outside the scope; all 7 real overlaps still conflict.

`pnpm id:next BUG|D|incident|decision [--count <n>]` removes the duplicate-id
half at the source. It allocates under the common git directory like
`next-ticket.json`: a short lock, then an atomic write of `next-id.json`. Each
id is at least one past the highest on origin's `master` (read into
`FETCH_HEAD`, never the shared ref) and in every attempt still in the queue,
so a missing or bypassed counter cannot hand out a taken id. The roadmap parse
test, which allows zero warnings, still refuses a duplicate backlog heading.

### Conflicts are found while a ticket waits

In September 20 of the 38 ticket deaths were head rebase conflicts; those
tickets spent 2.3 hours in the queue in total and then died within a second of
reaching the head. The verdict was knowable when the conflicting commit landed.

So the conflict probe (BUG-202, `scripts/lib/conflict-probe.mjs`) asks
earlier, with the head's own question:

- Before the candidate floor, against the `origin/master` just fetched. A
  change that already conflicts is refused with the paths named, before any
  check runs and without a ticket. 10 of September's 20 conflicted tickets
  were in this state when their floor started (45 minutes of floor time).
- While the ticket waits, every `EXAWATT_AGENT_LAND_PROBE_SECONDS` (30), it
  reads where origin's `master` is (a fetch into this checkout's own
  `FETCH_HEAD` only, so waiters never contend for the `origin/master` ref
  lock) and, when that moved, replays the ticket's admitted commits onto it.
  A conflict fails the ticket at once, naming the paths, the first conflicting
  commit and the base; the attempt ref is preserved. Replaying September's 20
  conflicted tickets, the probe reaches the head's verdict on every one and
  would have returned 2.2 of their 2.3 queued hours.

The replay is `git merge-tree --write-tree` per commit against that commit's
own parent, chaining the trees, the way `git rebase` applies them: a commit
that conflicts is caught even when a later commit would undo it. Nothing in
the worktree, index or any ref changes. A probe that cannot run (no network, a
git error) says so once and changes nothing: the head's real rebase still
decides. `EXAWATT_AGENT_LAND_PROBE_SECONDS=0` turns both probes off.

### The public latch holds the queue

ENG-030 keeps private `master` behind unpublished work: while the catch-up of
the integrated private tip cannot publish, no new private commit integrates.
That guarantee is unchanged. What changed is who pays for it. Before BUG-201
the head found the latch only after its rebase and full re-check, failed, and
sent its owner around again; the latch was 11 of September's 38 ticket
deaths, 10 of them on one night and 6 of those after a complete re-check, and
no owner could clear it.

Now the head holds, bounded and visible:

- It prints `HOLD ticket <n>` with the latch's own diagnosis (BUG-197's
  `publicLatch`: the private commit, file and check, the failure class, and
  for a deterministic latch the exact `open-source:catchup` preview), then a
  `STATUS held=public-latch:<m> bound=<m> <summary>` line every five minutes.
- Its ticket records the hold, and every waiter prints `queue head <n> is
  holding, not failing` with the same summary. Waiters keep their places.
- A `transient` latch (a push or network failure) is retried by the head on a
  doubling backoff from `EXAWATT_PUBLIC_LATCH_RETRY_SECONDS` (30) to five
  minutes. A `deterministic` latch (an unrenderable commit, a non-fast-forward,
  a stale maintenance hold, a reseed intent) is not re-run on a timer: the head
  re-checks when the source lock, the maintenance hold, or `origin/master`
  moves, which is what the operator's recovery changes, and every ten minutes
  as a backstop. Enabling the maintenance hold for a reviewed catch-up releases
  the queue at once, with `public=held`.
- On release it continues from the fetch and reports
  `held=public-latch:<m>` on its success line.
- Past `EXAWATT_PUBLIC_LATCH_HOLD_MINUTES` (120) it fails as it did before,
  printing `STATUS failed=public-latch` with the failure class, private commit,
  path, check and recovery preview, and the ticket's terminal result and
  `queue_terminal` metric carry the `publicLatch` record. `0` fails at once.

A latch that appears after the check, inside the final critical section,
returns the head to the hold instead of failing it.

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
- `flaked=<check>:<n>`: checks that failed and then passed when their named
  files ran alone. Absent when nothing flaked, so a clean landing reads exactly
  as it did before the rerun existed;
- `public=published|pending|refused`: what the public projection did. The field
  is absent entirely when no public remote is configured, which is the default;
- `held=public-latch:<m>`: how long the head held on a latched publication
  before it continued. Absent when it did not hold.

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

The batch runs lint, type-check, the Electron compile, the Vitest suite, the
delivery-script pins (`pnpm test:agent-delivery`, BUG-136), the whole-tree
publication gates, and the community build. **Read a red batch from the job
API, not from `gh run view --log`.** The CLI stops rendering a job log at the
first line longer than 64 KiB and drops everything after it without saying
so; a step whose log ends at a `> node …` echo with no error line is that
reader, not the process (incident `0022`).
`gh api repos/<owner>/<repo>/actions/jobs/<job-id>` names the failed step and
its duration, and `…/jobs/<job-id>/logs` is the complete log.

The runner has no global git configuration and its account has no name, so a
delivery-script fixture that leans on the operator's identity or git config
fails only there. Test code runs git through `scripts/lib/hermetic-git.mjs`,
which reads no host configuration and never guesses an identity, and
`suite-environment.test.mjs` refuses a direct `git` spawn (BUG-160). To
reproduce the runner locally, add `GIT_CONFIG_GLOBAL=/dev/null
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.useConfigOnly
GIT_CONFIG_VALUE_0=true` to the command. An empty `HOME` alone does not
reproduce it: git still guesses a name from the macOS account.

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
existed. A configured public remote participates in publication.

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
| `pending`   | the pair is recorded and the push did not happen (network, outage, missing dependency); a render refusal also records `pending`, marked `failure: deterministic` with the commit it could not render | transient: none, the next landing's projection fast-forwards past both; deterministic: reviewed catch-up |
| `refused`   | the projection does not descend from public `master`                                   | repair the deterministic projection; reviewed snapshot catch-up preserves existing history |

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

| Event                                                                                                         | Important fields                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `floor_check`                                                                                                 | candidate/ticket SHA, check ID, candidate/rebase phase, status (`passed`/`flaked`/`failed`), duration, and for a flake the file identities, failing test names, and load average at the failure and the rerun |
| `queue_admitted`                                                                                              | ticket ID/number and candidate SHA                                                                                                                                                                            |
| `stale_owner`                                                                                                 | ticket, live PID, heartbeat age; no takeover occurred                                                                                                                                                         |
| `stale_stop`                                                                                                  | prior and current bases before an automatic rebase                                                                                                                                                            |
| `queue_terminal`                                                                                              | status, queue wait, integrated SHA or failure/recovery detail                                                                                                                                                 |
| `integration_lock`                                                                                            | final critical-section duration                                                                                                                                                                               |
| `ci_batch_requested` / `ci_batch_started` / `ci_batch_superseded` / `ci_batch_dispatched` / `ci_batch_failed` | desired/dispatched SHA, sequence, freshness, supersession, or failure                                                                                                                                         |
| `dogfood_requested` / `dogfood_started` / `dogfood_superseded` / `dogfood_installed` / `dogfood_failed`       | desired SHA, sequence, freshness, supersession, or failure                                                                                                                                                    |
| `actions_run`                                                                                                 | run ID/SHA, conclusion, elapsed billable-minute evidence                                                                                                                                                      |
| `public_projection`                                                                                           | projection state, private/public SHA pair, duration, and when it did not publish the failure class (`deterministic`/`transient`) and the unrenderable private commit, file and check                         |
| `public_reseed`                                                                                               | deliberate non-fast-forward: SHA pair, replaced public tip, reason                                                                                                                                            |
| `probe_conflict`                                                                                              | `phase` (`candidate` before the floor, `queued` while waiting), ticket, the `origin/master` it replayed onto, the first conflicting commit, the paths, and for a queued ticket how long it had waited |
| `queue_hold` / `queue_hold_released`                                                                          | the head held on a latched publication: ticket, `failure` class and the `publicLatch` record; on release the `outcome` (`released`/`expired`) and `heldMs`. A failed ticket's `queue_terminal` carries `publicLatch` and `queueHold` |

`summarizeDeliveryMetrics` computes integrated and failed counts, queue p50/p95,
lock p95, stale-stop and floor-failure counts, suspected-flake counts with a
per-file tally, Actions minutes, and dogfood freshness p95. ENG-022 H11—not an individual successful landing—owns the
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

| Symptom                                                          | Safe response                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate verification fails before admission                    | Fix the root cause in the same worktree, commit, and run `agent:land` again. No ticket exists yet.                                                                                                                                                                |
| A rebase or probe prints `[exawatt-append] ... both sides introduce <id>` | Two changes took the same id. Renumber yours with `pnpm id:next <kind>`, update every reference, and land again. |
| A change or ticket reports `would conflict when rebased onto origin/master` | The conflict probe reached the head's verdict early: before the floor (no ticket was taken) or while the ticket waited (it is `failed` with `probeConflict` in its result). Rebase onto `origin/master`, resolve the named paths, re-verify, and land again. |
| Automatic rebase conflicts                                       | The rebase is aborted and the ticket is terminal `failed`. Fetch/rebase the author branch normally, resolve and verify it, commit if needed, then submit a new ticket. The failed attempt ref remains evidence.                                                   |
| Queue head has a live PID and stale heartbeat                    | Wait and inspect machine load/process health. Never delete its ticket or lock. If the operator establishes that it is irrecoverably wedged, terminate that exact PID; the next waiter will reconcile it.                                                          |
| Queue head owner is dead                                         | No manual mutation is needed. The next waiter/lander claims a new epoch, checks remote reachability, and records exactly one terminal result.                                                                                                                     |
| Process died during or after push                                | Start or continue another normal landing. Dead-head reconciliation treats the attempt as integrated only if fetch proves it reachable from `origin/master`; otherwise the attempt remains preserved.                                                              |
| Shared `master` is dirty or stale                                | Leave it alone. Remote integration is authoritative and already succeeded; clean/sync the shared checkout only when its owner can do so safely.                                                                                                                   |
| Attempt-ref cleanup warns after integration                      | First prove the attempt SHA is reachable from `origin/master`, then delete that exact remote `agent-attempts/*` ref. Never use a broad branch pattern.                                                                                                            |
| CI batch request remains after a failure                         | Inspect `ci_batch_failed`; a later normal landing restarts the detached worker. For urgent evidence, manually dispatch `CI` at `master`. Do not delete request or cadence state to manufacture a green signal.                                                    |
| Commits reach `master` without a ticket (a direct push from the shared checkout) | Do not revert. Record what the bypass skipped and let the next landing's whole-tree checks run over it. BUG-131 is the observed case (2026-09-13): two docs-only call-capture commits were pushed straight to `master`, wrote public-variant directives the projector rejects, and stalled publication for two days before a queued landing's renderer tests said so. Since BUG-200 the pre-push hook refuses every push to `master` that is not `agent:land`'s, and docs take `pnpm agent:land -- --docs`; `--no-verify`, a checkout whose tree predates the hook, or a machine without the hook still gets through. Only a server-side rule on `master` refuses the intent, and that is an operator decision. |
| A docs landing says it left the invoking checkout behind | The landing integrated. The checkout held an uncommitted edit that `git reset --keep` would have overwritten, or it gained commits during the wait. Commit or finish those edits, then `git reset --keep origin/master` (or rebase the new commits onto it). Never land the stale pre-rebase commits again. |
| Dogfood request remains after a failure                          | Inspect the `dogfood_failed` event and existing incident records. A later eligible request starts another worker. Do not delete the request to make the warning disappear.                                                                                        |
| A remote/multi-machine writer bypasses this common Git directory | Stop treating local FIFO order as global authority and evaluate decision `0030`'s sequencer contingency.                                                                                                                                                          |
| A landing reports `flaked=<check>:<n>`                           | Nothing blocking. The named files failed in a large selection and passed alone, which is contention. Read the file names: if `summarizeDeliveryMetrics`' per-file tally shows the SAME file flaking across landings, that is a defect to chase, not machine load. |
| A landing reports `public=pending`                               | Nothing. The private landing is integrated; the next landing's projection fast-forwards past both. Investigate only if it repeats, and read the reason in the source lock.                                                                                        |
| A landing reports `public=refused`                               | The projection no longer descends from public `master`. Diagnose classification/rendering first; use reviewed catch-up for a stale unrenderable backlog. Reserve reseed for separately reviewed historical erasure. Never force the public remote by hand.                                                         |
| The queue head prints `HOLD` / `STATUS held=public-latch` and waiters say it is holding | Nothing is failing; do not resubmit or cancel. A `transient` latch clears when the head's retry publishes. A `deterministic` latch is the operator's: start the reviewed recovery below; enabling its maintenance hold releases the queue at once, and the catch-up then publishes what is owed. The hold ends by itself after `EXAWATT_PUBLIC_LATCH_HOLD_MINUTES`. |
| A landing is refused: `public catch-up refused deterministically` | This is a head that held to its bound (`STATUS failed=public-latch`), or ran with `EXAWATT_PUBLIC_LATCH_HOLD_MINUTES=0`. Do not retry; every retry refuses the same way. The refusal names the private commit, the file and the check that refused it, and prints the exact `pnpm open-source:catchup -- --source <sha> --expected-public-sha <sha>` preview. Run the preview; executing it is the operator-only step in "Reviewed public catch-up" below. A refusal marked `failure: transient` clears on a later landing; the same reason twice means it is not transient. |

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
  ownership fencing, terminal results, hold records, and dead-owner claims.
- `scripts/lib/queue-hold.mjs`: the head's bounded hold on a latched public
  publication, its failure classes, and its knobs.
- `scripts/lib/conflict-probe.mjs`: the in-memory rebase replay a candidate
  and a waiting ticket run against `origin/master`.
- `scripts/merge-append-docs.mjs`, `scripts/lib/append-merge.mjs`,
  `.gitattributes`, and `scripts/hooks-install.mjs`: the append-only docs
  merge driver, its scope, and its install.
- `scripts/id-next.mjs` and `scripts/lib/id-counter.mjs`: the id counter.
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
- `scripts/docs-check.mjs`, `scripts/lib/docs-check.mjs`,
  `scripts/lib/docs-lane.mjs`, and `.githooks/pre-push`: the docs subset of
  the floor, the docs lane's temporary checkout and invoking-checkout sync,
  and the pre-push guard that leaves `agent:land` the only writer of
  `master`.
- `scripts/agent-land.test.mjs`, `scripts/ci-batch.test.mjs`,
  `scripts/delivery-queue.test.mjs`, `scripts/delivery-policy.test.mjs`,
  `scripts/dogfood-queue.test.mjs`, `scripts/dogfood-delivery.test.mjs`,
  `scripts/public-delivery.test.mjs`, `scripts/contribution-pull.test.mjs`,
  `scripts/docs-check.test.mjs`, `scripts/docs-lane.test.mjs`,
  `scripts/queue-hold.test.mjs`, `scripts/conflict-probe.test.mjs`, and
  `scripts/append-merge.test.mjs` (with
  `scripts/lib/delivery-queue-fixture.mjs`, a real local queue):
  the regression and stress contract, collected by
  `pnpm test:agent-delivery`.
  <!-- exawatt:public-omit-begin the company delivery queue owns public-repository maintenance -->
  During reviewed public-repository maintenance, the shared checkout may carry a
  clone-local delivery hold. Inspect it with
  `pnpm open-source:maintenance -- status`; deliberate enable/clear operations
  also require `EXAWATT_PUBLIC_MAINTENANCE_ALLOW=1`, an exact public master SHA,
  and a written reason. A held landing reports `public=held`, advances only the
  private remote, and appends the exact owed private SHA. The hold is not a
  GitHub lock: it protects this delivery queue, not external writers or other
  advertised public refs.
  <!-- exawatt:public-omit-end -->

## Reviewed public catch-up

**Repair stale public source without rewriting its existing history.** Ordinary
publication now preflights per-commit projected trees before private integration.
A historical backlog that cannot render has one deliberate recovery command:
`pnpm open-source:catchup -- --source <full-source-sha> --expected-public-sha <full-public-sha>`.
The default persists a preview only. `--execute` requires the current integrated
source, an exact matching maintenance hold, full public-candidate certification,
and unchanged source/public tips at publication. It pushes the certified SHA
without force, reads it back, records the pair, then clears the hold. Commit the
returned private epoch payload through normal delivery and prove ordinary
publication resumes. The command does not delete branches or pull refs and does
not claim legacy metadata erasure. The ENG-030 project log owns current evidence.
