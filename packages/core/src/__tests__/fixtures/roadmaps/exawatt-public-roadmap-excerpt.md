---
exawatt-roadmap: v2
---

# Exawatt Roadmap

This is the canonical roadmap. Keep it current and cohesive. Do not create competing plans.

This file follows the published [Exawatt roadmap convention](../product/reference/roadmap-convention.md) (`exawatt-roadmap: v2`). Any repo can adopt that convention to get the same Exawatt roadmap lens; its migration section is written for the agent doing the adaptation.

Roadmap rule: architect 10 miles ahead, build one mile at a time.

## Operating Model

`roadmap.md` is the singular engineering roadmap. It should stay readable as the fleet grows by acting as the top-level sequence, status index, and conflict-resolution surface.

Use this file for:

- ordered roadmap items
- current status
- concise scope and exit criteria
- a compact milestone list (id, title, status, date landed, one line)
- links to deeper engineering project docs, architecture docs, and decision records
- explicit notes when priorities, sequencing, or ownership boundaries change

Use linked project docs when a roadmap item needs durable detail beyond this file, such as milestone narratives, acceptance tests, design constraints, implementation notes, or future agent work packets. Linked project docs must not become independent roadmaps; they are execution detail owned by a roadmap item.

Milestone narratives belong in the project doc, not here. Each project doc carries a dated **Roadmap milestone log** section holding the full historical narrative that this file used to inline; the roadmap keeps only the one-line milestone contract and the link. When a milestone lands, write the narrative in the project doc and add or update one line here.

When updating linked project docs, also update the corresponding roadmap item status, milestone pointer, or exit criteria if the canonical plan changed. If a linked project doc stops matching this roadmap, reconcile it immediately by updating, archiving, or marking the stale material.

Roadmap item IDs are stable handles. Preserve IDs when reordering items. Add a new ID for genuinely new roadmap items; do not recycle IDs from retired or archived work.

Later milestones frequently amend or supersede earlier ones. Before acting on any milestone decision, check the [Amendment chain](#amendment-chain) at the end of this file — it lists every supersession that is still load-bearing.

Allowed statuses:

- `planned`: accepted direction, not next for implementation
## Now

### ENG-001 Repo and docs consolidation

Status: done

Scope:

- retire active Godot/Helios direction
- preserve useful retired thinking in `docs/archive/`
- establish canonical product and engineering docs
- define the documentation contract in `AGENTS.md`
- align `/architecture` with current architecture vocabulary

Exit criteria:

- no active docs point to Godot as current architecture
- README links only to canonical docs
- `/architecture` uses canonical Exawatt concepts

### ENG-002 Agent Terminal Workspace (dogfood parity)

Status: active-build — RESHAPED 2026-07-02 from "Electron local OpenClaw pseudo-parity" to the canonical operator workflow (`docs/product/operator-workflow.md`). W0.1–W0.4 landed and parity is real; excellence moved to ENG-015 and adoption blockers to ENG-016. Closes on accumulated use, not a fixed dogfood week.

Scope:

- agent-first terminal hosting in Electron (node-pty in main, xterm.js in the renderer): the product gesture is "launch an agent" — pick a harness, pick or create a git worktree — not generic terminal multiplexing (decision `0005`)
- the terminal regime is a first-class, long-lived UI regime in its own right (operator, 2026-07-03: an AI-native tmux++), developed in parallel with the spatial regime as independent skins over one session/fleet system
- launch always requires a project directory (no silent home-dir default); the last-used directory is remembered and prefilled
- the working directory is the grouping key mapping Sessions to a Project / Context Group: same-project tabs share a color and cluster adjacently
- Initiative-labeled windows containing session tabs — a thin slice of ENG-005 (labels and grouping only, not the full Initiative primitive)
- restart persistence of layout, names, worktrees, and working dirs; running processes do not survive restarts and ENG-018 owns deterministic rehydration, not a detached backend (decision `0012`)
- per-session status normalized into the same FleetState the DOM board and Spatial consume, so real sessions are the live data source
- fast keyboard driving end to end, plus an incremental context layer: naming → auto-summarized micro-context subtitles → context augmentation
- hybrid rendering rule stands: terminal text and controls remain DOM (decision `0003`). AMENDED 2026-07-06 (operator): the spatial surface is no longer this workspace's overview/switcher — the regimes deliberately diverge (ENG-015, ENG-004), and terminal game-feel investment happens under ENG-015
- Live Mode and Demo Mode using the same UI architecture

Exit criteria:

- accumulated operator use establishes Exawatt as the normal surface for real daily coding-agent work (1–6 agents across 2+ Projects); ENG-016 records fallbacks while implementation continues
- launching a new Claude Code or Codex agent in a fresh worktree is one gesture
- live sessions appear in `/fleet` and `/fleet/spatial` with truthful status
- Demo Mode demonstrates the same flows without live agents

Milestones:

- W0.1 PTY foundation (landed): node-pty + xterm.js in the Electron shell; real shell and interactive Claude Code sessions in a chosen cwd with full TUI fidelity.
- W0.2 Workspace parity (landed): directory-required launch, directory-keyed project clustering with per-project colors, restart persistence with auto-revive, fast keyboard switching.
- W0.3 Fleet truth (landed): live PTY sessions normalize into FleetState via LocalSessionsTransport; board and map show real sessions with truthful status; desktop = local truth, web keeps Demo/OC.
- W0.4 Context layer (landed): persisted double-click rename propagated to the PTY, plus main-process auto-summarized micro-context subtitles; the summarizer module is the context-augmentation seam.
- W0.5 Spatial cockpit (rescoped 2026-07-06, operator): retired as an ENG-002 milestone — the regimes diverge instead of converging; driving Sessions from the map returns as ENG-004 work.

Project doc:

- `docs/engineering/projects/agent-terminal-workspace.md`

### ENG-015 Stellar small-fleet command (1–10 agents)

Status: active-build — created 2026-07-06 (operator): before any long-arc work, the UI for operating one to ten agents must be stellar. The investment target is the TERMINAL regime as the approachable daily driver.

Divergence direction (operator, 2026-07-06; navigation amended 2026-07-10): the two UI regimes keep distinct jobs and visual identities — the terminal workspace stays an AI-native tmux++ sized for 1–10 agents while AgentField evolves toward an RTS-style command map at fleet scale. They form one command-altitude continuum for NAVIGATION only (Agent near, Team middle, Fleet far — names per decision `0023`); the terminal remains DOM/xterm and the field remains R3F.

Scope:

- attention: harness-aware "this agent needs you" detection (bell/notify sequences + turn-boundary quiescence), badges, an attention queue with a jump key, macOS dock signals — mirrored into FleetState so every surface agrees
- command-altitude navigation: a persistent Agent → Team → Fleet control in the Electron shell, each altitude one click or one absolute shortcut away (`⌃⌘1`/`⌃⌘2`/`⌃⌘3` since ENG-016 D19)
- command velocity: keyboard-first everything — global fuzzy session switcher, split panes, complete no-mouse coverage of daily actions, shortcut discoverability
- exposé & motion: a zoomable live-tile overview of all sessions, animated switching, depth/motion in the chrome (reduced-motion respected)
- context paging: research-backed support for swapping human working memory between dramatically different contexts — visual identity anchors, re-entry recaps, "while you were away" digests, stable spatial addresses, boundary-batched interruptions
- generic for any user (no operator-bespoke tuning); personal taste routes to future settings

Exit criteria:

- running 5–10 parallel agents daily, no stalled or asking agent goes unnoticed for more than a few seconds
- every daily action is keyboard-reachable; reaching any session takes ≲2 keystrokes via the switcher
- the overview → focus → overview loop feels game-quality (motion, depth, zero jank)
- after switching initiatives, "where was I here?" answers itself in ~2 seconds without reading scrollback
- the operator judges the daily-driver experience stellar (subjective bar is the real bar)

Milestones:

- S1 Attention system (landed 2026-07-06): needs-you detection in the PTY layer, pulsing tab badges, oldest-first ⌘J queue, dock badge/bounce, attention mapped into FleetState as `blocked` + blockerInfo.
- S1.1 Reported turn truth (landed 2026-07-27): a source that declares its own turn boundary outranks byte quiescence in both directions, so the strip stops trailing the Agent. Measured against a real Claude Session, inference lagged the reported `Stop` by 6-7s on every turn — long enough to read "working" for an Agent that had provably finished. Inference stays as a backstop for sources that report nothing and for turns that end without a report. Rides ENG-023's harness event channel; adds no new light and no new IPC.
- S2 Command velocity (landed 2026-07-09): ⌘K fuzzy session switcher, palette launch commands, ⌘D split panes, ⌘E inline rename, ⌘/ cheat sheet, no-mouse coverage of every daily verb.
- S3 Exposé, motion & discoverability (landed 2026-07-10): ⌘O exposé overview with rich live tiles, persistent key-hint bar, workspace verbs in ⌘K, forced dark theme, terminal typography settings. Pane-content switch animation deliberately skipped — motion lives in the chrome. Its raw-scrollback card body is superseded by ENG-021 E1.1.
- S3.1 Command-altitude continuum (landed 2026-07-10; absolute-key refinement 2026-07-12): the title bar persistently exposes Terminal → Sessions → Spatial; `/workspace?view=sessions` deep-links the middle altitude without restarting PTYs.
- S4 Context paging (active-build): recap delivery is ambient under ENG-016 D18; S4.1 goal visual anchors landed 2026-08-03 for direct live dogfood — deterministic natural-environment backdrops in Team tiles, cached by accepted goal and regenerated only for an ENG-021 semantic pivot or operator correction, with deterministic fallback and a server-only `fal-ai/fast-sdxl` prototype boundary. Live rejection of v1's washed-out pseudo-interface imagery promoted v2: cache invalidation, private goal-to-scene derivation (FAL never receives goal text), and theme-aware localized scrims. One app-global, device-local **Agent tile backgrounds** control defaults on across Electron and hosted web; off suppresses rendering everywhere and future Electron requests. The operator selected full-card geometry, rejected scenes as a category, and chose Graphic Form as the leading language on 2026-08-04; `/hud-gallery/goal-visuals` now holds Graphic Form against six metaphor-led alternatives across three fixed goals. The same global preference is exposed as **Backgrounds** in Team's top chrome for rapid comparison; the live Team prompt remains unchanged pending a final pick. Ship the chosen language, then retire the study. Independent demand evidence 2026-08-13 (a partner conversation): a designer running Claude Code, Codex, and Cursor side by side described this exact failure unprompted — "there's a lot going on just within Cloud, and then across Codex or Cursor, and I forget about what I was working on easily" — and the operator graded the shipped ambient recap himself against the bar in the same demo: the "Since you left…" line "is okay, but I'm trying to build a little bit more, like, kind of, hey, remember what we were working on, and here's how you can jump back in." The job is framed as lowering a hurdle, so re-entry owes the operator a way back IN, not only a report of what changed. No scope shaped from this; it sharpens the existing exit criterion that "where was I here?" answers itself in ~2 seconds. Second dogfood data point 2026-08-21 (a partner conversation): asked whether he navigates agents by the goal-visual images or the titles, the operator answered "it's the text. It's the text. Every single time," and named the program's falsification condition himself — "the images just haven't been good enough in the product yet to do that. Or my hypothesis about this psychology UI is wrong." She independently reported the same cross-harness forgetting a second time in eight days.
- S5 Durable Projects (landed 2026-07-10; interaction model amended 2026-07-12 by ENG-016 D14 and decision `0013`): rename, Supabase registry + reclaim migration, resolution bridge, missing-dir locate, synced identity/color; the registry is shared truth and local workspace state is the offline fallback.

- S6.1 Team grid keyboard ownership (landed 2026-08-07; FIX-002 + FIX-006, the two halves that needed no design pass): arrows move by measured tile geometry instead of ±1 through a flat list, and the grid yields every key to a focused control that owns text or its own activation. Rows come from vertical overlap rather than a column count, so ragged rows, full-width empty-Project rows, taller cards, and Project boundaries need no special case; a row edge falls through to reading order so nothing is a dead end. Both halves are pinned by tests that fail without them, and the jsdom/no-layout path keeps reading order so the behaviour stays defined where there is nothing to measure. FIX-006's original field no longer exists (D49 deleted it), so its row is recorded as PREVENTED, not fixed — the rule is what shipped.
- S6.1.1 Team grid selection ownership (landed 2026-08-16; FIX-002 closed a second time): the reopened report blamed the row-edge fallback and the geometry was right — 160,000 randomised layouts through the pure model and a seven-viewport sweep of the live rig both came back clean. Every arrow key ends in `scrollIntoView`; crossing a Project boundary scrolls because the next Project's row is below the fold; Chromium re-dispatches a mouse event at the cursor's last known position whenever content moves under a stationary pointer — so the tile that slid under the resting cursor took back the selection the key had just set, one column to the left. S6.1's 400ms arm window guarded the mount only, and this fires on every scroll. The pointer now claims the selection only when it has MOVED (`teamPointerMoved`, exact rather than timed, subsuming the mount case it replaces). The structural half: the movement policy that was wrong lived in the overlay, where only a live grid can reach it, so `teamGridNeighbor` took over the whole contract — measures are `TeamGridRect | null`, an unmeasured tile is SKIPPED rather than becoming a phantom rect at the viewport origin competing for "nearest row", an unmeasured origin falls back to reading order instead of inventing a position, and the no-layout reading-order path moved out of the component. `nextSelection` measures and delegates. 18 hand-written-rect cases pin the model; `eval:workspace:team` gained a fifth gate that rests the pointer on a tile and drives ArrowDown across the boundary, reading the expected target off the rendered rects — red on the pre-fix tree, green after. Boyscout, found because the glide gate would not stay green while landing: S6.3's FLIP ref-callback cache EVICTED ITSELF on detach, so one detach (Strict Mode double-invokes refs on every dev mount) started an endless new-closure/detach/evict cycle, `rects` was empty at every layout effect, and the re-sort snapped in silence. The cache now survives detach (rect and timer cleanup stay), pinned by `use-flip-tiles.test.tsx`. The glide gate had a blind spot wide enough for that to pass through — one computed-style sample 80ms after the click — and now records the slot's own `transform` transition EVENTS armed before the click, which survive a starved renderer where per-frame sampling cannot.
- S6.1.2 Team ring and gate truth (landed 2026-08-16): `eval:workspace:team` is GREEN on `origin/master` and needs no quarantine — seven consecutive runs at load 14 through 200 (the last three under deliberate synthetic load), 10 tiles gliding every time. BUG-026 waived it reporting the glide gate red "on unmodified origin/master"; its attempt ref's parent is `9506c65` at 17:17, and S6.1.1 landed at 17:35, so that tree still had the self-evicting FLIP ref-cache and the old 80ms sampling gate. The observation and the diagnosis were both right; only the baseline was. `agent:land` rebases at the END, so a long session tests a checkout that ages the whole time it runs — **"red on master" is a claim about a TREE, and belongs in a worktree cut from `origin/master` when the claim is made.** The same aging-baseline trap then bit this very change (a stale `THIRD_PARTY_NOTICES.md` from its own base), and its third and most dangerous member is `git stash`: the stash is ONE stack shared by every worktree, so `pop` takes whoever pushed last and can land another session's work in your tree, while `drop`/`clear` destroy it — an agent did pop `agent/oss-wp5a-ci`'s stash into its own tree the same day. `AGENTS.md` now forbids stash beside `git add -A`, both being commands whose target is "whatever happens to be there" rather than a name you chose; the substitutes are a throwaway `--detach origin/master` worktree and a commit on your own branch. Also closes BUG-021: `cycleTab` fed the ring the durable manual arrangement the STRIP displays while Team painted S6.3's sort, so one press moved one place in the strip and landed wherever that Session sat in the grid. Display order is now an explicit parameter of the ring, `teamViewProjects` is the one producer both the grid and the ring read, and the trace the row asked for is `tab-ring-altitudes.test.ts`. The roadmap's "one deterministic result across altitudes" is half falsified: the strip and the grid legitimately display different orders (S6.3 shipped that deliberately), so what is shared is the OWNER, not the result. Boyscout: BUG-013's status corrected to `done` against the code — `PausedAgentRecord` renders in production, `RetainedTerminalPane` is gone, `eval:workspace:paused` is registered.
- S6.3 Team ordering shipped (landed 2026-08-07; FIX-008 closed same-day from the S6.2 bench review): the operator rejected needs-you-first outright ("active first without needs you first shouldn't exist") and named the two sorts himself mid-build ("Started vs. Activity"): a compact Started · Activity control in the Team chrome. **Started** is the stored default, at his word ("keep it like Google Chrome": start time, oldest first, a new Agent appends, nothing on screen changes address). **Activity** leads each Project with its most recent activity at the fidelity the surface has — working now first, then Agents by newest attention signal (a bell IS activity aimed at the operator), the rest in Started order; per-tab activity timestamps would refine it without renaming. Re-sorting is FULLY LIVE by his choice: a tile glides to its new slot the moment its band changes, via a FLIP wrapper that owns position only (D45's position-tween vocabulary, `cubic-bezier(0.25,1,0.5,1)`), so it can never fight the tile's own entrance/selection transforms; reduced motion snaps. The preference is device-local web storage, deliberately not the Electron settings channel (one surface's view order, promoted only if a second surface needs it). Ordering is a view — the ribbon's durable D20/D45 manual arrangement is never written. The Team surface finally owns a browser gate: `eval:workspace:team` runs the rig at `/hud-gallery/team-order` through the PRODUCTION toggle and asserts created default, active-first bands, a mid-flight FLIP transform (a silent snap fails), and reload persistence; `expose-overlay`/`team-order*`/`use-flip-tiles` join `SURFACE_GATES`. Boyscout: the overlay's optional props defaulted to fresh `{}` per render, and anything memoized on them re-derived every render — surfaced as a focus boomerang the moment the view order joined the chain; stable frozen empties now.
- S6.3.1 Team ordering review pass (landed 2026-08-07): three defects found by reading the shipped change, all introduced by it. The live sort made `items` rebuild whenever activity identity changed — which `setActivity` does exactly when an Agent starts or stops working — and the follow-active-tab effect keyed on `items`, so a busy fleet dragged the keyboard back to the active tile while the operator was scanning; the effect now mirrors a change of ACTIVE TAB rather than any new array, reproduced first as a failing test. A second toggle inside the 320ms glide inherited the first one's cleanup and snapped it; glide timers are now per tile, cancelled by the next glide and on unmount. The stored sort was read in an effect, so every open painted Started first and animated into place; it is now an external store read through `useSyncExternalStore`, so the first client render already carries it, gated by a new settle check (stored sort applied on first paint, zero tiles transformed). A `settling` guard added for that last case was DELETED once sabotage showed it never fired. Swept alongside: cached per-tile ref callbacks, and no measurement pass under reduced motion.
- S6.4 One lifecycle vocabulary and the pin/record contract (landed 2026-09-23; closes BUG-046, decision `0042`): one paused Agent spoke four vocabularies and two resume verbs at once (tab "Exited" or "Stopped", recovery bar "paused", pane "Stopped · Resume This Agent", record "PAUSED", Team tile a fifth lowercase word). `packages/ui-model/src/session-lifecycle.ts` is now the one owner of a Session's lifecycle word, its one-line ending, its tone and its verb; the tab strip, recovery bar, restore panel, paused record, Team tile and the card's current-state line all read it, and five private vocabularies are deleted (`TILE_STATE_LABEL`, the strip's lifecycle ternary, the panel's status ladder, the record's `endedCopy`, the display copy's process sentences). `session-lifecycle-vocabulary.test.tsx` renders one Session through all five surfaces and pins the shared words, deriving every expectation from the owner so a deliberate rewording moves product and test together. The pin-versus-record contract is settled by decision `0042`: the terminal a Session died in stays on screen under the lifecycle bar (the xterm already holds the bytes, so nothing is read or replayed), and a Session opened after its death is the record; `eval:workspace:split` is 10/10 and joins `SURFACE_GATES`. Team cards state facts only: the dashed "Coding" placeholder chip is gone (a declared Type renders as a plain fact chip), a card with no plan source shows no Next region instead of "No plan reported", and the doc-voice header hint is removed. Em dashes left the operator copy of every touched surface. The vocabulary is an ENG-039 M1-shaped seam: a pure package module with no inward dependency on `src` and its own unit suite.
- S6.2 Team ordering bench (landed 2026-08-07; superseded same-day by the S6.3 pick — the page survives as S6.3's eval rig): `/hud-gallery/team-order` renders the REAL Team altitude over a ten-agent fixture fleet with a candidate order strip — As arranged / Active first / Needs you first — re-feeding the same Projects in each mode's view order. The engine (`team-order.ts`) is pure, tested, and stable: ordering happens within each Project only, manual order survives inside every band, and nothing is ever written back to the durable arrangement D20/D45 own. The mode vocabulary, whether it ships as a view mode or a transient filter, and where the strip lives in production chrome remain the operator's pick, made from this bench. Alongside it, the roadmap-lens projection both altitudes feed `useProjectRoadmap` is extracted to one owner (`roadmap-lens-input.ts`, riding D51's `paintsAttention`) — the two inline copies had already drifted syntactically, the same two-consumers-one-unwritten-contract shape as BUG-009.
- S6 Team altitude pass (planned, deliberately unshaped pending a design pass; operator, 2026-08-07: "we should pair all the Team-view UI work / bugs / enhancements together"): every open Team-surface row travels as ONE change instead of four scattered small-fixes — FIX-002 (arrows move through a flat list while the layout promises a grid), FIX-006 (the tile's agent-title field takes focus but not typing), FIX-008 (no way to float the Agents you were working on to the front), and S4.1's unfinished goal-visual language (ship the operator's Graphic Form pick, evaluate FIX-005's Nano Banana, then retire the study). Two of those are already known to be ONE defect: `expose-overlay.tsx`'s `onKeyDown` owns both, moving selection ±1 through a flat `items` array and guarding only `[data-roadmap-rail]`, so inside a text field plain `j`/`k` are preventDefaulted into tile movement, `Enter` navigates away instead of committing, and `Escape` closes the overlay instead of cancelling the edit. The pass therefore has a real architectural subject rather than a batch: the Team grid needs one keyboard owner that knows its geometry and yields to text entry, and FIX-008 asks that same grid to reorder — which is the question of whether Team ordering is a view mode, a transient filter, or a sort, and whether it can move Agents at all without contradicting the durable manual arrangement D20/D45 established one altitude down. Do not shape that here; the design pass decides it with the operator, on the bench, from screenshots. RE-HOMES FIX-006 from ENG-016: it is a Team surface sharing an owner with FIX-002, not a daily-driver chrome defect.

Sequencing: precedes ENG-003 and all long-arc items (operator, 2026-07-06: excellence at 1–10 before the long arc).

Project doc:

## Next

### ENG-019 Cooperative session crystallization

Status: planned — follows ENG-003 because semantic checkpointing belongs behind source-aware Agent Source / Harness adapters.

Scope:

- on graceful quit or update, agents finish their current atomic turn, write a versioned per-Session handoff under `.exawatt/sessions/`, follow repo/local policy and repository git instructions, and report readiness
- Exawatt coordinates and displays that work but never runs git on the agent's behalf
- forced quit always remains available and falls back to ENG-018's latest technical checkpoint

Evidence for the design pass (a partner conversation): an external user keeps per-branch session state ("agent brain": CLI logs, research notes, plan, task list) in `~/_agent/session_state/<branch>`, deliberately outside the repo and unversioned, because he jumps non-linearly through stacked commits during review while his working knowledge only moves forward in human time. A repo-committed handoff under `.exawatt/sessions/` is pinned to a git ref and loses exactly that property — the same repo-visible vs machine-local question ENG-037 records for its frozen artifact. Decide deliberately, don't inherit "in the repo" as a default.

### ENG-003 Unified Agent Source architecture

Status: active-build — OPERATOR LIFT 2026-07-27 is deliberately narrow: design and prototype the Settings Agent Source registry, capability truth, source-owned authentication, and dynamic model-discovery boundary. Broad remote connection implementation and multi-source fleet management remain planned behind the daily-driver arc and gallery acceptance. This amends the 2026-07-12 hold without erasing its sequencing intent. EXTENDED 2026-08-03 (operator design pass) with S2/S3 — **engine plurality**: a third launchable source, `opencode`, is how OpenRouter, Kimi, other open models, and local inference reach a Session, and decision `0027` records why that rather than injecting provider credentials into a single-vendor harness. Authentication stays source-owned and this item's "no local provider token is stored by Exawatt" criterion is unchanged. EXTENDED 2026-08-12 with S4 — the **Grok Build adapter**, operator-pulled during the Grok Bot category wave and shaped for immediate execution; the recon verdict is easy-to-medium because the harness deliberately clones Claude Code's integration surfaces.

2026-09-07 execution link: source-owned setup and native/local/cloud capability investigation support ENG-016 D54/D71. See [source investigation](projects/agent-source-architecture.md#2026-09-07--adoption-source-investigation) and the [shared execution brief](projects/daily-driver-adoption.md#2026-09-07--adoption-execution-brief); no cloud-attach or native-control capability is assumed.

This item owns the source-facing portion of Exawatt's agency-control spine. That spine is a contract threaded through the existing source, Decision, Approval, Policy/Budget, Secrets, hosted-control-plane, and orchestrator work — not a new roadmap item or a mandate to build downstream integrations now. Decision `0016` records the provider-first boundary.

The operator lifted the hold after reviewing the two-source evidence and a
planning pass. The executable mile is the registry/capability foundation, not
the ten-mile fleet program. Production Terminal wiring followed review of the
`/hud-gallery/agent-sources` prototype (S1; the prototype itself was retired
in ENG-036 G1 after graduating to `/settings`); Settings architecture and
canon may advance now without pretending hosted/custom sources already
connect.

Scope:

- model Agent Sources/Harnesses generically
- model multiple configured instances of one source type without making
  `Connection` a second product boundary
- keep installation, reachability, authentication, identity, version
  compatibility, capability, freshness, and provenance as independent facts;
  derive compact UI state without destroying those facts
- Claude Code, Codex, and OpenCode adapters pulled forward (they are ENG-002's interactive terminal harnesses); local OpenClaw and Demo Scenario Source normalize through the same boundary
- keep source-specific protocol details behind adapters
- keep Claude Code, Codex, and OpenCode login credentials with their harnesses; launch the
  source-owned sign-in flow and recheck rather than ingesting provider tokens
- treat eligible subscription-backed harness sign-in as a first-class current
  entitlement path: Exawatt does not require an API key or separate token
  balance when the source is already launchable, and Consumption never infers
  billing mode or unreported plan headroom
- permit only narrowly scoped OS-keychain material for remote Gateway/custom
  source connections; ENG-009 still owns general Agent Secrets/Credentials
- discover model catalogs at runtime through supported source contracts and
  retain provenance/freshness. Claude Code's catalog comes from its SDK
  `initialize` control response (the rows `/model` renders); offline fallback
  uses only observed configuration or the account default, never provider
  aliases. OpenCode's bounded verbose catalog supplies source-reported
  `provider/model` rows and exact variant keys; S2 applies model, interactive
  variant, and ordered permissions through a guarded unique launch agent
- separate global source/account facts in Settings from the
  Project-effective model and effort shown at the Agent altitude
- describe each source's supported launch policies, reported activity, available evidence, and actual enforcement owner without converting unknowns into safety claims
- distinguish installed or advertised skills/tools from capabilities actually connected to the active Session; represent unavailable runtime backends explicitly. The [verified Codex CLI browser case](projects/agent-terminal-workspace.md#dogfood-investigation-codex-browser-capability-boundary-2026-07-22) is the first concrete evidence for this requirement

### ENG-023 Delegation visibility — subagents as fleet truth

Status: active-build — D1/D3a/D3b/D3c/D4/D5/D5.1/D7 and D6 census foundation landed; D2, remaining D6 inspection and D8 planned. [D6/D8 research and execution brief](projects/delegation-visibility.md#2026-09-18--d6-and-d8-execution-brief-truthful-delegation-end-to-end) defines evidence, shared contracts, parallel lanes and UX review gates. D7 (BUG-081) integrates the adjacent census/expiry candidate in the 0.1.11 batch; D6/D8 must preserve that lifecycle owner.

Direction: source-reported delegated work must remain observable without becoming
synthetic top-level coworkers. D5.1 separates observation health from turn truth;
D6 repairs population/query ownership and D8 supplies safe environmental context.
Counts, navigation and launch disclosure share evidence rather than inferring
truth from rendered glyphs or a model's self-description.

Mechanism (SUPERSEDES the capture-time framing): delegation is observed from **harness-reported lifecycle events**, not from a directory layout. Claude Code accepts hooks injected per launch via `claude --settings <file>`; the pass verified that `SubagentStart` / `SubagentStop` / `Stop` / `UserPromptSubmit` all fire, that `type: "http"` hooks POST to a loopback listener, that injected hooks MERGE with the user's own project hooks rather than clobbering them, that `SubagentStop` hands over `agent_transcript_path` and the child's result, and that a dead listener fails open without breaking the Session. Path derivation therefore leaves the critical path — which is what makes this safe for users who are not the operator — and the on-disk reader survives only as a fallback for history and for Sessions Exawatt did not launch. The channel is a general source-agnostic observation seam; delegation is its first consumer, not its purpose.

Partner evidence for why observation must be ARTIFACT-GROUNDED, not
self-reported (a partner conversation). Watching a live
five-sub-agent demo, a non-engineer partner kept asking where the output
actually went — the children each reported "printed hello" and then died,
leaving the parent's summary as the only trace. He then designed his own test
rather than requesting a feature: "just for illustration purposes, can you have
them generate a file and add a file to the folder or something? Like, yes, I
made this. I was here." His stated reason is prior-model distrust that will not
be argued away by better copy: "I've seen so many times with Gemini, with the
hallucinations, it'll be like, I did that. And they're like, no, you didn't."
Once files appeared: "so they basically can prove they've done the job." Read
this against the content boundary above — that boundary governs where a child's
RESULT may be read, and nothing here reverses it. What the evidence adds is that
a user with no ability to read code treats a harness-reported completion as an
unverified claim, so the surfaces owe evidence of effect and not just lifecycle
state. Do not shape a mechanism from this; it is demand, and D2 is the milestone
that would carry it. The same session confirmed the Codex asymmetry already
recorded in ENG-003 S4 against a real external user: he could not reach a Codex
child at all ("I don't think Codex supports that yet"), and Codex chose to run
three children, kill them, and spawn two rather than run five and kill three —
behavior neither participant could explain, which Exawatt reported without
interpretation, correctly.

Scope:

- a source-agnostic **harness event channel**: loopback listener (127.0.0.1, ephemeral port, per-Session bearer token, bounded payloads), a per-Session settings file written into Exawatt's own state directory, and inspectable disclosure of exactly what Exawatt injects
- a **delegation capability contract** with three mechanisms — push (Claude Code hooks, verified), pull (the existing local-log reader), protocol (OpenClaw gateway events and the Codex app-server adapter) — so a source declares whether delegation is observable and how
- the Codex PTY byte stream remains delegation-blind; D5's separate read-side app-server adapter declares protocol observation, correlates exact thread IDs, and fails to absent without filesystem, process, worktree, or terminal inference
- a **two-fact state model** — own turn (`generating` between `UserPromptSubmit` and `Stop`, else `available`) and delegated work (outstanding `SubagentStart` minus `SubagentStop`) — kept independent, broadcast to the renderer, and consumed by one shared derivation in `session-status.ts`
- Agent answers "can I talk to it?"; Team and Fleet answer "is this work moving?" — a Session with running children never reads as finished at fleet-comparison altitude
- compact DOM surfaces retain child **dots, not counts**, in a constant footprint; D3c supersedes the Fleet board's dot-only treatment at individual resolution with parent-like child units while preserving exact census and stable layout
- Agent-altitude ribbon boundary: delegated children aggregate into the parent Initiative-shaped tab and compact Project signal; they do not multiply top-level ribbon tabs or auto-expand a Project
- `attention-monitor` stops raising `turn-end` while children are outstanding — the concrete correctness fix, since byte quiescence currently reports a delegating parent as a finished turn

## Later

### ENG-011 Multi-source fleet management

Status: planned

Scope:

- aggregate coworker-shaped Agents from local, customer-hosted, and
  Exawatt-hosted OpenClaw plus Codex, Claude Code, custom harnesses, and Demo
  Sources
- support fleets from one agent to thousands
- present mixed-assurance fleets honestly, including untrusted sources with different reporting, evidence, and enforcement capabilities

### ENG-012 Hosted Exawatt control plane

Status: planned

Scope:

- hosted agent metadata
- team/workspace governance
- enforce managed Workspace ceilings across personal settings and Agent Sources where the connected enforcement boundary can honor them; refuse broader execution when it cannot
- fleet-scale aggregation of locally derived, explainable Session-continuity
  diagnostics; ENG-021 owns the semantics
- billing and consumption reporting

INFLATED 2026-08-02 from the operator brief, as recorded direction rather than shaped scope:

- **IT/admin management**: "As an IT leader within an organization, I should be able to see, provision, manage usage and permissions of the tool (SCIM, etc. in the future). Spend management and observability."
- **executive visibility**: "As an enterprise leader, I want to [see] agents company-wide and who is interfacing with them (or spawning them)." The brief names the hard part itself — "'agent' isn't really defined in the industry yet, so ownership / interfacing / attribution is still a bit of an open design problem." Do not paper over attribution; model it explicitly or state it as unknown.
- the **Organization** surface ships as an ENG-026 `preview` long before any of this is real (ENG-026 N3), and ENG-027's Workspace tenancy is its prerequisite

## Backlog

### Public defect-record boundary

Defect and small-fix records are kept in the private engineering repository
rather than published here. They are post-mortem detail about defects that
are already fixed, and publishing them would map the product's weak points
without helping anyone contribute.

Two consequences worth stating plainly, because a reader will notice both:

- **Milestone entries above cite internal ids** such as `BUG-041` or
  `FIX-002`. Those reference the private records, and they are kept because
  removing them would damage the history they explain. Nothing above depends
  on reading them.
- **Defects in the public project are tracked in the open.** ENG-041
  shapes that surface; until it lands, GitHub Issues is the place to
  report one. This section is history, not process.

### FIX-015 Toggle the active Project between titles and icons

Status: done · ENG-016 · 0.1.11 delivery batch, 2026-09-18; feedback `491c36ce`.

Click the active Project name to toggle the existing mini presentation without
changing Agent selection or stopping work. Icon selection preserves compact
mode. [Accepted interaction and verification](projects/daily-driver-adoption.md#2026-09-17--light-shaping-project-collapse-and-session-model-changes).

### FIX-016 Change the model within the same Session

Status: done · ENG-016 · 0.1.11 delivery batch, 2026-09-18; feedback `bf2f5a02`.

Shared catalog/effort controls, explicit Apply and resume, exact conversation
identity, preserved permission policy and no active-turn interruption. First
slice supports local Claude Code and Codex; unsupported sources are explicit.
[Accepted interaction and boundaries](projects/daily-driver-adoption.md#2026-09-17--light-shaping-project-collapse-and-session-model-changes).

### FIX-017 Predictable command discovery and truthful availability

Status: done · ENG-016 · D73; operator-selected, 2026-09-20.

One command offer policy supplies availability and reasons across command
surfaces; opening selection is stable and independent of incidental render
order. Exit: keyboard invocation and disabled reasons agree with source and
Session capabilities in Demo and Live. Reuse the existing menu treatment.
[Execution contract](projects/daily-driver-adoption.md#2026-09-20--shared-session-operations-and-storage-recovery).

### FIX-018 Clone the current work without another step

Status: done · ENG-016 · D46/D64; operator-selected, 2026-09-20.

The existing Clone to target selection captures bounded current context from
the exact source Session, then creates one fresh Session. No preview, extra
confirmation, hosted summarization, or provider resume identity. Exit: current
native user/assistant prose supersedes the opening task; unsupported, unavailable
or corrupt native context fails explicitly before launch, and races cannot clone
a different Session. Raw terminal output is never a fallback. [Execution contract](projects/daily-driver-adoption.md#2026-09-20--shared-session-operations-and-storage-recovery).

### FIX-019 Pause and resume a Project without losing its Sessions

Status: done · ENG-016 · operator-selected, 2026-09-20.

Pause stops eligible local processes while retaining tabs, history and exact
provider identity. Active work requires confirmation with blue, default-focused
Cancel and explicit Pause now; idle scope pauses directly. Exit: confirmation
binds exact targets, activity changes cannot bypass consent, unrelated Projects
continue, and Resume uses existing exact-identity recovery with honest source
and shell exclusions. [Execution contract](projects/daily-driver-adoption.md#2026-09-20--shared-session-operations-and-storage-recovery).

### BUG-143 Spatial deep links leave unused bottom space

Status: done · ENG-004 · operator feedback 072c0009, promoted 2026-09-23.

One route-owned viewport fills direct Spatial entry and resize; constrained
inspectors and cramped-window scrolling keep controls reachable.
[Report and acceptance](projects/spatial-operations-board.md#2026-09-23--spatial-deep-link-viewport-report-bug-143).

### BUG-144 Avatar Theme submenu is occluded

Status: done · ENG-032 · operator feedback 13591993, promoted 2026-09-23.

Shared popup portals and collision sizing keep nested menus visible, pointer
reachable and keyboard operable; the chrome gate enforces the boundary.
[Report and acceptance](projects/theming-and-visual-identity.md#2026-09-23--avatar-theme-submenu-occlusion-bug-144).

### BUG-145 A running Claude monitor is shown as requiring input

Status: done · ENG-023 · operator feedback b2b53b9b, promoted 2026-09-23.

Source-reported non-Agent work shares activity truth across attention and
Agent/Team/Fleet projections; real approval/input requests retain precedence.
Quiet manual task stops refresh at the next source boundary or Session exit.
Richer mixed-state presentation remains deferred. [Evidence and acceptance](projects/delegation-visibility.md#2026-09-23--a-running-monitor-must-not-imply-input-required-bug-145).

### BUG-163 Spatial ⌘J cannot focus Fleet Agents

Status: done · ENG-004 · operator product-feedback `1f51081a-6983-41a3-b713-57fc9969741f`, 2026-09-24.

Add a Fleet keyboard path that selects/follows an attention Agent with ⌘J, then opens that Session in Agent view on Enter. [Startup inspection diagnosis](incidents/0036-native-focus-predates-attention-subscription.md). Reuse existing attention eligibility and Session handoff. [Report and execution notes](projects/spatial-operations-board.md#2026-09-24--spatial-attention-keyboard-request-bug-163).

Resolved 2026-10-04: integrated and installed in `19712d6ff5b0`; the full landing checks and all 31 declared gates passed. Fleet Cmd+J and its menu share stable priority/pass traversal; Enter opens and acknowledges the exact Session without resolving its request. [Final receipt](projects/design-system-of-record.md#2026-10-04--everyday-use-execution-checkpoint).

## Amendment chain

Later milestones amend earlier ones. These supersessions are load-bearing: an agent reading only the roadmap must not act on a superseded decision. Full narratives for both sides of each pair live in the linked project doc's Roadmap milestone log.

| Amended                                                                                                                                                                                  | Amended by                                                                           | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUG-285 acceptance "a genuinely different installation still produces its notice" | BUG-285 diagnosis (incident `0039`), 2026-10-18 | The reported return WAS a different installation under the same stale running build. The local-build notice's identity is the running build: once dismissed it stays dismissed until the operator runs a build that is superseded in turn. |
| ENG-004 V4.1 renderer-local interaction/label setup and whole-record presentation mutations | Operator-authorized review repair, 2026-10-15; decision `0050` amendment | Shared board behavior, explicit status annotation depth, surface-owned retry attempts and persistence-owned field updates replace the drift-prone ownership; v1 default and the accepted material look remain. |
| ENG-004 V4.1 P2 development-only v2 offer | P4 parity verified and P5, 2026-10-15 | Every build offers v2 (Preview); explicit-only storage and the v1 default remain unchanged. |
| ENG-004 V4.1 P3 pending look review, three-material scope and unresolved Material row | Operator acceptance and P4 instruction, 2026-10-15 | Gummy leads; all five bench materials selectable in navigable Settings; P4 proceeds in parallel; next review in actual app. The old delegation branch prerequisite is superseded by the integrated census rescue. |
| ENG-004 V4.1 / decision `0050` planning names Dots and Tiles | Operator naming amendment, 2026-10-14; V4.1 P2 | Visible Fleet view choices are v1 and v2 (Preview). v1 remains the runtime default; the dev-only v2 offer until P5 and explicit-only storage contract are unchanged. |
| ENG-032 T5.3's fixed Geist public face applied to `/`, and W15's typography options were study-only | Decision `0049`, operator, 2026-10-14 | `/` fixes Hanken for the fleet story, independent of app appearance. Classic, Air, and Night resolve proportional UI/display text to Hanken; tabs and deliberate mono roles keep Geist Mono. `/architecture` retains its fixed Geist public boundary. The study opens on Hanken and keeps its alternatives. |
| ENG-031 W16's "neither study authorizes homepage promotion" and W21's "homepage adoption still awaits selection of a direction" | Decision `0047`, operator, 2026-10-14 | The operator selected the W15 fleet story for `/`. The band stack moves to `/old` (noindex, out of the sitemap), `/v2` is deleted without a redirect, and the terrain study stays a gallery study. Implemented in W15m. |
### BUG-274 Agents on the local network raise an unexplained macOS prompt

Status: bug · ENG-045 · found 2026-10-04 by the permissions research.

Exawatt declares no `NSLocalNetworkUsageDescription` (`electron-builder.yml`
`extendInfo`). Command-line tools run from Terminal are exempt from Local
Network privacy, but agents in Exawatt PTYs are attributed to Exawatt (TN3179),
so the first agent connection to a LAN address or `.local` name raises macOS's
prompt with no Exawatt explanation, and a denial blocks every agent's LAN
access with no recovery shown. Fix: add the usage string in Exawatt's voice;
the primer belongs to ENG-045.

### BUG-275 "Sign in with {source}" drives Terminal without the Automation entitlement

Status: fixed 2026-10-18 by deletion
· ENG-003 · found 2026-10-04 by the permissions research; failure inferred,
not reproduced. Every local source now declares its sign-in command and it
runs in an Exawatt Shell tab; the `osascript` Terminal path and the
`authenticate`/`choose-model` IPC actions are deleted, so no entitlement is
needed. [Evidence](projects/agent-source-architecture.md#2026-10-18--source-owned-actions-run-in-one-place-bug-275-bug-283).

`electron/main/pty/agent-source-registry.ts` runs `osascript` "tell
application Terminal … do script" for Settings ▸ Agent Sources' sign-in and
model actions, but the hardened runtime carries no
`com.apple.security.automation.apple-events` entitlement and the app declares
no `NSAppleEventsUsageDescription`, so the Apple Event most likely fails with
-1743 in signed builds. Reproduce on an installed build first; then add both,
or replace the Terminal hand-off with an Exawatt-owned terminal tab.

### BUG-276 The release feed publisher test fails on a clean `master`

Status: done · ENG-030 · found 2026-10-04 running the full suite for ENG-038 slice 3; closed 2026-10-18. The test moved into the delivery suite, over a real closed publication, with the release context from one place (`feedReleaseContext`) ([log](projects/agent-development-loop.md#2026-10-18--the-delivery-system-fixes-from-the-train)).

Both cases in the release publisher's test spawn the feed publication script,
which since BUG-256 (`4855b70a`) requires `EXAWATT_RELEASE_TAG` and
`EXAWATT_RELEASE_STAGING_PERCENTAGE`; the test's child environment sets
neither, so the script refuses before reaching the behavior the test asserts
(`Official update publication refused: missing EXAWATT_RELEASE_TAG`). The
landing checks run only related tests, so it has not blocked anything. Fix the
test's premise by supplying both variables in its child environment; do not
weaken the script's requirement.

