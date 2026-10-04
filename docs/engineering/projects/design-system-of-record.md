# Design system of record (ENG-036)

Execution detail for roadmap item **ENG-036**. The roadmap owns status, scope, and exit criteria; this doc owns the milestone narratives and the working notes.

The system of record itself — the citable reference every UI change adheres to or deliberately amends — is **`docs/engineering/design-system.md`**. That file is the product of this item, not this file.

## Milestone map

- **G0 Kernel** (landed 2026-08-02): type scale, spacing steps, color roles, status iconography, the amendment rule, and the `/hud-gallery` merge/retire decision list.
- **G1 Gallery reconciliation** (landed 2026-08-02): execute the G0 decision list; amend `AGENTS.md`'s workbench rule; no second source of design truth.
- **G2 Full system**: motion vocabulary, component contracts, IA principles extracted from decision records, recurring audit cadence.
- **G3 Review gate**: checklist-with-visual-evidence gate; later automated as ENG-028 T3's Designer Type.

## Surface audit — 2026-08-03 (visual, Demo Workspace)

First post-demo-arc visual pass over the real Electron app in the Voltaic Demo Workspace (Agent, Team, Fleet, Workspace switcher) plus the signed-out web surface. Screenshots taken through `withElectronApp`; findings are composition-level, which is what G0–G3's token work could not reach by construction. This is the kind of pass G2's "recurring audit cadence" should institutionalize.

**Fleet is the weakest surface, and it carries the demo's scale risk.** ENG-004 owns the fixes; recorded here because the diagnosis is design, not rendering.

1. **The board reads as sparse, not vast.** 173 Agents (69 active / 16 blocked / 88 idle) render as ~170 small hexagons inside ten large project rectangles. Roughly 70% of each rectangle is empty — `demand-gen` is a wide box holding one row of eight hexes. The stated purpose (decision `0023` / ENG-004 V3 design pass) is an INSTRUMENT for situational awareness and a STAGE for scale. Emptiness delivers neither: the eye reads "a few things scattered around" exactly when the pitch is "look how much is running." Zone area should be a function of population, or population should fill its zone.
2. **No legend, and more colors than named states.** The header names three states (active / blocked / idle) while the hexes use at least five fills. A viewer cannot learn the mapping from the surface, which contradicts D30's "learnable fixed-slot" principle that replaced hue-only signalling.
3. **The blocked callout is excellent and mis-placed.** "SAML IdP metadata still missing from the utility's IT team — Credentials needed · 240m waiting · 4 stalled in partner-portal" is the single best piece of copy in the app: specific, human, actionable. It floats top-center, unanchored, while `partner-portal` sits in the second row. Attention callouts should point at their subject.
4. **Three stacked chrome rows before content** (status strip, `Fleet` title + Demo chip, breadcrumb + search + filters), with "Fleet" appearing twice, consuming ~200px before the board starts.
5. **The minimap conveys nothing.** Ten identical grey rectangles mirroring the layout with no population, status, or viewport indication.

Resolution (ENG-004 F7/S3, hardened 2026-08-04): findings 1–5 are closed on
the production board. Population-sized circular Projects and individual Agent
marks carry scale; the one header strip teaches all five D40 states through
clickable global-count filters; the unanchored bell popup and duplicate status
chrome are retired; and the fixed-world minimap carries Project population,
activity/urgency, selection, plus the actual top-down or fixed-angle viewport.
The detailed landing and regression evidence lives in the Spatial Operations
Board project's V3.3 milestone log.

**Cross-surface findings (ENG-036 owns).**

6. **The signed-out web surface is off-system.** `/sign-in` renders a shadcn `Card` with a bright cyan primary button and an `OR CONTINUE WITH` uppercase non-mono divider — a different visual language from the app it fronts. It is the first impression for every contributor, investor, or user who opens a link before installing, and it was outside P8's demo-path polish scope.
7. **The Agent-altitude header right cluster is crowded.** Up to three meta chips (`Coming soon · <Type>`, `Push to cloud`, `read-only demo Session`) plus the consumption meter, `Architecture`, `Sign In`, and the avatar — seven zones competing with the Session title on the same row. Each chip is individually correct under the readiness grammar; collectively they exceed what one row can carry.
8. **The consumption meter is unlabeled.** A bare bar and `84%` sits between the altitude tabs and the Workspace chip with no indication of what is 84% consumed, of what window, or for which Workspace.
9. **Team cards leave large internal voids.** Cards stretch to row height, so a card without delegated children shows a tall empty gap between its state line and its NEXT block; a row containing one card produces a very tall card. Density should not be a function of the tallest sibling.

**Amendment candidates (operator decision, not asserted defects).**

10. **Project identity color as reading-copy color.** `SessionGoalSummary` tints the Session context cue with the Project identity color at `B0` alpha (`session-overview-card.tsx:160,176`). The kernel's channel-ownership rule says Project color is identity only. This was deliberate (the component's own docblock reasons about not competing with identity), and it may be right — but a Team grid of colored subtitles reads at a glance like a status channel. Either the rule gains an "identity may tint its own Session's context cue" clause, or the cue moves to a neutral reading color.
11. **Uppercase on the Fleet board vs the operator's stated preference.** The kernel legalizes uppercase on mono micro-labels ≤11px with wide tracking (the HUD idiom). The Fleet board uses it heavily — the status strip, `TOP`/`ANGLE`, `STATUS`/`BURN`, and the keyboard hint bar. The operator's standing style preference is "no all-caps." The kernel and the preference disagree; one of them should move, and only the operator can say which.

## Roadmap milestone log

- 2026-08-02, G0 Kernel (landed; demo-arc packet P1): `docs/engineering/design-system.md` created from a measured audit of the shipped UI at `f3efd83` — docs only, zero component changes. Findings that shaped the kernel:
  - **Type.** The roadmap's founding measure of 17 hardcoded pixel font sizes had already drifted to 23 in `src` (21 on production surfaces) by the time G0 executed — same-day drift proving the item's diagnosis. The kernel names a 12-rung scale anchored on the already-token-ized D39 chrome roles (`text-chrome-micro/meta/label/title`, 148 usages) plus the correctly-used Tailwind sizes (`text-sm` body, `text-base`/`lg`, 20/22px surface headers), with a 9px "nano" rung legitimizing the accepted ordinal-glyph usage in the tab strip and roadmap rail. Off-scale register: 8px (spatial board), ENG-008's never-reconciled fractional scale (11.5–16.5px across the consumption suite), and 17/19/25/26/28px strays.
  - **Spacing.** The shipped UI is cleanly on the 4px grid with half-steps (2/4/6/8/10/12/16/20/24/32). The kernel records the density tiers as used: chips `px-1.5 py-0.5`, dense rows `px-2 py-1`, operational cards `p-4`, reading panels `px-5 py-4`, shadcn `Card` `p-6` (marketing/auth), gutters `px-6`–`px-8`.
  - **Color.** Four scoped palettes plus one identity channel, all already disciplined in code: shadcn semantic chrome with the D32 macOS-accent primary, the HUD palette (`@theme` + `hud/tokens.ts` mirror), the settings shell neutrals, and consumption's FLUX violet ramp. The channel-ownership rule (status owns white/blue/green/peach/red; amber = attention; violet→magenta = consumption; Project color = identity only) was implicit across D30/D32/D40/flux.ts comments and is now stated once.
  - **Status iconography.** D40's five-signal protocol was already fully canonical in `status-light/protocol.ts`; the kernel cites it rather than restating it, and records the cross-cutting rules (only Active moves at 2.4s, D33 static amber attention, D30 three-channel redundancy, constant glyph footprint, ENG-023 delegation dots).
  - **Gallery audit.** Decision list recorded in the kernel: merge/keep the HUD atom sections, status lights, ribbon study + dogfood bench, roadmap-lab, session-state tiles (open candidate), consumption-lab (until ENG-008 E5); retire the quick-capture and context-label studies (shipped, drifting duplicates), the keyswitch/tactile-key studies (zero production consumers, ~350 lines of dead global CSS), `/hud-gallery/agent-field` (superseded by the production operations board and the `/eval` rigs), and `/hud-gallery/agent-sources` (graduated to `/settings`). G1 executes; G0 deleted nothing.
- 2026-08-02, G1 Gallery reconciliation (landed): executed G0's decision list exactly; net −3,120 lines (80 added, 3,200 deleted). What happened and what it touched:
  - **Retired routes/sections.** `/hud-gallery/agent-field` (555 lines) and `/hud-gallery/agent-sources` (1,182 lines) deleted; quick-capture, context-label, and keyswitch study sections removed from the gallery index. The kept set (HUD atoms + WebGL siblings, D40 status lights, ribbon study, session-state tiles, and the consumption/roadmap/ribbon labs) is what the index now renders and links; the header restates the gallery as the workbench that renders `design-system.md`.
  - **Keyswitch surgery, not amputation.** `KeySwitchStudy` and its study-only internals (`ProductScene`, `OrbitCamera`) were removed from `keyswitch-study.tsx`, along with `/eval/t7-keyswitch` and the T7 task in `scripts/r3f-eval/run.mjs`. The shipped keys survive untouched: `CommandKeySwitchButton` (home hero) and `AgentStartKeySwitchButton` (launch controls) plus their shared geometry/motion/audio machinery, still covered by T8/T9 and unit tests. `TactileActionKey`/`TactileActionLink` deleted after re-verifying zero importers outside `components/hud`; the `.tactile-key` block in `globals.css` was 301 lines including comments. Direction note archived at `docs/archive/keyswitch-material-studies.md`.
  - **Eval fallout.** `scripts/electron-context-label-feedback-eval.mjs` navigated to `/hud-gallery` to assert the context-label specimen existed; that segment was removed (production coverage in the same eval is untouched). Ribbon evals still target the kept `/hud-gallery/project-ribbon` routes.
  - **Canon updated.** `AGENTS.md` workbench rule now names `design-system.md` as the source of design truth; stale `/hud-gallery/agent-field` pointer fixed in `r3f-authoring-guide.md`; ENG-003's references to the retired agent-sources lab annotated in the roadmap.
- 2026-08-02, G3 partial — demo-path polish (landed; demo-arc packet P8): the kernel's off-scale register executed on exactly the demo-walk surfaces, verified with before/after screenshots of the real Electron app (agent altitude, account menu/Workspace switcher, ⌘T opener, ⌘K palette, Team overlay, Fleet DOM layer, Settings) plus the deterministic rigs (`/eval/t5-operations-board`, `/hud-gallery/roadmap-lab`). Every change is a rung citation; nothing was redesigned.
  - **Fixed (bracketed px → named rungs, same pixels unless noted).** Settings shell + agent-sources (41 sizes: 12→`chrome-label`, 13→`chrome-title`, 14→`text-sm`, 15→`text-reading`, 22→`text-display`; the one 17px h2 snapped to `text-base` per the register; `leading-[18px]`→`leading-4.5`); settings nav "Coming soon" pill 9px words→mono `chrome-micro` (+1px, fixes a two-line wrap); site-header workspace chip/tagline 11→`chrome-meta`, pill 10→`chrome-micro`; ⌘K palette + shortcut-badge sm + ⌘T opener 10→`chrome-micro`; launch-controls (9px uppercase badges→mono `chrome-micro` +1px, 10→micro, 11→meta); session-restore-panel, recent-conversations, terminal-pane overlays (10→micro, 11→meta, 13→title); roadmap rail (mono 9px ordinals/glyphs `✓3 +4 ! ▾`→`chrome-nano`, 10→micro, 11→meta, `gap-[3px]`→`gap-1`); roadmap item card (ENG-008 fractional 11.5px snapped: title→`chrome-label` 12, dimmed byline→`chrome-meta` 11), status pill/session chip/detail/empty-queue (9px node glyph→nano, `h-[14px]`→`h-3.5`, 10→micro, 11→meta); fleet top chrome (`spatial-fleet-client` 10→micro, 11→meta); operations-board DOM overlays in `operations-board-surface.tsx` (kbd hints 9→`chrome-nano`, projection tabs and Center 8/9px words→mono `chrome-micro` +1–2px dropping the sub-`sm` split, 10→micro, 11→meta). Two uppercase micro-labels gained `font-mono` to satisfy the uppercase-is-mono rule (settings category h3, agent-sources pill). Tile-study/expose tests updated for the `text-reading` rename only.
  - **Deferred, with owners.** Tab strip + Project ribbon (`tab-strip.tsx`, `project-ribbon-*`, `status-glyphs.tsx` which renders inside tabs) — ENG-016 D42 agent owns. Consumption suite's fractional scale — P6/ENG-008 (later pass per the packet). `operations-board-canvas.tsx` zone-card labels (10/9/8px + `sm:` splits at L794–845, L1624–1628) — P7 owns the canvas files. `notifications-settings.tsx` (Preferences section, off the demo's first screen). `agent-field-surface.tsx` (G0-retired direction). `/hud-gallery`, `/eval` fixtures — G1.
  - **Flagged, not steamrolled (amendment candidates, operator decision needed).** (1) The kernel says Exo 2 never appears in app chrome, but session-tile reading copy (`session-overview-card`, `session-goal-summary`, expose-overlay headers, close-confirm, status-glyph delegation labels, tab-strip tooltip) uses `font-sans` deliberately — commit `44800fd` "make agent context readable" with tests asserting it. Either the family table gains a "reading copy on tiles" exception or these migrate to `font-ui` as a reviewed visual change. (2) The title-bar/rail/tab-strip/fleet chrome runs on zinc-\* neutrals + teal accents, a coherent register the kernel's color section doesn't name; recording it (or migrating it to the semantic/HUD palettes) is a G2 decision. (3) One 11px uppercase non-mono label remains in the fleet top chrome (`spatial-fleet-client` project-group heading) — part of the same zinc register, swept with (2).
- 2026-08-03, Voice rule (landed, operator-directed): the kernel gained a **Voice** section — every user-visible string is written for a production user of a top-tier product (the Salesforce/Linear/Stripe register): nouns, values, states, short labels; no thesis sentences, no "Asked by users"/quotes-as-headers framing, no self-referential explanation of what a surface is; preview surfaces show honest product-shaped UI under the readiness grammar, never essays about the future capability; when tempted to explain, show a concrete product state; caption-length `text-chrome-meta` facts are the prose ceiling on operational surfaces. Trigger: the operator's reaction to `/organization`'s thesis lede + "Asked by users" header ("what is this doing in main product UI? … designing for production audiences, not spewing documentation text into the app. In general."). Executed in the same change as a sweep of `/organization`, `/cloud`, `/coordination`, `/agent-types` (the `PreviewSurfaceShell` question/intent props retired), `/consumption` (all four acts, unit ladder, cost-per-agent and intervention sections — structure and data intact, voice fixed), the demo Session pane empty state, and the `UnbuiltLegend`. Details in the ENG-026 project doc's 2026-08-03 log entry; the amendment-log entry in `design-system.md` is the canonical record.
- 2026-08-03, Consumption study retirement (landed, with ENG-008): the workbench rule ("retire a gallery study once its subject ships") applied to the shipped consumption loop — `/hud-gallery/consumption-lab` (2,523 lines, incl. its frozen `weights.ts`), `/hud-gallery/consumption-redesign` (2,769 lines), the `#ambient-consumption-meter` four-form study, and the importer-verified-dead components (`unit-ladder`, `assurance-legend`, `capacity`, `coverage`, `delegation`, `tightestWindow`/`reportingCoverage`) deleted; gallery index and its test updated; no eval referenced the retired routes. The gallery inventory table, off-scale register (17/19/25/26/28px row cleared; fractional scale down to one roadmap-lab use), and E6 amendment entry updated in `design-system.md` — its amendment-log entry is the canonical record; the full inventory is in the consumption-spine log.
- 2026-09-24, screen-copy guard (landed; BUG-207; G3 partial): the Voice rung "no em dashes in operator copy" gains its check, and 65 strings were rewritten first. The worst were structural rather than cosmetic: every live tab's tooltip ("working — turn in progress"), the ⌘W close confirmation, and the Privacy table's destinations, whose twin had been fixed alone. Each was restructured, not comma-swapped: tooltips name the state as one phrase ("working on a turn", "new, ready for a first task"), the close confirmation states the cost in its own sentence, lists moved into parentheses, and "agents here will starve" became "nothing next for agents here".
  - **The check.** `scripts/check-screen-copy.mjs` (`pnpm copy:check`) parses JSX text, strings and template text and fails on U+2014. Scope is what production can render: the import graph from every route outside `/hud-gallery` and `/eval`, the top-level Next conventions, `@exawatt/ui-model`, and the company overlay composed into `src/` where an official build puts it. Studies, fixtures and tests fall out because only studies and tests import them, so there is no list of studies to rot. Comments and `console.*` never render; a string that is only an em dash is the empty-value glyph in a cell and is allowed.
  - **Routing.** The landing floor runs it for any `src/`, `packages/ui-model/src/` or overlay change; its unit test rides `test:agent-delivery`. One capped exception: the one-click roadmap launch prompt in `workspace-client.tsx`, which is addressed to the Agent.
  - **Found alongside.** `theme:check` is red on master and nothing runs it (BUG-208), which is the failure this routing exists to prevent.
- 2026-09-24, colour ratchet routed (landed; BUG-208): the Colour rung's check, `theme:check`, was red on master for five weeks with 18 raw colours over their caps, and none needed a bigger cap. The status light's `unreported` reading carried a second copy of `off`'s paint and now shares one `UNLIT_PAINT`; the hero capture stopped carrying harness brand colours, which its `source` lens now reads from the Agent Source declarations by id, so the capture's exception is deleted; and the Connect dialog's hand copy of OpenClaw's colour reads its declaration. The floor runs `theme:check` for any change that paints or decides paint, and CI runs it. [Narrative](theming-and-visual-identity.md#roadmap-milestone-log).

### 2026-10-01 — Queued: one transient-state component (BUG-261)

Operator feedback `d8a44d94` and `513ebfde` (2026-09-29): the ⌘⇧T hint toast,
the feedback-sent toast and the update-available banner have three
treatments, and the feedback form has no sending state. One transient-state
rung (pending, then success or error) adopted by all three, with the form as
the first adopter.

### 2026-10-02 — App-wide review shapes paired flows and shared foundations

**Repair continuity and delivery truth before broad restyling.** The operator
confirmed app-wide review first, Cmd+K and feedback shaped together, then shared
foundations. Initial feedback delivery uses a compact sending/result receipt
with focus returned; a shared notice area remains a potential next destination.
Drafts survive dismissal/failure while running. Restart persistence is deferred.
No discovery question remains. BUG-270 records the supplied Claude/Linear
palette suggestion; BUG-261 owns operation/notice presentation.

The source findings below describe the pre-implementation baseline. The
execution amendment at the end records the authorized simplified implementation.

#### Coverage and evidence confidence

Two independent assessments reviewed current source/canon at `981378ed328d`:
one assessed usability and personas, the other ran deterministic pattern scans
and inventoried interaction owners. Coverage includes app navigation and chrome,
Agent/Team/Fleet composition owners, palette/shortcuts, feedback, source setup,
settings, Usage and update/close/recovery notices. This is an app-wide source
review, not a claim of exhaustive native usability testing.

A separate browser tab inspected the installed renderer's Air-theme Fleet demo,
Project drill-in, Cmd+K and source settings. Fleet retains surrounding Projects
when drilling in; status filters name their global counts. The palette visibly
has a compact list, shortcut hints and selection, but no selected-row Enter cue
or keyboard footer. Settings groups sources and shows explicit unknown status
when the Electron bridge is unavailable. The browser's `/workspace` fallback
requires the desktop bridge, so terminal/Team runtime interaction was not
certified. The installed renderer is not this checkout's HEAD. Native focus,
feedback faults, IME, large-type layouts and theme contrast remain execution
checks; no feedback was sent and no source/account settings were changed.

`impeccable 4.1.0 detect --no-config --json` returned zero supported findings
across 139 TSX files (75 production files) in the reviewed component areas.
That static result does not certify contrast, focus, motion or delivery. A
separate lexical inventory found five independently positioned notices, bespoke
quick-feedback/close shells and four feedback spinners without reduced-motion
utilities. These are investigation evidence, not blanket anti-pattern counts.

#### Provisional heuristic assessment

Scores are source-based prioritization on a 0–4 scale (higher is stronger),
not a measured whole-app rating. Independent structural review corroborated
the lifecycle and overlay findings; limited runtime observation corroborated
the palette presentation, not every score.

| Heuristic | Score | Evidence / next check |
| --- | --- | --- |
| Visibility of status | 2 | Quick sending disappears; receipt/live announcement missing. |
| Familiar language | 3 | Shared Agent/Team/Fleet and lifecycle vocabulary; test first-time comprehension. |
| Control and freedom | 3 | Escape/history/recovery exist; general feedback blocks dismissal while pending. |
| Consistency | 2 | Shared nav/theme/status owners; independent notices and feedback models. |
| Error prevention | 2 | Feedback double activation/retry/draft races lack attempt ownership. |
| Recognition over recall | 3 | Search/recents/disabled reasons; selected-row Enter cue missing. |
| Efficiency | 3 | Keyboard grammar and scope-aware resume; capture awaits diagnostics before opening. |
| Minimalism | 3 | Focused Usage/settings/inspector structure; notice overlap requires runtime check. |
| Error recovery | 2 | Good connection/recovery boundaries; feedback discards attachment receipt truth. |
| Help and guidance | 3 | Searchable shortcuts and readiness explanations; palette empty state offers no next step. |

**26/40 provisional source score.** Cognitive load is concentrated at interrupted
work: draft evidence is replaced on reopening and late results can mutate newer
input. Chunking and progressive disclosure have good existing owners; visual
hierarchy and compact-width learnability require rendered review. For a first-time
user, the gaps are action discoverability and trustworthy progress. For a power
operator, the gaps are modal interruption, stale completion and losing input.
Neither persona benefits from a new navigation hierarchy or a cosmetic rewrite.

#### Ranked work and ownership

| Priority | Finding | Execution owner / boundary |
| --- | --- | --- |
| P1 | New retry key, ignored image receipt, late completion clearing newer drafts | ENG-025 / BUG-269; immutable attempt, typed receipt, server reconciliation. Reuse `useLatestRequest` for capture/reads, not cancellation of an accepted write. |
| P1 | Quick dialog catches Enter on kind/evidence/Review controls and lacks IME guard | ENG-025 F6; composer owns send, focused controls retain native activation. |
| P2 | Cmd+K/full/quick feedback have split spacing, focus and shortcut treatments | ENG-036 / BUG-270 with ENG-016 palette behavior; retain cmdk and Radix owners, extract accepted overlay presentation. |
| P2 | At least five notices choose their own position/lifetime/announcement | ENG-036 / BUG-261; shared receipt/notice face and collision policy, domain-specific actions and lifetime. No new Agent attention model. |
| P2 | Feedback progress motion lacks a consistent reduced-motion alternative | BUG-261 shared progress primitive; persistent text remains meaningful without motion. |
| Follow-up | Compact altitude labels and palette empty-state guidance need first-time review | ENG-036 with ENG-016; validate in paired study before adding explanatory chrome. |
| Existing lane | Fleet stopped outlines, restart trust and later celebrations | BUG-268 / ENG-004, BUG-260 / ENG-016, BUG-267 / ENG-035 respectively; keep their separate acceptance and sequencing. |

#### Research and decisions transferred

| Primary example | Useful behavior | Exawatt application |
| --- | --- | --- |
| [Raycast toast API](https://developers.raycast.com/api-reference/feedback/toast) and [2022 action-bar redesign](https://www.raycast.com/blog/a-fresh-look-and-feel) | One operation can update from animated to success/failure; contextual actions accompany feedback. | A stable receipt preserves operation identity and recovery actions. The historical redesign is inspiration, not a claim about every current Raycast surface. |
| [Linear issue creation](https://linear.app/docs/creating-issues) | Temporary local drafts survive navigation; explicitly saved drafts have a separate policy. | Preserve running-session drafts now; do not imply restart durability. |
| [Atlassian flags](https://atlassian.design/components/flag) | Actionable error/warning notices remain available. | Success/hints may expire; failure/partial delivery and update actions remain recoverable. |
| [Apple feedback guidance](https://developer.apple.com/design/human-interface-guidelines/feedback) | Feedback belongs near its cause; interruption follows consequence. | Collapse near the composer first, restore work focus, evaluate shared placement through real overlap cases. |
| [W3C status messages](https://www.w3.org/WAI/WCAG21/Understanding/status-messages) | Status can be announced without moving focus. | Routine pending/success use accessible status announcements; recovery does not steal focus. |
| [Superhuman shortcuts](https://help.superhuman.com/hc/en-us/articles/46005789591693-Speed-Up-With-Shortcuts) | Cmd+K teaches shortcuts alongside actions. | Preserve manifest-derived chords and add a stable activation hint for the selected enabled row. |

The supplied Claude screenshot's highlighted Enter cue and the Linear screenshot's
roomy grouped rows motivate a comfortable overlay density tier. They do not
justify copying pixel dimensions or turning every operational panel into a large
modal. Sharing presentation must retain palette Return-to-activate and the
single feedback composer's Return-to-send text-field contract. The operator execution amendment below
supersedes the quick/full split. Disabled reasons
remain truthful. The selected action cue belongs to the palette row, not the
Team tutorial header deliberately retired in September.

#### Execution contract and exit

The reporting package sequence is ENG-025 F6.1–F6.5; this log supplies its
cross-surface review and shared-foundation boundary, not another roadmap.
The roadmap's ENG-025 project reference owns detailed reporting acceptance.

The paired DOM study reviewed empty/search/disabled/selected palette states
beside the single composer and receipt states, with hint/update siblings. The
operator explicitly authorizes comfortable shared overlays, visible owned-key
hints and immediate receipts after rejecting animation machinery. The study is
retired; no further gallery approval is pending. Use existing Type, Spacing,
semantic Color roles, Menus, Dialogs, Motion and Voice. No new fonts/status lamps
or R3F changes are required.

Amend the design-system canon to the authorized simplified behavior: shared
Dialog presence and overlay presentation, immediate receipt states with only a
pending spinner. Establish server receipt truth before retrying-client adoption
and wire the paired flows. Migrate close hints/update presentation incrementally;
retain update restart/dismiss/shutdown semantics. Broader adoption follows measured
need, not a forced app-wide replacement in one diff. The study is retired with
shared adoption.

Exit: keyboard-only activation and recovery work; disabled rows never promise
Enter; focus returns once to the intended live control; older completions cannot
alter a newer draft; same-attempt retries converge on one report and truthful
image status; notices announce without stealing focus and avoid overlap. Review
Classic/Air/Night, reduced motion, constrained widths and enlarged interface type.
Test these contracts, not today's copy or layout dimensions. Architecture projections
change with the implemented owner, not with this plan. Delight celebrates an
evidenced accomplishment only after reliability and restart trust are established.

### 2026-10-02 — Simplified shared foundations authorized for adoption

**Immediate receipts and shared overlays are authorized.** Keyboard capture,
palette and Help invoke one composer. Draft/evidence survive dismissal within
the running app, immutable attempts preserve delivery truth, and a compact
receipt returns work focus. The operator explicitly instructs proceeding with
simplified states. The paired increment is verified and integrated in
`9d6b0d46`; combined UI deployment is READY and exact-SHA dogfood installation is confirmed. The broader G2 system remains open.

The app-wide principles are concrete: show terse owned-key hints beside their
controls; never promise activation on disabled controls; use one predictable
path for validated evidence. Cmd+K adopts comfortable shared overlay spacing,
a keyboard footer and selected enabled Return cue without hiding registered
shortcuts. The attachment control, paste and drop share one validator; the
preview close icon removes evidence without a redundant Replace button.
Focused controls retain native Return behavior.

The first snapshot flight was rejected as janky and failed to demonstrate real
panel presence; the revised receipt fade/background-resize treatment was also
rejected. Both mechanisms are removed. `ui/dialog.tsx` now owns real Radix
Presence through `overlay-presence.module.css` named CSS animations (240ms
enter, 160ms exit), with typed `motion: auto | none` and immediate screenshot
capture override. Receipt states change immediately; only pending has a
reduced-motion-aware spinner. There are no state snapshots, receipt body fades,
resizing background plate or operation-motion owner. Reduced motion disables
shared presence animation without changing state or actions.

`ui/notice-lane.tsx` owns bottom-right placement/order for update, hint and chord
notices. Domain owners retain lifetime, dismiss/restart actions and truth;
feedback receipts stay near the composer initially. The notice lane is a shared
presentation boundary, not a new Agent attention engine. Retire the gallery
study as this authorized direction moves into shared production components.
ENG-025 F6 and decision 0045 own delivery acceptance; this log records the
supersession and evidence rather than creating another roadmap.

### 2026-10-02 — Paired G2 increment verified and integrated

**The paired increment is delivered.** `9d6b0d46` integrates
comfortable Cmd+K/shared Dialog presentation, local keyboard cues, one feedback
composer, immediate truthful receipts and shared notice placement after the
normal floor and declared surface gates passed. The gallery study is retired.
This closes only the paired overlay/reporting increment; ENG-036's full G2
component contracts, IA principles and recurring audit work remain open.

The server reconciliation production deployment is READY. The combined UI
deployment is READY and exact-SHA dogfood installation is confirmed. F6's delivery
log owns exact artifact evidence; do not infer installation from a queued or
building worker. No broader whole-app quality or public-release claim follows
from these verified flows.


### 2026-10-04 — Retain the workflow; repair focus and action truth (F7)

**Keep progress and recovery inside one recognizable workflow.** ENG-025 F7 /
BUG-272 supersedes F6.4 close-on-send; artifact installation did not validate
production writes. Incident 0032 owns the narrow missing-grant diagnosis. The
broader G2 design-system work remains active; this is one follow-through
increment, not a claim that the app-wide audit is complete.

Independent official-source review, 2026-10-04:

| Primary source | Confirmed guidance | Exawatt application / inference |
| --- | --- | --- |
| [W3C modal-dialog APG](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | Open modal dialogs contain focus; close restores the invoker or logical workflow target. Modal ARIA is appropriate only when background interaction is actually blocked. | Shared Dialog must release trap/inert/pointer ownership on logical close. Nonblocking notices cannot use modal behavior; retained exit visuals are not an interactive dialog. |
| [Carbon modal guidelines](https://www.carbondesignsystem.com/building-blocks/core/components/modal/guidelines) and [inline loading](https://www.carbondesignsystem.com/building-blocks/core/components/inline-loading/guidelines) | Validation/server failures remain in the form; short progress can use inline loading. Loading occupies the same position and prevents duplicate action. | Keep one dialog across input/pending/terminal; retain draft/evidence, use stable toolbar/action slots and native Button busy/disabled semantics. We do not adopt Carbon's timed success delay. |
| [GOV.UK error messages](https://design-system.service.gov.uk/components/error-message/) | Preserve entered fields; user-fixable validation errors differ from service problems. | A valid report whose service failed is not an invalid text field. Plain language explains known refusal versus unconfirmed delivery and the safe next action. |
| [Apple feedback](https://developer.apple.com/design/human-interface-guidelines/feedback) | Integrate status in the interface and match interruption to importance. | Retained local progress/recovery keeps task context; unrelated passive notices never take focus. This is an application of the guidance, not a mandated Apple dialog layout. |

Shared source owners are Dialog focus/presence, Button native action states, one
action descriptor for visible and accessible shortcuts plus dispatch, and the
feedback provider's existing immutable attempt. The user-text/status distinction
uses current reading and status rungs rather than new muted cards. Stable
geometry prevents changing enabled actions from moving neighboring targets.

F7's executable sequence and behavior acceptance live in the feedback project,
with least-privilege backend proof preceding real-delivery acceptance. Material
cross-surface visual changes still require `/hud-gallery` operator review before
adoption; neither this log nor the retired Oct2 study claims acceptance of the
new retained-dialog flow. No additional permission request is made during
shaping. Demo/Live and existing cmdk/Radix owners remain shared boundaries.


### 2026-10-04 — Everyday-use polish shaping and research basis

**Make active use excellent through coherent journeys and shared ownership.**
Operator-confirmed direction: daily use leads; a newcomer must still discover
and understand the same affordances. A dedicated newcomer on-ramp is a later
prioritization regime. Layout and flow changes are welcome when they demonstrate
an improvement. Significant new features are outside this polish pass.
Execution authorized 2026-10-04 after the steering below. Read versus unresolved attention and
priority ordering are accepted in decision `0046`; restart restores paused
with an explicit resume action. This section is execution detail for ENG-036 with existing owners,
not a new roadmap. The execution checkpoint below owns current lane handoffs.

#### Research ledger and application hypotheses

Keep three things distinct: what a source establishes, what Exawatt infers from
it, and what the implemented product demonstrates. The following sources were
reviewed on 2026-10-04; none studied Exawatt or establishes a productivity uplift
for agent-fleet operation.

| Source and evidence type | Finding or guidance | Application to investigate |
| --- | --- | --- |
| [Budiu, Recognition and Recall, NN/g, 2024](https://www.nngroup.com/articles/recognition-and-recall/) — usability synthesis | Visible choices and contextual cues support recognition rather than unaided recall. | Keep useful Session purpose, state meanings and available actions recognizable at each altitude; improve existing context cues before adding explanatory chrome. |
| [Czerwinski, Horvitz and Wilhite, CHI 2004](https://research.microsoft.com/en-us/um/people/horvitz/taskdiary.pdf) — week-long diary study | Information workers interleave tasks and encounter difficulty recovering complex work; the authors propose support for task switching and recovery. | Preserve Project/Session identity, position and attention across interruptions; evaluate re-entry as a whole journey. This observational study does not prove our layout. |
| [Mark, Gudith and Klocke, CHI 2008](https://www.ics.uci.edu/~gmark/chi08-mark.pdf) — controlled experiment, 48 participants | Participants compensated for interruptions with faster work but reported greater stress, frustration, time pressure and effort. | Evaluate disruption and effort alongside task speed. Do not equate more notifications or faster clicks with a better experience. |
| [Leroy and Glomb, Organization Science, 2018](https://doi.org/10.1287/orsc.2017.1184) — four studies | Briefly planning a return reduced attention residue and supported performance on the interrupting task under the studied conditions. | Investigate existing re-entry cues and a reliable return queue. An automatic summary is not the study's user-authored intervention; no mandatory note-taking feature follows. |
| [Apple feedback guidance](https://developer.apple.com/design/human-interface-guidelines/feedback) and [W3C status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) — design guidance and accessibility standard | Integrate feedback appropriately; status can be communicated without moving focus. | Shared action/progress/recovery states must preserve the current task and expose outcomes accessibly. F7 owns the feedback implementation. |

#### Existing code and changed evidence

- `workspace-state/use-attention-focus.ts` currently clears renderer attention
  on focused selection and tells main to focus the Session. This is an explicit
  S1 interaction contract, not evidence that every outstanding request resolved.
- `session-status.ts` orders eligible operator gates oldest first and excludes
  turn-end results from that jump selection. Including finished results or
  severity ordering would change the contract; neither is silently approved.
- `workspace-state/layout-serialize.ts` persists arrangement, identity, touched
  drafts and selected context cues but accepts no attention/read-state input.
  Restart work must separate durable operator intent from volatile execution
  facts. Never restore an old working badge as proof of a running process.
- Existing turn-truth, Session lifecycle, navigation, desktop-bridge and
  workspace-state owners are the starting point. ENG-039 already extracted
  several of these seams; do not build a second global state engine.
- F6's October 2 deployment is not sufficient evidence of successful reporting.
  October 4's BUG-272/F7 and incident 0032 supersede its production-delivery
  implication and close-on-send interaction. Preserve F7 ownership and acceptance.
- The feedback triage read found zero operator and zero suggestion rows; no
  new inbox promotion was required. This review is source/research evidence,
  not a fresh runtime reproduction of the remaining bugs.

#### Candidate work packages and ownership boundaries

These packages consolidate existing scope. The order is provisional while detailed traversal and source resolution
evidence are being shaped; no new ENG item or competing plan is needed.

| Journey / owning items | Existing work covered | Shared responsibility and exit proof |
| --- | --- | --- |
| Remember why this Session exists — ENG-021 / ENG-015, presentation ENG-036 | Existing Session context cues and S4 context paging | Reuse the purpose-label owner and stable Session identity. Across 5–20 distinct purposes, the operator can identify the intended outcome before interpreting the next request. Keep purpose legible in read/unread and working/finished states; change summaries are secondary. No new recap or Initiative feature. |
| Trust what needs me — ENG-015 / ENG-016, Fleet consumer ENG-004 | BUG-257/258/264/265/163 | Source adapters supply explicit turn/request evidence. Shared projections distinguish execution, an unresolved request, unread results and operator reminders. The glyph, jump target and notification derive from accepted transitions; settings may mute sound. Replay compaction, child work, completion and working-with-question sequences without fabricated certainty or duplicate alerts. |
| Leave and return safely — ENG-016 / ENG-015 | BUG-260/259/209 and BUG-117's remaining recheck | Persist operator state by durable Session identity through the existing checkpoint/restore owner. Verify mixed running/paused/needs-you/unread tabs, order, selection and exact conversation identity across update/relaunch. Unsupported harnesses remain visible with an honest recovery action. Restore paused and offer explicit resume for the previously running set; automatic execution stays future scope. |
| Find and enter the right work — ENG-004 / ENG-023 | BUG-262/263/268/134, with BUG-113 reproduction if still present | Navigation owns selected identity; the source-neutral population/query owns membership; rendering owns resolution and motion. Preserve selection through filtering and altitude changes, explain lifecycle separately from turn state, and measure packaged transition work before optimization. Census expansion stays with D6, not a hidden prerequisite for every visual fix. |
| Understand actions and recover — ENG-036 / ENG-025 | F7/BUG-272, remaining G2 component/IA work, BUG-061/138 review | F7 retains feedback delivery ownership. Shared Dialog/Button/command contracts cover focus, actual activation, stable action placement, progress and recoverable failure. Reconcile gallery specimens with production consumers rather than restyling all surfaces. |

Necessary refactors ship with their journey: identify the authoritative owner,
move sibling consumers onto its contract, remove superseded paths, then verify
the whole scenario. Repository-wide module migration, dependency-major sweeps,
new harnesses, managed hosting, extra themes and celebration features are not
prerequisites. Existing time-bound demo commitments remain recorded; this
shaping session does not silently cancel them or authorize their feature work.

#### Demonstrating better before adoption

Use the same tasks, data and starting state for current and proposed flows:
several Projects with 10 Sessions, and a crowded approximately 30-Session case;
include active work, completed results, a hard blocker, a question while working,
a paused Session, and unavailable source evidence. Exercise finding the next
request, inspecting without answering, returning later, changing altitude,
restarting, and recovering a failed action.

Also check re-entry across 5–20 distinct purposes: can the operator identify
the overall goal without rereading the transcript? Agent count and purpose count
are different dimensions; the fixture must exercise both.

Record wrong targets, missed requests, lost context/input, accidental actions,
focus loss, repeated scanning/backtracking and the operator's reported effort.
Time is supporting usability/performance evidence, not a flaky unit-test oracle.
An operator walkthrough judges daily-use improvement; an unaided newcomer
comprehension check asks what is happening and what action is available, without
building an onboarding flow. If a newcomer is unavailable, report that gap.

Material cross-surface changes go through the existing paired gallery review,
including DOM/R3F siblings where relevant. Preserve shortcut reachability,
Demo/Live boundaries, exact identity, theme legibility, large type and reduced
motion. Accept against recorded before/after evidence; reject a design that
looks cleaner but hides unresolved work or adds steps to routine operation.
Test behavior and state contracts, not today's wording or layout constants.

#### Accepted operator steering and remaining detail

- Accepted, follow-up: purpose is the highest-level re-entry cue. Show the
  overall goal and why the Session exists before secondary activity/change
  detail, while keeping an outstanding request visible. The operator reports
  juggling 5–20 distinct whys; do not substitute an Agent-count assumption.
- Accepted, follow-up: distinguish unread results from already-read results.
  Exact treatment is exploratory and low priority; no further abstract styling
  decision is needed now. Compare subtle treatments in the eventual paired
  study, keeping purpose readable and positions stable. Automatic dimming,
  folding, hiding or closing is not an accepted behavior. A read request that
  remains unresolved keeps its needs-you signal.

- Accepted: inspection clears unread but retains unresolved needs-you. The
  operator compared this to read mail still in the inbox awaiting reply/triage.
- Accepted: Cmd+J prioritizes hard blockers, then working questions, then unread
  finished results, oldest within each class. Dependability should carry the
  rule; whether any explicit explanation is needed remains a design judgment.
  Candidate: a short hint on the existing command, without permanent chrome.
  Shape pass traversal so persistent blockers do not trap navigation in a loop.
- Accepted: after an update, restore context paused and offer one resume action
  for previously running Agents. Previously paused Agents stay paused and out
  of that resume set. The operator chose lower complexity and risk. A future
  explicit restart-and-resume option may belong to restart or quit confirmation;
  its placement and implementation remain deferred. Restoring context never
  claims computation continued through a process restart.

Decision [0046](../decisions/0046-reading-does-not-resolve-attention.md) records
the accepted semantic changes and their implementation boundary.

The accepted semantics are recorded in decision 0046, concepts and reference
authoring notes; current guide instructions remain accurate to shipped code.
Update architecture and its manifest when implementation changes ownership. Research-backed explanations feed ENG-042/ENG-031 through
Marketing Canon's research-informed design story; public claims follow the
specific evidence available for each shipped interaction.


### 2026-10-04 — Everyday-use execution checkpoint

**Execution is authorized and running in isolated, coordinated worktrees.**
The operator requested maximum useful parallelism, autonomous completion and
cleanup, Boy Scout improvements to UX and architecture, and persistent handoffs.
Material architecture/UX choices still come back with concrete evidence. The
accepted purpose, attention and pause-first restart rules are not re-interviewed.

| Lane / branch | Owning files or responsibility | Dependency and next evidence |
| --- | --- | --- |
| Coordination / `agent/polish-coordination` | This checkpoint, roadmap, decision 0046, concepts, architecture/manifest and evidenced marketing | Reconcile independent landings, collect concrete gallery review, preserve exact delivery evidence and cleanup roster. |
| Attention / `agent/polish-attention` | Main attention monitor, bridge attention shape, renderer attention projection, workspace/demo queue wiring; ENG-015 log | Publish one durable read/request contract to restart and source lanes; prove inspection does not resolve a request, stable priority traversal, mark unread without re-alert, and bell coupling. |
| Source truth / `agent/polish-source-truth` | Source adapters, harness-events/turn-truth and their production pipeline; ENG-016 log | Trace Codex parent/child/compaction and Claude completion, verify installed provider evidence; coordinate additive source evidence with attention owner. |
| Restart / `agent/polish-restart` | Persisted layout, checkpoint, serialization/restoration and exact-Session recovery; ENG-018 log | Depend on attention contract, then rebase on its landed implementation; preserve operator state and the previously-running set, restore paused, expose explicit eligible resume. |
| Purpose / `agent/polish-purpose` | Existing purpose projection and its consumers; ENG-021 log | Paired DOM gallery comparison before material hierarchy adoption; no new recap/Initiative model. Workspace-client wiring belongs to attention until coordinated. |
| Spatial / `agent/polish-spatial` | Resolution, motion and handoff rendering; ENG-004 log | Reproduce on real 30-Agent fixture, prove DPR/display changes and characterize packaged transition; no state/query ownership fork. |
| Delegation / `agent/polish-delegation` | Census/query/population responsibility; ENG-023 log | Read-only salvage from `agent/delegation-build`; exclude unrelated D8 and unreviewed Fleet presentation. Model proof first, concrete compact-popover review before new interaction adoption. |
| Gallery hygiene / `agent/polish-gallery-hygiene` | Gallery index and confirmed consumer-less wrapper retirement | Preserve all active studies, including purpose and feedback; repair BUG-061/138 without a broad dead-code sweep. |
| Unknown-harness recovery / restart-owned delegated lane | Closed ledger and unavailable exact-resume behavior, BUG-209 | Preserve unknown records and explain unavailable capability; never coerce into a different harness. Coordinate workspace-model edits with restart. |

Every lane bootstraps its own worktree and server, commits recoverable progress,
uses the FIFO landing floor with its declared surface gates and dogfood where
applicable, then removes only its own landed branch/worktree. Cross-lane
interfaces are coordinated before duplicate edits. The relevant owning project
log records source findings, tests, current blockers and next steps. This table
is a handoff index under the existing roadmap, not an independent plan.

**Existing work preserved.** `agent/feedback-recovery` is a separate active,
dirty worktree whose F7 candidate and real-delivery evidence already exist.
Do not touch it, duplicate its Dialog/Button work, or claim its visual adoption.
Its latest canonical log says real signed-app delivery is proved and retained
workflow review remains pending. `agent/delegation-build` is clean but old;
its checkpoint mixes useful D6 with D8 and unreviewed UI. Adapt useful portions
in the new lane; leave the original untouched.

**Early evidence, not completion claims.** Codex's installed read-side API can
return an active TUI parent turn as interrupted with no completion time; schema
presence is not authority. Preserve unknown instead of manufacturing done.
A real Fleet DPR 1 to 2 change left the canvas at DPR 1 while active rotors
continued moving, isolating a resolution defect. Battery power intentionally
limits resolution/motion and is a separate policy question. Purpose is primary
in some consumers but secondary in Cmd+K, and a stopped Team tile dims its whole
purpose line. These findings guide bounded owner repairs and concrete reviews.

Remaining visual reviews will be presented as actual studies/screenshots with
one recommendation; keep independent correctness work moving while a review is
pending. No study is accepted merely because it renders, and no installed claim
follows from a queued dogfood request. Update this checkpoint as lanes land.
