# Keyswitch / translucent agent key material studies (retirement interval, 2026-08-02)

> Reactivated in `/hud-gallery` by operator review on 2026-08-02 under decision
> `0025`. This archived note preserves why the bench was removed and what
> stayed retired; active gallery state now lives in
> `docs/engineering/design-system.md` and the decision record.

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
- `AgentStartKeySwitchButton` — retained as reusable R3F machinery and covered
  by `/eval/t9-agent-start-keyswitch`; the workspace New Agent composer moved
  back to the standard shadcn button on 2026-08-02.

Shared machinery those keys still use lives on in
`src/components/hud/webgl/keyswitch-study.tsx` (assembly, lighting, Smoke Low
variant), `keyswitch-geometry.ts`, `keyswitch-motion.ts` (brown-switch travel
curve, 190 ms), and `keyswitch-audio.ts` (sound profiles) — all still under
test.

## Why it was retired, and what stayed retired

Material exploration with zero production consumers beyond the two shipped
keys. The variant-browsing study duplicated review value the shipped keys and
their evals already provide, and the dead DOM sibling kept ~294 lines of CSS
in the global stylesheet. Decision `0025` supplies the required new decision
record and restores the R3F bench from the surviving shared machinery. It does
not restore the unused DOM sibling or its global CSS. A lean T7 paint/variant
gate replaces the retired exhaustive rig without reviving its full harness.
