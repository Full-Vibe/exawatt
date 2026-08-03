# 0025 Reactivate the R3F keyswitch gallery study

Date: 2026-08-02
Status: accepted

## Context

ENG-036 G1 retired the `/hud-gallery` keyswitch material bench because the
variant study appeared to duplicate the two shipped keys, while its unused DOM
sibling kept roughly 294 lines of dead global CSS. The R3F implementation itself
survived because the home command key and the T8/T9 eval rigs still consume its
assembly, materials, motion, and audio machinery.

After reviewing the reconciled gallery, the operator explicitly asked why the
keyswitches had disappeared and directed that they return. The missing bench was
not experienced as useful cleanup; it removed the one place where the full
physical-control material family could be compared and evolved without wiring
an experiment into a production action.

## Decision

Restore `KeySwitchStudy` to `/hud-gallery` as an active R3F material workbench.
The gallery is the correct home for comparing the existing keycap, switch,
lighting, motion, and sound variants before any further production use.

This reversal is deliberately narrow:

- Keep the unused DOM `TactileActionKey` / `TactileActionLink` sibling and its
  deleted global `.tactile-key` CSS retired.
- Restore a lean `/eval/t7-keyswitch` rig for the active workbench. It verifies
  a painted frame, the draw-call ceiling, variant selection, the complete
  seven-variant registry, and one live assembly; the retired exhaustive harness
  is not revived wholesale.
- Keep the New Agent composer on the standard responsive shadcn button. The
  keyswitch remains appropriate elsewhere and in the material workbench; this
  decision does not make it the default action-control recipe.
- Continue to follow the R3F authoring guide: keyboard semantics live in DOM,
  reduced motion is honored, and every material change receives an R3F visual
  self-check.

## Consequences

- The design-system `/hud-gallery` audit and amendment log now mark the R3F
  keyswitch study **Keep**, superseding only that row of the G1 retirement.
- The historical archive note remains as the record of the retirement interval
  and now points here; it is not active direction.
- Future physical-control experiments start in this restored gallery bench and
  graduate selectively. They do not reintroduce a second app-wide button system.
- The lean T7 rig provides deterministic screenshot evidence for the workbench;
  T8/T9 continue to protect the production-scale command-key assembly.
