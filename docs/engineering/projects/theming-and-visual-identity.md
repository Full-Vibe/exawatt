# Theming and visual identity (ENG-032)

Execution detail for roadmap item **ENG-032**. The roadmap owns status, scope,
sequence, and exit criteria. This document owns the research record, operator
discovery, and (once approved) the executable milestone detail.

## Current phase

**Active build — T0 and T1 landed; T2 is next.** The versioned contract, three
authored built-ins, deterministic generator, pure resolver, Classic parity
oracle, device-local preference adapters, production provider, strict Electron
settings IPC, and first-paint/native bootstrap are implemented. Production
still resolves only the shipped Classic appearance; Air and Night cannot be
persisted. This document does not authorize skipping
`/hud-gallery` review or switching the production default before T5.

The originating operator signal is broader than dark-versus-light: the current
fonts and colors feel “ultra-geeky” and insufficiently readable; users should be
able to customize the app; and the preferred new direction feels light, airy,
high-tech, and selectively glass-like without that reference becoming a
constraint.

## Baseline audit — 2026-08-03

Measured at `fd2e626`. Counts are migration evidence, not permanent telemetry.
Tests, `/hud-gallery`, and `/eval` were excluded from the production-source
counts.

- The root layout forces `html.dark`; CSS sets `color-scheme: dark`; Electron's
  first window background and self-contained launch screen are independently
  hardcoded dark. The renderer cannot become light by swapping the shadcn
  palette alone.
- Production `src` contains roughly **842 direct color literal/function
  occurrences across 86 files**. This includes legitimate data colors and
  composed effects, so it is not a mechanical replacement count, but it
  establishes the blast radius.
- The Fleet/R3F area contains roughly **246 direct color occurrences**. Three.js
  materials, lighting, bloom thresholds, CSS/DOM overlays, and the launch
  crossfade all participate in the final appearance.
- `HUD` is consumed from 58 source files and is duplicated deliberately between
  Tailwind/CSS variables and `src/components/hud/tokens.ts`; runtime theme
  switching would make that manual mirror unsafe.
- The terminal has a separate hardcoded `HUD_TERM_THEME` covering foreground,
  background, cursor, selection, and the 16 ANSI colors. Existing live settings
  propagation updates terminal typography, but not the xterm theme.
- Settings, Consumption, readiness, Project identity, and the D40 status-light
  protocol each have deliberately scoped color channels. A theme can restyle
  those channels but cannot collapse their meanings or let one channel
  impersonate another.
- Application fonts are statically loaded in the root layout (`Exo 2`, Geist,
  Geist Mono). Terminal typography is separately customizable through the
  local settings file. There is no app-chrome typography preference yet.
- Electron `userData/settings.json` is already a validated, atomic, offline
  settings authority with renderer broadcasts. `/settings` is canonically
  tenant-neutral. Supabase `user_preferences` currently stores only keyboard
  shortcuts, so cross-device appearance sync has no existing ownership decision.
- The packaged Electron renderer and the future hosted interface may share
  source and normalized UI models, but they are separate privilege and delivery
  boundaries (decision `0008`). The theme model therefore cannot depend on
  Electron APIs even if desktop persistence initially does.

### Existing appearance layers

| Layer | Current authority | Theme pressure |
| --- | --- | --- |
| Semantic app chrome | shadcn variables in `globals.css`, mapped through Tailwind `@theme` | already runtime-variable-shaped, but forced dark |
| HUD operations UI | `globals.css` plus mirrored `HUD` TypeScript object | DOM and WebGL need one resolved runtime value set |
| Settings shell | scoped `--settings-*` variables | hardcoded dark private palette |
| Consumption | `FLUX` TypeScript constants | semantics must remain disjoint from status |
| Status lights | D40 protocol metadata and DOM/R3F renderers | state vocabulary and distinguishability are invariant |
| Project identity | generated Project palette | identity remains separate from action and status |
| Terminal | xterm `ITheme`-shaped constant | needs a theme adapter and live update path |
| Fleet board | local Three.js/DOM color and material constants | needs theme-aware materials plus visual/performance validation |
| Native/boot chrome | Electron window background, launch document, system accent | must match before renderer hydration and follow accessibility settings |
| Typography | statically loaded app faces plus terminal settings | ownership relative to color themes is unresolved |

## Primary-source research

### VS Code — the named product reference

- VS Code color themes are declarative mappings for workbench UI colors and
  text/syntax colors; file-icon and product-icon themes are separate theme
  systems. Exawatt should not accidentally make every visual preference one
  inseparable package merely because the word “theme” is singular.
- Theme selection previews live while the operator moves through the picker.
  The selected theme is a user setting by default, can be overridden for one
  Workspace, and can choose distinct light, dark, high-contrast-dark, and
  high-contrast-light themes when following the OS.
- `workbench.colorCustomizations` provides sparse overrides on top of a named
  theme. This avoids copying an entire theme to change one disliked role.
- Terminal ANSI colors are supplied by the active theme but remain independently
  overridable. Terminal typography is a separate preference family.

Sources: [VS Code themes](https://code.visualstudio.com/docs/configure/themes),
[color-theme authoring](https://code.visualstudio.com/api/extension-guides/color-theme),
[theme color reference](https://code.visualstudio.com/api/references/theme-color),
[terminal appearance](https://code.visualstudio.com/docs/terminal/appearance).

### Zed and JetBrains — useful comparisons

- Zed uses a versioned, declarative JSON schema. One theme family may contain
  named light and dark themes; local files and extension-bundled themes use the
  same schema; sparse per-theme overrides are supported. Its schema explicitly
  includes UI roles and terminal ANSI roles.
- Zed keeps UI, buffer, agent-copy, and terminal typography as settings adjacent
  to themes rather than embedding every font choice in the color-theme file.
- JetBrains distinguishes the overall UI theme from editor color schemes and
  offers OS sync and explicit high-contrast choices. The recurring pattern is
  **coordinated appearance settings, not one unlimited style payload**.

Sources: [Zed themes](https://zed.dev/docs/themes),
[Zed theme schema](https://zed.dev/schema/themes/v0.2.0.json),
[Zed visual customization](https://zed.dev/docs/visual-customization),
[JetBrains UI themes](https://www.jetbrains.com/help/idea/user-interface-themes.html).

### Runtime and accessibility constraints

- Electron's `nativeTheme` already models the classic `system | light | dark`
  state machine and exposes changes in dark mode, high contrast, inverted
  colors, reduced transparency, and “differentiate without color.” Native
  menus, frames, dialogs, Chromium media queries, and renderer tokens must not
  disagree about the active appearance.
- xterm 6 exposes the complete `ITheme` palette as a runtime option and a
  `minimumContrastRatio` option (`4.5` is its documented WCAG AA value). A theme
  validator still needs to inspect the authored palette; xterm's adjustment is
  a last-mile safety net that can reduce saturation.
- Three.js converts CSS/hex sRGB inputs into its Linear-sRGB working space.
  Theme values must enter through one color-management-aware adapter; copying
  already-linear numeric values from DOM tokens would produce mismatches.
- WCAG 2.2 requires at least 4.5:1 contrast for ordinary text, 3:1 for large
  text and meaningful UI component boundaries, and non-color channels for
  meaning. D40's redundant shape/icon/text channels remain load-bearing.
- The stable 2025.10 Design Tokens Community Group format establishes typed
  tokens, groups, aliases, inheritance, and modern color spaces. It is a useful
  interchange reference, but adopting the entire standard as Exawatt's public
  theme format is an explicit product decision, not a default.
- Apple's Liquid Glass guidance treats glass as a sparse **functional layer for
  controls and navigation above content**, not a content-layer decoration. It
  also requires opaque/reduced-transparency alternatives and stronger contrast
  behavior. This makes the operator reference compatible with dense operations
  UI only if it stays selective.

Sources: [Electron `nativeTheme`](https://www.electronjs.org/docs/latest/api/native-theme),
[xterm `ITheme`](https://xtermjs.org/docs/api/terminal/interfaces/itheme/),
[Three.js color management](https://threejs.org/manual/en/color-management.html),
[WCAG 2.2](https://www.w3.org/TR/WCAG22/),
[DTCG format 2025.10](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/),
[Apple materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials).

### Material and typography portability — discovery pass 2

- “Glass” cannot be one platform API in a portable theme payload. Electron 43
  exposes macOS vibrancy categories and Windows backdrop materials through
  different window APIs; Windows material mutation is limited to Windows 11
  22H2 and later. The hosted renderer cannot reveal the desktop behind its
  browser window at all. Exawatt therefore needs semantic material roles that
  resolve through desktop-native and renderer adapters rather than platform API
  names in the authored preset.
- A translucent surface is conditional output, not a dependable background.
  System reduced-transparency and forced-color preferences call for simpler
  solid treatment; Windows material guidance additionally documents automatic
  fallbacks for high contrast, transparency disabled, unsupported hardware,
  remote sessions, and (for Acrylic) battery saver. Every translucent semantic
  role must carry an opaque fallback that still passes contrast checks.
- Chromium's local-font enumeration requires an explicit `local-fonts`
  permission and exposes a fingerprintable surface. It is Chromium-desktop-only,
  while Exawatt's future hosted surface has a broader browser boundary. This is
  too much permission and portability machinery to inherit accidentally from
  first-party themes.
- The existing Next.js font pipeline can self-host Google and local font files
  without runtime network requests or layout shift. Subject to each face's
  redistribution license, bundled preset fonts are the deterministic first-mile
  option. An arbitrary installed-font picker should be treated as a separate
  appearance capability if the operator wants it.

Sources: [Electron `BrowserWindow`](https://www.electronjs.org/docs/latest/api/browser-window),
[Electron window customization](https://www.electronjs.org/docs/latest/tutorial/window-customization),
[CSS user-preference media features](https://www.w3.org/TR/mediaqueries-5/#mf-user-preferences),
[CSS forced colors](https://www.w3.org/TR/css-color-adjust-1/),
[Windows Acrylic guidance](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic),
[Chromium Local Font Access](https://developer.chrome.com/docs/capabilities/web-apis/local-fonts),
[Next.js font optimization](https://nextjs.org/docs/app/getting-started/fonts).

### Best-in-class preference ownership — discovery pass 3

- Zed and GitHub model automatic appearance as a mode over independently stored
  light and dark theme selections. Choosing a manual mode pins one named theme;
  returning to system mode does not erase either half of the pair.
- Zed keeps UI, editor/buffer, agent-copy, and terminal font settings adjacent to
  but independent from its theme selection. Figma similarly keeps interface
  scale separate from light/dark/system appearance.
- Figma's enhanced-contrast behavior is an accessibility layer available over
  both light and dark themes and automatically responds to increased system
  contrast. This avoids multiplying every visual identity into ordinary and
  high-contrast preset names.
- Figma stores appearance per device rather than per collaborative file. That
  reinforces the operator's decision that Project/Workspace switches cannot
  change Exawatt's theme, but it does not decide Exawatt's still-open
  device-local-versus-account-sync policy.

The resulting Exawatt model should separate three concerns: a named preset
supplies visual and typographic defaults; `auto | manual` decides how presets
are selected; global accessibility/readability overrides modify the resolved
result without changing the named preset.

Sources: [Zed appearance](https://zed.dev/docs/appearance),
[Zed visual customization](https://zed.dev/docs/visual-customization),
[GitHub theme settings](https://docs.github.com/en/get-started/accessibility/managing-your-theme-settings),
[Figma themes and enhanced contrast](https://help.figma.com/hc/en-us/articles/5576781786647-Change-themes-in-Figma),
[Figma interface scale](https://help.figma.com/hc/en-us/articles/360049549913-Adjust-the-scale-of-the-Figma-UI).

## Constraints already fixed by canon

- The theming substrate comes before the new default visual identity.
- Demo Mode and Live Mode use the same UI/command layers and therefore the same
  resolved theme contract.
- Theme presentation may change how status states look; it cannot change the
  states, their priority, or make them indistinguishable.
- Project identity, action emphasis, status, attention, consumption, and
  readiness remain distinct semantic channels.
- Dense interactive/accessibility-critical chrome remains DOM-owned; WebGL
  mirrors the same theme semantics through its own renderer adapter.
- A new cross-surface visual state is proven in `/hud-gallery` with DOM and R3F
  siblings where both regimes are affected before production percolation.
- Theme payloads must remain declarative data. Loading arbitrary theme JavaScript
  or arbitrary CSS into the privileged desktop renderer would expand the trust
  boundary far beyond visual customization.

## Operator decisions — 2026-08-03

- **Theme boundary:** a theme may own color and application typography. It may
  also own a bounded material/transparency treatment once the fallback contract
  is defined. It does not own motion and must not materially rearrange or resize
  the interface. Minor optical adjustments required to keep a typeface legible
  are still an unresolved edge, not permission for theme-specific layouts.
- **Scope and identity:** the active theme is an application-global personal
  preference. Switching Workspace, Initiative, Project, Agent, or Session does
  not switch themes. Project identity remains an independent semantic channel.
- **Extensibility horizon:** the first release proves the contract with two or
  three first-party presets. Community-authored distribution is not first-release
  scope. The data model must leave a credible future marketplace seam without
  prematurely shipping import, installation, or arbitrary extension execution.
- **Built-in proof set:** target three preset roles: preserve the current dark
  appearance as a compatibility preset, author the new light/airy direction,
  and author a calmer modern dark sibling. Names are provisional. Gallery
  acceptance decides which new preset becomes the default; the compatibility
  preset is not allowed to constrain the new token contract to old accidents.
- **Selection behavior:** appearance has `auto` and `manual` modes. Manual mode
  pins one named preset across OS and Project changes. Auto mode follows the OS
  and retains independently chosen light and dark preset IDs, matching the
  proven Zed/GitHub behavior rather than treating Auto as a fourth theme.
- **Typography ownership (delegated design resolution):** a first-party preset
  may recommend a validated typography profile—bundled/system UI families,
  weights, tracking, and the small metric adjustments necessary for legibility.
  It may not invent its own type scale. Global interface-font and text-size
  overrides sit above the preset, persist across theme changes, and remain
  bounded by the design-system scale and minimum legibility rules. Terminal
  typography retains its existing independent settings. Arbitrary local-font
  enumeration and font binaries are outside the first release.
- **Accent precedence:** presets supply the default action accent. A global
  **Use system accent** override preserves D32's macOS personalization when the
  operator wants it; runtime contrast correction protects the selected preset.
  Project color remains identity-only.
- **Material and accessibility:** the preset owns its suggested material recipe.
  Global **Reduce transparency** and **Enhanced contrast** overrides sit above
  it and automatically activate when the OS requests the same accommodations.
  The overrides may simplify paint but never change layout or semantic state.
- **First-mile persistence:** appearance is device-local and offline-first. The
  Electron settings file is authoritative on desktop; the hosted interface uses
  a local browser source with the same schema until account sync is deliberately
  designed. No Supabase appearance write is part of this item.
- **Default migration:** non-Classic presets stay gallery-only until every
  production adapter and gate below passes. At T5, operator acceptance promotes
  the Air/Night Auto pair as the fallback for installations without an explicit
  appearance preference; explicit choices are never overwritten. Classic
  remains a selectable preset and the recovery fallback.

## Approved design brief

### Outcome

An operator can choose a coherent Exawatt appearance once and keep it while
switching Workspace, Project, Agent, Session, Demo/Live source, and altitude.
Manual selection stays pinned. Auto follows the OS using a remembered light and
dark pair. Theme changes update app chrome, xterm, Fleet paint, boot chrome, and
typography without reloading, restarting an Agent, resizing a PTY, changing
motion, or changing the meaning of any product state.

The first release contains three built-in roles with stable implementation IDs
and gallery-reviewed display names:

| Stable ID | Role | Initial typography posture |
| --- | --- | --- |
| `exawatt-classic-dark` | compatibility rendering of the current dark product | current Exo 2 display + Geist UI + Geist Mono |
| `exawatt-air-light` | new light, airy, selectively translucent direction | system/Geist sans; no “space” display face |
| `exawatt-night-dark` | calmer dark sibling to Air, not a neon reskin of Classic | Geist-led sans + existing mono |

The IDs are persistence/API state and must not be renamed casually. Display
names and exact font choice remain gallery judgments until T2 acceptance.

### Interaction contract

- Settings gains an **Appearance** group. Mode is Auto or Manual. Manual shows
  one active preset; Auto shows independently chosen Light and Dark presets.
- A **Change theme…** command opens a keyboard-operable picker. Arrow movement
  previews without writing; Enter commits; Escape and outside-dismiss restore
  the last committed appearance. Preview reaches DOM, xterm, and R3F through
  the same resolver as committed state.
- **Use system accent**, **Enhanced contrast**, and **Reduce transparency** are
  global overlays. OS high-contrast, forced-colors, inverted-colors, and
  reduced-transparency signals always outrank an app preference.
- **Interface font** offers Theme default, System, and bundled Geist in the
  first release. **Interface text size** is a bounded 90/100/110/120 percent
  preference applied to named type rungs rather than the root font size, so it
  does not scale spacing or the terminal. Extreme values must pass the narrow
  viewport matrix before exposure.
- Existing terminal font family/size/line-height/cell-spacing settings remain
  independent. Theme selection changes xterm color roles only.
- Appearance is never stored on Workspace, Project, Agent, Session, Demo data,
  or the Supabase tenancy row. A tenant or Project color cannot mutate it.

### Runtime model

```text
Electron settings source ─┐
Web local source ─────────┼─> validated AppearancePreferences
                          │
OS appearance signals ────┼─> resolveAppearance(registry, preferences, OS, preview)
Built-in preset registry ─┘                 │
                                            ├─> document/CSS adapter
                                            ├─> xterm adapter
                                            ├─> R3F/Three adapter
                                            └─> Electron boot/material adapter
```

`resolveAppearance` is framework-free, deterministic, and complete: the same
inputs produce one immutable `ResolvedAppearance`. Components do not merge
presets or consult OS media queries independently. Adapters translate the
resolved semantic values into their renderer's representation.

The preference source is replaceable below the provider:

- Electron: validated atomic `userData/settings.json`, preload IPC, existing
  `settings:changed` broadcast, and focus refresh.
- Hosted/web: local storage behind the same `AppearancePreferenceSource`
  interface. It is a delivery adapter, not a second appearance model.
- Renderer bootstrap: a local-storage mirror of the last successfully validated
  committed preference may select a generated CSS preset before hydration.
  Electron settings reconcile immediately and remain authoritative. A stale or
  malformed mirror is discarded, never merged.

### Preference contract

`AppearancePreferencesV1` is a versioned, discriminated data structure. The
settings parser rejects unknown IDs and out-of-range values without erasing
unrelated settings.

| Field | V1 values and default |
| --- | --- |
| `schemaVersion` | `1` |
| `selection` | `{ mode: "manual", themeId }` or `{ mode: "auto", lightThemeId, darkThemeId }`; fallback Auto = Air/Night after T5 |
| `accentSource` | `theme` (default) or `system` |
| `interfaceFont` | `theme` (default), `system`, or `geist` |
| `interfaceScale` | `90`, `100` (default), `110`, or `120` |
| `contrast` | `system` (default) or `enhanced`; OS request is an unconditional OR |
| `transparency` | `system` (default) or `reduced`; OS request is an unconditional OR |

Preview state is deliberately absent from persistence. A genuinely absent
preference adopts the accepted default pair after T5. Unknown schema versions,
unknown theme IDs, wrong light/dark pairing, and corrupt JSON always resolve to
Classic; `--safe-theme` also forces Classic for one Electron launch without
rewriting the preference.

### Theme contract

`ThemeDefinitionV1` is declarative, JSON-compatible, and fully expanded after
validation. V1 permits no JavaScript, CSS payload, URL, asset path, font binary,
or arbitrary property name. This is the trust boundary a future marketplace can
publish into; marketplace discovery, installation, signing, moderation, and
payment remain out of scope.

| Group | Owns | Must not own |
| --- | --- | --- |
| Metadata | schema version, stable ID, label, author, light/dark class, gallery/production availability | executable hooks or remote resources |
| Foundation | canvas, surfaces, overlays, inputs, text hierarchy, borders, selection, focus, action roles | Project identity or state semantics |
| HUD | operations surfaces, strokes, readouts, HUD text roles | a second action/status vocabulary |
| Status | paint for Off, Active, Result, Needs You, Fault | priority, icons, labels, motion, or D40 derivation |
| Consumption | calm/mid/warm/hot/unknown visualization ramp | status, action, readiness, or Project identity |
| Readiness | neutral announced/coming-soon paint | status/fault meaning or alternative copy |
| Terminal | background, foreground, cursor, selection, ANSI 16 | terminal font metrics |
| Spatial | canvas/grid/zone/material/emissive paint and bounded bloom profile | camera, interaction, geometry, timing, or unit state |
| Typography | one validated first-party profile ID | free-form font URLs or a private type scale |
| Material | semantic solid/translucent recipes with opaque fallbacks | layout, motion, or a requirement for native backdrop support |
| Bootstrap | first-frame background, foreground, signal, and `color-scheme` subset | a divergent launch-screen identity |

The canonical authored values live in `themes/v1/*.json`. A generator validates
them and emits artifacts; generated files are never hand-edited:

- `src/generated/themes.css` — complete `--exa-*` variable sets keyed by stable
  preset ID, plus light/dark `color-scheme`.
- `src/generated/theme-registry.ts` — typed renderer registry and metadata.
- `electron/main/generated-theme-bootstrap.ts` — the small boot/native subset
  Electron can consume without importing renderer code across its CommonJS
  root boundary.

`scripts/generate-themes.mjs` and `pnpm theme:check` own generation, schema
validation, contrast checks, allowed value ranges, ID uniqueness, light/dark
pairing, and clean-generated-artifact enforcement. DTCG terminology informs
the shape, but V1 does not claim full DTCG interchange compatibility.

### Renderer adapters and token ownership

- **DOM/CSS:** `AppearanceProvider` sets stable data attributes and the resolved
  overlay variables on `document.documentElement`. Existing shadcn names alias
  `--exa-foundation-*`; components consume semantic variables rather than theme
  IDs. Inline-style consumers use CSS variable references.
- **HUD TypeScript:** `HUD` stops mirroring literal values from CSS. DOM-safe
  exports become semantic `var(--exa-hud-*)` references; pure color math uses a
  resolved snapshot. String concatenation such as `` `${HUD.red}88` `` is
  migrated to explicit alpha helpers that accept resolved colors.
- **xterm:** both live and retained terminals receive the resolved `ITheme` and
  update `terminal.options.theme` on preview/commit/Auto changes. Set
  `minimumContrastRatio: 4.5`; validator coverage remains the primary gate.
  Theme changes must not call fit/resize or alter font metrics.
- **R3F/Three:** a hook exposes concrete sRGB strings/numbers from the resolved
  snapshot; one adapter performs Three.js color-space conversion. No material
  parses CSS `var()` values. Theme changes invalidate on demand and update
  material uniforms/properties without reconstructing scene truth.
- **Electron boot/native:** main resolves only the generated bootstrap subset
  before `BrowserWindow` creation, setting `backgroundColor`, launch document
  variables, and `nativeTheme.themeSource` consistently. Runtime material APIs
  are platform adapters, not theme vocabulary.

Status, Consumption, readiness, action, and Project identity remain separate
channels. Project colors continue to come from Project identity, then pass
through a theme-aware contrast adapter for the current ground; a theme never
chooses a Project's identity color.

### Material scope

V1 guarantees **in-app** material roles for title/navigation chrome, transient
overlays, and selected raised controls. Content planes, tables, terminals, and
dense operational cards stay sufficiently opaque. Every translucent recipe has
an authored solid fallback.

T4 includes a bounded native-material spike using Electron's macOS vibrancy and
Windows backdrop APIs. Native desktop-through glass ships only if the installed
app proves legibility, active/inactive behavior, reduced-transparency fallback,
startup continuity, and acceptable GPU/power behavior. Failure closes the spike
with renderer material only; it does not block the theme system or invite a
transparent-window workaround.

### Migration rule

The roughly 842 audited color occurrences are classified, not globally replaced:

1. semantic presentation color → a named theme role;
2. Project/data identity color → its existing channel plus contrast adapter;
3. status/consumption/readiness color → that channel's theme mapping;
4. asset/test/eval fixture color → documented allowlist;
5. accidental one-off presentation color → remove or promote deliberately.

Classic is the migration oracle. Each production slice must render the same
visual and geometric state under `exawatt-classic-dark` before non-Classic
presets are enabled on that slice. `theme:check` ratchets the direct-color
allowlist so a migrated file cannot silently reintroduce an unowned literal.

## Executable milestone plan

### T0 — Contract, generator, and Classic oracle

Scope:

- Add `ThemeDefinitionV1`, `AppearancePreferencesV1`, validators, registry,
  resolver, color/contrast utilities, stable IDs, and the three authored JSON
  files; only Classic is production-available.
- Add generated CSS/renderer/bootstrap artifacts and the deterministic
  `theme:generate` / `theme:check` commands.
- Capture deterministic Classic baselines for the Agent, Team, Fleet,
  Consumption, Settings, command palette/dialog, terminal, and launch frame.
- Add the theme-lab scaffold to `/hud-gallery` using generated definitions; do
  not connect production selection.

Exit criteria:

- malformed definitions, missing roles, non-sRGB terminal
  values, unsafe strings, duplicate IDs, wrong mode pairing, and failing
  contrast pairs fail the check with the role path;
- generated output is stable byte-for-byte and `git diff` clean after rerun;
- Classic's semantic values match the current shipped authorities, with every
  intentional mismatch written in the migration ledger;
- no production component behavior or default appearance changes.

Verification: focused contract/generator tests, `pnpm theme:check`, `pnpm lint`,
`pnpm type-check`, and deterministic Classic screenshots.

### T1 — Preference source, resolver runtime, and first-paint continuity

Depends on T0. Scope:

- Extend `ExawattSettings` parsing/writing and preload types with validated
  appearance preferences and one atomic `settings:set-appearance` IPC mutation.
- Add Electron and web `AppearancePreferenceSource` adapters plus one
  `AppearanceProvider`; add preview/commit/cancel APIs but expose no picker yet.
- Apply Classic through generated CSS variables and aliases at the root. Remove
  `html.dark` only after the Classic data attributes reproduce it.
- Add the validated local bootstrap mirror, `nativeTheme.themeSource`,
  BrowserWindow background, launch-screen bootstrap, Auto media/native signal
  handling, and one-launch `--safe-theme` recovery.

Exit criteria:

- settings round-trip, unrelated-field preservation, invalid-data fallback,
  atomic writes, focus refresh, multi-window broadcast, web fallback, and
  preview non-persistence are unit/integration tested;
- the launch frame, pre-hydration document, and hydrated Classic renderer have
  no light/dark flash or color-scheme disagreement;
- Project/Workspace/Demo switches do not write or change appearance;
- Auto changes resolve live; Manual ignores OS changes; neither touches PTY
  lifecycle or geometry.

Verification: settings/resolver/provider tests, launch-screen tests, Electron
compile, startup evaluator with light and dark mocked OS modes, offline evaluator,
and a reload/relaunch screenshot sequence.

### T2 — Gallery-authored Air and Night presets

Depends on T0; may run alongside T1 but cannot change production availability.
Read `docs/engineering/r3f-authoring-guide.md` before the R3F specimen.

Scope:

- Build `/hud-gallery#theme-system` as the temporary workbench: preset switcher,
  token/state matrices, type samples at all interface scales, material/fallback
  samples, shadcn controls, command/dialog chrome, xterm ANSI specimen, and DOM
  plus R3F siblings over the same resolved snapshot.
- Author Air and Night as one visual family, retaining different light/dark
  grounds without flattening action, status, consumption, readiness, Project
  identity, and neutral information into one accent.
- Select exact first-party typography profiles from bundled/system faces and
  record licenses for any new binary before it enters the package.

Exit criteria:

- operator accepts both presets in opaque, material, enhanced-contrast, and
  reduced-transparency states at 100% scale;
- automated contrast/channel checks pass, and the D40 five states remain
  distinguishable without color;
- the light R3F specimen is legible without dark-theme bloom assumptions;
- presets remain `gallery` availability and cannot be persisted by production.

Verification: gallery component tests, `pnpm theme:check`, `pnpm eval:r3f`,
Playwright screenshots at 560×400, 900×700, and 1400×900, and operator review.

### T3 — DOM and xterm percolation

Depends on accepted T2 contract. Parallel packets may land independently but
must rebase on every contract change:

- **T3A foundation/app chrome:** root/shadcn aliases, header/footer, navigation,
  command palette, dialogs, Settings, feedback, readiness, and launch controls.
- **T3B Agent/Team:** ribbon, tabs, composer, Sessions cards, roadmap, menus,
  status glyph DOM paint, terminal containers, live/retained xterm palettes.
- **T3C scoped visualization:** Consumption's FLUX mapping and remaining
  scoped settings/HUD palettes without merging their semantic channels.

Exit criteria for every packet:

- Classic screenshot and geometry parity precede Air/Night assertions;
- preview, commit, Auto transition, contrast, and transparency overlays update
  in place without route reload, component remount, PTY resize, terminal data
  loss, or status/action/identity semantic drift;
- each migrated file leaves the direct-color allowlist or carries a documented
  non-theme reason;
- Demo and Live render the same token state over their existing source boundary.

Verification: focused DOM/xterm tests, full `pnpm test:run`, `pnpm lint`,
`pnpm type-check`, `pnpm eval:workspace:chrome`,
`pnpm eval:electron:terminal`, `pnpm eval:electron:chrome`, and theme screenshots
of Agent/Team/Consumption/Settings in all three presets.

### T4 — Fleet/R3F, boot chrome, and material adapter

Depends on T2 and follows the R3F authoring guide. Scope:

- Replace direct presentation colors/materials in the production Operations
  Board and its DOM overlays with the resolved spatial adapter while preserving
  data/Project identity and D40 state derivation.
- Theme canvas, grid, zones, selection, lights, labels, bloom/material profiles,
  transition cover, and the remaining boot/native surfaces.
- Execute the native-material spike and record the ship/renderer-only result;
  never patch around Electron with lower-level transparent-window hacks.

Exit criteria:

- one state snapshot produces semantically matching DOM and R3F siblings in
  Classic, Air, and Night;
- light mode meets label/unit/selection contrast and does not encode state only
  through bloom; only Active moves, with existing reduced-motion/low-power gates;
- draw-call, frame, memory, on-demand invalidation, tone-mapping, and bloom gates
  remain within the existing evaluator budgets;
- Auto/manual/material changes do not reconstruct fleet truth or reset camera,
  filter, selection, Demo/Live source, or Agent handoff state.

Verification: focused adapter/material tests, `pnpm eval:r3f`,
`pnpm eval:spatial`, pointer/scale evaluators where affected, WebGL self-checks,
and installed-Electron screenshots for active/inactive and reduced-transparency
windows.

### T5 — Selection UI, accessibility matrix, and rollout

Depends on T1–T4. Scope:

- Add the production Appearance settings and **Change theme…** command/picker;
  join keyboard, command-discoverability, focus restoration, and production
  voice contracts.
- Promote Air and Night to production availability only after the complete
  surface matrix passes. Switch the missing-preference default to Auto Air/Night;
  preserve every explicit preference and keep Classic selectable/recoverable.
- Add the final direct-color/theme completeness gate, update the design-system
  kernel and architecture manifest, and retire the theme gallery study after
  the shipped surfaces themselves become the review target.

Exit criteria:

- full keyboard path, live preview/revert/commit, relaunch persistence, Auto OS
  changes, device-local behavior, and command/settings parity pass;
- 90–120% interface scale, system/bundled font overrides, forced colors,
  enhanced contrast, reduced transparency, inverted color, and system accent
  pass the key-surface matrix without clipped critical actions or lost state;
- ordinary text meets 4.5:1, large text and meaningful UI boundaries 3:1, xterm
  enforces its 4.5 minimum, and D40 redundancy survives every preset;
- production source has no unexplained presentational color literal in a
  migrated theme-owned scope; generated artifacts and docs agree;
- the packaged Electron app starts, switches, relaunches, works offline, and
  preserves running/restored Agents in every theme.

Verification: `pnpm theme:check`, `pnpm lint`, `pnpm type-check`, full
`pnpm test:run`, `pnpm build`, `pnpm electron:compile`, startup/chrome/terminal/
tenancy/offline evaluators, `pnpm eval:r3f`, a manual accessibility pass, and
the clean-master dogfood install through the canonical landing command:

```bash
pnpm agent:land -- \
  --verify theme:check \
  --verify lint \
  --verify type-check \
  --verify test:run \
  --verify build \
  --verify electron:compile \
  --dogfood
```

## Parallel ownership after T2

Only one owner changes the schema, stable IDs, generator, resolver, or generated
artifact format at a time. Once T2 freezes those boundaries, T3A/T3B/T3C and T4
can proceed in sibling worktrees because their source ownership is disjoint.
Each packet lands Classic parity plus its tests before the next packet rebases;
no packet privately extends the contract to solve a local color.

| Packet | Exclusive implementation ownership | Shared interfaces it may consume, not mutate |
| --- | --- | --- |
| Contract owner | `themes/v1`, generator, validators, resolver, preference types | design-system channel rules |
| T3A | root/app chrome/Settings/command/dialog/readiness files | generated variables + provider |
| T3B | workspace/roadmap/xterm DOM files | resolved DOM/xterm adapters |
| T3C | Consumption and scoped visualization files | channel mapping contract |
| T4 | Fleet Operations Board R3F + Electron boot/native adapter | resolved spatial/bootstrap snapshots |
| Gate owner | evaluators, screenshot matrix, direct-color allowlist | all public adapters |

## Verification matrix

| Risk | Required evidence |
| --- | --- |
| Schema or future marketplace payload escapes visual scope | hostile/unknown-field fixtures; JSON-only validator; no URL/CSS/code acceptance |
| Corrupt or stale device preference bricks startup | parser/property tests, Classic fallback, `--safe-theme`, unrelated-setting preservation |
| First-paint flash or native/renderer disagreement | launch → hydration screenshots under light/dark Auto and Manual; `color-scheme` assertion |
| Theme change disrupts active work | PTY ID/output/rows/cols unchanged; no spawn/stop/resize IPC; camera/filter/selection unchanged |
| Cross-surface drift | one fixture rendered through DOM, xterm, and R3F adapters; generated-token completeness test |
| Status/action/identity collision | channel distinctness checks plus D40 shape/icon/text tests in every preset |
| Light-theme unreadability | automated contrast pairs and visual matrix across Agent, Team, Fleet, Settings, Consumption, overlays |
| Transparency hides content | opaque fallback snapshots; OS/app reduced-transparency and inactive-window checks |
| System accent breaks a preset | runtime luminance correction fixtures across dark/light/extreme accents |
| Typography becomes layout theming | scale extremes at minimum viewport; ribbon height and critical-action visibility assertions |
| R3F regression | version-pinned API review, `eval:r3f`, screenshot, draw-call/frame/invalidation/bloom gates |
| Demo/Live divergence | same resolved theme ID/tokens across tenancy switch; no source payload field for appearance |
| Packaging/offline regression | production build, Electron compile, packaged smoke, offline evaluator, clean-master dogfood install |

## Rollout and rollback

- T0–T4 keep Classic as the only persistable production preset. Air and Night
  can be exercised in the gallery/eval harness without leaving half-themed
  product state in Settings.
- T5 is the single exposure/default gate. Explicit user choices survive future
  default changes. Missing or invalid state resolves deterministically.
- Classic remains complete indefinitely as the compatibility and recovery
  preset. `--safe-theme` bypasses stored appearance for diagnosis without
  deleting it.
- Theme state is local preference data only; rollback requires no database or
  Workspace migration. A code rollback sees unknown future settings as invalid
  and falls back safely while preserving unrelated keys.
- Native material can be independently disabled to renderer-only without
  changing the preset ID, semantic colors, or saved preference.

## Explicit non-goals for the first release

- community marketplace, import/export, remote theme fetches, arbitrary CSS or
  JavaScript, font uploads, and local-font enumeration;
- Workspace/Project themes, per-Agent themes, shared/team-enforced appearance,
  or appearance carried by Demo data;
- motion, density, spacing, component geometry, icon packs, syntax grammars, or
  terminal typography inside a theme;
- pixel-identical native material on macOS, Windows, Linux, and hosted web;
- account sync or a Supabase appearance schema.

## Roadmap milestone log

- 2026-08-03, discovery pass 1: audited the current DOM/CSS, xterm, Electron,
  Settings, persistence, status-channel, and R3F boundaries; compared the
  official VS Code, Zed, JetBrains, Electron, xterm, Three.js, WCAG, DTCG, and
  Apple material contracts; recorded the unresolved operator decision queue.
  No product or implementation decision was made.
- 2026-08-03, operator interview 1: bounded themes to color, typography, and
  possibly material/transparency while excluding motion and meaningful layout;
  fixed selection as an app-global personal preference; fixed the first release
  to two or three built-in presets with community distribution deferred to a
  future marketplace.
- 2026-08-03, discovery pass 2: established that native material APIs are
  platform adapters rather than portable theme vocabulary; made authored opaque
  fallbacks a requirement for every translucent role; separated permissioned
  local-font enumeration from deterministic bundled preset typography.
- 2026-08-03, operator interview 2 and discovery pass 3: fixed the three preset
  roles and `auto | manual` selection model. Under delegated design authority,
  kept preset typography as overridable defaults, interface readability controls
  global, and terminal typography independent, following Zed/Figma precedent.
- 2026-08-03, operator interview 3 and shaping closure: accepted theme accent
  by default with optional system accent, preset-owned material under global
  accessibility overrides, and device-local first-mile persistence. The design
  pass closed with decision `0026` and executable T0–T5 milestones; no product
  code was implemented.
- 2026-08-03, T0 landed: added strict `ThemeDefinitionV1` and
  `AppearancePreferencesV1` contracts, three JSON-compatible built-ins under
  `themes/v1`, deterministic CSS/renderer/Electron generation, a pure resolver
  with preview and accessibility overlays, contrast correction, and Classic
  parity assertions. `pnpm theme:check` rejects unknown fields, unsafe colors,
  stale artifacts, wrong IDs/availability/pairing, and failing contrast roles.
  `/hud-gallery#theme-system` previews the generated definitions without
  setting root production state. Evidence: contract/component/gallery tests,
  full Vitest, lint, type-check, production build, and Electron compile.
- 2026-08-03, T1 landed: made Electron `settings.json` the desktop appearance
  authority and browser local storage the hosted adapter behind one validated
  source; added atomic `settings:set-appearance`, focus refresh, live-window
  broadcast, native source/background updates, and a `--safe-theme` one-launch
  bypass that does not rewrite stored state. `AppearanceProvider` now owns the
  production resolver, OS accessibility/accent inputs, preview/commit/cancel,
  Classic root aliases, and a last-known-good local mirror consumed by the
  dependency-free head bootstrap before hydration. The launch document and
  BrowserWindow use the same generated subset. Air/Night remain gallery-only
  and are rejected at every production persistence boundary. Evidence: 36
  focused appearance/settings/provider/bootstrap tests, strict generation,
  lint/type/Electron compile, mocked-light and mocked-dark Electron relaunches,
  safe-theme recovery, identical deterministic screenshots, and the offline
  altitude evaluator.
