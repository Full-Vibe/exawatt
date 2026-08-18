<!-- Generated for the public repository by the "public-document-set" recipe. -->
# ENG-026 Vision-complete information architecture

Owning roadmap item: `docs/engineering/roadmap.md` → ENG-026. This doc is execution detail, not an independent roadmap.

Source: the 2026-08-02 operator brief and the design pass held the same day.

## Why this exists

Exawatt is demoed continuously — to users, prospective contributors, and enterprise buyers — and the operator's stated highest-priority work is _explanatory_: painting the whole picture of the product's spine and capabilities, holistically, ahead of those demos.

Today the app shows exactly what is built. That is honest but it under-sells a product whose entire thesis is a command layer that scales from one agent to thousands. The brief's answer, now vision principle 8: **the real app shows its complete intended information architecture, including surfaces that are not built yet**, with a subtle-but-clear grammar and zero fabricated truth claims.

This item owns that grammar, the surface map, and the preview surfaces. It does not own the underlying capabilities — each capability keeps its own roadmap item and lands on its own sequence.

## The central architectural decision

**Readiness is a property of the data source, not of the page.**

A preview surface is not a mockup. It is the real page, rendered from the same view models the live implementation will use, fed by a demo/representative source, and marked honestly. Shipping the capability swaps the source and flips readiness to `live`; it does not replace the page.

This is deliberate anti-frankenjamming architecture, and it collapses three things the repo was treating separately:

- Demo Mode's existing "same UI layers, lower-level source abstraction" principle (`docs/product/demo-mode.md`)
- the Demo Workspace (ENG-027)
- forthcoming/unbuilt surfaces

All three are the same mechanism: a surface + a source + a readiness fact. One grammar, one seam, three uses.

Consequence for agents: never build a throwaway mock page for a preview surface. If a preview cannot be expressed as a view model over a source, the design is not finished yet.

## Readiness vocabulary

Three states. They are facts about a surface, carried in the navigation manifest and rendered by one shared component set.

| Readiness   | Meaning                                                                          | Presentation                                                                                | Example                         |
| ----------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------- |
| `live`      | built, truthful, user's own data                                                 | normal                                                                                      | Agent, Team, Settings           |
| `preview`   | designed page exists and is navigable; renders representative data               | full-strength page, one persistent unobtrusive **Coming soon** marker in the surface header | Team, Cloud, Coordination       |
| `announced` | the affordance is visible so the map is complete, but there is no page behind it | muted control, `cursor: default`, tooltip naming what is coming                             | _Push to cloud_ on an Agent tab |

Rules:

- A `preview` surface never presents representative data as the operator's own, never claims a live connection, and never simulates an action succeeding. Vision principle 4 (truthful assurance) is not relaxed for demo value.
- The marker is subtle and singular. No banners, no repeated disclaimers, no explanatory paragraphs pasted into the page. One marker per surface.
- `announced` affordances never look broken or disabled-by-error. They read as _not yet_, which is a different visual fact from `unavailable` or `degraded` (see ENG-003's source-state vocabulary — the same distinction, one level up).
- **Coming soon** is the app-wide token. It supersedes ENG-003's provisional `Coming later` wording so the product speaks one phrase; ENG-003's underlying requirement (a supported-but-uninstalled source and a future source must look visibly different, and neither may look broken) is unchanged.
- Readiness is manifest data, not per-component styling. A capability shipping is a one-line manifest change plus a source swap.

## Surface map

The command-altitude spine stays exactly three destinations (operator, 2026-08-02): **Agent → Team → Fleet** (decision `0023` names). Vision surfaces do not join the title bar; they join the `app` tier alongside Settings, reachable from ⌘K, the Go menu, and one contextually correct on-surface entry point each.

| Surface                       | Tier       | Readiness at start | Entry point                          | Owning item       |
| ----------------------------- | ---------- | ------------------ | ------------------------------------ | ----------------- |
| Consumption                   | app        | `preview` → `live` | Project header, Team, ⌘K             | ENG-008 E4 → E5   |
| Organization                  | app        | `preview`          | Workspace switcher, ⌘K               | ENG-012 / ENG-034 |
| Cloud / placement management  | app        | `preview`          | Agent tab menu, ⌘K                   | ENG-033           |
| Coordination                  | app        | `preview`          | Team altitude, ⌘K                    | ENG-029           |
| Agent Types                   | app        | `preview`          | composer source row, agent chips, ⌘K | ENG-028           |
| _Push to cloud_ (per Agent)   | affordance | `announced`        | Agent tab context menu               | ENG-033           |
| _Agent Type_ chip (per Agent) | affordance | `announced`        | tab / Team card                      | ENG-028           |

Every row lands in `src/components/nav/surfaces.ts`. That manifest gains a `readiness` field and stops implying that every registered surface is built.

Amended 2026-08-16 by decision `0037`: `/cloud` remains the future
provisioning and placement-management face; it does not become a second roster.
Connecting an existing customer-hosted Agent starts at **⌘N → Connect existing
Agent…**, and the resulting coworker appears in the ordinary Agent, Team, and
Fleet surfaces. The historical `Push to cloud` preview remains announced and
inert until ENG-033 H4 can state exactly which source state transfers.

## The four user questions

Prospective users have asked four questions repeatedly (operator brief). Each is a demo failure if it has no on-screen answer. Each maps to a surface, and answering them is this item's acceptance test — not a talking point.

| Question                                                   | Answering surface                                     | Posture                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "How are you tracking cost per agent?"                     | Consumption                                           | Preview first, then true. ENG-008 E0 already parses real local per-Session token truth with `observed` assurance, but attribution (E2) is not landed, so E4 ships the expository surface demo-sourced and E5 flips the source. The readiness grammar makes that honest instead of embarrassing.   |
| "How do you think about handoff between agents?"           | Coordination (preview) + ENG-019 crystallization      | Preview shows the intended model; the honest current answer is that handoff today is the operator.                                                                                                                                                                                                |
| "Where are the gaps where you have to intervene manually?" | Consumption → **Intervention rate**                   | Real metric, cheaply available: the ENG-023 harness event channel already receives `UserPromptSubmit`, so interventions per Session, per hour, and per 100k tokens are countable from data Exawatt already holds. This is the operator's own suggestion and it is a genuinely novel product stat. |
| "What does multiplayer look like in Exawatt?"              | Organization (preview) + Workspace switcher (ENG-027) | The Workspace switcher makes tenancy real on screen even while Organization is preview.                                                                                                                                                                                                           |

## Milestones

- **N0 Readiness grammar** — LANDED 2026-08-02 (see the milestone log). `readiness` in the navigation manifest and the shared component set in `src/components/readiness/`, prototyped in `/hud-gallery` for operator review. The ENG-003 `Coming later` → `Coming soon` reconciliation was already in force in code; E4's `Unbuilt` treatment folded in.
- **N1 Surface map** — LANDED 2026-08-02 (see the milestone log). The app-tier vision surfaces registered in the manifest as navigable `preview` shells with entry points in ⌘K and the Go menu; navigating to each works from a cold start and nothing in the spine links into a broken state. The one-per-surface contextual anchors were deliberately deferred to N3–N5, where each surface's real content and its anchor land together (see the log for the reasoning).
- **N2 Consumption surface** — LANDED as ENG-008 E4 on 2026-08-02, before N0 existed. The two obligations E4 left open closed with N0/N1 the same day: `/consumption` is registered `preview` in the manifest (its header marker is manifest-driven, so E5's flip to `live` is one line) and the intervention-rate metric renders in the Consumption narrative. Original contract: owned by ENG-008 E4 (its production placement was explicitly unshaped pending this design pass; this pass shapes it). Ships demo-sourced under the `preview` marker through the same UI-model contracts Live will use, then flips to `live` when ENG-008 E5 wires local data. Deliberately not a debugging arc: it must read as a real, self-explaining feature, not a perfected accounting system. The intervention-rate metric belongs here.
- **N3 Organization and Cloud previews** — LANDED 2026-08-02 (see the milestone log). The multiplayer/tenancy story (named **Organization**, not Team — decision `0023` gives Team to the middle command altitude) and the one-click hosted-agent story as designed preview pages over the Voltaic fixtures; `Push to cloud` is an `announced` inert row in the Agent tab context menu, with the Cloud entry point beside it and the Organization anchor in the Workspace switcher.
- **N4 Coordination preview** — LANDED 2026-08-02 (see the milestone log). Broad strokes only, per the operator: blackboard/bus/viewer, a derived assignment board, the gated ladder, and a handoff-record specimen. Speaks ENG-029's vocabulary — **assignment**, never claim — test-enforced.
- **N5 Agent Type previews** — LANDED 2026-08-02 (see the milestone log). The Agent Type chip as an `announced` affordance on Sessions cards plus the Agent Types preview surface, so the product visibly says _what kind of worker_ this is, not only which harness runs it.

## Boundaries

- This item owns grammar, manifest, entry points, and preview surfaces. It does not own any capability's implementation.
- No preview surface may write user data, mutate harness state, or initiate a network action.
- No fabricated numbers on a `live` surface, ever. Representative data appears only under a `preview` marker or inside a demo Workspace (ENG-027).
- Copy stays minimal — the operator explicitly does not want surfaces padded with explanatory prose. The page's design carries the explanation.

## Open questions

- Does the Consumption surface belong at the Team altitude as a panel (like the ENG-017 roadmap lens) rather than as a standalone page? Resolve during N2's gallery review.
- ~~Whether `announced` affordances should be discoverable in ⌘K at all, or only in place.~~ RESOLVED with N0 (2026-08-02) as the leaning said: not in ⌘K. The palette filters `announced` out of navigation, and a manifest test asserts no `announced` _surface_ exists — `announced` is a per-control fact rendered in place (`AnnouncedChip`, `Unbuilt`), and adding an announced surface must reopen this conversation.

## Roadmap milestone log

### N0 + N1 + the N2 remainder (landed 2026-08-02, one change)

**Manifest.** `AppSurface` gained `readiness: 'live' | 'preview' | 'announced'`; `shortcutId` became optional so preview surfaces do not consume scarce go-chord letters before they earn them (they take a chord when they flip `live`). Registered: `/consumption` `preview`; Organization (`/organization`), Cloud (`/cloud`), Coordination (`/coordination`), Agent Types (`/agent-types`) as `preview` in the `app` tier. `surfaces.test.ts` enforces the two structural rules — every spine surface is `live` (nothing in the spine links into an unbuilt state) and no `announced` surface exists (announced is a per-control fact; an entry point to a page that does not exist would be the lie the grammar forbids).

**Shared components** (`src/components/readiness/`): `ComingSoonMarker` (the token as a pill), `SurfaceReadinessMarker` (renders whatever the manifest says — the `live` flip removes the marker with no page change), `AnnouncedChip` (muted, `cursor: default`, tooltip `Coming soon — <what>`, inert contents), and `Unbuilt`/`UnbuiltLegend` migrated from `src/components/consumption/unbuilt.tsx`, whose tag now speaks **Coming soon** instead of `designed, not built`. One family: readiness neutral `#77839A` (identical to `FLUX.unknown` by design, outside every status/data channel) plus a dashed stroke at marker/chip/block scale. Prototyped as the first `/hud-gallery` section (`#readiness-grammar`) for operator review; DOM-only because readiness is chrome and the Fleet board carries no readiness marks in this arc.

**Surface map and entry points.** The four vision surfaces render a shared `PreviewSurfaceShell` — the real page frame at its real route: name, the one marker, intent, the designed shape of what the surface will show, the honest "today" sentence, and its owning items. N3–N5 replace the shell body with real preview content; the routes, manifest rows, and markers do not change. Entry points landed: ⌘K (preview rows execute a real navigation and carry a muted `Coming soon` note in the shortcut slot) and the Electron Go menu (`go-<surface id>`, resolved through the manifest in the renderer so the menu cannot diverge). The one-per-surface **contextual anchors were deferred to N3–N5** deliberately: each anchor lives inside a production surface another packet owns (workspace switcher, Agent tab menu, Team altitude, composer row), and an anchor should land with the affordance/content that justifies it rather than as a bare link — recorded here so the deferral is a decision, not a drift.

**N2 remainder.** `/consumption`'s header renders `SurfaceReadinessMarker`, driven by the manifest. The **intervention-rate metric** landed as its own "Asked by a user" section (`#intervention-rate`, between Cost per agent and Act 3), answering the third recurring user question. The metric is modeled in `interventionStats` (`src/components/consumption/model.ts`): an intervention is an operator message AFTER launch; cuts are per Session, per active hour, and per 100k raw tokens (surfaced as its more legible inverse, tokens of work per touch), plus the untouched-session share as the honest autonomy figure. `DemoSessionSpec` gained a required `interventions` field (like `delegation`, sites must state 0), machine-invoked overhead is excluded by construction, and the section's copy states the bound honestly: the count cannot tell desired steering from a gap, so it is an upper bound on gaps. Live wiring belongs to ENG-008 E5 (`UserPromptSubmit` via the ENG-023 channel for Claude Code; user turns in Codex rollouts).

Acceptance checks: shipping = one-line manifest flip + source swap (the consumption marker demonstrates it); cold-start navigation to every preview surface verified in the real browser via ⌘K; unit tests cover the manifest invariants, the component contract (inert, tooltip, token), and the intervention arithmetic.

### N3 + N4 + N5 (landed 2026-08-02, one change — with ENG-028 T1 and ENG-029 C1 supplying content)

**The bodies.** The four `PreviewSurfaceShell` shells gained their real preview content; the routes, manifest rows, and markers did not change (the shell evolved from a fixed rows list to a frame with children — same header/marker/footer contract). Every page is a view model over the Voltaic fixtures from `@exawatt/core` — the same fixture API the Demo Workspace source consumes — with derivations in per-route `model.ts` files, unit-tested (roster/partition/board/spend arithmetic, determinism, and honesty invariants). Authored representative content (Type identities, Voltaic humans, the handoff specimen) appears only under each surface's one marker.

- `/organization` (N3): Workspaces (the real tenancy pair plus the designed shared Organization tenant), members/roles with spend derived by attributing each Project's fixture usage to exactly one commanding human (member spend sums to fleet spend, test-enforced), an `announced` _Share Workspace_ chip (the ENG-034 nod the spec allows), and a managed-ceilings `Unbuilt` region.
- `/cloud` (N3): the one-action story over a real fixture Session — solid local card, dashed hosted card (dashes mean _designed, not built_), the announced _Push to cloud_ chip between them — plus hosted-beside-local, any-source, and plan-aware-capacity rows.
- `/coordination` (N4): blackboard/bus/viewer cards; a dispatch-engine board derived from fixture link truth (the half the ENG-017 lens already reads); the least-chatty ladder with assignments **gated** per the operator's correction; and an ENG-019 handoff-record specimen rendered as a repo file. The word "claim" appears nowhere — a test on the module's exported copy enforces it, and the manifest keyword flipped `claims` → `assignments`.
- `/agent-types` (N5, = ENG-028 T1): the one-worker-two-engines claim shown over the Engineer roster (engines observed from fixture truth), a Type spec sheet (identity / instructions / tools / defaults), and Voltaic's four-Type library with the non-coding desks labeled `preview desk`.

**The affordances and anchors** (the N1 deferral closes). _Push to cloud_ is an inert `announced` row in the Session tab context menu (`StripContextMenu` learned announced rows: no `menuitem` role, skipped by keyboard traversal, inert contents) with the Cloud entry point beside it as a navigable row carrying the muted Coming soon note — the ⌘K preview-row pattern. Organization's anchor is a switcher-section row in the account menu; Coordination's is on the Team-altitude (exposé) header; Agent Types' is a composer-source-row control. The Type chip rides Sessions cards as `AnnouncedChip size="micro"` beside the harness glyph — named by the source when a Type is declared (the Demo desks), the empty `Type` slot otherwise; shell sessions get none. The condensed 46px tab-strip chip was deliberately omitted (recorded in the ENG-028 doc).

Acceptance: all four recurring user questions now answer on screen — cost per agent and intervention rate on `/consumption` (N2), handoff on `/coordination`, multiplayer on `/organization` plus the real Workspace switcher. Verified headfully in the real Electron app (composer anchor, account-menu row, tab menu rows including announced inertness, exposé anchor — all navigating) and in the browser for the four pages; manifest invariant tests stay green.

### Closing-review fixes (2026-08-03)

The demo-arc closing review and demo walk caught readiness/honesty stragglers;
fixed in the ENG-027/ENG-026 closing-fixes change:

- **Readiness grammar stragglers in Settings.** The Settings rail's Context &
  Tools row rendered all-caps `COMING SOON` via a bespoke uppercase pill, and
  Agent Sources' "Coming soon" catalog section used a bespoke `Soon` pill.
  Both now use the shared `ComingSoonMarker`; the catalog section is retitled
  **Future sources** so the grammar phrase lives on the markers, not a
  heading. One vocabulary, one family.
- **Organization spend basis.** The members table claimed `Spend · 14 days`
  over figures that are raw tokens summed across each member's current
  base-tier Sessions — neither dollars nor a 14-day window. Header is now
  `Usage · raw tokens` and the footnote names the basis.
- **Intervention unit word.** The `/consumption` stat tile said "tokens of
  work per touch" — an undefined synonym beside a surface that defines
  "intervention". The unit now uses the defined word.
- **Push to cloud is visible from the Demo tenant.** The announced row lived
  only in the live tab-strip context menu; the demo Session pane header now
  carries the same inert `AnnouncedChip`.
- **⌘K nav ranking.** Navigation rows' filter values started with the verb
  (`go <name>`), losing prefix matches to any item whose value starts with
  the surface name; values are now name-first so typing a surface's name
  ranks its nav row at the top.
- **Team title and entry scroll.** The exposé header still said "Projects &
  Sessions" (a decision-0023 rename straggler) — now **Team**; and entry now
  centers the active tile instead of `nearest`, which left a below-the-fold
  tile hugging the grid edge on arrival.

### Production-voice sweep (2026-08-03, executed under ENG-036 Voice)

Operator correction on `/organization` ("what is this doing in main product
UI? … We need to always be designing for production audiences, not spewing
documentation text into the app. In general.") added a **Voice** section to
`design-system.md` (ENG-036 owns the rule) and reworded every ENG-026
surface in the same change:

- **`PreviewSurfaceShell` slimmed.** The `question` prop ("Asked by users: …")
  and the `intent` thesis lede are gone; the header is name + summary + the
  Coming soon marker (which now names the owning roadmap item), and the footer
  is one factual "today" line. The four user questions from the operator brief
  remain answered — as shown product state (members table, push-to-cloud
  before/after, assignments board, intervention-rate tiles), never as quoted
  questions.
- **The four preview bodies** rewrote thesis titles and explanatory captions
  into product nouns and short legends (`/organization` reads as a
  members/roles/usage settings page; `/coordination` as a board with
  Assignments / Coordination levels / Handoff record).
- **`/consumption`** kept all four acts, the unit ladder, and the
  intervention section structurally intact; the question-headers became noun
  headings (Capacity, Attribution, Cost per agent, Intervention rate,
  Outcomes, Assurance, Allocation), the "Asked by a user" framing was
  retired, and the expository paragraph pairs shrank to captions.
- **Readiness grammar untouched** except copy: the `UnbuiltLegend` sentence
  shortened; markers, chips, dashed blocks, and all "not recorded" /
  "unreported" states are unchanged. Evidence: before/after screenshots in
  the landing change's report (`/tmp/exa-pw/voice-shots/`).
