# R3F Authoring Guide (Exawatt)

Canonical, version-pinned rules for editing React Three Fiber / Three.js code in
this repo. **Re-read this before touching any `.tsx` under a `<Canvas>`.** It
exists because an LLM's base knowledge of R3F is stale (drei/fiber churn) and
because 3D bugs are visual — the patterns below are the ones we keep getting
wrong. Dense rules + short snippets; verify any API against the pinned versions.

> Why this guide exists (from two research passes): the dominant R3F failure
> modes are (1) the **visual feedback gap** — the model can't judge a viewport,
> so it must screenshot and grade; (2) **API staleness** — v8-era patterns the
> model learned are wrong for our v9 stack; (3) **performance anti-patterns**
> reliably emitted (setState/alloc in `useFrame`, no instancing, no dispose,
> uncapped dpr, missing `invalidate` under demand). Each rule below targets one.

## Pinned stack — verify against THESE, not generic tutorials

| package | version | notes |
|---|---|---|
| `@react-three/fiber` | ^9.6.1 | React 19 only. JSX types come from `ThreeElements`, **not** `JSX.IntrinsicElements`. |
| `@react-three/drei` | ^10.7.7 | does **not** re-export `easing` (that's `maath`). `<StatsGl>` wraps stats-gl **v2**. |
| `@react-three/postprocessing` | ^3.0.4 | `<EffectComposer>`/`<Bloom>`. Heaviest import — lazy-load it. |
| `three` | ^0.184 | ColorManagement ON by default; manual `texture.colorSpace = THREE.SRGBColorSpace` on color maps. |
| `react` / `react-dom` | 19.2.x | |
| `next` | 16.2.x | App Router. R3F components are `'use client'`. |
| `camera-controls` | ^3.1.0 | direct dep; drei `<CameraControls>` wraps it. Use `fitToBox` instead of hand-rolled camera math. |

**NOT installed (do not bare-import):** `maath` (transitive only — a direct
import won't resolve under pnpm without `pnpm add maath`), `leva`, `r3f-perf`,
`@react-spring/three`. **Doc-pinning rule:** before writing non-trivial drei /
postprocessing / three API, verify against the installed version (read the
`.d.ts` in `node_modules`, or use Context7 if available) and flag drift. Copying
a v8/drei-9 tutorial (e.g. `EnzeD/r3f-skills`) reinjects wrong-version patterns.

## v8 → v9 breaking changes the model gets wrong

- **JSX typing:** augment/import `ThreeElements` (e.g. `ThreeElements['mesh']`),
  not `JSX.IntrinsicElements`/`Node`. `MeshProps`/`Props` were removed.
- **Events typed** as `ThreeEvent<PointerEvent>` / `ThreeEvent<MouseEvent>` from
  `@react-three/fiber`.
- **Color management:** set `texture.colorSpace = THREE.SRGBColorSpace` on color
  maps; emissive/neon needs `toneMapped={false}` (see rule 6).
- **`gl` callback** receives constructor props, not a bare canvas.
- **`<Text>` (drei/troika)** does NOT accept `toneMapped` as a prop — set it on
  the material (`material-toneMapped={false}`) or leave it; this bit us already.

## Where R3F lives in this repo

Current boundaries:

- **Production Fleet Operations Board**
  `src/components/fleet/spatial/operations-board/operations-board-canvas.tsx`,
  composed by `operations-board-surface.tsx` — the real `/fleet/spatial` world
  over the source-agnostic board model. It uses `frameloop="demand"`, bounded
  instancing, DOM-equivalent controls, lazy postprocessing, and one concrete
  resolved spatial-theme snapshot. Deterministic rigs include
  `/eval/t5-operations-board` and `/eval/t10-board-scale`.
- **Spatial DOM chrome**
  `src/components/fleet/spatial/spatial-fleet-client.tsx` — URL altitude,
  search/filter, breadcrumbs, inspector, activity, accessible selection, and
  recovery over the same board state.
- **AgentField regression rigs** `src/components/hud/webgl/agent-field.tsx` —
  retained for `/eval/t3-spatial-sparse` and `/eval/t4-agent-station`, not as a
  second production `/fleet/spatial` wrapper. The obsolete
  `fleet/spatial/agent-field/agent-field-surface.tsx` retired at ENG-032 T5.
- **Marketing hero board**
  `src/components/site/hero-board/hero-board-scene.tsx`, framed by
  `hero-board.tsx` and annotated by `hero-board-overlay.tsx` — the ENG-031 W2
  homepage hero over ONE frozen capture of the Demo Workspace. Three draw calls
  (ground, zones, one `InstancedMesh` for all units), `antialias: false` with
  analytic `fwidth` coverage in the mark shader, DPR capped at 1.5, no
  postprocessing, and a demand loop that renders zero frames while parked. ONE
  camera behaviour: planted at rest, page scroll drives Fleet to Team to Agent
  with distance in log space. It is the one R3F surface with a MEASURED idle
  budget, and that budget is a hard gate: `pnpm eval:hero-board` compares two
  frames a second apart per channel. Rigs: `/eval/t12-hero-board` and
  `/hud-gallery/hero-board`.
  **Its annotation layer is the reference implementation of the DOM/WebGL
  split.** `hero-board-annotations.ts` is a mutable bridge the scene writes and
  the overlay reads: the scene projects world anchors into CSS pixels once per
  rendered frame; the overlay mutates `style.transform` on nodes it already
  owns and keeps React state for semantic identity only (hovered unit, selected
  unit, the capped set of units that own a hit target). Interactivity is DOM
  hit targets, not raycasting, so the instanced field keeps `raycast` disabled
  and stays keyboard-reachable. Copy that pattern before reaching for in-scene
  text or a per-pointer raycast. Note the compiler constraint it forced: React
  forbids mutating a prop object, so the bridge travels as an accessor
  (`HeroBridgeAccess`) and every writer takes a local reference from it.
- **Gallery R3F studies** `src/components/hud/webgl/scenes.tsx` and the retained
  keyswitch study — isolated workbench canvases under `/hud-gallery`. Ortho
  px-space (`zoom 1` ⇒ 1 world unit = 1 CSS px, centered), with `frameloop`
  **default (always)** where the study requires it.

**Architecture (resolved):** WebGL renders the decorative/scalable *world*; ALL
text and ALL interactivity for chrome live in a pixel-aligned **DOM overlay**
(crisp + keyboard-accessible). Keep that split — see decision `0003`.
"One spatial surface" means one route/command model, not one geometry regime at
every altitude. Fleet aggregates; Project reveals readable units; Agent focuses
inspection.

## Non-negotiable rules

**Theme boundary:** production Three code accepts concrete sRGB strings and
numbers from `SpatialThemeSnapshot`; it never parses CSS variables or merges OS
state. Theme/contrast changes update material props and call `invalidate()` on
the existing demand scene—never remounting the canvas or resetting camera,
filters, selection, Project identity, status derivation, or Demo/Live data. Air
must remain complete without bloom; Project identity stays data and is only
contrast-corrected against the resolved ground.

1. **Know your `frameloop`.** `demand` (spatial): `useFrame` runs but nothing
   *paints* without `invalidate()`. Every continuous animation must call
   `state.invalidate()` each frame **while animating** and stop once settled (so
   the scene parks); programmatic changes (selection/resize) must `invalidate()`.
   `always` (gallery): paints every frame — fine for a few small canvases, but
   prefer `demand`+invalidate for many. **A missing `invalidate()` under demand
   is the #1 cause of "it computed but nothing moved."**
2. **Never `setState` inside `useFrame`.** Mutate refs / object3D props directly.
3. **Never allocate inside `useFrame`** (`new THREE.Color/Vector3/Euler`, array
   literals). Hoist to `useMemo`/refs/module scope and mutate in place.
4. **Frame-rate independence — use `delta`.** Accumulate phase as
   `phase += delta * radPerSec`. Continuous easing:
   `THREE.MathUtils.damp(current, target, lambda /*≈6–10*/, delta)`.
   `clock.elapsedTime` is wall-clock so `sin(elapsed*k)` is already fps-independent.
4b. **Split motion by kind — `damp` is not for semantic transitions.** `damp`
   re-aims every frame and never needs to know where it is going, which makes it
   right for motion whose target is still moving: pan, wheel, pinch, follow,
   hover lift, a clamp rubber-band. It is wrong for a transition that several
   things must complete together, for two reasons. It starts at MAXIMUM velocity
   (`lambda x distance` the instant the target changes), and a step change in
   velocity is what reads as a jerk. And it has no duration, so two damped
   owners at different lambdas arrive at different times — the board's camera
   (5.5) and unit field (7.5) diverged 11.4% at peak and finished 0.22s apart.
   A semantic transition (altitude change, reframe, a coordinated reveal) gets
   ONE clock with a real duration and an ease that leaves and arrives at rest,
   and every participating layer samples the same progress. See
   `operations-board-transition.ts` for the board's implementation.
4c. **Interpolate multiplicative quantities in log space.** Camera zoom and
   uniform scale are ratios, not distances: 1 → 2 and 2 → 4 are the same visual
   change. Mixing them linearly front-loads zooming in and back-loads zooming
   out over the same journey — halfway through a linear 1 → 4 the operator has
   already seen two thirds of the change, and 4 → 1 shows a third. Use
   `mixBoardZoom` / `dampBoardZoom`, not `MathUtils.damp`, on zoom and scale.
5. **Clamp first-frame delta** for duration timelines: `Math.min(delta, 0.05)`
   (tab refocus/GC can deliver delta > 1s). `damp` is spike-robust; linear isn't.
6. **Neon + Bloom ⇒ `toneMapped={false}`** on the emissive/accent material.
   three 0.184 ColorManagement + R3F v9 ACES tonemapping clamps/desaturates
   emissive to [0,1] AND drops it below the bloom threshold — so glow goes dull
   AND stops blooming. Keep `luminanceThreshold` high (~0.6) so dark fills/labels
   don't bloom.
7. **Thick lines = drei `<Line>` (Line2).** Core `gl.LINES`/`lineBasicMaterial`
   `linewidth` is hard-capped at 1px. Never rely on `linewidth`.
8. **Transparency:** `opacity < 1` requires `transparent`. `depthWrite={false}`
   on overlapping translucent layers, keep ONE opaque occluder. Step z
   (0.3/0.6/1.0) to avoid z-fighting (`polygonOffset` doesn't work on lines).
9. **Guard data-derived transforms against NaN/Infinity.** One NaN matrix ⇒ NaN
   bounding sphere ⇒ the whole mesh is silently frustum-culled. Gate divisions:
   `const sx = w > 0 ? (w + 7) / w : 1`.
10. **Memoize + dispose geometries/materials.** R3F auto-disposes JSX-primitive
    geometries/materials, NOT `useLoader`/`useGLTF` caches or postprocessing
    render targets. `useMemo` shared geometry; dispose on unmount.
11. **Accessibility:** the `<canvas>` is opaque to assistive tech. Interactivity
    lives in the DOM overlay (focusable, ARIA, keyboard). Mesh interactivity is a
    visual *enhancement* mirroring DOM controls, never the only way to act. Mark
    decorative canvases `aria-hidden`; match `hover:` with `focus-visible:`.
12. **Reduced motion:** gate continuous motion on `useReducedMotion()`. Reduced
    motion kills MOTION, not bloom — a static glow is fine; a pulsing one isn't.
    For damp transitions, SNAP to target when reduced.
13. **Input feel is velocity, not key-repeat or tap kicks.** Held camera input
   damps current velocity toward a target and decays after release. Do not add an
   immediate distance/angle kick before the rAF loop, and do not claim
   CameraControls damping while passing `enableTransition=false` without your
   own velocity smoothing.
14. **Pointer-following DOM must not render React at pointer frequency.** Store
   coordinates in refs and coalesce transform writes through one rAF. State is
   for semantic hover identity, not every cursor pixel.
15. **Stable identity survives filters.** Do not key the field, cluster, or
   animation owner by `agents.length`. Preserve surviving agent/Project state by
   stable IDs and animate actual additions/removals only.

## Motion patterns (zero new deps — `THREE.MathUtils`)

Idle shimmer (delta-phase, settles, demand-safe):
```ts
const mat = useRef<THREE.MeshBasicMaterial>(null);
const phase = useRef(0);
useFrame((state, delta) => {
  if (!mat.current) return;
  if (!shimmer) { mat.current.opacity = glow; return; } // settle to base, then PARK
  phase.current += delta * 2.2;                          // rad/sec
  mat.current.opacity = glow + Math.sin(phase.current) * 0.14;
  state.invalidate();                                    // keep frames coming (demand)
});
```
> **Bug to avoid (was live in console3d Panel):** early-returning
> `if (!shimmer) return` BEFORE resetting opacity freezes the glow mid-sine when
> the gate flips false. Always set the base value on the off-branch, then park.

Hover lift/glow (damp, reduced-motion aware, parks when settled):
```ts
const invalidate = useThree((s) => s.invalidate);
useFrame((state, delta) => {
  if (!ref.current || !mat.current) return;
  const wantScale = hovered ? 1.05 : 1, wantGlow = hovered ? 0.95 : glow;
  if (reduced) { ref.current.scale.setScalar(wantScale); mat.current.opacity = wantGlow; }
  else {
    ref.current.scale.setScalar(THREE.MathUtils.damp(ref.current.scale.x, wantScale, 9, delta));
    mat.current.opacity = THREE.MathUtils.damp(mat.current.opacity, wantGlow, 9, delta);
  }
  if (hovered || Math.abs(ref.current.scale.x - wantScale) > 0.001) state.invalidate();
});
// onPointerOver={(e) => { e.stopPropagation(); setHovered(true); invalidate(); }}
// onPointerOut={() => { setHovered(false); invalidate(); }}
```

## Mesh interactivity (only when geometry IS the surface)

- Handlers `onPointerOver/Out/Move`, `onClick`, Canvas-level `onPointerMissed`.
- `e.stopPropagation()` is **not DOM bubbling** — it also blocks delivery to
  objects BEHIND along the ray (and fires `onPointerOut` on farther hovered
  objects). An opaque card must `stopPropagation()` in `onPointerOver` to occlude
  its own glow/shadow planes.
- `useCursor(hovered)` (drei) sets `document.body.style.cursor`; runs under `<Canvas>`.
- **Cheap raycasting:** disable hits on decorative glow/shadow meshes and drei
  `<Line>`s so only real targets are tested. Use `raycast={() => null}` (a no-op
  fn) — NOT `raycast={null}`: drei `<Line>` (and the strict R3F types) type
  `raycast` as a function, so `null` fails type-check. Under `demand`, raycasting
  only runs on pointer events (a mesh moving under a still cursor won't fire hover).
- Postprocessing does **not** break picking (raycaster runs on scene geometry).
- Under `demand`, call `invalidate()` in the enter/leave handlers or the damp
  tween won't start until the next repaint.

## Scaling to hundreds–thousands

- drei `<Instances limit={N}><geom/><mat/>{items.map(<Instance/>)}</Instances>`
  = one draw call, per-instance color/scale/events. Good to ~5–10k React
  elements; beyond, raw `THREE.InstancedMesh` + `e.intersections[0].instanceId`
  + `setColorAt`. `limit` sizes the GPU buffer (≥ max); `range` caps draw count.
- **Ortho px-space caveat:** `zoom 1` ⇒ DOM overlay is pixel-aligned. Any camera
  zoom/fit (`<Bounds>`, `<CameraControls>`) desyncs it. For ortho `<Bounds>`,
  `fit()` only changes ZOOM — use `reset()` to recenter. True zoom-one→thousands
  means moving content+text INTO the canvas (`<Instances>`, drei `<Text>`) — an
  architecture decision, not a drop-in.

## Bloom / postprocessing

- Keep spatial effects in a separate module behind `React.lazy()` + a low-power
  gate; postprocessing is the heaviest import. Reduced motion does not
  automatically disable a static bloom, but low-power mode does.
- The production Operations Board reads bounded threshold/strength/radius from
  `SpatialThemeSnapshot.bloom`; Air disables bloom, while dark presets may opt
  in. Emissive status/accent materials remain `toneMapped={false}`. Only reach
  for `<Selection>/<Select>` (needs `<EffectComposer autoClear={false}>`) for
  per-object bloom on/off.

## Dependency rules

| Want | Do | Don't |
|---|---|---|
| eased motion | `THREE.MathUtils.damp` (zero dep) | `import { easing } from '@react-three/drei'` (not re-exported in 10.7.7) |
| maath easing | `pnpm add maath` first | bare `import 'maath'` (transitive-only won't resolve) |
| spring feel | usually `damp` is enough | `@react-spring/three` (choppy under demand; v9 conflicts React 19) |
| 3D motion lib | — | `framer-motion-3d` (removed in Motion 12.5; no React 19) |
| stats panel | drei `<Stats>`/`<StatsGl>` (bundles stats-gl v2) | standalone `stats-gl@4` |
| camera framing | `camera-controls` `fitToBox`, `THREE.Box3`, drei ortho auto-fit | hand-derived quaternion/Euler/projection math |

## The 3D-failure rubric (grade your own screenshot against this)

Re-read your Playwright PNG and check: blank/clipped frame · wrong camera
framing · z-fighting / bad occlusion · text-in-3D legibility · bloom blowout
(or no bloom on neon) · aliasing on instanced edges · banding · contrast against
the active theme's final composited ground. **Zero-credit if the canvas is blank
or the console logged a WebGL / shader error.** "Does it look good?" is not a
review — grade the axes.

## Self-check routine (run after EVERY R3F change, before "done")

Use `pnpm eval:r3f` (the checked-in eval, `scripts/r3f-eval/`) and/or a Playwright
shot. Rules:
- `goto(url, { waitUntil: 'load' })` — **NOT** `networkidle` (never fires on a
  streaming/polling app; doesn't guarantee a painted frame).
- Then `waitForFunction(() => { const c=document.querySelector('canvas'); return c && c.width>0 && c.height>0 })`, then a **double rAF**.
- Capture `page.on('pageerror')` + `console` type `error` BEFORE `goto`. Treat
  `webglcontextlost` / null context / `THREE.WebGLProgram` / `shader` / `GL_INVALID`
  as HARD FAIL.
- **Blank detection:** decode the canvas PNG (or set `gl={{ preserveDrawingBuffer: true }}`
  in eval builds and read pixels) and assert a 9-point grid has variance. Don't
  rely on `canvas.toDataURL()` without `preserveDrawingBuffer` (buffer is cleared
  after compositing).
- **Demand scenes:** force a paint before the screenshot (`advance(performance.now())`
  or trigger a tracked prop) — `advance` is more deterministic than `invalidate`.
- **Animation check:** two shots ~700ms apart (or a deterministic injected tick),
  per-pixel tolerance for AA noise → diff > threshold when animating, ~0 when
  reduced-motion-gated.
- **Draw calls (perf):** read `renderer.info.render.calls` (e.g. via a
  window-exposed `gl`). Instanced fields must stay ~1 draw call regardless of N.

## Prompting playbook (for the operator)

- **Spec-first:** before any code, state target look (+ ref image), camera
  framing & units, perf budget (fps, draw-call ceiling, ≤3 lights, dpr [1,2]),
  a11y/keyboard need, and corner cases (reduced-motion, low-power, empty data).
- **Name versions** in the prompt (the list above) and tell the agent to verify
  the API against installed versions / Context7 before non-trivial API code.
- **Decompose:** one verifiable component at a time, perfected in isolation in
  `/hud-gallery`, before assembling a screen. Never ask for whole-screen blind
  generation (it garbles — repo's own lesson).
- **Greybox first:** solid-material output that PROVES it renders + hits budget,
  then add materials/lighting/postprocessing. For shaders, bisect: solid color →
  uniforms → coordinate map → effect.
- **Ban hand-derived 3D math** — require `fitToBox` / `Box3` / `MathUtils.damp`.
- **Make the agent name the abstraction** it'll use up front (`<Instances>`,
  lazy `<Bloom>`) so wrong choices surface before code.
- **Structured screenshot review** against the rubric above, not "looks good?".
- **Cap the refine loop at ~2 passes** (gains diminish hard after cycle 2 while
  token cost balloons), then switch to **best-of-N** across saved candidates.
- **For aesthetic tuning, expose tunable params** (a small panel / table) so you
  dial values directly instead of round-tripping text — the ~10x bottleneck.

## Test-time strategy (how the agent should work, not which model)

Stay on the primary model; add **test-time compute**, not a vendor swap:
- **Vision-critic pass:** after building, the agent re-reads its own screenshot
  and grades pixels against the rubric as an explicit, blocking step. Keep the
  *visual* verdict separate from the *code* edit. If a defect persists, switch
  the critic's persona ("review as a motion designer", then "as a perf
  engineer") rather than re-running the identical prompt.
- **Best-of-N + a real verifier** for hard surfaces (shaders, dense instanced
  scenes): generate 2–3 variants, screenshot all, keep the one that passes
  type-check + build + non-blank render + highest rubric score. Without an
  executable verifier, best-of-N collapses to a vibe check.
- **Shaders:** unreliable for every model — budget a compile+render retry loop;
  greybox in standard materials/GLSL first. (TSL/WebGPU: training data is
  near-empty — force docs retrieval, never trust recalled APIs.)

## Top traps (never repeat)

- Missing `invalidate()` under demand → "computed but never painted / froze."
- Early-return in `useFrame` before settling the animated value → frozen mid-anim.
- Missing `toneMapped={false}` → dull, non-blooming neon.
- `setState` / allocation in `useFrame`.
- Raw lines for thick strokes; decorative meshes left raycastable.
- NaN transform silently culling a whole mesh.
- `networkidle` waits in the self-check (never fires here).
- Bare-importing `maath`/`easing`; reaching for `@react-spring/three` / `framer-motion-3d`.
