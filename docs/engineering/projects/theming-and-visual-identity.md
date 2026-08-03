# Theming and visual identity (ENG-032)

Execution detail for roadmap item **ENG-032**. The roadmap owns status, scope,
sequence, and exit criteria. This document owns the research record, operator
discovery, and (once approved) the executable milestone detail.

## Current phase

**Discovery — deliberately unshaped.** No implementation scope is approved yet.
The purpose of this phase is to decide what “UI theming (like VS Code)” means
for Exawatt before a second hardcoded visual identity replaces the first one.

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

## Remaining discovery queue

These questions are intentionally unresolved. Further operator answers are
promoted as dated decisions during the grooming session; they are not
implementation tasks until the design brief is approved.

1. **Appearance modes:** should “follow system” choose independently configured
   light and dark themes, and is a first-class high-contrast pair required in
   the initial contract or only guaranteed by validation/OS forced-colors?
2. **Accent precedence:** when a theme supplies an action accent, does the
   operator's macOS accent continue to win by default, become a user-selectable
   override, or disappear from themed modes?
3. **Legacy and default set:** does the current dark HUD ship indefinitely as a
   `Legacy`/`Exawatt Dark` theme, and how many authored themes must prove the
   contract before the new default is eligible to replace it?
4. **Typography controls:** should presets select bundled type families and a
   type-scale profile, while explicit user font/size overrides remain adjacent
   settings, or does selecting a preset wholly determine typography? Should the
   first release accept arbitrary locally installed fonts?
5. **Material fallback:** may each preset choose opaque or translucent chrome,
   with reduced-transparency/high-contrast modes forcing opaque equivalents, or
   is material a separate global preference applied over any compatible preset?
6. **Portability:** should appearance follow the signed-in person across desktop
   and hosted interfaces while remaining fully offline, or is device-local
   appearance the desired authority for the first mile?

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
