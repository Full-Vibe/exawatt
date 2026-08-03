# R3F eval harness

A small, deterministic, **free** capability ratchet for React Three Fiber work.
It turns "it compiled" into **"it rendered, no WebGL error, non-blank, correct
draw-call count."** Layer B (Playwright headless) only, for now.

## What it checks (per task)

Each task is an isolated Next route under `/eval/<task>` that renders one R3F
scene, exposes the renderer as `window.__EVAL_GL__`, and opts into drawing-buffer
preservation so the harness can read pixels + draw counts. The product path
leaves that expensive option disabled. For each task the runner:

1. **No WebGL/shader errors** (hard gate) — captures `pageerror` + `console`
   errors; any of `THREE.WebGLProgram`, `shader`, `GL_INVALID`, `context lost`,
   `WebGL context` caps the score at 15.
2. **Non-blank** (hard gate) — 9-point grid sample of the canvas; needs
   luminance variance or ≥2 points distinct from the clear color, else caps at 15.
3. **Draw-call budget** — reads `renderer.info.render.calls`. `t2-instanced`
   must stay ≤3 calls regardless of N (proves instancing); other tasks record it.
4. **Sparse composition** — `t3-spatial-sparse` locks the reported two-Project,
   three-idle-Agent fixture and asserts a compact, centered, side-by-side layout.
5. **Agent station** — `t4-agent-station` keeps Agent focus non-blank and
   independently screenshotable.
6. **Clean console** — zero warnings.
7. Saves `report/<task>.png` + `report/r3f-eval.json`.

## Scoring (0–100 per task, mean across tasks)

`+40` rendered & non-blank · `+30` draw-call budget met · `+30` no warnings.
Hard gates cap a failing task at 15 (GL error, or blank). Aggregate = mean.

## Run

```bash
# against the running dev server (port 7000 by default, or 7090 if that's up)
EXA_BASE=http://localhost:7090 pnpm eval:r3f
# or start one first:  pnpm dev   (serves :7000)  ->  EXA_BASE=http://localhost:7000 pnpm eval:r3f
```

Run `pnpm qa:browser:doctor` once. On macOS the runner uses the repository's
stable signed-browser boundary (Google Chrome first, signed Brave fallback) so
the network helper retains a durable Little Snitch identity. Other platforms
retain Playwright's managed-browser behavior.

## Spatial Command full-route battery

`eval:spatial` exercises the real `/fleet/spatial` route rather than an isolated
fixture. It checks Fleet → Project → Agent descent, Escape ascent, DOM Project
and Agent controls, S/M/L Demo snapshots, mobile inspector reachability,
reduced-motion parity, low-power DPR gating, console/WebGL errors, and zero idle
frames after finite motion settles.

```bash
EXA_BASE=http://localhost:7000 pnpm eval:spatial

# Optional real cadence sample. Headless Chromium throttles rAF, so p50/p95 is
# recorded only when a headed browser is explicitly requested.
SPATIAL_HEADED=1 EXA_BASE=http://localhost:7000 pnpm eval:spatial
```

Reports and screenshots are written to ignored `spatial-report/`.

## TODO (deferred layers)

- **Layer A — RTTR fast gate:** `@react-three/test-renderer@^9` in vitest for a
  no-browser scene-graph + `advanceFrames` animation + `fireEvent('click')`
  check (pre-commit speed).
- **Optional VLM judge** (`--judge`): temporal 3-screenshot strip + per-task
  rubric → per-axis 0–10 (Anthropic API = paid, or a local MLLM = free).
- **More tasks:** hover/select raycast, delta-time idle + reduced-motion gating,
  selective bloom, and DOM-over-WebGL mini-HUD coverage.
- **CI runner:** decide SwiftShader (portable, slow/flaky) vs xvfb + real GPU
  (~7× faster); tune pixel/draw-call thresholds accordingly.
- **Port reconcile:** `pnpm dev` serves `:7000`; the iterate loop has used
  `:7090`. `EXA_BASE` covers both — pick one to standardize.
