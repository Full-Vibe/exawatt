# Keyswitch / translucent agent key material studies (retired 2026-08-02, ENG-036 G1)

Direction note archived when the `/hud-gallery` studies were retired per the
design-system kernel's G0 decision list (`docs/engineering/design-system.md`,
"/hud-gallery audit").

## What the direction was

A cumulative physical-material exploration of "agent actions as mechanical
keys", in two regimes:

- **R3F keyswitch study** (`KeySwitchStudy`): an interactive WebGL bench of
  full keyswitch mechanisms — frosted/translucent keycaps over a visible
  switch (stem, spring, housing, plate), four material/geometry variants with
  per-variant sound profiles, orbitable camera, hold-to-actuate travel, and an
  idle press hint. Exercised by the retired `/eval/t7-keyswitch` rig.
- **DOM sibling** (`TactileActionKey` / `TactileActionLink` + `.tactile-key`
  CSS): a layered-optical-surfaces button that faked the dished translucent
  cap in pure CSS while keeping native button semantics. It never gained a
  production consumer; its ~294 lines of global CSS were dead weight in
  `src/app/globals.css`.

## What survived into production

The direction did ship — as two specific keys, not a component library:

- `CommandKeySwitchButton` — the Smoke Low command key on the home hero
  (`src/app/_home-hero.tsx`), covered by `/eval/t8-home-keyswitch`.
- `AgentStartKeySwitchButton` — the Start key in the workspace launch controls
  (`src/components/workspace/launch-controls.tsx`), covered by
  `/eval/t9-agent-start-keyswitch`.

Shared machinery those keys still use lives on in
`src/components/hud/webgl/keyswitch-study.tsx` (assembly, lighting, Smoke Low
variant), `keyswitch-geometry.ts`, `keyswitch-motion.ts` (brown-switch travel
curve, 190 ms), and `keyswitch-audio.ts` (sound profiles) — all still under
test.

## Why it was retired

Material exploration with zero production consumers beyond the two shipped
keys. The variant-browsing study duplicated review value the shipped keys and
their evals already provide, and the dead DOM sibling kept ~294 lines of CSS
in the global stylesheet. If the direction reactivates (e.g. more tactile
action keys), start from the shipped keys and the shared machinery, not by
resurrecting the study; per archive rules, that takes a new decision record.
