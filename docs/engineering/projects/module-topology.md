# Module-owned code and verification topology (ENG-039)

Execution detail for roadmap item ENG-039. The roadmap holds the contract;
this doc holds the narrative of each seam as it is adopted.

## Roadmap milestone log

### 2026-10-21 — module declarations and the module closure (M0, M1, M3 first mile)

**`modules.json` declares 13 modules owning 689 of 1,207 production source
files, `pnpm modules:check` holds every import to them, and a change inside a
module is checked by that module's own checks. On five representative
single-module edits the selected tests' median wall time is 1.8 s, against
5.3 s for today's related selection and 106 s for the full suite: 98% below
the full suite, where the exit criterion asks for 60%.** The operator,
2026-10-15: work within a module gets checked by that module's own checks,
and only under rare cases does the full suite or lint run.

The modules (environment; dependencies):

| Module | Owns | Env | Depends on | Source files / public |
| --- | --- | --- | --- | --- |
| `core` | `packages/core/` | node | | 114 / 108 |
| `ui-model` | `packages/ui-model/` | node | core | 12 / 11 |
| `shell` | `login-shell`, `harness-homes`, `harness-state-variables`, `harness-types` in `electron/main/pty/` | node | core | 4 / 4 |
| `harness-events` | `electron/main/harness-events/` | electron | core, shell | 10 / 9 |
| `bus-transports` | `electron/main/bus/transports/` | node | core, shell | 6 / 6 |
| `pty` | `electron/main/pty/`, `harness-events/turn-truth.ts` | electron | core, shell, harness-events, bus-transports | 38 / 24 |
| `bus` | `electron/main/bus/` | electron | core, shell, harness-events, bus-transports, pty | 11 / 1 |
| `roadmap` | `electron/main/roadmap/` | electron | core, pty | 9 / 2 |
| `consumption` | `electron/main/consumption/` | electron | core, shell, harness-events | 13 / 8 |
| `workspace` | `src/components/workspace/` | dom | core, ui-model | 114 / 40 |
| `fleet` | `src/components/fleet/` | dom | core, ui-model, workspace | 52 / 15 |
| `website` | `src/components/site/` | dom | core, ui-model, workspace, fleet | 69 / 36 |
| `delivery` | `scripts/`, `.githooks/` | node | core | 237 / 3 |

What the inventory found (M0):

- **The main-process directories were not a DAG.** `pty` and `bus` imported
  each other (the harness registry names each harness's bus transport; the
  bus IPC drives Sessions), and so did `pty` and `harness-events` (turn-truth
  wires the attention monitor; the Codex adapter starts its server through
  the login shell). The declarations follow the real seams without moving a
  file: `shell` is the kernel every main-process module that starts a
  harness shares, `bus-transports` is its own module under both `pty` and
  `bus`, and turn-truth, which composes `pty`'s monitor with
  `harness-events`' delegation, belongs to `pty`. A file may be owned outside
  its directory; the longest path entry wins. Moving those files to match is
  follow-up work, not a precondition.
- **Public surfaces are wide.** A module's surface is its entrypoints, what
  they re-export, and whatever an undeclared path imports. `core` re-exports
  nearly everything through its index (108 of 114 files), and `website` is
  half public because `/hud-gallery` studies import its internals. A change
  to a surface file keeps the whole checks, so narrowing a surface is what
  moves more changes onto the module path.
- **Six tests cross modules on purpose** (turn-truth through the renderer's
  status words, the launch verdict against the registry, two Codex adapter
  suites, a Session's Agent name against the bus directory, the scanner
  against core's fixtures) and are declared `integrationTests`.

Enforcement (M1): refused between declared modules (an import past an
entrypoint, a dependency not declared, a cycle, a `dom` or `electron` module
importing the other's environment, a manifest entry naming nothing); warned,
never refused, for undeclared paths, whose deep imports join the target's
public surface. Nine deep imports of five files from `/hud-gallery`, the
changelog and the guides landed while this was built; those files were
declared as entrypoints, so the check starts at zero warnings.

Selection (M3 first mile), in `classifyDeliveryPolicy` over
`scripts/lib/module-graph.mjs`:

- A change inside declared modules, off their surface: `lint:modules` (ESLint
  over the modules' paths), `type-check:modules` (the modules' files, their
  integration tests and the importers of every public file the change
  reaches), and `module-tests`: the module's tests the change reaches through
  its runtime imports, plus the contract and integration tests of dependent
  modules that reach the touched surface.
- Undeclared paths, surface files, a file that left the tree, the manifest and
  shared configuration keep `lint`, `type-check` and `vitest related`, plus the
  module closure. Dependencies, the Vitest configuration and setup and
  `src/test-support/**`, and every train, run the whole suite.

Measured 2026-10-21 on this machine at a one-minute load average of 37 to 57
(25% Vitest workers, the landing's own setting), the third of three passes:

| Edit (module) | Related today: wall, CPU, files | Module closure: wall, CPU, files |
| --- | --- | --- |
| `workspace-state/project-list.ts` (workspace) | 17.0 s, 43.5 s, 22 | 10.3 s, 27.4 s, 20 |
| `bands/fold-crossfade.ts` (website) | 5.1 s, 13.2 s, 4 | 1.3 s, 3.4 s, 3 |
| `spatial/direct/use-direct.ts` (fleet) | 5.7 s, 11.6 s, 1 | 1.8 s, 2.6 s, 1 |
| `bus/ledger.ts` (bus) | 4.7 s, 10.8 s, 3 | 1.3 s, 1.5 s, 2 |
| `pty/process-groups.ts` (pty) | 5.3 s, 13.3 s, 9 | 2.3 s, 5.0 s, 8 |
| median | 5.3 s, 13.2 s | 1.8 s, 3.4 s |

The full suite was 106 s wall and 282 CPU-seconds over 586 files. Against
`vitest related`'s own selection for the same edits, the module closure
missed no test inside the module; what it does not run is four tests of
undeclared paths past the module's edge (`/hud-gallery`'s page,
`/old`'s page, the Demo workspace client, the main command surface), which
the train and the CI batch still run. Most of the wall-time gain is
`vitest related` building its whole-repository graph on every run; the
closure names its files.

Lint and type-check for the same edits, at a load average of 14 to 38:
`lint:modules` took a median 3.0 s against 43.6 s for whole lint, and
`type-check:modules` 12.9 s against 19.5 s for a warm, incremental whole
program; the module type-check pays 6.5 s of distribution prepare and route
typegen before a compile that is not incremental, so incremental module
programs are the next lever there. Lint, type-check and tests together went
from a median 68 s to 18 s per single-module edit (74% less).

Found on the way: `session-launch-environment.test.ts` failed for any agent
running inside an Exawatt Session, because it read that Session's own bus
port. The app-node hermetic environment (BUG-298) now clears the bus and
Session variables too, as CI never has them.

What remains: shrink the widest surfaces (`core`'s index, `website`'s gallery
imports) so more changes take the module path; move `shell`, `bus-transports`
and turn-truth's files to match their modules; declare the rest of `src/`
(app routes, `src/lib`, the shared UI) and the rest of Electron main, so the
undeclared remainder (518 production files) stops defaulting to whole checks;
incremental type-check per module (`tsc --build`); and M4, the 30-landing
observation window with no escaped full-suite failure.

### 2026-10-21 — the merge train is first-class

**`pnpm agent:land -- --train <agent/branch...>` lands a front's packets as
one train: one stack, one run of the landing checks and gates, one push, one
dogfood build.** It replaces the coordinator's manual train of 2026-10-15.

- The cars are stacked in order with cherry-pick onto the latest
  `origin/master` in a fresh integration worktree. A textual conflict refuses
  before any check, naming both cars and the paths; a car whose local and
  pushed tips differ is refused.
- Every gate the stack's paths owe is declared for it, and the landing checks
  run once on the stacked tree, asking for the whole-repository checks
  (`wholeRepo`), which is where M3 keeps them.
- A red train is bisected by prefix in the same worktree, so a tree checked
  twice reuses its passes, and the first car whose addition turns it red is
  named. Nothing lands unless `--land-passing` is given, which lands the rest
  without it.
- One ticket records each car's commits, what was left out, every bisection
  step, and which integrated commit carries each car commit. One dogfood
  request follows when any car is Electron-facing.

Code: `scripts/lib/merge-train.mjs`, `scripts/agent-land.mjs`; contract:
`scripts/merge-train.test.mjs` (real local queue). Operations: "Merge trains"
in `docs/engineering/agent-delivery.md`. Landed `9032af94` and `18b94a36`.

### 2026-10-15 — M3 shaped: module-owned verification is the delivery architecture

From ENG-022's [delivery efficiency audit](agent-development-loop.md#delivery-efficiency-audit--2026-10-15)
and the operator's direction the same day: "the architectural solution to
this build mess is aggressive, smart modularization. Module boundaries are
clear and rigid and well-defined, and work within a module gets [checked] by
that module's [own checks]. Only under rare cases does 'the' full suite of
tests / linting run. Maybe even separate repos in the future if we need to
unclog delivery even further."

Recommendation: module-owned verification is the delivery architecture, and
ENG-022 builds its mechanisms rather than a parallel plan. Rigid module
boundaries with declared public contracts and dependencies; a landing runs the
checks of the modules it touches plus their dependents' contract tests; the
whole-repo suite, whole-repo lint and whole-program type-check run only in the
batched CI run, on a contract change, at a release, and once per merge-train
batch. Nothing a change inside a module is verified against gets weaker: the
module's own tests and its dependents' contract tests are the test-fix-test
loop, and the whole-repo checks still run before anything ships.
The delivery system is the first module and already works this way as of
today: its own suite runs on its own changes, and its dependency on core is
two declared entry points.

Supporting mechanisms, in order of yield:

1. **A merge train for the whole-repo checks.** The head takes every ready
   ticket (each already green on its own module checks in its author's
   worktree), composes them onto `master` in ticket order as one candidate
   tree, runs the whole-repo checks once, and lands all of them; on failure it
   bisects (GitHub merge queue and Bors both work this way). On 2026-10-15's
   volume the whole-repo checks left after ENG-022 H22 are about 720 minutes a
   day (lint 187, type-check 70, the delivery suite about 400, the community
   build 66); run once per batch of three, that is about 240, a further 480
   check-minutes a day, and the head's separate rebase re-check (139 minutes)
   folds into the batch run. Risks: a red batch costs a bisection (log2 n + 1
   runs) and delays every ticket in it, so the train needs the module checks to keep batches mostly green; and
   it trades the September finding (deaths, not re-checks, were the lever)
   only once deaths are rare, which is why it sits under module checks rather
   than ahead of them.

   First instance, the same evening. The operator: "I'm fine with
   dramatically cutting down repeat unit test / lint execution here because
   we'll get a chance to review everything at the end." The coordinator ran
   the front's packets as a manual train. Packets stop landing, push linear branches and report
   ready; the coordinator stacks them onto one integration branch, resolves the
   overlaps, lands once with every declared gate, and requests one dogfood build
   (`pnpm dogfood:request`). What it saves: the per-packet whole-repo checks,
   head re-checks, gate runs and dogfood builds become one of each per front.
   What it costs: a coordinator's hand on the stacking and the overlap
   resolution, every packet waiting for the slowest, and a red train that names
   the train rather than the packet. What `agent:land` needs to make it
   first-class rather than manual: a `--train <branches...>` mode that composes
   the branches in order onto `origin/master` in a temporary integration
   worktree (refusing a conflict with the branch named, as the probe does
   today), runs the required checks and the union of declared gates once on the
   stacked tree, lands every branch's commits linearly in one push under one
   ticket that records per-branch evidence, bisects a red result to name the
   branch that broke it, and writes one dogfood request when any branch is
   Electron-facing.
2. **A concurrency cap tied to load.** The slot pool releases a waiter
   unslotted after 20 minutes, which is when load runs away (5 of 8 unslotted
   suite runs failed). Cap `node --test` concurrency for the delivery suite
   the way Vitest is capped at 25%, and scale the slot count with the load
   average instead of a fixed three.
3. **Incremental type-check.** `tsc --build` with project references per
   module makes the whole-program check proportional to what changed; 70
   minutes a day today, more once module checks make it the remaining
   whole-program cost.
4. **One dev server per worktree pool for gates.** 241 eval minutes and 22
   restarts; worth doing only after the above.

Separate repositories are a later option, not a plan: the trigger is that,
with module-owned verification and the train in place, whole-repo checks
still exceed half of check compute or p95 queue wait exceeds ten minutes at
eight concurrent agents. The delivery tooling and `@exawatt/core` are the
first candidates, since their boundaries are now declared.

### 2026-09-24 — the renderer's workspace state is a composition root

**`use-workspace-state.ts` went from 3,718 lines to 518 and now composes 16
single-concern modules under `src/components/workspace/workspace-state/`,
with its exported API and its behaviour unchanged.** It owns the renderer's
workspace (tabs, Sessions, launch, Recently closed, persistence), every
landing that touched workspace behaviour edited it, and its rules could only
be reached by mounting the whole hook.

| Module | Lines | Owns |
| --- | --- | --- |
| `workspace-model.ts` | 542 | tab and Project types, lifecycle predicates, id minting, the draft, reopened and PTY-adopted tab constructors, the runtime-adoption patch |
| `persisted-layout.ts` | 424 | every on-disk layout shape (v1 to v7) and the one upgrading reader |
| `layout-restore.ts` | 424 | a saved layout matched to live PTYs, the Session-keyed store seeds and the events that raced them, provider-identity reconciliation |
| `layout-serialize.ts` | 209 | the v7 record, the shutdown checkpoint's parked set, late provider identities |
| `project-list.ts` | 429 | every Project-list transition as `(projects, ...) => projects` |
| `recent-projects.ts` | 92 | Project recency and the one ledger that holds it |
| `session-operations.ts` | 77 | resume, model change and pause in flight, and the exits that beat their replies |
| `use-workspace-hydration.ts` | 391 | the mount effect: load, restore, seed, the PTY event stream, load-failure retry |
| `use-workspace-persistence.ts` | 139 | the debounced save, the unmount flush, the shutdown checkpoint |
| `use-workspace-projects.ts` | 404 | opening, importing and closing Project groups; registry identity |
| `use-session-launch.ts` | 522 | the ⌘T draft, launch, launch-here, Clone |
| `use-recently-closed.ts` | 304 | the close grammar and both halves of the soft-close ledger |
| `use-session-runtime.ts` | 311 | resume (one, a Project, all), model change, Project pause |
| `use-workspace-navigation.ts` | 248 | selection through `moveOperator`, the ring, ordinals, the split pin, arrangement |
| `use-workspace-requests.ts` | 111 | ⌘K requests and their replay once the layout loads |
| `use-attention-focus.ts` | 60 | the attention focus contract (S1) |

The first seven are pure and unit-tested directly: 69 new tests. The
restore suite was mutation-checked (a claimed PTY left unclaimed, a race
guard dropped, the interrupted-run test inverted each fail it). The hooks are
the effectful half; the entry point declares the state and the Session-keyed
stores, calls the hooks, and returns the same object it always did.

**How "no behaviour change" is held.**

- Moves are verbatim. A script compared every moved `useCallback` body with
  master's; the only differences are the ledger's four calls and dependency
  arrays that now name the stable values passed in.
- Effect order is unchanged. Each hook is called where its effects were
  declared, so passive and layout effects run in the original order.
- No effect subscribes more often. Everything passed between hooks is a
  setter, a ref, or a callback over them, so each identity is stable, as it
  was when they shared one closure.
- The API is identical. A type-level check asserted the hook's return type,
  its parameters, its value exports and all 18 exported types equal master's.

**Explicit values, not shared refs.** A hook reads the layout and the stores
through read-only `Latest<T>` views. The only writable refs passed are to
their one writer: observed identities to hydration, shutdown targets to
persistence. Two refs written from three places, the busy tabs and the exits
that raced a reply, became the `SessionOperations` ledger. Project recency,
written by the load, every save and a Project close, became `RecentProjects`.

**Guards that moved with it.** Hydration's hand-rolled `let cancelled` is a
`useLatestRequest` ticket and its ratchet entry is gone. BUG-037's
declaration guard in `session-scope.test.tsx` now reflects over every module
under `workspace-state/`, not only the hook; a raw `useRef(new Map())` in one
of them fails it.

**Evidence in the real app**, headless on the worktree's dev server through
`withElectronApp`: a throwaway probe opened three Agent tabs (two through
⌘T), closed one into Recently closed, reopened it with ⌘⇧T as a stopped tab
on the same durable Session, restarted the app, and found all three tabs
restored in order with the operator's position and nothing spawned, then
launched from ⌘T again (12 checks). `eval:electron:project-agent`,
`eval:electron:recents`, `eval:electron:project-pause`,
`eval:electron:model-change`, `eval:electron:clone-context`,
`eval:workspace:split` and `eval:workspace:draft` pass. The last two each
failed once under a load average near 37 and passed on rerun, as they did
with master's hook swapped back in: the split eval presses ⌘⌥T as soon as
the stage mounts rather than once the layout is ready, and the draft eval
counts a paste in a shell whose line editor can redraw it.

**Not done.** `use-workspace-state.ts` and `workspace-state/` route to no
surface gate in `SURFACE_GATES`, so a change to hydration, persistence, or
the close and reopen path still owes no Electron eval. That map is being
reworked on its own branch; the evals above are the ones it should name.

### 2026-09-24 — the stale-async ratchet finds guards by shape (BUG-206)

**The ratchet that keeps the M0 `useLatestRequest` seam from eroding now
finds guards by what they do, not what they are called, and the landing
checks run it.** It had matched a name list, so it saw 15 of the renderer's 33
hand-rolled guards, counted two things that are not guards, and went red on
master when `11825936` renamed a listed counter, because related-test
selection never picks a test that imports nothing.

The rule, in `src/hooks/use-latest-request.ratchet.test.ts`, parsed with the
TypeScript compiler API already in the repo:

| Part | A guard is | Not a guard |
| --- | --- | --- |
| state | `useRef(<number or boolean>)` read through `.current`, or a `let` initialised to one | object tokens, `AbortController`s |
| read | in an `if` condition or on the left of `&&` / `||`, after an `await` in an async function, in a `.then`/`.catch`/`.finally` callback, through a named predicate (`const stale = () => …`), or in a continuation passed by name | a read in a synchronous handler or a subscription callback |
| write | by someone other than that continuation: an effect cleanup, an unmount, a newer call (a counter the reader increments itself counts when the read compares it by equality) | a result the reader writes itself (`let ok = false; ok = await launch()`) |

Five fixture cases pin the rule's contract (a counter under a name it has
never seen, a cleanup flag in a continuation, a predicate, a continuation
passed by name, and the three things it must ignore).

| | before | after |
| --- | --- | --- |
| guards seen | 15, plus 2 that are not guards | 33 |
| listed | 19 counts by file, no reasons | 26 by `file:name`, one reason each |
| migrated to `useLatestRequest` | | 6: `update-password`, the Settings hotkey read, the untriaged-feedback sample (a flag and a counter, now one channel), the composer clipboard visit (`current()` + `invalidate()`, so pastes in one visit still all commit), the goal-visual study load |
| a rename | red on master | one failure naming the old key under `gone` and the new site under `unlisted` |
| run by | the full suite only | the landing checks, for any `src/` change |

The 26 that stay fall in three groups, each line saying which: request
generations whose owner holds them (the Agent Source settings channels, the
roadmap rail's write scope, the remote roster's newest-read answer, two
ordering flags a ticket cannot express); effect cancel flags on gated
surfaces or files another change owns today; and lifetime flags whose effect
also owns a subscription. Mutation-verified both ways: a new counter under an
unseen name in a new file fails, and renaming `readGeneration` fails with
both names.

### 2026-09-24 — M1 slice: the desktop bridge is one typed contract

**Main, preload, the renderer and the tests are now each checked against one
contract, and checking them found five shapes that were already wrong.** The
bridge had 116 request channels and 30 pushes named by string literals on
both sides, a 1,475-line `electron.d.ts` re-declaring main's types by hand, an
untyped preload object, about 22 inline `typeof` checks, and 39 test files
building `window.electron` three different ways.

| Piece | Where | What it enforces |
| --- | --- | --- |
| The contract | `packages/core/src/desktop-bridge/` (`@exawatt/core/desktop-bridge`) | every channel's arguments and answer, every push payload, `window.electron`; nothing callback-shaped, nothing imported from outside core |
| Main | `ipc-security.ts`, `ipc-table.ts`, `window-broadcast.ts` | `handleTrusted<C>`, tables and every push typed per channel; ten direct `webContents.send` calls gone |
| Preload | `preload.ts` | `invoke`/`subscribe` typed by channel; the object `satisfies DesktopBridge`; value imports refused (sandbox) |
| Renderer | `src/types/electron.d.ts` | `window.electron?: DesktopBridge`, 15 lines; the wire shapes are imported, not copied |
| Tests | `src/test-support/desktop-bridge-double.ts`, `eslint.config.mjs` | one double, less capable than preload but never more; lint refuses any other write |
| Input | `electron/main/ipc-arguments.ts` | one reader per consequential channel, returning the contract's argument tuple |

**Where it lives.** Core, not `electron/shared/`: core is already the
Electron-free module both processes import by package name, main through its
CommonJS build (already in the packaged runtime payload) and the renderer
through source, and it already carried this boundary's wire types. A subpath
keeps the bridge out of core's barrel. `electron/shared/` would have needed a
tsconfig alias, a Vitest alias, and a hand-written rule to keep Electron out.

**One definition per shape.** Main's wire types moved into the contract and
main imports them; nothing re-exports the old paths. The pairs the renderer
had renamed now share a name (`ConnectedGatewayPhase`, `SourceConnectionView`,
`AgentMappingInput`, `PtyAttention`, `PtyReentryRecap`). Main's
`PtySessionInfo` is `PtySessionRecord`, what a create answers; a `pty:list`
row is `PtySessionInfo`, the record plus six live facts, built by one named
function in `pty-ipc.ts` where it had been an anonymous object. Main's
settings store instantiates the wire settings with its generated theme ids.
The summarizer and both monitors declare their event maps, so what they hand
to pushes is typed at the source.

**Preload is types only.** It runs sandboxed and may require nothing but
`electron`, so channel names stay literals there, each checked against the
contract; `preload.test.ts` refuses any other value import. The compiled
preload still requires `electron` alone.

**Drift the contract caught.**

- `app:checkpoint-request` carries `reason: 'restart'` for the window-management
  restart; the renderer's type said it could not arrive. Nothing read it.
- `ClosedSessionEntry.harness` is any string the ledger file holds; the
  renderer indexed `HARNESS_META` with it. BUG-209.
- Preload's inline payload types for `app:update-status` and
  `settings:changed` had fallen behind main.
- The renderer marked `exitSignal`, a child's `description`, a delegation's
  `blockedOn` and the six live facts optional "for older mocks"; main always
  sends them. The legacy-mock `working` fallback in `switcher-rows` is gone.
- Doubles answered with shapes main never sends: `bufferSince` without
  `truncated`, `pasteClipboard` resolving to nothing, exit events without
  `exitSignal`, connect/send/add results without `sourceId`, `status`,
  `created` or a receipt, change ticks without `connection`, a profile-state
  write main refuses. One Settings test passed only because its double lacked
  `isElectron`.

**Input at the boundary.** The inline checks moved into readers with their
sentences unchanged; the existing validators beside their subsystems
(`parsePlanRequest`, `parseOperatorStatsSyncEvent`, the connected-source
readers) stayed. `pty:create` spawn options and the `pty:worktree` git argv,
which had been trusted, are now read, and refuse as `{ ok: false, error }`.
The boundary is passed to `handleTrusted` rather than imported by it, so the
command engine's channel registers without core (BUG-016).

**Teeth, mutation-checked.** A channel renamed in preload only, or in main
only; a preload method the contract lacks, or one it drops; a `pty:list` row
missing a live fact; a handler answering a count for a list; a push payload
renamed; a callback added to `connect` in the channel table or to a method in
the API; a double given a method the contract lacks, as a literal or through
a variable: each fails `tsc`. A hand-written `defineProperty` or assignment
fails lint.

**Not done.** Three eval scripts inject page stubs outside Vitest and are
named exceptions in the lint; two of them carry shapes the bridge does not
(`settings.set`, a `bufferSince` answering `data`). The 55 renderer files
still read `window.electron` directly; an accessor was out of scope.

### 2026-09-23 — M1 first slice: Electron main is a composition root

**`main.ts` went from 1,761 lines to 339 and now only wires modules; three
bugs in that code were fixed by the split.** It had 25 module-level `let`s,
ran `app.whenReady()` on import, and no test could load it, so every change to
one of its five responsibilities meant reading all of them.

| Module | Owns | Suite |
| --- | --- | --- |
| `renderer-server.ts` | unpacking, spawning, readiness, stop, cache pruning, the child's lifeline | fake child process, plus real processes for the lifeline (10) |
| `renderer-port.ts` | the port the renderer origin carries (BUG-022), and the sweep of every other origin (BUG-170) | temp `userData`, fake port availability (20) |
| `deep-link.ts` | protocol registration, vetting, held links | fake window (12) |
| `window.ts` | construction over `window-shape.ts`, navigation boundary, startup stage, trusted origin | fake BrowserWindow (15) |
| `menu-controller.ts` | the menu's runtime state and its three channels | real template, fake install (6) |
| `app-ipc.ts` | main's own channel tables and their composer | per table, plus the composer (17) |
| `ipc-table.ts` | registration as data, keyed by channel name through `handleTrusted` | (5) |
| `shutdown-sequence.ts` | every step of quit, restart and update-restart; `before-quit` | the real coordinator over fakes (17) |
| `command-surface.ts` | bootstrap and the `CommandRuntime` it fills | injected runtime modules (8) |
| `build-identity.ts`, `main-diagnostics.ts`, `installed-build.ts` | what the process is; instrumentation; the update-ready watch | (8), (3), (2) |

Registration is a table in both directions: module registrars are rows in one
ordered list, and main's own channels are records keyed by channel name. The
table declares no channel names and no payload types, so the typed
desktop-bridge contract can adopt it unchanged.

What this does not yet do: M1's mechanical enforcement (deep-import and cycle
refusal, declared runtime environments). The modules exist and are tested in
isolation; nothing yet stops the next change from importing across them.

The three fixes that fell out:

- **BUG-070.** The renderer server was stopped only from `before-quit`, which a
  SIGKILL, crash or Force Quit never runs. Its launch now runs a four-line
  `-e` prelude that exits on end of file from stdin, a pipe whose only writer
  is main; the kernel closes that writer however main ends. Rejected:
  `utilityProcess` (needs the ready event, and the warm renderer starts before
  it) and a ppid poll (a second of latency for the same signal).
- **BUG-022.** An install keeps one port in `renderer-port.json`: kept when
  free, an OS port for one launch when taken (empty storage that does not
  carry over, the kept origin untouched), a new home after three taken
  launches or an unreadable record. Chosen over moving each `localStorage`
  store because it repairs the class, covers IndexedDB and sessionStorage, and
  stops a dead origin accumulating per launch. What it cannot do on a fallback
  launch is BUG-171. The same policy sweeps the origins earlier launches left
  (BUG-170): every origin the packaged server could have served from but the
  kept one (`http://127.0.0.1:<port>`, stable range up), once per dead origin
  appearing, through `session.clearData({ origins })`; a dev server's or any
  site's storage is never touched (BUG-303).
- **BUG-050.** The eval inferred "a native modal is up" from "did not close in
  2.5 s". Every shutdown dialog now names itself on main's console first, the
  eval fails on that line, and the product half (no dialog on a non-workspace
  quit with only stopped Sessions) is a unit test.

Falsified along the way: the lifecycle gate was not red on a quiet machine
(baseline `origin/master` passed it end to end before any change), and its
record's premise that the last launch "supplies no dialog responses" was
stale; every launch passes `confirm`.

### 2026-09-13 — M0 first seam: the Agent Source readiness fact model

**One fact model replaced four local fixes, and ⌘T paints from memory.**
Landed for BUG-062, BUG-082 and incident `0021`; the rule is decision `0043`.

The seam is the readiness chain: saved preferences → source registry → row.
Before, it lived inline in `launch-controls.tsx` as six pieces of state and a
`launcherSettled` expression that required the registry to be LIVE for every
source and a model catalog for every launchable one. It is now three modules
with one public shape each:

| Module | Runtime | Owns | Suite |
| --- | --- | --- | --- |
| `packages/core/src/agent-sources.ts` | shared kernel | `AgentSourceObservation`, `agentSourceFactFreshness`, `agentSourceLaunchVerdict`, `launchableAgentSourceState` | main and renderer consume the same verdict; `agent-source-registry.test.ts` pins the gate on it |
| `electron/main/pty/agent-source-observation-store.ts` | main | the persisted last-known-good per adapter, its size class and eviction | `agent-source-observation-store.test.ts` (disk) |
| `electron/main/pty/agent-source-registry.ts` | main | folds memory into discovery, `rememberedAgentSources`, the settled-good cache window, the gate | `agent-source-registry.test.ts` |
| `src/components/workspace/use-agent-source-registry.ts` | renderer | the ONE reader: checking placeholder → remembered → live, newest-wins | driven through the composer and Settings suites |
| `src/components/workspace/launcher/launcher-model.ts` | renderer, DOM-free | `launcherReadiness`, `launcherStatusLine`, `draftLauncherSetup` | `launcher-model.test.ts` names "not yet checked" vs "checked and failed" as transitions |
| `src/hooks/use-latest-request.ts` | renderer | "only the newest request may commit" | `use-latest-request.test.tsx`; `use-latest-request.ratchet.test.ts` refuses a new hand-rolled counter |

Measured on the operator's machine (load 10 to 12, fish login shell,
real CLIs), the same probe before and after
(`scripts/composer-registry-cold-probe.mjs`,
`scripts/agent-source-registry-probe.mjs`):

| | before | after |
| --- | --- | --- |
| ⌘T → live Start, registry cache expired | 4.3 to 5.1 s (three samples), placeholder cards throughout | 48 to 58 ms, three real chips (three samples) |
| login shells per ⌘T | 13 | 0 while the last observation is complete and settled (`ready` or `not-installed`, within five minutes); otherwise the probe runs behind an already-live row |
| app restart, first ⌘T | same as a cold read | Start live in 51 ms from the persisted memory, revalidated behind it |
| one cold registry read | 4.5 s, 13 shells | unchanged by design (BUG-063's deadlines stand); the remembered read is 0.1 ms, 0 shells |

What moved and why it is a seam rather than a fix:

- The four sequence counters in `launch-controls.tsx` (`branchEditSeq`,
  `permissionSaveSeq`, `modelLoadSeq`, `modelRefreshSeq`) and its three
  `let cancelled` effects are gone; so are the generation refs in
  `use-remote-coworkers`, `use-project-roadmap`,
  `use-fleet-roadmap-attention` and `agent-sources-settings`. Each is a
  `useLatestRequest` channel. The ratchet test lists the eleven sites that
  remain and fails on a twelfth.
- `launch-controls.tsx` shrank from 2,094 to about 2,050 lines while gaining
  the memory-first paint; the presentation helpers and the draft-chip
  builder moved into `launcher-model.ts`.
- D49's "hold inert cards until every launchable engine has reported a
  catalog" is amended: the row freezes its order at the readiness chain's
  `ready` phase (policy, pool, painted registry), engines without a pool
  configuration paint as draft chips whose model line shims until the
  catalog lands, and the engine being adjusted shows the choice in progress
  on its chip. Nothing reorders under the pointer.
- The launcher's status line is reserved (`data-launcher-status`), with
  three registers; `/hud-gallery/agent-launcher` gained the "Painted from
  memory" and "Not signed in" scenarios.

Falsified along the way, so the next agent does not re-diagnose:

- The composer's own tests expected Start to be pressable BEFORE the row
  settles (a pool that never loads, catalogs that never answer). That is the
  contract: Start needs the saved policy and a painted registry, never the
  ranking or the catalogs.
- D70's cold-renderer probe never expired the registry cache, which is why
  its samples read tens of milliseconds and BUG-062 stayed "unconfirmed";
  the one 1,474 ms sample in that report was the registry.

The same class surfaced once more before this landed, in the fleet roadmap
producer: a roadmap read that failed wrote the same `absent` a Project with
no roadmap gets, so a roadmap over the reader's byte limit read as quiet on
the strip, the Project dot and ⌘J. BUG-162 gives it the fact model's answer
(`failed` is unknown, the last good parse stands as a fact with an age, the
producer declares itself blind, and one Project's reads share a
`createLatestRequest` channel so an older read cannot land after a newer
one). The residual it declares: the strip and ⌘J have no "unwatched"
vocabulary yet; `sealAttentionView` carries the blind Sessions beside the
signals for the surface that gains it.

Next seams, in the order the evidence suggests: the model-catalog read (the
same stale-while-revalidate shape, already disk-backed by BUG-115, still
cwd-scoped so a fresh worktree pays every catalog probe), then the launch
orchestration in `launch-controls.tsx`, which still owns model choice,
permission persistence and the draft tab's patch stream in one component.
