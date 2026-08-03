# Design system of record (ENG-036)

Execution detail for roadmap item **ENG-036**. The roadmap owns status, scope, and exit criteria; this doc owns the milestone narratives and the working notes.

The system of record itself — the citable reference every UI change adheres to or deliberately amends — is **`docs/engineering/design-system.md`**. That file is the product of this item, not this file.

## Milestone map

- **G0 Kernel** (landed 2026-08-02): type scale, spacing steps, color roles, status iconography, the amendment rule, and the `/hud-gallery` merge/retire decision list.
- **G1 Gallery reconciliation**: execute the G0 decision list; amend `AGENTS.md`'s workbench rule; no second source of design truth.
- **G2 Full system**: motion vocabulary, component contracts, IA principles extracted from decision records, recurring audit cadence.
- **G3 Review gate**: checklist-with-visual-evidence gate; later automated as ENG-028 T3's Designer Type.

## Roadmap milestone log

- 2026-08-02, G0 Kernel (landed; demo-arc packet P1): `docs/engineering/design-system.md` created from a measured audit of the shipped UI at `f3efd83` — docs only, zero component changes. Findings that shaped the kernel:
  - **Type.** The roadmap's founding measure of 17 hardcoded pixel font sizes had already drifted to 23 in `src` (21 on production surfaces) by the time G0 executed — same-day drift proving the item's diagnosis. The kernel names a 12-rung scale anchored on the already-token-ized D39 chrome roles (`text-chrome-micro/meta/label/title`, 148 usages) plus the correctly-used Tailwind sizes (`text-sm` body, `text-base`/`lg`, 20/22px surface headers), with a 9px "nano" rung legitimizing the accepted ordinal-glyph usage in the tab strip and roadmap rail. Off-scale register: 8px (spatial board), ENG-008's never-reconciled fractional scale (11.5–16.5px across the consumption suite), and 17/19/25/26/28px strays.
  - **Spacing.** The shipped UI is cleanly on the 4px grid with half-steps (2/4/6/8/10/12/16/20/24/32). The kernel records the density tiers as used: chips `px-1.5 py-0.5`, dense rows `px-2 py-1`, operational cards `p-4`, reading panels `px-5 py-4`, shadcn `Card` `p-6` (marketing/auth), gutters `px-6`–`px-8`.
  - **Color.** Four scoped palettes plus one identity channel, all already disciplined in code: shadcn semantic chrome with the D32 macOS-accent primary, the HUD palette (`@theme` + `hud/tokens.ts` mirror), the settings shell neutrals, and consumption's FLUX violet ramp. The channel-ownership rule (status owns white/blue/green/peach/red; amber = attention; violet→magenta = consumption; Project color = identity only) was implicit across D30/D32/D40/flux.ts comments and is now stated once.
  - **Status iconography.** D40's five-signal protocol was already fully canonical in `status-light/protocol.ts`; the kernel cites it rather than restating it, and records the cross-cutting rules (only Active moves at 2.4s, D33 static amber attention, D30 three-channel redundancy, constant glyph footprint, ENG-023 delegation dots).
  - **Gallery audit.** Decision list recorded in the kernel: merge/keep the HUD atom sections, status lights, ribbon study + dogfood bench, roadmap-lab, session-state tiles (open candidate), consumption-lab (until ENG-008 E5); retire the quick-capture and context-label studies (shipped, drifting duplicates), the keyswitch/tactile-key studies (zero production consumers, ~350 lines of dead global CSS), `/hud-gallery/agent-field` (superseded by the production operations board and the `/eval` rigs), and `/hud-gallery/agent-sources` (graduated to `/settings`). G1 executes; G0 deleted nothing.
