# Demo arc — execution packets

**This document holds no scope of its own.** Every packet points at a roadmap item that owns its scope, exit criteria, and boundaries. This is a sequencing and ownership surface for running 4–6 agents in parallel without collisions — not a competing plan. If a packet disagrees with its owning item, the item wins.

Created 2026-08-02 from the grooming session. Sized to the operator's stated parallelism: 4–6 agents now, 10+ aspirationally.

## What the demo must survive

The operator named three risks (2026-08-02). Reliability was explicitly **not** among them — the daily driver is solid, so do not spend this arc's slack on hardening.

| Risk                           | Answering work                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------- |
| "It looks unpolished up close" | P1 design kernel, then P8 polish on the surfaces actually shown                  |
| "The story doesn't land"       | P6 readiness grammar and surface map; the four user questions answered on screen |
| "Nothing to show at scale"     | P4 demo fleet content, P5 demo-scale rendering                                   |

## Collision map

Two files are contention points. Respect these or agents will conflict:

- **`src/components/nav/surfaces.ts`** — touched by the rename (P2) and the readiness manifest (P6). P2 owns it first; P6 waits.
- **The spatial surface** — P5 and P7 landed. The ENG-004 V3.3 spatial-feel stream owns it now: S1 → S2 → S3 → S4 in order (S1 and S3 may overlap with care; S2 restructures the canvas layer tree and runs alone, absorbing P7's landed entry-pose execution).

Everything else in wave 1 is file-disjoint by construction.

## Wave 1 — start in parallel, no shared files

### P1 · Design kernel

- **Owns:** ENG-036 G0
- **Scope:** extract the type scale, spacing steps, color roles, and status iconography the app already uses correctly into one citable reference. Include the amend-when-you-deliberately-improve rule. Audit `/hud-gallery` and record what merges vs retires (G1 executes the merge; G0 only decides).
- **Files:** new doc under `docs/engineering/`; read-only everywhere else.
- **Do not touch:** any component. G0 writes down what is true; it does not refactor toward it.
- **Acceptance:** an agent can pick a font size, muted color, and card padding for a new page by citing one document. The 17 measured pixel sizes are reduced to a named scale with an explicit note about which existing usages are off-scale.
- **Blocks:** P6, P8.

### P2 · Rename sweep and legacy retirement

- **Owns:** decision `0023`
- **Scope:** Terminal→**Agent**, Sessions→**Team**, Spatial→**Fleet**, in one holistic sweep. Retire `/fleet`, `/dashboard`, `/board` and their demo machinery. Reconcile `docs/product/demo-mode.md`, which still documents the trio as the current primary demo implementation.
- **Files:** `src/components/nav/surfaces.ts` (owner), `command-altitude.ts`, shortcut and menu labels, window titles, `⌘K` and cheat-sheet copy, `AGENTS.md`, product and engineering docs.
- **Do not touch:** route paths (`/workspace`, `/fleet/spatial` keep their URLs), the readiness field (P6 adds it).
- **Acceptance:** no user-visible string says Terminal, Sessions, or Spatial as an altitude name; `grep -ri "fleet command"` returns nothing user-facing; the app builds and the three altitude shortcuts still work.
- **Blocks:** P6.

### P3 · Workspace scope

- **Owns:** ENG-027 W1
- **Scope:** Workspace identity, the account-menu switcher, Workspace-scoped view state. Personal only; Demo appears as `Coming soon` until P4/W2.
- **Files:** new tenancy module, account menu, workspace shell state.
- **Do not touch:** PTY lifecycle, session persistence.
- **Acceptance:** switching Workspaces leaves every live local Session running and exactly where it was — this is the item's most important property and must be demonstrated, not assumed.

### P4 · Demo fleet content

- **Owns:** ENG-027 W3 and W4 (data)
- **Scope:** author the demo Workspace as versioned, resettable data — one plausible multi-function startup, majority coding, 6–12 Projects with roadmaps that parse under the published convention, Agents spread across the five-signal status protocol including delegation, readable Sessions, plausible consumption history. W4 adds the entity count the Fleet moment needs, with honest structure rather than cloned filler.
- **Files:** new data/fixture files only.
- **Do not touch:** rendering. P5 owns pixels; this packet owns data.
- **Acceptance:** the demo roadmaps parse with zero warnings; non-coding Agents render as `preview` content and never imply shipped capability.

### P5 · Demo-scale rendering

- **Owns:** ENG-004 V3.1
- **Scope:** instancing, culling, label budgets, and measured frame cost against P4's fleet. Unparks V2.1's rendering half only.
- **Files:** spatial surface (owner during wave 1).
- **Do not touch:** V2.1's truth half — no Initiative-level aggregation, no aggregate Project drill. Read `docs/engineering/r3f-authoring-guide.md` before any change under `<Canvas>`.
- **Acceptance:** the demo fleet renders at frame budget with numbers recorded; `pnpm eval:r3f` passes.

## Wave 2 — after their dependencies land

### P6.5 · Demo Workspace live (W2) — first wave-2 packet

- **Status:** LANDED 2026-08-02 (ENG-027 W2 milestone log holds the narrative). P7 and P9's demo posture are unblocked.
- **Owns:** ENG-027 W2
- **Depends on:** P3 (tenancy scope landed), P4 (Voltaic fixtures landed)
- **Scope:** wire the Voltaic fixtures from `@exawatt/core` behind the existing fleet transport boundary — the same UI-model contracts the live path uses — plus the pane content sources, and flip Demo's availability from `coming-soon` to available in the tenancy module. Must also close the two W2-armed tenancy findings from the W1 review (being fixed in parallel under the ENG-027 W1 review fixes — coordinate, don't duplicate).
- **Disposition:** when this lands, `MockFleetTransport` / `DemoControls` demote from the product surface to eval-only, so the simulated and honest demo sources never coexist in a demo (`docs/product/demo-mode.md` records the mock path as interim).
- **Acceptance:** switching to Demo shows the populated Voltaic board through the production surfaces; demo tabs render transcripts and cannot spawn a PTY; live local Sessions are untouched by the round trip.
- **Blocks:** P7 (the altitude handoff is built and tuned against the populated Voltaic board, not a dozen-agent personal board) and the demo posture of P9.

### P6 · Readiness grammar and surface map

- **Owns:** ENG-026 N0 and N1
- **Depends on:** P1 (vocabulary), P2 (owns `surfaces.ts` first)
- **Scope:** the `live` / `preview` / `announced` readiness field in the navigation manifest, the shared marker and affordance components prototyped in `/hud-gallery` for operator review, and the vision surfaces registered with their entry points. Fold ENG-008 E4's local `Unbuilt` treatment into the shared grammar — it is the ancestor, and two vocabularies must not survive. Register `/consumption` with a readiness state and ship the **intervention-rate metric** — both are the open N2 remainder, and this packet owns them explicitly: without the intervention-rate metric, P9's acceptance ("all four user questions answerable on screen") is unmeetable.
- **Acceptance:** shipping a capability is a one-line manifest change plus a source swap; nothing in the spine links into a broken state; the intervention-rate metric renders on Consumption.

### P7 · Altitude handoff — LANDED 2026-08-03

- **Owns:** ENG-004 V3.0, decision `0023`
- **Landed** (Voltaic-tuned against the live Demo Workspace): the entry pose, card→zone ghost crossfade, camera pull-back, and the full fallback matrix (reduced motion, low power, missed 900ms budget, stale/missing captures, renderer failure) — all as an extension of the one D11 transition owner, with four dedicated `eval:spatial` scenarios. Evidence in the ENG-004 project doc §V3.0.
- **Sequence note:** this packet was re-anchored onto S2 the same evening it landed (written before the landing was known). The invariant holds — one transition machinery, no parallel implementation — so **S2 inherits an absorption obligation** instead: carry the rig-side entry-pose execution across its layer-tree restructure and keep the handoff eval scenarios green.

### P8 · Polish pass

- **Owns:** ENG-036 G3 (partial)
- **Depends on:** P1
- **Scope:** apply the kernel to exactly the surfaces the demo will show. Not an app-wide refactor.
- **Acceptance:** screenshot evidence for every surface touched, per the standing visual-verification rule.

### P9 · Preview surfaces

- **Owns:** ENG-026 N3, N4, N5 — with ENG-028 T1 and ENG-029 C1 supplying content
- **Depends on:** P6
- **Scope:** Organization and Cloud previews, the `announced` _Push to cloud_ affordance, the Coordination preview (broad strokes), and the Agent Type chip and surface.
- **Acceptance:** each of the four recurring user questions can be answered on screen without leaving the app.

## The spatial-feel stream (ENG-004 V3.3) — added 2026-08-02

Owner of scope: ENG-004 V3.3; the pick-up-cold slice contracts (scope, files,
acceptance, boundaries) live in
`docs/engineering/projects/spatial-operations-board.md` §"V3.3 execution
contract". This section only sequences them for parallel agents. Feel first was the
operator's explicit ordering; P7's handoff landed first in fact
(2026-08-03 reconciliation, recorded in the roadmap V3.0 line), so S2
absorbs it rather than the handoff waiting on S2.

### S1 · Board input — keyboard unit navigation + RTS pointer grammar

- **Owns:** ENG-004 V3.3 F2+F3, decision `0024`
- **Files:** `operations-board-canvas.tsx` (pointer/selection rectangle),
  `operations-board-surface.tsx` (keys, hints), `packages/ui-model`
  (nearest-neighbor + band-hit selectors, multi-selection state),
  `spatial-navigation-state.ts`
- **May start:** immediately. May overlap S3 with care; never S2.

### S2 · Board continuity — layers survive altitude changes

- **Owns:** ENG-004 V3.3 F1 (absorbs the LANDED V3.0/P7 rig-side entry-pose execution; the nav-side handoff contract is stable — do not fork it)
- **Files:** `operations-board-canvas.tsx` (layer keying/morph),
  `spatial-fleet-client.tsx`, transition ownership per ENG-016 D11
- **May start:** after S1 lands (it rewrites the layer tree S1 touches).
  Runs ALONE on the spatial surface. P7 landed before it — absorb, don't
  rebuild.

### S3 · The tiled board — circular Projects + hex Agent identity

- **Owns:** ENG-004 V3.3 F4+F5+F7. The `/hud-gallery` composition prototype
  was accepted with circular Project boundaries on 2026-08-03 and retired
  when the production board shipped, per ENG-036 workbench policy.
- **Files:** `packages/ui-model/src/spatial-board.ts` (circular-footprint + hex-slot policy),
  `operations-board-canvas.tsx` (tile rendering), transport `goal` labels
- **State:** landed. Production is the source of truth; do not recreate the
  retired gallery study as a parallel specimen.

### S4 · Board chrome — the selection command panel

- **Owns:** ENG-004 V3.3 F6 (multi-select preview under ENG-026 grammar)
- **Files:** `operations-board-surface.tsx`, `spatial-fleet-client.tsx`
  (inspector/activity retirement), minimap/tool cluster
- **May start:** after S1 (it presents the selection state S1 creates).

## Standing rules for every packet

- Work in a dedicated `agent/<slug>` worktree bootstrapped with `pnpm worktree:setup`; land with `pnpm agent:land -- --verify <checks>` per `AGENTS.md`.
- Name the owning roadmap item in the first commit. This is how the operator sees who is on what, and it is why an assignment mechanism is not being built (ENG-029's recorded correction).
- UI work is not done without visual evidence. Compiling is not looking right.
- If a packet's scope disagrees with its roadmap item, stop and reconcile the item — do not silently diverge.

## Wave 3 — the Google workshop demo arc (added 2026-10-02, demo 2026-10-07)

Sequencing for the roadmap's "Execution front (2026-10-02)". Same contract as
the waves above: no scope of its own, every packet points at the item that
owns it, and the item wins any disagreement. Recorded 2026-10-02 at the
operator's request; **execution waits for the operator's go.**

### What this demo must survive

| Risk                                              | Answering work                                      |
| ------------------------------------------------- | --------------------------------------------------- |
| "The live board can't be trusted on screen"       | G1 fleet truth and motion                           |
| "Zoom-out shows thirty agents, not a fleet"       | G2 Demo workspace alive                             |
| "No Google in a demo for Google"                  | G3 Antigravity source, G4 Google card, G6 cloud row |
| "Can't answer how twenty agents don't collide"    | G5 landings inside the roadmap lens                 |
| "The future state is not on screen"               | G6 affordances                                      |
| "Demo day itself"                                 | G7 readiness                                        |

Operator direction (2026-10-02): real fleet first, then Demo for scale;
Antigravity real from ⌘T plus an affordance for a hosted Gemini row; landings
minimal and inside the roadmap lens ("should basically feel like the same
feature / view"); Push to cloud and Safety policy as simple, holistically
integrated affordances, both still provisional until the Friday checkpoint.

### Collision map

- **Fleet canvas** (`src/components/fleet/spatial/operations-board/*`): G1
  owns it. G2 touches only Demo data and transport
  (`packages/core/src/demo/*`, `packages/core/src/transports/demo-workspace.ts`)
  and never the canvas.
- **Turn truth and attention** (`electron/main/harness-events/*`,
  `turn-truth.ts`, `codex-app-server.ts`, the tab strip's attention state):
  G1 owns it.
- **Source declaration and launch** (`contracts/agent-sources.json`, the S5.1
  single declaration, `electron/main/pty/harness-registry.ts`, the launcher):
  G3 owns it. G4 reads the usage command only and adds its account reader
  under `packages/core/src/consumption/*` and `src/components/consumption/*`.
- **Roadmap lens** (`src/components/roadmap/*`) plus a new main-process reader
  of `<git-common-dir>/exawatt-delivery/`: G5 owns both.
- **Tab menu, `/cloud`, Settings ▸ Safety** (`tab-strip.tsx`,
  `demo-session-pane.tsx`, `src/app/cloud/*`, `src/app/settings/*`): G6 owns.
- **`docs/product/demo-script.md`** (private): G7 owns.

### G1 · Live fleet truth and motion

- **Owns:** ENG-004 (BUG-262, BUG-263, V3.9 look), ENG-016 (BUG-257,
  BUG-258, BUG-264), ENG-015 (BUG-265, BUG-163).
- **Scope:** two sub-packets that can run in parallel. **G1a board:** the
  frozen and blurry render (frameloop invalidation while working marks exist,
  the `dpr`/resize path after a display change), the Fleet to Agent
  transition (measure first, then fix the mount and teardown overlap), ⌘J from
  Fleet, and the close pack plus focus field look (operator-confirmed and
  landed 2026-10-04).
  **G1b truth:** the Codex finished glyph during compaction and sub-agent
  fan-out, the Claude spinner after `Stop`, the Codex queued question raised as
  needs-you without ending the turn, and one transition that produces both the
  amber marker and the bell.
- **Do not touch:** Demo data, the launcher, the roadmap lens.
- **Acceptance:** on the dogfood build with 25 or more live Agents, working
  marks animate for ten unattended minutes and stay sharp after unplugging a
  display; every tab state matches its pane for one working day of dogfood;
  a queued Codex question turns a tab amber and rings; ⌘J from Fleet visits
  the oldest needs-you. Screenshots and the spatial evals before landing.
- **May start:** now. Blocks nothing; G7's rehearsal needs it landed.

### G2 · Demo workspace alive

- **Owns:** ENG-027 W14.
- **Scope:** a seeded, deterministic tick behind the Demo transport: statuses
  move on plausible cadences, delegated children spawn and finish, landings
  arrive (so G5's landing state has Demo rows to show), consumption advances.
  Add Antigravity rows to the synthetic fleet once G3's declaration lands, so
  the three-vendor board appears in Demo. Record the Google mark's brand
  provenance in `LICENSES/brand/harness-marks.md` before drawing it; if the
  guidelines forbid the use, draw the neutral mark.
- **Do not touch:** the canvas, launch (Demo still launches nothing), the
  website hero capture (it stays a frozen capture by design).
- **Acceptance:** switching Workspace to Demo shows movement within two
  seconds; reduced motion stops the ambient motion and keeps state changes;
  the 1k and 10k eval tiers are unaffected; a reload lands on the same seed.
- **May start:** design now, build after G3's declaration lands (one file).

### G3 · Antigravity CLI source

- **Owns:** ENG-003 S5.3.
- **Scope:** step 0, the signed-in `agy` 1.2.x run on the operator's account
  that S5.3 has waited on since 2026-09-24: let the installed 1.0.4
  self-update, never run `agy install` or `--gemini_dir`, verify whether an
  `--add-dir` folder's `.agents/hooks.json` loads per launch. Then the adapter
  in the S5 shape: one declaration, a real terminal launched with `agy -i`,
  resume with `--conversation=<id>`, identity learned from the first hook,
  turn truth from `PreInvocation` and `Stop` when the seam verifies, status
  inferred like OpenCode when it does not, model catalog from `agy models`,
  kill-guard coverage, and a tile line in production voice that Antigravity
  cannot yet tell Exawatt when it needs you. Never surface
  `~/.gemini/antigravity-cli/history.jsonl`.
- **Do not touch:** the Usage page (G4 reads the usage command), the canvas.
- **Acceptance:** ⌘T lists Antigravity with its models; a launched Agent
  appears on Agent, Team and Fleet with working and done truth; it resumes
  after relaunch; the probe hygiene rule holds (no writes outside the real
  home the operator already uses).
- **May start:** now; step 0 first and alone.

### G4 · Usage: live burn and the Google account

- **Owns:** ENG-008 E16, ENG-038 slice 3.
- **Scope:** a live burn line above the account cards (tokens per minute and
  dollars per hour now, per vendor, from the sample log; modelled dollars
  labelled as modelled) and a Google account card read from
  `agy -p "/usage" --output-format json` through the account service, with
  the E12/E15 honesty rules: absent is never zero, and losing information never
  moves the headline the reassuring way.
- **Operator prerequisite: retired 2026-10-04.** ENG-038 slice 3 reads Claude
  through its own `/usage` in every build, so `distribution:custody:upgrade`
  and a release are no longer needed for the Claude windows. (This item's
  Google read was "ENG-038 slice 3" when written; it is slice 4.)
- **Do not touch:** the launcher, the harness registry.
- **Acceptance:** the Usage page on the dogfood build shows Claude, Codex and
  Google cards with reset times, and a burn line that moves while agents work;
  a failed Google read shows the account as unreadable, not as zero.
- **May start:** the Google read probe now; the card after G3 step 0 confirms
  the installed `agy` version.
- **Landed 2026-10-05** (ENG-008 E16, ENG-038 slice 4): the burn line reads
  the trailing ten minutes per ledgered vendor with modelled dollars labelled;
  the Google card reads `agy` 1.2.17's structured `/usage` report (weekly
  limits per model group, no plan tier) through the shared account service,
  keyed `antigravity` as G3 declares it, with no change to G3's files. The
  Demo workspace shows three vendors. Narrative in `consumption-spine.md` §E16.

### G5 · Landings inside the roadmap lens

- **Owns:** ENG-017 S16 (data from ENG-022's queue state; no change to
  `agent:land`).
- **Scope:** a main-process reader of `<git-common-dir>/exawatt-delivery/`
  (queue directory plus the metrics tail) exposed through the existing
  roadmap and project IPC, and the lens showing a landing state on each item
  with a ticket in flight (queued with position, checking, integrating, landed
  with sha) plus one header line (N in queue, head). Minimal, and visually the
  same feature as the lens; no new page, no palette-only surface.
- **Friday checkpoint (2026-10-03):** screenshots of the lens with the state
  on real rows go to the operator before build continues.
- **Do not touch:** the delivery scripts, the canvas.
- **Acceptance:** while an agent lands, the Team view moves the ticket queued
  to checking to landed and flips the item with the real sha; a missing or
  unreadable delivery directory reads "not shown", never "nothing queued".
- **May start:** the reader now; the lens after the checkpoint.

### G6 · Future-state affordances

- **Owns:** ENG-033 (Push to cloud, `/cloud`), ENG-044 (Safety policy
  preview). Provisional: the operator is not yet sure and decides at the
  Friday checkpoint.
- **Scope:** Push to cloud on the tab menu and the demo pane chip leads to
  `/cloud`, which names a Gemini managed environment (Gemini API managed
  agents, public preview) beside Exawatt-hosted with each one's honest state;
  Settings ▸ Safety shows the shaped next controls (destructive git,
  credential reads, network egress, allowed harnesses and models) as a
  default-off policy preview beside the live control, clearly not enforced,
  in production voice. Simple; one screenshot each for the checkpoint.
- **Do not touch:** enforcement, the kill guard, the launcher.
- **Acceptance:** neither affordance claims a capability the build lacks; the
  live control still works; both read like product, not documentation.
- **May start:** mockups now; build after the checkpoint.

### G7 · Demo readiness

- **Owns:** ENG-027 (the private `docs/product/demo-script.md`).
- **Scope:** rewrite the script for this arc (real fleet, Fleet zoom,
  needs-you, Antigravity launch, a landing in the lens, Usage, the Workspace
  switch to Demo at scale, the two affordances, the leaderboard numbers); two
  backup recordings (a Fleet zoom and a landing, 30 to 90 seconds each);
  dogfood freeze Tuesday 2026-10-06 12:00 PT with only demo blockers landing
  after; rehearsal Tuesday afternoon on the frozen build.
- **May start:** Monday 2026-10-05, after the packets above land.

### Day sequence

- **Thu 10-02:** G1a, G1b, G3 step 0, G2 tick design, G5 reader, G4 read probe.
- **Fri 10-03:** checkpoint screenshots (G5 lens, G6 affordances, G1 board
  look) to the operator; G3 adapter; G2 and G4 build.
- **Sat and Sun:** G2, G4, G5, G6 build; G1 remainder; integration landings.
- **Mon 10-05:** everything on `master` by evening; dogfood installs; G7
  script; the operator's custody release.
- **Tue 10-06:** freeze at noon; rehearsal; recordings; demo blockers only.
- **Wed 10-07:** 09:00 demo.

### Operator-owned items

- Say go.
- Friday checkpoint: the lens landing state, the two affordances, the board
  look.
- ~~`pnpm distribution:custody:upgrade` and a release before Tuesday (the Claude
  windows on Usage depend on it).~~ Retired 2026-10-04: ENG-038 slice 3 needs
  neither.
- Be present for G3 step 0 if the signed-in `agy` run needs the Google account
  in a browser.
