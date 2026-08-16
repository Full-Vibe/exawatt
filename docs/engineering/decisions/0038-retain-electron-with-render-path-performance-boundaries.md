# 0038 Retain Electron with render-path performance boundaries

Date: 2026-08-16
Status: accepted; execution is ENG-016 D55

## Context

Zed demonstrates what a UI can achieve when its whole presentation model is
built around a compact GPU scene. GPUI flattens the visible interface into a
small primitive vocabulary, batches instances, keeps glyphs in atlases, and
drives Metal from the display clock. That architecture removes the DOM,
browser layout, and a general retained widget tree from its critical path.

Exawatt has a different product boundary. Dense terminal text, forms, command
discovery, keyboard semantics, accessibility, and a future hosted surface are
core requirements, not incidental implementation choices. It already uses
three fit-for-purpose rendering regimes:

- DOM/React for semantic application chrome and the Team surface;
- xterm's WebGL renderer for live terminal cells;
- R3F/Three.js for the Fleet board, with demand rendering, instancing, bounded
  DPR, imperative per-frame projection, and measured 1k/10k population paths.

Replacing that stack with a custom immediate-mode renderer would rebuild
browser layout, text, accessibility, input, and hosted compatibility before it
improved one measured Exawatt interaction. A generic “GPU acceleration” project
would also obscure the more important question: which process and phase owns
the delay the operator can feel?

## Decision

Keep Electron and the existing renderer split. Exawatt will not build a
mini-GPUI inside Electron or move ordinary DOM surfaces into WebGL for
performance theatre.

The render-path contract is:

- React owns discrete semantic state: selection, visibility, route, command
  availability, focus intent, and accessible structure.
- CSS transforms/opacity and the Chromium compositor own continuous DOM
  motion whenever they can express it without changing semantics.
- xterm owns terminal-cell rendering and PTY presentation; React does not
  repaint terminal content.
- R3F owns continuous Fleet pixels and camera interpolation. Per-frame work
  mutates stable refs/buffers, invalidates only while motion or meaningful
  ambient state requires it, and parks when its active contract says it should.
- Pure source-agnostic selectors own layout and view-model derivation outside
  renderer code.
- Performance work begins with an operator-visible gesture and a trace. It
  changes the narrowest proven owner, then repeats the same measurement and
  behavioral gates on the exact tree.

The first implementation mile is an optional, deterministic Electron
interaction-performance evaluator plus baselines for Agent tab switching,
Agent ↔ Team, Team ↔ Fleet, and Fleet pan/zoom. It is an investigation and
regression tool, not a mandatory check on every landing.

Prewarming is not a default technique. It may be proposed only after a cold-path
trace proves that module, asset, or shader preparation dominates a critical
gesture, and only when the work is pure or idempotent, version-keyed, bounded,
cancellable, discardable, and free of hidden React mounts, data subscriptions,
focus changes, PTY effects, or source commands. A missed or invalid prewarm must
produce the same correct cold path.

## Consequences

- GPU-aware architecture is an explicit cross-surface rule without turning
  every surface into a GPU scene.
- Broad provider/store rewrites, generic memoization campaigns, blanket
  `will-change`, hidden route mounts, and decorative shader work are not valid
  without a measured critical-path owner and a retained regression contract.
- Existing Fleet scale instrumentation remains the GPU authority; D55 extends
  coverage across Electron interaction paths instead of duplicating it.
- Existing transition owners and fallbacks remain authoritative. An
  optimization may shorten their work but may not add a second route, focus,
  camera, or lifecycle owner.
- Development remains fast because the performance rig is run for baselining,
  diagnosis, before/after verification, and targeted regression investigation,
  not indiscriminately on every change.
- Replacing Electron remains a possible future decision only if measured,
  representative critical interactions stay outside their budgets after the
  narrow proven owners have been addressed and Chromium/Electron overhead is
  itself the irreducible cause.

## Evidence boundary

“Feels faster” is not sufficient evidence, and synthetic headless frame cadence
is not a claim about a real GPU. Final claims require repeated runs on the same
reference hardware and refresh rate, a packaged or production-equivalent
renderer, warm and cold cases named separately, and behavioral parity across
keyboard, focus, reduced motion, accessibility, Demo/Live, route history, and
Session/PTY lifetime.

The detailed execution and review contract is
[`projects/interaction-performance-architecture.md`](../projects/interaction-performance-architecture.md).
