# Design system of record — the kernel (ENG-036 G0)

Created 2026-08-02 from a measured audit of the shipped UI (`src/components`, `src/app` at `f3efd83`). **Substrate note:** every count in this document is pinned at `f3efd83`; the `8ddd9f2` legacy retirement (-8,032 lines) landed after the audit, so re-measurements will differ (e.g. `text-sm` 219 → 137). The scale and the rules stand regardless of the counts — the numbers are evidence of what the taste was, not live telemetry. This document is **descriptive, not aspirational**: it writes down the taste the product already carries and that survived operator review. It does not redesign anything (ENG-032 owns a new visual identity; this owns the substrate).

**How to use it:** read this before building or changing any surface. Pick every font size, color role, spacing step, and status mark by citing a rung in this document. If no rung fits, you are either off-scale (fix your choice) or improving the system (amend this document — see [The amendment rule](#the-amendment-rule)).

Scope of G0: type scale, spacing steps, color roles, status iconography, and the `/hud-gallery` merge/retire decision list. Motion vocabulary, component contracts, and IA principles land in G2; the gallery merge itself is G1; the review gate is G3.

---

## Type

### Families

Declared in `src/app/layout.tsx` and mapped in `src/app/globals.css` `@theme`.
ENG-032 T2 adds a resolved `data-exa-typography` profile under the global
`data-exa-font` override:

| Utility / profile     | Face                                | Where it is used                                         |
| --------------------- | ----------------------------------- | -------------------------------------------------------- |
| Classic theme default | Exo 2 shell/body + Geist UI/display | compatibility rendering of the shipped product           |
| Air theme default     | system shell/UI + Geist display     | lighter native-feeling application chrome                |
| Night theme default   | Geist shell/UI/display              | calm dark application chrome                             |
| System override       | system shell/UI/display             | app-global interface-family override                     |
| Geist override        | Geist shell/UI/display              | deterministic bundled interface-family override          |
| `font-mono`           | Geist Mono                          | metrics, ordinals, tracked micro-labels, code (302 uses) |

App surfaces set `font-ui` on their root; numbers and micro-labels go
`font-mono`. Terminal typography remains a separate setting and never follows
the interface profile. No preset adds a font binary, local-font permission, or
runtime network fetch.

### The named scale

The core of the scale is the **D39 chrome type roles**, already tokens in `globals.css` (`--text-chrome-*`, 148 usages), extended by the Tailwind named sizes the app uses correctly. All 12 rungs have named utilities — the four that existed only as bracketed sizes at the audit (nano, reading, surface-title, display) were minted as `@theme` tokens alongside the chrome roles:

| Rung          | px / line | Utility                           | Use for                                                                                                                                                |
| ------------- | --------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| nano          | 9 / 1     | `text-chrome-nano`                | ordinal digits and symbolic glyphs only, in the densest chrome (tab-strip ordinals, roadmap-rail counts); always `font-mono`; never words or sentences |
| chrome-micro  | 10 / 14   | `text-chrome-micro`               | nonessential shortcut ordinals, uppercase tracked micro-labels; never the primary reading path (D39)                                                   |
| chrome-meta   | 11 / 16   | `text-chrome-meta`                | secondary metadata lines in chrome                                                                                                                     |
| chrome-label  | 12 / 16   | `text-chrome-label` (≈ `text-xs`) | standard chrome labels, small buttons, chips                                                                                                           |
| chrome-title  | 13 / 18   | `text-chrome-title`               | row and panel titles in chrome                                                                                                                         |
| body          | 14 / 20   | `text-sm`                         | default reading and control size (219 uses; shadcn buttons/inputs)                                                                                     |
| reading       | 15        | `text-reading`                    | expository prose on settings and consumption surfaces                                                                                                  |
| title         | 16        | `text-base`                       | emphasized in-surface titles                                                                                                                           |
| section       | 18        | `text-lg`                         | section headings                                                                                                                                       |
| surface-title | 20        | `text-surface-title`              | a surface's h1 (settings, labs)                                                                                                                        |
| display       | 22        | `text-display`                    | hero numbers and top-level headings on dense surfaces                                                                                                  |
| marketing     | 24+       | `text-2xl` … `text-4xl`           | marketing/site pages only, never app chrome                                                                                                            |
| site-closing  | 72        | `text-7xl` (`text-5xl` under `sm`) | the homepage closing band ONLY (ENG-031); the largest type on the page, one per page, never app chrome                                                  |

Weights: `font-medium` for labels/controls, `font-semibold` for titles/headings (164/163 uses — the two workhorses); `font-bold` is rare and stays rare. Uppercase is legal **only** on mono micro-labels ≤ 11px with wide tracking (`tracking-[0.1em]`–`[0.18em]`) — the established HUD label idiom; never on sentences or headings.

The app-global interface scale multiplies every application rung from
`text-chrome-nano` through `text-display`, including Tailwind's `text-xs`,
`text-sm`, `text-base`, and `text-lg` control/body rungs. Nano is clamped to the
9px floor. Marketing sizes, spacing, geometry, motion, and terminal metrics do
not scale with this preference.

### Off-scale register (measured 2026-08-02)

The roadmap's founding measurement was 17 distinct hardcoded pixel sizes; this audit found it has already drifted to **23 in `src`** (21 on production surfaces excluding `/hud-gallery` and `/eval`). That drift in under a day is the reason this document exists. The named scale above reduces them to 12 rungs. Everything else is off-scale:

| Off-scale size | Where | Disposition |
| --- | --- | --- |
| `text-[8px]` | `src/components/fleet/spatial/operations-board/operations-board-surface.tsx`, keyswitch study, gallery | below the 9px floor; migrate to nano/chrome-micro on next deliberate touch |
| `text-[11.5px]`–`[16.5px]` (the ENG-008 fractional scale) | **cleared 2026-08-03** — left `src` with the E8 rebuild, the ENG-032 T3C type migration, and the consumption study retirement | none remain in `src`; do not reintroduce fractional sizes |
| `text-[17px]`, `[19px]`, `[25px]`, `[26px]`, `[28px]` | **cleared 2026-08-03** — the last uses left with the agent-sources lab (G1), the E8 rebuild, and the consumption study retirement | none remain in `src`; do not reintroduce |
| raw `text-[10px]`–`[15px]` px literals (295 uses app-wide; 217 excluding gallery + eval) | app-wide | same values as the named rungs — not visually wrong, but written as magic numbers. Use the named utilities (`text-chrome-*`, `text-sm`, `text-reading`) in all new code; migrate opportunistically |

Rule: **new code never introduces a bracketed pixel font size.** If a rung is missing, amend the scale here first.

---

## Spacing

The app is on the Tailwind 4px grid with half-steps for dense chrome. Steps in real use (by frequency): **2, 4, 6, 8, 10, 12, 16, 20, 24, 32px** (`0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8`). Arbitrary bracketed spacing values are as off-scale as bracketed font sizes.

Density tiers as shipped:

| Context                                       | Padding                                             | Gap                                    |
| --------------------------------------------- | --------------------------------------------------- | -------------------------------------- |
| chip / badge / pill                           | `px-1.5`–`px-2` `py-0.5`                            | `gap-1`–`gap-1.5`                      |
| dense chrome row (tab strip, rail, list rows) | `px-2`–`px-3` `py-1`–`py-1.5`                       | `gap-1.5`–`gap-2`                      |
| control / button                              | shadcn sizes: `h-8 px-3` (sm), `h-9 px-4` (default) | `gap-2`                                |
| operational card / HUD panel                  | `p-3`–`p-4` (`.hud-panel` = 16px)                   | `gap-2`–`gap-3`                        |
| reading card / settings panel                 | `px-5 py-4`–`py-5`                                  | `gap-3`–`gap-4`                        |
| marketing / auth card (shadcn `Card`)         | `p-6`                                               | `gap-4`                                |
| page gutter                                   | `px-6`–`px-8`; labs and settings `p-8`              | sections `gap-5`–`gap-6` / `space-y-6` |

Default answers for a new app surface: **card padding `p-4`** for operational content, `px-5 py-4` when the card is mostly prose; sibling elements `gap-2`; related blocks `gap-3`/`gap-4`; sections `space-y-6`.

Radii: `rounded` (4px) is the chrome default (135 uses; 165 including `rounded-sm`); `rounded-md` (6px) buttons/inputs (shadcn); `rounded-lg` (8px) panels and cards; `rounded-full` pills, dots, identity marks. `rounded-xl`+ is rare and stays rare. HUD panels may instead use the chamfered clip-path corners (`chamferPolygon`, leg 12px, `src/components/hud/tokens.ts`) — chamfer and rounded corners never mix on one element.

---

## Color roles

Production supports **Classic, Air, and Night** through ENG-032's app-global
appearance resolver. Fresh state follows the OS with the Auto Air/Night pair;
Manual pins any production preset; Classic remains the compatibility and
recovery path. New or migrated presentation must consume generated semantic
roles and must never assume a fixed light or dark ground. Color is organized as
one semantic layer plus three scoped operational palettes and two reserved
channels. The channel-ownership rule is load-bearing:
**status owns the five D40 signal roles; chrome attention owns its dedicated
attention role; Consumption owns the calm→hot ramp; Project identity is its own
channel and is never a status signal.**

`AppearanceProvider` resolves one immutable snapshot for DOM/CSS, xterm,
R3F/Three, and Electron boot/native adapters. Theme defaults for action,
typography, and material sit beneath the app-global system-accent and interface
font/scale overlays. OS contrast, forced-color, inversion, and reduced-
transparency signals remain automatic accessibility inputs, not saved manual
preferences. Status,
action, Consumption, readiness, and Project-identity ownership do not change
with the selected ground; themes never own spacing, geometry, density, motion,
or Demo/Live state.

### 1. Semantic chrome (shadcn variables, `globals.css`)

Default for all standard UI: `bg-background`, `text-foreground`, `bg-card`, `border-border`, etc.

- **Muted text**: `text-muted-foreground` (`#a3a3a3` dark) — the default secondary-text answer on any standard surface.
- **Action color (D32 amended by ENG-032, one button system)**: `--primary` is the active preset's action role (Classic: HUD cyan `#19E6FF`). The global `accentSource: system` overlay may replace it with the operator's macOS accent after runtime contrast correction; it is no longer an unconditional root mutation. Exactly one shadcn button recipe app-wide: `default` = accent-filled primary action, `outline` = neutral, `ghost` = icon buttons (`src/components/ui/button.tsx`). Project color is never an action color.

### 2. HUD operational palette (fleet/workspace surfaces)

Authority: `themes/v1` plus the generated registry/CSS projections. DOM uses
generated `hud-*` variables, and production WebGL consumes concrete values from
the resolved renderer snapshot. `src/components/hud/tokens.ts` remains a
bounded Classic compatibility authority for legacy/eval renderer helpers; it is
not a second source to mirror manually. The values below are Classic exemplars.

- Grounds: `hud-void #04060B` → `hud-deep #070B14` → `hud-panel #0B1220`.
- Text: `hud-text #DCEBFF`; **muted on HUD surfaces**: `hud-text-dim #8AA0BE`.
- Accents: cyan `#19E6FF`, cyan-2 `#55EAD4`, magenta `#FF3B8B`, amber `#FFB02E` (attention), red `#FF1F4B`, green `#6FE39F`, idle `#6A7585`.
- Strokes are cyan-alpha (`HUD.stroke/strokeSoft/strokeFaint/divider`).

### 3. Settings operational neutrals (`[data-settings-shell]`)

Graduated from the gallery: calmer scoped palette for dense source-truth surfaces (`--settings-*` in `globals.css`). Text ladder: `--settings-text` → `-soft` → `-dim` → `-faint`; accents teal/amber/red with matching `-wash` fills. Use it only inside the settings shell.

### 4. Consumption channel

The semantic calm → mid → warm → hot ramp is deliberately disjoint from status
colors so a hot meter can never read as an Agent needing you. DOM and production
R3F paint come from the active theme's generated Consumption roles.
`src/components/consumption/flux.ts` retains the concrete Classic ramp and
interpolation/formatting helpers, not universal production paint. “Unknown” is
a neutral hatched data state—**never a fill or a zero**. Only Consumption
surfaces use this channel.

**Hatch meanings (closed set of three — do not mint a fourth):** −45° in the
unknown grey = *unreported* (`unknownHatch`); −45° in the ramp color =
*projection*, where the fill lands if the pace holds (`projectionHatch`);
+45° in neutral chrome ink at a sparser 7px period = *expiry*, the region of
a pace bar that dies unused if the pace holds (`expiryHatch`, ENG-008 E9 —
`/usage` bars only, never the popover mini bars). The three separate on
angle, ink, and density at once, because at 6px bar heights no single cue
survives alone.

### Project identity

`PROJECT_PALETTE` (`src/components/workspace/project-colors.ts`), assigned via `pickDistinctColor`. Identity appears as thin vertical bars, zone edges, and emblems — **identity-only** (D30/D32): never a lamp, never a status, never a button color.

### Agent Source identity

Agent Source brand colors are stable data, not readable foreground roles. A
source color may paint only its glyph inside `SourceIdentityMark`'s fixed dark
instrument plate; adjacent names, metadata, menu rows, and controls use the
active semantic text roles. Every first-party source glyph clears 4.5:1 on the
plate, and the plate boundary clears 3:1. Never apply a source brand color to a
text-bearing ancestor—the Air preset is the regression oracle for this rule.

---

## Status iconography

Canonical and already fully tokenized—**do not invent new status marks.**
`src/components/status-light/protocol.ts` owns state vocabulary, priority, and
derivation; `src/components/workspace/status-glyphs.tsx` owns Session glyph
shape; the active theme's generated `status.*` roles own paint. Classic values
in protocol/HUD helpers are compatibility metadata, not universal colors.

**D40 five-signal protocol** — one source-agnostic projection across Agent tabs, the Team overview/switcher, and the Fleet board:

| State     | Theme role (Classic exemplar) | Meaning                                     | Priority |
| --------- | ----------------------------- | ------------------------------------------- | -------- |
| Off       | `status.off` (`#DCE5ED`)      | idle, new, or quietly waiting               | 0        |
| Active    | `status.active` (`#9CD5FE`)   | reasoning, streaming, tools                 | 1        |
| Result    | `status.result` (`#9BF396`)   | turn finished, result waiting               | 2        |
| Needs you | `status.needsYou` (`#FFD0B8`) | approval / question / credential / Decision | 3        |
| Fault     | `status.fault` (`#FF7373`)    | failed or intervention required             | 4        |

Standing rules, all operator-reviewed:

- **Only Active moves**: the half-fill turns once per **2.4s** (`STATUS_LIGHT_ACTIVE_ROTATION_SECONDS`) identically in DOM and R3F; reduced-motion and low-power render the same static mark. Human gates and faults **never pulse** (D33 calm attention: the attention mark is a static amber dot-in-circle with an explicit hover tooltip).
- **Redundant channels (D30, per Carbon)**: every state carries at least three of shape / icon / color / text — hue never carries the signal alone.
- **Constant footprint**: glyphs render in a fixed box so state changes never nudge a row.
- Delegated-child dots breathe at 2600ms, staggered, capped at `DELEGATION_DOT_CAP` — context for the light, never a competing signal (ENG-023).
- On the Fleet board, protocol color lives **only** in each Agent's light; Project identity stays on zone edges (decision `0007` restraint).

Motion beyond status (pointer for G2): the house easing is `cubic-bezier(0.22, 1, 0.36, 1)`, interaction transitions 160–260ms, and **every** animation has a `prefers-reduced-motion` gate — no exceptions exist today; do not create the first.

---

## Voice

Every user-visible string is written for a production user of a top-tier product — the register Salesforce, Linear, or Stripe would use on the same screen (operator correction, 2026-08-03: "We need to always be designing for production audiences, not spewing documentation text into the app. In general."). The interface demonstrates; it does not narrate.

- **Nouns, values, states, short labels.** Headings name the thing on screen ("Members and roles", "Capacity"), cells carry values, and state is carried by product state — badges, counts, empty states — not by sentences about the state.
- **No thesis sentences.** The UI never argues its own design ("X is the boundary; Y is where … meet it"). If a sentence explains the product or its philosophy to the reader, it belongs in `docs/`, not on a surface.
- **No rhetorical framing.** No "Asked by users:" blocks, no quotes-as-headers, no question the page then answers in prose. A recurring user question is answered by showing the product state that answers it, under a plain noun heading.
- **No self-reference.** A surface never explains what it is, why it exists, how it was designed, or what corpus it was measured against. Provenance and methodology live in docs and code comments.
- **Preview surfaces show honest product-shaped UI** — real labels, marked representative data, empty states, Coming soon markers — never essays about the future capability. The readiness grammar (marker, chip, dashed block) carries the honesty; the copy stays product copy.
- **When tempted to explain, show a concrete product state instead.** The prose ceiling on an operational surface is a caption: one `text-chrome-meta` line stating a fact about the data on screen (a legend, a definition, a privacy or assurance fact). Multi-sentence expository paragraphs are off-voice the way bracketed pixel sizes are off-scale.

Honesty markers are product UI and stay: **Coming soon**, Demo banners, "not recorded", "unreported", assurance facet labels. They state facts in short form; they do not editorialize about them.

**Machine-authored operator text is in scope too** (partner conversation `2026-08-04-dan-rosenberg`, operator-accepted 2026-08-04). Prose the product generates rather than an author writing it — context labels, recaps, roadmap item copy, summaries an Agent renders into a surface — obeys the same Voice rules plus one more: **the first line carries the conclusion.** A generated block leads with what it is or what happened, in a phrase, before any supporting detail; supporting detail may follow, but never first. Length is not evidence of rigor. The failure this rule names is specific and was observed cold by a first-time viewer of the Team and Roadmap altitudes: dense, unranked, generated text where "there's a lot of good info here, but I don't even know where to look." That is a hierarchy defect, not a density preference — the fix is ranking the content, not deleting it. `AGENTS.md` carries the same contract for text agents write outside the product.

---

## Building a new page — the short answer

- Root: `font-ui`, semantic chrome tokens (`bg-background text-foreground`), no hardcoded ground.
- Body text `text-sm`; chrome labels `text-chrome-label`; metadata `text-chrome-meta`; h1 `text-surface-title font-semibold`; secondary text `text-muted-foreground` (or `hud-text-dim` on a HUD surface).
- Cards: `rounded-lg border border-border p-4` (operational) or `px-5 py-4` (prose); sections `space-y-6`; page gutter `px-8`.
- Buttons: the shadcn `Button` recipe only — `default` for the one primary action, `outline` neutral, `ghost` icons.
- Status: `StatusLight` / `status-glyphs`, never a bespoke dot.

---

## `/hud-gallery` audit — G0 decisions (G1 executes)

The gallery has been the de facto design system. With this document as the written source of truth, the gallery survives only as the **live workbench that renders the system** (roadmap ENG-036; operator 2026-08-02). Decisions per route/section, from a full audit of `src/app/hud-gallery`:

| Route / section                                                                                                                                        | Decision                                                                           | Grounds                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/hud-gallery` — HUD atom sections (Frames, Corner brackets, Labels & readouts, Stat bars, Ring gauges, Status pills, Composed panel) + WebGL siblings | **Merge** — keep as the workbench render of the shipped `@/components/hud` library | atoms are production components (36 importing files: consumption, roadmap, workspace, shortcuts, spatial)                                                                                                                                                                            |
| `/hud-gallery` — Agent status lights (DOM specimens + R3F scene + protocol legend)                                                                     | **Merge** — keep; canonical D40 review surface                                     | the protocol is canon; DOM+R3F sibling rule lives here                                                                                                                                                                                                                               |
| `/hud-gallery` — Elastic Project ribbon study                                                                                                          | **Keep**                                                                           | study of the shipped ribbon (decision `0022`), still the review bench for ribbon changes                                                                                                                                                                                             |
| `/hud-gallery` — Session state tiles                                                                                                                   | **Keep (open review candidate)**                                                   | prototyped for operator review, not yet accepted or rejected                                                                                                                                                                                                                         |
| `/hud-gallery` — Quick feedback capture study                                                                                                          | **Retire**                                                                         | shipped app-wide (ENG-025 F2, mounted via shortcut provider); the gallery section imports the production components, so it cannot drift from them — only from their real mounting context — and duplicates a live surface for no review value                                        |
| `/hud-gallery` — Session context label feedback study                                                                                                  | **Retire**                                                                         | shipped in the tab strip; same drift argument                                                                                                                                                                                                                                        |
| `/hud-gallery` — R3F keyswitch material studies                                                                                                        | **Keep** — restored by operator review (decision `0025`)                           | active material workbench for physical command controls; the production home command key and T8/T9 rigs retain the shared R3F machinery. The unused DOM `.tactile-key` sibling and global CSS remain retired                                                                         |
| `/hud-gallery#theme-system` + `/hud-gallery/theme-system`                                                                                              | **Retired at ENG-032 T5**                                                          | Classic/Air/Night, production adapters, and picker shipped; the temporary routes, components, T12 specimen, and evaluator retired so shipped surfaces remain the review target                                                                                                       |
| `/hud-gallery/agent-field`                                                                                                                             | **Retire**                                                                         | pre–Operations-Board scale demo; the shared R3F machinery it exercises is already production (`operations-board-surface`), and `/eval/t3-spatial-sparse` + `/eval/t4-agent-station` are the deterministic rigs. ENG-004 V3.1 (P5) does demo-scale work on the real surface, not here |
| `/hud-gallery/agent-sources`                                                                                                                           | **Retire**                                                                         | graduated to production `/settings` (settings shell + `agent-sources-settings.tsx`); the 1,182-line lab duplicates a shipped surface and carries its own off-scale type (17/22/25/28px)                                                                                              |
| `/hud-gallery/consumption-lab` | **Retired 2026-08-03** (pulled forward from the planned E5 fold-in) | its subject shipped as `/usage` (E8); a study of a shipped surface only drifts. `/hud-gallery/consumption-redesign` and the `#ambient-consumption-meter` four-form study retired in the same pass once the operator picks (composite page, bar meter form) were live |
| `/hud-gallery/roadmap-lab`                                                                                                                             | **Keep**                                                                           | deterministic review rig driving the shipped strip/rail through the real parser against canned states — exactly the workbench role                                                                                                                                                   |
| `/hud-gallery/project-ribbon` + `/project-ribbon/bench`                                                                                                | **Keep**                                                                           | active dogfood bench (ENG-016 D42, 2026-08-02 round)                                                                                                                                                                                                                                 |
| `/hud-gallery/agent-launcher`                                                                                                                          | **Keep**                                                                           | deterministic D49 state/interaction rig rendering the production `AgentLauncher`; browser gates cover stable skeleton geometry, card overflow, drawer attachment, and keyboard focus handoff                                                                                         |
| `/hud-gallery/paused-agent`                                                                                                                            | **Keep**                                                                           | ENG-016 BUG-012/013: the state matrix for the paused-Agent record, driven by an injected bridge so it needs no Electron; `eval:workspace:paused` runs here                                                                                                                                        |
| `/hud-gallery/team-order`                                                                                                                              | **Keep (active review candidate)**                                                 | ENG-015 S6.3: the deterministic rig for shipped Team ordering — the real overlay driven through its production Active-first switch; `eval:workspace:team` runs here (ribbon-bench precedent)                                                                                                                                       |
| `/hud-gallery/goal-visuals`                                                                                                                            | **Keep (active review candidate)**                                                 | full-card-only matrix holding three goal identities constant across Graphic Form plus six metaphor-led languages; retire after one visual language ships                                                                                                                             |
| `/hud-gallery/usage-directions` | **Keep (active review candidate)** | ENG-008 E12: three vendor-multiplexer directions over ONE frozen real capture of this machine, six states each, deep-linked `?d=&s=`; the honesty machinery (monotonicity over the headline, the broken/settled split, drawn residuals, glance-is-a-projection) is unit-pinned in `model.test.ts`. Retire once a direction ships to `/usage` |

G1 also amends `AGENTS.md`'s "canonical component workbench" rule: the workbench prototypes and renders; **this document is the source of design truth.** G1 executed this list on 2026-08-02 (see the amendment log); the table above stands as the record of what was decided and why.

---

## The amendment rule

This system is agentically malleable the same way decision records are. A UI change has exactly two legal relationships to this document:

1. **Adhere** — every type, spacing, color, and status choice cites a rung here.
2. **Deliberately improve** — the change breaks a rule on purpose because the new thing is better. Then, in the same change: update the affected section, add a dated entry to the amendment log below saying what changed and why, and include the screenshot evidence that shows the improvement. Deliberate improvement is the point; **silent divergence is the failure.**

Never fork a parallel convention (a new fractional type scale, a fifth palette, a second button recipe) without recording it here — the consumption fractional scale and the 17→23 size drift are the cautionary precedents.

### Route paint continuity

Flash-free paint is a renderer-lifecycle invariant, not only a startup rule.
Client navigation between surfaces must not expose the root default, an
unrelated theme ground, or route-local shared-chrome styles between unmount and
mount. Shared chrome belongs to a route-stable owner; a fixed-ground public
surface owns an explicit opaque loading fallback. Themes never acquire motion
or transition ownership by being used as a full-viewport decorative cover.

The default cross-route treatment is no full-screen transition. A future cover
requires one owner across the complete handoff, a ground explicitly compatible
with both surfaces, reduced-motion behavior, and browser-pixel evidence under
Auto light and dark. Initial-load screenshots and final-state DOM assertions do
not satisfy this gate; drive the real control and sample the pending/commit
frames.

### Public exhibition presentation boundary

Home and the public Architecture map are fixed exhibition surfaces outside the
app appearance canvas. Their semantic boundary owns the whole presentation—not
only a dark background: System sans, 100% type scale, route-stable opaque shared
chrome, and a same-ground pending state. Explicit `font-mono` roles remain Geist
Mono. App-global theme family/scale changes may continue underneath but must not
change any public-exhibition text metric.

Do not implement this through a route-local `<style>` element or by pinning one
text node. Content, header/footer, and pending UI opt into the shared semantic
boundary. `eval:typography-stability` must hold identical computed metrics while
Air/Classic/Night and 90/100/120% app-root inputs are deliberately perturbed.

### Appearance snapshot consistency

An application surface consumes one resolved appearance snapshot at a time.
Local preview/commit/cancel intent is immediate. Preference or OS/native events
originating outside the current React tree are transport streams: coalesce them
for 250 ms, publish only the final validated snapshot, and retain object
identity when its semantic value did not change. A web storage subscriber does
not rewrite its input; Electron may mirror the final settled settings snapshot
for the next first paint without writing back to the settings source.

Theme-aware surfaces should not pin local typography or paint to hide source
churn. The Goal Visuals workbench remains theme-aware because it reviews the
real Team tile; `eval:goal-visuals-stability` proves that 60 cross-tab
Air/Classic/Night and 90–120% writes produce only an initial and final root
snapshot, never an intermediate layout storm.

### Amendment log

- 2026-08-17 — ENG-031 W3 fold and close. **The `site-closing` rung is now
  RENDERED, and measured.** All four copy variants compute the closing line to
  exactly 72px / 72px / weight 700 at 1440x900 and 390x844, DPR 2, which is 4x
  the 18px `section` rung and mid-window of the measured 3x-to-7x band; the
  fold headline measures 60px, the subhead 20px, the kicker 16px, and the
  download requirement 12px mono. Every one of those still resolves
  `-apple-system`, so the ENG-032 T5.3 public-exhibition typography boundary
  survives the new components. Three rules recorded, no new rung. (1) **A
  sentence is never set in mono.** Mono is reserved for tracked micro-labels at
  11px and below, the HUD label idiom. The fold's vision kicker was first built
  at 12px Geist Mono and read as a code comment; it is now 14/16px in the
  reading face. Mono keeps the download requirement, which is a machine fact
  and not a sentence. (2) **The marketing fold's primary CTA is white on the
  authored dark ground**, not `--primary`. The marketing site runs one fixed
  register and does not inherit an app token that moves with the theme
  contract. It is flat, hit-testable, keyboard-focusable DOM, never a mesh.
  (3) **A band's copy budget counts reading copy.** `bandCopyWords()` excludes
  any subtree marked `data-band-affordance`, which is how the reference cohort
  was measured and what the closing constraint states outright ("10 words or
  fewer, and repeats the fold's buttons"). Conversion affordances are governed
  by their own rule instead: the download names the OS and states its
  requirement at the button.

- 2026-08-16 — ENG-031 W1 homepage band system
  (`src/components/site/bands/`). **The marketing register gains one rung
  above `text-4xl`: `site-closing` at 72px.** The 16-site measurement that
  shapes the site overhaul is unambiguous that loudness is spent at the END of
  a page, never the beginning: section headings stay small, and the closing CTA
  runs 3x to 7x the section-heading size at 10 words or fewer. Our section
  heading on a band is the existing 18px `section` rung, so the closing band
  needs 54px to 126px and no existing rung reaches it; `text-4xl` is 2x and
  lands inside the "premium feeling, no downloads" failure the study measured.
  72px is 4x, mid-window, and `text-5xl` under `sm` keeps it on one line on a
  phone. It is scoped by construction: `BandHeadingRole` allows exactly one
  `closing` band per page and a unit test enforces it, so this cannot become a
  general marketing size. No new colour, spacing, or motion rung, and the app
  register is untouched. The rung is DECLARED by W1 and first RENDERED by W3,
  which owns the closing copy and therefore owes the browser-pixel evidence;
  W1 shipped with before/after geometry proving the existing fold renders
  identically (every rect and computed font equal at 1440x900, 844x390 and
  390x844; desktop and portrait screenshots byte-identical). One lesson worth
  carrying: a shared component must not default a `leading-*` utility, because
  tailwind-merge treats a caller's `text-*` as conflicting with it and drops
  the base leading silently. Size and leading travel together.

- 2026-08-14 — ENG-008 E12 usage-multiplexer design options
  (`/hud-gallery/usage-directions`, gallery-only, awaiting the operator's
  pick). One amendment, no new type, colour, or spacing rungs. **The `/usage`
  six-role treatment budget gains a seventh role: the VERDICT.** The budget
  was written when the page's glance zone was a number (`Num`, mono display
  numeral); a multiplexer's two-second answer is a verdict in WORDS —
  "Runs out before reset", "Tight", "Clear" — which no existing role fits:
  `Num` is mono and numeric, `Body` is 14px and disappears beside a display
  numeral. The verdict is `text-display font-semibold` in the interface face,
  an existing named rung, coloured only by data state (neutral, or the
  Consumption channel's hot when a window genuinely overheats). It is
  singular by construction — one per surface, first in reading order — so it
  cannot proliferate the way the pre-hierarchy-pass treatments did.
  Everything else in the study renders through the existing six roles.
  Channel discipline is unchanged and was the constraint that shaped the row
  states: the CHROME ATTENTION role (amber) marks exactly one row state, the
  one with a repair verb; a source that is legitimately unavailable for this
  account uses the Consumption unknown grey and product language, because a
  red dot that is always on trains the operator to ignore red dots. Absence
  draws the existing −45° unreported hatch at the same height as a tape, so
  row geometry is fixed through success and failure. Evidence:
  `/tmp/exawatt-e12-shots/` and `/tmp/exawatt-e12-shots-night/` (3 directions
  × 6 states, both grounds) and the E12 entry in the ENG-008 project doc.

- 2026-08-11 — ENG-008 E9 pace opportunity (operator pick: C + B). Two
  amendments, no new type/color/spacing rungs. (1) **The shared pace
  vocabulary re-frames itself**: when the opportunity trigger fires
  (healthy|warm ∧ behind ∧ floor ≥ 15 pts ∧ reset ≥ 30m, in `meter-model`),
  `paceSentence`/`paceLabel` swap the deficit reading for free-to-spend
  ("72% free · expires in 9h" / "72% free to spend"), a closing-tier coach
  line shares the hot remediation's slot behind one arbiter where hot always
  outranks, and `/usage` alone may carry a one-line closed-cycle ledger
  caption. All of it reuses the existing six `/usage` roles and the
  popover's existing text tones; the only emphasis move is a caption
  brightening dim → text at the closing tier. The alarm channel is
  untouched — opportunity never colors. (2) **A third hatch meaning**,
  recorded in the Consumption channel section above: the +45° neutral
  expiry hatch on `/usage` pace bars. The study flagged the texture
  collision as B's cost; resolved by separating on three simultaneous cues
  (angle vs both −45° textures, neutral ink vs ramp/unknown, and a sparser
  7px period vs 4.5/5px — widened from the study's 5px after page-scale
  review). Popover mini bars never draw it (the study's finding that 4px
  regions are unreadable stands). Evidence: `/tmp/exawatt-e9-ship-shots/`
  Night + Air crops beside the unreported channel, and the live-data run in
  the E9 ship milestone log.

- 2026-08-07 — ENG-016 D50 pinned Project header: a scrolled ribbon now holds
  the current Project's header at the left edge while its tabs pass beneath
  it. This introduces one behaviour the system did not have — an element that
  holds station ABOVE the row it belongs to — so it gets exactly one new cue
  and no new rungs: a hairline right-edge depth (`3px 0 8px -2px` at 55% void)
  on the edge the tabs pass, and the chip's existing tint composited onto the
  strip's own ground so it reads identically while being opaque. No new type,
  color, or spacing rung; the chip treatment, Project identity color, and
  signal mark are unchanged. A pinned element drops its position tween on
  purpose: sticky must track the scroll frame, and a tween on a scroll-driven
  offset reads as lag, not as motion. Reviewed on
  `/hud-gallery/project-ribbon/bench`.

- 2026-08-06 — ENG-016 D49 production adoption: the New Agent launcher bench
  now renders the same `AgentLauncher` mounted by the Cmd+T composer and remains
  as its deterministic state/interaction rig. Card cleanup adhered to existing
  HUD operational spacing, named chrome type, muted roles, and Voice; no new
  rung or channel was introduced. Browser gates now cover card overflow,
  complete model text, quiet recommendation marks, and ArrowDown's focus handoff.

- 2026-08-04 — Voice extended to machine-authored operator text (partner
  conversation `2026-08-04-dan-rosenberg`, operator-accepted): generated prose
  — context labels, recaps, roadmap copy, Agent-rendered summaries — now owes a
  conclusion-first opening line and the same production register as authored
  strings. Added because a professional creative director reading the Team and
  Roadmap altitudes cold could not find an entry point ("I don't even know
  where to look"), and because the operator's own live reaction to the roadmap
  view was the same. No new type, color, or spacing rungs; this is a content
  ordering rule enforced through the existing Voice section. `AGENTS.md` gained
  the matching contract for agent output outside the product.

- 2026-08-04 — ENG-032 T5.4 cross-context appearance incident closure:
  external web/Electron preference and OS/native streams now settle for 250 ms
  and publish only their final distinct snapshot; local theme intent remains
  immediate; web subscription events do not rewrite their input, while
  Electron mirrors only the final settled settings snapshot for first paint.
  The Goal Visuals workbench adds decode-before-commit, paint containment, Air
  readable-role compliance, and narrow-viewport gates. Incident `0005` carries
  the two-context reproduction and five-whys.

- 2026-08-03 — ENG-032 T5.3 public typography incident closure: completed the
  fixed public-exhibition boundary after production metric evidence showed
  Architecture still inherited app-theme families and interface scale. Home,
  Architecture, shared chrome, and the Architecture pending state now own one
  System/100% presentation; Home's route-local style owner retired. The new
  `eval:typography-stability` gate samples computed metrics and raster hashes,
  then adversarially cycles all three typography profiles and 90–120% scale.
  Incident `0004` carries the five-whys and exact before/after metrics.

- 2026-08-03 — ENG-032 T5.2 navigation-paint incident closure: retired the
  two-owner homepage → Architecture exit/entry curtain after production pixel
  evidence proved it painted Air's near-white canvas over two dark public
  surfaces. The physical Command-key release survives and navigates directly;
  Architecture gains a dark pending floor; and Home/Architecture share one
  route-stable opaque public-chrome owner instead of page-injected CSS. The new
  `eval:navigation-paint` gate samples actual body/header pixels through a
  forced-cold client navigation. Incident `0003` carries the five-whys and
  falsified hypotheses.

- 2026-08-03 — ENG-032 post-rollout hardening: the first-paint bootstrap remains
  authoritative until React adopts its saved/OS snapshot; the public home pins
  one system font independently of app appearance; and the root itself paints
  the resolved ground. The manually saved Enhanced contrast and Reduce
  transparency controls are retired and old V1 values normalize to `system`;
  OS accessibility requests still apply automatically. Theme selection gains
  an account-avatar submenu alongside Settings and **Change theme…**. Agent
  Source brand colors now paint only contrast-gated identity marks while all
  readable copy uses semantic theme roles, closing the Air/Codex failure class.
  The same audit moved roadmap micro-status labels off decorative `cyan2`/`idle`
  paint and added 4.5:1 gates for every HUD role sanctioned as small text.

- 2026-08-03 — ENG-036/ENG-008 consumption study retirement (dead-code pass, workbench rule): with the composite `/usage` shipped (E8) and the bar meter form picked and live (E6), retired `/hud-gallery/consumption-lab` (incl. its private frozen `weights.ts`), `/hud-gallery/consumption-redesign`, and the `#ambient-consumption-meter` four-form study, plus the components whose only consumers were those studies — `unit-ladder.tsx`, `assurance-legend.tsx`, `capacity.tsx`, `coverage.tsx`, `delegation.tsx`, and `tightestWindow`/`reportingCoverage` in `model.ts` (the E5 retirement note pulled forward; every deletion importer-verified). The live meter (`meter-model`, `meter-forms`, `ambient-meter-chrome`, popover, test fixtures), the shared atoms `/usage` mounts, and the readiness-grammar study (surfaces still preview) are untouched. Design record: git history, the review screenshots, and the E6/E8 milestone logs. Off-scale register updated — the 17/19/25/26/28px and fractional-scale rows are both cleared (the last fractional uses left with ENG-032 T3C and this pass). The ENG-032 T3C material assertion on `CapacityPopover` retired with `capacity.tsx`; the shared overlay-material contract stays asserted through the live `MeterPopover` case.
- 2026-08-03 — ENG-032 T0: introduced the versioned theme substrate without
  changing production appearance. Three generated built-ins now cover
  foundation, HUD, status, Consumption, readiness, xterm, spatial, typography,
  material, and bootstrap roles. Classic is the parity oracle and only
  production-available definition; Air/Night remain gallery-only until T5. The
  existing channel and type-scale rules remain authoritative.
- 2026-08-03 — ENG-032 T1: root appearance now resolves through the validated
  app-global provider and generated Classic aliases; removed the static
  `html.dark` and one-off `SystemAccent` mutator. A system accent is now the
  contract's optional, contrast-corrected overlay, while the preset action role
  is the default. Interface scale multiplies named type rungs only—never root
  font size, spacing, terminal metrics, geometry, or motion. First-paint and
  native Electron chrome use the same generated bootstrap subset.
- 2026-08-03 — ENG-032 T2: accepted the Air/Night visual family in the scoped
  workbench and froze the three first-party typography profiles. The complete
  application type ladder now follows the bounded interface scale with a 9px
  nano floor; system/Geist overrides cover shell, UI, and display while mono
  and terminal typography stay independent. Expanded text/control/spatial
  contrast and exact channel-collision gates, canonical D40 marks, full
  Consumption/readiness specimens, opaque material fallbacks, ANSI-16, and a
  bloom-free concrete-sRGB R3F sibling are reviewable. Air/Night remain
  gallery-only until T5.
- 2026-08-03 — ENG-032 T3A: generated roles now own root app chrome, Settings,
  shared overlays, feedback, and readiness paint. `exa-material-chrome`,
  `exa-material-overlay`, and `exa-material-raised` are the shared projection
  recipes; each consumes theme tint/opacity/blur/saturation and swaps to its
  authored opaque fallback under reduced transparency or missing support. The
  complete backdrop-filter value stays behind a custom property so compiled
  Electron CSS retains the standards property. Components may select a material
  role, but may not author a second local glass recipe.
- 2026-08-03 — ENG-032 T3B: generated foundation/HUD/action/status roles now
  own Workspace and Roadmap presentation, while generated xterm roles own
  foreground, background, cursor, selection, and ANSI-16. Theme changes mutate
  the existing terminal's `options.theme`; they never remount, replay, refit,
  resize, or write to the PTY. Project/source identity remains data, and D40
  protocol metadata remains semantic state rather than presentation paint.
- 2026-08-03 — ENG-032 T3C: generated Consumption/foundation/HUD/material roles
  now own `/usage`, its capacity and attribution visualizations, drill and
  session surfaces, the Team Session-card burn carrier, assurance/unit ladder,
  ambient meter, and popovers. DOM
  interpolation uses live CSS variables; concrete Classic FLUX remains only for
  the pending spatial adapter. Consumption unknown stays a hatched data state
  distinct from readiness, action, status, and Project identity.
- 2026-08-03 — ENG-032 T4: the Fleet Operations Board now consumes one pure
  concrete-sRGB spatial snapshot for canvas, grid, zones, units, labels,
  selection, D40 status, Consumption pressure, materials, and bloom. Theme and
  contrast changes invalidate the existing demand scene without rebuilding its
  camera, filters, selection, or data. Every unit mark has a canvas-colored
  backing plate so Air's D40/Consumption colors meet the real composited 3:1
  boundary, and enhanced contrast strengthens WebGL grid/unit/label paint rather
  than setting a metadata flag. Project identity remains a stable six-slot data
  palette corrected against the active zone. The native-material spike closed
  renderer-only; shared in-app material roles remain the portable V1 output.
- 2026-08-03 — ENG-032 T5/T5.1: Classic, Air, and Night are production presets behind
  one app-global device-local preference. Fresh state uses Auto Air/Night;
  Manual pins a preset while remembering the Auto pair. Settings and the
  keyboard-complete **Change theme…** command shipped as the T5 selection
  faces; T5.1 added the account-avatar menu. Preset action/type/material defaults remain beneath global
  readability controls and automatic OS accessibility inputs. The production literal-completeness gate now
  protects migrated source, Classic remains recovery, and the temporary theme
  workbench/T12 specimen retired after the shipped surfaces became authoritative.
- 2026-08-02 — G0: initial kernel extracted from the shipped UI; named 12-rung type scale over the D39 chrome roles; off-scale register recorded; `/hud-gallery` merge/retire decisions written (execution = G1).
- 2026-08-02 — G1 executed: the `/hud-gallery` decision list above is now reality. Retired the quick-capture, context-label, and keyswitch/tactile study sections; deleted `/hud-gallery/agent-field` and `/hud-gallery/agent-sources`; removed the 301-line `.tactile-key` block from `globals.css` (`TactileActionKey` re-verified at zero consumers before deletion); retired `/eval/t7-keyswitch` and its harness task with the study (production keyswitch buttons and their T8/T9 evals untouched); keyswitch direction note archived at `docs/archive/keyswitch-material-studies.md`; `AGENTS.md` workbench rule amended per the line above.
- 2026-08-02 — ENG-026 N0 readiness grammar: one shared unbuilt-state family in `src/components/readiness/` — readiness neutral `#77839A` (same value as consumption's `FLUX.unknown`, kept outside every status/attention/consumption/identity channel per the channel-ownership rule) + dashed stroke at three scales (`ComingSoonMarker` pill, `AnnouncedChip` control, `Unbuilt` block), sentence-case **Coming soon** as the only phrase (no all-caps). Supersedes ENG-008 E4's local `designed, not built` tag. Type: chrome-micro on markers/tags, chrome-label on chips, chrome-title on unbuilt notes (the migration retired that file's `text-[13px]` literals). Do not draw dashed strokes in the neutral grey for any other purpose — dashes now mean _designed, not built_. Evidence: `/hud-gallery#readiness-grammar` and the ENG-026 milestone log screenshots.
- 2026-08-02 — review fixes: minted the four missing rung tokens in `globals.css` (`text-chrome-nano`, `text-reading`, `text-surface-title`, `text-display`) so the no-bracketed-sizes rule is satisfiable by the doc's own prescriptions (the app-wide bracketed-usage sweep remains P8); corrected measured counts (`rounded` 135, HUD atom importers 36, tactile-key dead CSS ~294 lines, raw 10–15px literals 295/217); added the substrate note pinning counts at `f3efd83`; fixed the quick-capture retire rationale (it imports production components — the drift risk is mounting context, not the components).
- 2026-08-02 — ENG-026 N3–N5 readiness family extensions, same grammar at two new mounting scales: `AnnouncedChip` gained `size="micro"` (badge-tier `px-1.5 py-0.5` chrome-micro, per the chip/badge density row) for dense card headers — the ENG-028 Type chip on Sessions cards; `StripContextMenu` learned an announced ROW (readiness neutral, `cursor: default`, tooltip, inert contents, no `menuitem` role so keyboard traversal skips it) for _Push to cloud_, plus a muted right-aligned **Coming soon** micro-note on rows that navigate to a `preview` surface (the ⌘K preview-row pattern carried into menus). The dashed-stroke meaning is unchanged and got its first block-scale in-situ use outside a component: `/cloud`'s hosted card draws the dashed neutral border because it is the drawing of a session, not a session. No new colors, sizes, or phrases. Evidence: the ENG-026 N3–N5 milestone log screenshots.
- 2026-08-03 — ENG-008 E6 ambient chrome meter (review candidate, gallery + flagged title-bar mount): the consumption channel gains a **monochrome-until-it-matters** register for always-on chrome. At ≤20px in the title bar the meter renders in chrome neutrals (zinc ladder) through healthy/warm and switches to the FLUX violet→magenta ramp only when a window runs hot or is spent — the battery-gauge idiom, escalation by state change, never motion. This does not change FLUX ownership (the expository `/consumption` surface keeps its always-colored treatment); it adds the calm-at-rest register for ambient chrome so a healthy meter is furniture, not a signal. The even-pace tick (`METER_MONO.tick`, a fixed neutral hairline at the elapsed-fraction position) is the meter's second mark; constant-footprint and reduced-motion rules apply as everywhere. Components in `src/components/consumption/meter/`. RESOLVED same day: the operator picked the fraction-bar form and it shipped enabled in chrome (E8, `CHROME_METER_FORM: 'bar'`); the four-form gallery study retired 2026-08-03 per the workbench rule — the forms and per-form assessments live in git history and the E6 milestone log.
- 2026-08-02 — decision `0025`: reversed only the keyswitch-study portion of G1 retirement after operator review. Restored the interactive R3F material bench to `/hud-gallery` and a lean T7 paint/variant gate; kept the unused DOM `TactileActionKey` CSS retired and the New Agent composer on the standard shadcn button. Evidence: `/hud-gallery#keyswitch-material-studies` and `scripts/r3f-eval/report/t7-keyswitch.png`.
- 2026-08-03 — Voice section added (ENG-036), from the operator's `/organization` correction (thesis lede + "Asked by users" header in main product UI). Production-voice sweep executed in the same change: `/organization`, `/cloud`, `/coordination`, `/agent-types` (the `PreviewSurfaceShell` `question` prop and the intent/designed-shape footer sentences retired), `/consumption` (all four acts, unit ladder, cost-per-agent and intervention sections rewritten from question-headers to noun headings and captions), the demo Session pane empty state, and the `UnbuiltLegend`. Readiness markers, demo banners, and "not recorded"/"unreported" states unchanged — they are the honesty channel the essays were duplicating.
