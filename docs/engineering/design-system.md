# Design system of record — the kernel (ENG-036 G0)

Created 2026-08-02 from a measured audit of the shipped UI (`src/components`, `src/app` at `f3efd83`). **Substrate note:** every count in this document is pinned at `f3efd83`; the `8ddd9f2` legacy retirement (-8,032 lines) landed after the audit, so re-measurements will differ (e.g. `text-sm` 219 → 137). The scale and the rules stand regardless of the counts — the numbers are evidence of what the taste was, not live telemetry. This document is **descriptive, not aspirational**: it writes down the taste the product already carries and that survived operator review. It does not redesign anything (ENG-032 owns a new visual identity; this owns the substrate).

**How to use it:** read this before building or changing any surface. Pick every font size, color role, spacing step, and status mark by citing a rung in this document. If no rung fits, you are either off-scale (fix your choice) or improving the system (amend this document — see [The amendment rule](#the-amendment-rule)).

Scope of G0: type scale, spacing steps, color roles, status iconography, and the `/hud-gallery` merge/retire decision list. Motion vocabulary, component contracts, and IA principles land in G2; the gallery merge itself is G1; the review gate is G3.

---

## Type

### Families

Declared in `src/app/layout.tsx` and mapped in `src/app/globals.css` `@theme`:

| Utility | Face | Where it is used |
| --- | --- | --- |
| `font-sans` | Exo 2 | body default; marketing/site surfaces only |
| `font-ui` | Geist Sans | application chrome — the workspace, settings, panels (163 uses) |
| `font-display` | Geist Sans | headings inside HUD/app surfaces (56 uses) |
| `font-mono` | Geist Mono | metrics, ordinals, tracked micro-labels, code (302 uses) |

Rule already in force: app surfaces set `font-ui` on their root; numbers and micro-labels go `font-mono`; Exo 2 never appears inside the application chrome.

### The named scale

The core of the scale is the **D39 chrome type roles**, already tokens in `globals.css` (`--text-chrome-*`, 148 usages), extended by the Tailwind named sizes the app uses correctly. All 12 rungs have named utilities — the four that existed only as bracketed sizes at the audit (nano, reading, surface-title, display) were minted as `@theme` tokens alongside the chrome roles:

| Rung | px / line | Utility | Use for |
| --- | --- | --- | --- |
| nano | 9 / 1 | `text-chrome-nano` | ordinal digits and symbolic glyphs only, in the densest chrome (tab-strip ordinals, roadmap-rail counts); always `font-mono`; never words or sentences |
| chrome-micro | 10 / 14 | `text-chrome-micro` | nonessential shortcut ordinals, uppercase tracked micro-labels; never the primary reading path (D39) |
| chrome-meta | 11 / 16 | `text-chrome-meta` | secondary metadata lines in chrome |
| chrome-label | 12 / 16 | `text-chrome-label` (≈ `text-xs`) | standard chrome labels, small buttons, chips |
| chrome-title | 13 / 18 | `text-chrome-title` | row and panel titles in chrome |
| body | 14 / 20 | `text-sm` | default reading and control size (219 uses; shadcn buttons/inputs) |
| reading | 15 | `text-reading` | expository prose on settings and consumption surfaces |
| title | 16 | `text-base` | emphasized in-surface titles |
| section | 18 | `text-lg` | section headings |
| surface-title | 20 | `text-surface-title` | a surface's h1 (settings, labs) |
| display | 22 | `text-display` | hero numbers and top-level headings on dense surfaces |
| marketing | 24+ | `text-2xl` … `text-4xl` | marketing/site pages only, never app chrome |

Weights: `font-medium` for labels/controls, `font-semibold` for titles/headings (164/163 uses — the two workhorses); `font-bold` is rare and stays rare. Uppercase is legal **only** on mono micro-labels ≤ 11px with wide tracking (`tracking-[0.1em]`–`[0.18em]`) — the established HUD label idiom; never on sentences or headings.

### Off-scale register (measured 2026-08-02)

The roadmap's founding measurement was 17 distinct hardcoded pixel sizes; this audit found it has already drifted to **23 in `src`** (21 on production surfaces excluding `/hud-gallery` and `/eval`). That drift in under a day is the reason this document exists. The named scale above reduces them to 12 rungs. Everything else is off-scale:

| Off-scale size | Where | Disposition |
| --- | --- | --- |
| `text-[8px]` | `src/components/fleet/spatial/operations-board/operations-board-surface.tsx`, keyswitch study, gallery | below the 9px floor; migrate to nano/chrome-micro on next deliberate touch |
| `text-[11.5px]`, `[12.5px]`, `[13.5px]`, `[14.5px]`, `[15.5px]`, `[16.5px]` | the consumption suite (`src/app/consumption/*`, `src/components/consumption/*`), `src/components/roadmap/roadmap-item-card.tsx`, roadmap-lab | ENG-008's private fractional scale, never reconciled with D39. Either promote deliberately (amend this doc) or snap to the neighboring rung when the surface is next touched. Do not copy it into new surfaces |
| `text-[17px]`, `[19px]`, `[25px]`, `[26px]`, `[28px]` | `src/app/settings/agent-sources-settings.tsx` (17), consumption `act-outcome`/`unit-ladder` (19, 26), gallery agent-sources lab (25, 28) | snap to 16/18/20/22 on next touch |
| raw `text-[10px]`–`[15px]` px literals (295 uses app-wide; 217 excluding gallery + eval) | app-wide | same values as the named rungs — not visually wrong, but written as magic numbers. Use the named utilities (`text-chrome-*`, `text-sm`, `text-reading`) in all new code; migrate opportunistically |

Rule: **new code never introduces a bracketed pixel font size.** If a rung is missing, amend the scale here first.

---

## Spacing

The app is on the Tailwind 4px grid with half-steps for dense chrome. Steps in real use (by frequency): **2, 4, 6, 8, 10, 12, 16, 20, 24, 32px** (`0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8`). Arbitrary bracketed spacing values are as off-scale as bracketed font sizes.

Density tiers as shipped:

| Context | Padding | Gap |
| --- | --- | --- |
| chip / badge / pill | `px-1.5`–`px-2` `py-0.5` | `gap-1`–`gap-1.5` |
| dense chrome row (tab strip, rail, list rows) | `px-2`–`px-3` `py-1`–`py-1.5` | `gap-1.5`–`gap-2` |
| control / button | shadcn sizes: `h-8 px-3` (sm), `h-9 px-4` (default) | `gap-2` |
| operational card / HUD panel | `p-3`–`p-4` (`.hud-panel` = 16px) | `gap-2`–`gap-3` |
| reading card / settings panel | `px-5 py-4`–`py-5` | `gap-3`–`gap-4` |
| marketing / auth card (shadcn `Card`) | `p-6` | `gap-4` |
| page gutter | `px-6`–`px-8`; labs and settings `p-8` | sections `gap-5`–`gap-6` / `space-y-6` |

Default answers for a new app surface: **card padding `p-4`** for operational content, `px-5 py-4` when the card is mostly prose; sibling elements `gap-2`; related blocks `gap-3`/`gap-4`; sections `space-y-6`.

Radii: `rounded` (4px) is the chrome default (135 uses; 165 including `rounded-sm`); `rounded-md` (6px) buttons/inputs (shadcn); `rounded-lg` (8px) panels and cards; `rounded-full` pills, dots, identity marks. `rounded-xl`+ is rare and stays rare. HUD panels may instead use the chamfered clip-path corners (`chamferPolygon`, leg 12px, `src/components/hud/tokens.ts`) — chamfer and rounded corners never mix on one element.

---

## Color roles

The app is **forced dark** (`html.dark`, ENG-016 D3); nothing may assume a light ground. Color is organized as one semantic layer plus three scoped operational palettes and two reserved channels. The channel-ownership rule is load-bearing: **status owns white/blue/green/peach/red; chrome attention owns amber; consumption owns violet→magenta; Project identity is its own channel and is never a status signal.**

### 1. Semantic chrome (shadcn variables, `globals.css`)

Default for all standard UI: `bg-background`, `text-foreground`, `bg-card`, `border-border`, etc.

- **Muted text**: `text-muted-foreground` (`#a3a3a3` dark) — the default secondary-text answer on any standard surface.
- **Action color (D32, one button system)**: `--primary` is the operator's **macOS system accent** (set at runtime by `SystemAccent`; HUD cyan `#19E6FF` is the web/off-macOS fallback). Exactly one shadcn button recipe app-wide: `default` = accent-filled primary action, `outline` = neutral, `ghost` = icon buttons (`src/components/ui/button.tsx`). Project color is never an action color.

### 2. HUD operational palette (fleet/workspace surfaces)

Tokens: `hud-*` utilities in `@theme` and the mirrored `HUD` object in `src/components/hud/tokens.ts` (single source shared by DOM and WebGL — keep them in sync).

- Grounds: `hud-void #04060B` → `hud-deep #070B14` → `hud-panel #0B1220`.
- Text: `hud-text #DCEBFF`; **muted on HUD surfaces**: `hud-text-dim #8AA0BE`.
- Accents: cyan `#19E6FF`, cyan-2 `#55EAD4`, magenta `#FF3B8B`, amber `#FFB02E` (attention), red `#FF1F4B`, green `#6FE39F`, idle `#6A7585`.
- Strokes are cyan-alpha (`HUD.stroke/strokeSoft/strokeFaint/divider`).

### 3. Settings operational neutrals (`[data-settings-shell]`)

Graduated from the gallery: calmer scoped palette for dense source-truth surfaces (`--settings-*` in `globals.css`). Text ladder: `--settings-text` → `-soft` → `-dim` → `-faint`; accents teal/amber/red with matching `-wash` fills. Use it only inside the settings shell.

### 4. Consumption channel (`FLUX`, `src/components/consumption/flux.ts`)

Violet→magenta plasma ramp (`calm #5D6BE8` → `mid` → `warm` → `hot #FF4FB4`), deliberately disjoint from status colors so a hot meter can never read as an agent needing you. "Unknown" is neutral grey `#77839A` and **never a fill or a zero**. Only consumption surfaces use this channel.

### Project identity

`PROJECT_PALETTE` (`src/components/workspace/project-colors.ts`), assigned via `pickDistinctColor`. Identity appears as thin vertical bars, zone edges, and emblems — **identity-only** (D30/D32): never a lamp, never a status, never a button color.

---

## Status iconography

Canonical and already fully token-ized — **do not invent new status marks.** Sources of truth: `src/components/status-light/protocol.ts` (states, colors, priority, derivation), `src/components/workspace/status-glyphs.tsx` (session glyphs), `src/components/hud/tokens.ts` (`STATUS_TONE`, `HUD_STATUS_COLOR`).

**D40 five-signal protocol** — one source-agnostic projection across Agent tabs, the Team overview/switcher, and the Fleet board:

| State | Color | Meaning | Priority |
| --- | --- | --- | --- |
| Off | `#DCE5ED` | idle, new, or quietly waiting | 0 |
| Active | `#9CD5FE` | reasoning, streaming, tools | 1 |
| Result | `#9BF396` | turn finished, result waiting | 2 |
| Needs you | `#FFD0B8` | approval / question / credential / Decision | 3 |
| Fault | `#FF7373` | failed or intervention required | 4 |

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

---

## Building a new page — the short answer

- Root: `font-ui`, semantic chrome tokens (`bg-background text-foreground`), forced dark.
- Body text `text-sm`; chrome labels `text-chrome-label`; metadata `text-chrome-meta`; h1 `text-surface-title font-semibold`; secondary text `text-muted-foreground` (or `hud-text-dim` on a HUD surface).
- Cards: `rounded-lg border border-border p-4` (operational) or `px-5 py-4` (prose); sections `space-y-6`; page gutter `px-8`.
- Buttons: the shadcn `Button` recipe only — `default` for the one primary action, `outline` neutral, `ghost` icons.
- Status: `StatusLight` / `status-glyphs`, never a bespoke dot.

---

## `/hud-gallery` audit — G0 decisions (G1 executes)

The gallery has been the de facto design system. With this document as the written source of truth, the gallery survives only as the **live workbench that renders the system** (roadmap ENG-036; operator 2026-08-02). Decisions per route/section, from a full audit of `src/app/hud-gallery`:

| Route / section | Decision | Grounds |
| --- | --- | --- |
| `/hud-gallery` — HUD atom sections (Frames, Corner brackets, Labels & readouts, Stat bars, Ring gauges, Status pills, Composed panel) + WebGL siblings | **Merge** — keep as the workbench render of the shipped `@/components/hud` library | atoms are production components (36 importing files: consumption, roadmap, workspace, shortcuts, spatial) |
| `/hud-gallery` — Agent status lights (DOM specimens + R3F scene + protocol legend) | **Merge** — keep; canonical D40 review surface | the protocol is canon; DOM+R3F sibling rule lives here |
| `/hud-gallery` — Elastic Project ribbon study | **Keep** | study of the shipped ribbon (decision `0022`), still the review bench for ribbon changes |
| `/hud-gallery` — Session state tiles | **Keep (open review candidate)** | prototyped for operator review, not yet accepted or rejected |
| `/hud-gallery` — Quick feedback capture study | **Retire** | shipped app-wide (ENG-025 F2, mounted via shortcut provider); the gallery section imports the production components, so it cannot drift from them — only from their real mounting context — and duplicates a live surface for no review value |
| `/hud-gallery` — Session context label feedback study | **Retire** | shipped in the tab strip; same drift argument |
| `/hud-gallery` — R3F keyswitch material studies | **Keep** — restored by operator review (decision `0025`) | active material workbench for physical command controls; the production home command key and T8/T9 rigs retain the shared R3F machinery. The unused DOM `.tactile-key` sibling and global CSS remain retired |
| `/hud-gallery/agent-field` | **Retire** | pre–Operations-Board scale demo; the shared R3F machinery it exercises is already production (`operations-board-surface`), and `/eval/t3-spatial-sparse` + `/eval/t4-agent-station` are the deterministic rigs. ENG-004 V3.1 (P5) does demo-scale work on the real surface, not here |
| `/hud-gallery/agent-sources` | **Retire** | graduated to production `/settings` (settings shell + `agent-sources-settings.tsx`); the 1,182-line lab duplicates a shipped surface and carries its own off-scale type (17/22/25/28px) |
| `/hud-gallery/consumption-lab` | **Keep until ENG-008 E5 lands, then fold into the main gallery** | active fixture-driven review rig for the in-flight consumption surface (pinned clock, corpus/direction switching); retire when the live source swap makes `/consumption` reviewable directly |
| `/hud-gallery/roadmap-lab` | **Keep** | deterministic review rig driving the shipped strip/rail through the real parser against canned states — exactly the workbench role |
| `/hud-gallery/project-ribbon` + `/project-ribbon/bench` | **Keep** | active dogfood bench (ENG-016 D42, 2026-08-02 round) |

G1 also amends `AGENTS.md`'s "canonical component workbench" rule: the workbench prototypes and renders; **this document is the source of design truth.** G1 executed this list on 2026-08-02 (see the amendment log); the table above stands as the record of what was decided and why.

---

## The amendment rule

This system is agentically malleable the same way decision records are. A UI change has exactly two legal relationships to this document:

1. **Adhere** — every type, spacing, color, and status choice cites a rung here.
2. **Deliberately improve** — the change breaks a rule on purpose because the new thing is better. Then, in the same change: update the affected section, add a dated entry to the amendment log below saying what changed and why, and include the screenshot evidence that shows the improvement. Deliberate improvement is the point; **silent divergence is the failure.**

Never fork a parallel convention (a new fractional type scale, a fifth palette, a second button recipe) without recording it here — the consumption fractional scale and the 17→23 size drift are the cautionary precedents.

### Amendment log

- 2026-08-02 — G0: initial kernel extracted from the shipped UI; named 12-rung type scale over the D39 chrome roles; off-scale register recorded; `/hud-gallery` merge/retire decisions written (execution = G1).
- 2026-08-02 — G1 executed: the `/hud-gallery` decision list above is now reality. Retired the quick-capture, context-label, and keyswitch/tactile study sections; deleted `/hud-gallery/agent-field` and `/hud-gallery/agent-sources`; removed the 301-line `.tactile-key` block from `globals.css` (`TactileActionKey` re-verified at zero consumers before deletion); retired `/eval/t7-keyswitch` and its harness task with the study (production keyswitch buttons and their T8/T9 evals untouched); keyswitch direction note archived at `docs/archive/keyswitch-material-studies.md`; `AGENTS.md` workbench rule amended per the line above.
- 2026-08-02 — ENG-026 N0 readiness grammar: one shared unbuilt-state family in `src/components/readiness/` — readiness neutral `#77839A` (same value as consumption's `FLUX.unknown`, kept outside every status/attention/consumption/identity channel per the channel-ownership rule) + dashed stroke at three scales (`ComingSoonMarker` pill, `AnnouncedChip` control, `Unbuilt` block), sentence-case **Coming soon** as the only phrase (no all-caps). Supersedes ENG-008 E4's local `designed, not built` tag. Type: chrome-micro on markers/tags, chrome-label on chips, chrome-title on unbuilt notes (the migration retired that file's `text-[13px]` literals). Do not draw dashed strokes in the neutral grey for any other purpose — dashes now mean *designed, not built*. Evidence: `/hud-gallery#readiness-grammar` and the ENG-026 milestone log screenshots.
- 2026-08-02 — review fixes: minted the four missing rung tokens in `globals.css` (`text-chrome-nano`, `text-reading`, `text-surface-title`, `text-display`) so the no-bracketed-sizes rule is satisfiable by the doc's own prescriptions (the app-wide bracketed-usage sweep remains P8); corrected measured counts (`rounded` 135, HUD atom importers 36, tactile-key dead CSS ~294 lines, raw 10–15px literals 295/217); added the substrate note pinning counts at `f3efd83`; fixed the quick-capture retire rationale (it imports production components — the drift risk is mounting context, not the components).
- 2026-08-02 — ENG-026 N3–N5 readiness family extensions, same grammar at two new mounting scales: `AnnouncedChip` gained `size="micro"` (badge-tier `px-1.5 py-0.5` chrome-micro, per the chip/badge density row) for dense card headers — the ENG-028 Type chip on Sessions cards; `StripContextMenu` learned an announced ROW (readiness neutral, `cursor: default`, tooltip, inert contents, no `menuitem` role so keyboard traversal skips it) for *Push to cloud*, plus a muted right-aligned **Coming soon** micro-note on rows that navigate to a `preview` surface (the ⌘K preview-row pattern carried into menus). The dashed-stroke meaning is unchanged and got its first block-scale in-situ use outside a component: `/cloud`'s hosted card draws the dashed neutral border because it is the drawing of a session, not a session. No new colors, sizes, or phrases. Evidence: the ENG-026 N3–N5 milestone log screenshots.
- 2026-08-03 — ENG-008 E6 ambient chrome meter (review candidate, gallery + flagged title-bar mount): the consumption channel gains a **monochrome-until-it-matters** register for always-on chrome. At ≤20px in the title bar the meter renders in chrome neutrals (zinc ladder) through healthy/warm and switches to the FLUX violet→magenta ramp only when a window runs hot or is spent — the battery-gauge idiom, escalation by state change, never motion. This does not change FLUX ownership (the expository `/consumption` surface keeps its always-colored treatment); it adds the calm-at-rest register for ambient chrome so a healthy meter is furniture, not a signal. The even-pace tick (`METER_MONO.tick`, a fixed neutral hairline at the elapsed-fraction position) is the meter's second mark; constant-footprint and reduced-motion rules apply as everywhere. Forms and states: `/hud-gallery#ambient-consumption-meter`; components in `src/components/consumption/meter/`. Operator pick of the surviving form is pending — until then the four forms are gallery candidates and the wired bar form is flagged (`AMBIENT_CHROME_METER_ENABLED`).
- 2026-08-02 — decision `0025`: reversed only the keyswitch-study portion of G1 retirement after operator review. Restored the interactive R3F material bench to `/hud-gallery` and a lean T7 paint/variant gate; kept the unused DOM `TactileActionKey` CSS retired and the New Agent composer on the standard shadcn button. Evidence: `/hud-gallery#keyswitch-material-studies` and `scripts/r3f-eval/report/t7-keyswitch.png`.
- 2026-08-03 — Voice section added (ENG-036), from the operator's `/organization` correction (thesis lede + "Asked by users" header in main product UI). Production-voice sweep executed in the same change: `/organization`, `/cloud`, `/coordination`, `/agent-types` (the `PreviewSurfaceShell` `question` prop and the intent/designed-shape footer sentences retired), `/consumption` (all four acts, unit ladder, cost-per-agent and intervention sections rewritten from question-headers to noun headings and captions), the demo Session pane empty state, and the `UnbuiltLegend`. Readiness markers, demo banners, and "not recorded"/"unreported" states unchanged — they are the honesty channel the essays were duplicating.
