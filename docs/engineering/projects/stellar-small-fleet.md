# Stellar Small-Fleet Command (1–10 agents)

Roadmap item: ENG-015

The excellence arc on top of ENG-002 parity: make operating one to ten
parallel agents genuinely stellar before any long-arc work. The investment
target is the TERMINAL regime — the "solid, robust, approachable" AI-native
tmux++ — while the AgentField map (ENG-004) diverges separately toward an
RTS-style at-scale command surface. Both stay long-lived runtime regimes
over the same session/fleet system.

Operator intent (2026-07-06): "I want the UI for managing one to multiple
to up to ten agents to be really stellar, excellent, and top-notch …
keyboard shortcuts and also the game style slick UI … before we get to the
long arc stuff." Stellar = attention & notifications + speed of control +
visual juice & game feel + context at a glance + research-backed
context-switching support ("help the human operator easily go between
contexts and be productive as he pages in dramatically different active
contexts").

Standing constraints: generic for any user (no operator-bespoke tuning —
personal taste routes to future settings), no all-caps text, keyboard-first
and accessible, reduced-motion respected, quality over fanciness.

## Milestones

### S1 Attention system

Status: landed 2026-07-06

The single highest-leverage capability at 4+ agents: never discover a
stalled or asking agent late.

Scope:

- main-process attention monitor over the PTY stream, two signal classes:
  - explicit: BEL (`\x07`) and terminal notify sequences (OSC 9, OSC 777)
    from any session — these are what harnesses and TUIs already emit
  - inferred (harness sessions only, not shells): a work burst followed by
    output quiescence = turn boundary → "may need you". Thresholds
    env-tunable; expect dogfood tuning. Shells stay bell-only (quiet is
    their normal state)
- attention clears when the operator looks (tab focused) or answers
  (writes to the PTY); the focused session never accumulates attention
- surfaces: pulsing badge on the tab + count on the initiative chip;
  oldest-first attention queue with a jump shortcut (⌘J cycles); macOS dock
  badge count + single bounce when the app is unfocused
- fleet truth: attention maps into FleetState so the board and the map
  show the same "needs operator" state the tab strip does (closes the W0.3
  honesty note: quiet-but-waiting no longer reads as plain idle)

Acceptance criteria:

- a bell or a finished work burst in an unfocused session badges within
  ~2s and enters the queue; focusing it clears everywhere (tab, dock,
  fleet) within a second
- ⌘J jumps to the oldest needs-attention session; repeated ⌘J walks the
  queue
- pure TUI redraw noise (escape-heavy spinners) does not false-positive
- dock badge reflects the live count; no badge when all clear

### S2 Command velocity

Status: landed 2026-07-09

Scope:

- global fuzzy session switcher (builds on the existing ⌘K palette):
  sessions + initiatives searchable by name, project, and micro-context;
  live status in the result rows; ≲2 keystrokes to anywhere
- split panes: two sessions side by side (the "watch one, drive one" case)
- complete no-mouse audit: every daily action (launch, close, rename,
  color, worktree, jump) reachable by keyboard
- shortcut discoverability: an in-app cheat-sheet overlay (⌘/)

### S3 Exposé, motion & discoverability

Status: landed 2026-07-10

Scope (reshaped by dogfood round 4 — discoverability first-class):

- ⌘O exposé overview: all sessions as rich tiles (stable slots, keyboard
  driven, staggered entrance motion), DOM-rendered per decision `0003`
- discoverability: persistent bottom key-hint bar + hints in the empty
  state; workspace verbs in the ⌘K palette with their chords
- hover/pressed states on tabs; forced dark theme; "launch" language;
  devIndicators off; terminal font setting (userData settings.json)
- respects prefers-reduced-motion throughout; pane-content switch
  animation deliberately skipped (terminals reflow badly under motion)

### S4 Context paging

Status: active-build — recap delivery moved ambient under ENG-016 D18;
S4.1 goal visual anchors landed 2026-08-03 for direct live dogfood.

The deep layer: the operator's real bottleneck at 5–10 agents is not the
software, it's human working memory — paging a mental context back in
after minutes away. Design for recognition over recall, changes over
restatements, and delivery at boundaries.

Starting hypothesis (operator, 2026-07-10; explicitly reversible): begin
with the least noisy behavior. Ordinary progress and successful completion
remain visible in status surfaces but do not interrupt. Non-critical updates
wait for a natural pause, agent switch, or exposé visit. Work that has stopped
for input or an error may enter the attention queue immediately, but must not
steal focus. Tune or replace this policy from dogfood evidence rather than
treating it as a permanent notification contract.

The first S4 implementation slice prioritized the re-entry recap and
change-since-last-visit digest. Its popup delivery was later retired under
ENG-016 D18; the summarizer seam survived. S4.1 now selects the next candidate
from the idea bank without reopening that delivery decision.

First-slice acceptance criteria:

- leaving a session records a scrollback checkpoint; returning after at least
  two minutes and meaningful new output summarizes only what changed while
  away
- the recap appears only over the session being revisited, never as a
  background completion notification and never by stealing focus
- ordinary short switches and insignificant output remain silent
- the first keystroke dismisses the recap without consuming the keystroke;
  typing or switching before generation completes suppresses stale output
- one summarizer call runs globally, using the existing authenticated CLI and
  failure cutoff; thresholds remain environment-tunable for dogfood

#### S4.1 Goal visual anchors

Status: landed 2026-08-03 for direct live dogfood. The operator explicitly
waived the gallery-first gate for this slice; a focused `/hud-gallery` study
remains available if live evidence calls for faster visual-treatment
comparison. The treatment and exact-reuse policy are reversible dogfood
hypotheses, not permanent identity doctrine.

**Problem and outcome.** The operator's practical ceiling remains five or six
live contexts. At Team altitude, a quiet image behind each Agent tile should
make its durable work-world recognizable before its title is read. This is a
context-retrieval aid, not decoration, status, activity, or a new content
region. Success means the operator can find and re-enter a familiar goal more
quickly without weakening D40 status or the tile's goal / Now / Next reading
order.

**Identity and cadence.** The asset belongs provisionally to the accepted
durable goal/work-world, not to the Agent instance or Harness. Within a
Workspace and Project, matching normalized accepted goals may reuse the exact
asset. ENG-021's Objective Engine owns semantic cadence: the first accepted
label creates an identity; `same_context` preserves it; `new_context` creates
a new revision. An explicit operator label correction also creates a revision
because corrections are rare, intentional, and frequently repair a missed
pivot. Coalesce superseded requests and cache by the stable identity key so a
restart, Agent state change, or wording-preserving follow-up never spends or
changes the image. Similar-but-not-identical variants remain an optional later
experiment.

**Visual contract.** The image fills the existing 300×272 Team tile behind its
content and consumes no new layout space. Use subdued natural environments:
one memorable organic silhouette, medium tonal separation, restrained color,
low-frequency detail, and no people, faces, text, logos, UI, architecture, or
literal code imagery. A localized scrim protects the left identity column and
lower goal / Now / Next / Consumption hierarchy without erasing the scene.
Project color may tint identity but never becomes status; D40 lights remain
the strongest peripheral signal. High-contrast and reduced-transparency modes
may suppress the image. Reduced motion hard-cuts; otherwise a completed asset
may crossfade once. The image is non-interactive.

**Operator control.** One app-global device preference defaults on and is
visible in Settings on both Electron and hosted web. Electron remains
authoritative for the main-process generation gate; hosted web uses versioned
browser storage. Both sources feed the same Team renderer snapshot, so the
switch hides or restores every backdrop immediately without mutating goal
truth or deleting cached assets.

**Generation and privacy boundary.** `fal-ai/fast-sdxl` is the first prototype
provider because iteration is fast; it is not the product boundary or a
durable vendor commitment. The FAL credential is a server-only secret and
must never enter renderer code, Electron main, a packaged application, logs,
or committed env. The authenticated Exawatt server accepts only the durable
label plus a non-sensitive identity key — never raw instructions or terminal
output — and derives a generic natural-scene recipe and seed. Only that recipe
reaches FAL; the label and Project identity do not. The route prevents FAL
request-payload retention, enables the safety checker, and downloads an
accepted result immediately into Exawatt-controlled private storage. The
product must not depend on FAL's public output URL or retention.
Provider failure, sign-out, offline use, quota exhaustion, or safety rejection
leaves a deterministic Project-tinted fallback; generation never blocks Team.

**Source boundary.** One source-agnostic `GoalVisual` projection carries the
identity key, revision, state (`fallback | generating | ready | rejected`),
and renderable asset reference. Live Mode obtains it through the authenticated
generation/cache path. Demo Mode supplies authored fixtures through the same
projection and never requires generation. The Objective Engine must preserve
the accepted relationship/revision far enough to drive this projection;
imagery must not create a second semantic classifier.

**Execution sequence.** Per the operator's 2026-08-03 waiver, wire the quiet
abstract treatment directly into Demo and Live Team tiles behind the shared
projection, then use live dogfood to decide whether it needs a comparison
study. If it does, generate 6–10 representative fixtures and compare a small
number of backdrop/scrim treatments in `/hud-gallery` across realistic
long-copy, working, blocked, idle, stopped, and high-Consumption tiles. Keep
all percolation to Agent or Fleet altitude out of scope until the Team
treatment earns that expansion.

**Acceptance criteria.** Related instructions generate zero replacement
assets; one accepted durable-purpose pivot produces at most one. Every empty,
loading, offline, rejected, and failed state remains a complete readable Team
tile without a spinner. Existing text contrast, keyboard selection, tile
footprint, D40 recognition, and reduced-motion behavior do not regress. No FAL
credential, raw operator instruction, terminal output, or long-lived public
FAL URL reaches the client. Demo and Live render the same component contract.

#### Roadmap milestone log — 2026-08-03

S4.1 landed as one source-neutral `GoalVisual` projection across Electron
main/preload, persisted workspace state, Demo fixtures, and the existing Team
tile. ENG-021's accepted relationship is the only cadence owner: the first
accepted goal, `new_context`, or an explicit correction creates a revision;
`same_context`, status changes, reloads, and ordinary follow-ups preserve it.
Electron sends the hosted boundary only the accepted label and a one-way
SHA-256 Project identity, never a local path, Project name, raw instruction, or
PTY output. Stale generations coalesce and transient failure gets one bounded
retry.

The authenticated `/api/goal-visuals` route derives a deterministic cache key
and seed, checks a private per-user Supabase JPEG cache, applies hourly/daily
quota, and invokes `fal-ai/fast-sdxl` with safety checking and provider payload
retention disabled. It immediately downloads a bounded trusted FAL result into
private Exawatt storage; renderer state contains a data URL, never a provider
URL or credential. Missing auth, offline use, failure, quota, and rejection all
leave the same complete deterministic Project-tinted tile.

The Team tile retains its 300×272 footprint, interaction, semantics, and
goal/Now/Next hierarchy. A subdued raster may crossfade once behind a
protective scrim; reduced motion hard-cuts, and high-contrast or
reduced-transparency modes suppress imagery. Demo assigns the same identity to
Agents advancing the same Initiative and performs no generation I/O. The
operator chose direct live dogfood over the planned gallery review; the gallery
comparison remains a reversible follow-up, not a second source of truth.

Follow-up, 2026-08-04: incident `0005` separated a provider-wide appearance
storm from the Goal Visuals asset path. The comparison bench now decodes all
nine valid studies before one React commit replaces deterministic fallbacks,
contains each tile's paint, keeps Project identity out of readable goal copy in
Air, and adapts below the reviewed 272px desktop geometry without horizontal
overflow. `eval:goal-visuals-stability` owns the idle, cross-tab storm,
contrast, decorative-image, and 320px gates; the study remains review-only.

Operator amendment, 2026-08-03: a device-local **Agent tile backgrounds**
control in Settings → Preferences defaults on. Turning it off immediately
hides cached imagery and prevents future generation requests; turning it back
on restores a ready cache hit or requests the current accepted goal. The
setting changes no goal, revision, or Project identity truth.

Direct dogfood exposed a bearer-boundary omission the same day: the global
proxy did not list `/api/goal-visuals` beside the other desktop bearer APIs, so
it redirected Electron's valid POST to `/sign-in` and the preserved POST
returned `405`. The route now bypasses cookie middleware and continues to own
bearer validation, matching `/api/context-labels`; the proxy test names the
endpoint so this cross-layer failure cannot silently return.

The first live generated set was rejected by the operator the same day. The
literal `software agent work-world` prompt plus accepted goal text repeatedly
produced washed-out pseudo-interfaces, windows, and grids; the global 70–90%
scrim reduced the raster to a few percent of its original contrast while the
Project-tinted fallback remained underneath. Generation v2 invalidates the v1
cache and converts the private goal identity into a deterministic natural
scene family, palette, atmosphere, composition, and seed without sending the
goal text to FAL. Ready rasters now replace rather than stack with the fallback,
use theme-specific restrained filters, and retain localized HUD-panel scrims
over the text-heavy regions. The design-system HUD ground, Project-identity
channel, accessibility suppression, and 260ms house easing remain unchanged.

Operator review then reopened the gallery path on 2026-08-03 specifically for
geometry, not prompt tuning. `/hud-gallery/goal-visuals` now renders the real
272×252 Team content hierarchy against five treatments — full field, top-right
corner field, header banner, right ribbon, and horizon band — and compares the
corner candidate across three stable goal identities. The operator selected
full-card geometry and rejected natural-environment scenes as the visual
language on 2026-08-04. The bench is now fixed to full-card geometry and compares
material macro, aerial structure, and graphic form, with three variants of each.
Its nine fixed, server-owned study recipes use the same authenticated FAL,
cache, and quota boundary as Team without sending private goal or Project text
to the provider. This is a language study only: the live Team prompt remains
unchanged until the operator picks a family. Once that family ships, retire the
study rather than keeping a duplicate of production.

The operator chose Graphic Form as the leading direction on 2026-08-04 and
requested a wider metaphor pass before production wiring. The bench now keeps
Graphic Form as its anchor, retires Material Macro and Aerial Structure from
the visible comparison, and adds Graphic Metaphor, Symbolic Still Life, Noun
Place, Emblematic Artifact, Editorial Collage, and Diagrammatic Landscape.
Every family renders against the same three goals and full-card geometry; the
18 new fixed recipes remain server-owned and never forward goal or Project text
to FAL. The existing app-global **Agent tile backgrounds** preference is also
projected into Team's top chrome as **Backgrounds**, while Settings remains the
durable explanatory home. Both controls write the same preference, so turning
it off still suppresses cached rendering and future Electron generation.

### S5 Durable Projects

Status: landed 2026-07-10 — scoped same day (operator); all phases complete.
Multi-machine sync behavior awaits dogfood evidence (tracked via ENG-016's
continuous evidence stream). Landed 2026-07-10: P1
rename (Initiative→Project, ignite→launch), P2 registry + `projects` reclaim
migration (applied to prod & verified), P3 resolution bridge (launching
registers the Project), P4 native directory picker + Browse + ⌘N + ⌘K Projects
group, P5 missing-dir "locate on this machine" + decision record `0010`.
Also landed: the P3 identity/color sync + reconcile-on-load, so the registry's
synced name/color drive the tab strip (both directions). Fixes the gap
surfaced in dogfood: you cannot open or browse a Project unless a session is
already running in it. Today a Project (mislabeled `Initiative` in code) is DERIVED —
resolved from a session's cwd (`project-resolve.ts`, git-common-dir; worktrees
fold to the main repo) and persisted in local `workspace.json` only while it
has a surviving tab (`use-workspace-state.ts` prunes exited tabs and drops
zero-tab groups). The last session ending forgets the Project; only
`lastUsedDir` survives. There is no folder picker, no known-projects list, and
no palette or menu action to open one.

Operator decisions (2026-07-10):

- Projects are a CURATED, durable registry, not merely recents — a Project
  stays known with zero live sessions.
- Storage is Supabase, user/workspace-scoped and synced across the operator's
  machines. The Supabase project is already linked; browser/server clients and
  Electron OAuth deep-link auth already exist.
- v1 scope is launcher + identity, not a rich per-Project home. The rich
  overview (state summary, agent count, blocker pressure, next attention point)
  stays deferred and is the spatial board's Project-zone job (ENG-004).
- Rename to canon: the code/UI concept becomes **Project / Context Group**;
  `Initiative` is reserved for the durable-goal primitive (ENG-005,
  `docs/product/concepts.md`).
- Table name (operator, 2026-07-10, final): the canonical Project takes the
  `projects` table — "I prefer projects vs context groups — more idiomatic and
  future-proof; we can always have a kind/type column." The legacy demo kanban
  is renamed `demo_projects` and its queries repointed via a PostgREST embed
  ALIAS (`projects:demo_projects(...)`), so the demo keeps working with minimal
  churn (only `.from()`/embed strings + the demo TS type → `DemoProject`);
  preserve the demo's functionality, but do not bend over backwards. The `kind`
  discriminator keeps the table general (soft/inferred/semantic Projects are
  future kinds); v1 builds only the repository kind.

Architecture — split identity from layout:

- Durable Project IDENTITY (name, color, resolved root path, optional
  git-remote, recency, sort order, archived flag) lives in Supabase and SYNCS.
- Ephemeral session/tab LAYOUT (live tabs, active tab, split pin) stays LOCAL
  in `workspace.json` and does NOT sync — Machine A's live tabs must not
  materialize on Machine B. The local layout references a Project by id.
- Load reconciles the two: fetch the Project registry (the known list) + load
  the local layout (live/revivable sessions) and join by id.

Data model — the canonical Project claims the `projects` table. The legacy demo
kanban is renamed `demo_projects`; its `agent_tasks` FK, RLS policies, trigger,
and indexes follow the table rename automatically. Demo queries repoint via a
PostgREST embed alias (`projects:demo_projects(...)`) so the demo's
`task.projects` result key and components stay unchanged — only `.from()`/embed
strings and the demo TS type (→ `DemoProject`) move. The `projects` table is
SHAPED for the general grouping via `kind`; v1 builds only the repository kind:

- `projects` (canonical registry): id · user_id · name · color · `kind` (text
  not null, default `'repository'`) · root_path (nullable) · git_remote
  (nullable) · last_opened_at · archived_at (nullable) · sort_order ·
  timestamps. RLS user-scoped, mirroring the existing table pattern. v1 writes
  only `kind='repository'` with a real root_path; a `resolution_rule jsonb`
  (for inferred/semantic/customer/goal kinds) is deferred until a second kind
  exists — a trivial additive migration then.
- Legacy demo table → `demo_projects` (unchanged columns: id, user_id, name,
  description, timestamps). Preserve its functionality without bending over
  backwards; ENG-016 buries it from primary nav regardless.
- Resolution bridge on launch: resolve `projectDir` as today, match a row by
  `root_path` then `git_remote`, upsert if new. A row whose `root_path` does
  not exist on the current machine renders a graceful "locate on this machine"
  rebind rather than an error; full per-machine path bindings are deferred
  (single operator, mostly one machine).

Open/browse UX (launcher + identity):

- Native directory picker: new `dialog:openDirectory` main IPC + preload
  surface → a 📁 Browse control on the launch directory field (ends
  path-typing).
- ⌘K **Projects** group: open/switch a Project (sets active, prefills the
  launch dir / launches the default harness), Add Project (picker), rename,
  recolor, archive. Reaching any Project is ≲2 keystrokes.
- Recents fall out of `last_opened_at`. New Projects append; order never
  auto-reshuffles (idea bank #2, stable spatial addresses).

Phasing:

- P1 Canon rename (landed 2026-07-10): code `Initiative` → `Project`, UI
  labels, `data-project` hooks, and a `workspace.json` v1→v2 migration that
  preserves saved layouts. `/architecture` manifest + `packages/core` already
  used the canon goal-Initiative correctly and stayed untouched. Verified:
  type-check, lint, 285 tests, Next build, workspace screenshot smoke.
- P2 Registry data layer (landed 2026-07-10): reclaim `projects` — migration renames the legacy
  demo table to `demo_projects` and creates the canonical `projects` registry
  (+ RLS, kind discriminator, unique index on user_id+root_path); repoint demo
  queries via an embed alias and rename the demo TS type to `DemoProject`; add
  typed registry accessors on the browser client. Checkpoint (met): the
  `/workspace` renderer holds an authed Supabase browser session (PKCE via the
  OAuth deep-link), so RLS reads/writes work without a main-process proxy.
- P3 Identity/layout split + resolution bridge + reconcile-on-load. Resolution
  bridge landed 2026-07-10 (launching best-effort registers the Project; the
  full ⌘N → shell → registry-write flow verified against the real DB via the
  Electron E2E `scripts/registry-e2e-eval.mjs`). Identity/color sync landed
  2026-07-10: the registry is the source of truth for a Project's name + color
  — reconcile-on-load (async, non-blocking) adopts the synced values and links
  each group to its registry row; launching adopts the registry identity (and
  pushes a new Project's locally-assigned color up); the rename/recolor verbs
  write back to the registry. All best-effort, degrading to local behavior.
- P4 Open/browse UX (landed 2026-07-10): native directory picker + 📁 Browse
  control + ⌘N "new project", and the ⌘K Projects group (browse/open known
  Projects with no live session — activate if live, else launch a shell).
- P5 Missing-dir + docs (landed 2026-07-10): "locate on this machine"
  (`dialog:pathExists` + registry `rebindProjectPath` + the ⌘K locate flow),
  decision record `0010`, and this status pass.

Acceptance criteria:

- A Project stays known after all its sessions end; it reopens later WITHOUT
  retyping the path.
- Add a Project by browsing to a folder (no path typing); it appears in the
  registry and the ⌘K Projects group.
- Switching or opening a Project from ⌘K takes ≲2 keystrokes; the list survives
  app restart and appears on a second signed-in machine (synced), with a
  graceful "locate on this machine" state where the path is absent.
- Code and UI say "Project"; no lingering "initiative" for the session-group;
  canon `Initiative` (goal) remains reserved for ENG-005.
- The registry is the shared source of truth the spatial board's Project zones
  (ENG-004) read, not a terminal-only structure.

### S1.1 Reported turn truth

Status: landed 2026-07-27

S1's inferred signal class was always the weaker half: a work burst followed by
output quiescence is a _guess_ that a turn ended. ENG-023's harness event
channel made the real boundary available, so S1.1 uses it where a source
reports one.

**The measurement.** A real Claude Session, sampled through Exawatt's own IPC:

```
+0.6s   own=generating  glyph=working
+2.6s   own=available   glyph=working    <- the Agent has provably finished
+9.9s   own=available   glyph=done       <- the strip catches up, 7.3s later
...
+53.2s  own=available   glyph=working
+58.8s  own=available   glyph=done       <- 5.6s later
+59.6s  attention=turn-end
```

After: the glyph and the result signal land in the same sample as the reported
boundary, on every turn.

**A correction to the motivating case.** This work was proposed on the theory
that a long silent stretch (a 20s test run) would make inference declare a
false result. That did **not** reproduce: Claude Code repaints a live timer
while working, so the stream is never actually quiet. The real defect is the
opposite direction — a 6-7s window, twice per turn, where the strip reports
work that is already done. Do not restate the false-result claim.

Scope:

- `attention-monitor.noteHarnessTurnEnd` settles a reported boundary at once:
  settle, stop working, consume the burst, then raise the ready result subject
  to the same watched / delegated-busy rules as inference
- `sessionGlyphState` accepts the reported `ownTurn`, which outranks byte
  activity in both directions and resolves through the SAME rest vocabulary,
  so a reported turn changes when the strip is right, never what it can say
- the renderer keeps a Session's reported record while its own turn is running,
  not only while it has delegated children
- inference is deliberately LEFT RUNNING as a backstop; `raise` is idempotent,
  so it is a no-op when the reported path already fired

Two defects the permutation testing found, both fixed here:

1. **The 20s spawn grace was swallowing reported ends.** That guard exists
   because a revived tab printing its banner and going quiet _looks_ like a
   finished turn to inference. A reported boundary has no such ambiguity, and
   most first turns finish inside the grace — so honoring it made the feature
   useless exactly when a Session is newest.
2. **A superseded result survived into the next turn.**
   `sessionStatusLightState` reads a turn-end signal as `result` regardless of
   turn state, so a stale flag lit "result ready" on a Session that was visibly
   working again. A reported turn start now retires the RESULT class only — an
   unanswered question or block still needs the operator, and more output does
   not answer it.

Post-landing review found a third defect, of a different kind: the liveness
rule ("is there anything reported worth showing?") had been written twice — in
the main process and again in the renderer — and the two drifted. Main retained
settled records forever while the renderer dropped them, so once a turn ended
and the operator began typing a follow-up, the ⌘K switcher answered "result
ready" from the reported fact while the tab strip answered "working" from
inference. One question, two answers, on surfaces the repo deliberately drives
from one derivation. The rule now lives only in `delegationIsLive`, the monitor
publishes `null` for a settled Session, and every surface returns to inference
at the same instant. Surfaces no longer decide what is worth showing.

Verification: `pnpm eval:electron:turn-truth` drives the permutations in the
real app over a fixture harness that speaks the actual hook payloads;
`attention-monitor.test.ts` and `session-status.test.ts` own the state matrix,
including the watched/unwatched split and the burst/quiescence thresholds,
which need an injected clock and focus rather than a live window.

### S1.2 Reported needs-you — open lead, NOT verified

S1.1 replaced the inferred half of the _turn_ signal. The **needs-you** half is
still inferred from a BEL character, so an Agent that asks a question without
ringing the terminal bell reads as a finished result rather than a human gate.
That is the last guess left in the attention system.

The documented candidate is the Claude Code `Notification` hook (matchers
include `permission_prompt` and `idle_prompt`), with `PermissionRequest`
alongside it. It would ride the existing harness event channel with no new
transport.

**Do not build on this until it is verified.** Three attempts failed to make
either hook fire, and the reason is not yet understood:

- `claude -p` (print mode) never prompts, so no notification is produced — the
  hook is simply not reachable that way.
- Driving an interactive session under `expect` did not work either: Claude
  produced no output at all under that pty, so the session never reached a
  prompt. This is an artifact of the probe, not evidence about the hook.
- The reliable path is the Electron eval harness, which does drive a real
  interactive Claude session (it is how S1.1 and ENG-023 D1 were both proven).
  A probe there needs a Session launched with a permission policy that actually
  prompts — `prompt` / **Ask first**, not the YOLO default — and a tool call
  that requires approval.

Until a payload is captured, the shape of the event, whether it carries the
question, and whether it distinguishes a permission prompt from an idle nudge
are all unknown. Treat every claim about it as unverified.

## Context-paging idea bank (research-grounded)

Ranked roughly by conviction × cost. These are candidates, not commitments;
S4 planning picks from here.

1. **Visual identity anchors — per-initiative generated emblems.**
   **Superseded by S4.1 (operator, 2026-08-03).** The durable insight — use
   recognition rather than serial title reading — survives. The proposed
   identity boundary, deterministic SVG treatment, and offline-only posture do
   not: the shaped first experiment is goal/work-world imagery in Team tiles,
   driven by ENG-021 semantic pivots with a deterministic offline fallback.
   Recognizing a familiar image is near-instant and pre-attentive; reading
   a text summary is serial and slow (picture-superiority effect). Give
   every initiative a deterministic generative emblem (constellation /
   circuit / sigil style SVG seeded from the project, drawn in the project
   color — offline, instant, generic; no AI image dependency), shown
   everywhere the initiative appears: group chip, switcher rows, exposé
   tiles, map sector. The operator's brain keys "Cortex EHR" to a shape+
   color pair instead of re-reading a label. Later upgrade: optional
   AI-generated artwork per initiative.

2. **Stable spatial addresses.** Human spatial memory is strong and free:
   people find things by WHERE they live. Initiative order, ⌘1..9
   assignments, exposé grid slots, and map sector positions never
   auto-reshuffle; new projects append, they don't reorder. "Position" is
   part of the context key — reshuffling silently destroys it.

3. **Re-entry recap card ("previously on…").** On switching into a session
   that's been backgrounded more than a few minutes, a transient overlay
   card: the goal (micro-context), what happened while you were away, and
   what the agent needs now. Dismisses on first keystroke, never blocks
   input. Episodic-memory cueing: a 2-second recap rebuilds mental state
   far cheaper than scrollback archaeology.

4. **Delta digests, not restatements.** Evolve the W0.4 summarizer from
   "what is this session doing" to "what CHANGED since you last looked"
   (we know last-focused timestamps): "3 turns; edited auth.ts + 4 files;
   tests green; now asking about migration order." Change-relative
   information is smaller and matches how the brain updates a model it
   already holds.

5. **Boundary-batched interruptions.** Interruption research (Iqbal &
   Horvitz) shows interruptions delivered at task boundaries cost far less
   to recover from than mid-task ones. Non-critical attention signals
   accumulate quietly while the operator is actively typing in a focused
   session and present when they pause or switch; explicit bells stay
   immediate.

6. **One status grammar, redundantly coded.** A single visual language for
   agent state across tab strip, exposé, switcher, board, and map: color +
   icon + motion encode each state redundantly (colorblind-safe, readable
   in peripheral vision). The operator's peripheral vision becomes a
   monitoring instrument — glancing costs nothing.

7. **Earcons (exploratory, off by default).** Subtle per-initiative sound
   signatures for attention events, so audition carries part of the
   monitoring load. High risk of annoyance; behind a setting if ever.

8. **Switch-cost telemetry (exploratory).** Local-only counts of context
   switches and dwell times to tune defaults (badge thresholds, recap
   trigger time). Only if it stays invisible and local.

## Command-altitude continuum (accepted 2026-07-10)

The terminal workspace and AgentField keep deliberately distinct jobs, visual
identities, routes, and renderers, but navigation presents them as one command
altitude continuum:

1. **Terminal Focus (near):** the active xterm session and direct conversation.
2. **Session Overview (middle):** exposé tiles for live-session orientation.
3. **Spatial Command (far):** Project/Agent fleet state and attention routing.

The desktop app shell must show all three levels persistently on both terminal
and spatial routes. Each level is one click away, the current level is explicit,
and the control teaches the absolute `⌘1` Terminal, `⌘2` Sessions, and
`⌘3` Spatial destinations. `/workspace?view=sessions` is the durable
middle-level address; entering
or leaving it must not recreate PTYs. Motion should explain the terminal
receding into overview, use only transform/opacity, and crossfade rather than
translate under reduced motion.

Acceptance: a first-time Electron operator can discover Spatial without the
help modal or bottom hint, click Terminal → Sessions → Spatial and back, use the
same shortcuts while xterm owns focus, and retain all running sessions. This is
a navigation unification, not permission to couple xterm and R3F internals.

Implementation record (landed 2026-07-10):

- The shared Electron title bar renders a three-level altitude rail on both
  command routes. Each level has an explicit label, semantic icon, current-page
  state, direct click target, and visible shortcut where applicable. The prior
  duplicate Workspace link is suppressed only when this richer Electron control
  is present; hosted/web navigation remains unchanged.
- Session Overview is URL-backed at `/workspace?view=sessions`. Clicking the
  rail, `⌘2`, Escape, and selecting a session synchronize the same state.
  The terminal stage recedes through finite scale/opacity motion; reduced-motion
  keeps the de-emphasis but removes spatial scaling. A useful empty overview
  teaches how to populate the altitude.
- Pure route tests cover all three levels and unrelated routes. The headless
  Electron-mode evaluator covers click navigation, current-state semantics,
  normal/reduced motion, and the two-way shortcut. A real isolated Electron
  smoke launches a shell, traverses Terminal → Sessions → Spatial, returns with
  `⌘1`, and verifies that the live PTY remains present.
- Verification: focused lint and type-check pass; all 267 tests pass; Electron
  compile and production Next build pass; both navigation evaluators pass; the
  full Spatial desktop/mobile/reduced-motion/low-power battery remains green.

## Findings log

- 2026-08-07 (S6 pairing, operator): "we should pair all the Team-view UI
  work / bugs / enhancements together. I'm thinking of the up/down arrows
  suggestion." Four open rows are Team surface — FIX-002 (arrows), FIX-006
  (title input), FIX-008 (float active Agents forward), FIX-005 plus S4.1's
  unshipped goal-visual language — and they now travel as one pass rather
  than four small-fixes landing separately into the same component.

  **FIX-002 and FIX-006 are one defect, confirmed by reading before the pass
  starts.** Both live in `expose-overlay.tsx`'s `onKeyDown`:

  - Movement is `±1` over a flat `items` array, so Up/Down and Left/Right all
    step through one list. The tile layout is a 2-D grid and promises rows and
    columns; the keyboard delivers a sequence. That is FIX-002 exactly, and
    the operator's framing — "matching what the 2-D tile layout visually
    promises" — is a request for the keyboard to agree with the geometry.
  - The handler yields to `[data-roadmap-rail]` and to nothing else. There is
    no text-entry guard, so inside a tile's agent-title field plain `j`/`k`
    are `preventDefault`ed into tile movement (they are the D9 list-navigation
    mirror of down/up), `Enter` runs `onPick` and navigates away instead of
    committing the rename, and `Escape` closes the whole overlay instead of
    cancelling the edit. That is FIX-006's "takes focus but no characters",
    and the 2026-08-04 triage note guessed the mechanism correctly — "check
    whether a parent key handler … is swallowing keystrokes before the input
    sees them."

  So the subject of the pass is not four fixes; it is that the Team grid has
  no keyboard owner. It needs one that knows its own geometry and yields to
  text entry — the same shape as ENG-016 D51's attention rule, where the
  defect was two consumers restating a contract nobody had written down.

  FIX-008 lands on the same grid from the other side: it asks the grid to
  REORDER. That raises the question the design pass must answer with the
  operator rather than assume — whether Team ordering is a view mode, a
  transient filter, or a sort; what "active" means (working now, recently
  mine, or needs-you); and whether Team may reorder Agents at all without
  contradicting the durable manual arrangement ENG-016 D20/D45 made
  load-bearing one altitude down. A sort that silently fights the ribbon's
  order would trade one orientation problem for a worse one.

  **S6.1 landed 2026-08-07 — the half that needed no design pass.** Arrows
  now move by measured tile geometry (`team-grid-nav.ts`, pure and unit
  tested): Up/Down take the nearest row and then the nearest column inside
  it, Left/Right stay in the row, and a row edge falls through to reading
  order so no tile becomes a dead end the operator has to escape with a
  different key. Rows are discovered by VERTICAL OVERLAP rather than a column
  count, which is what makes the awkward cases free — a ragged last row, the
  full-width row an empty Project contributes, a card taller than its
  neighbours, and the boundary between two Projects are all just "the nearest
  row". A column count would have been a second, weaker model of a layout CSS
  has already solved, and it would have had to be re-derived every time the
  rail docks or the window resizes. The bridge measures at keypress rather
  than tracking rects, because the only thing that can be wrong is a stale
  one; where there is no layout to measure (jsdom, any non-visual host) it
  falls back to reading order so the behaviour stays defined.

  The yield rule shipped with it: the grid now hands every key to a focused
  control that owns text or its own activation. FIX-006's specific field
  turned out not to exist — D49 deleted the "Optional name" input it was
  almost certainly seen on — so that row is recorded as PREVENTED rather than
  fixed. The honest version of this is worth keeping: the reported symptom
  was never reproduced on a current build, but the cause the triage note
  guessed was real and is now closed as a class.

  Both halves are pinned by tests that fail without them (verified by
  sabotage), which matters here because neither is visible in a screenshot.

  Method for the pass, per the operator's standing preference: iterate on the
  bench with screenshots and clarifying questions on taste before wiring
  anything into the production surface, and keep the DOM specimen honest —
  Team tiles are DOM, so no R3F sibling is owed.

- 2026-08-04 (operator quick capture, triaged from `product_feedback`):
  - **Team arrow keys should move spatially (`d74f5009`, FIX-002, queued).** In
    the Team altitude (`/workspace?view=sessions`), Up/Down currently step
    next/previous through the flat session order. The operator wants spatial
    movement: Up/Down moves between grid rows, Left/Right within a row —
    matching what the 2-D tile layout visually promises.
  - **Agent worked-for and idle-for durations (`ffa2db86`, idea, evidence for
    S1.1/S4 — not yet queued).** The operator wants a first-party, subtle
    per-session readout of how long the agent's last turn ran (harnesses
    already surface it, e.g. Claude Code's "✻ Cogitated for 38m 47s") plus how
    long the session has been idle since, with the exact timestamp on hover.
    Hard constraint from the capture: only show it if the value is trustworthy
    — S1.1's reported turn boundaries are the honest source, and inferred
    turns must not masquerade as measured durations. Keep copy minimal; this
    surface is already fighting text overload.

- 2026-08-04 (partner conversation `2026-08-04-dan-rosenberg`, routed as
  feedback by the operator — evidence for S4.1, not a decision):
  - **A first-time viewer read the goal-visual backdrops as noise.** Dan
    Rosenberg saw the landed S4.1 tiles cold and returned to them unprompted
    three times: "the backgrounds are harder to follow… for me they're not
    really saying much, they're kind of just visual noise", "the background
    being random is making it harder for me to pop", and — the sharpest one —
    "it makes me want to look for a meaning in them." An image that invites a
    search for meaning it does not carry costs attention rather than restoring
    it, which is the opposite of the S4 context-paging job. His alternative:
    a symbol or emoji, "a little clearer and easier to see", and color as the
    primary differentiator BEFORE imagery ("before you do image, I would focus
    on color… okay, green means this, red means that"). Note this was the
    abstract-landscape v2 language, before the operator's 2026-08-04 Graphic
    Form pick — Graphic Form is a partial answer to exactly this objection, so
    the fair test is to re-run a cold viewer against the shipped language
    rather than treat the objection as already answered or already fatal.
  - **What survives the objection is the mechanism, not the goal.** The
    operator's rationale is recognition-over-recall — "if you see Alice in the
    hallway, your brain instantly remembers she's working on this thing" — and
    that is untouched. The falsifiable claim S4.1 still owes evidence for is
    that a GENERATED IMAGE is the artifact which does it; per-tile color and a
    stable symbol are the cheaper rivals and have never been tried head to
    head. The operator's own dogfood remains the deciding evidence (he is the
    one paging between eight to ten contexts; Dan saw the tiles once), but a
    cold viewer finding them noise is real signal against the imagery arm.
  - **Keep the system loose.** Dan's structural note, worth holding for
    whatever wins: "if there's a way down the road to keep this as loose and
    open-ended as possible" — Notion-style, where an operator builds the
    tagging/color scheme that works for them — "because inevitably someone is
    going to say I don't like working that way."

- 2026-08-04 (partner conversation `2026-08-04-kevin-ridsdale`):
  - **Bell icons and sound alerts fail as attention signals (evidence for
    S1).** Kevin has built both a bell-icon tab badge and audio alerts in his
    own tooling and reports "neither of them really work"; he recommends a
    solid whole-tab color change instead. Independent corroboration that S1's
    badge/sound channel may undershoot — worth a deliberate look at
    higher-contrast tab-level color as the primary needs-you signal.
  - **Evaluate Nano Banana for goal visuals (FIX-005, queued, S4.1).** Kevin
    flagged a new hyper-fast Nano Banana variant as likely faster/cheaper and
    higher quality than the current server-side `fal-ai/fast-sdxl` prototype
    behind S4.1's tile backdrops. Bounded evaluation: quality at the chosen
    visual language, latency vs the ~200ms budget, cost, and whether the
    private goal-to-scene derivation boundary (FAL never sees goal text)
    survives the provider swap.

## Progress log

S5 Durable Projects (P1–P5 landed 2026-07-10):

- P1 rename `Initiative`→`Project` (workspace cluster; canon `Initiative`/goal
  untouched) + `ignite`→`launch` across code and plans; `workspace.json` v1→v2
  migration preserves saved layouts.
- P2 reclaimed the `projects` table for the canonical registry (legacy demo →
  `demo_projects`, queries repointed via a PostgREST embed alias); migration
  applied to prod and verified; typed browser-client accessors
  (`src/lib/projects/registry.ts`).
- P3 resolution bridge: launching best-effort registers/refreshes the Project
  by resolved root path. Identity/color sync landed: reconcile-on-load +
  launch adopt the registry's synced name/color, and rename/recolor write back
  (all best-effort, non-blocking).
- P4 open/browse: `dialog:openDirectory` IPC + 📁 Browse control, ⌘N "new
  project", and a ⌘K **Projects** group (open a known Project even with no live
  session — activate if live, else launch a shell).
- P5 missing-dir: `dialog:pathExists` + registry `rebindProjectPath` power a
  "locate on this machine" flow when a synced Project's directory is absent
  here. Decision record `0010`.
- Test infra: a minted-session `TestAuthBridge` + `EXAWATT_TEST_DIR` dialog
  hook make the OAuth/native-dialog paths auto-testable. Verified: type-check,
  lint, tests, build; the full ⌘N → shell → registry-write E2E passes against
  the real DB (`scripts/registry-e2e-eval.mjs`). Both hooks inert in prod.

S4 re-entry recap, first slice (landed 2026-07-10):

- Main-process scrollback now carries absolute cursors across bounded-buffer
  trimming. Leaving a tab or the app records a cursor and time; returning
  consumes only output produced since that checkpoint.
- `ContextSummarizer` adds a delta-specific prompt behind the existing
  authenticated CLI, global one-call limit, timeout, and failure cutoff. The
  default trigger is two minutes away plus 200 cleaned characters; both are
  environment-tunable for dogfood.
- Recaps are deliberately quiet: no background completion event. A compact
  "While you were away" card appears only over the active session, includes
  the existing micro-context when available, never steals focus, and
  disappears on the first keystroke without consuming it.
- Human typing gained an explicit `pty:engage` signal from xterm `onKey`.
  Raw `pty:write` cannot cancel a recap because it also carries automatic
  terminal protocol replies; conflating the two made the first live smoke
  suppress valid recaps.
- Stale work is guarded at both ends: typing, switching, or losing focus while
  generation is pending invalidates the result, and the renderer accepts a
  recap only for its current active session.
- Verified: 236 unit/component tests, type-check, lint, Electron compile,
  production Next build, and a live two-session Electron smoke with screenshot
  review and first-key dismissal.

S4 post-land review (2026-07-10):

- Explicit input now carries a per-session version, so a keystroke that beats
  asynchronous focus IPC still suppresses the pending recap. An exiting
  session also invalidates its in-flight recap instead of publishing stale UI.
- The summary sweep interval clamps to one second; an explicit zero can no
  longer create a hot timer.
- Regression coverage exercises early input, mid-generation exit, and the
  interval floor. Full verification after rebasing current `master`: 250 tests, lint,
  type-check, Electron compile, production build, and live Electron font
  refresh/sizing smoke.

S3 Exposé, motion & discoverability (landed 2026-07-10, dogfood round 4):

- ⌘O exposé (`expose-overlay.tsx`): every live session as a tile —
  project-color frame, harness mark, title, project, micro-context,
  needs-you pulse, and the LAST LINES of scrollback (`scrollback-preview.ts`,
  ANSI-stripped incl. private-byte CSI like kitty's `ESC [ > 4;1 m` —
  found leaking into previews on the first screenshot pass). Arrows move
  (column-aware), Enter/click drop in, Esc/⌘O close, focus returns to the
  terminal. Stable slots (spatial memory), staggered entrance, reduced-
  motion respected. role=dialog so workspace ⌘-verbs are guarded while
  open.
- Discoverability (the "how is this better than tmux" answer): a slim
  bottom key-hint bar (⌘K/⌘O/⌘T/⌘D/⌘J/⌘E/⌘⇧M/⌘/) mirroring the spatial
  map's legend, the same hints in the empty state, and a Workspace group
  in ⌘K (overview / rename / change color / split / jump to needs-you /
  close tab / switch to map) — each row fires the same event its chord
  does, with the chord shown.
- Round-4 fixes: app forced dark (`<html class="dark">` — the ⌘K palette
  was following OS light mode over the dark HUD); Next devIndicators off;
  the action word became "launch" in the UI ("+ Claude Code" buttons, "Launch
  a new … session in …" tooltips, "New Claude Code session in the active
  project" palette rows; the internal code term was later unified to "launch"
  to match in S5); tab hover/pressed
  feedback (brightness lift, press scale, close-× reveals on hover).
- Terminal font setting: `<userData>/settings.json` →
  `{ terminal: { fontFamily, fontSize, lineHeight, letterSpacing, fontStrokeWidth } }` (main: settings-store.ts,
  `settings:get` IPC); panes are born with the effective font, refresh it
  after app refocus, and use it for spawn estimates. Root cause of the
  operator's mismatch:
  Terminal.app profile "Jake" runs MesloLGS for Powerline 14 vs our
  SF Mono 13 — their local settings.json now carries Meslo 14 at
  lineHeight 1.0 (Terminal.app uses the font's OWN metrics; Meslo LG
  variants tune the gap internally, so 1.25 reads visibly taller); the
  CODE default stays the native stack (genericize rule). Exercised
  end-to-end in the smoke (test userData settings.json → xterm options).
  GOTCHA (found in dogfood round 5): the dev app's userData is
  `~/Library/Application Support/exawatt` (package.json name), NOT
  `.../Electron` — a settings.json in the wrong dir silently does
  nothing. The second mismatch was lifecycle: settings were cached for the
  renderer lifetime and existing xterms never updated, so an override written
  during dogfood appeared broken until a full app restart. Existing panes now
  update on app refocus. Dogfood round 6 corrected the earlier metric-only
  verification: although both surfaces select
  `MesloLGSForPowerline-Regular` at 14 with an 18px line box, Terminal.app
  quantizes its cell advance to 8 points while xterm retained the font's
  8.427px fractional advance. The inherited app-wide grayscale smoothing
  also made xterm visibly thinner. Terminal panes now restore platform text
  smoothing, and `letterSpacing` lets the operator align Chromium's cell
  grid with the native terminal (`-1` on this Retina Mac).
- Dogfood round 6 verification: an identical native Terminal.app/xterm glyph
  sample at 2x scale, live computed-style and xterm-dimension inspection, 255
  tests, lint, type-check, Electron compile, and the production Next build.
- Dogfood round 7 corrected the remaining perceived-weight mismatch. CoreText
  puts more ink into Meslo Regular than Chromium/Skia; CSS weights through 550
  still select the unchanged Regular file and 600 jumps to the much heavier
  Bold file. A personal `fontStrokeWidth` setting provides controlled subpixel
  emboldening without changing the face. Direct Retina screenshot calibration
  selected `0.15px` for this Mac (within 0.5% of Terminal.app's measured glyph
  coverage); the cross-platform default remains zero. Verified through the
  real settings → main IPC → React → computed CSS path, plus 263 tests, lint,
  type-check, Electron compile, and the production Next build.
- The same round removed the HUD-blue tint from normal terminal text. Default
  foreground and ANSI white are neutral `#F4F4F4` for stronger contrast and
  native-terminal readability; Exawatt accent colors remain in chrome,
  cursor, selection, and semantic ANSI colors.
- Executed in an own git worktree per the new operator workflow rule
  (parallel agents share this repo).
- Verified: 226 unit tests (5 new preview tests incl. the private-byte
  CSI regression), type-check, lint, electron compile, 11/11 live smoke
  from the worktree's own dev server (hint bar, forced dark, live font
  setting, exposé open/navigate/enter, dark palette, palette split
  pin+unpin, launch wording), screenshots reviewed.

S2 Command velocity (landed 2026-07-09):

- ⌘K session switcher: the palette gains a Sessions group — every live
  session with its project-colored diamond, harness mark, title, project,
  micro-context subtitle, and a live one-word status (needs you / working
  / idle / exited; needs-you rows first, oldest flag first, then by output
  recency). Fuzzy-matches on title + project + micro-context. Pure row
  logic in `switcher-rows.ts` (unit-tested); `lastDataAt` added to
  PtySessionInfo for the working/idle read.
- Palette ↔ workspace plumbing (`session-jump.ts`): requests travel as a
  window event (workspace mounted) AND a pending slot consumed on mount
  (palette → navigate → mount), so switching works from any route.
- Palette launch commands: "Launch Claude Code / Codex / Shell here" land
  in the active initiative via the same channel; `launchHere()` is now the
  one dir-resolution path (⌘T, palette, events).
- ⌘K/⌘/ are RE-BOUND in the workspace key layer: the global chord engine
  ignores keystrokes from inside xterm's hidden textarea, so palette and
  cheat-sheet must be reachable from where the operator lives. Workspace
  verbs now also skip keystrokes owned by an open dialog (⌘W in the
  palette must not close a terminal tab).
- ⌘D split panes: pins the active tab; whatever you switch to renders LEFT
  (driven, keyboard) beside the pinned tab RIGHT (watched) — cross-project
  splits included; ⌘D unpins; pin survives restarts (persisted with the
  layout, pruned when the tab closes); ◧ marker in the strip; panes stay
  absolutely positioned so the existing ResizeObserver/fit path absorbs
  the geometry change; clicking the watched pane activates it.
- ⌘E renames the active tab inline (same editor + swatches as
  double-click).
- ⌘/ cheat-sheet: help modal gains a static Terminal Workspace section
  (the workspace chords are handled outside the registry — registering
  them would double-fire); ⌘/ also bound globally.
- Launch-controls fix (found by the smoke): an launch resolving no longer
  clobbers a directory typed while the spawn was in flight (edit-sequence
  guard).
- Verified: 220 unit tests (6 new switcher-row tests), type-check, lint,
  electron compile, 12/12 live Playwright smoke (switcher from inside a
  terminal, filter → cross-project jump, palette launch, split geometry
  50/50, unsplit, ⌘E rename, ⌘/ sheet), screenshots reviewed.
- Known follow-up: the palette dialog still wears the light shadcn theme —
  jarring over the dark HUD; restyle in S3 (exposé & motion / chrome
  pass).

S2 review round (high, workflow, 10 findings — all fixed 2026-07-10):

- Split structural fixes: clicking the watched pane no longer collapses
  the split — the split pair is now (companion = last active non-pinned
  tab) LEFT + pinned RIGHT, so activating the pinned pane just moves the
  keyboard (you can finally copy out of it); hidden panes FREEZE their PTY
  size (an invisible element keeps full-container geometry, so every tab
  switch was SIGWINCHing background sessions to the wrong width and
  garbling TUI scrollback — reveal refits).
- Palette↔workspace protocol: requests now defer until the workspace is
  `ready` (an launch selected during initial load errored spuriously and
  was lost); consumed-when-ready even on failure; pending slots carry a
  15s TTL so a slot surviving an unmount can't yank the workspace to an
  old session minutes later.
- Palette: session rows reset on close (stale rows listed dead sessions on
  reopen and Enter on one did nothing).
- ⌘D on a dead pin now pins the current tab (was: silently consumed the
  press clearing an invisible stale pin).
- Branch field gained the same in-flight edit guard as the dir field.
- Rename commit/cancel hands focus back to the active terminal (⌘E flow
  left the keyboard on <body>).
- ⌘K/⌘/ in the workspace layer resolve from the shortcut registry (user
  rebinds now work inside terminals too).
- Switcher sort: an exited session with a stale attention flag sorts by
  recency among exited rows (was: epoch-vs-negated-ms key mixing).
- Re-verified: 221 unit tests, type-check, lint, electron compile, 13/13
  live smoke (new check: clicking the watched pane keeps the split).

S3 review round (high, workflow, 10 findings — all fixed 2026-07-10):

- CRLF handling: stripAnsi turned \r\n into DOUBLE newlines, so every
  exposé preview rendered sparse with bogus blank lines (PTY scrollback is
  CRLF) — fixed in the preview AND the context summarizer.
- Font/revive race: auto-revive could spawn PTYs with DEFAULT cell metrics
  while a custom font was still loading — the exact init-width race the
  spawn estimate exists to kill. Font resolution moved to a shared
  `terminal-font.ts` loader; the revive path AWAITS the same promise the
  render gate uses.
- Exposé modality: the overlay covered only the panes area — the tab strip
  stayed clickable underneath, switching terminals invisibly. Now mounted
  at the workspace root; backdrop click closes.
- Exposé selection starts on the ACTIVE session (⌘O → Enter returns you
  where you were; it jumped to tile 0 before), stays clamped when sessions
  exit while open, previews fetch for tiles that appear mid-open (revive),
  and the column math no longer undercounts (trailing-gap off-by-one).
- Palette "Overview" honors the same no-sessions guard as ⌘O (was: dead
  dark screen on an empty workspace).
- Forced dark now sets `color-scheme: dark` — native scrollbars, form
  controls, and autofill follow the app instead of a light OS.
- Close-× regains visibility on keyboard focus (hover-only reveal broke
  the keyboard path).
- Re-verified: 227 unit tests, type-check, lint, electron compile, 12/12
  live smoke (new checks: overview starts on the active session).

S1 Attention system (landed 2026-07-06):

- `electron/main/pty/attention-monitor.ts`: pure-Node detection engine over
  the manager's data stream. Bell class: raw BEL and OSC 9 / OSC 777
  notifications — with an OSC-aware scanner, because BEL also TERMINATES
  OSC sequences (every title update ends in one); sequences split across
  chunks are carried per-session (bounded) and re-scanned, including the
  `ESC` / `]` split landing exactly on a chunk boundary. Turn-end class
  (harness sessions only, shells are bell-only): a work burst
  (≥ EXAWATT_ATTENTION_MIN_BURST raw bytes, default 600) followed by
  quiescence (≥ EXAWATT_ATTENTION_QUIET_MS, default 4000) flags "may need
  you"; the burst is consumed at the boundary either way (no re-flag
  loops); a 20s spawn grace keeps auto-revived tabs from lighting up en
  masse at app start. EXAWATT_ATTENTION=0 disables. 16 unit tests.
- Focus contract: "looked at" = the session's tab is active AND the app
  window has OS focus (`pty:focus` from the renderer + browser-window-
  focus/blur in main). The watched session never flags; looking clears;
  typing while looking clears. The active tab behind another app STILL
  flags — the single-tab case this system exists for.
- Surfaces: pulsing amber dot on the tab + amber count on the initiative
  chip; ⌘J jumps to the OLDEST flagged session (repeat walks the queue —
  each focus clears, surfacing the next); macOS dock badge carries the
  count and bounces once when the app is unfocused.
- Fleet truth: `attention` rides `pty:list` into LocalSessionsTransport —
  an alive flagged session maps to status 'blocked' + `blockerInfo`
  (input_needed), so board and map show the SAME needs-you truth as the
  tab strip. Closes the W0.3 honesty note (quiet-but-waiting ≠ idle).
- Regime switching (operator ask, same day): ⌘⇧M flips terminal workspace
  ↔ spatial map from anywhere, both directions — bound in the workspace
  key layer (terminals swallow chord-engine keydowns) AND as a global
  shortcut (`toggle-regime`, shows in the ⌘K help modal); both compute the
  same target so double-fire is idempotent.
- Infra: vitest config gained an `app` project — the packages/\* glob had
  silently skipped ALL src/ + electron/ tests (extends concatenates
  includes, so packages are excluded there to avoid double runs).
- Verified: 210 unit tests (16 monitor + 3 fleet-mapping new), type-check,
  lint, electron compile, and a 13/13 live Playwright smoke against the
  real app: bell in an unfocused tab → badge + group count + dock "1" →
  ⌘J selects it and clears everywhere (renderer, main, dock) → ⌘⇧M to the
  map (both real sessions render as sector nodes, Live badge) → ⌘⇧M back,
  sessions intact, zero page errors. Screenshot-verified badge chrome.
- Known follow-up (S-later): turn-end thresholds need dogfood tuning
  against real Claude Code rhythm; notification text from OSC payloads is
  captured as a bell but not yet surfaced as the reason string.

Review round (high, workflow, 10 findings — all fixed same day):

- Window-focus blindness (the big one): the active tab suppressed flags
  even with the app backgrounded — the single-tab "operator in a browser"
  case never flagged. Fixed: "looked at" = active tab AND OS window focus
  (browser-window-focus/blur wired in main; renderer optimistic clear
  gated on document.hasFocus()).
- xterm auto-replies (cursor/device queries answered by hidden panes,
  backlog replay) cleared flags via `pty:write` with zero operator
  engagement. Fixed: input only clears the WATCHED session.
- Stale 'blocked': a flagged session that resumed streaming stayed blocked
  forever on the fleet surfaces. Fixed: substantial post-flag output
  (≥ minBurst) self-clears — a bell mid-run is not a blocker; the resumed
  burst re-flags at its own quiet boundary.
- Phantom bells: capping an oversized split OSC (8KB OSC 52 clipboard,
  OSC 1337 images) dropped the ESC ] introducer, so the terminator BEL
  read as a real bell. Fixed: the introducer survives the cap.
- ⌘⇧M double-push (duplicate history entry when both key layers saw the
  chord): both the workspace layer and the chord engine now skip
  `defaultPrevented` events.
- Seeding race re-adding cleared flags on reload: clears observed between
  the pty:list snapshot and the seed merge now tombstone the id.
- `Number(env) || default` silently discarded an explicit 0: envInt()
  honors 0.
- Cleanup: test files excluded from the electron production build
  (`**/*.test.ts` in electron/tsconfig exclude; stale dist artifacts
  removed); vitest root include removed so each project's include actually
  governs; preload's four copy-pasted IPC subscribe wrappers collapsed
  into one generic `subscribe<T>(channel)` factory.
- Re-verified after fixes: 214 unit tests (20 monitor — 4 new regression
  cases), type-check, electron compile, 13/13 live smoke re-run.

## Roadmap milestone log (moved from roadmap.md, 2026-07-24)

On 2026-07-24 `docs/engineering/roadmap.md` was compressed to its contract —
status, concise scope, exit criteria, a one-line milestone list, and links —
so the top-level sequence is readable in one screen. The milestone narratives
and status history that lived in the roadmap until that date are preserved
verbatim below, exactly as written, including their dates. The roadmap remains
canonical for sequence and status; this log is the durable execution detail it
points to. Nothing here is new material: it is the ENG-015 roadmap entry as it
stood on 2026-07-24.

<!-- Verbatim: docs/engineering/roadmap.md ENG-015 entry, 2026-07-24. Do not reword. -->

### ENG-015 Stellar small-fleet command (1–10 agents)

Status: active-build — created 2026-07-06 (operator): before any long-arc work, the UI for operating one to ten agents must be stellar, top-notch. Grows directly out of ENG-002 parity; the investment target is the TERMINAL regime as the approachable daily driver.

Divergence direction (operator, 2026-07-06; navigation amended 2026-07-10): the two UI regimes deliberately keep distinct jobs and visual identities. The terminal workspace stays a "solid, robust, approachable" AI-native tmux++ sized for 1–10 agents; AgentField evolves separately toward an RTS-style command map at fleet scale. They are now one **command-altitude continuum for navigation**: Terminal Focus is near, Session Overview / exposé is the middle altitude, and Spatial Command is far. This joins orientation and movement, not rendering architecture—the terminal remains DOM/xterm, the field remains R3F, and both remain long-lived regimes over the same session system.

Scope (the four excellence phases):

- attention: harness-aware "this agent needs you" detection (bell/notify sequences + turn-boundary quiescence), badges, an attention queue with a jump key, macOS dock signals — and the same truth mirrored into FleetState so every surface agrees
- command-altitude navigation: a persistent, visible Terminal → Sessions → Spatial control in the Electron shell; each altitude is one click or one absolute shortcut away (`⌃⌘1`, `⌃⌘2`, `⌃⌘3` since ENG-016 D19) from terminal focus, Sessions, Spatial search, and xterm input
- command velocity: keyboard-first everything — global fuzzy session switcher, split panes, complete no-mouse coverage of daily actions, shortcut discoverability
- exposé & motion: game-feel in the terminal regime — a zoomable live-tile overview of all sessions, animated switching, depth/motion in the chrome (reduced-motion respected)
- context paging: research-backed support for swapping human working memory between dramatically different contexts — visual identity anchors (per-initiative generated emblems), re-entry recaps, "while you were away" delta digests, stable spatial addresses, boundary-batched interruptions; idea bank in the project doc
- generic for any user (no operator-bespoke tuning); personal taste routes to future settings

Exit criteria:

- running 5–10 parallel agents daily, no stalled or asking agent goes unnoticed for more than a few seconds
- every daily action is keyboard-reachable; reaching any session takes ≲2 keystrokes via the switcher
- the overview → focus → overview loop feels game-quality (motion, depth, zero jank)
- after switching initiatives, "where was I here?" answers itself in ~2 seconds without reading scrollback
- the operator judges the daily-driver experience stellar (subjective bar is the real bar)

Milestones:

- S1 Attention system (landed 2026-07-06): needs-you detection in the PTY layer (BEL / OSC 9 / OSC 777 + work-burst-then-quiescence state machine for harness sessions, env-tunable thresholds), pulsing tab badges + initiative counts, oldest-first ⌘J attention queue, dock badge/bounce when the app is unfocused, attention mapped into FleetState as 'blocked' + blockerInfo, and ⌘⇧M two-way regime switching. Turn-boundary thresholds expect dogfood tuning.
- S2 Command velocity (landed 2026-07-09): ⌘K session switcher (fuzzy over name/project/micro-context, live status rows, needs-you first, works from inside terminals), palette launch commands, ⌘D split panes (pin one, drive the other, persisted), ⌘E inline rename, ⌘/ cheat-sheet incl. the workspace chords, no-mouse coverage of every daily verb.
- S3 Exposé, motion & discoverability (landed 2026-07-10 — reshaped same day from operator dogfood round 4): the workspace must SHOW its powers — "how is this better than tmux" must answer itself on first look. ⌘O exposé overview (sessions as rich tiles: project color, harness mark, micro-context, needs-you pulse, live scrollback preview; keyboard-driven, staggered entrance, reduced-motion respected), a persistent bottom key-hint bar (mirrors the spatial map's legend, also in the empty state), workspace verbs (overview / rename / color / split / jump / close / map) in the ⌘K palette with their chords, hover/pressed states on tabs, app-wide forced dark theme (palette/dialogs no longer follow OS light mode), clearer action language ("+ Claude Code" buttons, "launch" tooltips — "launch" stays internal), Next devIndicators off, and terminal typography settings (userData settings.json → xterm + spawn estimates; family, size, line height, cell spacing, and raster weight correction; operator's Meslo 14 configured locally; the DEFAULT stays the native stack per the genericize rule). Normal terminal text is neutral near-white rather than HUD-tinted; accents stay in chrome and semantic colors. Pane-content switch animation deliberately skipped: terminals + motion = reflow jank; motion lives in the chrome.
- S3.1 Command-altitude continuum (landed 2026-07-10; absolute-key refinement landed 2026-07-12): promoted the prior exposé/AgentField question into a navigation decision. The Electron title bar persistently exposes Terminal → Sessions → Spatial on both `/workspace` and `/fleet/spatial`; D12 replaces the contextual `⌘O` / `⌘⇧M` toggles with absolute `⌘1` / `⌘2` / `⌘3` destinations. `/workspace?view=sessions` deep-links the middle altitude without restarting PTYs; terminal content visibly recedes into exposé with reduced-motion crossfade parity; and automated browser plus real-Electron round trips prove a live shell survives the route/shortcut cycle. DOM/xterm and R3F runtime boundaries remain distinct.
- S4 Context paging (active-build): start with a quiet re-entry experience — re-entry recap card and delta digests (summarizer evolves from "what is happening" to "what changed since you last looked") — then evaluate per-initiative generated emblems and stable spatial addresses. Notification delivery starts less noisy: ordinary progress and successful completion stay ambient or wait for a natural pause; stopped work that needs input or hit an error may signal without stealing focus. Treat this policy as a dogfood hypothesis, not a permanent rule. First slice landed 2026-07-10: main-process last-visit checkpoints and delta-only recap generation feed a non-modal active-session card; dogfood tuning determines the next slice. AMENDED 2026-07-20 (operator dogfood): the floating recap card failed its hypothesis — it lands seconds after the operator has already started reading and demands a dismissal. The popup is retired; recap delivery moves ambient (inline in the context bar, no dismissal debt) under ENG-016 D18. The summarizer seam and the context-paging direction remain canonical.
- S5 Durable Projects (landed 2026-07-10; interaction model amended 2026-07-12 by ENG-016 D14 and decision `0013`): rename, Supabase registry + `projects` reclaim migration applied to prod, resolution bridge, missing-dir locate, and synced identity/color remain the durable base. D14 completes the missing lifecycle boundary: `⌘N` opens a curated Exawatt chooser, opening a Project is inert, zero-Session Projects persist, closing the last tab no longer forgets the Project, and optional one-level parent-folder import is explicitly reviewed. The registry remains shared truth; local workspace state remains the offline fallback.

Sequencing: precedes ENG-003 and all long-arc items (operator, 2026-07-06: excellence at 1–10 before the long arc).

Project doc:

- `docs/engineering/projects/stellar-small-fleet.md`
