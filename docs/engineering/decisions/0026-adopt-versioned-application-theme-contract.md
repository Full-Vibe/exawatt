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
  Global system-accent, interface font/scale, enhanced-contrast, and
  reduced-transparency overlays survive theme changes and outrank the preset.
  OS accessibility requests outrank both.
- Terminal color follows the preset; terminal typography remains independently
  configured. A theme never owns motion, layout, density, geometry, camera,
  interaction, state derivation, or product vocabulary.
- The first built-in set is Classic Dark compatibility, Air Light, and a calmer
  Night Dark sibling. Classic remains the recovery fallback. Air/Night remain
  gallery-only until the complete production adapter and accessibility matrix
  passes.
- A future marketplace may distribute payloads that validate and normalize into
  this contract. Marketplace installation, signing, moderation, discovery,
  payment, theme inheritance, arbitrary overrides, and external font handling
  are separate decisions.

## Supersessions

This decision deliberately amends two earlier appearance choices when ENG-032
lands:

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
  fallback, so platform limitations and reduced-transparency settings do not
  create a separate theme or block first release.
- Cross-device sync is intentionally absent. Adding it later must preserve local
  offline operation and resolve conflicts explicitly rather than silently
  repurposing the current Supabase keyboard-preference row.

The full implementation sequence, file ownership, verification matrix, and
rollout gates live in
`docs/engineering/projects/theming-and-visual-identity.md` under ENG-032.
