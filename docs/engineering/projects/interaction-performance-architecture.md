# ENG-016 D55 interaction performance architecture

**Outcome: make Exawatt measurably snap faster without changing its product behavior or creating a second UI architecture.**

This is the execution brief for ENG-016 D55. It is subordinate to the canonical
roadmap and is not an independent roadmap. Decision `0038` owns the durable
Electron/render-path tradeoff; this document owns the evidence, sequence,
review gates, and acceptance criteria for the implementation mile.

## Why this work exists

The operator asked whether Zed-level interface snappiness requires leaving
Electron and then clarified that the goal is not BUG-012/BUG-013's beachball.
The request is ordinary interaction quality: tabs and command altitudes should
feel immediate, deliberate, and slick under normal operation.

The Zed comparison is useful as an architectural compass, not a porting plan.
GPUI reduces the entire UI to a compact GPU scene with batched primitives,
shader-rendered shape details, glyph atlases, and display-clock frame pacing.
Exawatt cannot copy that isolated mechanism while retaining a DOM-heavy hosted
product, native-grade accessibility, and xterm. It can adopt the governing
discipline: minimize work in the input-to-pixel path, give continuous pixels to
the renderer best suited to them, batch or retain stable resources at that
boundary, and keep expensive non-presentation work off the critical frame.

Primary-source references:

- [GPUI overview](https://github.com/zed-industries/zed/tree/main/crates/gpui)
- [GPUI scene construction](https://github.com/zed-industries/zed/blob/main/crates/gpui/src/scene.rs)
- [Metal renderer](https://github.com/zed-industries/zed/blob/main/crates/gpui_apple/src/metal_renderer.rs)
- [Metal shaders](https://github.com/zed-industries/zed/blob/main/crates/gpui_apple/src/shaders.metal)
- [macOS display link](https://github.com/zed-industries/zed/blob/main/crates/gpui_macos/src/display_link.rs)
- [Electron all-process tracing](https://www.electronjs.org/docs/latest/api/content-tracing/)

## What the codebase already gets right

The starting point is stronger than a generic Electron application:

| Regime | Existing fast path | Boundary that must survive |
| --- | --- | --- |
| Agent | xterm renders terminal cells through WebGL with its canvas fallback; panes stay mounted while PTYs stream | Electron main owns PTY/Session lifetime; tab changes must never recreate or guess identity |
| Team | One DOM document; entry and selection use transform/opacity; reordering uses position-only FLIP with stable refs and reduced-motion snap | Focus, roving selection, roadmap, live sorting, and Agent identity remain semantic DOM behavior |
| Fleet | R3F demand loop, imperative damped camera, instanced population fields, label budgets, bounded DPR, pure layout selectors | URL altitude/selection, DOM accessibility twins, exact Session handoff, and source-neutral scene truth |
| Cross-altitude | One `CommandNavigationProvider`; navigation begins immediately; finite overlay and DOM→WebGL ghost handoff fail to a directional cut | No second route owner, no blocked input, no stale callback clearing a newer transition |

Fleet is already measured at the GPU boundary. The canonical V3.1 evidence
records six draw calls and sub-3ms render CPU bursts at 173, 1k, and 10k Fleet
scales, with a zero-frame parked state where required. The first D55 task is
therefore not to redesign Fleet rendering. V3.5 is the complementary warning:
all frame, draw-call, and parking gates stayed green while delegated pieces
overlapped by as much as 85%. Performance evidence never substitutes for a
visual/semantic oracle.

The unmeasured risk is the complete Electron interaction path. Static review
identifies candidates, not convictions:

- `WorkspaceClient` is a large orchestration owner and consumes a broad
  `useWorkspaceState` result. A tab or activity change may reconcile more of
  the tree than its visible consequence requires.
- Every live `TerminalPane` intentionally stays mounted. This protects output
  and Session continuity, but parent reconciliation, fit, theme, and visibility
  work must be distinguished from xterm's own rendering cost.
- Team mounts a rich tile tree over a blurred underlay and derives several
  projections from live maps. Its FLIP implementation is already carefully
  hardened; the cost owner may instead be subtree render, style/layout, paint,
  or compositor setup.
- Team → Fleet crosses a lazy route and WebGL shader boundary. The current code
  already defers the largest optional effects compile during handoff and cuts
  safely on stalls. A cold-path delay must be attributed before any preload is
  considered.
- `FleetProvider` publishes whole `FleetState` snapshots; the spatial client
  recomputes pure selectors and layout on relevant identity changes. Existing
  scale measurements make this a lower-priority suspect until a trace says
  otherwise.

None of those observations authorizes a refactor. The evaluator exists to turn
one into a proven owner or falsify it.

## Product and architecture constraints

The work may improve timing and implementation boundaries. It may not silently
change what an interaction means.

- Preserve Agent, Team, and Fleet as distinct information altitudes with the
  existing DOM/xterm/R3F renderer split.
- Preserve exact PTY and durable Session identity across tabs, Projects,
  splits, Team, routes, quit/relaunch, and recovery.
- Preserve keyboard reachability, focus landing, inert underlays, app-history
  behavior, URL state, visible selection, touch behavior, and screen-reader DOM
  equivalents.
- Preserve Demo/Live behavior through the same UI and command layers.
- Preserve the design-system motion contract: intentional 160–260ms ordinary
  movement, house easing, reduced-motion parity, and no animation where it
  would cause terminal reflow.
- Preserve route-paint and appearance snapshot continuity established by
  incidents `0003`–`0005`.
- Preserve every existing focused evaluator. Performance evidence supplements
  behavioral evidence; it never replaces it.
- Keep BUG-012/BUG-013 main-process beachball diagnosis separate. A trace may
  share machinery, but D55 does not claim that incident or patch around it.

## Measurement model

### The gesture matrix

The first baseline covers the interactions that define perceived command
velocity:

| Gesture | Required cases | First visible acknowledgment | Settled state |
| --- | --- | --- | --- |
| Agent tab switch | same Project, cross-Project, terminal/composer/paused target; 1, 5, and 10 Agents | active tab/chrome begins changing | target pane visible and focused; zero terminal resize storm |
| Agent → Team | keyboard and click; warm route state | stage recession or Team paint begins | Team focus lands on originating Agent and tiles settle |
| Team → Agent | Enter/Escape/click | selected tile responds | exact Agent active and terminal focus restored when requested |
| Team → Fleet | cold and warm module/shader cache; handoff accepted and fallback | navigation/ghost or directional cut begins | Fleet canvas painted, command altitude active, input accepted |
| Fleet → Team | cold and warm workspace state | directional response begins | Team identity/focus and route state restored |
| Fleet board | mouse/trackpad pan, wheel/pinch zoom, arrow selection | camera/unit responds | damped motion settles or intentional ambient loop remains |

Run the matrix on deterministic Demo fixtures and a bounded real Live fixture.
Demo is the repeatable benchmark; Live is the integration control. Record
refresh rate, display/DPR, power mode, app SHA, Electron/Chromium versions,
fleet size, cold/warm condition, and dev versus packaged renderer. Dev-server
compilation is never presented as user-experience latency. The normal hidden
Electron test mode remains the correctness path, not presentation-timing
evidence. Frame/cadence claims require an explicitly visible headed window on a
non-primary display (or an operator-approved foreground run), because a hidden
WebContents does not prove display presentation.

### Metrics and attribution

The lightweight run records:

- input capture to the first animation-frame sample in which the expected
  visible state is observable (a lightweight proxy; use trace or the existing
  pixel-sampling method when actual presentation is the disputed boundary);
- input to settled semantic state;
- frame intervals through the driven window, with missed-refresh runs called
  out instead of averaged away;
- Long Tasks, layout shifts, and event timing where Chromium exposes them;
- heap before/after the matrix and retained-resource counts relevant to the
  path;
- existing R3F draw-call, render-CPU, layout, DPR, and parked-frame probes on
  Fleet cases.

The attribution run is separate because instrumentation can perturb the result.
Electron `contentTracing` records the renderer, main, GPU, compositor, and viz
processes around one gesture. Narrow trace categories and a bounded window keep
the artifact useful. React Profiler or targeted component counters are added
only after the trace identifies renderer JavaScript as the likely owner; they
are diagnostic builds, never permanent production observers or initial gates.
Main-process spans are added only for a proven IPC/main critical path.

The evaluator emits a versioned JSON report plus optional trace and screenshots
under an ignored artifact directory. It prints the exact environment and
refuses the wrong dev-server checkout through the existing Electron harness.
Electron launches remain serial and use `withElectronApp`; no external timeout
may orphan the process tree. Chromium traces can include paths, URLs, event
arguments, and other operator data: traces are local, ignored, never uploaded or
committed, and captured against deterministic Demo data by default. A Live run
records the privacy-safe summary only unless a separately reviewed diagnostic
explicitly needs a local trace.

### Budgets

Existing canonical ceilings remain provisional anchors, not invented proof:

- an ordinary control must begin acknowledging input within 80ms p95;
- ordinary intentional motion should settle in the design system's 160–260ms
  range; Fleet's existing control budget is roughly 200–350ms, while the
  exceptional Team → Fleet identity handoff owns its measured 460ms crossfade
  and a separate 900ms freshness deadline before it falls back to the fast cut;
- driven motion should not miss more than one unexpected refresh interval on
  the reference display;
- a settled regime does no accidental continuous work; Fleet follows its
  explicit ambient/park contract;
- no change may add a repeatable Long Task to an interaction that did not have
  one before.

Stage 1 records the real distribution before ratcheting a scenario. A threshold
becomes a regression budget only when the fixture is deterministic, repeated
runs have acceptable variance, and the number distinguishes a real regression
from host contention. Report median and p95; keep raw runs. Never fail on one
headless rAF percentile or compare a 60Hz result directly to 120Hz.

## Six-stage execution and review plan

1. **Build the optional evaluator and freeze behavior.** Add one explicit
   `eval:electron:interaction-performance` entry over the existing safe
   Electron harness. Install only eval-time probes, encode the gesture matrix,
   and call the existing behavioral evaluators for the contracts it relies on.
   Do not add it to `SURFACE_GATES`, `agent:land`, CI, startup, or production
   telemetry. Review before proceeding: prove the fixture has the same Project,
   Agent, Session, focus, route, reduced-motion, and Demo/Live outcomes with and
   without probes; quantify observer overhead with an uninstrumented control;
   prove teardown leaves no Electron process; inspect every JSON field for
   credentials, prompts, paths, or transcript text and store none.

2. **Establish reproducible baselines and rank offenders.** Run cold and warm
   packaged-equivalent samples serially on a quiet reference machine, then one
   Live control. Preserve the raw reports and promote only the summarized
   distributions into this document. Attribute the slowest repeatable gesture
   with one bounded Chromium trace. Review before proceeding: rerun the control,
   reject results distorted by dev compilation, display throttling, overlapping
   evals, or trace overhead, and name the process plus phase responsible. If no
   interaction misses a meaningful budget, stop; the evaluator is the useful
   deliverable and there is no optimization project to justify.

3. **Change one proven owner through the narrowest safe seam.** Pick the largest
   user-visible miss, reproduce it with a failing performance comparison, and
   apply only the matching branch of the remediation decision tree below.
   Re-run the same before/after matrix after each change; do not stack several
   plausible optimizations into one result. Review before proceeding: inspect
   ownership, lifecycle, cancellation, cleanup, memory, and failure behavior;
   delete any cache or memoization whose invalidation contract cannot be stated
   and tested; reject a result that merely shortens motion while delaying input
   or hiding work.

4. **Prove behavioral and architectural parity.** Run the touched surface gate,
   related unit tests, type-check, R3F checks for Canvas changes, and the exact
   Electron round trip where PTY or route state is involved. Exercise keyboard,
   pointer/touch as applicable, reduced motion, low power, light/dark
   appearances, 560px minimum window, Demo/Live, cold/warm, rapid repeated
   commands, interruption mid-transition, and failure fallback. Review before
   proceeding: compare screenshots and semantic state, inspect the diff for a
   second owner or hidden mount, and explicitly verify no stale callback can
   overwrite a newer command.

5. **Ratchet only stable evidence and roll out reversibly.** Keep the global
   evaluator optional. A repaired surface may gain one narrowly scoped
   regression assertion only when its variance is understood and the check
   exercises that surface's own contract; it does not become an always-run
   application benchmark. Land one immutable attempt, dogfood Electron-facing
   changes, and compare the installed build on the same hardware. Review after
   dogfood: retain the optimization only if the measured improvement is
   material and the operator experience is at least as clear; otherwise revert
   the optimization and keep the evaluator, trace recipe, and falsified theory.

6. Incorporate this triumphantly into marketing materials / roadmap / ideas.
   Do this only after an installed build reproduces the gain. Update the D55
   milestone log with exact before/after hardware, refresh rate, scenario,
   median/p95, and behavioral evidence; then promote a public-safe claim to
   `docs/product/marketing.md`. Claim what was measured (for example, a named
   interaction or Fleet scale), never “native speed,” “Zed-fast,” or a generic
   GPU claim that the evidence cannot support. Feed any newly exposed product
   idea back into the existing roadmap item rather than opening a feature-jam
   lane.

## Remediation decision tree

Only the attributed branch is eligible:

| Proven owner | Preferred move | Rejected shortcut | Required extra proof |
| --- | --- | --- | --- |
| React reconciliation/commit | Narrow a subscription or component boundary; stabilize a proven hot prop; extract one semantic channel at a time behind the existing hook API | Wholesale state-store migration, generic `memo` sweep, stale custom equality | No missed live update; selection, attention, recovery, and source races retain tests |
| Style/layout | Remove read/write interleaving; calculate once at the owning boundary; use transform/opacity for continuous movement | Blanket containment, fixed geometry that breaks 560px/touch, hiding layout shifts | Focus/scroll/sticky/measurement semantics and all appearances remain correct |
| Paint/composite | Reduce or localize the proven paint; promote layers only during bounded motion and release them afterward | Persistent `will-change`, removing identity/contrast/depth without product review | Layer/memory trace, screenshot parity, reduced-transparency/contrast behavior |
| Route/module/shader cold start | First remove optional work from the handoff and keep the existing cut; consider a pure bounded preparation cache only if the cold trace still dominates | Hidden route/Canvas mount, duplicated Fleet tree, early subscriptions, stateful “warm” shadow app | Cold and warm semantics identical; cache versioned, bounded, cancellable, discardable, fail-open |
| R3F CPU/GPU | Extend existing scale fixture; reduce selector work, instances, materials, labels, or invalidation at the exact tier | DOM-to-WebGL migration, decorative shader rewrite, disabling accessibility twins | Draw calls, render CPU, cadence, park/ambient contract, visual rubric, keyboard DOM parity |
| xterm presentation | Change the pane/xterm boundary only after a real-GPU and renderer trace; preserve mounted PTY ownership | Unmount hidden panes, replay on every tab switch, assume WebGL context limits from SwiftShader | Output continuity, search/selection, fit, theme, split, paused/live lifecycle, real-GPU control |
| Electron main/IPC | Move or bound the proven work at its owning main-process service and keep renderer feedback immediate | Mask the stall with animation or fold BUG-012/013 into this plan without its own diagnosis | Main/renderer trace correlation, cancellation/backpressure, process-wide behavior |

## Prewarming admission test

A prewarm proposal is rejected unless every statement below is true:

- a repeated cold-path trace shows preparation, not rendering or product data,
  is the dominant miss;
- the prepared artifact is keyed by app/build version and every input that can
  affect correctness;
- running twice is equivalent to running once;
- cancellation or late completion cannot publish UI state, navigate, focus,
  subscribe, spawn a PTY, start a source, or overwrite a newer result;
- memory and lifetime are bounded, observable, and cleaned on route/app exit;
- the ordinary cold path remains correct and within its existing fallback when
  the artifact is absent, stale, corrupt, or slow;
- a test proves cold, warm, cancelled, stale, and failure cases produce the same
  semantic state.

The initial D55 implementation should not prewarm anything. Stage 2 earns the
right to propose it.

## Regression and fragility pre-mortem

| Risk | How the plan prevents it |
| --- | --- |
| Benchmark noise becomes architecture | Repeated serial runs, refresh-aware metrics, quiet-machine metadata, raw samples, packaged final evidence, and an explicit stop when variance is too high |
| Instrumentation creates the delay it reports | Lightweight and attribution passes are separate; every observer has an uninstrumented control |
| A broad store refactor loses race semantics | One proven channel at a time, existing hook facade retained, failing behavioral reproducer required before extraction |
| Memoization serves stale Agent truth | No custom equality without an explicit semantic invalidation contract and live-update tests |
| Prewarming creates a shadow application | No hidden mounts or subscriptions; strict pure/idempotent/discardable admission test; initial stage forbids it |
| GPU layers trade latency for memory | Temporary promotion only, layer/memory trace, cleanup proof, real-GPU control |
| Fast animation disguises slow response | Measure first acknowledgement separately from settle time; input is never held behind choreography |
| Timing stays green while the interface becomes visually wrong | Keep geometry, screenshot, accessibility, and semantic outcome gates beside timing; V3.5's green-perf/85%-overlap failure is the standing counterexample |
| Optimization breaks focus/history/PTY identity | Exact gesture outcome matrix and existing Electron behavioral round trips remain release evidence |
| Optional testing decays into no testing | One documented script, versioned report, deterministic fixtures, and required before/after evidence for any D55 optimization |
| Performance gates slow normal development | The application-wide rig never joins the default landing floor; only stable surface-specific regressions may be ratcheted |
| A synthetic win becomes an overclaim | Installed-build reproduction and evidence-scoped marketing language are Stage 6 gates |

## Definition of done

D55 planning is complete when this brief, decision `0038`, architecture
contract, roadmap milestone, and runtime map agree. D55 implementation is
complete only when:

- the optional evaluator deterministically exercises the complete gesture
  matrix and emits privacy-safe versioned evidence;
- at least one quiet-machine cold/warm baseline is recorded without claiming a
  regression threshold prematurely;
- every interaction outside a ratified budget has either one attributed owner
  and a separately reviewable remediation, or an explicit stop/disposition;
- each retained optimization shows a material repeatable before/after gain on
  the exact scenario and passes all behavioral/visual contracts;
- the installed dogfood build confirms the result; and
- canon records the evidence, falsified theories, remaining risks, and only
  appropriately bounded public claims.

The plan does not require an optimization to exist. Discovering that current
critical interactions already meet the bar, or that a proposed change adds more
fragility than speed, is a successful stop.
