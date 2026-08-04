# 0026 Adopt a versioned application theme contract

Date: 2026-08-03
Status: accepted

## Context

Exawatt's renderer, xterm panes, Electron launch frame, Settings shell, scoped
Consumption palette, D40 status lights, and R3F Fleet board accumulated several
compatible-looking but independently hardcoded dark palettes. The root document
forces dark mode, Electron paints a separate dark first frame, and TypeScript
HUD constants manually mirror CSS. Replacing those literals with a second fixed
look would preserve the architectural fault while changing its colors.

The operator wants VS Code-like application theming: the chosen appearance is
personal and global, stays stable across Project/Workspace switches, offers an
Auto mode, and initially proves itself with two or three first-party presets.
Themes may influence color, typography, and bounded material/transparency, but
not motion or meaningful layout. Community distribution is future marketplace
work, not part of the first release.

The trust and rendering boundaries are wider than ordinary web theming. Exawatt
has a privileged packaged Electron renderer, a future hosted interface, retained
xterm instances, and WebGL materials that cannot consume CSS variables directly.
Status, action, Project identity, Consumption, and readiness colors also carry
different meanings and cannot collapse into a generic accent palette.

## Decision

Adopt a versioned, declarative `ThemeDefinitionV1` as the one authored theme
contract and a pure `resolveAppearance` function as the one merge point.

- Built-in definitions are JSON-compatible data with stable IDs, complete
  semantic roles, bounded values, and no executable code, arbitrary CSS, URLs,
  remote assets, or font binaries. A build-time validator/generator emits CSS,
  renderer registry, and Electron bootstrap artifacts.
- The semantic contract keeps foundation/action, HUD, status, Consumption,
  readiness, terminal, spatial, typography, material, and bootstrap roles
  explicit. Project identity remains external and is contrast-adapted against
  the resolved ground.
- One immutable resolved snapshot feeds thin DOM/CSS, xterm, R3F/Three, and
  Electron boot/native adapters. Components and adapters do not independently
  merge presets or reinterpret OS state.
- Appearance selection is an application-global, device-local preference.
  Manual mode pins one preset. Auto stores a light/dark pair and follows the OS.
  Electron's validated atomic settings file is the desktop authority; hosted
  web uses a local adapter with the same schema until sync is deliberately
  designed.
- A preset supplies the default accent, typography profile, and material recipe.
  Global system-accent and interface font/scale overlays survive theme changes
  and outrank the preset. OS accessibility requests outrank both.
- Terminal color follows the preset; terminal typography remains independently
  configured. A theme never owns motion, layout, density, geometry, camera,
  interaction, state derivation, or product vocabulary.
- The first built-in set is Classic Dark compatibility, Air Light, and a calmer
  Night Dark sibling. The complete adapter and accessibility matrix passed, so
  all three are production presets. Classic remains the recovery fallback.
- A future marketplace may distribute payloads that validate and normalize into
  this contract. Marketplace installation, signing, moderation, discovery,
  payment, theme inheritance, arbitrary overrides, and external font handling
  are separate decisions.

## Supersessions

ENG-032 landed this decision and deliberately amends two earlier appearance
choices:

- ENG-015 S3's forced-dark rule becomes the Classic preset and recovery path;
  the application root and native chrome may resolve light or dark.
- ENG-016 D32's system-accent **default** becomes an optional global override.
  D32's durable channel rule survives: there is one action accent, and Project
  color remains identity-only.

D40 status semantics, decision `0007`'s restrained hybrid DOM/R3F ownership,
and ENG-036's type scale/channel separation remain authoritative.

## Consequences

- Adding a visual role requires one contract amendment and complete preset
  coverage rather than a new local literal.
- Runtime theme switching crosses renderer boundaries through explicit adapters;
  WebGL is not made to parse CSS and Electron main does not import renderer code.
- First-paint continuity requires a generated bootstrap subset and a validated
  preference mirror, but Electron settings remain the durable authority.
- The Classic preset creates a parity oracle and rollback path, allowing the
  hardcoded system to migrate slice by slice without exposing half-themed UI.
- Native backdrop material is optional output. Every material role has a solid
  fallback, so platform limitations and OS reduced-transparency requests do not
  create a separate theme or block first release.
- Cross-device sync is intentionally absent. Adding it later must preserve local
  offline operation and resolve conflicts explicitly rather than silently
  repurposing the current Supabase keyboard-preference row.

The full implementation sequence, file ownership, verification matrix, and
rollout gates live in
`docs/engineering/projects/theming-and-visual-identity.md` under ENG-032.

## Amendment — renderer-only native material in V1

The bounded T4 native-material spike closed on 2026-08-03 with **renderer-only
material for V1**.

Electron 43.1 exposes macOS `setVibrancy()` and Windows
`setBackgroundMaterial()`, but these platform APIs paint behind the window or
non-client area. On the signed-app-compatible macOS window shape, applying
`under-window` vibrancy at runtime succeeded yet produced a byte-identical
before/after capture: Exawatt's launch floor and operational renderer are
intentionally opaque. Forcing the document root and window background
transparent at runtime still exposed no native material because the window was
not constructed as transparent and production content planes own opaque
grounds. Windows system backdrop material is additionally limited to Windows
11 22H2+, while Linux and hosted web have no equivalent output.

Making native material visible would therefore require a construction-time
transparent-window architecture plus translucent renderer roots, expanding the
startup, active/inactive, capture, power, forced-color, and reduced-transparency
contract far beyond a bounded adapter. That conflicts with V1's guaranteed
opaque fallback and flash-free launch continuity. Exawatt will not patch around
Electron with a lower-level transparent-window workaround. The generated
`chrome`, `overlay`, and `raised` renderer roles remain the portable material
output; every role retains its authored opaque fallback. Native material may be
reconsidered only as a separately shaped window-architecture change.

## Amendment — production selection and rollout closure

ENG-032 T5 closed the first-release rollout on 2026-08-03. Classic, Air, and
Night validate through the production registry and every renderer consumes the
same resolved snapshot. Fresh missing preference state defaults to Auto with
Air for light OS appearance and Night for dark; Manual pins any production
preset while remembering that Auto pair. Appearance settings and the
keyboard-complete **Change theme…** preview/apply/cancel command are two faces
over the same app-global, device-local authority.

Theme-provided action, typography, and material defaults remain beneath the
system-accent, interface font/scale, and OS accessibility overlays. Corrupt
preferences fall back to Classic, and
`--safe-theme` selects Classic for one launch without rewriting a valid stored
choice. The temporary gallery theme study and evaluator retired once production
surfaces became the review target. The final clean-master dogfood installation
is delivery closeout and is not claimed by this decision amendment.

## Amendment — retire manual accessibility overrides and harden first paint

The first production rollout exposed two fragile user preferences and one
startup race. Enhanced contrast and Reduce transparency are no longer manual
saved controls. Existing V1 records remain parseable but normalize both fields
to `system`, while OS contrast, forced-colors, inversion, and reduced-
transparency requests still feed the resolver automatically. This is a scope
reduction, not removal of platform accessibility behavior.

The inline bootstrap remains the sole first-paint authority until React adopts
the same saved preference and OS snapshot; the hydrated provider may not write
its deterministic server default over that frame. The document root paints the
resolved ground, and the public marketing home pins one system font rather than
following app typography. Theme selection remains app-global and is available
from Settings, **Change theme…**, and the avatar dropdown.
