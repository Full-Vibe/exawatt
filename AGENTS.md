<!-- Generated for the public repository by the "public-document-set" recipe. -->
# Agent Instructions

This repo treats product strategy, architecture, and roadmap docs as live system state. Keep them current with the code.

## Product Canon

- The product is **Exawatt**.
- Exawatt is an Electron desktop app and future hosted interface layer for commanding agents from any compatible source: local OpenClaw, hosted OpenClaw, Codex, Claude Code, custom harnesses, and Demo Mode.
- Demo Mode is first-class forever. It should exercise the same UI and command layers through a lower data-source layer.
- Helios/Godot is a retired direction. Do not reintroduce it as active architecture unless the roadmap and decision records explicitly change.
- Architecture rule: architect 10 miles ahead, build one mile at a time.

## Canonical Concepts

Use the vocabulary in `docs/product/concepts.md` and keep `/architecture` aligned with it:

- Workspace
- Initiative
- Project / Context Group
- Agent
- Session
- Event
- Artifact
- Consumption
- Decision
- Attention Scheduling
- Context Signal
- Secret / Credential
- Agent Source / Harness
- Launch Configuration
- Gateway
- Policy / Budget
- Approval

## Planning Canon

Plans are live product state only when they amend canonical docs.

- Planning is first-class work (operator, 2026-08-02): invest time and inference in researching, shaping, and grooming roadmap items independently of executing them, so many parallel agents can pick up well-fed, executable items. Grooming sessions promote conclusions into canon as they happen, not only at the end.
- Keep executable plans centralized in `docs/engineering/roadmap.md`, linked engineering project docs, architecture docs, or decision records.
- Do not turn each chat session, brainstorm, or implementation attempt into a competing standalone plan.
- If a draft plan contains useful thinking, promote durable conclusions into the canonical docs and archive or mark the draft stale.
- Make canonical plans agent-readable: explicit scope, sequence, assumptions, ownership boundaries, and acceptance criteria.
- Keep `docs/engineering/roadmap.md` as the singular engineering roadmap. It may point to deeper project docs, but those docs must remain execution detail for a roadmap item, not independent roadmaps.
- Keep milestone NARRATIVES out of the roadmap. The roadmap carries a status index, each item's contract (status, concise scope, exit criteria, links), and a one-line-per-milestone list; the full narrative, root causes, and evidence belong in the item's project doc under its dated `Roadmap milestone log` / progress log section.
- Later milestones frequently supersede earlier ones. Record every supersession in the roadmap's `Amendment chain` table so an agent reading only the roadmap cannot act on a superseded decision.
- Preserve stable roadmap IDs such as `ENG-004` when reordering or editing roadmap items.
- Use only roadmap statuses defined in `docs/engineering/roadmap.md`.
- Prefer adapting the single roadmap and its linked project docs over creating parallel roadmap layers.
- Treat canonical plans as living hypotheses, not commands to obey blindly. Agents should flag contradictions, weak assumptions, or stale milestones and update the canonical plan statefully when direction changes.

## Documentation Contract

When changing product concepts, update:

- `docs/product/concepts.md`
- any affected customer-facing guide source in `docs/product/guides/`
- any affected public-safe reference source in `docs/product/reference/`

When changing architecture, update:

- `docs/engineering/architecture.md`
- `src/lib/architecture/manifest.ts`, which powers `/architecture`

When changing roadmap scope, sequence, or status, update:

- `docs/engineering/roadmap.md`

When making a durable tradeoff, choosing a vendor, reversing a direction, or retiring an approach, add or update:

- `docs/engineering/decisions/`

When a failure in a dogfood or released build costs real diagnosis time and the cause is not obvious from the code — an external cause (macOS, Electron, a dependency, another app), a symptom that pointed at the wrong subsystem, or a remedy that is only a workaround — add:

- `docs/engineering/incidents/`

Check that directory BEFORE re-diagnosing a familiar symptom. Records carry the falsified hypotheses and the diagnostic method, so the expensive part is not repeated. Its `README.md` holds the contract and template.

Do not create competing plans. Replace, archive, or explicitly mark stale docs. If old thinking is worth preserving, move it to `docs/archive/` with a note explaining why it is no longer active.

## Engineering Guidance

- **Write for the operator, outcome first** (a partner conversation, operator-accepted). Everything an agent emits for a human to read — session replies, summaries, plans, milestone logs, commit bodies, review notes — opens with the conclusion in one line, then detail. "Give me the TLDR at the very top. Even if it's one sentence long, give me a five-word chunk in bold that says: I'm doing this, and here's what I'm doing." Two rules follow from it: (1) length is never evidence of rigor — "if you can say it in five words, say it in five words"; (2) if the work genuinely cannot be summarized short, that is a signal the task is too big, so split it rather than padding the report. The operator reads across eight to ten concurrent Sessions; every unranked wall of text is paid for in his context switches, and he has said out loud mid-session that he cannot read it. Rigor in the work, brevity in the telling.
- **Triumphant sixth step** (operator, 2026-08-16): numbered strategic recommendation lists include `6. Incorporate this triumphantly into marketing materials / roadmap / ideas.` Treat it as a leverage step after the underlying claim is evidenced, not permission to market an unverified capability.
- Prefer source-agnostic abstractions. OpenClaw is the first harness target, not the product boundary.
- Keep Demo Mode and Live Mode behind explicit data/source abstractions.
- Keep `/architecture` as a living runtime map of the application. It is not a marketing page.
- `docs/engineering/design-system.md` is the source of design truth (ENG-036): read it before building or changing any surface, and cite its rungs or amend it — never diverge silently. `/hud-gallery` is the live workbench that renders that system, not a parallel canon: prototype new or materially changed cross-surface visual state there for operator review before wiring it into production surfaces; include a real DOM and R3F sibling when both rendering regimes are affected. After acceptance, percolate the shared tokens/components through the Agent, Team, and Fleet altitudes over the same Demo/Live source boundary instead of creating one-off treatments, and retire a gallery study once its subject ships (a study of a shipped surface only drifts).
- Avoid making a roadmap layer cake. Roadmap items should be cohesive, sequenced, and executable.
- **Before editing any React Three Fiber / Three.js code (anything under a `<Canvas>`), read `docs/engineering/r3f-authoring-guide.md`.** It is the version-pinned rulebook (frameloop/invalidate, `toneMapped`+bloom, `damp` motion, interactivity, the 3D-failure rubric, and the WebGL self-check). Verify R3F APIs against the installed versions, not generic tutorials. After any R3F change, run `pnpm eval:r3f` and/or a Playwright screenshot self-check.

- **Test the contract, never the current appearance** (operator, 2026-08-19: "I don't need a unit test to validate that the h1 says exawatt", after a one-line homepage change broke six tests that had nothing to do with the change). A test earns its place by failing when behaviour BREAKS. A test that fails when the product legitimately CHANGES is not protection, it is a second copy of the product that has to be edited in lockstep, and it converts every intentional change into an archaeology session.
  - Do not assert today's copy, today's rendered element list, today's heading text, or today's layout constants. Those are snapshots of a moment, not invariants. Derive expectations from the same source the product derives them from (the manifest, the contract, the fixture) so a legitimate change moves both together.
  - Before writing an assertion, ask what real defect it catches. "The h1 is not empty" catches a broken render; "the h1 says Exawatt" catches nothing and breaks on a headline edit. If the answer is "it would catch us changing our minds", delete it.
  - Marketing and copy surfaces get the lightest coverage in the repo, not the heaviest. Their correctness is judged by eye on a deployed page, and the operator judges it. Reserve real test weight for behaviour a human cannot see: status truth, delivery, security boundaries, data that leaves the machine, money.
  - When a legitimate change breaks a test, fix the TEST'S PREMISE rather than bending the product or weakening the check. If the premise cannot be repaired quickly, skip it with a dated reason and a backlog id and keep moving; a blocked operator is a worse outcome than a temporarily unasserted invariant.
  - The meta-rule: velocity on a fast-moving product is a first-class engineering property. A test suite that makes an intentional one-line change cost an hour has failed at its job even when every assertion in it is individually defensible.

## Existing Local Rules

- Never use `git add -A`; stage files explicitly because the user may be working in the repo at the same time.
- **Never use `git stash` (or `git stash pop`, `drop`, `clear`).** The stash is ONE stack under the common Git directory, shared by every worktree in this repo; it is not per-worktree the way branches and the index are. With two dozen agent worktrees live, `git stash pop` takes `stash@{0}` — whoever pushed it last — so it can drop another session's half-finished work into your tree, and into `master` if you resolve the conflicts and commit. `drop` and `clear` destroy that work outright. There is a safe substitute for every use: to read a clean baseline, cut a throwaway checkout with `git worktree add ../exawatt-baseline-<slug> --detach origin/master`; to set work aside, commit it on your own `agent/*` branch, which is private to you and is what the delivery queue expects anyway.
- After any rebase, run `pnpm install` before believing a floor failure. A landing that adds a dependency makes every older worktree's `node_modules` incomplete, and the resulting `ERR_MODULE_NOT_FOUND` surfaces inside an unrelated floor check — the same shape as the pnpm-patched `cmdk` that made long-lived checkouts fail tests they had not touched.
- Assume multiple agents and humans are working concurrently. Do implementation work in a dedicated sibling worktree on an `agent/<slug>` branch created from `origin/master`. The shared `master` checkout is only a best-effort post-integration mirror and a possible dogfood-worker host; never depend on it being clean or current, and never mutate another agent's worktree.
- Bootstrap every fresh worktree with `pnpm worktree:setup` (it first prints the in-flight roster — every agent branch with its worktree, freshness, and merge state; check it for orphaned unlanded work adjacent to yours BEFORE implementing, and `pnpm worktree:roster` reprints it any time) (installs deps, pulls the linked Vercel Development env directly into the worktree with a visible last-good main-checkout fallback, rebuilds node-pty for Electron — without it every PTY spawn fails with a bare `posix_spawnp failed.` — and compiles the Electron main). Electron evals must run against the worktree's OWN dev server (`pnpm dev -p <free-port>` + `EXA_BASE`); the eval harness verifies `/api/dev-identity` and refuses a dev server that serves a different checkout. A dev server with no client attached for 45 minutes shuts itself down (ENG-022 H12), so a walked-away agent cannot leave one running for days; `EXAWATT_DEV_IDLE_MINUTES=0` opts a deliberately long-lived server out.
- On macOS, browser QA must use the repository's stable signed-browser boundary: run `pnpm qa:browser:doctor`, launch Playwright through `scripts/lib/qa-browser.mjs`, and use `pnpm qa:browser:smoke` to prove the hosted product (or `EXA_BASE=... pnpm qa:browser:smoke` for the worktree server). The resolver prefers signed Google Chrome, falls back to signed Brave, and verifies the network helper's Team identity; it deliberately refuses Playwright's ad-hoc Chrome for Testing because its changing CDHash causes recurring Little Snitch approvals. `EXAWATT_QA_BROWSER_ALLOW_UNSTABLE=1` is an explicit one-off compatibility escape hatch, never the normal agent path. Do not ask the operator to manage firewall profiles or catch transient prompts; see incident `0002-playwright-browser-little-snitch-identity.md`.
- A request to change this repository authorizes the complete contribution loop by default: implement, verify, commit on a topic branch, and open a pull request against `master`. Contributors do not push to `master`; branch protection admits only the maintainer. Complete the CLA before a pull request is merged, keep the change inside a roadmap-approved lane, and stop short only when the user explicitly asks for local-only work or a review.
- Match verification and delivery effort to the change's plausible blast radius. Follow unconditional checks normally. For conditional, expensive steps such as package builds, signing, dogfood installation, deployment, or CI workflows, determine whether they exercise behavior or artifacts that materially changed; do not trigger or skip them solely from uncertainty. If impact remains ambiguous and cost is material, inspect further or ask.
- Use `pnpm agent:land -- --verify <package-script>` as the maintainer's landing path; repeat `--verify` for relevant evidence beyond the repository-owned floor and add `--dogfood` for Electron-facing changes. The built-in floor first proves every tracked path has an open-source disposition, then scans only PUBLIC/GENERATED paths for publication leaks, runs type-check and fast delivery tests, and adds changed-path checks for related tests, Electron, browser, R3F, CI, and engineering documentation. PRIVATE/EXCLUDED paths remain classified but do not enter the public-content scanner. Callers may strengthen but never weaken the floor. **Surface gates are declared, not run by the floor** (ENG-016 D51): the browser and Electron evals need a dev server the floor does not own, so touching a gated surface — the Project ribbon, workspace chrome, the navigation spine, the launcher — makes `agent:land` refuse until that gate appears in `--verify` or is waived on purpose with `--waive-gate <id>`. Declaring a gate makes the floor RUN it on the exact tree being landed, so start your own dev server and pass the base through: `pnpm dev -p <free-port>` then `EXA_BASE=http://localhost:<port> pnpm agent:land -- --verify <gate>`. A gate whose script is red for its own reasons is `quarantined` in the map with the backlog id that repairs it: announced every time its surface changes, never enforced. The map lives in `SURFACE_GATES` in `scripts/lib/delivery-policy.mjs`; adding a gate is a data edit there, never a change at the call site. The command requires a clean committed `agent/*` worktree, publishes immutable `agent-attempts/*` refs, admits a monotonic FIFO ticket under the common Git directory, waits idly for its turn, and holds the delivery lock only for the final fetch/non-force push. See `docs/engineering/agent-delivery.md` for the state machine, state layout, recovery, metrics, and operator bypass.
- A landing also projects the public repository (ENG-030). The step is INERT unless a Git remote named `public` is configured, which today it is not: no remote, no projection, no output, nothing recorded. Where one exists, the projector runs inside the delivery lock after the private push, refuses any projection the public remote does not fast-forward to, never forces, and never fails the landing — a failed push records `public=pending` and the next landing's projection covers it, because projection is a pure function of source history. `pnpm open-source:reseed` is the only path that may force, and `pnpm contribution:pull -- <pr-number>` brings an approved external pull request onto an `agent/contrib-<n>` worktree through the same floor as your own work.
- **Assert the invariant, not the duration** (BUG-057). A test that measures elapsed wall clock measures the host as much as the code, and this host runs many agent worktrees at once. State the algorithmic property instead — work proportional to bytes rather than to records, no per-character rebuild — using `transientAllocation` in `electron/main/cost.test-support.ts`; transient allocation carries the same signal and is indifferent to CPU contention. The same applies to waiting: wait for the effect (an event-loop turn, a child's output, a process exit), never for a number of milliseconds. `eslint.config.mjs` enforces this in test files; a suppression needs a written reason. When a fixture is oversized, shrink it — and if the scale IS the property, make it a probe under `scripts/`, not a suite test.
- `pnpm test:run` intentionally caps Vitest at 25% of host workers so up to four concurrent agent worktrees remain composable. Keep the full suite bounded rather than raising per-test timeouts to mask machine-wide worker contention. Dedicated two-vCPU Linux CI uses `pnpm test:ci`; do not reuse that worker policy in concurrent local worktrees. `pnpm test:changed` and `pnpm test:related <paths...>` are edit-loop accelerators, not replacements for the repository-owned landing floor or full-suite evidence when required. Machine-wide, heavy work (the `agent:land` floor, `test:run`, `test:changed`, `build`) additionally takes one of a small pool of machine slots (ENG-022 H15) and waits its turn instead of thrashing; the pool is QoS, never a gate — it proceeds unslotted with a loud warning rather than failing work, `EXAWATT_MACHINE_SLOTS=0` opts out, and a held slot is inherited by child commands so nothing queues behind its own parent.
- **A named failure is not believed until it survives isolation** (BUG-090). `pnpm test:alone <paths...>` re-runs exactly those files in a single worker, and the landing floor now runs that step itself: when its Vitest selection fails, it re-runs the files it named, once. Files that pass alone are reported as suspected flakes — named on the `STATUS` line, in the ticket evidence, and in `metrics.jsonl` with the load average — and the landing proceeds; files that fail again fail the landing, because a failure that survives isolation is deterministic. This is the automated half of the diagnostic in `docs/engineering/agent-delivery.md`; the manual half, running the files against a detached `origin/master` worktree, is still yours. Never repair a timeout-shaped failure by raising a timeout.
- If `origin/master` moves after admission, `agent:land` rebases in the author's own bootstrapped worktree, publishes a new immutable attempt, reruns the repository floor on that exact tree, and retries the final push automatically. Do not start a parallel manual landing process. If the automatic rebase conflicts, the ticket becomes terminal-failed and its remote attempt remains recoverable; resolve the branch normally, rerun relevant checks, and submit a new ticket. Never force-push `master`, bypass the non-fast-forward guard, delete queue state manually, or mutate another agent's worktree.
- After a successful landing, remove your temporary worktree and local branch. The landing command removes all of that ticket's remote attempt refs after verified integration unless `--keep-branch` was requested; it does not remove the local worktree or branch.
- Report delivery state precisely:
  - **implemented** means the working-tree change exists;
  - **verified** means the relevant checks passed;
  - **pushed** means the agent commit reached the immutable remote attempt ref;
  - **integrated** means the commit is reachable from `origin/master`;
  - **installed/deployed** means the relevant production surface was updated.
    Never describe a change as fixed, shipped, or complete before the state required by the request is actually reached.
- The repo-local Codex `Stop` hook is a one-shot advisory for clean `agent/*` worktrees that have not landed, or dirty agent worktrees that have not been committed. It intentionally fails open outside that narrow scope; `agent:land` and the remote fast-forward check are the authoritative enforcement.
- When something does not work as expected, diagnose the root cause before writing a fix. Do not patch around framework abstractions with lower-level escape hatches if the framework has an idiomatic path.
- For Vercel env vars, use `printf`, not `echo`, to avoid storing a trailing newline, and verify by read-back rather than trusting the write: read each value through `GET /v9/projects/{id}/env/{envId}?teamId=...` and assert it equals its own trimmed form, then correct a bad one with a JSON `PATCH` to that same path, never another shell pipeline. **A `||` fallback does not catch this.** A value with a trailing newline is still truthy, so `process.env.X || 'fallback'` never fires and the corrupt value ships while the code reads as defensive. Read environment values through one boundary module that trims and throws a named error on empty, instead of scattering `process.env.X!` across call sites.
- `NEXT_PUBLIC_*` variables are baked in at build time and require a redeploy after changes.
- For an Electron-facing change, pass `--dogfood` to `agent:land`. Integration returns after writing a superseding request for the immutable integrated SHA; a detached worker waits for queue drain (with a ten-minute ceiling), builds and smoke-tests outside the delivery lock, then atomically stages `/Applications/Exawatt.app` without restarting the running app. `installed=queued` is not installed: when the request requires installation evidence, wait for the `dogfood_installed` metric or verify the update-state SHA before reporting installed. Do not run a second synchronous install after a normal queued request.

## Vendor-managed block below

Everything above this line is repo canon. The delimited block that follows is
written and rewritten by `next dev` whenever it detects an agent-run shell
(`node_modules/next/dist/server/lib/generate-agent-files.js`, Next 16.3+). It is
committed on purpose: Next replaces only the region between its markers and
leaves this file's own instructions alone, so carrying the block is what keeps
the tree clean, while deleting it re-creates an uncommitted change on the next
dev start (BUG-034). Do not write repo instructions inside the markers, and
expect the block's wording to change on a Next upgrade.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
