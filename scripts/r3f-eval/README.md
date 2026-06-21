# R3F eval harness

A small, deterministic, **free** capability ratchet for React Three Fiber work.
It turns "it compiled" into **"it rendered, no WebGL error, non-blank, correct
draw-call count."** Layer B (Playwright headless) only, for now.

## What it checks (per task)

Each task is an isolated Next route under `/eval/<task>` that renders one R3F
scene, exposes the renderer as `window.__EVAL_GL__`, and uses
`gl={{ preserveDrawingBuffer: true }}` so the harness can read pixels + draw
counts. For each task the runner:

1. **No WebGL/shader errors** (hard gate) — captures `pageerror` + `console`
   errors; any of `THREE.WebGLProgram`, `shader`, `GL_INVALID`, `context lost`,
   `WebGL context` caps the score at 15.
2. **Non-blank** (hard gate) — 9-point grid sample of the canvas; needs
   luminance variance or ≥2 points distinct from the clear color, else caps at 15.
3. **Draw-call budget** — reads `renderer.info.render.calls`. `t2-instanced`
   must stay ≤3 calls regardless of N (proves instancing); `t1` just records it.
4. **Clean console** — zero warnings.
5. Saves `report/<task>.png` + `report/r3f-eval.json`.

## Scoring (0–100 per task, mean across tasks)

`+40` rendered & non-blank · `+30` draw-call budget met · `+30` no warnings.
Hard gates cap a failing task at 15 (GL error, or blank). Aggregate = mean.

## Run

```bash
# against the running dev server (port 7000 by default, or 7090 if that's up)
EXA_BASE=http://localhost:7090 pnpm eval:r3f
# or start one first:  pnpm dev   (serves :7000)  ->  EXA_BASE=http://localhost:7000 pnpm eval:r3f
```

Needs a Chromium once: `npx playwright install chromium` (the runner resolves it
from the default `ms-playwright` cache, with fallbacks).

## TODO (deferred layers)

- **Layer A — RTTR fast gate:** `@react-three/test-renderer@^9` in vitest for a
  no-browser scene-graph + `advanceFrames` animation + `fireEvent('click')`
  check (pre-commit speed).
- **Optional VLM judge** (`--judge`): temporal 3-screenshot strip + per-task
  rubric → per-axis 0–10 (Anthropic API = paid, or a local MLLM = free).
- **More tasks:** T3 hover/select raycast, T4 delta-time idle + reduced-motion
  gating, T5 selective bloom, T6 ortho-locked DOM-over-WebGL mini-HUD.
- **CI runner:** decide SwiftShader (portable, slow/flaky) vs xvfb + real GPU
  (~7× faster); tune pixel/draw-call thresholds accordingly.
- **Port reconcile:** `pnpm dev` serves `:7000`; the iterate loop has used
  `:7090`. `EXA_BASE` covers both — pick one to standardize.
