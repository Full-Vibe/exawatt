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

## Ownership boundaries

- This item owns the agent development loop, not product behavior. Fold new
  agent-loop friction here rather than into product roadmap items.
- The harness refuses ambiguous conditions instead of guessing: a dev server
  whose `repoRoot` realpath differs from the tree under test is refused, and
  only an identity-less (older or production) server is tolerated, with a
  warning.
- Launch resilience is bounded to the one observed Playwright transient. A
  second failure surfaces rather than retrying into a loop.

## Findings log

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
