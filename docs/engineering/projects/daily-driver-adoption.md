<!-- Generated for the public repository by the "public-document-set" recipe. -->
# Daily-Driver Adoption

Roadmap item: ENG-016

## Outcome

The operator replaces Terminal.app for daily Claude Code and Codex work without
slowing engineering down to run a separate dogfood phase. Exawatt is an
installed, self-contained Mac app; each tab has a truthful process state and an
exact harness conversation identity; terminal basics work; and the product
chrome is clear enough to trust all day.

Dogfood is a parallel evidence stream, not a calendar gate. Engineering keeps
shipping while the operator uses each installed build and records fallbacks.

Source: operator dogfood interviews, 2026-07-10. Durable product conclusions
are in `docs/product/operator-workflow.md`.

## Fixed decisions

- **The installed app owns its UI.** Production Electron must load renderer
  code packaged with the same app build, not `https://exawatt.ai`. The hosted
  interface remains a separate future delivery surface. Remote content never
  receives the privileged PTY preload bridge.
- **One-command local delivery now.** No LaunchAgent or other background build
  service. The coding agent that lands work on `master` runs the local install
  command during closeout. The command captures one committed source SHA, builds
  it in a detached immutable worktree, validates the result, then atomically
  exchanges `/Applications/Exawatt.app` with same-volume staging. Repository
  delivery and install-target locks serialize concurrent agents and clones; an
  interrupted exchange is recovered on the next run. A running app is never
  quit; it keeps its loaded version and shows a subtle
  restart-when-convenient notice.
- **Dogfood gets a stable application identity.** D17 replaces identity-null,
  ad-hoc local installs with a stable, verifiable code identity. The local path
  remains development-only and need not become a second notarized distribution
  channel, but it must stop invalidating identity-based network policy across
  source refreshes. Eligibility is pinned to Exawatt's public Team Identifier,
  and verification includes secure timestamps and hardened runtime as well as
  every nested native code object. Missing or wrong-Team signing capability
  fails explicitly; it never silently falls back to an identity-unstable app.
- **Idiomatic updates are active.** Signed and notarized CI artifacts plus the
  public update feed and `electron-updater` are the normal product mechanism.
  The local copy step remains a development escape hatch, not the distribution
  architecture.
- **Resume by exact identity only.** Every Exawatt tab stores its harness's
  exact conversation/session ID. Claude resumes with `--resume <id>`; Codex
  resumes with `codex resume <id>`. `--continue`, `--last`, newest-file guesses,
  and cwd-only matching are forbidden. Four tabs in one Project must restore
  four distinct IDs and resume those same four conversations.
- **No silent revival.** Relaunch restores layout, scrollback, and ended/live
  state first. It resumes a process only when Exawatt has an exact saved ID and
  the user asks to resume that tab, Project, or all eligible tabs. If identity
  cannot be proven, Exawatt offers an explicit picker or a fresh session.
- **Dogfood never stops the queue.** The operator dogfoods installed builds
  while implementation continues through the remaining blockers.
- **Projects open inertly; Agents start deliberately.** `Command-N` chooses
  from a curated Project library with Browse and reviewed parent-folder import.
  Selection never spawns. A compact composer starts a Claude Code or Codex
  Session with an optional first task and a visible, automatically remembered
  per-Project source. Shell is a secondary tool. This is a dogfood hypothesis,
  not a permanent provider or attach/resume policy (decision `0013`).

## Ownership boundaries

- Durable Project registry, folder browsing, Project switching, and the
  Initiative-to-Project code rename remain in ENG-015 Durable Projects. They
  may land during this project but do not block the first installed dogfood
  build.
- Notification delivery policy remains the quiet-first attention policy in
  ENG-015. Native notification transport is last in this project and default
  off.
- Deterministic Session rehydration remains ENG-018. This project truthfully
  resumes the exact harness conversation in a new process; local processes do
  not outlive Exawatt (decision `0012`).
- Exawatt does not take over git integration. Worker agents continue to commit,
  rebase, and push `master` themselves.

## Execution order

Work packets are ordered. Dogfood starts after D2 and then runs beside D3-D6.
An agent may continue to the next ready packet without waiting for dogfood time
to elapse. D0-D16 are landed; D17 entered active build on 2026-07-19.

### D0 Make the baseline trustworthy

Status: landed 2026-07-10

Work:

- make `pnpm lint` ignore nested agent worktrees and generated output (it
  currently walks `.claude/worktrees/*/.next` and reports generated-code errors)
- add a focused packaged-app smoke command that launches an isolated userData
  directory and proves the workspace route and PTY preload are available
- document the required local toolchain and fail the install command with a
  useful message when a prerequisite is missing

Acceptance:

- `pnpm test:run`, `pnpm type-check`, and `pnpm lint` pass from the main checkout
- the packaged smoke command fails before installation if the built app cannot
  launch `/workspace` or create a shell PTY

### D1 Self-contained Mac app

Status: landed 2026-07-10

Work:

- package the production renderer with Electron and open directly to
  `/workspace`; use a bundled loopback-only Next production server as the
  default implementation path unless the first spike proves a smaller custom-
  protocol renderer can support the same routes without duplicating the app
- remove the production dependency on `https://exawatt.ai`; external web pages
  open in the system browser and never inherit `window.electron`
- package production dependencies including the correct-architecture
  `node-pty`; build for the operator's current Mac architecture first rather
  than making universal distribution block dogfood
- keep `nodeIntegration: false`, context isolation, and renderer sandboxing;
  add a restrictive CSP, navigation allowlist, permission denial by default,
  narrow preload methods, and IPC sender validation
- embed the git commit SHA in the app and expose it in About/settings for
  diagnosis

Acceptance:

- disconnecting the network does not prevent the installed app from opening
  `/workspace`, restoring its local layout, and creating a plain shell
- a renderer navigation to an unapproved origin is blocked or opened in the
  system browser without privileged APIs
- the packaged-app smoke command passes on the built artifact

### D2 Install and refresh from agent closeout

Status: landed 2026-07-10

Work:

- add one idempotent command, `pnpm electron:install-dogfood`, that only installs
  a verified build produced from clean `master`
- serialize concurrent installers with a lock; build to staging; retain the
  previous app until the new artifact passes smoke; atomically swap the app
  bundle; restore the previous app on failure
- install `/Applications/Exawatt.app` without requiring the operator to run
  pnpm, and record installed/build SHAs in a small update-state file
- when the app is running, do not quit or mutate its live session state; notify
  it that a newer build is on disk and show a quiet **Restart when convenient**
  affordance. The next normal launch uses the new build
- add the install command to the repository's agent closeout instructions once
  it exists: the agent that lands a change on `master` installs the resulting
  top-of-tree build after tests pass

Acceptance:

- Spotlight launches Exawatt and the operator can bind it in Switcheroo or any
  normal app switcher; Exawatt itself does not claim a global shortcut
- after an agent lands a commit, its normal closeout updates the installed app
  without an operator build/copy step
- installing while four sessions are open leaves all four running; no automatic
  restart occurs; after a convenient restart the About/build SHA matches the
  installed commit

### D3 Exact session identity and legible relaunch

Status: landed 2026-07-10

Data contract:

- each persisted tab stores `harness`, `harnessSessionId`, `cwd`, `projectId`,
  `lastProcessId`, `lastExit`, and `resumeState`
- `resumeState` is one of `live`, `ended-resumable`, `identity-missing`,
  `resuming`, `resumed`, or `failed`
- the harness adapter owns create/capture/resume behavior; workspace UI never
  constructs provider-specific resume flags

Work:

- Claude: generate a UUID when Exawatt creates the conversation, launch with
  `--session-id <uuid>`, persist it immediately, and resume only with
  `--resume <uuid>`
- Codex: capture the exact ID from a supported CLI/app-server session-identity
  surface and persist it before treating the tab as resumable. If the installed
  Codex version cannot expose that identity deterministically, use a one-time
  explicit session picker and store the selected ID; never infer it from cwd or
  recency
- relaunch into restored-but-ended tabs with clear per-tab state; provide
  **Resume**, **Resume Project**, and **Resume all eligible** actions
- distinguish `resumed exact conversation in a new process` from `started a
fresh conversation`; retain prior scrollback as history, not proof of a live
  process
- migrate old saved tabs without IDs to `identity-missing`; do not auto-resume
  them

Acceptance:

- create four Claude/Codex tabs in one Project, record four distinct IDs, quit,
  relaunch, resume all, and prove every new process resumes its own saved ID
- add an unrelated newer harness session in the same cwd before relaunch; none
  of the four Exawatt tabs attaches to it
- a missing, deleted, or invalid ID produces an explicit recovery choice and
  never silently starts or attaches to a different conversation

### D4 Terminal fundamentals

Status: landed 2026-07-10

Work:

- add xterm scrollback search with `Cmd+F`, next/previous match, responsive
  match state, Escape close, and terminal-focus restoration. Do not synchronously
  count/highlight every match because that blocks the renderer on deep history
- verify native selection, `Cmd+C`, `Cmd+V`, Select All, and context-menu
  behavior against Terminal.app without stealing control sequences from the TUI
- open `https` URLs in the browser; detect absolute/relative file references
  with optional line/column and open them through a validated local-file IPC
  command. Never pass arbitrary terminal text to `shell.openExternal`
- implement image paste through a harness adapter: read an image from the
  clipboard in Electron main, write a private temporary file, and invoke the
  harness-supported attachment path. Codex may use `-i/--image`; Claude behavior
  must be verified against the installed CLI. Delete temporary files on a safe
  lifecycle
- raise scrollback depth and benchmark normal xterm and the WebGL addon before
  choosing the renderer; fall back cleanly when WebGL fails

Acceptance:

- focused Electron tests cover shortcut/focus behavior and validated link/file
  opening; manual packaged-app checks cover selection and both harness TUIs
- search, copy, URL/file opening, and image attachment each work in an actual
  Claude Code and Codex task without opening Terminal.app
- a long-output fixture remains responsive and preserves search/selection after
  renderer fallback

### D5 Chrome and keyboard polish

Status: landed 2026-07-10

Work:

- show the full cwd through intelligent middle truncation plus immediate
  hover/focus disclosure
- render summaries and recaps as readable prose, not tiny terminal monospace,
  with enough lines to communicate useful context
- move Lattice and legacy Fleet/board routes out of primary navigation; the
  command-altitude controls remain primary
- implement one Escape model: dialogs and overlays close first; chrome focus
  ascends the information hierarchy; terminal focus sends Escape to the agent
- provide a visible and keyboard-reachable way to move focus between terminal
  and chrome; audit existing commands in the command palette and shortcut help

Acceptance:

- cwd and summaries are readable at the supported minimum window size and at
  the operator's normal 1400x900 size
- legacy demo surfaces do not appear in primary Electron navigation
- automated focus tests plus packaged-app checks prove Escape never leaks across
  the terminal/chrome boundary

### D6 Native notifications

Status: landed 2026-07-10

Work:

- add click-through macOS notifications for stopped/error/needs-input attention
  events behind a setting that defaults off
- ordinary progress and successful completion remain quiet
- reuse the existing attention truth and delivery policy; do not create a
  second notification state machine

### D7 Product-grade update delivery

Status: landed 2026-07-11

Work:

- sign and notarize macOS builds in CI
- publish versioned zip/DMG artifacts and update metadata to a release channel
- integrate `electron-updater` with check/download progress, **Restart when
  convenient**, next-launch application, failure recovery, and staged rollout
- never call `quitAndInstall` while local PTY sessions are live without an
  explicit operator action; ENG-018 later checkpoints and stops them through a
  shared shutdown coordinator
- replace the local copy bridge for normal users; retain the dogfood installer
  only as a development escape hatch

Acceptance:

- an installed signed build discovers, downloads, verifies, and applies the next
  release on a normal restart
- update failure leaves the current app launchable
- the update UI reports current version, available version, download state, and
  whether live sessions make restart disruptive

### D8 Navigation spine and project-first switching

Status: landed 2026-07-11 — accepted from the IA/navigation audit (operator
decisions: Fleet is legacy; optimize Electron-first; top frictions are legacy
pages / losing the way back, Project switching when a Project has no open
tabs, session creation, and bounded back history).

Work:

- W1 spine coherence: a typed navigation manifest (extending
  `command-altitude.ts`) is the single source for the palette navigation
  group, go-chords, header links, and footer suppression; the altitude rail
  renders on every Electron surface (no active level on non-spine routes);
  spine affordances stop linking into legacy — Spatial's back link and the
  palette stop targeting `/fleet`; go-chords gain spine destinations and
  demote legacy ones; "Fleet" names exactly one thing
- W2 project-first ⌘K: the Projects group always renders in Electron —
  durable registry merged with a local recent-projects record (a Project
  whose tabs all closed, or whose registry row is unreachable, stays one
  keystroke away), an explicit "Add project…" row, and a visible
  "sign in to sync Projects" row replacing today's silently empty group
- W3 bounded history: ⌘[ / ⌘] navigate router history while chrome owns
  focus; the terminal keeps every key it owns today
- W4 macOS menus: Go menu (Terminal / Sessions / Spatial / Back / Forward),
  Session menu (new / close / rename / split / needs-you), Settings ⌘, —
  generated from the manifest, dispatching the same renderer events

Acceptance:

- from any Electron surface, the spine is visible and one click/keystroke away
- no palette row, chord, or spine affordance navigates to `/fleet`,
  `/dashboard`, or `/board`; legacy stays reachable via the avatar menu only
- with zero live sessions and signed out, ⌘K still lists recent Projects and
  can open one or add a new one
- ⌘[ returns to the previous surface; pressing it while the terminal owns
  focus does nothing to the page

### D9 Keyboard authority and palette recents

Status: landed 2026-07-11 — second wave of the IA/navigation audit (operator:
"queue the next wave and execute"). Legacy-list keyboarding (fleet grid,
dashboard attention cards) was considered and dropped: those surfaces are
buried, not invested in.

Work:

- registry authority for workspace verbs: ⌘T/⌘N/⌘W/⌘J/⌘O/⌘D/⌘E/⌘B register
  under a `workspace` context that is never activated in the chord engine —
  the workspace key layer stays the sole executor (it alone can see keystrokes
  inside xterm) but resolves every combo from the registry, so verbs become
  rebindable in Settings, conflict-checked, and listed dynamically in ⌘/;
  ⌘1–9 (project ordinals) and ⌘⇧[/⌘⇧] (tab ring) remain fixed key families,
  documented as two static rows
- palette recents: frecency-ranked "Recent" group on empty ⌘K input
  (localStorage; stable ids — surfaces, projects by dir, verbs); plus
  surface-contextual verbs (Spatial: toggle projection)
- searchable ⌘/ overlay: type to filter shortcut rows
- modal discipline: global chords stop firing behind an open help modal
- wayfinding: per-surface `document.title` via the Next metadata template
  ("Terminal — Exawatt", "Spatial — Exawatt", …); `aria-keyshortcuts` on the
  altitude rail; exposé accepts j/k beside arrows
- one landing: the web OAuth callback redirects where sign-in does

Acceptance:

- rebinding ⌘E in Settings changes what the workspace actually responds to,
  and the help modal shows the new binding without any static list
- with an empty ⌘K input, the last few used commands appear first
- typing in ⌘/ filters the list; `g d` behind the open modal does nothing
- window titles differ per surface in the macOS window switcher

### D10 Menu truthfulness and interaction-race fixes

Status: landed 2026-07-11 — closing the navigation-audit arc. Operator
decisions recorded here so they are not re-proposed: peek-before-navigate
(Space-preview on exposé tiles / switcher rows) is REJECTED as overkill;
demo/live mode-in-URL is deferred until the Demo Scenario Source exists.

Work:

- menu accelerators follow rebinds: the renderer syncs each menu command's
  effective registry binding to main over one validated IPC channel; menus
  rebuild with the new display accelerators (still `registerAccelerator:
false`; ⌘, stays the one registered accelerator). A chord rebind clears
  the menu's accelerator column rather than lying
- tab strip markup: while renaming, the group pill / tab render as a `div`
  so the rename input and color swatches are no longer interactive elements
  nested inside a `<button>` (invalid HTML; React hydration warning found by
  the spine eval's error capture)
- exposé toggle race: ⌘O derives the current open-state from the URL at
  gesture time, so a toggle issued during the mount transition closes the
  overview instead of re-opening it

Acceptance:

- rebinding ⌘E updates the Session menu's displayed combo without restart
- ⌘E rename cycle produces no nested-interactive hydration warnings
- spine eval stays green including a menu-sync check

### D11 Command-continuum hardening

Status: landed 2026-07-11 — reopened from literal installed-app dogfood after
the automated navigation checks passed. An OS-level click reproduced the
operator's intermittent Terminal / Sessions / Spatial failure: the control was
inside the draggable Electron title bar without a `no-drag` island. Focusing
Spatial search also reproduced a dead `⌘⇧M` return path because the global
shortcut engine rejected every input-originating event. This packet supersedes
D10's "audit arc closes" wording; D10 itself remains landed history.

Operator decisions:

- Sessions is a fast Mission Control-style transient overview, not a blocking
  modal: `⌘O` moves between the active Terminal and Sessions; arrows or J/K move
  selection; Enter opens the selected Session; Escape returns to the Session
  the operator came from. Workspace chrome hidden beneath the overview is
  inert, while the shell-level Terminal / Sessions / Spatial control remains
  reachable.
- raw Escape remains owned by Claude Code, Codex, shells, editors, and other
  TUIs while xterm owns focus. Exawatt does not steal it to zoom out. Spatial
  Escape removes Agent then Project selection; Fleet has no higher selection,
  so Escape is a no-op there for now.
- `⌘⇧M` remains the direct Terminal ↔ Spatial gesture. It does not route through
  Sessions, but the finite transition should communicate one continuous command
  world. The first implementation establishes a reusable transition owner; it
  does not merge DOM/xterm and R3F or build a cinematic engine.
- reopen on the last command altitude. Spatial search/status filters are URL
  state; camera position is session-local return state. Active-altitude clicks
  perform light focus/recenter feedback instead of silently doing nothing.

Ownership boundaries:

- the typed navigation manifest owns surface identity, canonical hrefs, labels,
  route resolution, and shortcut ids; consumers may own icons and layout but
  not competing names, destinations, or default shortcut strings
- the shortcut registry owns effective rebindable keys; visible hints, ARIA
  metadata, palette rows, and native menus derive from it
- the shell-level transition owner coordinates finite route handoffs; workspace
  owns xterm focus and Sessions layout; Spatial owns semantic altitude, filters,
  and camera; Electron main owns PTY/process lifetime
- Demo and Live Mode use identical navigation commands and state contracts

Execution packets (completed in order):

1. **D11.1 literal input and keyboard escape paths.** Mark every interactive
   title-bar island `no-drag`; add an OS-coordinate click evaluator beside the
   renderer-level click checks. Permit modified global commands such as `⌘K`,
   `⌘/`, `⌘⇧M`, and history while ordinary input text and unmodified go-chords
   remain untouched. Make the Terminal destination advertise `⌘⇧M` while
   Spatial is active, and make an active Terminal click restore xterm focus.
2. **D11.2 Sessions interaction model.** Remove false modal semantics; make
   obscured workspace chrome inert; implement roving selection/focus with stable
   Project/Session ordering; preserve the originating Session; support arrows,
   J/K, Enter, Escape, and `⌘O`; make active Sessions refocus/recenter selection;
   verify zero, one, many, exited-during-overview, and reduced-motion cases.
3. **D11.3 shortcut and manifest authority.** Derive the altitude control and
   command destinations from the surface manifest; render effective registry
   bindings in the altitude control, workspace legend, palette, help, and ARIA;
   label `⌘K` as commands rather than Sessions. Add Spatial's fixed keyboard map
   to searchable help and keep a compact discoverability path at 800×600.
4. **D11.4 Spatial continuity.** Encode normalized search/status filters in the
   URL; retain them through projection, altitude, Terminal, and history changes;
   persist bounded camera center/zoom in session storage keyed by semantic board
   address; discard stale/non-finite data; active Spatial click recenters. Keep
   Project, Agent, projection, PTY identity, and Demo/Live parity intact.
5. **D11.5 shared transition foundation.** Route altitude changes through one
   typed client command. Add a short transform/opacity handoff for direct
   Terminal ↔ Spatial navigation, with direction-aware near/far motion, no
   layout-property animation, no PTY delay, and immediate reduced-motion parity.
   Agent-to-Session keeps its authored camera push but delegates route completion
   to the same owner. Future game-board motion extends this owner rather than
   adding per-button timers.
6. **D11.6 reconciliation and dogfood.** Extend the Electron spine evaluator
   with literal OS click, focused-search navigation, active-altitude actions,
   Sessions focus order, rebind truthfulness, last-altitude restore, Spatial
   state return, and normal/reduced transition checks. Run focused tests, full
   tests, type-check, lint, Electron compile, navigation evaluators, R3F/spatial
   checks for any Canvas changes, and supported-size screenshots. Record landed
   evidence here and in the roadmap before closeout.

Acceptance:

- three consecutive OS-level clicks on every altitude target navigate or run
  the documented active action; the draggable window region remains usable
- `⌘⇧M`, `⌘K`, and `⌘/` work while Spatial search is focused; typing, selection,
  and unmodified `g` remain input text and never start a navigation chord
- Sessions never exposes obscured terminal controls to focus or assistive tech;
  arrows/J/K/Enter/Escape/`⌘O` remain deterministic as Sessions appear or exit
- every displayed rebindable shortcut matches the registry after a live rebind;
  Spatial fixed keys remain searchable at 800×600
- Spatial search/status, semantic address, projection, and valid camera return
  context survive Terminal round trips; a selected live Session opens the same
  PTY and returns to the same board context
- direct Terminal ↔ Spatial navigation has one finite transition owner, settles
  in the ordinary 200–350ms interaction budget, animates only transform/opacity,
  and becomes an immediate crossfade under reduced motion
- `pnpm test:run`, `pnpm type-check`, `pnpm lint`, `pnpm electron:compile`, the
  navigation evaluators, and applicable R3F/spatial checks pass from an isolated
  server and userData directory

### D12 Absolute command-altitude shortcuts

Status: landed 2026-07-12 — operator dogfood found that the remaining `⌘O`
Sessions toggle and `⌘⇧M` Terminal ↔ Spatial toggle made the same destination
require different keys depending on origin. The stable model is now three direct,
Apple-style view destinations: `⌘1` Terminal, `⌘2` Sessions, and `⌘3`
Spatial. Repeating a destination never toggles away; it performs that altitude's
light focus/recenter action. Escape keeps the separate hierarchical-back contract.

Compatibility and ownership:

- fixed Project ordinals move from `⌘1`–`⌘9` to `⌘⌥1`–`⌘⌥9`; the global
  `⌘⇧[` / `⌘⇧]` tab ring and unshifted `⌘[` / `⌘]` history contracts
  do not change
- `⌘O` and `⌘⇧M` stop owning navigation; stale persisted overrides for
  their retired registry ids are ignored rather than migrated onto a surprising
  new command
- the navigation manifest owns each altitude's direct registry id; one command
  navigation provider owns route-or-focus activation; the workspace capture
  layer only ensures those registry bindings beat xterm, then delegates
- native menu accelerators, altitude labels and ARIA, searchable shortcut help,
  and command-palette navigation rows all render effective registry bindings
- go-chords remain secondary mnemonic navigation; absolute shortcuts are the
  primary visible fast path

Execution sequence (completed in order):

1. **D12.1 contract and registry.** Add the three direct rebindable definitions,
   bind them to the manifest, remove the two toggle definitions, and expose one
   typed `activateCommandAltitude` operation with idempotent active actions.
2. **D12.2 input authority.** Handle effective altitude bindings in workspace
   capture phase before xterm. Move Project ordinals to `⌘⌥1`–`⌘⌥9` without
   changing `⌘⇧[` / `⌘⇧]`; leave plain terminal text and Option-only input
   untouched.
3. **D12.3 discoverability.** Show `⌘1` / `⌘2` / `⌘3` on every altitude
   target including the active target, in the palette, help, ARIA, and macOS Go
   menu. Remove duplicate toggle-oriented palette actions and stale copy.
4. **D12.4 motion continuity.** Reuse the finite command-transition owner for
   every cross-regime destination, identify the actual Terminal/Sessions/Spatial
   target, preserve the existing Sessions recede motion, and retain immediate
   reduced-motion parity. No Canvas code or PTY lifetime boundary changes.
5. **D12.5 literal verification and integration.** Unit-test key ownership and
   idempotency; extend the click-driven navigation evaluator to press all three
   keys from xterm and focused Spatial search, repeat active keys, and recheck the
   tab ring. Run the full quality gates, test the packaged Electron app with real
   clicks, integrate to clean `master`, install dogfood, and remove the worktree.

Acceptance:

- from Terminal, Sessions, or Spatial, `⌘1`, `⌘2`, and `⌘3` always mean
  exactly Terminal, Sessions, and Spatial; repeating one cannot leave that view
- the same keys work while xterm or Spatial search owns focus, and ordinary text
  entry remains untouched
- `⌘⌥1`–`⌘⌥9` select Projects, `⌘⇧[` / `⌘⇧]` cycle tabs, and
  `⌘[` / `⌘]` navigate route history with no overlap
- literal altitude clicks work repeatedly; active clicks and active shortcuts
  focus Terminal/Sessions or recenter Spatial
- every visible direct shortcut and native accelerator matches the registry,
  including after a live rebind
- focused tests, the full test/type/lint/Electron gates, navigation evaluators,
  and clean-master dogfood installation pass

### D13 Shortcut binding policy

Status: landed 2026-07-12 — D12 made Terminal, Sessions, and Spatial universally
reachable, but the generic shortcut editor can still save a bare key, Option-only
binding, or two-key chord that Exawatt must leave to xterm/text input. A visible
binding that cannot honor its command's focus contract is invalid configuration.

Execution sequence (completed in order):

1. Add typed binding-policy metadata to shortcut definitions and mark the three
   absolute altitude destinations as universal commands.
2. Add pure, platform-aware validation: universal commands require a single
   Command-modified key on macOS (Control on Windows/Linux). Reserve the fixed
   `⌘⌥1`–`⌘⌥9` Project family and `⌘⇧[` / `⌘⇧]` tab ring using
   physical key codes so Option/keyboard-layout character translation cannot
   bypass the check.
3. Make Settings explain the active policy, reject invalid/reserved bindings
   before persistence, and retain existing registry conflict checks.
4. Cover accepted/rejected platform cases and physical-key reservations with
   focused tests, then run full tests, type-check, lint, Electron compile, clean
   master integration, and dogfood installation.

Acceptance:

- Terminal/Sessions/Spatial cannot be rebound to a bare key, Option-only key,
  Control-only key on macOS, or multi-key chord
- a valid `⌘` binding remains customizable and continues to flow through the
  registry, rail, palette, ARIA, help, and native menu accelerator sync
- Settings rejects `⌘⌥1`–`⌘⌥9` and `⌘⇧[` / `⌘⇧]` with a concrete
  reserved-family message even when Option changes the produced character
- contextual shortcuts retain their existing single-key/chord flexibility

### D14 Project opener and Agent-first start

Status: landed 2026-07-12 — operator product review found that `Command-N`
falling straight through to a native folder picker, then implicitly spawning a
shell, made Exawatt behave like a thin terminal multiplexer instead of an Agent
manager. Research across IDE project choosers and current Agent runtimes
supported separating durable Project selection, Agent identity, source/runtime,
and Session lifecycle.

Execution sequence:

1. Preserve explicitly opened empty Project groups in workspace persistence;
   resolve selected paths in Electron main and register them without a PTY
   create. AMENDED by D37: close-last-Agent now lingers on the empty state for
   three seconds, then closes only the open group while preserving library
   identity.
2. Replace `Command-N` with a searchable curated chooser shared by keyboard,
   native menu, and palette entry points. Keep Browse and add reviewed one-level
   parent-folder import with git-root/worktree deduplication.
3. Introduce a capability-described Agent Source registry for Claude Code and
   Codex, plus automatic per-Project recommendation and personal recency
   fallback. Keep shell outside that registry.
4. Replace the directory/harness button strip with a compact composer carrying
   an optional first task through the main-process launch contract. Preserve
   worktree and roadmap linking as secondary options.
5. Add one visible source-agnostic Ask first / Auto-review / YOLO launch policy.
   Default new Project+harness pairs to YOLO per operator preference, persist
   the personal selection per pair as soon as it changes, and translate it into
   provider flags only inside the source/PTY boundary. Exact resume uses the
   pair's current policy; preference-read failures use a visible Ask first
   fallback.
6. Verify inert open, missing-path locate, import selection, empty/blank task,
   initial task quoting, source memory, shell separation, close-last-tab,
   permission-policy translation and per-pair memory, relaunch persistence,
   multi-Agent launch, responsive layout, menu/palette convergence, and clean
   teardown with focused and real Electron tests.

Acceptance:

- opening or importing a Project creates no PTY and the Project remains visible
  with zero Sessions across Terminal, Sessions, and Spatial, including after
  reload; starting its first Agent populates the same Project identity rather
  than creating a duplicate cluster. AMENDED by D37: closing its last Agent
  briefly shows that zero-Session state, then closes the open group; `⌘N`
  reopens the preserved library identity
- `Command-N` opens the Project chooser; Browse remains available; importing a
  parent directory never silently adds every child
- Agent start always shows its source, accepts an optional initial task, and
  automatically recommends the last source used in that Project
- Agent start always shows and explains its effective Ask first / Auto-review /
  YOLO policy;
  new Project+harness pairs default to YOLO, Claude Code and Codex choices are
  remembered independently, and no source adapter silently broadens a
  selected lower-access policy
- shell remains keyboard-reachable but is presented as a Project tool rather
  than an Agent Source
- command palette and native menus route into the same Project chooser and Agent
  composer instead of bypassing them
- provider-specific create/resume mechanics remain behind the launch boundary;
  no attach/resume UI is invented for sources whose semantics are unresolved

### D15 Startup acceleration

Status: landed 2026-07-12

Electron now presents a real, self-contained launch frame before renderer
extraction and heavy command modules finish. The packaged evaluator measures
process connection, first window, first visible feedback, and usable workspace;
the detailed implementation evidence remains in the progress log below and the
ENG-016 roadmap milestone.

### D16 Session/Spatial parity

Status: landed 2026-07-12

Sessions and Spatial now preserve the same durable Session identity across live
and stopped process states. The detailed lifecycle contract and verification
evidence remain in the progress log below and the ENG-016 roadmap milestone.

### D17 Stable dogfood signing identity

Status: active-build — implementation and automated two-SHA identity gate
landed 2026-07-19; delivery-transaction review hardening landed 2026-07-20;
operator Little Snitch policy observation remains

Original failure and review findings:

- before D17, the normal agent-closeout path passed `mac.identity=null`; the
  installed app is ad-hoc signed, exposes no stable Team Identifier, and does
  not pass strict bundle signature verification
- Little Snitch identifies ad-hoc code by its code-directory hash, while
  Developer-signed code uses a stable Team Identifier plus program Identifier;
  an executable refresh can therefore look like a different application and
  force the operator through another identity approval cycle
- Claude Code and Codex already have their own stable signed executable
  identities. D17 owns Exawatt's application identity only; it must not collapse
  helper-specific policy into a blanket Exawatt allow rule
- the initial signing implementation still built in the mutable shared
  `master` checkout, selected a sole certificate without pinning Exawatt's Team,
  and performed a two-rename swap whose interruption window could temporarily
  leave no app at the canonical path

Execution sequence:

1. Record the current app, helper, and native-module code identities and make a
   hermetic evaluator fail on ad-hoc, unsigned, inconsistently nested, or
   unverifiable installed artifacts.
2. Select and document a noninteractive identity source for clean-`master`
   dogfood installs. A local Keychain identity or an exact-SHA signed CI artifact
   may satisfy the contract; credentials and private key material never enter
   the repository, build output, or logs.
3. Sign the main application, Electron helpers, and nested native code with a
   stable Exawatt identifier before the existing smoke test and atomic swap.
   Require Exawatt's Team, secure timestamps, hardened runtime, and code hashes.
4. Pin the build to a detached snapshot of one committed SHA. Coordinate remote
   integration, the shared `master` checkout, and the installer with one
   repository delivery lock; use a separate target lock across clones.
5. Replace an existing app with one same-volume atomic exchange, keep the prior
   app as rollback state through post-swap verification, and recover a valid app
   deterministically after interruption.
6. Fail with a concrete remediation when the identity source is unavailable.
   Do not silently restore `identity=null`, disable Little Snitch identity
   checks, or generate a new throwaway identity.
7. Install two distinct clean-`master` build SHAs and verify that the code
   identity is unchanged, strict nested-code verification passes, existing
   Little Snitch domain allow and deny rules remain effective without a
   modification/new-identity alert, and production signed-update behavior is
   unchanged.

Acceptance:

- `/Applications/Exawatt.app` has the expected stable application identifier
  and signer identity after every agent-closeout install; its main executable,
  helpers, and nested native code pass strict verification
- changing Exawatt source and reinstalling through the normal dogfood command
  does not require the operator to approve the application identity again in
  Little Snitch 6.4.1
- both an existing allow rule and an existing deny rule are exercised after the
  second install, proving policy preservation rather than a blanket allow
- the installer remains atomic and never restarts a running Exawatt; an
  unavailable identity leaves the previously installed app intact and explains
  how to recover
- a concurrent landing waits instead of moving shared `master` under an active
  build; the installed artifact and embedded build metadata come from exactly
  one committed SHA
- an interrupted or failed post-swap verification leaves the previous bundle
  at the canonical path or at a deterministic recoverable transaction path
- no signing secret, exported certificate, firewall backup, or Little Snitch
  rule data is committed, logged, or modified by Exawatt
- release CI retains Developer ID signing, notarization, stapling, and updater
  verification exactly as defined by decision `0009`

### D29 ⌘K switcher turn-state parity

Status: landed 2026-07-22. The execution contract is retained below as the
acceptance record for this slice.

**Why.** D22 established shared session turn-state truth (working = main's
activity signal with D24's resize grace; started = the `engaged` bit or a
goal subtitle; attention outranks) and D22/D24 taught the strip and the
Sessions tiles to render it via `status-glyphs.tsx`. The ⌘K switcher never
joined: `switcher-rows.ts` still derives status from `now - lastDataAt <=
15_000` (`WORKING_WINDOW_MS`, line ~28). Consequences, all user-visible:
an agent reads "done" in the strip and "idle" in ⌘K; clicking a tab (pane
attach → PTY resize → WINCH redraw) flips its switcher row to "working"
for up to 15s — the exact false-positive D24 fixed for the strip; and the
finished-vs-unstarted distinction (D22's whole point) does not exist in
the switcher.

**Baseline facts (verified 2026-07-22 against `3b707c1`, before D29).**

- `src/components/workspace/switcher-rows.ts`: pure + unit-tested.
  `SessionRowStatus = 'needs-you' | 'working' | 'idle' | 'exited'` (line
  ~10); `sessionRowStatus(s, now)` (~31) uses exited → attention → the
  15s window; `STATUS_RANK` (~124) orders rows; `buildSessionRows`
  (~140) consumes `pty.list()` + the persisted layout.
- `src/components/shortcuts/command-palette.tsx`: `STATUS_META` (~90)
  maps status → one-word label + color; rows render the word (~552) and
  stamp `data-session-status` (~584).
- `PtySessionInfo` (src/types/electron.d.ts) carries `attention`,
  `engaged`, `contextSummary` as `pty:list` ride-alongs (pty-ipc.ts
  ~247–253) but NOT `working` — the strip receives working via
  `pty:activity` events, which the palette (fetch-on-open) cannot use.
- `attentionMonitor.isWorking(id)` exists (D18) and embeds the D24
  resize grace (`noteResize`).
- Shared render/truth constants live in
  `src/components/workspace/status-glyphs.tsx`: `sessionGlyphState`,
  `SessionStatusGlyph`, `SESSION_GLYPH_COPY`, `SESSION_GLYPH_LABEL`,
  `AttentionDot`.

**Design.**

1. Main: add `working: attentionMonitor.isWorking(s.id)` to the
   `pty:list` ride-along (same pattern as `engaged`); type it on
   `PtySessionInfo` as `working?: boolean`.
2. `switcher-rows.ts`: `SessionRowStatus` becomes
   `'needs-you' | 'working' | 'done' | 'fresh' | 'quiet' | 'exited'`.
   Derivation (mirror `sessionGlyphState`, do not fork it): exited →
   'exited'; attention → 'needs-you'; working → 'working'; shell →
   'quiet'; engaged || contextSummary → 'done'; else 'fresh'. When
   `working` is undefined (older mocks), fall back to a 3s lastDataAt
   window — matching the monitor's `WORKING_WINDOW_MS`, and DELETE the
   15s constant. Ranks: needs-you 0 · working 1 · done 2 · fresh 3 ·
   quiet 4 · exited 5; keep the existing recency tiebreakers.
3. Palette: rebuild `STATUS_META` from `SESSION_GLYPH_LABEL` + HUD
   colors (needs-you amber, working cyan2, done green, fresh/quiet
   idle, exited textDim) and render the shared `SessionStatusGlyph`
   (or `AttentionDot` for needs-you) beside the word so ⌘K rows read
   identically to strip glyphs. Keep words normal-case (no all-caps).
4. Update every 'idle' string the union rename touches (aria labels,
   tests, `data-session-status` consumers — grep before assuming).

**Sequence.** (a) main ride-along + d.ts → (b) switcher-rows + its
tests → (c) palette render → (d) chrome-layout eval: give the mock
sessions explicit `working: false`, then open ⌘K with an empty query and
assert `data-session-status` per fixture — gpa-session (engaged) →
'done', fresh-session → 'fresh', exawatt-session (summary) → 'done' —
plus a screenshot of the rows → (e) full verify + land.

**Acceptance criteria.**

1. Strip, Sessions tiles, and ⌘K rows show the SAME state for the same
   session, from the same inputs, with the same copy constants.
2. Clicking an idle tab never flips its switcher row to working (the
   ride-along bit embeds the resize grace).
3. The 15s heuristic is gone; the only time-window fallback is 3s,
   labeled as a mock/legacy fallback.
4. `pnpm test:run`, lint, type-check, `electron:compile` green; the
   chrome-layout eval passes with the new assertions; land via `pnpm agent:land -- --verify lint --verify type-check --verify electron:compile --verify test:run --dogfood`.

**Process requirements for the executing agent.**

- Own worktree via `pnpm worktree:setup` (ENG-022 bootstraps node-pty,
  `.env.local`, ports). Never reuse another agent's dev server: check
  `lsof` ownership of any port you target; multiple agents run
  concurrently and Next silently serves the WRONG tree on a collision
  (bitten twice on 2026-07-21).
- D-number collision protocol: this item is D29; re-verify at REBASE
  time that no concurrently-landed milestone took D29, and renumber via
  blanket sed if so (recipe in the 2026-07-21 findings).
- Screenshot-iterate the palette rows before landing; `.artifacts/` is
  gitignored eval output.
- Out of scope, noted for a later slice: `local-workspace-sessions`
  (fleet/Spatial inventory) has its own working-window heuristic
  ("matches fleet truth" per the old comment) — do NOT change fleet in
  this slice; log a finding if the divergence is visible in Spatial.

**Outcome.** Main's resize-aware `working` bit now rides on `pty:list`; the
workspace adopts it with the same stale-snapshot guard used for attention, so
a renderer reload cannot regress an active Session to quiet. Turn-state
derivation and copy moved into the render-free `session-status.ts` model;
`status-glyphs.tsx`, Sessions rows, and ⌘K consume that shared vocabulary.
The switcher ranks and renders needs-you / working / done / fresh / quiet /
exited, and explicit `working: false` overrides fresh redraw output. The only
timestamp fallback is the monitor-equivalent 3-second path for old mocks.
Verification: 620 unit/component tests, lint, type-check, Electron compile,
and the worktree-owned chrome-layout eval passed; the eval captures the three
empty-query switcher rows and an already-working renderer-reload case.

### D39 Interaction-contract rough-edge closure

Status: active-build 2026-07-22 — triggered by the operator report that
`Command-W` silently did nothing on an active empty Project, then expanded by a
hands-on pass through the installed app and the Project, split, recents,
navigation, narrow-window, quit/restart, interrupted, and corrupt-history
evaluators. The deterministic design scan was used as corroboration, not as the
priority source; its primary-workspace findings were lower-impact than the
interaction defects below.

Verified findings, in priority order:

1. **P1 — browser-style close recovery has no direct keyboard path (implemented
   in this slice).** D23 already keeps meaningful closed Sessions in a durable 14-day,
   newest-first ledger and can resurrect their Project, goal, provider identity,
   and retained history from `⌘K`, but the browser-standard `⌘⇧T` gesture is
   still assigned to the secondary shell tool. Bind a new reconfigurable
   `workspace-reopen-closed-tab` command to `⌘⇧T`, move shell launch to the
   non-conflicting `⌘⌥T`, and route restore through the existing ledger. Each
   repeated gesture pops the next-newest recoverable Session, selects it without
   starting a process, and recreates its Project group when necessary. Serialize
   restore requests and wait for renderer-initiated close/archive work so an
   immediate `⌘W` → `⌘⇧T` cannot race the ledger. An empty ledger is a safe
   no-op. Drafts and never-started Agents keep D24/D27's deliberate discard
   semantics and therefore do not enter this recovery path.
2. **P1 — close target drift (implemented in the first slice).** `⌘W` called a
   tab-only action and returned false when an empty Project had no `activeTab`,
   even though the Project context menu could close the same object. One shared
   close rule now backs the shortcut, palette event, and native menu: close the
   active tab when present; otherwise close the active Project only when it is
   empty. The stable `workspace-close-tab` ID remains for saved bindings.
3. **P1 — split panes do not carry pane-local ownership.** A watched pane can
   belong to another Project/Agent while the only full context bar describes
   the driven side. The tiny pin glyph in the strip is the sole mapping, and
   focus ownership is not explicit enough for a command surface where typing
   into the wrong Agent has real consequences. Add a compact pane-local
   Project + Agent/goal label and a visible focused-pane state without
   duplicating terminal content.
4. **P1 — Project context menus are pointer-only (implemented in this
   slice).** Project and Session chips now open their complete action menu with
   right-click, `Shift+F10`, or the Context Menu key; Escape restores focus to
   the invoking chip. Empty Projects therefore expose rename/color and close
   without requiring a pointer. The palette's Project-edit row now opens the
   actual Project name/color editor instead of incorrectly aliasing tab rename.
5. **P1 — unavailable commands look live and hidden attention state moves the
   operator (implemented in this slice).** One renderer-owned availability
   snapshot now derives shell, recovery, rename, split, close, roadmap, and
   attention applicability. Passive hints hide inapplicable verbs, palette rows
   remain discoverable but disabled with a short reason, and validated booleans
   keep the native Session menu aligned. `⌘J` now walks only Sessions carrying
   the visible needs-you marker; an empty roadmap queue no longer moves Terminal
   to Sessions and remains explicitly reachable with `⌘B`.
6. **P2 — empty-state discoverability is duplicated into noise (implemented in
   this slice).** The centered no-Project state now teaches one immediate action
   and one sentence. The single persistent footer owns shortcuts and filters
   them through the same availability model.
7. **P2 — corrupt retained-history copy contradicts itself.** The corrupt
   history state simultaneously says “Saved terminal history · read-only,”
   “Saved terminal history is read-only,” and “Retained history unavailable.”
   Render one honest empty/error state that says the history could not be read,
   preserves the reason for diagnostics, and makes the valid recovery action
   primary.
8. **P2 — restart recovery erases Agent identity at rest.** Several stopped
   tabs condense to source glyph + “Stopped,” making same-source Agents
   indistinguishable until hover while the recovery banner offers a batch
   action. Preserve a short operator title or goal during recovery and keep
   condensation for steady-state inactive tabs only.
9. **P2 — operational metadata falls below the legibility floor (primary
   chrome scale implemented in this slice).** The title bar, altitude switcher,
   Project/Agent strip, lifecycle badges, active-session context, and shortcut
   footer previously mixed 9–12px one-offs until the hierarchy became
   squint-level at 800×600. Those surfaces now share four semantic roles:
   13px primary titles, 12px navigation/identity/context labels, 11px status and
   footer metadata, and a 10px micro role reserved for transient shortcut
   ordinals. Primary labels gain deliberate medium weight and inactive altitude
   labels gain sufficient contrast; the terminal's independent font settings
   and content density do not change. Long exact IDs remain evidence rather
   than the reading path and stay available through their disclosure surfaces.

The 2026-07-24 thorough review of the landed D39 slices found six contract
defects, all included in the fifth slice rather than split into local patches:

1. a Session carrying both roadmap-blocked and turn-end state could paint one
   meaning and navigate by another because attention producers used overwrite
   semantics;
2. the close-last-Agent timer could remove an empty Project while the operator
   was composing, and only task/model fragments—not worktree, branch, or roadmap
   intent—belonged to the draft tab;
3. Recently-closed availability was a renderer snapshot plus local arithmetic,
   so main-process expiry/reap and IPC ordering could drift it;
4. action menus lacked one-tab-stop/Home/End/Tab behavior, restored focus only
   on Escape, and could remain open over a removed target;
5. application-global native availability could retain renderer truth across a
   document reload; and
6. Project scale-out animation left a flex gap and ended with a sibling snap.

The shared fixes are, respectively: semantic attention composition consumed by
both marker and queue; an operator-intent boundary that retains the Project and
atomically materializes a complete draft; authoritative main-ledger change
events with subscribe-before-hydrate projection; a target-aware roving menu
primitive; renderer-lifecycle invalidation of native availability; and a
reduced-motion-safe FLIP pass for surviving Project groups.

Sequence: (a) shared close target + Electron regression (landed first slice);
(b) browser-style closed-tab recovery, pending-close ordering, and shortcut
truth (landed second slice); (c) primary-chrome legibility (landed third
slice); (d) keyboard-complete action menus, shared command availability,
visible-target `⌘J`, and one empty-state legend (landed fourth slice); (e)
pane-local ownership/focus because wrong-target input has the highest remaining
consequence; (f) recovery truth + stopped identity; (g) repeat the same user
journeys at 560, 800, 1200, and 1400 widths with keyboard-only and
reduced-motion passes; (h) land the six review-hardening contracts above before
calling the earlier interaction slices stable.

Acceptance criteria:

- `⌘⇧T` restores the newest recoverable Session as the active stopped tab,
  recreating its Project group if closed; repeated presses walk the ledger in
  LIFO order without launching a provider or shell process
- `⌘W` followed immediately by `⌘⇧T` restores the tab after its archive
  transaction settles; an empty ledger does nothing safely; `⌘⌥T` remains the
  direct shell-launch gesture, and Settings/help/native menu displays agree
- no visible shortcut, palette row, or native menu item silently no-ops in the
  current context; unavailable actions are absent or explain why
- `⌘J` selects only a visible needs-you Session and leaves Terminal unchanged
  when no such target exists; `⌘B` remains the explicit roadmap route
- every split pane identifies its Project/Agent and focused/driven/pinned role
  without requiring a tab-strip inference
- every Project context-menu action is reachable by keyboard and returns focus
  to its invoker or command destination appropriately; stale targets close
  their menus
- close-last-Agent grace never discards operator-authored composer state; all
  launch choices persist as one draft intent record
- attention collisions preserve visible human gates, and native/recovery
  availability heals across reload, reopen, and ledger expiry without a stale
  renderer snapshot
- Project exit motion has no final sibling snap and respects reduced motion
- missing/corrupt history never claims saved history is available; recovery
  copy names the valid next action
- the no-Project state contains one shortcut-discovery layer, not two
- multiple stopped same-source Agents remain distinguishable before hover
- essential operational text remains readable at the supported 560×400 floor
  and at 800×600, while exact IDs remain accessible and copyable
- focused tests plus the Project, chrome-layout, split, recents, and packaged
  lifecycle evaluators cover the affected states before D39 is marked landed

## Continuous dogfood evidence

Start after D2. Do not schedule a separate dogfood week and do not pause
implementation to wait for elapsed time.

- The operator runs real Claude Code and Codex work in the installed app across
  at least two Projects while agents continue D3-D7.
- Record only actionable evidence here: date, task, session count, fallback or
  friction, severity, and owning work packet.
- Plain-shell and unrelated terminal work are outside the adoption measure.
- A Terminal.app fallback for coding-agent work is evidence to fix, not a reason
  to reset a clock or stop unrelated implementation.
- ENG-002 closes when the operator confirms Exawatt has become the normal daily
  coding-agent surface based on accumulated use; no fixed consecutive-week wait
  is required.

## Verification matrix

Every implementation closeout runs the relevant focused tests plus:

```text
pnpm test:run
pnpm type-check
pnpm lint
pnpm electron:compile
```

D1-D3, D7, D17, and D27 also require the packaged-app smoke test. D3 requires the
four-tab same-Project resume scenario. D4-D5 require packaged Electron
interaction checks, not browser-only component tests. D17 additionally requires
strict signature verification and a two-distinct-build identity/policy
round-trip on macOS with Little Snitch.

## Progress log

- 2026-07-24, D39 review-hardening: the close/recovery interaction contract now
  has one semantic attention merge (human gates outrank quiet results), an
  intent-aware empty-Project grace boundary, and complete draft ownership for
  task/source/model/effort/worktree/branch/roadmap choices. Electron main emits
  authoritative Recently-closed counts on archive/reopen/reap; the renderer
  subscribes before hydration and keeps only an availability overlay while a
  close is in flight. Native contextual commands invalidate across document
  reload/process loss, action menus use target-aware roving focus plus
  Home/End/Tab behavior, and surviving Project groups FLIP into the space left
  by the reduced-motion-safe right-to-left exit. Verification: 868 unit and
  component tests, lint, type-check, Electron compile, the real-Electron
  Project/Agent launcher evaluator (including reload state and typing during
  grace), and visual inspection of the 800×600 empty-Project composer passed
  from the worktree-owned server.

- 2026-07-24, D39 contextual-command coherence: workspace applicability is now
  derived once and projected into shortcut hints, the command palette, and the
  native Session menu. Inapplicable hints disappear, palette rows explain why
  they are disabled, and native items disable instead of silently doing
  nothing. Project and Session action menus are keyboard-complete through
  `Shift+F10` / the Context Menu key with Escape focus restoration; Project
  editing now targets Project name/color rather than tab rename. `⌘J` follows
  only visible needs-you Sessions, while the empty roadmap remains an explicit
  `⌘B` destination. Workspace-local native menu verbs disable while Spatial
  owns the renderer instead of firing at an absent listener; route-safe shell
  and recovery commands keep their navigation paths. The no-Project state has
  one shortcut-discovery layer.
  Verification: 760 unit/component tests, lint, type-check, Electron compile,
  the native Project/Agent launcher evaluator, the 34-check roadmap-rail
  evaluator, and the six-width chrome-layout evaluator passed from the
  worktree-owned server.

- 2026-07-23, D39 primary chrome legibility: application chrome now uses one
  fixed semantic scale instead of scattered 9–12px values. Brand and Agent tab
  titles are 13px; altitude, Project, active path, and goal labels are 12px;
  lifecycle and persistent shortcut metadata are 11px; only transient ordinal
  keycaps use the 10px micro role. Primary labels gain a measured weight/contrast
  lift while xterm retains the operator's independent terminal font setting.
  The chrome-layout evaluator measures every role, constrains the micro-role
  exception, and verifies no horizontal overflow at 560×400, 800×600,
  1024×700, 1312×700, 1400×900, and 1600×900. Verification: 708 unit/component
  tests, lint, type-check, Electron compile, a production directory build, the
  measured chrome-layout evaluator, and the packaged Electron chrome evaluator
  passed from the worktree-owned server.

- 2026-07-23, D39 browser-style closed-tab recovery: the existing 14-day
  Recently-closed ledger now backs `⌘⇧T`; each request restores the newest
  recoverable Session as an active stopped tab and recreates its Project group
  without starting a process. Restore requests serialize, and each waits for
  renderer close/archive work already in flight, so rapid repeated restores
  walk LIFO order and immediate `⌘W` → `⌘⇧T` cannot miss the optimistic close.
  The secondary direct-shell gesture moves to `⌘⌥T`; registry defaults,
  Settings/help, footer hints, native Session menu accelerators, and shell-path
  evaluators follow. The close toast teaches the new undo gesture. Verification:
  694 unit/component tests, lint, type-check, Electron compile, the Project
  launcher evaluator's real two-Session LIFO/immediate-undo checks, and the
  split plus draft/paste shell-path evaluators passed from the worktree-owned
  server.

- 2026-07-22, D38 stable Agent turn boundaries: finished is now a semantic
  main-process latch, not the temporary absence of PTY bytes. Once an Agent
  crosses the existing quiet or BEL boundary, later provider redraws, title
  updates, and terminal protocol replies cannot replace its finished check
  with the working half-circle. Guaranteed-human engagement opens the next
  turn; shells remain output-driven. Unit coverage exercises quiet, BEL,
  passive high-volume redraw, explicit re-engagement, and shell behavior. The
  Electron Project-launch evaluator injects output after a real finished state
  and requires both the check and main's `working: false` to remain stable.

- 2026-07-22, D36 deterministic relaunch ownership and recovery hierarchy:
  provider identity capture now starts from a Codex catalog baseline taken
  before process spawn, so a composer task passed on the CLI cannot bypass the
  capture path. Electron main atomically indexes every exact provider identity
  by durable Session ID instead of relying solely on renderer layout debounce.
  Relaunch consumes that index and repairs older missing identities only through
  a unique one-to-one same-harness opening-task match; ambiguous history remains
  operator-selected. The recovery surface is reduced to a count-named workspace
  action and a clearly scoped per-Agent action; the Project-level duplicate is
  gone. Stopped panes label saved terminal history read-only and present missing
  identity as **Reconnect needed** with richer candidates. The repeated-cycle
  evaluator now launches a tasked Codex Agent and requires provider identity
  before any later terminal write.

- 2026-07-22, D35 model/effort-visible Agent launch: the new-Agent composer now
  keeps Model and Effort beside Agent Source, resolves the local harness's
  effective pair, and labels configured/model-default origins. Codex choices
  and model-specific reasoning levels come from the installed CLI catalog;
  Claude choices reflect layered model/effort settings, aliases, custom
  entries, and dominant environment constraints. Changing a model reconciles
  its effort default; changing either value is scoped to this Agent, survives
  draft-pane remounts, and crosses the typed PTY boundary through harness-native
  launch flags/config overrides without editing provider config. Discovery
  failure falls back to honestly labeled harness/model defaults and does not
  block launch.

- 2026-07-22, D34 conversation-label/tab-title ownership: the D31 recent
  browser's label no longer becomes persistent tab chrome when Resume or
  Fresh starts a Session. The browser keeps raw/native/generated discovery
  labels; the Session carries the semantic handoff as goal metadata and uses
  normal source identity until the operator explicitly renames it. A
  raw/native handoff remains summarizer input; only validated generated copy
  may seed an immediate subtitle. Persistence v6 records title ownership and
  narrowly repairs the known truncated D31 prompt leak in open and
  Recently-closed Sessions. Hosted and desktop enrichment boundaries now
  enforce six-word titles, 18-word handoffs, and reject first-person/model-
  preamble narration instead of caching it; domain language such as “based on
  AMA guidelines” remains valid. Focused launch, persistence, strip, API, and
  catalog tests exercise the reported E&M transcript case.

- 2026-07-22, D33 calm attention and state/subtitle truth: the D30 pulsing
  bell becomes a static amber dot-in-circle with no halo, glow, or animation;
  all status glyphs share explicit hover explanations, and the legend names
  the marker “unseen.” Tab acknowledgement now clears local attention before
  paint. The PTY monitor owns resize ordering (guard before synchronous WINCH
  output), and BEL consumes the completed burst while clearing working, so a
  glance cannot reveal or re-raise stale working state. Subtitle validation
  and the model prompt now agree on six words; first-person narration and
  model preambles are rejected with diagnostic reasons, including on restore
  so a bad generated phrase cannot anchor `KEEP`. Focused monitor/summarizer/
  component tests and the workspace chrome evaluator cover the regressions.

- 2026-07-22, D30 status iconography: the shared glyph module becomes a
  fixed-slot icon set — working = half-fill pie (teal, soft breathing),
  needs-you = amber bell + ping halo, finished = green circled check,
  unstarted = dashed hollow circle, shell-quiet = hollow circle — with
  the data-status vocabulary unchanged so strip, Sessions tiles, and the
  D29-aligned ⌘K rows inherit without edits. The ⌘/ cheat sheet gains an
  agent-status legend (the text channel Carbon requires). Project
  diamonds on the group chip, Sessions tiles, and rail header become
  3px vertical identity bars — status icons are now the only lamp-like
  marks in the strip.

- 2026-07-21, D27 dogfood round: nav-history module (pure, tested) makes
  ⌘[/⌘] walk app LOCATIONS (surface + active tab); recorders live in the
  workspace (rich entries) and the navigation provider (settings/spatial),
  and back/forward apply via navigateCommandSurface + the session-jump
  channel, deduped so applying never re-records. In-app CloseConfirm
  replaces the native dialog (default-highlighted Close, tab/space/enter
  macOS semantics, recovery copy); pty:confirm-close is deleted and closes
  are optimistic — strip first, stop/archive behind. Right-click menus on
  chips and tabs (HUD-styled, roving keyboard) reuse rename/color/pin/
  resume/reveal/close verbs. ⌘9 = last tab with the 9 keycap past nine
  tabs. Rail focus shows as a focus-within ring + esc hint. Settings esc
  = back. Draft chips read "New agent"; source dropdown options carry
  glyph + brand color; the attention-count pill is gone (AMENDS D21).
  Corrected 2026-07-22 after dogfood exposed Radix projecting that decorated
  option into a trigger that already owned a glyph: the trigger now supplies
  an explicit text value and renders exactly one brand mark, while each menu
  option retains its own glyph and color. A component regression test and the
  real Electron launcher evaluator check both ownership boundaries for Claude
  Code and Codex selection; the evaluator also captures the open menu.

- 2026-07-21, D27 non-interrupting development and evaluation launches:
- 2026-07-21, D26 split-view coherence (operator dogfood on the S2 ⌘D
  split): the pin now follows the TAB, not the PTY. Watching an agent
  finish is the point of "watch one, drive one", yet the split collapsed
  the instant the pinned session exited, and the stale pin id then made
  the next ⌘D silently pin something else. A pinned pane now survives
  session exit — it renders retained scrollback with the restore bar in
  place, and ⌘D on it unpins (muscle memory holds). The driven (left)
  region generalized to "whatever the workspace would show full-screen
  without a pin": a live pane, a stopped tab, the ⌘T draft page, or the
  empty-Project composer — previously switching to a zero-tab Project
  replaced the whole stage (unmounting EVERY terminal pane, violating the
  panes-stay-mounted invariant) and an active draft's full-stage overlay
  covered both halves of the split. Drafts are the only unpinnable tabs
  (nothing to watch yet); a pin whose tab is gone drops instead of
  blocking the key. Companion tracking widened from live-session tabs to
  any non-pinned tab, so clicking into the watched pane keeps a stopped
  or draft driven side up. Pin persistence follows the same rule: it
  survives with a stopped tab and reattaches to retained history on
  relaunch. The layout decision (pin reality, driven side, per-tab
  left/right/full/hidden, ⌘D toggle outcome) moved to pure, unit-tested
  `split-layout.ts` (the tab-ring.ts pattern); workspace-client renders
  every tab through one per-state pane path instead of an active-only
  overlay.

- 2026-07-21, D25 non-interrupting development and evaluation launches:
  root cause was BrowserWindow's default `show: true` plus Electron's regular
  macOS activation policy; moving EXAWATT_TEST windows to a secondary display
  changed location but could not prevent activation or help a one-display
  operator. Automated runs now create hidden, unthrottled windows under the
  accessory policy, preserving Playwright's real renderer, preload, PTY,
  screenshot, and WebGL paths without entering the Dock, app switcher, or
  foreground. Development creates a visible inactive window and promotes to a
  regular app only after a deliberate click. Production is fail-safe
  foreground regardless of leaked overrides; development/test may explicitly
  select `EXAWATT_WINDOW_MODE=hidden|inactive|foreground`. Native macOS
  coordinate-click evaluation remains necessarily foreground and now requires
  `--allow-focus`. The packaged smoke test asserts the default automated
  window is hidden, unfocused, and Dock-invisible before its PTY round trip.

- 2026-07-21, D24 chrome-model close + instant new tab: ⌘W = close (native
  confirm via `pty:confirm-close` for started live agents only; unstarted
  and stopped tabs close instantly; ledger unchanged as the backstop; the
  D23 in-app StopConfirm deleted; `pty:close-session` stops, awaits death,
  and forgets the runtime record in one main-side step). ⌘T = draft tab:
  a real strip tab with lifecycle 'draft' whose pane hosts the composer;
  ⏎ launches in place reusing the tab id, ⌘W/esc discards; drafts are
  never persisted. Keycap hints: ~120ms reveal, absolutely positioned
  overlays (zero layout shift). Task box accepts ⌘V/⌃V image paste via
  `pty:clipboard-image` (hint line teaches it). Attention monitor gains a
  resize grace window (`noteResize`) so WINCH redraws stop reading as
  work, and the working glyph calms from a rotating arc to a breathing
  orb (operator: the spin annoyed). The chrome bar pins New Agent +
  notification controls to the strip's first row (wrapped strips left
  them stranded a row down). The permission-Select keyboard regression
  did not reproduce under the pane composer — it lived and died with the
  retired floating panel; the launcher eval now asserts strict ArrowUp/⏎
  Select navigation so any recurrence fails loudly. Palette source
  overrides ride ON the draft tab (`draftSource`) instead of the
  module-pending slot, which a strict-mode remount could drop.
- 2026-07-21, D23 close-as-lifecycle: `pty:stop-session` parks a single
  live session (stop process group + flush history — `stopAll()` for one),
  the natural exit path marks it stopped, and the tab stays resumable.
  `closed-session-ledger.ts` (pure, unit-tested) holds archived Sessions —
  identity + goal + provider id — for 14 days before reaping history;
  `pty:archive-session` / `pty:closed-sessions` / `pty:reopen-session`
  round-trip it. The renderer close grammar (working → in-app ⏎/esc
  confirm; live → park; stopped → archive + ambient toast naming the
  ledger and reopen path) replaces the native dialog, which is deleted
  along with `EXAWATT_TEST_CLOSE_RESPONSE`. Stopped tabs render as
  condensed frozen chips that unfurl on hover/focus (never auto-close).
  Palette gains "Reopen closed Session" entries. Launcher eval re-targets
  the two-step grammar.

- 2026-07-21, D22 turn-state legibility: the session status glyph becomes a
  three-state system in a shared module (`status-glyphs.tsx`, used by the
  tab strip and the Sessions overview tiles): working = rotating teal arc
  (motion is the peripheral signal; reduced motion keeps the static arc,
  which stays shape-distinct from both dots), finished = solid green rest
  dot, unstarted = dim hollow ring; the amber attention ping keeps top
  priority. "Started" is main truth on the attention monitor: marked by a
  composer initial task or exact resume at `pty:create`, the first human
  keystroke arriving on the existing `pty:engage` guaranteed-human channel,
  or any raised attention (a turn-end implies a turn); exposed on the
  session list for adopt-time seeding and broadcast once as `pty:engaged`.
  A goal subtitle also implies started in the renderer, covering sessions
  from before the app updated. Fresh agent tabs stop rendering their
  default harness title — glyph-only until a rename or first subtitle
  (shells keep their title; they have no glyph). Chrome-layout eval
  extended: a fresh tab asserts glyph-only rendering and `data-status`
  transitions across all three states plus screenshots.
- 2026-07-21, D21 dogfood feedback round (operator, three findings; landed
  same day as one coherent pass): **(1) Ordinal legibility** — the strip read
  as "1 1 1 2 3 4 3 4 5": Project ordinals, global tab ordinals, and the
  amber attention count were identically styled bare digits. Ordinals now
  reveal as keycap chips only while their chord's modifiers are held
  (`useOrdinalHints`: hold ⌘ → tab digits, ⌘⌥ → Project digits, ~350ms hold
  delay so ⌘C-speed chords never flash; reveal retargets instantly when ⌥
  joins or leaves, resets on blur/hide), and the per-Project attention count
  is an amber pill badge. Doctrine unchanged; tooltips still teach the
  chords. **(2) Complete ⌘T keyboard path** — the compact composer's
  focus was a single rAF racing a conditionally-mounted textarea; focus now
  belongs to an effect keyed on `open`, so every summon path lands in the
  goal field. ↑/↓ with an empty goal field cycles the Agent Source through
  `AGENT_SOURCE_ORDER` (with text present arrows stay caret keys), ⏎ starts
  (already true), and an inline hint line teaches ⏎/↑↓/⇧⏎/esc. **(3)
  Durable session goals** (tactical ENG-021 slice) — root cause of "reopened
  Exawatt shows the last micro-task": the subtitle was ephemeral, keyed by
  PTY id, and regenerated from the last 2,500 chars of scrollback while the
  composer task was never persisted nor re-supplied on resume. Summaries now
  key by durableSessionId end-to-end (summarizer store, pty:context payload,
  pty:list ride-along, renderer state), persist per tab in the layout with
  the composer's `initialTask`, seed back on load, and re-anchor the
  summarizer on resume via metadata-only `statedTask`/`restoredSubtitle`
  create options (never written to the process). The summarizer captures a
  durable per-Session head and passes the current goal to each sweep with a
  KEEP contract — the model affirms the standing goal instead of rewriting
  it from recent activity; stopped tabs and Sessions tiles keep showing
  their goal.

- 2026-07-21, D19 amendment — system-shortcut truth (operator: "it shouldn't
  just refuse those hardcoded system shortcuts, because the user may change
  those in sysprefs"): the hardcoded ⌘⇧3–6 refusal is replaced by the
  machine's real symbolic-hotkey table. Electron main reads
  `~/Library/Preferences/com.apple.symbolichotkeys.plist` via `plutil`
  (missing file = verified untouched prefs; unreadable = unverified) and the
  renderer merges it over an Apple-defaults table
  (`src/lib/shortcuts/system-shortcuts.ts`, pure + unit-tested: NSEvent
  modifier-mask decoding ignoring fn/numpad device bits, ANSI virtual-key →
  binding mapping, labels for common ids). Settings then reports truth:
  verified conflicts block with the owning feature named ("macOS uses ⇧⌘4
  for 'Save picture of selected area as a file' — free it in System
  Settings → Keyboard"), user-disabled/rebound combos bind cleanly (the
  operator's own machine has Mission Control ⌃↑/⌃↓, input-source ⌃Space,
  and Dock-hiding ⌥⌘D disabled — all now bindable), and the web build warns
  without blocking since it cannot read prefs. Chord steps are checked too
  (a chord whose first keystroke the system eats is dead). In-app conflicts
  keep the existing registry check; third-party global hotkeys are not
  detectable without private APIs and are documented out of scope.

- 2026-07-20, D19 shortcut doctrine follow-ups (operator, same-day dogfood on
  the D18 remap): **(1) ⌘⇧3 Spatial never fired on a real keyboard** — macOS
  registers ⇧⌘3/4/5/6 as system screenshot hot keys and consumes them before
  any app receives the keydown. Every eval stayed green because synthesized
  Playwright keystrokes enter below the system shortcut layer; only real use
  caught it. The altitude family moves to ⌃⌘1/⌃⌘2/⌃⌘3 (registry default +
  menu accelerator seeds); display order renders ⌃ before ⌘ per macOS
  convention while ⌘⇧ combos keep the app's established order; Settings now
  rejects any ⌘⇧3–6 binding for any shortcut with an inline "captured by
  macOS for screenshots" error. **(2) ⌘⇧[/⌘⇧] skipped open zero-Session
  Projects** (the operator: "I'm not sure if they're open or not") — the pure
  ring now emits one stop per open empty Project; cycling lands on its
  composer empty state and continues past it in both directions, and a
  workspace of only empty Projects still cycles. ⌘1–⌘9 ordinals deliberately
  keep numbering real tabs only. Ring unit tests cover landing, leaving,
  empty-only workspaces, and ordinal stability.

- 2026-07-20, D18 dogfood feedback round (operator, eleven findings; landed
  same day as one coherent pass): **(1) Offline authority** — the flight
  black screen root-caused to every `/workspace` navigation re-running the
  middleware plus the layout's `SiteHeader`, both awaiting a remote
  `supabase.auth.getUser()` whose result was discarded for public paths, with
  no error/loading boundary and a solid near-black Suspense fallback. Public
  paths now skip auth entirely, protected paths decide signed-out from cookie
  presence and fail open on retryable network errors, the header reads the
  cached session client-side, `/settings` lost its server gate, and app-level
  `error`/`global-error`/`loading` boundaries plus visible fallbacks landed.
  Unit tests pin the middleware's zero-network contract; `eval:electron:offline`
  drives the altitude loop with all non-loopback requests aborted (blocked
  request count: 0 — the loop no longer even attempts network). **(2) Shortcut
  doctrine** (amends D12/D13) — ⌘1–9 selects Session tabs (fixed family,
  ordinals shown on tabs), ⌘⇧1/2/3 are the altitude destinations, digit
  matching is by physical key code so shifted digits work on any layout; the
  tab ring is extracted pure (`tab-ring.ts`, unit-tested) and the stale-active
  recovery can no longer become a fixed point (the reported "stuck at a
  stopped codex tab"); browser-level probes cycle through and past stopped
  tabs in both directions. **(3) Attention legibility** — the attention
  monitor emits working/quiet transitions as shared activity truth; tabs and
  Sessions tiles show breathing-teal working / hollow quiet / amber needs-you
  glyphs. **(4) Notifications** — dock badge + bounce moved behind
  default-off `notifications.dockBadge` (it was unconditional and
  unclearable), with a Settings card for both switches. **(5) Context
  tuning** — subtitles ask for the durable multi-turn goal (≤6 words) fed by
  stated task + session head + tail, seeded instantly from the composer's
  task; the S4 recap popup retired for an ambient inline context-bar line
  (expires on keystroke or 45s, nothing to dismiss). **(6) Composer
  posture** — collapsed to a "New Agent" summon with an anchored two-row
  panel; the Source select's wrap bug root-caused to the shared
  SelectTrigger's blanket `[&>span]:line-clamp-1` breaking flex children
  (now slot-scoped). **(7) Rehydration idempotency** — new
  `eval:electron:idempotency` proves N repeated quit→relaunch→workspace recovery
  generations keep an identical persisted tab set, exact identities, clean
  lifecycles, no orphans, and cumulative history (3 generations green).
  **(8) Permission attribution** — TCC usage descriptions explain that
  agents read/write opened project folders; a Settings explainer covers why
  prompts name Exawatt and that grants persist under the D17 identity (the
  re-prompt churn itself was the pre-D17 ad-hoc signature). Mid-round
  operator request: EXAWATT_TEST windows now open on a non-primary display
  so eval runs stop popping over the working screen. The operator's
  permission-popup screenshots did not upload (blank placeholders), so the
  exact dialogs remain uninspected; the TCC/Little-Snitch analysis is
  inference from entitlements and the D17 findings. Gate: 500+ tests, lint,
  type-check, electron compile, chrome-layout, offline, exact-resume,
  lifecycle, and idempotency evals.

- 2026-07-12, proactive QA sweep (agent-driven daily-loop simulation: two
  projects, five tabs, rename, split, background bell → ⌘J, exposé, switcher,
  declared roadmap launch, altitude round trip, small window, quit → relaunch
  resume): two real bugs found and fixed. (1) **⌘E rename appended instead of
  replacing** — the inline editor autofocused with the caret at the end, so
  typing produced "Shellbeta scratch"; the old name now arrives selected
  (standard rename semantics). (2) **Exposé scrollback previews never
  rendered** — the preview fetch marked sessions as fetched before the IPC
  resolved, and its per-effect cancel dropped any batch that outlived one
  workspace re-render, freezing tiles on "…" forever; results are
  sessionId-keyed so they now apply across re-renders (unmount-only guard,
  regression test with a mid-fetch re-render). Preview quality:
  decoration-only lines (fish's ⏎ marker, TUI borders, ruler runs) are
  filtered while bare prompt glyphs stay. Everything else held: attention
  badge + ⌘J landing, exposé all-tabs mirror with state labels and roadmap
  chips after relaunch, scrollback restore with the designed
  restored-not-resumed lifecycle, zero console errors. Gate: 423 tests, type,
  lint, electron compile, rail + spine evals.

- 2026-07-12, D13 landed: shortcut definitions now carry an optional behavioral
  binding policy. Terminal, Sessions, and Spatial are `universal-command`
  shortcuts; on macOS the editor accepts one Command-modified combination and
  rejects bare, Option-only, Control-only, or chord bindings with an explanatory
  inline error. Windows/Linux policy uses Control. Physical-code checks reserve
  `⌘⌥1`–`⌘⌥9` and `⌘⇧[` / `⌘⇧]`, including Option-produced
  characters such as `¢`. Contextual shortcuts and go-chords remain flexible.
  The Settings component test drives rejection, valid `⌘4` persistence, and
  the Project reservation; pure tests cover platform and policy boundaries.
  Evidence: 418 tests, type-check, zero-warning lint, and Electron compile pass.

- 2026-07-12, product-lens pass: exposé empty-state copy no longer claims the
  altitude only shows "running" sessions (it shows every open tab since the
  all-tabs fix). Menu **Go → Sessions made directional** — already-open
  overview focuses the selected tile (`FOCUS_SESSIONS_EVENT`) instead of
  silently no-oping; D12's typed activation owner (`activateCommandAltitude`)
  landed the same behavior concurrently and its model supersedes the local
  fix. `electron-spine-eval` migrated to `withElectronApp` (it was the last
  eval on raw `electron.launch` — no watchdog, unbounded on a hang).
  Verified post-rebase against D12 via Electron eval (menu:command → focus
  lands on a tile, overview stays open) plus the full spine eval.

- 2026-07-12, D12 landed: the navigation manifest and shortcut registry now
  expose absolute `⌘1` Terminal, `⌘2` Sessions, and `⌘3` Spatial
  destinations. One typed activation owner routes or performs the active
  focus/recenter action for the altitude rail, global/go shortcuts, xterm
  capture layer, command palette, and native menus; `⌘O` and `⌘⇧M` no
  longer toggle views. Project ordinals moved to `⌘⌥1–9` with physical
  `Digit1`–`Digit9` matching so Option-produced characters remain layout-safe, while
  `⌘⇧[` / `⌘⇧]` and route history retain their prior ownership.
  Literal rail clicks, active destinations, focused Spatial search, focused
  xterm, exact Spatial state return, reduced motion, menu accelerators, and a
  live PTY round trip pass in `eval:navigation`, `eval:navigation:spine`, and
  `eval:navigation:electron`. Visual screenshots were inspected at 1440×900.
  Evidence: 399 tests, type-check, zero-warning lint, and Electron compile pass;
  no Canvas/R3F code changed.

- 2026-07-11, D11 regression review: reproduced the operator-reported
  `⌘⇧[` / `⌘⇧]` failure with an xterm-origin event that had already been
  consumed before the workspace's bubble listener. Fixed ownership rather
  than key matching: the fixed tab ring and `⌘1`–`⌘9` ordinal family now run
  on capture, ahead of xterm and the overlapping global `⌘[` / `⌘]` route
  history; unshifted brackets remain history. The click-driven command eval
  now presses both shifted brackets from the active terminal and proves the
  original tab returns. The review also made Escape dismiss Sessions after
  focus moves to persistent shell chrome, added a 1.2 s failed-route teardown
  to the shared transition owner, derived altitude gestures and the narrow
  Spatial help hint from live registry/manifest state, encoded camera storage
  key segments to prevent Project/Agent id collisions, and rejected extreme
  stored camera values. A live Spatial run then exposed registry-derived
  shortcut text diverging between server markup and an initialized client;
  the shared effective-shortcut hook now uses an explicit empty server snapshot
  and updates only after hydration. Focused regression coverage plus the full
  command-altitude evaluator exercise these contracts.

- 2026-07-11, D11 landed: the altitude rail is an explicit Electron `no-drag`
  island and active levels now focus Terminal/Sessions or recenter Spatial.
  Global Meta/Control commands escape focused text inputs while ordinary input
  and cmdk editing remain untouched. Sessions uses nonmodal region semantics,
  inert obscured workspace chrome, origin-preserving roving focus, arrows/J/K,
  Enter, Escape, and active-level refocus. The typed surface manifest and live
  shortcut registry now drive the rail, workspace legend, palette, searchable
  help, and ARIA; Spatial fixed keys are searchable and shortcut help has a
  compact narrow-layout button. Spatial query/status filters round-trip in the
  URL, semantic return addresses update continuously, finite camera viewports
  persist per altitude/Project/Agent/projection in session storage, and the
  Electron shell restores the last command surface on startup. A root command
  navigation provider owns all Terminal ↔ Spatial clicks, shortcuts, menu and
  palette commands, plus Agent-to-Session route completion; routing begins on
  the next frame, motion settles in about 320 ms, and reduced motion uses a
  90 ms opacity handoff. Evidence: 20 focused tests, `pnpm type-check`, lint,
  click-driven `eval:navigation`, `eval:spatial`, and the R3F gate (100/100 on
  all five scenes, operations board 7 draw calls). The renderer/Electron spine
  checks prove computed `no-drag` and literal control clicks. The separate
  AppleScript coordinate-click evaluator is checked in but could not run on
  this host because macOS Accessibility permission is denied (`-25211`); this
  is an environment evidence gap, not a renderer workaround.

- 2026-07-11, D10: menu accelerators now follow the registry — the renderer
  syncs effective bindings over `menu:sync-accelerators` (validated pattern,
  known commands only) and the menus rebuild; a chord rebind clears the
  column. Tab strip renders as a `div` while its rename editor is open
  (EditableChrome), eliminating the input/button-inside-button hydration
  warnings; exposé ⌘O derives open-state from the URL at gesture time so a
  toggle during the mount transition closes instead of re-opening. Spine
  eval: 27 checks incl. a rebind-sync round trip and a no-nested-markup
  assertion, parametrized by EXA_BASE (a concurrent agent's dev server on
  :7000 was serving stale renderer code during verification — evals must
  pin their own server). Audit arc closes: peek-before-navigate rejected,
  mode-in-URL deferred to Demo Scenario Source.
- 2026-07-11, D9: workspace verbs (⌘T/⌘N/⌘W/⌘J/⌘O/⌘D/⌘E/⌘B) now register under
  a never-activated `workspace` context — the workspace key layer resolves
  every combo from the registry (rebindable in Settings, conflict-checked,
  listed dynamically in a now-searchable ⌘/ overlay; the static WORKSPACE_KEYS
  list is gone, ⌘1–9 and ⌘⇧[/] remain two documented fixed families). ⌘K
  gained a frecency Recent group on empty input (localStorage, stable ids)
  and a spatial projection-toggle verb; global chords are gated while the
  help modal is open; exposé accepts plain j/k (modifier combos untouched —
  an early j/k version swallowed ⌘K, caught by the extended spine eval);
  per-surface window titles via the root metadata template + thin segment
  layouts; `aria-keyshortcuts` on the rail; the web OAuth callback now lands
  on /fleet like sign-in. Spine eval extended to 25 checks with renderer
  error capture; 3 consecutive full passes.

- 2026-07-11, D8 W1-W3: navigation manifest (`src/components/nav/surfaces.ts`)
  now drives the palette navigation/legacy groups, go-chord targets, header
  legacy menu, and footer suppression; the altitude rail renders on every
  Electron surface; Spatial's `/fleet` back link removed; go-chords cover all
  three altitudes (`g w`/`g o`/`g m`) with legacy chords relabeled; ⌘[/⌘]
  traverse router history from chrome; ⌘K always shows Projects — registry
  merged with a durable local `recentProjects` record, an add-project row,
  and a visible signed-out row (`listProjects` now throws when unauthenticated
  instead of returning RLS-empty success). New `eval:navigation:spine`
  packaged-Electron check covers all of the above; stale `window.electron`
  mocks in the navigation evals updated to the current preload surface.
- 2026-07-11, D8 W4: macOS menu bar now mirrors the app's verbs — Settings…
  ⌘, (registered, chrome-level invariant), a Go menu (Command Palette,
  Terminal / Sessions / Spatial, Back / Forward), and a Session menu (new
  Claude Code / Codex / Shell, rename, split, close, jump-to-needs-you).
  Renderer-owned combos display via `registerAccelerator: false` so the
  renderer stays the single keyboard authority (rebinding and terminal-focus
  semantics stay truthful); menu commands route over one `menu:command` IPC
  channel into the same actions the keyboard uses. Verified: menu launches a
  shell from a non-workspace page, Back works from the menu, ⌘O still opens
  exactly one exposé. D8 closes; spine eval extended with menu assertions.
- 2026-07-10, D0-D1: full lint now excludes nested generated agent worktrees;
  the production app packages a CSP-protected standalone Next renderer instead
  of loading `exawatt.ai`; Electron extracts the signed renderer archive to a
  content-addressed local cache, starts it on loopback, and opens `/workspace`.
  Root web dependencies no longer bloat the Electron main archive; rebuilt
  `node-pty` and its executable helper are packaged explicitly. Privileged IPC
  validates the renderer origin, navigation is constrained, permissions and
  webviews default denied, and the packaged Playwright smoke proves local
  renderer + preload + real shell PTY round trip. Baseline: 285 tests, type,
  lint, Electron compile, and packaged smoke pass.
- 2026-07-10, D2: `pnpm electron:install-dogfood` now enforces clean `master`,
  serializes installers, builds and smoke-tests the app, copies through a
  same-volume staging bundle, rolls back on replacement failure, embeds the
  source SHA, and writes update state. A running older build watches that state
  and shows a quiet restart-when-convenient notice without quitting. The full
  workflow and the independently copied app both passed the packaged PTY smoke
  in an isolated temporary Applications directory.
- 2026-07-10, D3: workspace persistence v3 stores one exact provider ID per
  tab. Claude receives an Exawatt-generated UUID at creation and resumes only
  with that UUID. Codex versions without start-time ID injection use an
  explicit cwd-filtered rollout picker; selecting once persists the exact ID.
  Relaunch restores ended tabs without spawning and offers tab, Project, and
  all-eligible resume actions. Old layouts migrate to identity-missing without
  inference. The packaged evaluator launched four fake Claude agents in one
  Project, persisted four distinct IDs, relaunched with zero PTYs, and resumed
  four new processes against the same four IDs. Unit and integration total:
  292 passing tests plus packaged smoke and four-tab resume evaluator.
- 2026-07-10, D4: xterm now keeps 50,000 lines with a bounded 4 MB
  main-process replay buffer and a cursor-based snapshot/live handoff. `Cmd+F`
  searches without blocking to count every match; `Cmd+C`, `Cmd+V`, `Cmd+A`,
  and the Copy/Paste/Select All context menu use deterministic Electron
  clipboard IPC. HTTP(S) and parsed local file references cross validated IPC
  boundaries. Image paste writes a mode-0600 temporary PNG, inserts its quoted
  path into the live harness prompt, and removes it at app shutdown. WebGL is
  preferred and falls back to the canvas renderer on load or context failure.
  The packaged evaluator searched line 1 after 20,000 lines, copied all output,
  pasted text through the keyboard, and verified a real image clipboard item
  became a private temporary file. Unit total: 295 passing tests.
- 2026-07-10, D5: the active-session context bar exposes the full cwd through
  its title/focus text while keeping both its leading identity and final path
  components visible in constrained layouts. Tab, overview, and reentry
  summaries use readable prose typography and two-line bounds. Lattice and
  Fleet moved from the primary header into the authenticated legacy menu. F6
  crosses the terminal/chrome focus boundary; Escape returns chrome focus to
  the terminal while xterm, dialogs, search, rename, and context menus retain
  their own Escape. The packaged evaluator proves the focus round trip and
  captures non-overlapping 800x600 and 1400x900 layouts.
- 2026-07-10, D6: a persisted workspace bell toggle defaults off and reuses
  the existing attention monitor. When opted in, only background attention
  transitions create quiet native notifications; clearing attention closes
  the notice, and clicking it focuses Exawatt and selects the exact originating
  session. Notification policy/copy and settings parsing have focused tests;
  the packaged chrome evaluator proves default-off state and persistence.
- 2026-07-10, D7 implementation: `electron-updater` is packaged with a bounded
  runtime dependency graph and reports checking, availability, download,
  failure, ready version, and live-session restart impact through narrow IPC.
  Auto-install is disabled; only the explicit restart command calls
  `quitAndInstall`. GitHub Release config produces arm64 DMG/ZIP/update metadata;
  CI requires Developer ID signing, App Store Connect API-key notarization,
  codesign/Gatekeeper/stapler verification, and exact tag/package SemVer.
  Parsed `stagingPercentage` metadata supports controlled rollout. Local
  unsigned packaging, packaged updater IPC, failure/restart UI, and metadata
  tests pass. Decision `0009` records the channel and the remaining credential
  activation gate; no signed artifact or live update is claimed yet.
- 2026-07-10, D7 activation attempt: CI successfully imported the Developer ID
  certificate, signed the app, and authenticated to Apple notarization. Apple
  correctly rejected two unsigned Sharp binaries nested in the standalone
  renderer archive. Release packaging now opens that archive after certificate
  import, signs and verifies all nested native binaries with secure timestamps,
  and reseals its content hash before app signing. The local release-package
  path signs both binaries in noninteractive evaluation mode and passes the
  packaged renderer, preload, and PTY smoke test.
- 2026-07-10, D7 signed baseline and channel correction: `v0.1.0` passed
  Developer ID signing, Apple notarization, deep codesign, Gatekeeper, and
  stapler checks in CI and again from the downloaded public DMG. Anonymous
  inspection then exposed a planning conflict: GitHub returns `404` for release
  assets in the private source repo, and shipping a repository token in the app
  is forbidden. Decision `0009` now keeps GitHub as the private source-linked
  archive and uses a public Supabase Storage bucket for the generic updater
  feed. The bucket has an explicit 300 MiB limit; CI uploads artifacts before
  metadata, verifies anonymous reads, and retains three artifact versions. A
  temporary real channel passed upload/read/list/prune cleanup.
- 2026-07-11, D7 activation: signed/notarized `v0.1.0` and `v0.1.1` proved the
  channel, but the live restart exposed Electron 35's vendored Squirrel.Mac
  bug on macOS 26: ShipIt registered with `runs = 0` and waited forever on a
  launchd semaphore. Electron's upstream fix is present in 42+; Exawatt moved
  to Electron 43 and current release tooling. `v0.1.2` established the fixed
  signed baseline and `v0.1.3` passed the normal clean-CI build, secure
  timestamp, notarization, stapler, Gatekeeper, GitHub archive, and public
  Supabase publication path. An independently downloaded `v0.1.2` then
  discovered, downloaded, verified, and installed `v0.1.3`; the UI warned that
  one live PTY would stop, and the app quit, updated, and relaunched without a
  LaunchAgent or manual `launchctl` command. D7 is landed. The local installer
  remains only a development fallback.
- 2026-07-12, D14: Project opening is now inert and durable, `Command-N`
  presents a curated/searchable Project library with Browse, reviewed
  parent-folder import, and moved-path rebinding, and the workspace starts
  Agents through a source-visible composer with an optional first task.
  Per-Project source recommendations survive a full app restart; shell remains
  an explicit Project tool. The final baseline is 437 passing tests, clean
  type/lint/Electron compile and production build, a literal two-launch
  Electron evaluator covering 23 opener/composer/persistence/restart checks,
  the live terminal-to-Spatial navigation evaluator, and the complete roadmap
  rail evaluator with all checks passing.
- 2026-07-12, D14 corrective slice: open Projects are now explicitly
  cross-surface objects instead of an accidental side effect of Agent grouping.
  The local source publishes persisted Projects through a shared catalog and
  workspace-change event; Sessions renders zero-Session Project groups, and
  Spatial renders drillable zero-Agent zones. Directory-backed identity keeps
  the cluster stable when the first Agent starts. Focused selector/component
  tests and a literal Electron empty-to-active lifecycle evaluator guard the
  bijection.
- 2026-07-12, D15: startup is now a measured two-phase desktop bootstrap. The
  real BrowserWindow appears with a local CSP-restricted Exawatt launch frame
  before renderer extraction, Next readiness, Session persistence, Supabase,
  updater, or PTY modules finish. Its determinate readout follows actual runtime,
  renderer, durability, and navigation milestones; motion uses only transforms
  and respects reduced motion. Warm renderer servers start before `app.ready`,
  cold extraction yields to the first frame, heavy command modules load after
  the window exists, and all renderer caches except the active version are
  pruned after startup. The new `eval:electron:startup` evaluator measures cold
  and warm process connection, first window, first visible content, renderer
  navigation, and usable workspace. Against the installed pre-D15 build with
  isolated user data, cold blank wait moved from 3.07s to 0.39s (87% earlier)
  while usable workspace stayed close at 3.21s. Warm runs show feedback around
  0.38s and the workspace around 1.19s. An unpacked renderer-in-app experiment
  was rejected after measurement: signing/validating its 10k-file tree made
  every warm launch slower even though it removed first-version extraction.
- 2026-07-12, D16: the command continuum now preserves Session identity across
  process lifecycle and altitude. In Sessions, fixed `Command-Shift-[` / `]`
  changes the underlying active tab and synchronizes the overview's roving
  selection/focus. At the local fleet source boundary, live PTYs are merged
  with persisted open tabs; stopped tabs therefore remain explicit
  Session-backed Agents in Spatial, render as dotted octagons, remain keyboard
  and pointer selectable, and open the exact stopped tab's restore panel. The
  merge is tolerant of legacy workspace layout keys and de-duplicates a live
  PTY by both runtime and durable Session identity. Packaged transition testing
  exposed a persistence-lag edge: an exited PTY unknown to the last layout was
  ignored on workspace remount. Rehydration now reconstructs it as a stopped
  durable tab, preserving honest parity without treating the process as live.
  Evidence: 450 tests, clean type/lint/Electron compile, 100/100 R3F rubric,
  production Electron build, and three consecutive packaged parity passes plus
  a settled-board screenshot.
- 2026-07-19, D17 implementation gate: the dogfood build now selects the sole
  valid Developer ID Application identity from the local Keychain, with an
  exact-fingerprint override required when selection is ambiguous. It signs
  Mach-O code hidden in the renderer archive before electron-builder signs the
  helpers and enclosing app. The installer strictly verifies the built,
  staged, and installed copies; rejects ad-hoc, unsigned, cross-team, or
  wrong-identifier code; preserves a stable prior signer boundary; rolls back a
  failed post-swap verification; and records only the public program and Team
  identifiers with the build SHA. A missing or mismatched identity was forced
  and left the prior app untouched. A full temporary-root install passed the
  packaged PTY smoke, strict verification for the app plus 25 nested and two
  archived native code objects, and signed install-state validation. Unit,
  type, lint, Electron compile, formatting, and all 468 application tests pass.
  Clean-`master` SHAs `f0aff07` and `20b3578` then passed the same gates and
  atomically replaced `/Applications/Exawatt.app` without restarting the
  running process. Their embedded build SHAs and code-directory hashes differ,
  while the application identifier and Team identity are identical. Automated
  two-build identity acceptance is complete. The remaining literal acceptance
  evidence is the operator-observed Little Snitch allow/deny preservation check
  with no program-modification or new-identity alert.
- 2026-07-20, D17 delivery-transaction review hardening: the installer now
  builds a detached immutable snapshot of one committed SHA instead of the
  mutable shared checkout. `agent:land` and manual delivery share a
  repository-scoped lock, while a target-scoped lock protects the installed app
  across separate clones. The signer policy is pinned to Exawatt Team
  `5G5A77XLHZ` and the eligible fingerprint is fixed for the whole transaction;
  strict evaluation also requires a code-directory hash, secure timestamp, and
  hardened runtime. Existing apps use macOS `RENAME_SWAP`, so
  the prior verified app remains an atomic rollback object until the new app
  passes in-place verification, with deterministic next-run crash recovery.
  Regression tests exercise lock serialization, immutable snapshots, signer
  mismatch, explicit unsigned migration, atomic exchange, rollback, and all
  recovery states. The focused delivery suite has 22 passing cases; all 476
  application tests, type-check, lint, and Electron compile also pass. Two
  signed temporary-root installs from hardening commits `f557e2b` and
  `362d77f` passed packaged PTY smoke plus strict verification of the app, 25
  nested code objects, and two archived native objects. Their code-directory
  hashes differed while `com.exawatt.app` and Team `5G5A77XLHZ` remained fixed;
  the second install exercised the full existing-app atomic exchange and left
  neither transaction residue nor a registered snapshot worktree. A forced
  ineligible-identity preflight left the first signed app and its install state
  untouched. Literal Little Snitch allow/deny observation remains the only
  unclosed D17 acceptance item.

## Findings log

- 2026-08-16 (D58, landed): **BUG-004 and BUG-019 were the same disease and are
  fixed together.** The link boundary had four independent owners over the same
  pixels; the "Do you want to navigate…" dialog is xterm CORE's unclaimed OSC 8
  default, whose `window.open()` Electron denies (incident `0013`). Geometry had
  no owner at all. Full narrative in the D58 section at the end of this document.

- 2026-08-16 (triage, feedback row
  `d97ef0be-a320-4525-b84d-3895a32f70b5`, operator on dogfood 0.1.10): **live
  CLI text abuts the left edge of the viewport.** The screenshot shows no
  usable breathing room between xterm content and the app boundary. BUG-019
  owns a small but geometry-sensitive correction: add a deliberate terminal
  inset while keeping fit-addon column calculation and PTY resize truth aligned,
  so visual padding does not clip the final column or lie about terminal width.

- 2026-08-16 (triage, feedback row
  `4cb05541-7bdc-4873-abf9-546166ead6f8`, operator on dogfood 0.1.10): **the
  macOS application menu exposes only a build SHA, not the human app version.**
  `electron/main/main.ts` currently renders `Build <sha>` directly. FIX-014
  makes the packaged version the primary menu fact; the SHA may remain quiet
  diagnostic detail but cannot substitute for `0.1.10`-style product identity.

- 2026-08-16 (triage, feedback row `39cac400-19d1-4c1b-89a1-f46ee1036bd0`,
  operator on dogfood 0.1.10): **a late Agent launch can steal focus after the
  operator has moved on.** The operator opened Command-T, started an Agent,
  and switched to another Agent while launch remained pending; readiness then
  reactivated the new Agent. BUG-018 owns the bounded interaction contract:
  launch completion may retain focus only while its originating draft/tab is
  still active. If the operator has switched, the Agent starts quietly in its
  own tab. This is distinct from the batch-resume beachball and its
  focus/altitude symptom, which remain BUG-012 / incident `0008`.

  Call sites located the same day (second triage pass), correcting the
  mechanism above: this is **not** a readiness event — no ready subscription
  activates a tab. `launchHere` awaits `api.createSession`, which is unbounded
  (a new worktree, a cold provider — the "spinning for a long time"), and BOTH
  of its completion branches assert the selection after that await with no
  check on where the operator now is: `use-workspace-state.ts` ~1588 (the ⌘T
  `reuseTabId` branch, promoting the draft in place) and `addSession` ~776/784
  (the non-reuse path), each writing `activeTabId` and then calling
  `setActiveDir(...)`. `terminal-pane.tsx`'s `if (activeRef.current)
  term.focus()` then converts that activation into keyboard focus, which is
  why it reads as stolen focus rather than a tab change. So the defect scales
  with launch latency in exactly the wrong direction: the slower the launch,
  the likelier the operator has correctly moved on, and the likelier it is
  yanked back. The fix separates the two jobs those branches conflate —
  promoting the tab to live must always happen; asserting the selection must
  happen only while the launching tab is still its Project's active tab at
  resolve time. Guard on operator position, not on elapsed time or window
  focus.

  FIXED 2026-08-16 — and BROADER than the two branches above. The
  implementation pass counted every writer of `activeDir` / `activeTabId` and
  found roughly a dozen, several of them post-`await`, each with its own copy
  of "make this the operator's position". Guarding the two named branches
  would have fixed the report and left the shape that produces the next one.
  See D56: one rule in `nav/operator-position.ts`, one door
  (`moveOperator`), every asynchronous mover claim-gated.

- 2026-08-16 (triage, operator on dogfood 0.1.10): **three daily-driver
  regressions re-enter the backlog.** BUG-004 now has two new reports
  (`f2739647-dc56-4ee4-8132-1f3a3be06cee`,
  `55ef22d5-cbde-43fa-98bd-5f130a3d32e5`): Codex links do not activate and
  right-click cannot copy a link, widening the earlier local-path failure to
  the full link interaction boundary. BUG-017
  (`21f29c03-662e-41f0-86c1-850c2a8c97a7`) records duplicate keyboard hints
  in the New-Agent composer. BUG-012's new batch-resume beachball and
  focus/altitude jumping evidence lives in incident `0008`, which remains the
  diagnostic owner.

- 2026-08-13 (triage, feedback row `f05da191-85ce-4676-a2b9-b7114f8752de`,
  operator on dogfood 0.1.9 `0cb5eba`): **resume has no keyboard path and no
  ⌘K verb.** "There's no cmd+k or discoverable keyboard shortcut for resume
  this agent." **FIXED same day as D53 (`b9e26fc`)** — see the D53 section
  below. Today resume exists only as the
  pointer-driven `Resume project N` control in the recovery bar (and the
  per-Agent affordance beside it), so the one verb that brings a parked
  fleet back is the one verb that requires the mouse — against the D9
  keyboard-authority rule (every daily verb is rebindable and palette-
  reachable) and the ⌘K-is-a-backstop rule (a verb needs BOTH a chord and
  visible affordance). Scope when it lands: a rebindable chord for resume
  this Agent, its Project-scoped sibling for the recovery bar's `Resume
  project N`, ⌘K verbs for both, and cheat-sheet entries; the D36 recovery
  hierarchy (Resume N Agents / Resume This Agent) already names the two
  scopes, so this is a keyboard surface over an existing contract, not a new
  recovery model. Landed exactly at that scope: `⌘⌥R` this Agent, `⌘⌥⇧R` the
  bar's own default scope, contextual ⌘K rows, keycap hints on the bar, and
  ⌘/ entries through the registry. Recovery semantics unchanged.

- 2026-08-11 (eval repair, landed `1a5d449`): the last "Open shell in"
  drivers are retired from the eval fleet — the same rot family as
  BUG-010/BUG-011, found because the ENG-008 E5 and ENG-038 landings had to
  record `eval:electron:tenancy` as red-on-master in their landing notes.
  D49 replaced the composer's "Open shell in <project>" button with the
  setup-card launcher, and nine scripts still clicked it. One shared helper
  now owns the current contract (`openShellFromLauncher` in
  `scripts/lib/electron-eval.mjs`: expand the composer if collapsed → "All
  engines and models" → the catalog's explicit "Shell in <project>" Project
  tool), and all nine route through it, so the next launcher redraw is a
  one-place repair. The tenancy eval's Demo-palette assertion also stopped
  matching the retired "Start Agent with"/"Open shell in" labels and now
  asserts zero `[data-launch-configuration]` rows — the Start group the
  `personalVerbs` gate removes inside Demo. Proof strength intact: no check
  deleted, `eval:electron:tenancy` runs its full 48 checks green under
  `EXAWATT_TEST=1` against a worktree dev server (live PTY survives the
  bench and Demo round trips plus a relaunch; Demo populates every
  altitude), and `eval:navigation:electron` passes end-to-end. What the
  sweep did NOT absorb is tracked as BUG-014: roadmap-rail's S4
  declare-at-launch popover and the packaged-app evals' legacy
  `Agent Source` Customize select are DIFFERENT retired affordances whose
  rewrite needs D49's landed log and packaged-app runs.

- 2026-08-07 (D52, landed): the first pass run entirely under D51's gate
  contract, and the gates earned their keep immediately.

  - **BUG-003 was misnamed by its own report.** "The opencode model list
    renders past the viewport with no scroll" reads like a missing
    `overflow-y`, and the list had one. The real defect is that its cap was a
    CONSTANT `max-h-72` — a height nobody had promised. Radix places the
    popover with the room it measures; when the trigger sits low in a short
    window there is not 18rem below it, so the menu flips upward and, being
    taller than the space above, hangs off the TOP edge. Measured at
    `listTop: -16` before the fix, with the scroll container's own top edge
    off-screen, which is why scrolling could not recover the missing options.
    opencode's catalog is the largest of any source, so it is simply where a
    cap that was always wrong became visible. The fix is the idiomatic one:
    cap by `--radix-popover-content-available-height`, let the list flex
    inside it, add collision padding. The 560px-tall window is now a
    launcher-bench gate, verified by sabotage — restoring the constant
    reproduces `top: -16`.

  - **Both quarantined gates are repaired.** `eval:workspace:chrome` asserted
    D46's configuration ribbon, radios, Customize and "All launch
    configurations"; D49 shipped a setup row, cards, an attached drawer
    handle and "All engines and models". The contract those assertions
    protect is unchanged — the composer must offer a chooser, a way into the
    detail, a way to everything, and Start — so it was restated against what
    ships rather than deleted. Two traps on the way: the drawer is entered
    the way it ships, not by a button that no longer exists; and
    `getByLabel('Agent permissions')` resolved to the LEGACY hidden Select,
    so the gate now matches the OptionMenu's own accessible name
    (`Permission: …`), which carries its value. D49's Start regained
    `data-agent-start-button`, the hook the gate needs to check that Start
    survives a narrowing window — losing it is how the gate rotted.
    `eval:navigation` hung on `getByRole('button', { name: 'working' })`
    because the chips now carry a full accessible sentence and D30/D33/D40
    renamed the state; it anchors on `/^Working:/` and asserts the status is
    AMONG the filter, since the `active` signal selects working and
    reviewing and equality encoded a narrower contract than the product has.

  - **A gate can rot by being flaky, too.** The repaired chrome gate passed
    standalone and then failed inside `agent:land` on "Permission menu did
    not restore keyboard focus": Radix returns focus on its own schedule and
    the assertion sampled `document.activeElement` one tick after the key.
    It now polls the contract with a bound. Worth naming because an agent
    who cannot trust a gate stops running it, which is how the previous two
    got where they were — and because the first repair attempt
    (`locator(':focus')`) was wrong in a way that LOOKED right: it matches a
    focused descendant, and a button has none, so it failed three times for
    a different reason than the original.

  - **What did NOT get fixed, and why.** BUG-004's "Do you want to
    navigate…" dialog is not ours: there is no `showMessageBox`, no
    `window.confirm`, and no such string in the app or in xterm's web-links
    addon, whose handler goes straight to `shell.openExternal`. Without a
    reproduction the honest move is to leave it open rather than change the
    link path on a guess. BUG-005 and BUG-007 are the same shape — the icon
    is configured and present, and the login-shell spawns look correct — so
    both want the operator's machine, not more reading.

    SUPERSEDED by D58, 2026-08-16: the conclusion "not ours" was right and the
    search space was too small. The string is in xterm's CORE package
    (`OscLinkProvider.defaultActivate`), not in the web-links addon, and it
    fires only because the pane never claimed `options.linkHandler`. Incident
    `0011` carries the diagnosis and the recipe.

- 2026-08-07 (operator report, in-session): **a Claude tab read "result ready"
  while its Agent was streaming (BUG-008) — fixed same day.** The operator
  watched a long-running Session sit on the green check "for a while even
  though it was running", then flip to the working spinner on its own. That
  self-correction is the tell: nothing the operator did changed it, so the
  fix arrived as a hook event, and the wrong state was reached without one.

  This is BUG-001's failure on the source that has two independent
  protections against it, so the diagnosis started from what could defeat
  both. Traced: (1) `sweepNow`'s working→quiet transition adds `settled` on
  any 3s output gap, unconditionally — including a pause the harness has
  explained. A slow first token on a large context clears that easily, and
  measured Claude turns open with `UserPromptSubmit` well before the first
  byte lands. (2) With `settled` set and a reported source present, `onData`
  returned BEFORE `this.lastDataAt.set(...)`, so the Session's quiescence
  clock stopped at the pause and stayed there through every subsequent byte.
  (3) `reclaimStaleReportedTurn` (D4's guard for aborted turns the harness
  never closes) reads exactly that clock: 12s — `quietMs × 3` — after the
  pause it declared the still-open turn stale and applied a `turn-end`.
  `delegationIsLive` then publishes a settled record as `null`, the render
  derivation loses `ownTurn: 'generating'`, `working` is already false from
  the same sweep, and `sessionGlyphState` answers `done`. Green check, mid
  stream. Recovery required a hook that reopens the turn — a `Task` spawn
  (children force `working` through `delegatedBusy`) or the next prompt,
  which is precisely the correction the operator saw.

  Falsified on the way: "the reclaim threshold is too aggressive" (it is not
  a threshold problem — 12s of genuine silence is a sound signal, and the
  clock feeding it was lying), and "the light is picking the wrong winner
  between reported and inferred truth" (the derivation was correct; both
  inputs had already been corrupted in main). Fixed by scoping the latch to
  turns nothing reports as open, and exempting the quiescence clock from the
  latch entirely — decision `0018`'s 2026-08-07 amendment. Both regressions
  are asserted where the operator would notice them: the pipeline test now
  streams for a simulated minute after a slow first token and requires
  `active` on every tick, and the monitor test proves a latched-by-BEL
  Session that keeps talking is never called stale.
- 2026-08-07 (D51, landed): one operator bug, one idea, and the D50 review's
  own findings.

  - **BUG-009 — ⌘J does nothing against a visible marker (`3e117cde`).**
    "I see an orange needs-attention tab but cmd+j doesn't jump to it, it
    does nothing." Root cause is two predicates over two different fields.
    Every surface that PAINTS attention filters on `t.sessionId &&
    tabIsLive(t)` — the strip, the exposé cards, the Sessions overview. The
    ⌘J queue alone filtered on `tab.sessionId && tab.exitCode === null`. In
    `use-workspace-state.ts` the adoption branch for a session that exited
    while adopted sets `resumeState: 'live'` (so `tabIsLive` is true and the
    marker paints) together with a non-null `exitCode` (so the queue drops
    it). The tab wears a marker the jump refuses to visit.

    The mirror case was equally wrong and had not been reported yet: a
    restored-but-not-live tab has `exitCode === null`, so ⌘J would have
    navigated to a Session showing no marker — the surprise-navigation the
    queue's own comment forbids. Both directions come from the same missing
    rule, so the rule is now written down once: `paintsAttention` and
    `attentionJumpQueue` live in `session-status.ts` next to
    `attentionNeedsOperator`, and the strip and the queue both call them.
    The marker IS the contract; a Session is a ⌘J target exactly when a
    surface paints it.

    Second defect in the same report, and the one that made it feel broken
    rather than merely wrong: the no-op was silent. D44's discoverability
    contract exists precisely to stop a command from doing nothing without
    saying so, and `jumpAttention` consumed the chord and returned. It now
    announces on the workspace live region — "No Agents need you" or
    "Already on the Agent that needs you" — and the region's name lost its
    reorder-only framing, since it is now the workspace's one spoken channel
    rather than a second one bolted on.

  - **Surface gates (infrastructure).** Found while reviewing D50: the
    landing floor ran ZERO browser gates for a change to `tab-strip.tsx`,
    the most motion-sensitive surface in the app, which owns two eval
    scripts and five acceptance gates. The floor routes changed paths to
    exactly one of the repository's 31 eval gates (`eval:r3f`), and
    `qa:browser:doctor` only fires when the harness itself changes, not the
    surfaces it guards. The reason is structural — every browser/Electron
    eval needs an `EXA_BASE` dev server the floor does not own — which is
    why nobody wired them: they cannot be run unattended. So the floor now
    requires them to be DECLARED rather than running them, refusing before
    any expensive work and printing the exact commands, with
    `--waive-gate` for a gate that genuinely does not apply. Both refusals
    and waivers append a metric, so skipped evidence stays visible.

    Routing them immediately proved the point twice over. The contract
    refused this very change and named three gates; running them found that
    two were RED for reasons of their own. `eval:workspace:chrome` still
    asserts D46's configuration ribbon, which D49 replaced (BUG-010);
    `eval:navigation` waits for a status label the D30/D33/D40 protocol
    retired (BUG-011). Both had been broken since D49 landed and nobody
    knew, because nothing ran them. Both were ALSO blocked before that by
    the account first-run invitation intercepting clicks — and
    `primeEvalBrowserPage`, the helper written for exactly that failure,
    documented as "call on every page that drives an APP route", had zero
    callers in the entire repository. The same disease one layer down: the
    mechanism existed, nothing routed to it.

    So the map carries `quarantined` alongside `match`: the surface still
    owes the gate, the gate is announced on every landing that touches it,
    and the backlog id that repairs it travels with it. Deleting the entry
    would have thrown away the knowledge that the surface owes evidence at
    all, which is how it got here.

  - **D50 review items, all landed here.** (1) The pinned Project header
    read its neighbour from the caller's Project list while the layout was
    built from `layoutEntries`, which excludes a Project mid-close — so for
    D37's three-second retraction the pin held past its own block. It now
    reads neighbours from the laid-out row, which is the only list that
    knows what was actually placed. (2) The apply epoch swallowed EVERY
    non-matching visit until the applied location arrived; navigating
    somewhere else mid-apply therefore dropped a real stop. It now swallows
    only genuine stages — a location agreeing on the surface or the tab —
    and treats anything else as the operator having moved on. (3) The nav
    location resolver was re-registered on every tab-activity tick,
    republishing capability state for no change; it now registers once and
    reads through a ref. (4) The pinned header gained the browser gate it
    should have shipped with, verified by sabotage: disabling the pin fails
    the gate with the reason.

  - **FIX-008 — Team view filter/sort (`dd002fa9`), captured unshaped.**
    "Add a filter strip / ribbon in Team view … that with one click (or
    keyboard) lets one sort the active agents to the front within each
    project. Right now I have to scroll and scan to see what I was working
    on." Recorded on the roadmap with boundaries and open questions, not
    shaped: it is the same orientation complaint as D50's pinned header, and
    the answer might be a sort, a filter, or neither.

  **Review pass, same day — the surface half.** Fixing main left the same
  question being asked wrongly one layer up. D4 established that every
  surface derives Session truth from the shared derivation rather than
  re-deriving it; three callers had never been converted, and all three
  asked the ACTIVITY map, which is bytes. The ⌘W confirmation and the
  Project-close count therefore called a mid-tool-call Agent idle — closing
  a working Agent with no warning at all, the confirmation's entire job —
  and the roadmap lens labelled it `waiting`, as it also did for a Session
  parked on a question. The composition itself was the fragile part: six
  fields assembled by hand at five surfaces, where forgetting a channel is
  invisible and produces exactly these lies. It is now one exported
  `sessionTurnFacts(tab, sources)`, and the strip, exposé, Project dot,
  close paths, and lens all take it; forgetting a channel now means deleting
  an argument. Two consequences the derivation made expressible: the close
  dialogs distinguish an interrupted turn from a discarded question (the
  batch dialog counts them separately, because an operator who sees the
  second usually wants to answer one first), and the `working` tooltip
  stopped promising "output streaming" for a turn that is thinking.

- 2026-08-07 (D50, landed): four items, one subject — orientation and the
  navigation spine. The operator's 2026-08-06 quick capture (`37c3a24e`) plus
  BUG-006, FIX-007, and FIX-001 were treated as one pass because they are all
  the same question: where am I, and how do I get back.

  - **Pinned Project header (`37c3a24e`, idea).** "As I horizontally scroll
    or select the next tabs in Agent view within a given project, I find
    myself forgetting what project I'm in. I want the project tab to stop at
    the left scroll position and the tabs to scroll under it. Then when
    scrolling through the next projects' agent tabs, that project tab kicks
    out the prior one." Built as the UIScrollView section-header grammar laid
    on its side, with the operator's clarification that it must feel that
    smooth. The decision that mattered: there is **no floating copy** of the
    header. The ribbon already owns every item's position through one
    transform, so the pin is one extra term in it
    (`--exa-ribbon-pin`, written by the scroll handler, 0 for everything
    else), and the real chip does the sticking. A second pinned node would
    have meant two owners of one header's identity, editing state, menu, and
    signal mark. `stickyProjectForScroll` in `project-ribbon-layout.ts` is
    pure and unit-tested: park at 0, push negative as the next header
    arrives, and never pin a FOLDED Project — a folded block is nothing but
    its own chip, so it has nothing to hold above. While pinned the header
    drops its position tween (a sticky element must track the scroll frame
    exactly, not lag a tween behind it), composites its tint onto the strip's
    ground so tabs pass underneath rather than through, and carries one
    hairline of depth on the edge they pass.

  - **BUG-006, both halves.** The report was two defects with one owner, and
    the owner turned out to be the history module rather than the close path.
    (1) `selectExistingTab` silently no-ops for a tab that no longer exists,
    while `navHistory.back()` had already moved the index — so Back moved and
    nothing changed on screen. (2) The oscillation: applying a location lands
    in stages (the tab select is synchronous, the surface change is a router
    round trip), so the workspace recorder observed a HYBRID — old surface,
    new tab — that matched no entry, pushed it, and truncated the forward
    stack. The stack then held two reachable entries and Back flipped between
    them. `hasPendingTabSelect()` was supposed to prevent exactly this and
    could never fire: the event listener calls `consumePendingTabSelect()`
    synchronously during dispatch, so the slot was always empty by the time
    any recorder ran. It is deleted rather than repaired. NavHistory now owns
    both invariants — a stop must resolve and must be somewhere else (a
    resolver the workspace registers; `canBack`/`canForward` answer for live
    stops, which also makes D27.1's disabled state honest), and `beginApply`
    suspends recording until the applied location actually arrives, with a
    timeout so an abandoned apply cannot silence recording.

  - **FIX-007 — two falsified hypotheses before the right one.** Worth
    recording because both were plausible and both were wrong.
    *Falsified #1: the band scorer.* An exact-substring Project name earns
    `namePrefix` (7) and `Start Codex` earns a fuzzy score below 1, so the
    scorer already ranked them correctly.
    *Falsified #2: authored group order.* The obvious reading of "a fuzzy row
    in the fifth group beat an exact row in the seventh" is that React's JSX
    order decides group order. It does not — cmdk sorts groups by their best
    item score, and a reproduction with Projects authored last still put
    Projects first. A React-side group sort was built against this
    hypothesis and then **removed**: with the real cause fixed it was a
    second owner of the same DOM order, which is how the two would have
    fought over the same nodes.
    *Actual cause:* cmdk adds an item's id to its group's id set on mount and
    never removes it on unmount, and the group score is
    `ids.forEach(id => score = Math.max(filtered.get(id), score))`. One stale
    id makes that `Math.max(undefined, …)` → NaN, every comparison against
    NaN is false, and the group sort degenerates to arbitrary order. Rows
    unmount constantly in this palette — Sessions and Projects both arrive
    asynchronously — which is exactly why the operator saw it intermittently
    rather than always. Fixed in `patches/cmdk.patch` (drop the id on unmount,
    and coerce a missing score to 0), pinned by
    `src/components/ui/command-group-order.test.tsx`, which fails without the
    patch. D48's `navigationFirst` was a hand-rolled exemption from the same
    disease and is deleted; the Clone rows' bag-of-words `value` — which kept
    a clone target's own name out of every name band — becomes a proper
    `paletteValue` plus keywords.

  - **FIX-001.** `⌘/` exists to answer "what is ⌘⇧T bound to?" and could only
    be searched by action name. Matching the rendered string is not enough
    either: the sheet renders `⌘⇧T`, so "cmd shift t" finds nothing and a
    lone "t" finds everything. `chord-query.ts` parses a query that LOOKS
    like a chord and matches it structurally against the binding; anything
    else stays a plain label search. The null half of that contract is the
    load-bearing part — "close tab" and "command palette" must not become key
    lookups — so a chord query must name at least one modifier and carry at
    most one non-modifier token.

- 2026-08-06 (operator quick capture, triaged from `product_feedback`): two
  reports describe one command-palette ranking defect, queued under D48 as
  FIX-007 rather than treated as separate bugs. Searching for `atlas` ranked
  the fuzzy **Start Codex** command above the exact-substring Project
  `atlas-notes` (`5645d689`); searching for `lumen-agent` likewise ranked an
  unrelated Session/Project above the expected `lumen-agent` Project
  (`452c284c`). D48 establishes structural score bands for Navigation and
  Sessions, but Project-name rows need the same primary-name treatment and a
  cross-group exact/substring contract. Fix this in the shared palette scorer,
  not with project-specific aliases or authored DOM ordering.

- 2026-08-04 (operator quick capture + partner conversation, triaged): two
  items, both owned here. Queued, not yet fixed.
  - **Back stack breaks after closing a composer tab (`1217e7d3`, bug,
    BUG-006).** After opening a New Agent composer tab and closing it with
    `⌘W`, Back reaches nothing — the operator is explicit that he does NOT
    expect the closed tab to reopen (that is `⌘⇧T`'s job per D39); he expects
    "an unbroken backchain to whatever I was looking at previously." A second
    instance the same day: Back cycled between the same two entries, believed
    to be an Agent and a Team view. Two distinct defects with one owner — the
    history stack keeps entries that point at destroyed Sessions instead of
    popping through to the last live location, and somewhere a Back navigation
    is pushing a new entry instead of popping, which turns the stack into a
    two-element oscillator. D45/D48 did not touch history; the app-location
    back stack (`⌘[` / `⌘]`) is the owner. Fix the closed-tab case by making
    Back skip entries whose target no longer exists, and reproduce the
    oscillation before touching push/pop — a stack that can cycle is a
    correctness bug, not a UX preference.
  - **Team View agent-title input rejects typing (FIX-006, partner
    conversation). RE-HOMED 2026-08-07 to
    ENG-015 S6** — it is a Team surface and shares its owner with FIX-002;
    the diagnosis and the fix live in `stellar-small-fleet.md` now.** Observed live during a demo:
    the agent-title field on a Team tile takes focus but no characters. Seen at
    the same moment D49's launcher work was in flight; verify against a current
    build before assuming it is still live, and check whether a parent
    key handler (altitude shortcuts, arrow navigation, or the tile's own
    selection handling) is swallowing keystrokes before the input sees them.

- 2026-08-04 (operator quick capture, triaged from `product_feedback`): two
  rows, both owned here. Queued, not yet fixed.
  - **OpenCode model selection list overflows off-screen (`9821ede0`, bug,
    BUG-003).** In the New Agent launcher, the opencode model list renders past
    the viewport with no scroll, so models at the tail are unreachable. This is
    the ENG-003 S3 scalable-picker foundation surfaced through D46/D49's Launch
    Configuration UI; opencode's catalog is the largest of any source, so the
    picker must scroll (or virtualize) rather than assume the Claude/Codex-sized
    lists it was tuned on.
  - **Clicking links in terminal output does nothing after the confirmation
    (`fb76b24e`, bug, BUG-004).** Codex output links pop the "Do you want to
    navigate…" warning dialog, but OK never opens the URL; the operator suspects
    Claude Code links are broken too. The confirm→open handoff (dialog result →
    `shell.openExternal` or equivalent) is silently dropping the approved
    navigation. Verify across sources — if it reproduces in Claude too, the
    break is in the shared link handler, not a per-source escape sequence.

- 2026-08-03 (operator quick capture, triaged from `product_feedback`): three
  rows, all owned here. Queued, not yet fixed.
  - **Codex turn truth regressed (`f8fade12`, bug, high).** A Codex tab showed
    the finished/result glyph while the agent was demonstrably still working.
    This is the exact failure D38's latch and D40's status-light protocol
    exist to prevent, so treat it as a REGRESSION in the product's core
    correctness claim rather than a cosmetic glyph bug. D38 latches a finished
    turn at the quiet-or-BEL boundary; Codex reports no `Stop`, so it depends
    on inference (S1.1 keeps inference only as the backstop for sources that
    report nothing). Diagnose whether Codex's output cadence now crosses the
    quiet threshold mid-turn, and whether ENG-023's withheld turn-end covers
    only Claude. Reproduce before changing thresholds — a threshold tweak that
    is not aimed at the actual cause is how this becomes permanent flakiness.

    **2026-08-04 investigation — hypothesis falsified, root cause NOT yet
    confirmed, still open.** Traced the full mechanism: Claude is immune to
    false-inferred "done" for two independent reasons — S1.1's `ownTurn`
    override in `sessionGlyphState` outranks byte inference at render time,
    and `noteHarnessTurnStart`/`noteHarnessTurnEnd` (fired from hook events,
    not PTY bytes) manage the `settled` latch directly, bypassing `onData`
    entirely. Codex has neither: `harness-registry.ts`'s `codex` descriptor
    has no `eventChannel` (hooks exist upstream but are deliberately not
    wired — trust-gated via `trusted_hash` in `config.toml`, "Exawatt must
    not inject silently"), so `reportedTurn(id)` is always `null` and
    `AttentionMonitor` runs on byte quiescence alone.

    Tested the literal hypothesis — that Codex's output cadence crosses
    `WORKING_WINDOW_MS`/`quietMs` (3000/4000ms) mid-turn — against a real
    Codex CLI (`codex-cli 0.146.0`) via an isolated `CODEX_HOME` (own
    `auth.json` copy, a pre-trusted scratch directory, so no operator state
    touched) driving real `node-pty` sessions. Two scenarios, matching actual
    launch flags from `harness-registry.ts`'s `workspaceReviewFlags`:
    - **Tool execution, default launch mode** (`DEFAULT_AGENT_PERMISSION_MODE
= 'unrestricted'` → `--dangerously-bypass-approvals-and-sandbox`): a
      forced `sleep 9 && echo` tool call. Max inter-byte gap over the whole
      17s run was **316ms** — the TUI spinner animates continuously (~33ms
      cadence) through the entire silent shell command, never approaching
      either threshold.
    - **Approval wait** (`'prompt'` mode → `--sandbox workspace-write
--ask-for-approval on-request`): once the "Action Required" picker
      renders, Codex emits an OSC window-title toggle heartbeat every
      **~1002ms** while genuinely blocked on the operator — also well under
      both thresholds, and (per `scan()`) not itself a bell, so it correctly
      keeps `working=true` throughout the wait rather than settling.

    Neither scenario reproduces a silence anywhere near the settle
    thresholds, so "Codex's cadence crosses the quiet threshold" does not
    hold under normal conditions with this CLI version. Also traced a
    candidate code-level fix — decoupling the `WORKING_WINDOW_MS` visual
    transition (D18, purely cosmetic) from the `settled` latch commit, so an
    inference-only session's "done" conclusion would stay revocable by real
    subsequent output instead of freezing the moment 3s of quiet passes — and
    confirmed by direct test-suite tracing that this is NOT a latent bug:
    `attention-monitor.test.ts`'s `'marks a session working on output and
quiet after the window'` (D18) and `'keeps a finished turn stable until
explicit operator engagement'` explicitly pin the current unconditional,
    early latch as intentional, exercising it against realistic repaint-noise
    sizes (2200 bytes). Loosening it — for Codex specifically or generally —
    would reintroduce the exact idle-repaint flicker D38 was written to kill,
    for unproven benefit. Not shipped.

    **Real fix requires one of:** (a) a live repro captured with harness,
    permission mode, and approximate silent duration before the false "done"
    appeared — the one thing this investigation couldn't manufacture — or (b)
    real Codex reported-turn integration (Codex's own `notify` hook exists —
    see the operator's own `~/.codex/config.toml` `notify` entry — but wiring
    it is genuinely new scope: format research, a `codex-hooks.ts` normalizer
    parallel to `claude-hooks.ts`, and the trust/consent UX
    `harness-registry.ts`'s comment explicitly defers). Diagnostic method
    (isolated `CODEX_HOME`, `node-pty` cadence probe) is reusable for a future
    attempt without re-deriving the trust-dialog workaround.

    **2026-08-04 resolution (same day, follow-up pass) — shipped, `done`.**
    Re-examined the "not shipped" call above: it correctly ruled out the
    SPECIFIC trigger and correctly avoided the unproven variant of the code
    fix, but the underlying structural asymmetry is real independent of any
    specific trigger — Codex has literally zero protection against a wrong
    inference, of any cause, ever, where Claude has two. A stuck-wrong status
    for the rest of a turn is worse than the bounded, self-correcting noise
    risk the old latch was defending against, so shipped a narrower version of
    the traced fix: `onData`'s settled-latch guard is now conditional on
    `reportedTurn(id) !== null`. Claude is provably unaffected (that record is
    non-null for a Session's whole life once hooks are live, so the exception
    is structurally unreachable for it); Codex/OpenCode's "done" conclusion is
    now revocable by real subsequent output instead of permanently latched.
    `attention-monitor.test.ts`'s three noise-immunity tests were split: each
    keeps its original assertion under an explicit `setReportedTurnSource`
    (proving Claude's guarantee is untouched) and gained a sibling asserting
    the new reportless behavior. Full rationale in decision `0018`'s Amendment
    section; roadmap status updated to `done`.

  - **Divvy window management stopped working on Exawatt (`e903dbdd`, bug).**
    Keyboard and mouse-driven Divvy resize/position both fail on Exawatt while
    working in other apps, ~30 minutes after a restart. External-tool
    interaction with the window/title-bar configuration, so it is an INCIDENT
    CANDIDATE under `incidents/README.md` once diagnosed: the cause is
    plausibly a BrowserWindow or frame setting, and the next agent to hit it
    should not re-derive that. Check recent window/chrome changes first.
  - **`⌘/` should be searchable by key combination (`aef85d13`, idea).** Today
    the cheat sheet searches action names only, so "what is ⌘⇧T bound to?"
    cannot be answered from the surface that exists to answer it. Small,
    bounded, and directly continues D44's command-discoverability contract.

- 2026-07-22 (operator, new-Agent composer): selecting Codex alone did not
  disclose the consequential model or reasoning-effort choice, so the operator
  could neither confirm the configured pair nor change it before launch. Owned
  by D35: compact source-adjacent selectors display both resolved values,
  expose model-specific catalogs with short speed/depth copy, and scope
  overrides to one Agent while preserving draft work.

- 2026-07-22 (operator dogfood, D27 close confirm): "Close confirm buttons
  (and all buttons in our app) should have the same visual style — default
  is the macOS highlight color, not the project highlight color." Project
  color had leaked from identity into ACTION styling. Owned by D32: system
  accent via systemPreferences.getAccentColor drives --primary app-wide;
  primary/outline/ghost shadcn variants become the one button recipe.

- 2026-07-22 (immediate operator dogfood on D30): a pulsing bell per unseen
  Session is individually legible but collectively hostile — at normal fleet
  counts it becomes dozens of perpetual alarms. Hover also did not clearly
  teach the icon, selecting a Session could briefly paint its stale bell, and
  a Session alternated between the working half-circle and finished check.
  Root causes: local acknowledgement ran after paint; the resize redraw guard
  was recorded after `resize()` (which may emit synchronously); and BEL output
  marked a Session working before raising attention, leaving that stale bit
  underneath. In the same round Workmusic received the subtitle “Based on my
  exploration, here's what I found:” — persistent diagnostics showed the same
  preamble more than once. The prompt required six words while the validator
  allowed ten and only rejected self-narration at the beginning. D33 fixed
  those immediate paths, but it did not remove the underlying output heuristic;
  D38 closes that gap with a sticky finished-turn boundary.

- 2026-07-22 (fourth operator report on turn-state oscillation): the same
  completed Agent changed from the green check back to the teal half-circle
  without receiving new work. The change was not random: any PTY bytes were
  still promoted to working, so idle TUI redraws bypassed the earlier
  resize/BEL/race fixes. Owned by D38 and decision 0018: finished stays latched
  until guaranteed operator engagement opens another turn.

- 2026-07-22 (operator dogfood + UX research round): "The status lights are
  still really bad… as a user I can't tell the difference and don't know
  what each does. And the colored diamond next to the project name —
  they're all conceptually conflicting." Root cause per the research
  (Carbon status-indicator pattern; colorblind-accessibility literature):
  hue was the only glanceable channel, in the most confusable pair
  (teal/green) at 6–10px, surrounded by three other small colored
  IDENTITY marks per row; meanings lived only in tooltips. Operator chose
  the learnable icon-vocabulary direction (Linear/GitHub-checks model)
  with a calmer attention mark than an alarm triangle, and a thin color
  bar replacing the diamond. Owned by D30.

- 2026-07-21 (operator dogfood, evening round on the D24 build): ten
  findings. "New tab" should read "New agent". The D21 attention-count
  pill "doesn't make sense to me as a user" and looks buggy (clears on
  glance → count flickers) — remove it. ⌘9 must be last-tab (Chrome).
  The back stack "needs work — across all zoom levels and tabs and
  locations" (root cause: ⌘[ was bare router.back(), and Sessions
  open/close used router.replace, so zoom changes never became history).
  Settings needs esc. Strip wants right-click menus. The Sessions rail's
  focused-vs-blurred state was visually identical, making one esc rung
  feel dead. The ⌘W confirm should be OUR modal (native rejected on
  sight) with a default-highlighted button, macOS tab/space/enter
  semantics, and recovery copy. Closing visibly jerked through stopped/
  restore states (fix: optimistic removal). The source dropdown flashed
  unbranded white options against a branded trigger. All owned by D27. A
  2026-07-22 follow-up screenshot showed the branded option content projected
  into the already-branded trigger, duplicating its icon; fixed at the Select
  value/content boundary and retained under D27 rather than opening a parallel
  milestone.

- 2026-07-21 (operator, agent-driven test interruption): development and
  Electron evaluation windows stole foreground focus while the operator was
  typing, simultaneously interrupting work and corrupting live UI tests with
  unintended keystrokes. Secondary-display placement from D18 was only a
  location mitigation: BrowserWindow still defaulted visible/focused, macOS
  still activated the regular app, and single-display use had no fallback.
  FIXED same day as D27: hidden accessory-policy automation, inactive
  development, explicit foreground opt-in, and a packaged regression gate.

- 2026-07-21 (operator dogfood, same day as D23): the park-first ⌘W was
  rejected on first contact — "close tab shouldn't be 'pause tab' or
  'clear tab'"; ⌘W must close like Chrome, guarded by a NATIVE confirm for
  any started live agent (idle agents hold context too). Adjacent findings
  in the same message: ⌘T must pop a real tab instantly, not summon a
  modal (⌘T ⌘W = quick no-op); the D21 keycap hints reveal too slowly
  (350ms) and shift layout when they appear; the task box needs
  discoverable image paste on both ⌘V and ⌃V; and clicking an idle tab
  spins its status glyph for ~3s (pane-attach resize → WINCH redraw read
  as work by the D22 activity signal). Standing doctrine stated: all work
  ships best-in-class keyboard support. All owned by D24.
- 2026-07-21 (found while retargeting the launcher eval for D23): keyboard
  interaction INSIDE the composer's permission Select is broken — with the
  listbox open, arrow navigation and typeahead no longer move the highlight
  (Escape and commit still work), so the eval's old Home/ArrowDown dance
  has silently re-committed YOLO since the YOLO default landed, and a
  keyboard-only operator cannot change an Agent's permission mode. The
  launcher eval selected by pointer while the gap was open. RESOLVED same
  day by D24: the defect lived in the retired floating-panel composer (it
  does not reproduce under the pane composer, in browser or Electron), and
  the launcher eval now asserts strict keyboard Select navigation so a
  recurrence fails loudly.
- 2026-07-21 (operator, ⌘W productization request with design pass): the
  close flow was the app's only one-stroke data destroyer, fronted by an
  off-brand native macOS dialog. Research findings: (1) the dialog guarded
  the wrong cases — fresh unstarted agents were interrogated while closing
  an already-stopped tab deleted retained history with zero confirmation;
  (2) the app already had a complete "parked" state (app-quit `stopAll()`
  flushes history; D16/D21 stopped-tab restore) that ⌘W alone bypassed;
  (3) no undo existed anywhere (peers: browsers do instant close + reopen,
  iTerm confirms only running jobs); (4) `kill()` conflated stop with
  data destruction. FIXED same day as D23 (operator chose: park on first
  ⌘W; in-app confirm only mid-turn; soft-delete ledger with clear
  resultant UI; manual tidiness with hover-unfurled condensed chips).

- 2026-07-21 (dogfood on 0.1.5, D18 attention legibility follow-up): "It's
  still hard to see which agents are spinning and which have finished their
  turn and which are unstarted." Two defects: the working/quiet glyphs
  (solid pulsing vs hollow 6px dots) differed too subtly to read
  peripherally, and no state distinguished finished-turn from
  never-started — both rendered the same hollow "quiet" dot. Also:
  unstarted tabs displayed the default harness title ("Claude Code"),
  pure redundancy next to the harness glyph (operator: glyph plus nothing,
  or "New Agent", until there's something to summarize). FIXED same day as
  D22: three shape-and-motion-distinct states (rotating arc / solid green
  rest dot / dim hollow ring) driven by a main-truth started bit, and
  default-titled agent tabs render glyph-only.
- 2026-07-20 (dogfood, context layer): a tab subtitle showed the summarizer
  model's own confused reply — "I see corrupted session data that I can't
  interpret. What would" — hard-sliced mid-sentence at the 64-char cap. Two
  defects: no output validation and mid-word truncation. FIXED same day:
  `acceptableSubtitle` shape guardrails (unusable content keeps the previous
  subtitle, refunds the sweep bytes, and is not an engine failure), an
  explicit NO_GOAL escape hatch in the prompt, and word-boundary truncation
  with an ellipsis for subtitles and recaps. The larger direction is promoted
  to ENG-021 (objective engine — context at every granularity).
- 2026-07-20 (dogfood, D18 follow-up): Divvy could not resize the Exawatt
  window. Root cause: the BrowserWindow declared an 800×600 minimum, and
  macOS clamps Accessibility-API frame changes to the window minimum — every
  half/third-screen tiling cell on a laptop display (~756 logical px per
  half) was silently vetoed, so AX window managers appeared entirely broken
  for Exawatt while working everywhere else. The floor is now 560×400; the
  chrome-layout eval verifies no overflow down to 560 wide, which also
  surfaced and fixed a real sub-800 bug (the summoned composer panel,
  right-anchored to its toggle, overflowed the left viewport edge — it now
  anchors to the full-width chrome bar). FIXED same day.
- 2026-07-18 (D17 queued, adoption friction): Little Snitch re-asked for
  network decisions after agent work moved from Claude Code/Codex in the
  operator's terminal to Exawatt. Process-pair scoping explains the legitimate
  one-time parent-app distinction, but the installed dogfood artifact also has
  an ad-hoc, identity-null signature and fails strict bundle verification.
  Retargeting harness rules can share CLI policy across parents; disabling
  Exawatt identity checks is rejected as the durable product fix. D17 owns a
  stable Exawatt identity and a two-build allow/deny preservation check.
- 2026-07-12 (QA sweep): ⌘E rename appended to the old name instead of
  replacing it (no select-on-focus). FIXED same day.
- 2026-07-12 (QA sweep): exposé scrollback previews never rendered — preview
  fetch results dropped by a per-effect cancel racing workspace re-renders.
  FIXED same day (+ decoration-line filtering).
- 2026-07-12 (QA sweep, observation — not a bug): after relaunch every tab is
  Stopped and revival is per-pane ("Start New Shell"); that matches the
  restored-not-resumed design, but a one-gesture "revive this project" /
  "revive all" may earn its keep once real dogfood hits it. Left for operator
  evidence before building.

- 2026-07-11 (D9 eval error capture): pre-existing hydration warning — the
  tab strip nests the close button inside the tab `<button>` (invalid HTML,
  React logs `<button> cannot contain a nested <button>`). Cosmetic today;
  fix by making the tab a non-button interactive element or the close
  affordance a `<span role="button">`. RESOLVED by D10's EditableChrome.

- 2026-07-22, D37 graceful empty-Project close: the operator wanted the empty
  Project state to acknowledge closing its last Agent without leaving a dead
  group in the workspace indefinitely. The open group now lingers for three
  seconds, retracts right-to-left, and closes while its durable Project-library
  identity remains available through `⌘N`. Opening an already-empty Project
  does not arm the timer, and adding an Agent during the grace/exit cancels it.
  Project right-click menus also expose **Close project**; populated groups use
  one batch confirmation and the existing Session archive/reopen path.

- 2026-07-22, D39 UX rough-edge audit: the direct `⌘W` empty-Project no-op was
  reproduced and traced to a tab-only active close action. The installed app and
  worktree-owned evaluators then verified seven adjacent interaction/recovery
  rough edges; they are prioritized and sequenced in D39 instead of becoming a
  parallel audit plan. The close-target slice landed with shared
  shortcut/palette/menu semantics and an Electron regression; the remaining
  findings stay active hypotheses until their acceptance checks pass.

- 2026-07-27, tab-label truncation with unused strip width (QUEUED small fix;
  ENG-025 feedback row `91c90593-a712-46ad-a4ff-3ceaa5ba7408`, operator):
  "It's a two-row tab with truncated text, yet whitespace in the right 40%".
  Reproduced in `src/components/workspace/tab-strip.tsx`: the tab's stacked
  title/goal column is capped by a FIXED `max-w-60` (with `max-w-56` on each
  line), so a label truncates at a constant width no matter how much room the
  strip actually has. The strip row itself is `flex flex-wrap`, so free space
  collects at the right rather than being offered to the tabs. With one or two
  Sessions open the operator therefore reads a clipped goal beside ~40% empty
  chrome. The fix is a width policy, not a bigger constant: let the text column
  grow into available strip width and keep truncation for the genuinely crowded
  case. Not started — recording only.

(Dated dogfood findings land here.)

### D41 Elastic Project / Initiative ribbon

The 2026-07-27 density review superseded D37's automatic close-last-Agent
policy and the old grouped flex strip. At the operator's real target scale
(6–12 Projects, 15–40 top-level work contexts), one large Project was an
indivisible row-width rectangle, empty Projects remained stranded between
active groups, and the ribbon consumed four rows in a short terminal window.
The existing exit only scaled pixels; it retained layout width until removal
and then ran a separate survivor FLIP, so the operator correctly observed no
continuous reflow.

Landed contract:

- current Session tabs are explicitly Initiative-shaped projections: roughly
  one-to-one today, compatible with one Initiative coordinating many Agents and
  Sessions later; ENG-005 still owns the durable Initiative primitive
- one pure target-bounds engine lays out independent Project headers and tabs,
  with a hard two-row budget and `+N` route to the existing overview
- the selected Project auto-expands; other Projects stay compact unless the
  operator uses a persisted **Keep expanded** disclosure; attention signals but
  never expands or reorders
- manual Project order remains truth; empty inactive Projects stable-partition
  after a four-second tunable dwell into a dormant tail while staying open
- `⌘W` on an empty selected Project and **Close project** remain explicit close;
  natural last-Agent close no longer destroys the parent object
- the five-light protocol and ENG-023 delegation truth aggregate into a compact
  Project signal; subagents remain children of the parent work rather than new
  top-level tabs
- shared 210 ms transform targets make collapse/expand/removal and tail reorder
  continuous; pointer close retains the exact old slot briefly; constant signal,
  disclosure, and dormancy footprints prevent state churn from shifting later
  close targets; Reduced Motion is immediate

The production component is also the DOM specimen in
`/hud-gallery#elastic-project-ribbon`, with a focused motion lab at
`/hud-gallery/project-ribbon`. Verification is layered: 70 focused pure/hook/DOM
tests; `eval:workspace:ribbon` samples actual intermediate rectangles,
pointer-held and released positions, wide/narrow overflow, empty-tail movement,
and reduced-motion duration in Chromium; `eval:workspace:chrome` retains the
full workspace geometry and interaction regression pass. Decision `0022`
records the durable product/architecture tradeoff.

### D42 Ribbon truth density and constant-height chrome

Status: landed 2026-08-02 (same day as the round; operator confirmation of
the condensed-chip feel remains dogfood evidence) — created from the
operator's first sustained dogfood round on the D41 ribbon. Seven findings,
owned as one coherent pass; the reproduction rig and measurements below are
the evidence base, and the landed log at the end of this section records the
implementation and its gates.

Operator findings (2026-08-02, verbatim compression):

1. On a mid-Project tab there is no way to know a later tab exists in the SAME
   Project; `⌘⇧]` lands on a tab that was never visible and the previously
   active tab then disappears; hold-⌘ hints skip hidden ordinals entirely, and
   with three prior Projects collapsed the hints simply start at #7.
2. Switching from a dense Project to a one-Agent Project animates the bar's
   height and relayouts the entire terminal below ("does Chrome ever
   automatically relayout a webpage like this?" — it does not).
3. The switched-away Project hides that it has ANY tabs — five active Agents
   read as dormant.
4. Too much total movement switching into and out of a one-Agent Project.
5. Per-Agent state — including needs-you and blocked — is obscured behind the
   single Project dot.
6. Two-row limit helped but switching still does not read; hard to grok what
   happened on either keyboard or pointer switches.
7. Tab reordering "feels like touching a pile of HTML divs", not a crisp
   Chrome/Sublime tab bar.

Reproduction rig: `/hud-gallery/project-ribbon/bench` — the real `TabStrip`
above a fake fixed-budget terminal stage that counts every ResizeObserver
delivery, wired to the REAL `tab-ring.ts` verbs, with a DOM-truth readout of
every tab's ordinal and render visibility and a per-gesture CSS-transition
counter. Measured on the operator-shaped fixture (three prior Projects holding
ordinals 1–6, a five-Agent active Project, a one-Agent Project):

- hold-⌘ revealed keycaps `[7, 8]` only; six tabs un-rendered, three more
  un-ordinaled, the global-last "9" invisible (finding 1)
- at 1080 px the ACTIVE Project's fifth tab was already `+1` overflow with no
  local indicator; `⌘⇧]` onto it evicted the previously active tab into the
  overflow, exactly as reported (finding 1)
- one Project switch that flips two rows to one fired 18 stage ResizeObserver
  deliveries as the strip height CSS-transitioned 64→30 px over 210 ms — in
  the app that is a burst of PTY resizes and full TUI redraws (findings 2, 4)
- one Project switch runs 12–14 simultaneous transform/opacity transitions
  (finding 4); the switched-away five-Agent Project condenses to a name plus
  one 6 px aggregate dot (findings 3, 5)

Root causes, mechanically:

- the keyboard model (global tab ring, global `⌘1–9` ordinals) and the D41
  render model (selected-Project disclosure plus priority overflow) diverged:
  the ring walks tabs the ribbon refuses to render, and ordinal hints render
  inside tab nodes so hidden tabs cannot hint
- active-Project tabs carry admission priority 4, BELOW inactive needs-you
  Project headers (2) and quiet headers (3), so a Project's own neighbors are
  evicted while other Projects' chrome stays
- the strip's `height` is animated state in normal flow directly above a
  `flex-1` terminal; every intermediate frame is a real layout the terminal
  must absorb
- a collapsed Project renders name + one aggregated `size-1.5` signal dot;
  tab count and per-Agent state are unrepresented
- selection collapses one Project's tabs (token exits) and expands another's
  (token enters with scaleX) while every survivor translates — the motion
  vocabulary treats a selection change like a data change
- reorder rides HTML5 drag-and-drop: OS-snapshot ghost, a 3 px inset edge
  line as the only preview, no live gap opening, no drop settle

Contract (all seven findings owned):

- Inactive Projects render their tabs CONDENSED, never unmounted: per-tab
  glyph chips (status glyph, harness glyph, ~28 px) inside the Project group.
  Per-Agent needs-you/blocked/working stays visible per chip (finding 5), tab
  count is visible by existence (finding 3), every tab keeps a DOM anchor so
  hold-⌘ keycaps overlay EVERY ordinal-bearing tab including condensed ones
  (finding 1), and selection becomes a width/title transition on in-place
  chips instead of exit/enter storms (findings 4, 6). Hard overflow beyond
  the two-row budget still routes through `+N`.
- The strip's outer height NEVER changes on selection or disclosure; height
  may change only when the data set changes (open/close Project or tab) and
  then SNAPS without a transition, so the terminal absorbs exactly one
  resize per real change and zero per switch (finding 2). The bench's
  resize counter is the acceptance instrument.
- Admission priority reorders: after the active tab and Project headers, the
  ACTIVE Project's remaining tabs outrank every inactive Project's tabs —
  your own next tab can never be invisible while another Project's chrome
  is (finding 1). `⌘⇧]` therefore always lands on a visible tab in the
  active Project before crossing Projects.
- Reorder is pointer-based (finding 7): a 4 px movement threshold lifts the
  REAL tab (z-top, slight scale/shadow), it follows the pointer, survivors
  re-target live through the existing pure layout engine fed a hypothetical
  order, and drop settles the tab to its computed target with the shared
  210 ms ease. HTML5 drag-and-drop and the inset-line hint are deleted.
  Project drag gets the same treatment.
- Motion diet on selection: the only emphasized mover is the newly active
  tab; condensed↔expanded transitions animate width/opacity in place;
  Reduced Motion remains immediate everywhere.
- Landing this amends decision `0022`'s disclosure/motion contract
  (collapse-to-chip becomes condense-in-place; the two-row budget, manual
  order, dormant tail, and explicit-close rules stand) — record the
  amendment in `0022` when it lands, and D41's "landed contract" bullets
  are superseded where they conflict.

Verification: bench scenarios graduate into `eval:workspace:ribbon:bench` —
zero stage resizes across Project switches, exactly one per open/close,
keycap coverage equals ordinal-bearing tabs, ring-next lands only on visible
tabs, pointer-drag frame samples show live re-targeting, and the existing
wide/narrow, dormant-tail, and reduced-motion passes stay green.

Landed log (2026-08-02):

- `buildRibbonTokens` (exported, `tab-strip.tsx`) owns token order and the
  new admission ladder: active header 0, active tab 1, active-Project tabs
  2, needs-you/fault inactive headers 3, other headers 4, needs-you inactive
  tabs 5, other inactive tabs 6. Every Project's tabs are always tokens with
  a `condensed` presentation flag; the same builder computes hypothetical
  selections for `stableRibbonRows`, so height truth and render truth cannot
  drift.
- `layoutProjectRibbon` gained `parentId` admission dependency (a chip never
  renders without its Project header — the orphan-chip case observed at
  1080 px is structurally impossible) and `stableRibbonRows` /
  `ribbonHeightForRows` implement the selection-invariant height. The
  container's height transition is deleted; height snaps.
- Condensed chips: status glyph (attention/fault-bearing) plus a dimmed
  harness mark at ~46 px, tooltip leads with the tab's name, no close
  affordance (context menu retains every verb), stopped condensed tabs show
  a lifecycle-colored ○. `DelegationDots` and the context-label feedback
  affordance are expanded-only.
- `ribbon-reorder.ts` (pure, tested): reading-order `dropIndexForPointer`,
  block-preserving token reordering for tab and Project drags, and
  `placementForOrder` mapping a final order onto the existing
  reorder-beside verbs. `tab-strip.tsx` drives it with pointer capture — a
  4 px threshold, window-level move/up listeners, Escape cancel, click
  suppression after an engaged drag, and `data-ribbon-passive` guards on
  close/disclosure/feedback controls. HTML5 DnD, the drop-line hint, and
  the 50 %-opacity source ghost are deleted.
- Measured on the bench after landing: 0 stage resizes across switches in
  both directions (18 before), exactly 1 resize across a full drain of
  every Project's tabs (the single 2→1 row flip), 8 transitions per switch
  (12–14 before), visible keycaps 1–9 with ⌘ held (2 before), 13/13 ring
  stops land visible.
- Gates: `eval:workspace:ribbon:bench` (new, the five D42 gates),
  `eval:workspace:ribbon` and `eval:workspace:chrome` green unchanged, the
  workspace suite including new pure suites for reorder/admission/height and
  updated D41 behavior tests, full test battery green.
- Decision `0022` carries the amendment; ENG-021 E1.1's visible-identity
  rule is narrowed for inactive-Project tabs (glyph + tooltip identity),
  recorded in the roadmap Amendment chain.
- Review round (independent pass over the full diff, five confirmed
  findings, all fixed and re-verified): the dead-chip title collapse joins
  the width-presentation model (`titleCollapsed` on tab tokens) so a
  selection change over stopped tabs cannot flip the reserved rows; each
  height variant models the un-dorm its own selection would cause; a
  mid-drag unmount releases the window listeners and user-select lock
  without committing through stale closures; Escape-cancel keeps the
  gesture armed so the eventual release click is still suppressed; and all
  gesture handlers filter on the initiating `pointerId`.
- Review round two (post-landing; three independent lenses — adversarial
  correctness on the fixes, integration against concurrent master, UX/a11y
  doctrine — eleven confirmed findings, all fixed same day):
  - Height contract completed: measurements cache PER PRESENTATION
    (`ribbonTokenPresentation`; a key's width inputs can no longer flip
    between measured and estimated when the selection changes), each
    variant reserves the active Project's dead tabs UNCOLLAPSED
    (`reserveDeadExpansion` — a tab click is a selection change too), and
    the full-tab estimate ceiling was corrected to the real DOM maximum.
  - The D23 dead-chip hover-unfurl is deleted (it grew the chip ~200 px,
    feeding the width model and shifting layout — hover could flip the
    strip height and oscillate): stopped chips are title-less with badge
    and close; identity via tooltip/aria, matching condensed doctrine.
  - Project drag and the dormant tail now speak one projection: dormant
    chips cannot be grabbed, are excluded from drop-index siblings, and
    placement commits over the live order (preview always equals the
    committed display); a stale gesture's cleanup can no longer clobber a
    newer gesture's registration, and any zombie gesture is torn down
    before a new one arms.
  - `F6` chrome focus skips `inert` subtrees (an admission-evicted first
    Project header made F6 silently dead); the recent-conversations eval
    counts drafts by aria-label (condensed chips have no title text).
  - Grouping is spatial: `RIBBON_GROUP_GAP` (12 px) opens between
    Projects while chips sit 4 px from their own header, so ownership
    reads from spacing alone. The dragged chip goes opaque while lifted
    (its translucent wash overprinted crossed siblings), ordinal keycaps
    anchor RIGHT so they stop erasing the status glyph on 46 px chips,
    and the active tab/Project carry `aria-current` so selection exists
    semantically, not only as border color.
  - The bench gains per-tab stop/revive toggles and a fresh fixture tab so
    both previously unreachable legibility states are exercisable on the
    acceptance instrument.

### D43 Move-tab verbs surfaced

Status: landed 2026-08-02 (operator request while preparing to install the
D42 build). The D20 `⌘⌥[`/`⌘⌥]` tab-arrangement chords and their `⌘⌥⇧`
Project siblings existed but were undiscoverable — no ⌘K row, no `⌘/`
entry, no Session-menu item (the D42 UX review flagged the same gap as "no
keyboard reorder path"). Landed: **Move tab left / right** palette rows
dispatching `MOVE_ACTIVE_TAB_EVENT` into the same pure `moveTabWithinProject`
the chords use; a shared `move-tab` availability ("Needs a second Session in
the Project") driving palette rows, native **Move Tab Left / Right** Session
menu items (static `FIXED_MENU_ACCELERATORS` display, chords stay owned by
the renderer's capture-phase key layer), and the menu enablement sync;
`⌘/` fixed-family entries for both the tab and Project chords. The chrome
eval now reorders through the palette row and restores through the raw
chord, and its Settings-escape step waits for the settings chrome and
retries the press — the old single press could race the esc listener's
mount effect and produced a deterministic-looking timeout on a slower page.

### D44 Command discoverability contract

Status: landed and review-hardened 2026-08-03 (operator, on landing D43:
"this should never happen; can we prevent this systemically?").

Implementation result: `src/lib/shortcuts/fixed-families.ts` is now the one
typed declaration for fixed workspace behavior and `⌘/` help rows. Required
labels/keys make every family help-visible; the surfaced/unsurfaced union makes
palette and native-menu coverage either real or justified in writing. The key
layer dispatches manifest matches while preserving F6 → altitude → remaining
capture-family precedence, Escape applicability remains in the workspace
layer, and unavailable actions still leave default behavior untouched. Project
movement gained `⌘K` rows and native Session-menu items through one shared
event and `move-project` availability. Contract tests join every declared row
and menu id to its published surface, prove matcher separation, and render
every manifest plus registry label. The identity-checked workspace chrome eval
reorders Projects through the palette and raw chord and captures all three
formerly missing families in `⌘/`. The modal adds no new visual treatment: it
reuses the design-system semantic chrome, `text-sm` body rung, and established
`space-y-2`/`space-y-6` rhythm.

Review hardening (operator, same day) closed the gaps the first implementation
review found rather than accepting green tests as the contract. The executable
trigger descriptor now derives matcher behavior, help keys, palette key badges,
and native-menu accelerator parity; surfaced ids are non-empty tuples; and the
native Session-menu rows live in a pure Electron manifest joined directly by
the contract test. Directional availability disables only the impossible
left/right row at an edge (movement does not wrap), and successful reorder
actions announce their resulting position through a polite status channel.
Demo Workspace now mounts the same fixed-family dispatcher over fixture-backed
Project/Session actions, publishes directional availability, and exposes its
source-safe move rows in `⌘K`; `⌘/` no longer advertises inert Live-only keys.
The earlier F6/Escape refactor did deliberately normalize those families to
their exact displayed, modifier-free keys; this is recorded as an intentional
reserved-family tightening, not behavior-preservation.

UX decision from the review: keep `⌘/` exhaustive, searchable, and grouped by
operator task. Do not decorate every row as fixed/customizable. Linear's
searchable exhaustive sheet, Superhuman's `⌘K`-as-teacher model, and Raycast's
separate shortcut-management Settings all point to contextual learning in
palette/menu rows while mutability belongs in Settings. Exawatt follows that
shape: task language in help, shortcut badges on command surfaces, and no
implementation-category noise in the reading path. The status vocabulary now
participates in the same search instead of matching only the literal heading.

#### Why: D43 was a symptom, and three more are live right now

D43 surfaced `⌘⌥[`/`⌘⌥]` eleven days after D20 shipped them, because the
chords had no face on any surface. An audit of every command the workspace
key layer handles against the three discoverable surfaces (`⌘/` cheat sheet,
`⌘K` palette, native Session menu) found the same failure in three more
places, all still live on `master`:

| Command                      | Chord                 | In `⌘/`?  | Note                                                                                                                               |
| ---------------------------- | --------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Jump to tab N                | `⌘1`–`⌘9`             | **no**    | D18 gave it "the cheapest chord" as the highest-frequency switch in the app; it has never been listed anywhere in-app              |
| Move focus terminal ↔ chrome | `F6`                  | **no**    | shipped by D5 as an adoption blocker; documented only in a source comment                                                          |
| Return focus to the terminal | `Escape`              | **no**    | same. Note the help modal's one `Escape` row is the Fleet board's "zoom out selection" — a different subsystem's key, not this one |
| Move tab / Project           | `⌘⌥[`/`]`, `⌘⌥⇧[`/`]` | yes (D43) | the reported case                                                                                                                  |

So `⌘/` — the surface whose entire job is "all keys" — is not exhaustive,
and has no mechanism that makes it exhaustive.

#### Root cause: one command class has no manifest

There are two classes of command, and only one of them can go dark:

- **Registry-backed** (`src/lib/shortcuts/defaults.ts`). Self-documenting by
  construction: `⌘/` enumerates the registry, so an entry cannot be
  invisible, and Settings can rebind it. This class has never had this bug.
- **Fixed key families** — matched positionally by hand-written
  `if (event.code === 'BracketLeft')` branches in
  `use-workspace-shortcuts.ts`. Nothing links a branch to anything.
  `⌘/`'s `FIXED_FAMILIES`, the palette's `workspaceItems`, and the native
  menu template are three independent hand-maintained lists, and the only
  connective tissue is the prose comment at the top of the key-layer file.

ENG-016 D8 already solved this exact shape for navigation ("one typed
navigation manifest drives palette, go-chords, header links, and footer
suppression so surface lists cannot drift"), and D9 solved it for
rebindable verbs by moving them into the registry. Fixed families are the
one command category that got neither. D44 closes that gap with the same
pattern, so the fix is a known-good move rather than a new invention.

#### The contract

1. **Behavior derives from the manifest.** The key layer dispatches by
   iterating the manifest, so an undeclared chord does not fire at all —
   the prevention is structural, not a lint someone can forget.
2. **A declared chord always has a name.** `label` and `keys` are required
   fields, so `⌘/` can always render it.
3. **An omission is a decision on the record.** A family either lists real
   palette row ids and menu command ids, or sets both to `null` and carries
   a written `discoverability` reason. The type union forbids silence.
4. **A test holds all three**, so the next D20 fails CI instead of shipping.

#### Execution plan

**Step 1 — `src/lib/shortcuts/fixed-families.ts` (new).** The manifest.
Type shape (the union is what forbids an undeclared omission):

```ts
export type FixedFamilyAction =
  | { kind: 'cycle-tab'; delta: 1 | -1 }
  | { kind: 'move-tab'; delta: 1 | -1 }
  | { kind: 'move-project'; delta: 1 | -1 }
  | { kind: 'select-project'; index: number }
  | { kind: 'select-tab'; index: number }
  | { kind: 'toggle-focus' }
  | { kind: 'focus-terminal' };

/** structural slice of KeyboardEvent, so matchers are pure and DOM-free */
export interface FixedFamilyKeyEvent {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

type Surfaced = {
  paletteRowIds: readonly string[];
  menuCommandIds: readonly string[];
};
type Unsurfaced = {
  paletteRowIds: null;
  menuCommandIds: null;
  /** REQUIRED: why this family has no row and no menu item */
  discoverability: string;
};

export type FixedKeyFamily = {
  id: string;
  label: string; // what ⌘/ shows — required
  keys: KeyBinding; // display combo, not a matcher
  category: ShortcutCategory;
  phase: 'capture' | 'bubble';
  /** matched before the absolute command altitudes (F6 only) */
  outranksAltitudes?: boolean;
  match(event: FixedFamilyKeyEvent): FixedFamilyAction | null;
} & (Surfaced | Unsurfaced);
```

Export `WORKSPACE_KEY_FAMILIES` in **precedence order** (the key layer takes
the first match). Each matcher must be complete on its own — require
`metaKey && !ctrlKey` inside the predicate rather than relying on an outer
gate, so precedence can never be changed by accident:

| id                       | label                                  | keys            | phase                        | palette / menu                                                                              | if none, the reason to record                                                                                              |
| ------------------------ | -------------------------------------- | --------------- | ---------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `fixed-focus-toggle`     | Move focus between terminal and chrome | `F6`            | capture, `outranksAltitudes` | none                                                                                        | focus movement has no nameable target — a palette row would mean leaving the palette to move focus elsewhere               |
| `fixed-tab-ring`         | Previous / next tab (global ring)      | `⌘⇧[` / `⌘⇧]`   | capture                      | none                                                                                        | the `⌘K` switcher lists every Session directly, so stepping the ring from a row reaches something already on screen        |
| `fixed-move-tab`         | Move tab left / right                  | `⌘⌥[` / `⌘⌥]`   | capture                      | `ws-move-left`, `ws-move-right` / `move-tab-left`, `move-tab-right`                         | — (landed in D43)                                                                                                          |
| `fixed-move-project`     | Move Project left / right              | `⌘⌥⇧[` / `⌘⌥⇧]` | capture                      | `ws-move-project-left`, `ws-move-project-right` / `move-project-left`, `move-project-right` | — (**new in D44**, see Step 4)                                                                                             |
| `fixed-project-ordinals` | Jump to Project 1–9                    | `⌘⌥1…9`         | capture                      | none                                                                                        | the palette opens any Project by name, which subsumes positional jumps and keeps working past the ninth                    |
| `fixed-tab-ordinals`     | Jump to tab 1–8, or 9 for the last tab | `⌘1…9`          | capture                      | none                                                                                        | the `⌘K` switcher lists every Session by name and status; a positional row would say less about the same target            |
| `fixed-focus-terminal`   | Return focus to the terminal           | `Escape`        | bubble                       | none                                                                                        | Escape belongs to the agent while the terminal owns focus (D5); from chrome it is an ambient back-out with nothing to name |

Also export `BOARD_KEY_FAMILIES` (display-only: `id`/`label`/`keys`/
`category`, no `match`, no surface obligation) carrying the seven Fleet
board rows currently hard-coded in the help modal, and
`ALL_FIXED_FAMILIES = [...WORKSPACE_KEY_FAMILIES, ...BOARD_KEY_FAMILIES]`.

**Step 2 — `use-workspace-shortcuts.ts`.** Replace the hard-coded bracket
and digit branches with manifest iteration plus one
`applyFixedFamilyAction(action, actions): boolean` switch. Invariants that
must survive the refactor (all are load-bearing and currently only enforced
by reading the file):

- `F6` is matched before the altitude family; the altitudes are matched
  before the bracket/digit families, so an altitude rebound onto a bare
  `⌘digit` still wins there (existing comment, D19).
- Every action still reports whether it applied, and `preventDefault()` runs
  **only** when it did, so impossible chords keep browser behavior.
- `Escape` keeps its guard in the layer, not the manifest: `match` answers
  "which command does this keystroke name", the layer answers "is it
  applicable right now" (it must not fire while the terminal owns focus).
- The registry-resolved verb list and the shift-alias pass are untouched.

**Step 3 — `shortcut-help-modal.tsx`.** Delete the local `FIXED_FAMILIES`
constant and render from `ALL_FIXED_FAMILIES`. This is what closes the three
live gaps — no other change is needed for them to appear.

**Step 4 — the Project-move surfaces.** The manifest declares row and
command ids for `fixed-move-project`, so they must exist. Mirror D43 exactly:
palette rows `ws-move-project-left` / `ws-move-project-right` dispatching a
`MOVE_ACTIVE_PROJECT_EVENT` (new, beside `MOVE_ACTIVE_TAB_EVENT` in
`session-jump.ts`) handled in `workspace-client.tsx` by the existing
`moveActiveProject`; native `Move Project Left` / `Move Project Right`
Session-menu items with `FIXED_MENU_ACCELERATORS` display entries; a
`move-project` availability in `workspace-command-availability.ts`
(`canMoveProject`: more than one open Project) wired through
`workspace-client.tsx`, the `shortcut-provider.tsx` command switch, and its
`syncAvailability` call.

**Step 5 — the contract test** (`src/lib/shortcuts/fixed-families.test.ts`
plus an addition to the help-modal test):

1. Ids are unique; every entry has a non-empty `label` and `keys`.
2. Every `Unsurfaced` entry's `discoverability` is a real sentence — assert
   a minimum length (~40 chars) so `'n/a'` cannot satisfy the type.
3. Every `Surfaced` entry's `paletteRowIds` exist in the palette's row ids
   (export a `WORKSPACE_PALETTE_ROW_IDS` set from `command-palette.tsx`),
   and its `menuCommandIds` are all present in the id set
   `shortcut-provider.tsx` publishes through `menu:sync-availability` —
   that map is the real join point, since an item missing from it is
   unconditionally enabled.
4. Matcher behavior, against synthetic `FixedFamilyKeyEvent`s: each family
   matches its own chord with the right `delta`/`index`, and **no family
   matches another's chord** (the `⌘⌥[` vs `⌘⌥⇧[` vs `⌘⇧[` and
   `⌘1` vs `⌘⌥1` vs `⌃⌘1` separations are the ones that actually bite).
   This is what makes the Step 2 refactor provably behavior-preserving.
5. In the rendered `⌘/` modal: every `ALL_FIXED_FAMILIES` label AND every
   registry command label appears. This is the assertion that fails when
   the next fixed family is added without a face.

**Step 6 — verification.** `pnpm test:run`, `pnpm lint`,
`EXA_BASE=… pnpm eval:workspace:chrome` (it exercises the palette rows and
the raw chord), and one screenshot of `⌘/` confirming the three previously
missing families now render.

#### Decisions already made — do not re-litigate

- Fixed families stay **non-rebindable**. D13 reserves these key families
  deliberately; D44 makes them discoverable, not configurable.
- `⌘/` coverage is **mandatory for every command**; palette and menu rows
  are opt-in with a recorded reason. Forcing a palette row for `⌘1`–`⌘9`
  would add noise to the surface that already lists those Sessions by name.
- Board keys are declared display-only. Their behavior lives in the R3F
  surface as plain keys on a focused canvas, not in the workspace chord
  layer, so joining them to a matcher is out of scope. Known consequence,
  accepted: a NEW board key could still drift; the contract test catches
  workspace chords only.

Follow-on candidate, not in scope: the same audit for surfaces that are
reachable only by mouse (context-menu-only verbs), which no surface
enumerates today.

#### Queued dogfood fix — 2026-08-03

Feedback row `88c4e13d-7f6b-464f-9cfa-18b0eaf2513f` reports a bounded keyboard
regression in the shipped command palette: after opening ⌘K, the first Down
Arrow does not select the first row in the top visible table/group and instead
lands in a lower section. This is queued under D44 because keyboard behavior,
rendered command order, and the palette's discoverability contract must agree;
triage records the work but does not execute it.

Acceptance contract for the eventual fix: from a newly opened, unfiltered
palette with focus in its query, the first Down Arrow selects the first enabled
row in the first rendered group; headings and disabled structural rows are not
roving targets; Up Arrow is symmetric at the boundary; filtered and Demo/Live
palettes retain the same ordering rule; and a focused component test plus the
identity-checked Electron chrome evaluator cover the reported path.

### D45 Single-row ribbon: fold, then scroll

Status: landed 2026-08-03 — operator dogfood on the installed D42/D43 build
("a lot better and more robust… still needs work in the transitions or
reducing the number of states"); operator confirmation of the new feel
remains dogfood evidence.

Reports, and what the bench measured for each:

1. **Mini tabs are not durable.** The operator liked Exawatt-expanded →
   Switcheroo showing Exawatt's five mini tabs, then lost them on the next
   switch. Measured at 1100 px on his shape: with the five-tab Exawatt
   active, **all four other multi-tab Projects lose every mini chip** (9
   items overflow, header-only); selecting the one-tab Switcheroo brings all
   13 back. The ribbon's information content depends on how many tabs the
   Project you happen to be in has — D42 kept chips rendered but the two-row
   budget still evicts them.
2. **Too much movement**, ranked by the operator: row hopping worst, then
   chips appearing/vanishing, then chips resizing. Lateral sliding is fine
   and should stay smooth.
3. **Too much whitespace**: 33 px between a Project label and its `◇`
   (signal dot + an always-reserved invisible dormancy slot + padding), and
   8 px plus a 24 px close button inside a 28 px-tall tab.
4. **The `◇` keep-expanded control was never understood** — "I had no idea
   what that did as a user."

Contract:

- **One row.** The two-row budget, the wrap packer, and the `+N` button
  retire. This deletes row hopping structurally (complaint 2's worst case)
  and makes strip height constant by construction — `stableRibbonRows`, the
  per-selection hypothetical variants, and the dead-tab width modelling all
  go with it, since a single row cannot change height.
- **Nothing is ever evicted.** When space runs short a Project _folds_ into
  a counted container (`▌name ▸5`): the work stays visible as a number
  instead of vanishing. Quiet Projects fold first, in reverse manual order;
  the active Project never folds.
- **Chrome-style tab widths.** The active Project's tabs share the leftover
  width, shrinking between a min and a max before anything scrolls, so the
  common case never scrolls at all.
- **Horizontal scroll with edge fades is the last resort**, reached only
  after everything foldable is folded. The active Project auto-scrolls into
  view. (Operator: "fold + scroll at the extreme".)
- **Three presentations, no fourth**: open (the active Project — full tabs),
  mini (glyph chips), folded (counted container). `ribbonExpanded` and its
  `◇` control are deleted from the type, the persisted layout, the context
  menu, and the strip. Persistence stays at v6 — the field is optional, so
  existing layouts simply stop being read for it.
- **Motion**: width SNAPS, position tweens. A chip that jumps to its new
  width and then slides reads as movement rather than stretching, which is
  complaint 2's third case; sliding is what the operator said he wants kept.
- **Density**: drop the always-reserved dormancy slot, tighten chip padding
  and gaps, and shrink the close button's footprint.
- **The overflow policy is one tunable object** (fold order, min/max tab
  width, fold threshold) so the behaviour can be changed after dogfooding
  without re-architecting — the operator asked for exactly this: "build it
  well enough that we can test and change our minds after playing with it."

Supersedes decision `0022`'s hard two-row budget and D41's overflow route;
the amendment is recorded in `0022`.

Landed log (2026-08-03):

- `project-ribbon-layout.ts` is a new single-row engine: `layoutRibbonRow`
  returns x-targets, a per-Project presentation, `contentWidth` and
  `scrollable`. The fold budget is computed for the WORST-CASE active
  Project, which is what makes the presentation set selection-invariant —
  the direct fix for the reported bug. `DEFAULT_RIBBON_POLICY` holds every
  tunable (min/max tab width, folded width, gaps).
- `tab-strip.tsx` reads presentation back from the engine instead of
  deciding it, so paint truth and width truth cannot disagree. Only Project
  headers are measured, and only from their unconstrained inner chrome, so
  no measurement can feed back into a width the engine assigned — the
  entire per-presentation width cache, hypothetical variants, and
  `stableRibbonRows` are deleted.
- Tab chips take a Chrome-shrunk width; once tight, the harness glyph drops
  and the close button becomes an absolutely-positioned hover reveal, which
  costs no reflow and buys ~40px of title. Titles that read "Clos"/"Fix"
  now read "Close Pro"/"Fix Sessions".
- Density: the always-reserved dormancy slot is gone, chip padding and gaps
  are tightened, and the folded chip's width is content-derived so a short
  name leaves no dead space.
- Measured on the bench at the operator's shape: strip height a constant
  **30px** (was 64px — the terminal gains 34px), **0 stage resizes across
  six Project switches**, **5 transitions per switch** (12–14 at D42, 8
  after its review round), and identical inactive-Project presentation
  whichever Project is selected.
- Gates: `eval:workspace:ribbon` rewritten to the single-row contract (one
  row, no overflow button, folding with counts at narrow widths),
  `eval:workspace:ribbon:bench` gate 2 becomes "height never changes at
  all", `eval:workspace:chrome` green after re-pointing its fixtures at the
  Project the sweep stands in; 308 workspace tests and the full 1288-test
  battery green.
- Review round (same day, four confirmed defects — all introduced by D45
  itself, all fixed and re-verified in the browser):
  - **The scroll fade clipped the context menu.** A mask paints its whole
    subtree, so putting it on the outer strip sliced the fixed-position
    Project/Session menus to a sliver whenever the row scrolled — right
    click was effectively broken at density. The mask moved to the
    scroller, which is the element that actually scrolls.
  - **Dragging did nothing once the row was scrolled.** Targets live in the
    scroller's content space while pointer coordinates were read against
    the outer element, so every gesture was off by `scrollLeft`. Both the
    grab and the move now include it.
  - **A pointer drifting a few pixels below the strip flung the chip to the
    end**, because the drop index still consulted a row number that only
    the retired two-row layout could produce. One row means the index is a
    function of x alone.
  - **The header measurement was a no-op that echoed its own output.** The
    chrome fills the width the engine assigns, so measuring its box handed
    that width straight back and the header could never grow to fit a
    longer name — a name past the estimate's cap would have truncated
    permanently. Natural width is now built from the parts (padding, gaps,
    non-label children, and the label's untruncated `scrollWidth`), which
    also removed the last few pixels of dead space: every header now
    measures exactly its content.
  - **The visible Session label and its width input disagreed.** The
    context-label improvement painted each Agent's durable context label,
    but the ribbon still budgeted from the stored provider title (`Codex`,
    `Claude Code`). On a wide strip this left hundreds of pixels unused
    while every visible label ellipsized. Open-tab natural widths now derive
    from the same `sessionDisplayCopy` projection that paints the label, so
    available whitespace goes to readable identity before truncation.
  - Auto-scroll additionally learned to stand down mid-drag, where the
    per-move relayout would otherwise have fought the pointer.
  - A 500-case fuzz over the pure engine confirms the headline property
    holds: an inactive Project's presentation never depends on which
    Project is selected.
- Systemic pass (2026-08-03, operator: "improve the underlying system
  holistically, not just monkey patches on layered fixes"). The review
  round fixed four instances; this removes the classes they came from:
  - **One coordinate space.** `ribbonContentX` is now the only way to turn
    a pointer event into ribbon content coordinates. The scrolled-drag bug
    existed because that conversion was hand-rolled at two call sites and
    one of them forgot `scrollLeft`; a third hand-rolled site would have
    reintroduced it, so there is no longer anywhere to hand-roll.
  - **The row concept is deleted, not defended against.** `dropIndexForPointer`
    takes an x and nothing else. The below-the-strip fling happened because
    row math outlived the two-row layout; patching the call site with
    `y: 0` would have left the trap armed for the next caller.
  - **Measurement cannot echo layout.** `natural-width.ts` builds a width
    from parts that are content-sized by construction (padding, gaps,
    intrinsic siblings, the flexible child's untruncated `scrollWidth`) and
    documents why reading a chip's own box is a closed loop rather than a
    measurement. Its test asserts the invariant directly: same content in
    a 40px box and a 400px box must measure identically.
  - **Folded Projects hint their ordinals.** A folded container's tabs have
    no chip to hang a keycap on, so holding ⌘ made `⌘3` a reachable command
    that nothing on screen could point at — the D44 failure shape inside
    the ribbon. Folded containers now show the ordinal span they hold
    (`1–2`) in keycap chrome, distinct from the plain count pill so a
    one-Session Project's "1" cannot be misread as ordinal 1. Verified:
    with five of six Projects folded, every ordinal 1–9 has a visible hint.
  - D44 itself (the command discoverability contract this planned) was
    executed separately by another agent in `c863f8e`/`c7f26b1`; its
    manifest, key-layer derivation and contract test are in place, so the
    ⌘1–9 / F6 / Escape gaps the audit found are closed.
- Chip density pass (2026-08-03, operator choices on side-by-side renders):
  - **One mark per glyph chip.** The source swirl leaves the collapsed
    chips — status is the whole job at that size, and the swirl cost the
    width that decides when Projects fold. Claude-vs-Codex stays legible
    on the Project you are in, in the tooltip, and in ⌘K. Chip width drops
    40 px → 26 px, so five Projects now sit where three did.
  - **The Project dot yields to the chips it summarises.** It renders only
    on a FOLDED Project, whose chips are not drawn and for which it is the
    only status available. It is deliberately absent on an empty Project
    too: there are no Agents to summarise, and rendering an always-quiet
    mark there would change the header's width the instant its last tab
    closed — which broke D41's pointer-close stability window and was
    caught by `eval:workspace:ribbon` before landing.
  - Found while rendering the comparisons: every Project name was drawing
    an ellipsis it had not earned (`lumen-agent` → `lumen-agen…`). `scrollWidth` is
    an integer, so a 50.4 px name reported 50 and the renderer clipped the
    0.4 px it was never given. Three prior audits missed it because the DOM
    reported no truncation; only 2× screenshots showed it. Fixed in
    `natural-width.ts` with a test (`5df848d`).
- Tuning dial and dead-wiring removal (2026-08-03, operator answers):
  - Asked which of scroll / narrower tabs / earlier folding he wanted at his
    density; he said all three are acceptable and he needs to play with it.
    So the choice became a NUMBER rather than three hardcoded options:
    `comfortTabWidth` is how much title the active Project's tabs are
    entitled to before quiet Projects fold to protect them. At the floor
    (the default — today's behaviour unchanged) tabs shrink and the row
    scrolls the last inch; raised, quiet Projects fold sooner and nothing
    scrolls; lowering `minTabWidth` gives the shorter-titles outcome.
    Everything between is reachable. `TabStrip` takes an optional
    `layoutPolicy`, and `/hud-gallery/project-ribbon/bench` drives both
    knobs live so the tuning can be felt before it is chosen. Measured on
    the operator's shape at 1440: floor → scrolls, 0 folded, 118px tabs;
    protect 200 → no scroll, 5 folded, 132px tabs; 90/90 → no scroll, 0
    folded, 103px tabs. Selection invariance is asserted at every setting.
  - The overview's `OPEN_OVERVIEW_EVENT` is deleted outright — no shim. The
    `+N` button was its only sender and retired with the overflow model; the
    Team altitude (`⌃⌘2`, `?view=sessions`) is the visible home and the
    operator confirmed the rail is enough. A listener with no sender is
    exactly the kind of debt the burn-bridges rule exists for.

- Readability correction (2026-08-03, operator review): the 118px default
  preserved only about nine characters and was rejected after dogfood — the
  equal-width interaction was right, but the titles were not readable. The
  authenticated strip had a second defect the bench did not mount: two
  transparent context-rating buttons still occupied about 40px of every
  title row, producing a clipped label followed by apparent whitespace.
  Active-Project tabs remain equal-width, but the default readable band is
  now 380–400px and the row scrolls before a tab exposes fewer than four full
  words. Context feedback is an absolute hover/focus overlay, so it never
  participates in title flex allocation or changes width when revealed.
  The bench now mounts authenticated feedback plus delegated-child truth,
  uses the generated HUD surfaces instead of a hardcoded dark canvas, and
  gates equal widths, four visible words on the worst delegated fixture,
  overlay-without-reflow, full ordinal coverage through folded containers,
  and close-up Night/Air idle/reveal screenshots. Typography and dense-row
  spacing remain on design-system G0's `text-chrome-title`, `px-2`, and
  `gap-1.5` rungs; this changes allocation, not the visual vocabulary.

- Chrome width model (2026-08-04, operator review, supersedes the 380–400px
  band above): "the tabs are still too wide… compressed a little bit, text
  always left-aligned, and expand this wide only when there's enough space,
  kind of dynamically, just like Google Chrome tabs." The band is now
  **180–240px**: a tab is as wide as its title wants up to the cap, shrinks
  equally with its siblings as the row fills, and the row scrolls only once
  the floor is reached. Four defects were found underneath the width
  complaint, each of which had been making tabs read as broken:
  1. **Titles were centred.** The tab chrome is a `<button>`, and the UA
     stylesheet centres button text. A title shorter than its tab floated in
     the middle with padding on both sides. `text-left` is load-bearing.
  2. **Selecting a tab scrolled it out of view.** The reveal effect spanned
     the whole Project block — header through active tab — so once a Project
     was wider than the row the "scroll left to reach the start" branch
     always won and dragged the row back to the header. ⌘T's new tab at the
     end and any click on a right-hand tab both jumped to the first tab. The
     reveal now targets the selected TAB, brings the header along only when
     both fit, and re-asserts only on a selection change, a new tab, or a
     resize — never on an unrelated re-render.
  3. **~50px across the middle of every hovered Agent tab was dead.** The
     context-rating overlay flipped `pointer-events-auto` on its whole box on
     hover, so clicks meant to select the tab hit the backdrop. Only its
     buttons take pointer events now, and it rides the ACTIVE tab only —
     where a click is already a no-op — so every other tab keeps its whole
     face as a selection target.
  4. **The delegated-child cluster reserved all five slots.** Under the D45
     engine a tab's width comes from the layout policy and the title flexes
     inside it, so the cluster cannot resize anything; the empty slots bought
     only a band of dead space between the glyph and the title. It is now
     exactly as wide as the children it reports. The "constant width"
     contract moves to where it actually belongs — the TAB's width, asserted
     across spawns.

  The floor is set from what is left for the TITLE, not from the tab box: an
  Agent tab also carries a status glyph, the delegation dots, and the active
  tab's close control, about 84px once the harness glyph has dropped out. At
  132px that left 35px of title, roughly four characters. Below 200px the
  harness glyph drops and the close control stops reserving a column on
  inactive tabs; the threshold sits where a tab just above it never shows
  less title than one just below. Middle-click closes a tab, completing the
  Chrome verb set beside ⌘W and the × control.

- Fold probe inversion (2026-08-04, found by sweeping the bench across its
  full width range rather than sampling it). `slice(-Math.max(0, foldCount))`
  is `slice(-0)` → `slice(0)` → the WHOLE array, so the fold search measured a
  row with EVERY quiet Project folded when it meant none, while the placement
  correctly read 0 as none. Probe and painted row were inverted: the search
  stopped the moment the all-folded row fit, and the ribbon then drew the
  un-folded one. Widening 1180px → 1200px unfolded five Projects at once,
  snapped tabs from 206px back to the 180px floor, and started the row
  scrolling — growing the ribbon made it strictly worse.

  The flaw is as old as D45 but was unreachable under the 380–400px band,
  where tabs sat at the floor across the entire 680–1480px range and there was
  no width curve to be non-monotonic. The Chrome band is what exposed it.
  Fixed by giving the probe the same "0 means none" reading as the placement.
  A residual 5–13px sawtooth remains where releasing a fold hands some width
  back to the reopened Project; that is the honest cost of a discrete fold
  ladder and introduces no scrolling. Gated by a sweep test asserting a wider
  ribbon never collapses tabs to the floor, and never scrolls while tabs are
  above it.

  Still open, and now the dominant readability lever: the context label is
  allowed 72 characters (`MAX_CONTEXT_LABEL_CHARS`) and the generator prompt
  explicitly declines a word budget, while the operator has three times
  corrected a shown label to a short work-world name — "Improve spatial UI",
  "New app icon", "OpenCode support + improved new-agent UI" (see
  `objective-engine.md`). At Chrome widths a 72-character label is always
  truncated. Shortening what the label SAYS is the remaining half of this and
  belongs to ENG-021, not to the ribbon.

### D46 The Launch Configuration ribbon

Status: landed 2026-08-03. Decision `0028` carries the amended control model.
ENG-003 S2 supplies the third real engine and ENG-003 S3 supplies the scalable
searchable/provider-grouped model-axis foundation.

The composer's control row is five independent selectors plus an unlabelled
shell icon and a preview link. Every one of them is provenance-honest and
individually well-built, and together they make the most common act in the
product a five-decision form. Two pressures make that untenable rather than
merely dense: a third launchable source arrives with a catalog of hundreds of
models, and ENG-028's Type needs a home that is not a sixth dropdown.

Operator framing, 2026-08-03: engine chips and named presets are _"same-class
citizens... so in the future we can have automatically frecent engines /
presets in the same sort of row / ribbon."_ The confirmed simplification is
equally load-bearing: this page should be _"super lightweight"_, not a place
where people spend time building an Agent. The three dominant jobs are start
the recommended Agent, switch the whole Agent choice and start, or open Shell.

Contract:

- **One lightweight ribbon replaces the selector row.** Normal launch-control
  state is task, one compact non-wrapping ribbon, and Start — no always-visible
  axis editor, configuration Draft badge, or preset-management panel. D31's
  Project-scoped recent-conversation browser remains secondary content with its
  plain-arrow and Enter semantics unchanged. A chip is one whole Agent launch.
  Identity is stable configured Agent Source ID + source-native model ID + exact
  effort/variant + optional Type ID. Harness is derived; permission,
  worktree/branch, and roadmap association remain draft-local launch modifiers
  and never fork or rank a configuration.
- **Model-first labels, harness as glyph and brand colour.** `◈ Opus 5 · High`,
  `◆ GPT-5.3 · xhigh`, `◇ Kimi K3`, `▣ Shell`. A named configuration displays
  its preset name (`⚡ Reviewer`). The glyph alone receives harness brand colour;
  the chip label stays in the normal identity channel and the accessible name
  states the full source/model/effort/Type identity.
- **No Launch Configuration draft lifecycle.** Identity edits in the compact
  secondary editor may ride the existing composer draft tab's exact launch
  snapshot across switches/restarts, but they do not create a reusable
  configuration or affect rank. Close that draft without a successful launch or
  explicit name and no reusable object remains. Successful launch structurally
  deduplicates or adds the configuration. Naming is a one-field secondary
  action that saves a friendly preset; it does not increase frecency, create an
  Agent Type, or introduce `⌘S`.
- **Only successful launches train rank.** One app-wide pool is ranked per
  Project; navigation, selection, edits, names, failures, and abandoned work do
  not count. Project-local pins sit above learned results. The order freezes
  while the composer owns interaction and reranks on next entry, never under a
  focused chip or pointer. The singleton Shell launch target participates in
  the same Project ordering and may be pinned; only a successful Shell launch
  trains its rank, without turning it into an Agent configuration.
- **The three fast jobs stay literal.** `⌘T`, type, Enter launches the selected
  default. `⌘T`, then the visibly taught `⌥↑/↓`, cycles whole configurations
  while task focus stays put; type and Enter launches. `⌘⌥T` opens Shell
  directly. The standard keyboard/accessibility route remains one labelled
  radio-like ribbon tab stop with Left/Right selection, Home/End, and full
  accessible names; task-field arrows keep their normal text/recents behavior.
- **Shell is a peer presentation over a distinct domain variant.** It has no
  Agent Source/model/effort/Type/permission axes, never receives task text, and
  is not eligible for cross-source cloning. The unlabelled shell icon retires;
  the direct chord remains.
- **Customization is secondary and quick.** One compact Customize disclosure
  owns source, searchable model, effort, future Type, and initial Name. The Type
  entry uses the canonical `announced` treatment until its mechanism ships;
  naming remains only a preset label. Pin/Unpin, Rename, and Delete live in the
  Agent configuration chip/All-row secondary menu instead of weighing down
  Customize. Shell exposes Pin/Unpin only and cannot be renamed or deleted.
  Changing configured source invalidates the source-native model atomically;
  changing model reconciles effort only to source-observed
  capabilities/defaults with provenance.
- **The complete catalog has a visible route.** Intrinsic chip widths determine
  how many fit (roughly five at the current 768px composer, three near 520px,
  one or two near minimum width). The row never wraps. A visible **All
  configurations…** disclosure exposes the tail; `⌘K` mirrors the same catalog
  and is never its only home. The selected item stays visible and rank cannot
  move while focus is inside.
- **Missing capability remains inspectable.** A configuration whose source,
  provider, model, or requirement is unavailable stays identifiable and
  selectable for inspection, carries the exact missing fact, and blocks Start;
  no substitution. Readiness is revalidated at the launch boundary.
- **One state and command owner.** Ribbon, compact editor, All catalog, `⌘K`,
  and Session clone derive from the same selector and exact launch translation.
  Source-only request paths migrate with compatibility rather than becoming a
  parallel abstraction.
- **Clone to… is the cheap cross-source gesture.** It is manually available on
  any started Agent Session through its keyboard-complete context menu and
  `⌘K`. It starts a new Agent on an available configuration using bounded
  `sessionClonePrompt` handoff
  content, leaves the original untouched, passes no provider resume identity,
  and excludes Shell. Explanatory copy says it starts a new Agent with a
  handoff. The freeze-and-reinflate half remains unshaped elsewhere.

Explicitly not in scope:

- building, sharing, or persisting Types as portable bundles — naming here is
  only a friendly preset label
- a second permission system; launch policy stays ENG-016 D14's per-Project /
  per-harness Ask first / Auto-review / YOLO, provider-enforced per `0016`
- automatic engine failover on a detected rate limit. The operator asked for a
  one-gesture handoff, and pattern-matching harness output for a limit message
  is exactly the inference class this repo has been burned by (D4, D38, D40).

Execution slices:

1. **Contract and model-axis foundation.** Land these canon amendments and the
   searchable provider-grouped/recent+pinned model chooser from ENG-003 S3.
2. **Pure configuration domain/store.** Add stable IDs, Agent/Shell variants,
   structural equality, availability reconciliation, versioned app-wide pool,
   deterministic Project usage/pins, migration from source memory, safe
   read/write failure behavior, and explicit Rename/Delete behavior. Do not add
   a configuration-draft store or automatic eviction; retention/removal is
   explicit through Delete in this slice.
3. **Gallery-first shared components.** Following
   `docs/engineering/design-system.md`, prototype the real ribbon, compact
   editor, All disclosure, and Session-side Clone action in `/hud-gallery` at
   768px, 520px, and minimum width across Classic/Air/Night, reduced motion,
   named/unnamed/pinned/unavailable/Shell/Type-announced/overflow states. No R3F
   sibling is needed. Get operator acceptance before production wiring and
   retire the study after shipping.
4. **Composer integration.** Refactor the independent state into one selected
   configuration reducer while preserving catalog sequencing, draft-tab
   snapshots, task/IME/Enter/recents behavior, permission fail-closed loading,
   worktree/roadmap modifiers, exact typed launch values, and Shell's no-task
   boundary.
5. **Command parity and Clone.** Give ribbon, All, `⌘K`, native menu, and Clone
   one command owner; remove or remap bare harness commands so they cannot
   recreate the superseded selector model. Add the fresh-handoff Session path.
6. **Verification, documentation, and dogfood.** Extend the current component
   and Electron evaluations, synchronize public-safe docs, land, and install the
   clean-master dogfood build.

Verification the milestone owes:

- a keyboard-only path from `⌘T` to a started Agent on a non-default
  configuration, with no pointer; explicit tests cover the three dominant
  paths above, roving selection, discoverable help/menu/palette faces for `⌘T`,
  configuration cycling, and `⌘⌥T` together, focus stability, unavailable
  configuration inspection, searchable-model Escape, and full accessible names
- the composer's existing evals (`launch-controls.test.tsx`, the workspace
  Electron evals) extended rather than replaced — every current invariant about
  draft-tab persistence, provenance labels, and fail-closed source readiness
  survives the redesign
- all three live Agent Sources plus Shell produce exact launch objects; selected
  model/variant never silently falls back; Project+source permission and
  worktree/branch/roadmap modifiers remain exact and outside configuration
  identity
- deterministic tests prove only successful launch changes rank, pins are
  Project-local, structural duplicates collapse, order freezes during
  interaction, corrupt settings fail safely, and unavailable facts survive
  round-trip without substitution
- responsive Electron evidence covers the existing 560x400 through 1600x900
  matrix plus selected-item visibility; screenshot evidence covers
  Classic/Air/Night and the gallery study is retired after acceptance
- every launchable ribbon configuration has an equivalent All/`⌘K` row, and
  selecting the same ID produces the same launch translation everywhere
- Clone starts a distinct Session with bounded handoff copy, preserves the
  original, excludes Shell/unavailable targets, and passes no resume identity
- shipping rewrites `docs/product/guides/getting-started.md`, the Agent Sources
  and Session lifecycle references, Product Concepts, and the forthcoming
  public Guides/Docs together, teaching Claude Code, Codex, OpenCode, Shell,
  the three fast keyboard paths, Customize/All/pins, and Clone's new-Session
  boundary
- shipping updates `docs/engineering/architecture.md` and
  `src/lib/architecture/manifest.ts` together when the shared configuration
  store/selector/command owner becomes runtime truth; this planning milestone
  does not pre-advertise an unbuilt runtime seam on `/architecture`

#### D46 Roadmap milestone log

##### 2026-08-03 — lightweight Launch Configuration runtime landed

The five-selector launch form retired into a task-first surface with one compact
Launch Configuration ribbon and Start. The shared versioned pool carries exact
configured source/model/effort Agent identities plus a distinct Shell variant;
successful launches alone update Project-local frecency, pins remain
Project-local, structural duplicates collapse, and unavailable saved choices
remain inspectable without substitution. Customize owns the searchable long
tail and friendly naming, All owns complete catalog management, and `⌘K` opens
the same exact choices. Agent Types remain a coming-soon affordance rather than
an implied result of naming.

The three operator paths are literal and documented together: `⌘T`, type,
Enter; `⌘T`, `⌥↑/↓`, type, Enter; and `⌘⌥T`, then type into Shell. Shell never
receives composer task text or Agent identity. A started Agent tab's context
menu and `⌘K` now expose **Clone to…**, creating a distinct Session on an exact
available Agent configuration with bounded `sessionClonePrompt` context,
preserving the original and passing no provider resume identity. The domain,
settings adapter, ribbon, model picker, composer, palette, Clone path, and
focused unit/component coverage landed together; canonical guide, reference,
marketing, architecture, manifest, and roadmap language moved from planned to
runtime truth in the same delivery.

##### 2026-08-03 — lightweight launcher brief confirmed

The operator confirmed the researched brief after rejecting a durable
configuration-Draft concept as needless weight. Canon, implementation, visual,
accessibility, and current-product audits converged on the slices above: preserve
the instant task-first path; repurpose the existing Option-arrow source cycling
to cycle whole configurations; count successful launches only; keep pins and
customization secondary; and describe prompt-only cross-source continuation as
Clone while preserving the original Session. No application code or production
guide copy landed in this planning milestone. Current-state guides remain
truthful until the implementation ships, when the synchronized documentation
gate above becomes mandatory.

### D47 Project-scoped relaunch

Status: landed 2026-08-03 (operator request), decision `0032`.

D36 removed Project recovery because Agent, Project, and workspace actions were
three competing verbs. That removed a real operating boundary: after a relaunch,
the operator may want one Project's Agents running while unrelated Projects stay
paused.

The recovery bar now uses one split control instead of three buttons. Its main
action is **Resume project**, named accessibly with the selected Project and
eligible-Agent count. The attached scope menu contains only distinct alternates:
**This agent** when the selected Agent is resumable, and **All projects** when
other Projects contain resumable Agents. After a Project resumes, the bar stays
present for other paused Projects and falls back to **Resume all** until another
paused Project is selected. Reconnection remains separate and shells never join
a batch.

The presentation adheres to the ENG-036 kernel: chrome-label status copy,
chrome-meta/menu and chrome-micro/count rungs, standard `h-8`-family small
buttons tightened to the shipped recovery bar's `h-7`, semantic action/chrome
colors, 4px chrome radii, and the existing shared overlay material. No new type,
color, status, spacing, or material recipe was introduced.

Acceptance:

- one click resumes only eligible Agents in the selected Project
- the Agent / Project / all-Projects scopes share one keyboard-complete control
- other Projects stay paused after Project recovery
- exact provider identity, sequential batches, shell exclusion, reconnection,
  progress, failure, and dismissal behavior remain intact
- focused component tests, type-check/lint, the exact-resume Electron evaluator,
  and signed-browser visual inspection cover the interaction

### 2026-08-03 — D27.1: Visible app-history controls (landed)

The Electron title bar now exposes quiet Back and Forward buttons beside the
brand. They are controls over D27's app-location history—not browser history—so
route changes, active Agent/tab changes, and other recorded app locations stay
one coherent stack. The history module publishes capability changes; both the
buttons and the existing ⌘[/⌘] actions call the same command-navigation owner,
and the buttons disable when their direction has no destination.

The pure history tests cover subscriber and capability transitions. The
Electron navigation-spine evaluator proves pointer Back/Forward and keyboard
⌘[/⌘] traverse the same Workspace ↔ Settings history and captures the title
bar at the real desktop viewport.

## Storage size classes (BUG-031, BUG-033) — 2026-08-16

**Two persisted records had no size class.** Both were found by measuring the
operator's real `~/Library/Application Support/Exawatt`, and both are the same
shape: a small-object store given an unbounded field on an all-or-nothing
write path, with no owner for removal.

### BUG-031 — the layout carried its goal images

`workspace.json` was **4,836,360 bytes, of which 4,811,597 was nineteen
`goalVisual.dataUrl` strings** — `data:image/jpeg;base64,…` at ~265 KB each.
The per-visual cap is 2 MB, so twenty tabs could legitimately reach 40 MB.

The layout is a small-object record: ids, titles, cwds, lifecycle, and the
draft the operator is typing. Every field on it rides one write. `setTask` runs
per keystroke → `updateDraft` → `setProjects`, which changes the `projects`
identity and re-arms the 400 ms save; the same save runs on every
`activeTabId` change, every `pty:exit`, and every `pty:identity`. Each one
moved the whole 4.84 MB four times: renderer `JSON.stringify`, structured
clone across `workspace:save`, an atomic disk write, then
`broadcast('workspace:changed', state)` cloning it all the way BACK to the
renderer, where the consumption store schedules a refetch and the fleet
provider refreshes its transport. A 265 KB image sat on the same write path as
a one-character draft edit.

**`identityKey` was already a content address.** It is the hosted provider's
id for the image generated from (project key, accepted context label), so two
Sessions pursuing the same goal share one. It was simply never used as one.

- `electron/main/content-store.ts` — a content-addressed side store for large
  per-Session artifacts. There is no unbounded constructor: `maxEntries` and
  `maxBytes` are required, `sweep(referenced)` is the eviction owner, and it
  runs where content is written.
- `electron/main/goal-visual-store.ts` — goal visuals as its first tenant.
  Bound: 64 entries / 48 MB. The **workspace save path** owns eviction, because
  it is the only place that knows the complete referenced set; a 10-minute
  grace window keeps a visual generated between two saves.
- The layout persists `{identityKey, revision, state}`. Main resolves it back
  through `pty:restore-goal-visual`, because only main owns the store — a
  reference whose pixels are gone degrades to `fallback` rather than claiming
  `ready` with no image, which `validGoalVisual` would refuse outright and
  would silently drop the Session's identity.

**Migration runs in main, on load, once.** Not in the renderer: the renderer
would have to receive the 4.84 MB the change exists to avoid, and a layout
written by an older build must shrink even if the composer is never opened
again. Each visual is written under its identity key BEFORE the field is
dropped, and a write that fails leaves the inline copy in place — a migration
that loses his visuals would be worse than the bug.

**The migration runs inside the store's serialized chain, not around it.**
Found by fuzzing the write path rather than by reasoning about it. The first
implementation read the layout, awaited ~234 ms of content-store writes at his
scale, and then saved — so any `workspace:save` that arrived during that window
was silently clobbered by the older document the migration was holding. The
store now takes the migration as a callback and runs read → migrate → rewrite
inside the same chain `save` queues on, so nothing can observe or replace the
file in between. Two regressions hold it: a save issued mid-migration must win
outright, and a randomized storm of forty interleaved loads and saves must
leave one complete document, no temporary files, and every visual resolvable.
Both fail on the read-then-save shape.

**Measured on his own `workspace.json`:**

| | before | after |
| --- | --- | --- |
| layout bytes | 4,836,360 | 26,872 (180x) |
| `JSON.stringify` per save | 37.7–109.2 ms | 0.06 ms |
| structured clone per save | 1.9–18.8 ms | 0.05 ms |
| migration | — | 19 visuals, 4,809,241 B, 234 ms, once |

**On the `workspace:changed` echo.** The broadcast is not gratuitous: the
fleet provider reads the Project catalog out of the payload
(`extractLocalWorkspaceProjects(layout)`). With the layout back to 26,872
bytes the echo costs 0.05 ms, so a delta or version stamp would be a mechanism
for a cost that no longer exists.

### BUG-033 — the model-catalog cache never evicted a directory

`agent-model-catalogs.json` is **836,471 bytes across 21 rows**, keyed by
`(harness, shell, resolved cwd)`. `read()` refused a row past
`CATALOG_MAX_AGE_MS` and **left it on disk**; `write()` re-serialized the whole
file on every catalog refresh; `clear()` had zero callers anywhere. Staleness
was treated as a display question and was never a storage question, so nothing
owned removal.

`AGENTS.md` mandates a fresh sibling worktree per agent task. Every new
worktree is a new `cwd`, so opening the composer there mints a permanent row
per engine — opencode's is ~126 KB for 446 models — and `agent:land` deletes
the worktree while the rows stay forever. The one signal that says a row is
dead was never consulted.

The bound is stated and enforced at the write: an aged row is deleted rather
than refused, a row whose `cwd` no longer exists is deleted, and the remainder
is trimmed to the newest `CATALOG_MAX_ENTRIES` (48). The same sweep runs once
on load, so an install reclaims without waiting for a probe. Rows now carry an
explicit `cwd` (schema v2) so eviction can ask the filesystem without knowing
the key's grammar; v1 rows are migrated by parsing the key rather than thrown
away. `clear()` is deleted.

**Measured over 120 agent-worktree cycles across three engines, using the
operator's real catalog payloads:**

| | rows | bytes |
| --- | --- | --- |
| before (insert-only) | 360 | 16,189,021 |
| after | 1 | 3,664 |

His file today reclaims nothing — all 21 directories exist and all 21 rows are
fresh — and grows by 1,158 bytes (0.1%) for the explicit `cwd`. The defect was
never that today's file is large; it is that nothing ever removes a row, and
his own workflow mints them.

## Roadmap milestone log (moved from roadmap.md, 2026-07-24)

On 2026-07-24 `docs/engineering/roadmap.md` was compressed to its contract —
status, concise scope, exit criteria, a one-line milestone list, and links —
so the top-level sequence is readable in one screen. The milestone narratives
and status history that lived in the roadmap until that date are preserved
verbatim below, exactly as written, including their dates. The roadmap remains
canonical for sequence and status; this log is the durable execution detail it
points to. Nothing here is new material: it is the ENG-016 roadmap entry as it
stood on 2026-07-24.

<!-- Verbatim: docs/engineering/roadmap.md ENG-016 entry, 2026-07-24. Do not reword. -->

### ENG-016 Daily-driver adoption

Status: active-build — D0-D16 landed through 2026-07-12; D17 implementation and its two-distinct-SHA code-identity gate landed on 2026-07-19, and its holistic delivery-transaction hardening landed on 2026-07-20, with the literal Little Snitch allow/deny observation still pending. D18 (dogfood feedback round 2026-07-20: offline authority, shortcut doctrine, attention legibility, context tuning, composer posture, rehydration idempotency, permission attribution) landed 2026-07-20 with operator confirmation pending on the subjective slices. D19 (same-day dogfood follow-ups: the altitude family off the macOS screenshot hot keys onto ⌃⌘digit; open zero-Session Projects become real tab-ring stops) landed 2026-07-20. D20 (keyboard doctrine + arrangeable strip) landed 2026-07-20. D21 (dogfood feedback round 2026-07-21: ordinal legibility, a complete ⌘T keyboard path, durable session goals) landed 2026-07-21. D22 (turn-state legibility: spinning/finished/unstarted session glyphs from a main-truth started bit; fresh tabs go glyph-only) landed 2026-07-21. D23 (close-as-lifecycle: ⌘W parks, second ⌘W archives to a reopenable Recently-closed ledger; the native destroy dialog is retired) landed 2026-07-21. D24 (operator dogfood on D23: ⌘W adopts the Chrome model — one-stroke close with a native confirm for started live agents; ⌘T becomes an instant new-tab page; keycap hints overlay without layout shift; composer image paste; resize-redraw spinner fix) landed 2026-07-21. D25 (non-interrupting development and evaluation launches) landed 2026-07-21. D26 (operator dogfood on the S2 split: the ⌘D pin follows the tab, not the PTY — a pinned pane survives its session's exit showing retained scrollback with the restore bar, and ⌘D on it unpins instead of silently re-pinning; the driven side is whatever would render full-screen without the pin, so switching to an empty Project or a ⌘T draft keeps the split up instead of hiding it; visiting an empty Project no longer unmounts every terminal pane; split layout math extracted pure and unit-tested in split-layout.ts) landed 2026-07-21. D27 (dogfood round: back stack over app locations, in-app close confirm with macOS button semantics + optimistic close, right-click menus, ⌘9 last tab, rail focus feedback, settings esc, draft copy + dropdown branding, attention-count pill removed) landed 2026-07-21. D28 (dogfood feedback round 2026-07-21 evening: terminal ⌘V double-paste killed at the root — handled shortcuts consume their key event and every DOM paste path funnels through the one image-aware write; draft-composer work becomes durable tab state that survives switches and restarts; the goal-subtitle summarizer trades its permanent 3-failure self-disable for exponential backoff with recovery, stops one confused session from starving every other tab's subtitle, and writes persistent JSONL diagnostics) landed 2026-07-21. The self-contained app, exact relaunch, terminal fundamentals, chrome, notifications, signed automatic updates, navigation spine, command-continuum hardening, inert Project opener, Agent-first composer, measured startup acceleration, and cross-altitude Session parity are implemented. D17 removes the recurring network-policy approval friction caused by identity-unstable local dogfood builds without allowing concurrent closeout to mix source revisions or expose a partially replaced app. Signed `v0.1.7` shipped 2026-07-22 (operator-approved dispatch, run 29943514960, 5.2 min, feed advanced) batching D24–D28 into the daily driver — this puts every 2026-07-21 dogfood round into real use and unblocks the still-pending D17 Little Snitch observation on a current identity-stable build. Further adoption evidence continues here; the interaction policies remain explicit hypotheses rather than fixed doctrine.

D29/D30 (switcher turn-state parity and shared status iconography), D31
(source-neutral recent-conversation migration in the new-tab composer), D32
(one button system with the macOS accent), D33 (calm attention plus
turn-state/subtitle truth), D34 (conversation-label/tab-title ownership), D35
(model/effort-visible Agent launch), D36 (deterministic relaunch ownership and
recovery hierarchy), D37 (graceful close-last-Agent Project lifecycle and
Project context-menu close), and D38 (stable Agent turn boundaries) landed
2026-07-22.

D39 (interaction-contract rough-edge closure) is active-build from the
2026-07-22 hands-on UX audit. Its first slice makes `⌘W`, the palette, and the
native menu close an active empty Project instead of silently doing nothing.
The second operator-requested slice adds browser-style `⌘⇧T` recovery from the
existing Recently-closed Session ledger, moves direct shell launch to `⌘⌥T`,
and orders immediate/repeated recovery against pending archive work. The third
slice establishes the primary-chrome legibility floor. The fourth slice makes
Project/Session action menus keyboard-complete, projects one contextual-command
availability model through hints, palette, and native menus, removes the
duplicated no-Project legend, and makes `⌘J` a strict visible-needs-you jump.
The remaining verified scope is pane ownership, honest recovery copy, and
recovery identity.

D31 hardening landed 2026-07-22 after full review: Project recents now query
Codex's indexed thread state (metadata-first fallback), preserve validated
nested/worktree launch directories, enforce one-to-one identity recovery, and
share a bounded main-process cache; saved exact Sessions migrate into the
current draft in one click. The browser is container-responsive, scrolls by
wheel and keyboard without crossing workspace chrome, returns ↑ to the
composer, and exposes full IDs and descriptions accessibly. Automatic hosted
labels redact common credential patterns, are visibly configurable, and are protected by durable
per-user quota; child-process shutdown ownership and local cache writes are
retryable/atomic rather than optimistic.

Scope:

- self-contained installed app: `/Applications/Exawatt.app` packages its own renderer and opens `/workspace`; it never gives the hosted website the privileged local PTY bridge (decision `0008`)
- delivery: signed/notarized CI builds publish to the public Supabase update channel and `electron-updater` applies them after an explicit restart that reports live-session impact. The clean-`master` local command remains a development escape hatch; it builds one committed SHA in an immutable snapshot and installs through a locked, recoverable atomic transaction. It never uses a background LaunchAgent
- stable dogfood identity: the clean-`master` installer must produce or retrieve an app whose verifiable macOS code identity remains stable across source refreshes, pinned to Exawatt's Team and protected by secure timestamp and hardened-runtime checks, so Little Snitch and other identity-based policy tools retain deliberate Exawatt rules without disabling identity checks. Harness-specific Claude Code and Codex policy remains attached to those signed executables; Exawatt never imports, mutates, or broadens a user's firewall rules
- exact relaunch: every tab persists one exact Claude/Codex session ID and resumes only that ID. Four tabs in one Project resume four distinct conversations. `--continue`, `--last`, cwd/recency guesses, and silent auto-revive are forbidden; restored tabs explain whether the process is live, ended/resumable, identity-missing, resumed, or failed
- terminal fundamentals: ⌘F scrollback search, reliable selection/copy ergonomics, ⌘-click on file paths and URLs, paste including images into harness sessions, deep scrollback with solid rendering performance
- chrome and navigation polish to a Slack / Superhuman / Linear bar: untruncated working-directory display, legible context summaries (readable typography, not one truncated monospace line), bury legacy demo surfaces (Lattice, Fleet kanban) out of primary navigation (e.g. avatar dropdown), make the altitude rail plus absolute `⌃⌘1` Terminal / `⌃⌘2` Sessions / `⌃⌘3` Spatial destinations (D19 defaults) obvious enough that the operator never hunts for a return path, and idiomatic keyboard navigation including an Escape-backs-out-of-the-hierarchy model with an explicit terminal-focus vs chrome-focus boundary (Escape belongs to the agent while the terminal owns focus)
- navigation spine and project-first switching (IA/navigation audit, operator-accepted 2026-07-11): one typed navigation manifest drives the palette navigation group, go-chords, header links, and footer suppression so surface lists cannot drift; the altitude rail stays visible on every Electron surface and spine affordances never link into legacy pages (`/fleet`, `/dashboard`, `/board` reachable only via the legacy menu; "Fleet" names exactly one thing); ⌘K always shows Projects — durable registry merged with local recents so a Project with no open tabs stays one keystroke away, an explicit add-project row, and a visible signed-out state instead of a silently empty group; chrome-scoped ⌘[ / ⌘] history back/forward; macOS Go/Session menus with accelerators and ⌘, settings follow
- configurable native macOS notifications, default off, after the adoption blockers unless user evidence pulls them forward
- continuous dogfood evidence while agents keep implementing; Terminal.app fallbacks create work, not a calendar reset or engineering pause
- Project-first startup: a curated chooser opens Projects without spawning;
  starting work uses a compact optional-task composer with a visible,
  automatically remembered Agent Source and a visible Ask first / Auto-review /
  YOLO policy remembered per Project and harness; the source-resolved model
  and model-specific reasoning effort are visible and changeable per new Agent
  without mutating harness config; shell remains a secondary tool

Exit criteria:

- Exawatt launches from Spotlight and is bindable in the operator's app switcher; agent closeout keeps the installed build at clean `master` without an operator pnpm/copy step
- two distinct clean-`master` dogfood builds retain the same signed Exawatt application identity, pass strict nested-code verification, and continue using previously created Little Snitch allow and deny rules without a program-modification or new-identity approval cycle
- the app works offline for local workspace/PTY use and reports its build SHA
- relaunching four same-Project tabs resumes the exact four saved harness IDs and cannot attach an unrelated newer conversation
- scrollback search, copy/⌘-click, and image paste work in daily use
- legacy demo surfaces are out of primary navigation; cwd and context summaries are fully readable
- accumulated operator use establishes Exawatt as the normal daily coding-agent surface; implementation never waits for a fixed consecutive-week gate (closes ENG-002)

Milestones:

- D0 Baseline gates (landed 2026-07-10): lint scope fixed; packaged-app PTY smoke added.
- D1 Self-contained Mac app (landed 2026-07-10): packaged loopback renderer, hardened privilege boundary, current-architecture native dependencies, offline workspace launch.
- D2 Agent-closeout install (landed 2026-07-10): locked/staged/rollback-safe `/Applications` replacement, build SHA, quiet restart notice; no LaunchAgent and no forced restart.
- D3 Exact session identity (landed 2026-07-10): Claude assigned UUIDs, explicit Codex picker fallback, persistence v3, restored-ended UI, and tab/Project/all exact resume without guessing.
- D4 Terminal fundamentals (landed 2026-07-10): responsive deep-history search, deterministic copy/paste/select-all and context menu, validated URL/file opening, private temporary image-path paste, 50,000-line xterm history with bounded replay, and WebGL fallback; packaged 20,000-line interaction evaluator passes.
- D5 Chrome and keyboard polish (landed 2026-07-10): disclosed middle-truncated cwd, readable two-line summaries, legacy views moved out of primary navigation, and a packaged-tested F6/Escape terminal/chrome focus boundary at 800x600 and 1400x900.
- D6 Notifications (landed 2026-07-10): persisted default-off native transport reuses attention truth, stays quiet while focused, closes when attention clears, and clicks through to the exact session.
- D7 Product-grade updates (landed 2026-07-11): packaged `electron-updater`, parsed staged rollout metadata, fail-closed signed/notarized CI, version/progress/failure/live-session UI, and explicit restart are active. Private GitHub Releases retain source-linked artifacts while public Supabase Storage serves anonymous updates. Electron 43 carries the Squirrel.Mac fix required for macOS 26 launchd behavior. Signed/notarized `v0.1.2` → `v0.1.3` passed download, verification, one-live-session warning, install, and automatic relaunch without a LaunchAgent or manual helper activation (decision `0009`).
- D8 Navigation spine and project-first switching (landed 2026-07-11): from the IA/navigation audit — navigation manifest as the single surface source, rail on all Electron surfaces, legacy fully out of spine affordances (palette, chords, Spatial back link), project-first ⌘K (registry + local recents + add-project + auth visibility), chrome-scoped ⌘[/⌘] history, and macOS Go/Session menus (display-only accelerators; ⌘, registered) — verified by the packaged `eval:navigation:spine` check.
- D9 Keyboard authority and palette recents (landed 2026-07-11): second audit wave — workspace verbs (⌘T/⌘N/⌘W/⌘J/⌘O/⌘D/⌘E/⌘B) join the shortcut registry under a display-only `workspace` context so they become rebindable, conflict-checked, and self-documenting (help modal drops its static list; ⌘1–9 and ⌘⇧[/] stay fixed families); ⌘K gains frecency recents on empty input plus surface-contextual verbs; searchable ⌘/ overlay; global chords gated while a modal is open; per-surface window titles; exposé j/k parity; `aria-keyshortcuts` on the rail; the web OAuth callback lands on the same surface as sign-in. Legacy-list keyboarding was considered and dropped: those surfaces are buried, not invested in. Verified by the extended `eval:navigation:spine` (3 consecutive full passes).
- D10 Menu truthfulness and interaction-race fixes (landed 2026-07-11): menu-bar accelerator display follows the registry's effective bindings after a rebind (renderer→main sync; display-only accelerators stay unregistered); the tab strip's rename editor no longer nests interactive elements inside a button (invalid HTML, hydration warning); the exposé toggle derives open-state from the URL at gesture time so rapid ⌘O cannot re-open instead of close. Operator-rejected 2026-07-11 and recorded so it is not rebuilt: peek-before-navigate on exposé tiles/switcher rows ("overkill"); demo/live mode-in-URL deferred to the Demo Scenario Source work.
- D11 Command-continuum hardening (landed 2026-07-11): literal title-bar controls are `no-drag` click islands; modified global commands remain live from focused inputs; Sessions is a nonmodal Mission Control-style overview with deterministic roving keyboard focus and inert obscured chrome; the navigation manifest and shortcut registry drive labels, destinations, displayed keys, palette/help, and ARIA; Spatial filters are URL state while bounded camera return and last-command-surface state restore locally; active altitude clicks focus/recenter; and one target-aware, finite, reduced-motion-safe transition owner now coordinates every Terminal ↔ Spatial entry path without coupling xterm and R3F renderer ownership. Browser/Electron navigation, focused tests, type/lint, and 100/100 R3F evidence landed; the optional native macOS coordinate-click evaluator remains host-blocked until Accessibility permission is granted. Detailed evidence lives in the project doc.
  Follow-up review hardened the overlapping history/tab-ring key families: fixed workspace navigation (`⌘⇧[`/`⌘⇧]`, `⌘1`–`⌘9`) now owns capture phase ahead of xterm and global route history, while unshifted `⌘[`/`⌘]` remain history. Sessions Escape also works from persistent shell chrome, and failed route transitions have a bounded teardown.
- D12 Absolute command-altitude shortcuts (landed 2026-07-12): replaced view toggles with rebindable, idempotent `⌘1` Terminal / `⌘2` Sessions / `⌘3` Spatial destinations across xterm, focused inputs, rail, palette, and native menus. Fixed Project ordinals moved to `⌘⌥1`–`⌘⌥9`; `⌘⇧[` / `⌘⇧]` tab navigation and unshifted history remain intact. Active-destination commands focus Terminal/Sessions or recenter Spatial. Full plan and execution evidence live in the project doc. AMENDED 2026-07-20 by D18: dogfood promoted tab switching to the cheapest chord — `⌘1`–`⌘9` now select Session tabs (browser convention), and the altitude destinations move to `⌘⇧1`/`⌘⇧2`/`⌘⇧3`. AMENDED again same day by D19: `⌘⇧3` is a macOS screenshot hot key the system consumes before apps; the altitude destinations ride `⌃⌘1`/`⌃⌘2`/`⌃⌘3`. Ordinal `⌘⇧[`/`⌘⇧]` and Project `⌘⌥1`–`⌘⌥9` families are unchanged.
- D13 Shortcut binding policy (landed 2026-07-12): classified absolute command-altitude destinations as universal commands; Settings accepts only one `⌘`-modified key for them on macOS, reserves fixed Project/tab families, and explains invalid bindings instead of saving shortcuts that fail under xterm or text focus. Contextual commands and go-chords retain their existing customization rules. Full evidence lives in the project doc. AMENDED 2026-07-20 by D18: the reserved fixed tab family is now `⌘1`–`⌘9`; altitude destinations remain universal commands. AMENDED by D19: their defaults are `⌃⌘digit`, and Settings refuses any `⌘⇧3`–`⌘⇧6` binding (macOS screenshot hot keys that can never reach the app).
- D14 Project opener and Agent-first start (landed 2026-07-12; cross-surface identity correction landed 2026-07-12; launch-permission policy landed 2026-07-18; permission UX hardening landed 2026-07-19): `⌘N`, the native File menu, and the palette converge on a searchable tile chooser backed by the synced registry plus local fallback; Browse remains available and optional one-level parent-folder import requires an explicit reviewed selection. Projects open and persist with zero Sessions, including after their last tab closes, and a shared source-agnostic Project catalog keeps the same zero-child identity visible in Terminal, Sessions, and Spatial before the first Agent joins it. The launch strip becomes a compact composer with an optional first task, visible Claude Code/Codex source, automatic per-Project recommendation with personal-recency fallback, advanced worktree/roadmap options, and shell demoted to a secondary Project tool. A visible Ask first / Auto-review / YOLO selector defaults new Project+harness pairs to YOLO, explains the access consequence, persists changes immediately by pair, blocks stale-policy launch races, and fails closed to Ask first when preferences cannot be read; palette and shortcut source overrides restore the same pair-specific policy. Provider translation remains behind the source boundary, and exact resume uses the current pair preference. A capability-described source registry begins ENG-003's UI boundary without claiming the unified adapter project complete; attach/resume UI for durable remote Agents remains deliberately unresolved. Decisions `0013` and `0015` record the malleable product contract.
- D15 Startup acceleration (landed 2026-07-12): Electron creates its real window with a self-contained command-surface launch frame before renderer extraction, Next server readiness, Session persistence, or heavy command-module loading. Progress maps to actual bootstrap milestones and has reduced-motion and explicit failure states. Cached renderers prestart before `app.ready`; cold extraction yields to the first frame; polling latency is tightened; stale renderer versions are pruned after launch. The packaged evaluator records process connection, first window, first visible frame, and usable workspace for cold and warm runs. On the same warmed executable with isolated user data, blank wait fell from 3.07s to 0.39s (87%); cold usable time stayed near parity at 3.21s. Warm visible feedback is about 0.38s and usable workspace about 1.19s.
- D16 Session/Spatial parity (landed 2026-07-12): fixed tab-ring shortcuts (`⌘⇧[` / `⌘⇧]`) now keep the Sessions overview's roving selection and focus synchronized with the active tab. The local fleet source merges live PTYs with persisted open workspace tabs, so stopped Sessions remain Session-backed Agents instead of disappearing from Spatial; they render as dotted outlines, remain selectable, and hand off to the exact stopped tab and its explicit restore surface. Live PTYs still own runtime activity, while persisted tabs supply only durable identity and honest stopped lifecycle state. Rehydration also reconstructs an unknown exited PTY as a stopped durable tab instead of dropping it when renderer persistence lags process exit.
- D17 Stable dogfood signing identity (active-build — implementation and automated two-SHA identity gate landed 2026-07-19; immutable/serialized/atomic delivery hardening landed 2026-07-20; operator firewall observation pending): identity-null/ad-hoc agent-closeout installs are replaced by a stable, verifiable Exawatt code identity while the installer remains atomic, non-restarting, and development-only. The main app, nested helpers, and native code are signed consistently with the pinned Exawatt Team, secure timestamps, and hardened runtime. Delivery builds a detached snapshot of one committed SHA, coordinates landing and installation across concurrent worktrees/clones, atomically exchanges the app while retaining rollback state, and recovers interruption deterministically. Unavailable or inconsistent identity fails without replacing the prior app; credentials stay outside the repository; and two distinct clean-`master` SHAs with distinct code hashes preserved one program identifier and Team identity under strict verification. Literal exercise of an existing Little Snitch allow and deny rule without a modification/new-identity alert remains before D17 is landed. Production Developer ID signing/notarization and the public updater remain unchanged (decision `0009`).
- D18 Dogfood feedback round 2026-07-20 (landed 2026-07-20; operator confirmation of subtitle quality, ambient recap feel, and TCC prompt copy remains dogfood evidence): the first sustained real-use round returned eleven findings; this milestone owns them as one coherent pass rather than isolated patches. Landed same day: offline authority (zero-network navigation, error/loading boundaries, `eval:electron:offline`), the ⌘1–9 tab / ⌘⇧1-3 altitude remap with layout-independent digit matching and a pure tested tab ring, activity-truth status glyphs on tabs and Sessions tiles, dock badge behind a default-off setting plus a Settings notifications card and permission explainer, goal-oriented subtitles seeded from the composer task, the ambient inline recap, the summonable composer with the SelectTrigger clamp fix, the N-generation rehydration idempotency eval (`eval:electron:idempotency`, 3 generations green), TCC usage descriptions, and non-primary-display placement for EXAWATT_TEST windows (operator request mid-round).
  - Offline authority: no Electron navigation or render path may block on a network call. The loopback renderer's middleware and root-layout auth reads become non-blocking/offline-tolerant, the app gains real `error`/`global-error`/`loading` boundaries (today an unhandled render error unmounts to a black root), the workspace Suspense fallback becomes visible content instead of a solid near-black div, and an offline-simulated packaged eval proves `⌘` altitude switching works with the network dead. Fixes the flight black-screen bug and makes the existing "works offline" exit criterion enforceable.
  - Shortcut doctrine (amends D12/D13): `⌘1`–`⌘9` select Session tabs; `⌘⇧1`/`⌘⇧2`/`⌘⇧3` are the absolute altitude destinations; `⌘⇧[`/`⌘⇧]` ordinal cycling is fixed (the ring's stale-active recovery could re-land on the same tab forever instead of advancing) and continues to include stopped tabs deliberately — stopped Sessions are real tabs.
  - Attention legibility: running vs waiting-for-input vs stopped reads at a glance on tabs, Sessions tiles, and the switcher from the existing attention + lifecycle truth (no new state machine). The macOS dock badge/bounce moves behind the same default-off notification preference family (it was unconditional), and notification/badge preferences get a visible settings surface.
  - Context layer tuning: micro-context subtitles become short and goal-oriented (the durable multi-turn goal, not the current activity), seeded instantly from the composer's initial task and derived from session head + tail rather than tail only. The S4 recap popup is retired for ambient inline delivery (see ENG-015 S4 amendment).
  - Composer posture: the always-open "What should this Agent do?" strip collapses to a compact summon (expanded on demand), and the Agent Source select's wrap/clip bug (shared SelectTrigger `line-clamp-1` fighting its flex content) is fixed at the component level.
  - Rehydration idempotency (ENG-018 addendum): a repeated-cycle packaged eval (quit → relaunch → resume → quit → …, N generations) proves freeze/reinflate is idempotent — stable durable identities, no tab duplication or lifecycle drift, journal/compaction stability — and fixes whatever it exposes. Existing evals only ever exercised one cycle per path.
  - Permission-prompt attribution: macOS TCC folder-access prompts gain purposeful usage-description copy (Info.plist `extendInfo`), and the D17 stable identity is the durable fix for grants re-prompting across rebuilds; in-app copy explains that agents working under protected folders (Desktop/Documents/Downloads) trigger the OS prompt on Exawatt's behalf.
- D19 Shortcut doctrine follow-ups (landed 2026-07-20, same-day dogfood on D18): two findings from first real use of the D18 remap. (1) The `⌘⇧digit` altitude family collided with macOS screenshots — the system registers `⇧⌘3`/`4`/`5`/`6` as global screenshot hot keys and consumes them before any app receives the keydown, so `⌘⇧3` Spatial could never fire on a real keyboard; every eval stayed green because synthetic keystrokes bypass the system layer. The altitude destinations move to `⌃⌘1`/`⌃⌘2`/`⌃⌘3` (same near→far digit continuum, no system collisions, still ⌘-carrying so they fire from xterm); menus, evals, and `aria-keyshortcuts` follow the registry, and Settings originally refused `⌘⇧3`–`⌘⇧6` as a hardcoded list; AMENDED 2026-07-21 (operator: system shortcuts are user-configurable, don't hardcode them) — Settings now consults the machine's EFFECTIVE macOS hotkey table (`com.apple.symbolichotkeys.plist` merged over Apple defaults, read by Electron main, pure/unit-tested mapping in `system-shortcuts.ts`): a combo the system verifiably owns is refused with the owning feature named and a System Settings pointer; a combo the user disabled or rebound in System Settings is bindable; the web build (no plist access) warns without blocking. Third-party apps' global hotkeys remain undetectable without private APIs and stay out of scope. (2) `⌘⇧[`/`⌘⇧]` skipped open zero-Session Projects, which read as "is this Project even open?" — every visible section is now a ring stop: cycling lands on an empty Project's composer state, while `⌘1`–`⌘9` ordinals still number real tabs only so an opened empty Project cannot shift every tab's digit.
- D20 Keyboard doctrine + arrangeable strip (landed 2026-07-20): two accepted UX suggestions from the D18 review. (1) ⌘T inverts to match D14's stated hierarchy — the primary launch chord summons the AGENT composer; shell (the demoted secondary tool) moves to ⌘⇧T; menus, palette, hints, and the accelerator sync follow. AMENDED 2026-07-23 by D39: `⌘⇧T` now restores the newest recoverable Session by browser convention, while direct shell launch moves to `⌘⌥T`; both remain registry-backed and rebindable. (2) The strip becomes arrangeable: with ⌘1–9 and ⌘⌥1–9 as ordinals, ORDER is an interface — tabs reorder within their Project and Projects reorder globally, by drag and by fixed keyboard family (⌘⌥[/⌘⌥] moves the active tab, ⌘⌥⇧[/⌘⌥⇧] moves the active Project), persisted with the layout and pushed best-effort to the registry's sort_order so ordering syncs.
- D21 Dogfood feedback round 2026-07-21 (landed 2026-07-21; operator confirmation of goal-subtitle quality remains dogfood evidence): three findings from continued real use, owned as one coherent pass. (1) Ordinal legibility — the strip read as a digit soup ("1 1 1 2 3 4 3 4 5"): Project ordinals (⌘⌥1–9), global tab ordinals (⌘1–9), and the amber per-Project attention count all rendered as identically styled bare digits. Ordinals are shortcut hints, not identity: they now appear as keycap chips only while their chord's modifiers are held (hold ⌘ reveals tab digits, ⌘⌥ reveals Project digits, with a short hold delay so fast chords never flash), the strip rests clean, and the attention count becomes a visually distinct amber pill. The D18/D20 ordinal doctrine itself is unchanged. (2) Complete ⌘T keyboard path — the summoned composer reliably focuses the goal field (the old single-rAF focus raced the compact panel's conditionally-mounted textarea), so ⌘T→⏎ starts the recommended source, ⌘T→type→⏎ starts with a goal, and ↑/↓ while the goal field is empty cycles the Agent Source; an inline hint line teaches the grammar. (3) Durable session goals (tactical ENG-021 slice) — the goal subtitle becomes a property of the durable Session, not the PTY incarnation: summaries key by durableSessionId, persist with the layout, restore on relaunch, and stopped tabs keep showing their goal; the composer task persists per tab and re-anchors the summarizer on resume as metadata-only stated task (never re-sent to the process); the summarizer captures a durable session head (the bounded scrollback would otherwise scroll the goal out of reach) and holds an established goal by contract — each sweep shows the model the current goal and accepts KEEP unless the objective genuinely pivoted — instead of overwriting it with the latest micro-task.
- D22 Turn-state legibility (landed 2026-07-21; amends the D18 attention-legibility slice; operator dogfood on 0.1.5): running vs finished vs unstarted still did not read at a glance — the D18 glyphs separated working (6px pulsing dot) from quiet (hollow dot) too subtly for peripheral vision, and "quiet" conflated two opposite situations: an agent that finished its turn (result waiting) and an agent never given work. Three states now read distinctly: (1) working is MOTION — a rotating teal arc replaces the pulse (reduced motion keeps the static arc, still shape-distinct); (2) a session that has started and gone quiet rests as a solid green dot — turn finished, ball in the operator's court; the amber attention ping still outranks it while a turn-end/bell is unseen, so amber → glance → green is the natural progression; (3) a live session never given work shows a dim hollow ring, and its tab drops the default harness title ("Claude Code" / "Codex") entirely — the glyph already carries source identity, so a fresh tab stays glyph-only until a rename or the first goal subtitle fills it (operator: nothing to summarize means no text). Startedness is main truth on the attention monitor — set by a composer task or exact resume at create, the first human keystroke (the existing `pty:engage` guaranteed-human channel), or any raised attention — seeded through list/adopt and broadcast once as `pty:engaged`, so renderer reloads cannot regress a started session to fresh; a goal subtitle also implies started in the renderer. The Sessions overview tiles read the same three states from the shared glyph module (`status-glyphs.tsx`).

- D23 Close as a lifecycle, not a destructor (landed 2026-07-21; operator design pass same day — ⌘W productization; AMENDED same day by D24: the operator rejected park-first ⌘W after first use — ⌘W means CLOSE, like Chrome; the ledger, condensed stopped chips, and reopen verb remain, the two-step grammar and in-app confirm do not): ⌘W and the tab × were the app's only one-stroke data destroyer — kill the process, delete retained scrollback from disk, drop the tab (title, goal, position, roadmap link), guarded by a native macOS dialog that interrogated the wrong cases: a fresh unstarted agent got the full warning while closing an already-stopped tab destroyed its history with no confirmation at all. The redesign makes ⌘W move a Session DOWN its lifecycle instead of off a cliff, using machinery that already existed for app-quit: (1) ⌘W on a live tab PARKS it — stop the process group and flush (never delete) retained history, the single-session form of `stopAll()`; the tab remains as a stopped, badge-carrying, one-key-resumable tab, so no dialog is needed because nothing is lost. (2) Only a mid-turn agent prompts — an in-app HUD confirm (⏎ stop / esc keep going) gated on the D22 working truth; fresh, finished, and idle agents park silently, and the native dialog plus its `EXAWATT_TEST_CLOSE_RESPONSE` escape hatch are deleted. (3) ⌘W on a stopped tab CLOSES it to a Recently-closed ledger — tab identity (title, goal, provider conversation id, project, stated task) plus retained history survive for 14 days and a palette verb reopens the whole tab in place; a quiet auto-fading toast states exactly what happened and where it went (operator: make the resultant UI clear). The ledger reaps expired entries (and only then deletes history) at startup and on a slow interval. (4) Stopped tabs condense to a frozen chip (glyph + lifecycle badge) that animated-unfurls on hover or keyboard focus (operator: light collapse, never auto-close) — the strip stays tidy manually, with no invisible hand. Evals that drove the native dialog re-target the two-step grammar.

- D24 Chrome-model close + instant new tab (landed 2026-07-21; same-day operator dogfood on D23): first contact with the park-first grammar returned a decisive correction plus five adjacent findings, owned as one pass. (1) ⌘W CLOSES the tab, exactly like Chrome — never "pause tab" or "clear tab": one stroke stops the agent and moves identity + goal + history to Recently closed. A NATIVE confirm interstitial guards every started live agent (idle sessions hold context too, working ones a turn in flight — copy differs); unstarted tabs and already-stopped tabs close instantly (⌘T ⌘W is a friction-free no-op), and the D23 ledger stays as the safety net the confirm can honestly cite. The D23 in-app confirm is deleted. (2) ⌘T pops a REAL tab, instantly — the floating summoned composer is replaced by a new-tab page: the draft tab appears in the strip at once, its pane is the task box with the harness/permission menu (launch contract intact: seeded goal, per-pair policy, worktree options), ⏎ spawns in place, ⌘W discards. The empty-Project pane and the draft pane are the same surface. Operator: the new-tab sequence and UI are expected to keep improving — direction captured, deliberately unshaped pending its own design pass. (3) Keycap ordinal hints (D21) reveal faster (~120ms, 350ms read as lag) and OVERLAY the chrome — absolutely positioned over the tab corner so revealing them never shifts layout. (4) The task box accepts image paste — ⌘V and ⌃V (the muscle memory the coding harnesses train) both save the clipboard image and insert its path into the task, and the hint line teaches it. (5) Clicking an idle tab no longer spins its glyph: pane attach resizes the PTY, the CLI redraws on WINCH, and the D22 activity truth read that self-inflicted burst as work — a resize grace window in the attention monitor now filters redraw output from the working signal. (6) The composer permission Select's dead arrow/typeahead keyboard (found while retargeting the launcher eval) is gone with the floating panel it lived in — reproduced only under the retired summoned-panel composer, works under the pane composer, and the launcher eval now asserts strict ArrowUp/⏎ selection so it can never silently regress. Operator doctrine, now standing: every surface ships best-in-class keyboard support. (7) Two same-day strip refinements: the working glyph calms from a rotating arc to a softly breathing orb (the spin read as annoying), and the New Agent / notification controls pin to the strip's first row instead of dropping below a wrapped strip (dead whitespace).
- D25 Non-interrupting development and evaluation launches (landed 2026-07-21; operator request): real-app driving remains the verification authority without competing for the operator's keyboard. `EXAWATT_TEST=1` creates a fully hidden, unthrottled BrowserWindow and uses macOS accessory activation so automated Electron launches stay out of the Dock, app switcher, and foreground while Playwright retains full DOM, screenshot, PTY, and WebGL control. `electron:dev` defaults to a visible `showInactive()` window under the same non-activating policy; a deliberate operator click promotes that process to the normal Dock/menu-bar policy. `EXAWATT_WINDOW_MODE=inactive|foreground|hidden` is the explicit development/test override, while production ignores the override and always launches normally. The native coordinate-click evaluator is the documented exception and requires `--allow-focus`; packaged smoke asserts hidden, unfocused, Dock-invisible test state before exercising the normal renderer/preload/PTY path.
- D27 Dogfood round 2026-07-21 evening (landed 2026-07-21; source-trigger ownership correction landed 2026-07-22; ten findings on the D24 build, owned as one pass): (1) The ⌘T chip says "New agent", not "New tab" — the tab is the agent. (2) The amber per-Project attention COUNT pill (D21) is deleted — as a user signal it read as noise ("shows (2) then disappears"): the count changed whenever a flag cleared on glance, which is truthful mechanics but illegible UX; the amber attention dot on tabs and ⌘J remain the attention surface (AMENDS D21). (3) ⌘9 selects the LAST tab, like Chrome; ⌘1–8 stay positional, and with more than nine tabs the last tab wears the 9 keycap. (4) The back stack becomes an APP-LOCATION history, not bare router history: a pure nav-history module records every location — Terminal, Sessions, Spatial, Settings, and the ACTIVE TAB within the workspace — and ⌘[/⌘] walk it across zoom levels, tab switches, and routes; Sessions open/close (a router.replace) and tab selections, which browser history never saw, are first-class stops. Applying a location never re-records (visits dedupe against the current entry). Roadmap focus stays on the esc ladder, deliberately outside the stack. (5) Settings dismisses with esc (back through the stack). (6) Project chips and tabs get a right-click menu — HUD-styled, keyboard-navigable (↑↓/⏎/esc): rename, color, pin/unpin split, resume, reveal in Finder, new agent, close/discard — every item an existing verb. (7) The Sessions roadmap rail shows its FOCUS: a focus-within accent ring + an "esc · back to tiles" hint line, so the drill → rail-blur → overview esc ladder gives feedback at every rung (the middle rung was invisible). (8) The ⌘W confirm returns in-app (AMENDS D24's native dialog — operator saw it and preferred our chrome): HUD-styled modal with a default-highlighted Close button and macOS selection semantics — tab moves focus, space presses the focused button, ⏎ presses the default, esc cancels — and copy that names the consequence and the recovery path (Recently closed, 14 days, ⌘K). (9) Closing is now OPTIMISTIC: the tab leaves the strip in one transition and the stop/archive runs behind it — the close-time jerk through stopped/restore states is gone. (10) The composer's source dropdown items carry the harness brand — glyph + brand color in the options, so the menu matches the trigger instead of flashing white-to-branded. Trigger and option decoration have separate owners: the trigger renders exactly one glyph plus an explicit text value, rather than allowing the Select primitive to project the decorated option and duplicate its glyph.
- D28 Paste, draft durability, summarizer resilience (landed 2026-07-21; dogfood 2026-07-21 late evening): three defects from continued real use, each fixed at its root rather than patched at the symptom. (1) Terminal paste doubled — ⌘V in a pane wrote the clipboard to the PTY twice. Root cause: the pane's custom key handler called the image-aware `pasteClipboard` but never CONSUMED the key event, and on macOS an unconsumed key equivalent is re-dispatched to the application menu, so the Edit ▸ Paste role (registered ⌘V accelerator) pasted a second copy through xterm's DOM paste path. Handled pane shortcuts (⌘F/⌘C/⌘V/⌘A) now `preventDefault`, and a capture-phase paste listener funnels EVERY DOM paste (Edit ▸ Paste menu click included) through the single image-aware main-process write — paste is one verb with one implementation, so the menu item now also pastes images as temp-file paths exactly like ⌘V. (2) Draft work evaporated — text typed into the ⌘T new-tab composer vanished on any tab switch because the draft lived in component-local state and the hidden pane unmounts. The draft's work-in-progress now belongs to the draft TAB: the typed task and chosen source ride on the tab in workspace state (`draftTask`/`draftSource`, one `updateDraft` verb), survive tab and Project switches, and a draft WITH content persists with the layout and restores after relaunch. This deliberately amends D24's "drafts are never persisted": an empty ⌘T tile still vanishes without ceremony and ⌘W still discards instantly — only real typed work earns durability, matching how the composer is actually used (long task briefs written across interruptions). (3) Goal subtitles silently stopped — a tab ran ten minutes with no subtitle while the engine (`claude -p --model haiku`) worked fine when probed. Two structural causes: the summarizer permanently self-disabled after 3 consecutive engine failures (one sleep/offline blip while the app ran killed subtitles until the next app restart, invisibly), and a failed or shape-rejected attempt refunded its byte budget to the SAME session, so one confused session won every sweep forever and starved every other tab. Failures now back off exponentially (30s doubling to a 10-minute ceiling) and recover on the next success; a failed/unusable attempt puts that session on a 5-minute cooldown so the sweep moves on to the runner-up; and the summarizer records attempts, failures, pauses, and accepted subtitles to a rotating JSONL diagnostics log under `userData/logs/` (new shared `diagnostics-log.ts` primitive) so the next silent-subtitle report is a file read, not archaeology.
- D29 ⌘K switcher turn-state parity (landed 2026-07-22): `pty:list` now carries the attention monitor's resize-aware `working` truth, and renderer adoption seeds that truth without racing a newer quiet event. D30 (status iconography: learnable icon set per Carbon/Linear, bell for attention, project diamonds become identity bars) landed 2026-07-22. A render-free shared Session status model drives the strip, Sessions tiles, and ⌘K; switcher rows distinguish working / turn finished / new / quiet, preserve attention precedence, and render the same glyph + copy vocabulary. The old 15-second output heuristic is gone; only an explicit 3-second compatibility fallback remains for legacy mocks. The chrome-layout evaluator asserts the three fixture states in an empty-query palette, captures them, and proves an already-working session stays working across renderer reload.
- D31 Recent-conversation migration (landed 2026-07-22; operator design request; two same-day dogfood corrections): the ⌘T new-tab page keeps a focused new-task composer as the default and adds a secondary, immediately visible browser scoped solely to the active Project. A source-neutral main-process catalog reconciles Exawatt's Recently-closed Project Sessions with Claude Code and Codex history through replaceable adapters: exact provider identity deduplicates records, older identity-less Exawatt records reconcile only to one unambiguous same-harness initial-task match, Exawatt semantic goals improve local labels, Project-owned rows reopen their logical Session and retained history, provider-only rows resume the selected exact identity, and ambiguous records remain separately recoverable. Nested working directories and live git worktrees inherit canonical Project ownership. Plain ↓ enters the list; ↑/↓ rove through every Project result, ↑ from the first row returns to the task, Home/End jump, ⏎ continues, and esc returns to the task; Option+↑/↓ owns source cycling. One shared composer viewport owns bounded vertical overflow for both draft and empty-Project surfaces, so wheel/trackpad and keyboard traversal scroll inside the pane without painting over fixed workspace chrome; long lists expose a filter without a four-row “View all” gate. Every row also exposes **Fresh**, which creates a new Agent from the bounded handoff rather than attaching to the old conversation. Missing native labels are enriched automatically through an authenticated Exawatt endpoint using bounded operator excerpts and Haiku; the Anthropic credential stays server-only, results cache machine-locally, and local fallback remains authoritative offline. Decision `0017` records the data and adapter boundary.
- D30 Status iconography and identity de-lamping (landed 2026-07-22; operator UX research round — "as a user I can't tell the difference and don't know what each does"): three iterations of colored dots (D18 pulse, D22 shapes, D24 orb) all failed the same canonical rule — Carbon's status-indicator pattern requires at least three of shape/icon/color/text, and hue was carrying our whole signal at 6–10px in the teal-vs-green range, camouflaged among three OTHER small colored identity marks per row. The fix adopts the Linear/GitHub-checks model the operator chose (learnable icon vocabulary, gentler attention mark): a fixed-slot icon set in the shared glyph module — working = teal half-fill pie with a soft breathing pulse, needs-you = amber BELL with the ping halo (the attention monitor's own vocabulary; the operator rejected an alarm triangle), finished = green circled check, unstarted = dashed hollow circle, shell-quiet = plain hollow circle — with unchanged data-status vocabulary so every D22/D29 consumer (strip, Sessions tiles, ⌘K rows) inherits by construction, plus an agent-status legend in the ⌘/ cheat sheet (text channel, per Carbon). The project diamond — a third copy of identity masquerading as a status lamp — becomes a thin vertical color bar on the group chip, Sessions tiles, and rail header (operator choice), leaving status icons as the only lamp-like marks in the strip.
- D32 One button system, system-accent default (landed 2026-07-22; operator dogfood on the D27 close confirm): the confirm's default button wore the PROJECT color — the most important button in any dialog looked different in every project — and push-buttons across the app were ad-hoc styles. Now the DEFAULT action color app-wide is the operator's macOS highlight color (`systemPreferences.getAccentColor` → the shadcn `--primary` family on :root, refreshed on window focus; HUD cyan is the web/off-macOS fallback), and buttons converge on the one shadcn recipe: default = accent-filled for primary actions (close-confirm Close, composer Start — which loses its harness tint), outline = neutral (Cancel, New Agent, Open Project, Resume N Agents), ghost = icon buttons. Project color remains identity-only; the system accent is the action color, native to the machine.

- D33 Calm attention and turn-state/subtitle truth (landed 2026-07-22; immediate operator dogfood on D30): the pulsing bell did not scale — dozens of waiting Sessions would become an ambient wall of alarms — and switching one Session exposed bell → working → finished flashes. D33 amends D30's attention visual to a static amber dot-in-circle: noticeable but never animated or glowing, with the same explicit hover tooltip on every strip, Sessions, and ⌘K status glyph; the ⌘/ legend calls it “unseen.” The visual calm is backed by state-order fixes: selecting a focused tab acknowledges local attention in a layout effect before paint; the resize monitor installs its WINCH guard before `node-pty.resize()` can synchronously emit; and a real BEL is an explicit turn boundary that clears working and consumes the finished burst, so acknowledging it cannot reveal or re-raise stale working state. Goal subtitles now enforce the prompt's actual six-word contract, reject model preambles and first-person narration anywhere in the result with a diagnostic reason, and refuse persisted model preambles so they cannot become a durable `KEEP` anchor. Focused tests cover resize/BEL ordering and the exact bad Workmusic phrase; the chrome evaluator proves the calm marker, tooltip, and zero stale-attention paint on selection.
- D35 Model/effort-visible Agent launch (landed 2026-07-22; operator request plus immediate effort follow-up): choosing Codex or Claude Code no longer hides the capability pair. Compact Model and Effort selectors beside Agent Source resolve the installed Codex catalog, each model's supported/default reasoning levels, configured model/effort pair, and Claude Code's layered model/effort settings and account-default aliases. Defaults are marked in place; changing models reconciles effort to the new model, while an environment-owned Claude effort is visible but locked because it outranks session flags. Both displayed choices cross the typed launch/IPC boundary through Claude Code's `--model` / `--effort` flags or Codex's `--model` / `model_reasoning_effort` config override with safe shell quoting; neither rewrites harness configuration. Draft tabs retain the pair across Project/tab switches and restarts when the draft task qualifies for persistence. Discovery failure degrades honestly to harness/model defaults rather than blocking local launch or inventing exact values. Focused catalog/parser, command-builder, composer, persistence, type, and Electron compilation checks cover the contract; the Project-launch evaluator asserts pair visibility, model-dependent defaults, both override transports, and narrow-window containment.

- D34 Conversation-label/tab-title ownership (landed 2026-07-22; immediate operator dogfood on D31/D33): a resumed Codex conversation promoted the catalog's deterministic fallback — a truncated opening prompt, “I'm going to give you a call transcript…” — into persistent tab chrome above the correct six-word goal. Browser labels and tab names are now separate concepts: Resume/Fresh carry the semantic handoff but start with normal Agent Source identity, while only an explicit operator rename earns a visible primary title. Raw/native handoffs remain summarizer input rather than impersonating restored output; only a validated generated six-word label may seed an immediate subtitle. Workspace persistence v6 records title ownership and performs a narrow one-time repair of the bounded D31 leak, including old Recently-closed entries, without treating ordinary short renames as generated text. The hosted conversation-label boundary, Electron cache boundary, and provider-metadata normalization now enforce the promised six-word title / 18-word handoff limits and reject first-person or model-preamble narration; invalid cached copy and narrated provider previews fall back to the durable operator goal. Focused launch, persistence, tab-render, API, and catalog tests cover the reported E&M and Workmusic cases and preserve domain phrases such as “based on AMA guidelines.”

- D36 Deterministic relaunch ownership and recovery hierarchy (landed 2026-07-22; operator quit/relaunch dogfood): composer-launched Codex Sessions could preserve a convincing terminal history without a provider identity because capture began only on a later terminal write; a task passed as a CLI argument bypassed it, and the idempotency evaluator hid the gap by typing into every empty fixture before quit. Provider identity now belongs durably to Electron main: Codex takes a provider-catalog baseline before spawn, captures at launch even with an initial task, and every discovered/allocated identity is atomically indexed by durable Session ID independently of renderer debounce. Startup merges that index first, then conservatively repairs older identity-less Sessions only through a unique one-to-one same-harness opening-task match; ambiguity is never resolved by recency. Recovery UI now has two scopes instead of three competing verbs: one workspace action named by count (**Resume N Agents**) and one per-pane action (**Resume This Agent**); the redundant Project action is removed, stopped history is visibly read-only, and identity loss is an explicit **Reconnect needed** state with richer candidates. The repeated-cycle Electron evaluator now launches Codex with a composer task and requires identity before any later PTY write, covering the escaped production path.

- D37 Graceful empty-Project close (landed 2026-07-22; operator dogfood, amends D14): closing the last Agent no longer leaves its Project in the open strip forever. The existing empty composer remains visible for a three-second acknowledgment, then the active stage and Project chip retract from right to left in a 240ms transform/opacity exit before the group leaves the workspace. Reduced-motion preference skips the exit duration, opening a zero-Agent Project remains stable, and starting another Agent during the grace/exit cancels it. Durable registry and recent identity remain intact, so `⌘N` reopens rather than recreates the Project. The Project-chip context menu now ends with **Close project**; empty groups use the same exit immediately, while populated groups get one in-app batch confirmation before their tabs flow through the existing stop/archive ledger. Focused lifecycle/menu/confirm tests and the Project-launch Electron evaluator cover linger, cancellation, close, reopen, preference survival, and manual close.

- D38 Stable Agent turn boundaries (landed 2026-07-22; fourth operator report on the working/check oscillation): the teal working half-circle and green finished check no longer alternate because an idle Claude Code or Codex TUI emitted bytes after completion. D24 filtered resize redraws, D29 aligned renderer adoption, and D33 fixed BEL/acknowledgement ordering, but all three retained the structural bug: any later PTY output reopened working. Electron main now latches an Agent turn when it crosses the existing quiet or BEL boundary; provider redraws, title updates, and terminal protocol replies remain visible in the terminal but cannot mutate finished back to working. The guaranteed-human engagement channel alone opens the next turn. Shells deliberately remain output-driven. Decision 0018 records the stability-versus-autonomous-resumption tradeoff; monitor tests and the real Electron launcher evaluator inject a post-finish PTY repaint and require the check plus `working: false` to remain stable.

- D39 Interaction-contract rough-edge closure (active-build 2026-07-22; operator reports plus hands-on app audit): the first landed slice fixes the direct report — `⌘W` now closes the active tab when present and the active empty Project otherwise, including during the close-last-Agent grace state. The second slice pairs that close grammar with browser-style `⌘⇧T` recovery from the durable Recently-closed ledger, serializes repeated/immediate restore, and moves shell launch to `⌘⌥T`. The third slice establishes a semantic primary-chrome type scale. The fourth slice ties commands to visible targets: `⌘J` no longer jumps to Sessions without a visible needs-you Session; Project/Session menus open from right-click, `Shift+F10`, or the Context Menu key with focus return; one availability snapshot controls passive hints, disabled-with-reason palette rows, native Session-menu enablement, and the single no-Project shortcut legend. Decision `0020` records that contract. Remaining findings are pane ownership and recovery clarity/identity; this milestone is not a visual redesign or legacy-surface polish.

- D40 Status-light protocol (landed 2026-07-23; operator-approved after `/hud-gallery` review): adopt the Codex Micro five-signal model as a source-agnostic UI projection — off, active, result, needs-you, fault — with explicit priority rather than replacing Agent lifecycle, Session turn state, blocker detail, or Attention truth. One shared token/derivation set now drives Agent tabs, Sessions overview/switcher, and the real Spatial Operations Board across Demo and Live sources: idle/new/quiet → Off, working/reviewing → Active, quiet turn-end/complete → Result, bell/roadmap-blocked → Needs You, and failure/error → Fault. Active alone moves: its half-fill turns once every 2.4 seconds in DOM and R3F, while reduced-motion and low-power Spatial keep the same static mark; human gates and faults never pulse. Spatial keeps Project identity on zone edges and puts protocol color only in each Agent's light. The `/hud-gallery` remains the canonical review workbench and is linked beside Architecture only for the temporary admin allowlist. D30's shape/icon/text redundancy, D33's calm-attention rule, and the system action accent remain intact.
- D41 Elastic Project / Initiative ribbon (landed 2026-07-27): the detailed contract and verification live in the D41 section above; decision `0022` supersedes D37's automatic empty-Project close while preserving explicit close and durable Project identity.

Sequencing: D0 → D1 → D2, then dogfood begins while D3-D7 continue at full speed. D17 is active and precedes additional adoption polish without interrupting already-active ENG-015 or ENG-017 work. Durable Projects may proceed where it removes real switching friction but is not a start gate. ENG-017 follows the adoption blockers; ENG-004 V2.1+ stays parked until dogfood asks for the map.

Project doc:

- `docs/engineering/projects/daily-driver-adoption.md`

## D48: ⌘K nav-row ranking — FIXED 2026-08-04 (`2080510`)

Diagnosed 2026-08-03, operator-deprioritized mid-fix, then re-prioritized
after the operator hit it in real use ("How come I can't open Usage from
cmd+k?"). Symptom: typing a navigation row's name ("usage") ranked a fuzzy
Session match above the Navigation row, and "go to usage" returned nothing.

Root cause (src/components/shortcuts/command-palette.tsx): the palette used
cmdk 1.1.1's default `command-score` filter, which returns 1.0 only on
whole-value equality and 0.99 for ANY value whose text begins with the query —
so a nav row's name-prefix and a session-title prefix tied at 0.99, and cmdk
breaks ties by DOM order, where the Sessions group renders before Navigation.
No value-string reordering can fix a tie-then-DOM-order rule (which is why
26a7300's name-first values helped but could not finish it). "go to usage"
failed because command-score requires the whole query as an ordered
subsequence.

Landed fix (`2080510`), exactly the preserved design plus two discoveries
made during implementation:

- `src/components/shortcuts/palette-filter.ts`: a custom `filter` on the
  cmdk root with structural bands above the fuzzy range — exact-name (8) >
  name-prefix (7) > word-in-name (6) > keyword (5) > `defaultFilter`
  fallback (0..1]. Every palette row's value is its primary display name +
  a unique suffix behind an invisible U+2063 separator (cmdk requires
  unique values); auxiliary terms moved to cmdk's `keywords` prop.
  Go-phrasings (`/^go(?:\s+to)?\s+/i`) re-score with the verb stripped, a
  hair (0.01) below what the bare query would earn. Session-name prefixes
  deliberately share the nav-name prefix band: within a band cmdk falls
  back to DOM precedence, so session switching — ⌘K's primary daily use —
  keeps winning its own queries.
- **Discovery 1 — cmdk 1.1.1's group re-sort is a no-op** (latest release;
  verified against upstream source): `sort()` looks a group up by
  `[data-value="<encodeURIComponent(groupId)>"]` where groupId is the
  internal `useId`, but the group's `data-value` attribute holds its
  heading text. The group carrying the best-scored row could therefore
  never surface above an earlier group, no matter what the filter
  returned. `patches/cmdk.patch` (pnpm `patchedDependencies`) minimally
  restores cmdk's documented behavior by resolving the group element
  through its registered items. Not a framework bypass — a repair of the
  framework's own advertised sort; drop the patch when upstream fixes it.
- **Discovery 2 — stale list scroll**: once ranking moves the winning
  group to the top, a scroll position left over from an earlier keystroke
  could leave the selected first row above the fold (observed headful).
  The palette now resets the results-list scroll on every query change.

Verified: pure filter units + a jsdom acceptance suite over the real
`CommandPalette` (`command-palette-ranking.test.tsx`: "usage" first +
Enter-selectable, "go to usage"/"go usage" non-empty and first,
newest-surface-by-name, partial session-name query wins, same-band DOM
precedence, empty-query group order, frecency recents untouched), plus a
headful Electron run against the real app (EXAWATT_TEST=1): "usage"
selects the "Go to Usage" Navigation row, Enter lands on `/usage`, both
go-phrasings resolve.

Cross-item note: ENG-035's parallel `67b83fa` gave the public
`/leaderboard` destination a ⌘K row through the manifest's new
`commandPalette` eligibility; the row flows through this ranking path
unchanged, and the acceptance suite pins "leaderboard" → its Navigation
row first and Enter-navigable.

## D49: New Agent launcher — operator dogfood round, 2026-08-04

Status: landed 2026-08-06 after five operator review rounds. Operator verdict
on the D46 ribbon as installed was: _"super broken and borderline unusable… go
back to the drawing board."_ The findings below are the operator's own words
and framing, recorded verbatim-faithfully before shaping, and were explicitly
**non-comprehensive** — the operator said so twice. They remain the diagnosis,
not a scope boundary.

### Raw operator findings (2026-08-04)

Chip and ribbon presentation

1. Selectable chips are too short. They should be **taller so they can
   communicate more information** — the current one-line chip is the reason
   everything else has to truncate.
2. Model-selection chips **"don't really communicate anything useful because
   they truncate after only a couple of words"** (`claude-fable-5[…`,
   `Opus (1M conte…`, a GPT chip clipped mid-glyph).
3. The **green border box around the harness glyph is not wanted**
   (`SourceIdentityMark`'s `#566A76` plate reads as a green box on the night
   theme).
4. Chips **pop in unannounced with no loading indicator**, so there is a
   strong chance of clicking something the operator did not intend to click.
   The row must not change under the pointer without announcing itself.

Redundancy and information architecture

5. It is confusing to have an **All configurations… dropdown and a Customize
   button right next to each other**.
6. Below that first ribbon there is **a whole second row of options**, and the
   **same Customize (`Settings2`) icon appears twice** in the composer.
7. General verdict: _"it just seems like there's a lot of redundancy in the UI
   here."_
8. The **triangle/square/circle icon** (the `/agent-types` `Shapes` link) is
   **meaningless as a user**.
9. **"Optional name"** is meaningless as a user — the operator does not know
   what it is naming or why.
10. The **project name printed above the "New Agent" copy** is redundant: the
    product/project identity is already carried at a higher hierarchy level in
    the app chrome.

Colour and attention

11. The **YOLO permission chip is too orange/yellow** — _"the yellow thing draws
    my eye. It shouldn't be so orange."_

Broken behaviour

12. **Infinite spinner on the intelligence/thinking dropdown** — it says
    "Detecting…" indefinitely and never resolves.
13. **OpenCode is gone** — _"I can no longer find open code… even though we
    built it yesterday"_ (ENG-003 S2 landed 2026-08-03).
14. **There is no way to pick Sonnet.**

### Original goal, restated by the operator

_"Going back to my original goals, I wanted it to be stupid simple."_

- See the **top two to four new agent types**, easily selectable, where an
  "agent type" is a **combination of agent specialty type + harness + model +
  intelligence/thinking**.
- A **plus / new button** for anything outside that top set.
- Very easily click to **expand a detailed view that ribbons out from one of
  the chips**.
- **Tweak one parameter quickly with mouse or keyboard**, then **Enter, or Tab
  to Start**, to launch.

### Standing method the operator asked for on this round

- Do **lots of design iterations**, ideally on a **new gallery page**.
- **Build a test bench** so states can be iterated quickly.
- Take **lots of screenshots in different configurations**.
- **Ask clarifying questions** about taste rather than assuming design skill.

### Relationship to D46

D46's written contract already asserts several of these (model-first labels, a
non-wrapping single row, quiet Customize, no always-visible second axis row,
the `/agent-types` icon retiring into Customize). The implementation drifted
from it: the second control row, the duplicated `Settings2` icon, the standalone
`Shapes` link, and the co-visible All/Customize affordances all survive in
`src/components/workspace/launch-controls.tsx`. D49 is therefore both a
redesign round and a conformance round; D46's frecency, exact-identity,
unavailable-state, and single-catalog-owner contracts are retained unless this
round explicitly supersedes them.

### D49 root causes (diagnosed 2026-08-04)

**Finding 12 — the "Detecting…" spinner never resolves.**
`execFile`'s `timeout` option is not a deadline. It sends SIGTERM to the
process it spawned — the LOGIN SHELL — and then keeps waiting for stdio EOF. A
grandchild (`claude`, `opencode`, `codex`) inherits those pipes, survives its
parent's SIGTERM, and holds stdout open, so the promise never settles.
`pty:listAgentModels` then never answers, the composer's `modelCatalog` stays
`null`, and `modelReady` is false for the rest of the session — which is
exactly what the effort control renders as an endless "Detecting…". The
composer had no deadline of its own, so it inherited the hang.

Fixed on both sides. `electron/main/pty/agent-models.ts` gained
`execWithDeadline`, which spawns a detached process GROUP and, at the deadline,
`SIGKILL`s the whole group and resolves with whatever was read; all four probes
(login environment, Claude, Codex, OpenCode) now use it. `loadAgentModelCatalog`
in the renderer races the bridge call against a 25s deadline and falls back to
the honest "unavailable" catalog shape, so no future hang anywhere below it can
produce an unbounded spinner again.

**Finding 14 — no way to pick Sonnet.** Same root cause, plus an IA problem.
The live Claude Code catalog (via the SDK `initialize` control response) does
list Sonnet; verified directly on the operator's machine. But with
`modelCatalog` stuck at `null` the picker had zero options, and the only
surviving choice was the one model ID persisted on the draft. Independently,
the model picker lives behind the quiet Customize disclosure, so even a healthy
catalog puts the most common override two disclosures deep. D49's detail panel
promotes Model to a first-class axis one click from the chip.

**Finding 13 — OpenCode is gone.** Deterministic, not a race. The composer
builds engine chips with:

```
for (const sourceId of launchableSourceOrder) {
  const catalog = catalogsBySource[sourceId];
  if (!catalog?.effectiveModel) continue;
```

Claude synthesizes `'default'` and Codex falls back to `configuredModel ??
models[0]?.id`, but `parseOpencodeModelCatalog` sets `effectiveModel =
configuredModel` with no fallback — correctly, since choosing one of OpenCode's
hundreds of provider models on the operator's behalf would be exactly the
silent substitution `0027`/D46 forbid. The operator's
`~/.config/opencode/opencode.json` declares only a plugin and no `model`, so
`effectiveModel` is `null`, so OpenCode can never produce a chip — one day
after ENG-003 S2 shipped it. The catalog itself is healthy
(`opencode models --verbose` returns a full live catalog in ~2.6s).

The fix is not to invent a default. A launchable engine with no default model
is a real state and needs a real presentation: a selectable setup that says the
engine is ready and a model still has to be chosen, which opens the detail
panel on the Model axis and blocks Start until it is. That belongs to the D49
launcher and is not yet landed.

### D49 incidental fix: `cn()` dropped custom font sizes

Found while screenshotting the bench. The project defines its own font-size
scale in `@theme` (`text-chrome-micro`, `text-chrome-label`, `text-reading`,
`text-display`, …). tailwind-merge cannot infer that those are sizes rather
than colours, so it filed them in the `text-color` group: any
`cn('text-chrome-micro', 'text-hud-text-dim')` silently dropped one class and
rendered at the inherited size. `src/lib/utils.ts` now declares the scale
through `extendTailwindMerge`, with `src/lib/utils.test.ts` pinning both that
sizes survive beside colours and that genuine conflicts still resolve to the
last class.

The same pass added the missing `--color-hud-stroke*`, `--color-hud-fill*`, and
`--color-hud-surface-input*` theme tokens, so `border-hud-stroke-soft` and
`hover:bg-hud-fill` — already written in several components — stop being no-op
classes.

### D49 round 2 — operator review of the bench, 2026-08-04

Second pass, driven by the operator interacting with `/hud-gallery/agent-launcher`.

**Findings and resolutions**

15. _"In Trained, the harness title is too prominent."_ Resolved: the model is
    now the chip's only weighted line. Engine drops to the same quiet register
    as the role lede; order stays engine-first. Operator-selected.
16. _"Make the skeleton a little bit less granular… really ensure that the
    skeleton and real UI are non-divergent."_ Resolved structurally rather
    than by discipline: the skeleton IS `SetupChip` with `pending`, rendering
    the identical element tree with shimmer blocks instead of text. The
    hand-drawn placeholder is deleted. `pnpm eval:workspace:launcher` gates it
    — a pending chip and a real chip must agree on height AND line count, or
    the eval fails.
17. _"These tend to load every single time. Why not have some sort of cache…
    the models and the harnesses don't really change intraday although they
    can."_ Resolved with a disk-backed stale-while-revalidate cache
    (`electron/main/pty/agent-model-catalog-cache.ts`). Fresh inside 6h serves
    with no probe at all; stale serves instantly and re-probes in the
    background; past 14 days it is not shown. Only a `live-catalog`
    observation is retained, so a failed probe stays retryable instead of
    freezing a degraded view. Writes are atomic and serialized. A background
    refresh never reorders the row under the operator — it lands on the next
    composer entry, per D46's freeze rule.
18. _"Vendor is important but when it's not implied it shouldn't look the exact
    same as the 1 million context window."_ Resolved: they are now different
    channels. The model VARIANT (`1M context`) is a capability and sits beside
    the model name that it qualifies. The VENDOR (`OpenRouter`, `Ollama`) is
    identity, gets its own line and its own mark, and appears only when the
    engine does not imply it — Claude Code is always Anthropic. Hosted and
    local inference carry different marks, because that distinction is the
    point of engine plurality (`0027`). Operator-selected.
19. _"That wasn't really discoverable… you have to click and something
    invisible appears."_ Both operator-requested mechanics are built and
    switchable in the bench: `peek` keeps a collapsed one-line summary of the
    current setup permanently visible (it IS the drawer, closed), and `handle`
    hangs a grip tab under the selected chip that slides with the selection.
    The doubled anchor is gone — neither mechanic draws a notch, since both
    already point at their subject.
20. _"You're omitting the harness glyph in the engine drop-down again."_
    Resolved: engine options and the trigger carry the same brand glyph the
    chips do, through `OptionMenu`'s per-option `mark` slot.
21. _"In the engine drop down, at the bottom, have a link out to the
    configuration page or settings page where these can be added or removed."_
    Resolved: `OptionMenu` has a footer slot, and the engine axis uses it.
22. _"I can't use arrows to navigate up and down… I want to tap a letter, like
    S for sonnet… we're not using very good menus or input system at all."_
    Root cause and resolution in decision `0033`.

**Root cause of finding 22.** The launcher's first cut wrapped cmdk's
`Command` in a Popover and mounted `CommandInput` only above ten options.
cmdk's keyboard handling lives on that input, so a short list had no focused
element: no arrows, no type-ahead — strictly worse than an HTML `<select>`.
Decision `0033` records the answer to the operator's broader question (stay on
Radix; own one primitive) and `src/components/ui/option-menu.tsx` implements
it, with the keyboard model in `option-menu-keyboard.ts` unit tested without a
DOM: arrows with wrap, Home/End, PageUp/PageDown, disabled options skipped,
and macOS type-ahead where a repeated letter cycles matches rather than
searching for a doubled string.

**Still open after this round**

- The production composer still renders the old ribbon. The launcher is
  canonical in the bench; swapping `launch-controls.tsx` onto it is the next
  milestone.
- Finding 13 (OpenCode has no default model, so it can never produce a chip)
  needs the "engine ready, model not chosen" setup state. The view model
  supports it — `model: null` renders as **Choose a model** — but the composer
  adapter that produces it is not written.

### D49 round 3 — collapse the permutations, 2026-08-04

Operator, looking at the open drawer: _"There are way too many permutations on
this page now. One issue with this UI is it's duplicated — there's a row with
read-only text (that is duplicating all of the text in the card by the way) and
then the same exact text below editable. Try again."_

Both are correct and both are self-inflicted.

**The duplication.** The `peek` mechanic kept its collapsed summary line
visible while the drawer was open, so `Codex · GPT-5.3 Codex · Extra high ·
Ask first` appeared as read-only text directly above the four controls holding
those same values — and above a chip that already said three of them. Three
statements of one fact. `SetupDetailSummary` is deleted. The drawer's closed
face is now only the handle: a pull that says "there is more here" without
restating anything the surface already shows. The drawer's open face is the
editable axes and nothing else.

**The permutations.** Round 2 shipped a drawer toggle and a chip-layout toggle
on top of ten scenarios — forty renders to review. Carrying alternatives side
by side earned its keep for exactly one round and then became work. Collapsed:

- `LauncherDrawer` and the `peek` mechanic are gone; one drawer.
- `SetupChipVariant` and its three layouts are gone; one chip.
- Scenarios trimmed from ten to eight (`launching` and `wide` only permuted
  what `blocked` and `narrow` already prove).
- `scripts/agent-launcher-bench-shot.mjs` loses its matrix; it shoots the
  eight cases once and still runs the skeleton/real non-divergence gate.

The retained seam is the one that matters: `SetupDetailHandle` and
`SetupDetailPanel` are still separate, so WHERE the drawer appears can change
later without touching WHAT it edits. That is a seam in the code, not a toggle
in the UI.

### D49 round 4 — the drawer handle, 2026-08-04

Operator: _"The arrow handle is disconnected from the card, gap looks bad.
Secondly, it doesn't communicate what's in it. Raise your bar and test your
work."_

Both correct, and the third sentence is the actionable one: these were visible
in the screenshots I had already taken. The fix is a habit, not a patch.

**Disconnected.** The handle sat in its own child of a `gap-2` column, so it
floated 8px below the chips. It now shares the row's bottom border: `-mt-px`
with `rounded-b-lg`, so the chips' bottom edge and the drawer's top edge are
one line. A lit tick on that shared line sits under the selected chip and
slides with the selection — the connection to ONE card, without a second
pointer.

**Communicates nothing.** A bare chevron says something exists, not what. The
closed handle now reads `Engine · Model · Thinking · Permission`. That is not
the read-only summary deleted in round 3: that restated the chip's VALUES,
this names the AXES the drawer holds and restates nothing. It disappears the
moment the drawer opens and the real labels take over.

**Found by looking, which is the point.** Attaching the handle produced a new
defect one screenshot later: open, it became a full-width empty band with
`Done` floating at its right end. The handle now collapses to zero height when
open and `Done` moves onto the footnote line, which was already half empty.

**The habit.** `pnpm eval:workspace:launcher` now fails the run — not just
renders a picture — on each of:

- the handle detaching from the row (`handle.top - chip.bottom > 0`)
- the handle overlapping by more than a shared border
- a closed handle that names none of its contents
- an open drawer that still renders a handle band, or has no visible close
- skeleton and real chip disagreeing on height or line count

Three of those five are defects the operator caught by eye in rounds 3 and 4.
Encoding them is cheaper than another review round, and the standing rule now
reads: for any layout contract that can silently regress, assert the geometry
in the eval — then still read the PNGs, because gates only check what you
thought to check.

### D49 round 5 — concise cards and production adoption, 2026-08-06

Operator review of the accepted bench found three concrete card defects before
the production swap: ranking prose (`Suggested`, `Pinned`, `Used N×`) was noise;
the fixed-height thinking row could wrap and paint over the row below; and the
`1M context` capability could force the Opus name into an ellipsis. The visible
ranking prose is gone. Recommendation reason survives as a quiet corner mark
(suggested, recently used, or Project-pinned) with hover and accessible text.
The model owns its full anchor line; capability and non-implied vendor identity
share the quiet secondary line; the final row is a single non-wrapping thinking
value or exact unavailable reason.

The spatial keyboard path now matches the drawing: ArrowDown on a setup card
opens its attached drawer and focuses the first enabled axis without scrolling
the page. Left/Right and Home/End remain the card-row movement keys. The browser
evaluator now gates card-line overflow/overlap, complete Opus text, absent
ranking prose, and the ArrowDown focus handoff in addition to the round-4 drawer
and skeleton geometry.

The canonical `AgentLauncher` now renders in the production Cmd+T composer.
The runtime adapter freezes `recommendLaunchSetups` after every launchable
source has a catalog result, projects exact source/model/effort configurations
into the same cards as the bench, and keeps a selected exact configuration in
view without re-sorting the row. A launchable source with no default model is a
visible `Choose a model` setup, not an omitted engine; Start remains blocked
until an exact model is selected. This closes the OpenCode omission without
inventing a provider default. More retains the full configuration/Shell catalog
and keeps worktree, branch, roadmap, and quick naming behind that disclosure.
Shell remains immediate through More, the command palette, and Cmd+Option+T.

The production lede, legacy ribbon, co-visible All/Customize controls, and
always-visible second selector row are no longer rendered. The implementation
adheres to the design-system HUD operational card spacing, named chrome type
rungs, muted readable roles, 160–260ms reduced-motion-safe transitions, and
Voice rule: values and states stay; explanatory provenance copy does not.

## D53: resume gets a keyboard — FIXED 2026-08-13 (`b9e26fc`)

**The verb that brings a fleet back needed the mouse.** Feedback row
`f05da191`, operator on dogfood 0.1.9: "There's no cmd+k or discoverable
keyboard shortcut for resume this agent." Resume existed only as the recovery
bar's `Resume project N` split control and the per-Agent affordance beside it.
That breaks D9 keyboard authority (every daily verb is rebindable and
palette-reachable) and it breaks the ⌘K-is-a-backstop rule in its INVERSE
form — the rule usually catches a palette row with no visible home; here a
visible affordance had no chord.

This is a keyboard surface over D36's contract as D47 presents it, not a new
recovery model. Two scopes, two verbs, no third:

- **`⌘⌥R` — Resume this Agent.** The selected tab, if it is a parked Agent
  with an exact provider identity.
- **`⌘⌥⇧R` — Resume the parked Agents.** Whatever the bar's one-click control
  would do right now: the selected Project, or every Project when the selected
  one has nothing parked. The chord cannot disagree with the button because
  both read one derivation.

### Why R rides ⌥, and why ⌘⇧T was not extended

`R` is the only honest mnemonic and `⌘R`/`⌘⇧R` are permanently unavailable —
not to macOS, but to Exawatt itself. The View menu ships Electron's `reload`
and `forceReload` roles, which register `CmdOrCtrl+R` and `Shift+CmdOrCtrl+R`
as real native accelerators; the renderer never sees those keydowns. A chord
that reaches the menu instead of the app is dead on arrival, and the D19
system-hotkey check would not have caught it, because it consults the machine's
symbolic-hotkey table and this collision is the app's own.

So `⌥` carries the family, which is the app's established move: `⌘T` new Agent
→ `⌘⌥T` new shell is the same "the mnemonic is taken, take the alternate"
shape. `⇧` then escalates scope exactly as `⌘⌥[` (move the tab) escalates to
`⌘⌥⇧[` (move the Project). Checked before picking: no Apple default and no
user-enabled entry in the operator's own `com.apple.symbolichotkeys.plist`
binds the R key (29 entries, zero on vk 15), `reservedShortcutFamily` leaves R
alone, and neither combo collides with a registry default or a fixed family.

Extending D39's `⌘⇧T` was considered and rejected on purpose. `⌘⇧T` takes the
newest entry from the close ledger and restores it as a stopped tab —
`resumeState: 'ended-resumable'`, no process, no billing. Resume spawns against
an exact provider identity on a tab that is already on screen. Same word,
different objects, different consequences; one chord for both would make the
outcome depend on invisible state, which is precisely the ambiguity D39 removed
when it moved shell launch off `⌘⇧T`.

### The ⌘K verbs are contextual, not disabled

The Workspace group's convention is a greyed row with a short reason. Resume
does not follow it. With nothing parked the two rows are ABSENT: a permanently
disabled "Resume" would appear in every palette of a healthy fleet and train
the operator to skip past the row that matters for the ten seconds after a
relaunch. `resumeScope` is `null` in the availability snapshot when there is
nothing to resume, and the rows derive from it.

Ranking is structural, not incidental. Both row names LEAD with "Resume", so
D48's name-prefix band (7) puts them above any Session that merely
fuzzy-matches the query (the `defaultFilter` 0..1 band) — pinned by a fixture
Session titled "Rebuild the consumer metrics", which contains r·e·s·u·m·e in
order and renders in the Sessions group ABOVE Workspace. The scope row also
names the real scope and count: **Resume 2 parked Agents in Alpha**, or
**Resume all 3 parked Agents**.

### Discoverability without clutter

The bar teaches its own chords. The one-click control carries a keycap after
its count, and the scope menu's trailing column becomes the chord column
(counts move inline beside their labels). They render ALWAYS rather than on a
modifier-hold reveal: the bar is itself transient, so a hint you must discover
in order to discover the chord is not a hint — and always-rendered reserves the
space by construction, which is how it satisfies "a hint never shifts layout".
Every keycap resolves through `useEffectiveShortcut`, so a rebind in Settings
changes what the bar advertises instead of leaving it lying. `All projects` has
no chord and shows none. Both verbs join `⌘/` automatically because they are
registry shortcuts.

### What did NOT change

`tabCanResumeAsAgent` remains the only eligibility rule, so exact provider
identity is still the whole contract (ENG-018) and a tab without one is never
counted, never offered, and never guessed at. No auto-resume, no new
confirmation model, no third scope. A chord fired with nothing to resume
consumes its keystroke — so Chromium cannot reinterpret it — and announces on
the workspace live region (D44/D51), because after a relaunch "did my agents
come back?" is the open question and a silent key is indistinguishable from a
broken one.

### Evidence

Unit: `src/lib/shortcuts/defaults.test.ts` (new — one command per combo, no
default lands on a reserved fixed family, no default collides with an Apple
system hotkey, the two recovery ids and their chords, and ⌘⇧T unchanged);
`use-workspace-shortcuts.test.tsx` (both chords route to their own action,
resume fires from inside a focused xterm, a rebind moves the chord);
`workspace-command-availability.test.ts` (nothing parked → no scope and both
verbs unavailable; Project default matching the bar; all-Projects fallback with
the per-Agent verb still unavailable on a live tab);
`command-palette-ranking.test.tsx` (rows absent with nothing parked and no
disabled "Resume" either; both verbs above the fuzzy Session for "resume";
chords rendered; the bar's fallback scope named; Enter dispatches the request);
`resume-recovery-bar.test.tsx` (each scope teaches its chord; a rebind is
followed). Full suite 2238 passing.

Real app, `EXAWATT_TEST=1` against this worktree's dev server, four launches
with a pre-seeded parked layout (two Agents in Alpha, one in Beta): relaunch
restores the recovery bar; the bar shows `⌘⌥⇧R` and the scope menu shows
`⌘⌥R`; `⌘⌥R` resumes exactly `dur-a1` on `sess-alpha-1`; `⌘⌥⇧R` then resumes
the rest of Alpha and leaves Beta parked; ⌘K "resume" ranks **Resume this
Agent** first with **Resume 2 parked Agents in Alpha** second, both with their
chords, and Enter resumes the same Agent the chord does; a fresh profile with
nothing parked shows no bar and offers no resume row. `eval:workspace:chrome`
(the gate this change owes) and `eval:navigation` both pass.

## D55: interaction performance architecture — planned 2026-08-16

**Exawatt keeps Electron and makes its existing renderer split an explicit performance contract.**

The codebase investigation found no missing “turn on the GPU” switch. Agent
already delegates terminal cells to xterm's WebGL renderer with a canvas
fallback, Team uses compositor-friendly transform/opacity and position-only
FLIP, and Fleet uses R3F demand rendering, instancing, bounded DPR, imperative
frame work, and measured scale budgets. The unmeasured gap is the complete
Electron input-to-pixel path across those regimes.

Decision `0038` records the durable posture: React owns discrete semantic state;
Chromium compositing, xterm WebGL, and R3F own continuous pixels; no mini-GPUI,
hidden shadow application, broad store rewrite, or default prewarming. D55 first
builds an optional deterministic gesture/trace rig, then baselines cold/warm
packaged-equivalent behavior and changes one attributed owner at a time. It is
not an every-landing performance gate, and BUG-012/BUG-013's main-process
beachball remains a separate diagnosis.

The complete gesture matrix, measurement model, six-stage sequence, per-stage
regression reviews, remediation decision tree, prewarming admission test,
pre-mortem, and acceptance criteria live in
[`interaction-performance-architecture.md`](interaction-performance-architecture.md).

## D56: one owner for the operator's position — FIXED 2026-08-16 (BUG-018, BUG-017)

**Asynchronous work stopped being allowed to move the operator.** Feedback row
`39cac400`, operator on dogfood 0.1.10: a ⌘T launch stayed pending, he switched
to another Agent, and the launch landed by activating the Agent it had started
and taking the keyboard with it.

The triage pass before this one already found the two `launch` branches. The
implementation pass found that they were not the disease. Counting every place
that wrote `activeDir` / `group.activeTabId` in `use-workspace-state.ts` turned
up roughly a dozen — `launch` (both branches), `addSession`, mount adoption,
`reopenClosedSession`, `createDraftTab`, `openProject`, `importProjects`,
`activateSession`, `selectTab`, `selectExistingTab`, `cycleTab`,
`selectTabByOrdinal`, `selectProject` — each carrying its own private copy of
"make this the operator's position", and several of them running after an
unbounded `await`. Guarding the two branches named in triage would have fixed
the reported symptom and left the shape that produces the next one intact.

### The rule, stated once

`src/components/nav/operator-position.ts` holds it:

> Only the intent that is still current may move the operator.

A verb that will move him states the position authorising the move BEFORE it
awaits (`claim` / `claimHere` / `claimTab`). When its work lands it asks
`stillCurrent()`. True means he has not moved since he asked. False means he
has, and the completion still finishes its real job — promote the draft tab to
live, append the Session, register the Project — without touching selection,
altitude, or keyboard focus. Readiness is surfaced where BUG-018's contract
says it belongs: in that Session's own tab, which turns live in the strip.

Three properties are deliberate, and each of them is a mistake not made:

- **Position, never elapsed time and never OS window focus.** A fast
  completion can be stale (he switched tabs in 200ms); a slow one can be
  current. An app in the background is not an operator who changed tabs.
- **Pulled, never mirrored.** `workspace-client` registers a source that reads
  its own active Project and tab; the authority never keeps a copy. A mirrored
  position is one more thing every selection verb must remember to update, and
  the verb that forgets is the next stolen focus.
- **Fails closed.** No registered source, or an unmounted workspace, authorises
  nothing. A Session that starts without pulling the operator costs one
  keystroke; focus taken from under him costs a train of thought.

At the Sessions altitude the position carries NO tab. Up there the subject is
the roving tile (`teamSelection`), and the tab underneath is not where he is.
That is also what lets "he asked from Team and is still at Team" stay true
while the launch selects a tab beneath him.

### The one door

`moveOperator(dir, tabId)` in `use-workspace-state.ts` is now the only thing
that takes the operator to a Project or tab. Operator-driven verbs call it
directly; asynchronous ones must hold a still-current claim first. `addSession`
no longer selects at all — appending is bookkeeping, going there is a decision.
A Project still always names a current tab while it has one, but filling an
EMPTY slot is bookkeeping too: it says where he would land if he ever went
there. Overwriting a filled one is a move. Closing is the single exception and
says so in the comment: it repairs a position he destroyed, by the neighbour
rule.

### What this removed from BUG-012's recurrence

BUG-012's 0.1.10 report is a stall AND "focus repeatedly jumped among Agents
and the UI changed altitude to Agent without intent". The second half had two
mechanisms, both now gone:

1. **Mount adoption asserted selection once per adopted Session.** Every live
   PTY unknown to the persisted layout called `addSession`, and every one of
   those wrote `activeTabId` and `setActiveDir`. At the operator's fleet size
   the LAST one enumerated won, overwriting the tab the layout had just
   restored. Adoption now appends and moves nobody; only a workspace with no
   restored position takes one, and it takes the FIRST adopted Session rather
   than whichever came last out of a Map.
2. **`startRoadmapAgent` / `startRoadmapRemediation` called `closeOverview()`
   after an unbounded launch.** That is literally "the UI changed altitude to
   Agent without intent": preferences, the source registry and a cold provider
   spawn all resolve long after the click, and the drop out of Team fired
   regardless of where he had gone. Both are claim-gated now.

BUG-012 stays open for the stall. If focus still jumps after this, that is
evidence of a mover that never went through `moveOperator` — not of the
transcript parse BUG-013 already deleted.

### BUG-017: two hint owners, one deleted

Feedback row `21f29c03`. The New-Agent composer printed its keyboard grammar
twice: D49's `AgentLauncher` shipped `data-launcher-hints`, and the surrounding
`launch-controls.tsx` still carried the pre-D49 `data-composer-hints`. Same
chords, drifted words — the older line called a setup a "configuration", so the
two lines disagreed about the product's own vocabulary while sitting one above
the other on the app's highest-frequency path.

The launcher owns the surface, so it owns the grammar. `data-composer-hints` is
DELETED, not hidden. `↓ recent` — the one key the composer implements and the
launcher component does not — moved onto the surviving line, which is now the
exact union of what the composer answers to. The recent-conversation list keeps
its own contextual line (`↑↓ choose · home/end jump · ⏎ continue · esc new
task`) because that is a different context, not a second copy.

### Evidence

- `nav/operator-position.test.ts` — the rule: still-current moves, moved-away
  does not, altitude change counts as moving, leave-and-return is current again
  (currency is position, not history), unknown position authorises nothing.
- `workspace/launch-focus.test.tsx` — the regression, at the hook, with a
  position source derived exactly the way `workspace-client` derives it: a
  `pty.create` held open, the operator switches tabs, then the provider comes
  up. The draft is live and the operator is still where he went. Verified to
  FAIL without the fix (2 of its 3 cases) and pass with it.
- `launch-controls.interactions.test.tsx` — each composer chord appears exactly
  once, counted over the whole rendered surface so hiding a duplicate cannot
  satisfy it.
- Gates green on this tree: `eval:workspace:launcher`, `eval:navigation`,
  `eval:workspace:chrome`.

Observed while verifying, NOT caused by this change: `eval:electron:project-agent`
fails on `origin/master` in this environment at its post-reload
`[data-tab-id][data-active] [data-status="done"]` wait (the page closes rather
than timing out). Confirmed by running the same eval on a stashed tree. Its
first eighteen checks pass either way, including the launch-to-active-tab path
this change touches.

## D57: a verb cannot be born undiscoverable — landed 2026-08-16

**One manifest now owns every command verb's three surfaces, and the build
fails when a verb loses one.** FIX-012 and FIX-014 fall out of it.

### The structural cause, which is not "Resume was forgotten"

FIX-012 is the third independent report about Resume, after FIX-010 and
BUG-012. D53 had already given it `⌘⌥R`, `⌘⌥⇧R` and two ⌘K rows on the same
day the feedback was filed. What was still missing on 2026-08-16 was the
native menu item, and the reason it was missing is the reason it could not be
noticed:

D44 solved this exact defect for one command class. Fixed key families —
positional ordinals, arrangement chords, focus boundaries — got a typed
manifest that key dispatch, `⌘/`, palette rows and native menu items all
derive from, with a union type that forbids an unexplained omission. D44 then
said, in writing, that the REBINDABLE registry class was out of scope. So that
class kept four hand-maintained lists with nothing joining them:

| list | owner | what it decides |
| --- | --- | --- |
| `src/lib/shortcuts/defaults.ts` | renderer | the rebindable binding and the `⌘/` row |
| `WORKSPACE_PALETTE_ROW_ID` in `command-palette.tsx` | renderer | the ⌘K row |
| `MENU_COMMAND_SHORTCUTS` + the availability array in `shortcut-provider.tsx` | renderer | which menu command displays which combo, and when it is enabled |
| the `createMenu()` template inside `electron/main/main.ts` | main | the menu item itself |

The fourth is the load-bearing one. It lived inside a 1,600-line `main.ts`,
`electron/` compiles with `rootDir: electron/` so the renderer cannot import
it, and no test ever built it. A verb could hold a chord, a palette row and an
availability key and simply never appear in the menu bar, and every check in
the repository would stay green.

### The fix: one manifest both processes import

`packages/core/src/shortcuts/command-verbs.ts` is the single declaration.
`@exawatt/core` is the one place BOTH the renderer and the Electron main
process already import, which is what makes a shared manifest possible instead
of a mirror joined by a test. Each verb declares three legs, and each leg is
D44's union — a real surface, or `null` plus a written reason the contract test
requires to be a sentence:

```ts
{ id, label, description, availability?, tenantScope? }
  & ({ keys, category, contexts } | { keys: null; keyboardDiscoverability })
  & ({ palette: { rowId } }        | { palette: null; paletteDiscoverability })
  & ({ menu: { commandId, label, section } } | { menu: null; menuDiscoverability })
```

Everything else becomes a projection:

- **`defaults.ts` declares nothing.** It maps `keyboardCommandVerbs()` into
  registry definitions, so a verb cannot enter the keyboard layer without
  having answered for the palette and the menu. `⌘/` and Settings follow for
  free, as they always did.
- **The palette reads its row ids from the manifest** (`verbRow(verbId)`), so
  renaming a row in one place cannot silently break the join.
- **The Electron template moves out of `main.ts`** into
  `electron/main/application-menu.ts`, which builds every item from the
  manifest: label, command id, default accelerator (via `bindingToAccelerator`,
  also moved into the shared package), `registerAccelerator`, and which
  commands the enablement sync covers. Asking for a row whose verb declares no
  menu item throws, so the template cannot publish something the contract does
  not know about.
- **`shortcut-provider.tsx` derives** the accelerator join, the availability
  list and the tenant gate from the same manifest instead of restating them.
- **`electron/main/fixed-session-menu.ts` is deleted**; D44's fixed-family menu
  rows moved into the shared manifest, so one module now owns every native menu
  command id in the app. `fixed-families.ts` still owns fixed-family behaviour
  and joins those shared rows.

`src/lib/shortcuts/command-verbs.contract.test.ts` is the enforcement. It
builds the real Electron template and asserts, for every verb: its declared
menu item exists with that exact label, shows that verb's own default combo,
registers natively only for `⌘,`; its declared palette row is one the palette
actually renders; its availability names real workspace truth and is covered by
the enablement sync in both processes; its tenant gate matches its declaration;
and no menu command exists that no manifest owns. Deleting one `verb(...)` line
from the template fails two assertions immediately (verified by mutation).

### The audit, and the six other verbs it found

All 27 command verbs were audited against the three surfaces. Resume was not
the only one missing a leg:

| verb | what was missing | fix |
| --- | --- | --- |
| `workspace-resume-agent` (`⌘⌥R`) | no native menu item | Session ▸ **Resume This Agent** |
| `workspace-resume-scope` (`⌘⌥⇧R`) | no native menu item | Session ▸ **Resume Parked Agents** |
| `workspace-roadmap` (`⌘B`) | no native menu item at all | Go ▸ **Project Roadmap** |
| `quick-feedback` (`⌘⇧F`) | menu row existed but was hand-built outside the accelerator join, so the menu never showed the chord | joined; Help ▸ Submit Feedback… now displays `⌘⇧F` |
| `help-modal-slash` (`⌘/`) | the cheat sheet had no menu home | Help ▸ **Keyboard Shortcuts** |
| `open-settings` (`⌘,`) | never listed in `⌘/`, and not rebindable | a real registry verb; still the only natively registered accelerator |
| the four Start-Agent rows | a hardcoded list; a fifth launchable Agent Source would have shipped without a menu item | derived in both processes from `contracts/agent-sources.json` (`harness !== null && capabilities.interactiveLaunch`), which reproduces today's four exactly |

One documented mirror died with it: `CONSUMPTION_SURFACE_NAME` carried a
comment naming the Electron Go-menu label as a copy that "cannot import this
module". It moved to `packages/core/src/surface-names.ts`, both processes read
it, and the contract test additionally joins every Go-menu destination row to
the navigation manifest by canonical name.

### FIX-014 rides the same module

The application menu showed only `Build <sha>` — diagnostic identity where
product identity belongs. It now leads with `Version <app.getVersion()>` and
keeps the short sha directly below, so "which version am I on" and "which build
is this" are both answerable and neither is guessing. Ordering is asserted by
the contract test and read off the real menu by the spine eval.

### What is NOT fixed, and is now on the record

D44's own follow-on — pointer-only verbs, which no surface enumerates — is
started, not finished. The strip menus still hold two verbs that reach no
command surface: **Reveal in Finder** (tab and Project) and **Close project**
when the Project still has tabs (`⌘W` closes the active tab or an EMPTY
Project). Both need a new workspace event and a handler in `workspace-client`,
whose gate `eval:workspace:chrome` is quarantined; giving them rows here would
have meant shipping the fix behind a red gate. They are named here rather than
silently absent.

### Gates, and one nondeterministic gate repaired

The menu surface had no gate because it had no file. `application-menu.ts`,
`command-verbs.ts` and `shortcut-provider.tsx` now declare
`eval:navigation:spine` in `SURFACE_GATES`, which is the eval that reads the
real `Menu.getApplicationMenu()`.

Declaring gates immediately caught a second defect, exactly as D51 predicted it
would. `eval:navigation` failed and passed at random on the same tree with the
single most unactionable message a browser produces: `Failed to load resource:
the server responded with a status of 404`, no URL. Two causes, both fixed
here. Chrome puts a failed subresource's URL in the console message's LOCATION,
not its text, so the evaluator was discarding the only useful half — it now
reports `<message> — <url>`. And the resource was `/favicon.ico`, which Chrome
probes on its own even though the document declares `app/icon.png`; whether it
probes depends on profile state, which is why the same tree passed twice and
failed three times. That one browser-initiated probe is now ignored by URL, so
the gate answers about the product instead of about Chrome's mood.

### Evidence

`command-verbs.contract.test.ts` (22 assertions, mutation-verified);
`pnpm test:run` 2465 passing; `pnpm type-check`; `pnpm lint`;
`pnpm electron:compile`. Against this worktree's dev server:
`eval:navigation:spine` all green including the five new menu checks — Session
publishes `Resume This Agent|Command+Alt+R` and
`Resume Parked Agents|Command+Alt+Shift+R`, Go publishes
`Project Roadmap|Command+B`, Help publishes `Command+Shift+F` and
`Keyboard Shortcuts|Command+/`, the application menu shows the version above
the build sha, and the two Resume rows follow a live `syncAvailability` — plus
`eval:navigation`.

## D58: one owner for the Session surface — FIXED 2026-08-16 (BUG-004, BUG-019)

**Two reports, one disease: the terminal pane's responsibilities were spread
across places that did not know about each other.** Neither fix is a patch on
the symptom; both fall out of giving a responsibility a single owner.

### BUG-004 — the link interaction boundary had four owners

The pane registered, in this order, four independent authorities over the same
pixels, and every reported symptom was a different one leaking its own default:

1. **xterm core's `OscLinkProvider`**, registered by `CoreBrowserTerminal`
   BEFORE any addon and therefore outranking everything the app registers. It
   handles OSC 8 hyperlinks — the form Codex and Claude Code emit for their own
   citations — and calls `options.linkHandler` if the embedder set one. The pane
   never did, so it fell through to xterm's `defaultActivate`:
   `confirm('Do you want to navigate to …')` followed by `window.open()`. Our
   `setWindowOpenHandler` denies every window, so `window.open()` returned null
   and the function logged a warning. **The operator's OK could not possibly
   open anything** — that is the original 2026-08-04 report exactly. The
   2026-08-07 pass looked for that dialog in the app and in
   `@xterm/addon-web-links`, found nothing in either, and honestly closed it as
   unreproducible; the string lives in the CORE package. Incident `0013` records
   the search space error so it is not repeated.
2. **The same provider's http-only filter.** Without
   `linkHandler.allowNonHttpProtocols`, every `file://` hyperlink is discarded
   before it becomes a link. That is the web-versus-local split the
   2026-08-14 partner conversation isolated, and why "links in Codex do not
   activate at all": there was no link to activate.
3. **`WebLinksAddon`**, which recognised URLs and nothing else, sitting at a
   higher priority than
4. **an ad-hoc path regex** that read ONE unwrapped buffer row and required a
   `/`, `~/`, `./` or `../` prefix — so `src/components/workspace/terminal-pane.tsx:186`,
   the form Agents print most, was invisible, and any path the terminal wrapped
   across two rows was invisible too. That is the partner's "it's worked a
   couple of times, but it's not consistent".

Plus a fifth surface that knew about none of them: the context menu offered
Copy / Paste / Select All, so right-click could never copy a link.

**What changed.** One vocabulary, `terminal-targets.ts`, decides what a target
is — from plain text (URLs, absolute, home, dot-relative and bare
repo-relative paths, with `:line:column`) and from an OSC 8 URI, into the same
`TerminalTarget` type. One provider, `terminal-link-provider.ts`, joins wrapped
rows into the logical line the operator sees and maps string offsets back to
buffer CELLS (so wide characters do not shift the underline); its windowing and
back-mapping are ported from `LinkComputer`, which is what made deleting
`@xterm/addon-web-links` possible. The pane claims `options.linkHandler` with
`allowNonHttpProtocols: true`, so OSC 8 hyperlinks and recognised text reach one
`openTarget`. The context menu is fed by the hover callbacks of that same
vocabulary, so right-click offers `Open …` and `Copy Link` / `Copy Path` for
whatever is under the pointer. A target that cannot be opened now says so in a
pane notice instead of dropping a rejected promise — silence is what made the
original report read as "clicking does nothing".

### BUG-019 — nothing owned terminal geometry

The inset was missing, but the reason it could not simply be added is that a
terminal has three descriptions of its own width — the visual inset, the fit
addon's column count, and the PTY's window size — and they were set in three
places, with the PTY resized from three separate call sites. An inset added
anywhere the fit addon cannot measure buys its room by clipping the final
column, which corrupts every full-width redraw inside the Session while looking
correct in a screenshot.

`terminal-geometry.ts` declares the inset once (12/8px, the dense operational
tier of the design system's spacing scale) and exposes it as CSS custom
properties applied to `.xterm` padding — the exact surface `@xterm/addon-fit`
subtracts before dividing by cell width, so the inset is charged to the COLUMN
BUDGET. `createTerminalSizeSync` is the only fit-then-propagate step: fit,
publish `data-terminal-cols/rows` onto the pane, resize the PTY. The late TUI
resync still wiggles a row to force a real SIGWINCH but takes its true size from
that owner. One incidental discovery: xterm's legacy `.xterm-viewport` is an
absolutely positioned rectangle over the whole padding box with a hardcoded
black ground, so the first attempt painted black bars in the new gutter; its own
rule loads after ours, so the override wins on specificity, not order.

### Evidence

`eval:electron:terminal` moved onto this worktree's dev server through
`withElectronApp` (it previously required a packaged app, which no agent could
run, and it did not use the harness that guarantees the Electron tree is reaped).
It now carries both contracts and passes all seventeen checks:

- geometry: the declared inset reaches the fit addon; content is inset from the
  app boundary; no painted column is clipped; the reported column count is the
  most that FIT inside the inset viewport; the PTY window size equals the
  reported geometry; and the shell's own `stty size` agrees — an oracle nothing
  in the renderer can talk into agreement;
- links: `linkHandler` is claimed with `allowNonHttpProtocols`; a bare
  repo-relative path, a URL, and an OSC 8 `file://` hyperlink all hover as
  targets; right-click names the target and copies it to the Electron clipboard;
  left-click dispatches and reports its outcome; and `window.confirm` is never
  called.

The gate was proven adversarially: reapplying the inset in a way the fit addon
cannot see (absolute positioning instead of padding) fails with
`painted 1380px of 1376px, -4px spare at 7.5px/cell` — the terminal reporting
184 columns while only 183 can paint.

Two harness defects found by running the gate repeatedly, both of which had
been making Electron evals look randomly broken:

- **`sweepOrphans` was machine-wide.** Its pattern
  (`exawatt.*node_modules/.pnpm/electron.*playwright-core`) matched every
  sibling agent worktree, so a second agent starting an Electron eval
  `pkill -9`ed the first agent's LIVE app mid-run — surfacing as an
  unexplained "Target page, context or browser has been closed" in a run that
  had done nothing wrong. Four concurrent worktrees are the normal state here,
  so the sweep is now scoped to the calling tree's own Electron.
- **`openShellFromLauncher` clicked a disabled control.** The launcher's
  catalog trigger stays disabled until the agent-source registry answers, which
  on a cold launch can outlast a page's default timeout; it now waits for the
  enabled state instead of failing with "element is not enabled".

The scoped sweep only fixes trees that have it, and a sibling checkout keeps
the old behaviour until it rebases, so `withElectronApp` also learned to tell
"the app disappeared" apart from "the eval failed": an external teardown
relaunches on a clean throwaway profile up to three times and says so, while a
genuine product failure still fails on the first attempt. And the file's own
standing rule — "run evals SERIALLY; never overlap two Electron launches" — is
now enforced where it was always meant to apply: an advisory machine-wide lock
under the temp dir serializes Electron evals ACROSS worktrees, reclaims a stale
holder, and fails open after a bounded wait rather than deadlocking a landing
behind another agent. A gate nobody can trust is a gate nobody runs (D52).

D56's own verification note — `eval:electron:project-agent` failing on
`origin/master` because "the page closes rather than timing out" — is the same
cross-worktree teardown diagnosed here, not a product failure on that tree.

## BUG-026: attention producers declare their scope — FIXED 2026-08-16

**Attention is a fleet fact and is now computed like one.** A roadmap item
marked blocked with a live Session attached painted its amber marker, lit its
Project dot and joined the ⌘J queue only while the operator stood in that
Project. Step into another Project and the same Session read clean; ⌘J would
not visit it. Step back and the marker returned — and its `since` pin was
re-stamped with a fresh clock, so the documented oldest-first walk quietly
ordered by "least recently visited" instead.

Reproduced before anything was fixed, against the pre-fix wiring: the same
two-Project fixture painted and reached the blocked Session while standing in
its Project and returned `false` / `[]` for the identical question asked from
the other one, and a Project round trip moved `since` from 1000 to 9000.

### The structural cause, which is the family's

Fifth in the line BUG-001, BUG-008, BUG-009, BUG-012: two producers of one
truth with no written contract between them. PTY attention (bell, turn-end,
reported gate) is fleet-wide. Roadmap attention was derived from
`useProjectRoadmap(activeProject.dir, …)` — one Project's lens — and both were
merged by `mergeSessionAttentionMaps`, which took plain records and therefore
**had no way to express "this source only knows about a subset"**. A missing
key meant "no signal", so three fleet-wide consumers (the tab strip, the
Project ribbon dot, the ⌘J queue) read a partial map as complete.

D51 had already made eligibility one shared rule. That was right and it was
not enough: one rule fed an incomplete map still lies. ENG-017's own
2026-07-11 review saw this exact defect and deferred it — "roadmap-blocked tab
badges show only for the active project because the lens is
active-project-scoped — cross-project roadmap attention needs a multi-project
lens (future)". The deferral is now closed.

### What changed

**A producer must declare what it looked at** (`session-status.ts`).
`fleetAttention(id, signals)` claims every live Session in every open Project;
`scopedAttention(id, signals, ids)` names exactly what it can speak for.
Merged coverage is the INTERSECTION of the sources' scopes, because attention
is a disjunction: for a Session to read quiet, every producer must have looked
at it. `attentionAt(view, sessionId)` answers `{ known: false, unseenBy }`
outside coverage rather than "quiet".

**The proven-complete map is a different type.** `FleetAttentionSignals` is
minted only by `mergeFleetAttention`, which accepts fleet producers only, and
it is what `paintsAttention`, `attentionJumpQueue`, `orderedAttentionTargets`,
`TabStrip`, `ExposeOverlay`, `deriveProjectRibbonSignal` and the roadmap lens
projection require. A narrow producer therefore cannot reach a fleet-wide
surface without a compile error, and a partial merge has no record form at all
— `mergeAttention` returns a view you must interrogate. `mergeSessionAttentionMaps`
is deleted, not deprecated.

**Roadmap attention is produced fleet-wide** by
`src/components/roadmap/use-fleet-roadmap-attention.ts`, with a stated cost:
one `roadmap:read` per OPEN Project on Project-set change, window focus, and
that Project's own file-change broadcast; a parse only when the file's mtime
moved; one watcher per open Project (main already caps at 32); one cache entry
per open Project, dropped when it closes. Nothing runs per render or per PTY
tick. It links git-free — declared id, worktree path, session title, context
summary, operator task — because branch and commit evidence cost a process per
Session, and a signal that exists only for the Project you are standing in is
the defect, not a feature. Branch/commit evidence remains the active Project
lens's display enrichment.

That hook is also now the **sole owner of roadmap file watching**;
`useProjectRoadmap` listens to the broadcast and no longer watches/unwatches.
Two owners of one per-directory watcher blind each other: a Project switch in
the lens would have unwatched a Project the fleet producer still needs.

`since` durability falls out of the same move. The pin map is no longer pruned
against one Project's view; `pinRoadmapBlockedSince` keeps a pin while the
block holds anywhere in the fleet, drops it when the block clears, and HOLDS
(never re-stamps) it while that Project's read is still pending, because
pending is unknown, not clear.

### What prevents the sixth

- `session-status.test.ts` → "a producer declares its scope (BUG-026)": the
  scope algebra, the unknown answer, and three `@ts-expect-error` lines that
  fail type-check if a scoped producer is ever admitted to the fleet merge or
  a partial view is handed to a painting/navigating surface.
- `attention-scope-pipeline.test.ts`: the cross-module contract, written in
  the shape of `turn-truth-pipeline.test.ts` because the same lesson applies —
  every unit passed while the product lied, so this one wires the real fleet
  producer to the real eligibility rule over two Projects and asserts that
  where the operator stands changes what he is looking at, never what is true.
- `use-fleet-roadmap-attention.test.tsx`: every open Project is read, the
  watcher is owned and released, a focus refresh over an unchanged roadmap
  produces no new parse and no new state object, and `since` survives a
  Project switch.

Verification: `pnpm type-check` and the full `pnpm test:run` (2628 passing).

## BUG-025: a forgotten Session frees its memory — FIXED 2026-08-16

**Main had two identity spaces and one lifecycle hook.** The hook was bound to
the wrong one, so nothing keyed by a durable Session id was ever released.

### The defect

`PtySessionManager` emits `exit` when a PTY process dies. `ContextSummarizer`
subscribed to it and `dropRuntime` deleted exactly three maps — `inputBuffers`,
`inputVersions`, `checkpoints` — all keyed by the **PTY id**. That is correct:
those describe one live process.

Everything else the summarizer holds is keyed by the **durable Session id**:
`summaries`, `summarySources`, `initialInstructions`, `instructions`,
`labelVersions`, `labelFailures`, `goalVisuals`, plus the pending/in-flight/retry
sets that shadow them. A PTY exit is not a Session ending — a Session outlives
many PTYs and can be forgotten long after its last one died — so `exit` could
not bound any of them, and **no other event existed to try**. `deleteSession`
and `purgeHistory` deleted history and identity from disk and told no
subscriber. Seven stores with an add site and no delete site anywhere in the
repository.

The operator's exposure is the goal visual. Each is a ~265 KB JPEG carried as a
base64 data URL. He runs 8–10 Sessions concurrently, passes through roughly 100
in a long run, and leaves the app running for days; closing a tab, archiving it,
or letting the 14-day closed-session ledger reap it deleted the Session's files
and left the picture resident in main, unreachable from any surface.

### Why the delete site did not exist

Not an oversight at seven call sites — there was nowhere to put one. The
question "has this Session ended?" had no answer in main. `forgetExited` came
closest, and it already released the Session-keyed `ScrollbackStore` entry, but
it was a private detail of two IPC handlers rather than an announced fact, and
it returned early when this process had never run a PTY for the Session at all.
That early return is the rehydrated-tab case: main holds a restored label and a
restored 265 KB goal visual for a tab it has never launched, and closing that
tab freed nothing.

### The contract now

`PtySessionManager` emits **`session-forgotten <durableSessionId>`**: main no
longer holds a runtime record for this Session, so every store keyed by it must
release its slice. It fires from `forgetExited` (close and archive), `kill`,
`deleteSession`, and `purgeHistory` (the ledger reap), and it fires whether or
not this process ever ran a PTY for the Session. It deliberately does not fire
from `stopAll`, which parks running Sessions for rehydration on the next launch:
parked is remembered, not forgotten. A live Session is never announced — both
`forgetExited` and `purgeHistory` keep their non-exited guard.

`electron/main/pty/session-scoped-state.ts` is the subscriber side, and the part
that makes the class of defect hard to repeat. `SessionScopedState` hands out
`SessionScopedMap` / `SessionScopedSet` — `Map` and `Set` subclasses, so not one
read or write site in the summarizer changed — and `bind()` subscribes the whole
owner to the event once. Declaring a Session-keyed store is what frees it; there
is no per-map delete site to forget, and an eighth store added years from now is
released on the day it is written. Values that own a resource (the two retry
timers) pass a disposer, so release clears them instead of orphaning them.

`context-summarizer.test.ts` pins it generically: after the event, it reflects
over every own property of the summarizer and fails for ANY `Map` or `Set` that
still contains the forgotten Session id. Reverting one field to a bare
`new Map<string, GoalVisual>()` fails two tests. `session-forgotten.test.ts`
proves the manager half on the REAL manager (with `node-pty` mocked, since its
native binding is built for Electron's ABI): every forget boundary announces
once, a running Session never does, and a real summarizer attached to a real
manager loses its goal visual when the close path runs.

### Use-after-free, checked rather than assumed

A hosted label or image call in flight when the Session is forgotten must not
re-add it. Three of the four paths were already safe by construction: the label
success path compares against `labelVersions`, and both goal-visual paths
compare against the stored `revision`, all of which release has dropped. Only
the label FAILURE path re-added pending state and armed a retry timer
unconditionally; it now returns when `labelVersions` has no entry for the
Session. Both cases are tested.

### No operator data moves earlier

Releasing memory deletes nothing persisted. `SessionHistoryStore`,
`SessionIdentityStore` and the closed-session ledger are untouched, and every
existing guard against purging a live Session stands, so a Session is exactly as
resumable after this change as before and the ledger reap remains the app's only
destroyer of Session data. A reopened Session's goal subtitle returns from its
ledger entry through `pty:create`'s `restoredSubtitle`, as it already did.

One honest behaviour change: a Session archived and reopened **within the same
process** no longer finds its generated goal visual still sitting in main, so it
shows the deterministic fallback until the next accepted label regenerates it.
That is already what happens across an app restart today, because an archived
tab leaves the layout that persists the image. The alternative — keeping a
265 KB JPEG per archived Session resident, or writing it into the ledger JSON —
is the defect.

### The rest of main

Audited, and nothing else was stranded by the missing event. `attention-monitor`,
`delegation-monitor`, the harness event channel, and the native-notification map
are PTY-keyed and already released on `exit`. `ScrollbackStore`,
`SessionHistoryStore` and `SessionIdentityStore` are Session-keyed and were
already deleted at these same boundaries. `SessionHistoryStore.deleted` grows
without bound, but it is a tombstone set of id strings that defeats in-flight
writes after a delete — kilobytes, and load-bearing.

The RENDERER holds an exact mirror of this defect that is not fixed here:
`src/components/workspace/use-workspace-state.ts` keeps `summaries`,
`goalVisuals`, `engaged` and `observedIdentitiesRef` with add sites and no
delete sites, and neither `closeTab` nor `removeTabFromLayout` touches them.
BUG-031 landed while this was in flight and moved the goal-visual PIXELS out of
the persisted layout into main's content-addressed side store; the renderer's
in-memory `goalVisuals` record still only grows, so the mirror is smaller but
not gone. Concurrent work owns that file. The event stays main-internal for now: the
renderer is the INITIATOR of close and archive, so it knows synchronously with
its own layout removal, and a broadcast back would be a second, later source of
truth for a fact it already has. If the renderer ever needs the reap's forget
(which it does not initiate), `pty:session-forgotten` is one broadcast on the
same emit.

### Evidence

`scripts/session-lifecycle-leak-probe.mjs` drives the compiled main summarizer
through 100 opened-then-closed Sessions and reports retained heap after forced
GC. Same probe, same machine, against `origin/master`'s compiled tree and then
this one:

| | retained after close | released by closing | forgotten Sessions main can still describe |
| --- | --- | --- | --- |
| before | 26.11 MB | 0.00 MB | 100 labels, 100 goal visuals |
| after | 0.45 MB | 25.65 MB | 0 labels, 0 goal visuals |

`session-forgotten.test.ts` also proves the operator's data does not move:
after a close, the Session's retained history is still readable and it stays
resumable; only `purgeHistory` — the ledger reap — empties it.

`pnpm type-check`; `pnpm lint`; `pnpm electron:compile`; `pnpm test:run` 2684
passing (`electron/main/settings-store.test.ts` failed once on a concurrent
Electron binary install race — `File exists (os error 17)` from another
worktree — and passes in isolation). Against this worktree's dev server:
`eval:workspace:paused` green. `eval:electron:lifecycle` and
`eval:electron:resume` were NOT run: both launch a PACKAGED
`release/mac-arm64/Exawatt.app` rather than the dev harness, and
`eval:electron:lifecycle` is separately baselined red on master for BUG-014's
documented reason under another agent's ownership, so a build would have bought
a red that says nothing about this change. The close/archive/kill/reap paths it
covers are exercised instead on the real `PtySessionManager` in
`session-forgotten.test.ts`.
## D59: the last two pointer-only verbs — landed 2026-08-16 (finishes D57)

**Both strip-menu-only verbs now reach the palette and the native menu.** D57
audited all 27 verbs and named the two it could not carry rather than letting
them go silently absent. `Reveal in Finder` and `Close project` reached NO
command surface at all: no `⌘K` row, no rebindable binding, no menu item, and
one Project-strip context menu as their entire discoverability. That is the
exact shape of the defect the manifest exists to forbid, so leaving it left the
contract half-applied.

D57's stated reason for stopping was real and is now void: both verbs need a
workspace event plus a handler in `workspace-client`, whose gate
`eval:workspace:chrome` was quarantined at the time, and that agent declined to
ship behind a red gate. No entry in `SURFACE_GATES` carried a `quarantined`
value any more, and the gate runs green on this tree.

### What each verb reaches now

Both are declared once in `COMMAND_VERBS` and every surface derives:

- **Reveal in Finder** — File-menu item, `⌘K` row (`ws-reveal`), availability
  key `reveal-path`. It reveals the selected Session's own working directory
  when there is one, because a Session's cwd is not always its Project root,
  and falls back to the Project directory otherwise. That is the same
  active-target rule `⌘W` already uses.
- **Close the active Project** — File-menu item `Close Project` beside
  `Open Project…`, `⌘K` row (`ws-close-project`), availability key
  `close-project`.

### The two legs that are deliberately `null`

Neither verb takes a chord, and the manifest's union turned that into a written
answer instead of a silence.

R is spent four times over: Electron's own `reload`/`forceReload` roles register
`⌘R` and `⌘⇧R` natively, so the renderer never sees them, and `⌘⌥R`/`⌘⌥⇧R` are
the relaunch-recovery family. A detour out of the app into Finder does not
outrank the verbs that would spend the last single-modifier combos.

`Close the active Project` is the more interesting refusal. `⌘⇧W` is the obvious
binding and it is available in the sense that nothing explicitly holds it — but
`use-workspace-shortcuts.ts` answers it as `⌘W`'s shift ALIAS for closing one
Session. Binding the Project close there would put an irreversible multi-Agent
close one shift away from a single-tab close, and it would have won, because
explicit bindings are matched before aliases. The confirmation dialog is a last
line, not a licence to sit under the operator's thumb. Its home is the File
menu, which is where the Project noun already lives.

### Destructive semantics fall out rather than being re-implemented

`Close project` with live tabs is destructive, and the verb does not carry its
own close path. It dispatches `CLOSE_ACTIVE_PROJECT_EVENT`, and
`workspace-client` routes it into the SAME `requestProjectClose` the strip menu
calls, which already raises `CloseProjectConfirm` with the per-tab turn counts
(FIX-011). The confirmation is therefore a property of the ACT, not of the entry
point that reached it, and no entry point can make an Agent lose its turn
silently. `onRevealPath` was an inline lambda on the `TabStrip` call site; it is
now the named `revealPath` callback both the strip and the verb use, so there is
one path to Finder.

### Two contracts widened, because the new verbs did not fit the old ones

**`tenantScope` was too narrow.** It read "verbs that LAUNCH into the personal
workspace", and the comment beside `LIVE_WORKSPACE_MENU_COMMANDS` explained why
the other workspace verbs ride the availability snapshot instead: the Demo shell
publishes its own per-tenant truth and implements those verbs itself. That
reasoning does not extend to these two. The Demo shell publishes a Project name,
so `hasProject` is true there, but it implements neither verb and its Projects
have no directory on disk — availability would have said "available" about a
verb that does nothing. The family is now "verbs that reach personal-workspace
TRUTH", which covers both a PTY and a real path, and the Demo client needed no
change.

**`menu.section` was declared by every verb and read by NOTHING.** The template
hand-places `verb('id')` calls, so a verb could declare `section: 'file'`, be
rendered into the Session menu, and pass every assertion — `flattenMenu()`
flattened all menus into one list. That is D44's own disease one rung down: a
declaration with no surface answering for it, which is how these verbs got lost
in the first place. `command-verbs.contract.test.ts` now tags each row with the
top-level menu it was actually built into and joins it to the declaration, and
`MENU_LABEL_BY_SECTION` is a TOTAL `Record<CommandVerbMenuSection, string>`, so
a new section cannot compile until it says which menu publishes it.

### Evidence

`pnpm type-check`; `pnpm test:run` 2759 passed / 1 skipped;
`command-verbs.contract.test.ts` 23 assertions. Against this worktree's dev
server on 7043: `eval:workspace:chrome` PASS at all six widths.

Mutation-verified, three ways:

| Mutation | Result |
| --- | --- |
| delete the whole `workspace-reveal-path` verb from the manifest | suite fails at import: `Unknown command verb: workspace-reveal-path` |
| keep the verb, delete only its File-menu placement | 3 failed / 20 passed, first at `expected undefined to be defined` |
| keep both legs, render Reveal into the Session menu | 1 failed: `expected 'session' to be 'file'` |

`eval:navigation:spine` is NOT green, and not because of this change. It is red
at one check on `origin/master` itself — `cmd+] goes forward to /settings`,
reproduced 4/4 including on a pristine `ff662b2` worktree with the change
stashed, 53 PASS / 1 FAIL. All six menu checks pass on both trees, including the
ones D57 added. Recorded as BUG-035 with the diagnosis, and the gate is
quarantined against that id rather than waived per landing, so the spine surface
keeps owing evidence and the debt is announced on every future menu change
instead of being rediscovered.

**Corrected 2026-08-16 by BUG-035's repair:** the defect was real but it is a
RACE, not a deterministic failure of that tree. It ran 4/4 green on a worktree
cut from `origin/master` and 1/3 red on a `ff662b2` checkout. 4/4 red here was
the machine, not the commit. See the BUG-035 section below.

## BUG-037: the renderer forgets a Session too — FIXED 2026-08-16

**The layout is the renderer's forget signal.** BUG-025 gave main a
`session-forgotten` event; the renderer needed no event at all, because it
already knows which Sessions exist and had simply never asked itself.

### The defect

`use-workspace-state.ts` holds seven stores keyed by a Session identity. Two are
keyed by the **durable Session id** — `summaries` and `goalVisuals` — and one
more, `observedIdentitiesRef`, keys provider identity by it. Four are keyed by
the **PTY incarnation id**: `attention`, `activity`, `engaged`, `delegation`.
Every one of them had an add site and no delete site. `closeTab` and
`removeTabFromLayout` touch none of them.

The audit that opened this named four. Reading the file fresh found seven, and
the PTY-keyed ones are the worse half over a long run: `tab.sessionId` changes on
every RESUME, so a single Session the operator keeps alive for days mints a
permanent `engaged[...] = true` per incarnation. A durable-Session-keyed event —
the shape main shipped — could never have reached those.

The operator's exposure is the same 265 KB goal-visual JPEG as in main, held a
second time in the renderer. He runs 8–10 Sessions concurrently, passes through
roughly 100 in a long run, and leaves the window open for days. BUG-031 moved
those pixels out of the PERSISTED layout into a content-addressed side store; the
renderer still holds the resolved `dataUrl` in `goalVisuals` for as long as the
window lives, so that landing shrank the leak on disk and left this one intact.

### Why the delete site did not exist

Same structural cause as main's, in a different vocabulary. There is no "this
Session is forgotten" moment in the renderer either — only tab removal, which is
a LAYOUT operation. Several verbs perform it (⌘W on a draft, ⌘W on an unstarted
live Session, ⌘W on a started one, launching into a draft tab, reopening into
one), and none of them owns Session-scoped memory. Adding four `delete` calls to
`closeTab` would have fixed today's four stores at four call sites and left the
next store, and the next removal path, exactly as exposed.

### The contract now

`session-scoped-state.ts` is one owner. Session-keyed state is DECLARED through
it — `useSessionScopedRecord` for the React-state records,
`useSessionScopedMap` / `useSessionScopedIdSet` for the two refs — and
`useSessionScopeRelease` releases every registered store at one moment. A store
is released because it exists, not because its author remembered.

Main's `Map`/`Set` subclasses were considered and rejected. They work in main
precisely because main's stores are mutable and read directly; renderer stores
live in `useState`, where a render is driven by IDENTITY CHANGE, so a subclass
mutated by an event listener would free the bytes and repaint nothing. What
transfers is the IDEA — one declaration point, one release point — not the
mechanism. The owner keeps every store as ordinary immutable React state and
moves only the lifecycle.

The release moment is DERIVED, not announced:

> An identity the layout has stopped naming is released.

That is sound because the layout is the renderer's authority on which Sessions
exist. Every reader of every one of these stores dereferences through a tab —
`summaries[tab.durableSessionId]`, `engaged[tab.sessionId]` — so an identity no
tab names is unreachable by construction. Two properties follow that a
per-call-site `forgetSession(id)` cannot have:

- **Total.** Any removal path, including one written next year, releases,
  because the rule is about the layout rather than about the call site.
- **Both identity spaces.** A superseded PTY id leaves the layout the moment
  `pty:exit` nulls `tab.sessionId`, so the per-resume half of the leak is
  bounded by the same rule that bounds the per-Session half.

It releases only identities the layout NAMED and then LOST — never every unnamed
key — because Session-scoped state legitimately arrives before React has
committed the tab it belongs to. That race is the entire reason
`observedIdentitiesRef` exists, and a full reconcile against the layout would
have destroyed the thing it was written to protect. A late broadcast that re-adds
an already-released identity is swept on the following layout commit, which is
what `pendingRef` in `useSessionScopeRelease` is for.

### The forget does not cross IPC — and BUG-025's stated exception does not hold

BUG-025 shipped `session-forgotten` in main and argued it should not be
broadcast, because the renderer initiates close and archive and therefore knows
synchronously; it flagged the ledger reap as the one forget the renderer does not
initiate, and offered `pty:session-forgotten` on the same emit if needed.

Evaluated from this side, the conclusion holds and the exception does not.

- The **reap cannot strand renderer state**. `ClosedSessionLedger.reap()` only
  purges ARCHIVED entries, and a Session is archived only after `closeTab` has
  already removed its tab. The identity was released at close, fourteen days
  before the reap runs.
- `pty:kill` and `pty:delete-session` are renderer-initiated.
- The stronger reason, which BUG-025 could not see from main: a broadcast would
  be strictly **weaker** than what shipped. It carries a durable Session id, so a
  subscriber could release `summaries` and `goalVisuals` and could not release a
  superseded PTY id — the half of the leak that grows per resume.

No `pty:session-forgotten` channel is added. If a future renderer store is keyed
by something the layout does not name, that is the moment to revisit this, and
the reason to revisit it will be the store's shape, not the reap.

### Pinned by reflection, not by a list

`session-scope.test.tsx` has two guards, because the two kinds of store fail
differently.

1. **Residue.** Drive a Session through every store, close its tab, then walk
   EVERY own value the hook returns and fail if any of them still names the
   forgotten Session or its PTY id. A store added to the return value tomorrow is
   swept without editing the test.
2. **Declaration.** Reflect over the module SOURCE and fail any
   `useState<Record<string, …>>` or `Map` ref declared in the hook body outside
   the owner. Runtime reflection cannot see a store the hook never returns, and
   `observedIdentitiesRef` leaked for exactly that reason.

Mutation-verified:

| Mutation | Result |
| --- | --- |
| the whole pre-fix file | 6 failed / 1 passed |
| revert `summaries` to a bare `useState<Record<string, string>>` | 3 failed — residue sweep, late-broadcast sweep, and the declaration guard |
| revert `observedIdentitiesRef` to a bare `useRef(new Map())` | 1 failed — the declaration guard alone |

The one test that passes on the pre-fix file is the no-regression guard: ⌘W then
⌘⇧T still restores the goal.

### Measurement

`scripts/renderer-session-lifecycle-leak-probe.mjs`, the sibling of main's probe.
It bundles the renderer module graph with esbuild, renders the REAL
`useWorkspaceState` under React 19 into a jsdom document, and drives it through a
stubbed `window.electron` that plays main's actual broadcast stream — so the
numbers describe shipped code, not a re-implementation. Baseline is a MOUNTED,
ready workspace holding no Sessions, so every byte measured belongs to Sessions
rather than to React or jsdom.

`node --expose-gc scripts/renderer-session-lifecycle-leak-probe.mjs --fleet 100`,
100 Sessions launched and then closed:

| | before | after |
| --- | --- | --- |
| retained after close | 26.66 MB | **1.23 MB** |
| released by closing | −0.24 MB | **25.22 MB** |
| forgotten Sessions still describable | 100 goals / 100 goal visuals / 100 PTY-scoped flags | **0 / 0 / 0** |

One measurement note worth keeping: the probe's stand-in payload must be UNIQUE
and incompressible per Session, like the JPEG it represents. An earlier version
reused main's `'YWJj'.repeat(n)` filler and reported a 0.64 MB delta for 27 MB of
characters — V8 stores that pattern in a fraction of the space, which understated
the leak by two orders of magnitude and would have made the fix look unnecessary.

### Nothing is lost, nothing on disk goes earlier

- `closeTab` reads the goal BEFORE the optimistic strip removal and archives it,
  so ⌘W then ⌘⇧T restores the same subtitle from the ledger entry. Regression
  test.
- `serializeWorkspace` only ever reads Sessions the layout still names, so the
  persisted layout is byte-identical.
- Resume preserves `durableSessionId` (it is passed straight to `pty.create`), so
  releasing a superseded PTY id cannot make a Session unresumable. Regression
  test.
- Releasing a PTY-keyed slice at exit is invisible by construction: every reader
  reaches it through `tab.sessionId`, which `pty:exit` has already nulled.
- Nothing in main changed. No IPC surface changed.

### Verification

`pnpm type-check`; `pnpm test:run`; `pnpm eslint` clean on all three touched
files (the nine new `react-hooks/exhaustive-deps` warnings the owner's stable
refs introduced are resolved by naming them, not suppressed). No surface gate is
owed — `missingSurfaceGates` and `quarantinedSurfaceGates` both return empty for
this change set, because `use-workspace-state.ts` belongs to no gated surface.

## D60: the evals drive the product through one contract — repaired 2026-08-16 (BUG-014)

**Deleted the dead launcher row nine evals were still driving, and gave them
one shared driver so the next launcher change breaks once instead of rotting
nine scripts.** BUG-014 closes; BUG-038, BUG-039 and BUG-040 are what was
hiding behind it.

### The dead UI was the cause, not the symptom

D49 replaced the composer's second control row with the setup drawer and the
"All engines and models" catalog. It did not DELETE the old row: it left it in
the DOM behind `hidden={!customizeOpen}`, and `customizeOpen` was initialised
`false` and only ever set `false` again. So for two months the app carried a
complete pre-D49 control surface — Agent Source, Agent model, Agent effort,
Agent permissions, the "Agent launch options" popover, "Optional name", the
`Shapes` link — that no production interaction could reach and that only
automation could still touch.

That is precisely why the contract drifted silently. `getByLabel('Agent
Source')` kept RESOLVING. Playwright then failed twenty-five seconds later on
visibility, far from the cause, in nine different scripts, none of which
anything routed to. The same held one layer in: four
`launch-controls.*.test.tsx` suites asserted against that row and passed,
because jsdom does not care that an element is `hidden`.

607 lines leave `launch-controls.tsx`, and `ModelPicker` (562 lines plus its
265-line test) goes with them — that row was its last consumer, and decision
`0033` already made `OptionMenu` the one menu primitive.

### Both halves of the repair, because the 2026-08-13 narrowing was right

The narrowing said the repair was either the setup-card contract or a fixture
that answers the model-catalog probe, and not a selector swap. It was both.

**One driving contract.** `scripts/lib/electron-eval.mjs` now owns how an eval
drives this surface: `summonComposer`, `openLaunchCatalog`,
`openShellFromLauncher`, `declareRoadmapItem`, `openSetupDrawer`,
`waitForLauncherToSettle`, `launcherAxis`, `launcherAxisValue`,
`chooseLauncherAxis`, `selectLauncherEngine`, `selectedLauncherSetup`,
`startAgentFromLauncher`. Engine choice goes through the setup drawer, which —
unlike the catalog — lists every launchable source whether or not it publishes
a model, so it can select Codex where the catalog provably cannot.
`summonComposer` matches the composer's own hook rather than the name "New
Agent", which also matches a TAB called "New agent" and that tab's close
button: three ways ambiguous the moment a draft exists.
`startAgentFromLauncher` reports the launcher's STATED blocked reason instead
of letting a refusal arrive as a bare disabled-button timeout. The unit tests
got the same treatment in `launch-controls.test-support.tsx`.

**One set of probe answers.** `scripts/lib/harness-probe-fixture.mjs` holds
what every fake harness owes the product: version, auth status, and the model
catalog. Each eval used to hand-roll those inside its own heredoc, so each
drifted separately. Two failures fall out of that one file. A fixture that
never exits on `--version` leaves the registry probe hanging, the source
unlaunchable, and Start disabled with nothing on screen naming why — that was
`eval:electron:recents`' "Exact-resume Session did not start". A fixture Codex
that answers `codex debug models` with silence publishes NO model, and since
D49 an engine without a model may not start at all — the product refusing
correctly, read as an eval defect for two months. The fixture Codex still
reports no delegation, which is the control the delegation and turn-truth
evals actually need.

### Routing, which is the part that keeps this from recurring

`roadmap-rail-eval.mjs` had no package command at all. Nothing could declare
it, so nothing ever ran it, so its declare-at-launch stage rotted through D49
unnoticed. It is `eval:roadmap:rail` now and gated on `src/components/roadmap/`
and `electron/main/roadmap/`. `eval:electron:project-agent` gates
`launch-controls.tsx` — which no gate covered, even though
`eval:workspace:launcher` gates the launcher COMPONENTS — and gates
`scripts/lib/electron-eval.mjs` and `harness-probe-fixture.mjs` for the same
reason one layer down: changing the shared driver must run something that uses
it.

### What was hiding behind the repaired failure

Three evals now run far past where they used to stop and fail somewhere new.
All three are `quarantined` in `SURFACE_GATES` with the id that repairs them:
BUG-038 (a split-pane draft survives the exact resume that should consume
it, `eval:electron:recents`, which reaches 16 of 17 checks where a fresh
master tree never started the resumed Session at all), BUG-039 (`menu:command
launch-grok` leaves the workspace with no composer at all,
`eval:electron:agent-sources`, which reaches 30 checks where fresh master
stopped at 20), and BUG-040 (the roadmap rail stops recognising a Project with
no live items, `eval:roadmap:rail`). None is launcher drift, and none could be
seen while the launcher drift was in front of it.

One more thing the routing found the moment it existed: FIX-002 landed the
same day and made the pointer claim a Team tile by MOVING, so a teleporting
`page.hover()` is no longer a claim. `roadmap-rail-eval`'s selection-scoping
stage now models a pointer that moves — enter, leave, enter at a different
point. Nothing would have noticed, because that eval had no command.

### Environmental

`withElectronApp` gained the mirror of BUG-016's packaging-snapshot check: a
dev launch asserts the compiled main EXISTS before launching. Its absence
produced a bare `Process failed to launch!` that named nothing and cost more
than one agent a hunt. `AGENTS.md` gained two rules this session paid for
directly. The first is the dangerous one: **never `git stash` in an agent
worktree.** The stash stack lives in the COMMON git directory, so it is shared
by every worktree of the checkout — a `git stash pop` here popped a different
session's entry (`agent/oss-wp5a-ci`) into this tree with conflicts. Nothing
was lost (the entry survives; the foreign files were reverted by name and
`drop`/`clear` were never run), but resolving those conflicts and committing
would have landed another agent's half-finished work under this commit. The
second: run `pnpm install` after any rebase before believing a floor failure,
because a landing that adds a dependency makes every older worktree's
`node_modules` incomplete and the `ERR_MODULE_NOT_FOUND` surfaces inside an
unrelated floor check.

### Evidence

Every claim below is paired: state on a worktree cut FRESH from
`origin/master` at the time of the claim, and state on this tree. A baseline
taken from one's own long-running checkout is not a claim about master —
`agent:land` rebases at the end, so a session tests a tree that ages the whole
time it runs, and stashing to get a baseline gives you your own aging checkout
minus your diff, which is not master either.

Green against this worktree's own dev server: `eval:electron:delegation`
(fresh master: red at `getByLabel('Agent Source')`, resolved to the disabled
invisible Select) and `eval:electron:turn-truth` (same). `eval:roadmap:rail`
(fresh master: red at `getByLabel('Agent launch options')`, three stages
earlier) now runs 39 of 42 green, including every declare-at-launch stage and
the selection-scoping stage FIX-002 changed the same day. Its three remaining
failures are the product's, not the eval's, and the proof is the eval itself:
copied verbatim into the fresh master worktree and run against that unmodified
product it fails exactly those three and no others. BUG-040 owns them, and the
gate is born quarantined under that id — which is the whole argument for
routing, stated by example. The first run of an eval nothing had ever run
found a live regression in a designed empty state.

Regression controls, green on BOTH trees: `eval:workspace:chrome`,
`eval:electron:tenancy` (48 checks), `eval:electron:project-agent` (93
checks) — the last two were handed to this pass as "pre-existing red on
master" and are not. `pnpm test:run` (2683 passing), `pnpm type-check`.

NOT verifiable here, and not claimed: `eval:electron:lifecycle`,
`eval:electron:idempotency` and `eval:electron:packaged` carry the same repair
but no packaged build boots on this machine at all. A `--mac dir` build from
this tree, from a clean `dist-renderer`, and from a tree rebased onto current
`origin/master` all die identically before the first window with
`Cannot find module …/@swc/helpers/esm/_interop_require_default.js`: Next's
standalone trace ships only the package's `cjs` build. That is BUG-036 and
separately owned. `eval:electron:update` needs a signed baseline `.app` and an
expected update version; `eval:electron:real-harness` needs real signed-in
Claude and Codex CLIs.

## BUG-035: history applies overlap — FIXED 2026-08-16

**⌘] failed because two applies were in flight and only one was remembered.**
Same root cause as BUG-006, same file, one round trip later.

### What was actually happening

`eval:navigation:spine` presses the top-bar Forward control, waits for the URL
to reach `/settings`, and then immediately presses ⌘[. Instrumenting
`nav-history` through a failing run gave the whole sequence:

```
t=4406  forward() → /settings ; beginApply(/settings)     apply #1 in flight
t=4439  ⌘[ arrives ; back() → /workspace ; beginApply(/workspace)
                                                          apply #2 OVERWRITES #1's record
t=4440  visit(/settings)   apply #1's own completion, now unclaimed. Read as an
                           independent navigation; the index walks 0 → 1
t=4517  visit(/workspace)  apply #2's completion. current is /settings, so this
                           truncates and pushes → [W, S, W] index=2
t=6014  ⌘] → forward() → null
```

By the time ⌘] is pressed there is nothing ahead of the index, so `forward()`
correctly returns null. The history had already been rewritten.

### Three readings, two falsified

The brief listed three candidates and the instrumentation settled them:

| Reading | Verdict |
| --- | --- |
| the ⌘] chord never reaches the handler (a competing binding, an alias, a focused element) | **false** — `key:capture M-]/BracketRight` on `BODY`, `forward()` invoked, and the event leaves the bubble phase `defaultPrevented: true`. The verb fired and consumed the key. |
| the handler fires and is refused by D50's "must resolve AND be somewhere else" predicate | **false** — no resolver ever returned false. `forward()` returns null because `index === entries.length - 1`. |
| the workspace remount after ⌘[ truncates the forward stack | **half right, and the half it missed is the cause.** The workspace's arrival IS the truncating push, but only because an orphaned completion had already walked the index forward. Without that orphan, the workspace's `visit` matches the apply in flight and is swallowed. |

The Forward-button-works asymmetry was never about key delivery. The control
runs a beat later — Playwright's actionability and `isDisabled()` checks cost
enough time for the previous apply to land — so it never meets an overlap. Any
operator who clicks Forward and presses ⌘[ in the same breath meets it.

### The fix

`beginApply` tracked one pending apply. It now tracks the SET of applies in
flight, oldest first, and `visit` reads that set:

- a location equal to any apply's target ENDS that apply and retires every
  apply older than it, whose completions can no longer be told apart from a
  real navigation;
- a location that is a partial stage of ANY apply in flight is still a stage;
- anything else is the operator having moved on, and clears the set.

`isApplying` answers for unexpired applies, and the same 4-second TTL bounds
the set — every entry is one back/forward keystroke and expires on its own
clock, so no cap is needed.

D50's diagnosis of the hybrid state was right; what it did not cover was
concurrency. Naming the family properly, so it does not ship a third time:
**a location observed while a history apply is still in flight is never an
entry, and applies overlap.**

### Why no gate caught it

`SURFACE_GATES` declared `eval:navigation:spine` for the menu template, the
command-verb manifest and the shortcut provider — not for `nav-history.ts` or
`command-navigation-provider.tsx`, the two files that own the ⌘[/⌘] contract
this gate is the only thing that exercises against a real router. Both are now
in its match set. That is the hole that let the defect ship; the quarantine is
removed.

### Evidence

`pnpm type-check`; `pnpm test:run`. Two failing-first tests in
`nav-history.test.ts` pin the interleaving; reverting `nav-history.ts` to
`HEAD` fails exactly those two and passes the other sixteen.

Because the defect is a race, rate matters more than a single run. Against this
worktree's dev server, with a probe that forces the interleaving (click
Forward, then ⌘[ without waiting for the URL):

| | `eval:navigation:spine` | forced-interleaving probe |
| --- | --- | --- |
| `ff662b2` | 1/3 red | — |
| `origin/master` before the fix | 0/4 red | 1/4 red |
| after the fix | 0/3 red | 0/10 red |

## D61: three quarantined gates come back — repaired 2026-08-16 (BUG-038, BUG-039, BUG-040)

**Two of the three "product regressions" D60's routing found were the eval
reading COPY where it meant STATE; the third was real twice over.** All three
gates leave quarantine and are enforced. A fourth defect falls out of the same
routing and is recorded, not repaired: BUG-041.

The shared shape is worth stating before the three, because it is D60's disease
one layer down. D60's lesson was that an eval nobody runs reads as coverage.
D61's is that an eval which asserts on rendered copy reads as coverage too, and
fails in a way that accuses the product. Three surfaces rendered identical copy
for two different states — a rail scoped to one Project or another, a tab that
is a draft or a live Session — and offered no way to ask which. So the
evaluator inferred state from words, the inference was wrong, and the report
named the product. In each case the repair is the same shape: the surface
states itself in the DOM, and the assertion reads that instead of the words.

### BUG-040 — the roadmap rail's empty state was never regressed

Driven directly at the same `rail-empty` fixture, in a Project of its own, the
empty state renders `Queue empty`, `View only · adaptation needed` and the
`Adapt with agent` remediation gesture perfectly. The eval was reading a
different Project's rail.

The rail is scoped to the SELECTED tile (S12), and the selection is not the
evaluator's to assume. The empty-queue case exists to prove that an empty
roadmap queue is not an invisible attention target, so it presses ⌘J and
expects to stay in Terminal. It did stay in Terminal — and it also left the
Project, because ⌘J is a FLEET queue (BUG-026) and the eval's own S8 step had
left a painted needs-you Session standing in the healthy fixture a Project
away. `⌘B` then scoped the rail there, and three assertions about the empty
Project's rail were made against the healthy Project's plan.

`starvingJumpStaysTerminal` is the check that should have caught it, and could
not: it asserts that the URL still says Terminal, which is a much weaker claim
than the one its comment makes ("⌘J found nothing to do"). Any behaviour that
keeps the altitude passes it, including a jump to a different Project. The
roadmap's recorded first suspect — the same-day BUG-026 roadmap-attention
rework — was wrong about the lens but right about the neighbourhood: that
rework is precisely why ⌘J had a cross-Project target at all.

The repair is structural on both sides. `roadmap-rail.tsx` publishes
`data-roadmap-project`, because the rail rendered only the Project NAME, which
is enough for a human and useless to anything that has to be sure. Every rail
read in `roadmap-rail-eval.mjs` now goes through a `railText(page, dir)` that
waits for the rail scoped to the Project it is about, so reading the wrong plan
fails loudly and immediately instead of producing three confident falsehoods.
The empty-queue case states the precondition it had been assuming and re-enters
its Project after the fleet jump.

Two further lies fell out of naming the scope. `selectionScopesRail` had been
passing trivially — it moves the pointer onto a healthy tile and asserts the
rail shows `ACME-003`, which was already true because the rail had never left
`healthy`. And the real-repo case asserted against `process.cwd()`, when
`resolveProject` maps a linked worktree onto its MAIN repository through
`--git-common-dir`; an agent worktree's rail is the primary checkout's, so the
eval now asks git the same question the product asks. 42/42.

### BUG-038 — no draft survived the exact resume

The check identified a draft by its rendered copy: any tab whose `aria-label`
starts with `new agent`. `New agent` is the designed FALLBACK IDENTITY for any
Session with no operator title and no context label yet (`sessionDisplayCopy`),
chosen deliberately — "Agent Source already has its glyph, so provider labels
such as `Codex` and `Claude Code` are not useful primary copy". A live,
exact-resumed Claude Code Session therefore wears exactly the label an
unlaunched draft wears.

Instrumenting the run showed the survivor was not a pane's draft at all: it was
the FIRST tab, the one the eval's own Enter-resume had launched twelve checks
earlier, whose label walked `New agent — working` to `New agent — result ready`
while remaining a running Session throughout. The split-pane `⌘D`/`⌘T` framing
in the original report was a red herring; the second tab took its title from
the ledger entry's restored goal and so looked different, which is what made
one of the two stand out.

The tab strip already published identity (`data-tab-id`,
`data-durable-session-id`, `data-tab-harness`); it now publishes
`data-tab-lifecycle` next to it, and the check counts
`[data-tab-id][data-tab-lifecycle="draft"]`. That keeps the check's teeth — a
resume that appended a new tab instead of consuming the draft in place still
fails it — and survives D42 condensation for the same reason the aria-label
did. 17/17.

### BUG-039 — two real product defects, the first well beyond this eval

`menu:command launch-grok` left the workspace with no composer. Probing the
renderer at that instant showed the Project opener open instead, which
`FOCUS_AGENT_COMPOSER_EVENT` does only on its `if (!activeProject)` branch —
with one Project registered, two tabs in it, and `activeDir` set. `activeDir`
was `/private/var/folders/…/project`; the Project group's key was
`/var/folders/…/project`.

`launchAgent`'s reuse branch places the tab in the group that already holds its
draft, found by TAB IDENTITY, and then moved the operator to
`launchedSession.projectDir` — main's view of the working directory. Those are
not the same name for the same place. An exact provider resume launches with
`dir: conversation.cwd`, the directory the provider's own history recorded,
which `conversation-catalog.ts` realpaths; on macOS every `/var`, `/tmp` and
symlinked home path diverges there. `activeDir` then named a key no group had,
`projects.find(g => g.dir === activeDir)` returned null, the ribbon lost its
Project, and the next launch verb opened the Project opener. A launch verb that
silently does nothing is the FIX-012 class, and this one is reachable by any
operator who resumes a native conversation from the recent browser in a Project
under a symlinked path.

The launch now goes to the TAB and asks the layout where it is. The registry
bridge (`syncProjectIdentity`) takes the same landed identity, so a resume can
no longer mint a second registry Project for the realpath of the one on screen.
The residual divergence between main's directory identity and the renderer's
Project key is real and untouched here — `addSession` can still group a
main-adopted Session under the realpath — but nothing on this defect's causal
path depends on it, and canonicalising directory identity across the layout,
the registry and the conversation catalogs is its own change.

Behind that, the eval reached a second defect: the launch carried no `-m`.
`parseGrokModelCatalog` classified a concrete, enumerable model id as
`account-default`. In this vocabulary that value means "the account decides and
Exawatt holds no id to pin", which is exactly why `launchAgent` omits the model
flag for it — correct for Claude's `default` sentinel and for a source-owned
catalog with no id at all. Grok publishes two real models and names one as its
default, so the composer displayed `Eval Grok 4.5` as the SELECTION and then
launched without pinning it, leaving the source free to run something other
than the name on screen. Codex classifies the identical shape as
`harness-recommended`; Grok now matches it, and the one-line change is in the
catalog parser rather than at the launch site, so the launcher's rule keeps
meaning one thing. 40/40, up from 30.

### BUG-041 — recorded, not repaired (superseded by D62, which repaired it)

`eval:electron:lifecycle` was reported red on its first real packaged run since
BUG-036, with `chooseLauncherAxis` timing out on the engine axis. The line
number matters: the timeout is the settle-wait AFTER the option is clicked, not
the wait before it. The drawer opens, the engine is chosen, and then the drawer
closes.

It reproduces in dev, which rules out the first hypothesis: the fixture-probe
contract is not the cause. The identical fixture `HOME`/`PATH` and probe
harnesses drive the setup drawer correctly — Claude Code detected, "Signed in
through Claude Code · max plan", all four axes rendered — so the packaged build
is incidental.

The mechanism is proven with a negative control. From a Project with no tabs,
changing an axis reports a draft intent, `createDraftTab` materialises the tab,
and the workspace swaps `AgentComposer` from the empty-Project render site to
the draft-tab pane render site. They are different subtrees of
`workspace-client`, so React remounts and `AgentLauncher`'s `open` state resets
to its `useState` default. Press ⌘T first, so a draft tab already exists, and
the same engine change leaves the drawer open with all four axes intact.

That is a real operator defect, not an eval artifact — adjusting the first of
four axes in a fresh Project throws you out of the drawer that holds the other
three, every time. It is left to BUG-041 rather than repaired here because
carrying the drawer's open intent across the hand-off is composer architecture
with its own verification, and three landed repairs beat four half-landed ones.
`eval:electron:lifecycle` and `eval:electron:idempotency` enter `SURFACE_GATES`
quarantined against it — the first time either has been routed to a surface at
all, which is the BUG-010/011/014 disease showing up once more.

One nearby change was written, disproved and reverted rather than landed:
`AgentLauncher`'s `useEffect(() => { if (state !== 'ready') setOpen(false) })`
destroys the operator's intent on any transient readiness dip, while
`SetupDetailPanel` already renders `open && ready`. Separating intent from what
it may draw is probably right, but the negative control proves it is off this
defect's causal path, and the repo's own rule is to build nothing when the
mechanism does not sit on the path of the failure that justifies it.

## D62: one composer, one identity — repaired 2026-08-16 (BUG-041)

**The remount was the defect, so neither candidate repair was taken.**

D61 recorded BUG-041 and left it: from a Project with no tabs, opening the
launcher's setup drawer and changing the Engine axis closed the drawer, before
the operator could reach the model, thinking or permission axes it exists to
hold. The operator asked for this one directly — "fix that, it feels really
buggy" — and it sits on his daily path.

### Watched failing first

The mechanism D61 proved was re-proven before anything was written, by driving
the real gesture in a dev Electron app and sampling the drawer's `data-open`
flag every animation frame across the click. It flipped `open → shut` nine
frames after the option was chosen, once per run, deterministically. The same
trace also caught what the prose had not: the composer's top edge moved 129px
→ 170px in the same moment.

### Why neither shape on the roadmap was the answer

The roadmap named two: carry the drawer's open intent across the hand-off as
transient draft state, or create the draft tab before the first axis can be
touched. Both accept the remount and manage its consequences, and the
consequences are not only the drawer. A remount also throws away the settled
Agent Source registry, every per-source model catalog, the task caret, and the
focus — the composer's mount effect then yanks focus back to the task field, so
even carrying `open` across would have left the operator's keyboard somewhere
they did not put it. Creating the tab earlier only moves the tear-down to
another gesture: doing it when the drawer OPENS closes the drawer at open time,
and doing it when the Project becomes empty destroys the designed transient
empty Project (`useProjectCloseLifecycle`, the dormancy tail, `⌘W`'s "Close Tab
or Empty Project", and the Sessions altitude's zero-Session tile).

So the remount is removed instead. `resolveComposerSlot` in `split-layout.ts`
resolves the empty-Project stage and the draft tab's pane to ONE slot: one
element, one position, one key. React reconciles it in place, and nothing has
to be carried across a hand-off that no longer tears anything down.

The identity is the load-bearing half, and it has to end somewhere or the fix
introduces its own bug. It ends exactly where the draft does: `closeTab`'s
draft branch bumps `draftDiscards`, which is in the slot's key, so the composer
that replaces a thrown-away draft is a NEW one and cannot inherit its task or
its setup. A Project switch changes the key too; the composer's existing
`[projectDir]` reset effect already agreed with that.

`draftDiscards` is a count rather than a Record keyed by Project on purpose,
and the suite said so: `session-scope.test.tsx` asserts that
`useWorkspaceState` declares no `Record<string, …>` of its own, because every
one it has ever held is keyed by a Session identity and must come from
`useSessionScopedRecord` (BUG-037). A per-Project key would have bought
precision nothing can observe — only the active Project's composer is mounted,
and a draft can only be closed from the Project it belongs to — at the cost of
making that invariant false. The guard was right; the first draft of this fix
was not.

### Every sibling path through the same hand-off

Driven in the real app, all now intact: a non-Engine axis first (Model also
reports a draft intent; Permission notably does not — it persists as a
Project+engine preference and never materialises a tab), typing the task first
(every keystroke and the caret survive, where the remount used to lose focus
for a frame and drop the caret to the end), ⌘K's launch-configuration rows, and
the native `New Agent` menu item. The last two already created the tab before
the composer rendered, so they were never on the defect's path, but they are
now proven rather than assumed.

The frame trace after the repair: zero `data-open` flips, engine reads Codex,
composer top constant.

### What is still off the causal path, now demonstrably

`AgentLauncher`'s `useEffect(() => { if (state !== 'ready') setOpen(false) })`
is untouched, and D61's judgement holds with a stronger proof than "reverted
unproven": with the remount gone the drawer survives the hand-off without that
effect changing at all. `launcherSettled` is computed from the per-source
catalog CACHE (`catalogsBySource`), not from the live `modelCatalog` that
`selectSource` clears, so choosing an engine never dips readiness in the first
place. Building against it would still be building off the path of the failure.

### The residual, measured and left for a design pass

The composer still drops 37px when the tab materialises, because
`data-active-session-context` renders only with an active tab. Nothing is lost
with it — no flicker, no state, no scroll jump — and it is one frame of legible
chrome growth, not the surface glitching.

Suppressing that row for a draft was written and reverted. The case for it is
real: a draft has no Session to describe, so the row carries no goal, no
roadmap chip (chips need a live `sessionId`), a path the Project already is,
and a Focus-terminal button with no terminal to focus. The case against taking
it here is stronger: it is a design change to a shipped surface (⌘T's new-tab
page has always shown it), and `eval:workspace:chrome` measures that row's type
scale standing on exactly that draft across six viewports. Changing the product
to taste and then editing the gate to fit is the wrong order. Recorded in
BUG-041 and in a comment at the render site.

### Two eval repairs, both a step further out than the product defect

Both quarantined gates now run, which took repairing the evals themselves —
each diagnosed against the running app, not assumed:

- `harness-probe-fixture.mjs` is the single owner of "what a fixture harness
  owes the product", and it did not answer two probes the product makes:
  `claude --safe-mode --input-format stream-json … -p` (the SDK `initialize`
  catalog request) and `codex app-server --stdio`. `--safe-mode` is `$1`, so
  each probe fell straight through into the fixture's LAUNCH behaviour, wrote a
  pid file, and blocked on stdin until the product's 20s deadline killed it.
  `eval:electron:lifecycle` then read that pid directory as "the Sessions" and
  reported five dead processes after a CANCELLED quit that had in fact left all
  five Sessions running. Proven by dumping each invocation's argv beside its
  pid: five `claude --safe-mode …` and two `codex app-server --stdio`, all
  dead, every real Session alive. This is exactly the drift that file exists to
  end, one probe deeper than the `--version` case its own header describes.
- Two assertions were written against a product that has since changed on
  purpose. The lifecycle eval waited 25s for `Retained history unavailable`,
  copy replaced by the paused-Agent RECORD (BUG-013, incident `0008`); it now
  clicks `Show transcript` and reads `Saved history could not be read.`. The
  idempotency eval's final step called `pty.retainedHistory`, which the
  renderer deliberately does not have — megabytes never cross IPC — and now
  reads `pty.retainedTranscript`.

Neither repair loosened an assertion. The lifecycle gate is green end to end
(cancel, quit, corrupt history, restore, resume, crash, non-workspace quit) and
the idempotency gate passes three generations.

`workspace-client.tsx` joins `eval:electron:lifecycle`'s match list for the
reason BUG-035 put `nav-history.ts` on the spine gate: the file that actually
broke was not named in the map, so the change that broke it never had to run
the eval that catches it. The composer's render site is part of "the only way
to start a Session", whichever component the launcher itself lives in.

### Regression coverage at the level the defect lives

`resolveComposerSlot` is pure and unit-tested, the `tab-ring.ts` pattern. The
load-bearing test asserts the slot's identity is UNCHANGED across the moment
the draft tab appears, and changed after a discard — so a reintroduced remount
fails as an identity change, not as a downstream symptom. Negative control run:
keying the slot on the tab id fails three of them. A DOM test in
`launch-controls.interactions.test.tsx` covers the composer's half — the drawer
and the chosen axis survive an in-place hand-off — so a future effect that
resets on `initialSource` arriving cannot quietly close the drawer again.

---

## D63: a dialog's primary action owes a chord and a hint — 2026-08-17 (BUG-049, and D62's residual)

**Two felt-quality items on the operator's daily path, both landed.** The
Submit feedback dialog can be sent from the keyboard and says how; the composer
no longer moves when the draft tab appears.

### The report, and which surface it was about

Through ⌘⇧F quick capture, 2026-08-17: *"I like this new submit feedback form.
However the keyboard discoverability should be a lot better. For example how
can I send feedback using the keyboard? Maybe it should be like Command Enter
and that should be a clear hint on the form somewhere."*

The product has two feedback surfaces and only one of them was broken. The ⌘⇧F
capture BAR already sends on ⏎, already refuses ⇧⏎, and already prints `↩ send`
in its chip row — it was built keyboard-first (ENG-025 F1). The `Submit
feedback` DIALOG, reached from the Help menu, is the form: a Type select, a
labelled textarea that takes focus on open, a screenshot control, and Cancel /
Send feedback buttons. Its Send was reachable with the mouse and nothing else,
and it advertised nothing. `Edit Shortcut` in Settings had the identical gap:
Save, mouse-only, unadvertised. Checking which surface the words describe was
worth the minute it took; fixing the bar would have fixed nothing.

### Why this is the D44 contract one layer in, not a ⌘⏎ handler

D44 and D57 made every verb the product OFFERS discoverable by construction:
one manifest entry owes a rebindable chord, a palette row and a native menu
item, and an omission has to be written down. A dialog's primary action is such
a verb. It was simply a class the manifest never reached, so each dialog was
free to have no keyboard path and nothing could notice — the same defect shape
as Resume shipping without a menu item.

A ⌘⏎ keydown on the feedback form would have been the monkey-patch, and the
next dialog would have shipped without one. What landed instead:

- **`dialog-primary-action` is a manifest verb.** ⌘⏎, rebindable, `category:
  actions`, `contexts: ['modal-open']`, `bindingPolicy: 'universal-command'`.
  `modal-open` had been in the context union since it was written and no verb
  had ever declared it; this is its first. The binding policy is load-bearing
  rather than decorative: `shouldIgnoreShortcutEvent` lets a combo through a
  focused textarea only when it carries ⌘/⌃, so a rebind that dropped the
  modifier would take Return away inside every dialog holding a multi-line
  field. Collision check before taking the combo: no verb, no fixed family and
  no system hotkey binds Enter.
- **`DialogContent` requires `primaryAction`** — the action, or `{ none:
  '<written reason>' }`. That is the manifest's own "the type forbids silence",
  expressed as a required prop, so a new dialog cannot be born with an
  unreachable primary button. Five dialogs declared: Submit feedback, Edit
  Shortcut, Import Projects, and — with reasons — the keyboard cheat sheet
  (every row is its own verb) and the command palette (⏎ runs the highlighted
  row, which is cmdk's contract).
- **`DialogFooter` renders the declared action and prints the chord on it.**
  One declaration drives the button, the chord and the hint, so they cannot
  disagree. macOS default-button placement falls out of it: the primary is the
  footer's last child, Cancel to its left. A dialog with bespoke HUD chrome —
  the Project opener's Import — keeps its own button and puts
  `DialogPrimaryActionHint` inside it; a declared action that prints nothing
  trips a development invariant rather than reaching the operator.
- **The hint is never a reveal.** It reads the effective binding from the
  registry, falling back to the manifest default before overrides load, so it
  occupies its space from the first paint. Rendering nothing while an async
  read settles would have moved the button under a hand already travelling to
  it.

The presentation is not new and was deliberately not reinvented: D27's ⌘W close
confirm has printed `Close ⏎` on its default button since 2026-07-21. That
register is now the primitive's. Both close confirms keep their own ⏎ handling
untouched — they hold no text field, so macOS puts their default action on the
bare Return key, and ⌘⏎ would be the worse answer there.

### The bug the shape itself surfaced

First implementation registered the primary action from `DialogContent`'s body.
The development invariant fired immediately on `/settings`, four times, with no
dialog open — because every provider-level `<Dialog>` renders its content
ELEMENT whether or not it is open, and only `DialogPortal` returns null. So the
feedback dialog's Send was live in the stack permanently: `modal-open` would
have been on forever and ⌘⏎ would have sent empty feedback from anywhere in the
app. Registration moved INSIDE the Radix content, where mount means open. The
invariant written for the operator's benefit caught a defect in its own change
within a minute of first render.

### Verification

Driven end to end against this worktree's dev server, headless, through the
repository's signed-browser boundary. ⌘⏎ with no dialog open opens nothing. In
`Edit Shortcut`: the button reads `Save ⌘↵` and is correctly disabled with
nothing recorded; after recording a combo and moving focus off the capture box,
⌘⏎ closed the dialog and the row came back marked `(customized)` — the real
registry, the real provider, no test seam. A combo pressed INTO the capture box
is still recorded rather than saving, because that box `preventDefault()`s and
the chord engine skips a consumed event.

Six DOM tests cover what the primitive publishes and when: the chord on the
button face, `aria-keyshortcuts`, top-of-stack wins with two dialogs open, a
disabled action swallows the chord, a closed dialog publishes nothing, and a
closing dialog leaves nothing behind. The manifest join lives in
`command-verbs.contract.test.ts` and was mutation-verified: deleting the verb
fails three of its assertions.

### D62's residual, taken rather than deferred

D62 left the composer's 37px drop for a design pass, on two grounds that both
turned out to be wrong.

Re-measured against a Project with no tabs, on the dev server, before and
after: the drop is **41px**, and the pane under it loses the same 41px. That is
a terminal resize on the launcher's highest-frequency path, not one frame of
legible chrome growth. Now **0px** — row height, pane height and pane top all
identical across the hand-off, with the draft tab confirmed to have appeared.

And removal was never the only repair available. D62 read the row as a Session
description, which a draft genuinely cannot fill; it is better read as the
DIRECTORY the workspace is standing in, and the empty-Project stage knows that
before any tab exists. The row now renders from the moment a Project opens,
carrying the path — a draft's cwd IS the Project's dir, so the text does not
change across the hand-off either — and gains the goal, the roadmap chip and
terminal focus when there is a Session to describe. Nothing was taken away, so
the design call D62 deferred did not have to be made, and
`eval:workspace:chrome` did not have to be amended: it reads
`[data-active-session-path]` font size on exactly the ⌘T draft, the row is
still there to read, and the gate passes unchanged across all six viewports.

The general lesson, recorded in the amendment chain: **a row that appears
mid-gesture is a reservation problem before it is a deletion decision.** Asking
"should this be here?" is a design question that stalls; asking "what does this
state honestly hold from the start?" often has an answer already.

One control changed standing with it. `Focus active terminal` was live on a
draft, whose pane is the composer, so it addressed nothing. It is now hidden
and inert without a terminal — and keeps its box, because it is the tallest
element in the row and letting it come and go would have traded a 41px drop for
a 4px one. That is the same reservation rule the hint obeys one section up.

## D64: Clone to… is a filter over the one launcher catalog — repaired 2026-08-17 (BUG-051, BUG-052)

**Two reports, one cause: Clone to… had its own catalog.**

The operator hit both halves in one gesture. "Clone To is broken. First of all,
it's divergent from our command T new agent interface. It should generally be
the same non-divergent options in there. Second of all I clicked Clone to on a
GPT 5.6 codex tab and I saw two options for the same thing. They were both
highlighted when I highlighted them. They have the same selector ID or
something."

### Watched failing first

Reproduced at the level the defect lives before anything was written: a
`StripContextMenu` with two children labelled `GPT-5.6 Codex`, arrow into the
submenu, then count the rows carrying `data-menu-active`. Two, deterministically
— plus React's own `Encountered two children with the same key` warning on the
same render. That is the operator's "both were highlighted" and his "same
selector ID", exactly.

### The defect

`session-clone.ts` built its own target list rather than reading the composer's.
Three divergences followed from that one decision:

- **Order.** It walked `pool.configurations` — the pool's insertion order, which
  is not an order anyone chose — while ⌘T walks `rankLaunchTargets(pool, dir)`.
- **Names.** It labelled each row `name ?? labels.model ?? modelId` and stopped
  there. The composer puts the model on the anchor and the engine-reported
  effort on the quiet secondary channel, so a setup is readable; Clone to…
  dropped the second half.
- **Which setups exist.** It re-derived per-source defaults with its own dedupe
  instead of the composer's.

A saved High setup and Codex's own Medium default are two genuine Launch
Configurations on one model. Under the composer's naming they read
`GPT-5.6 Codex · High` and `GPT-5.6 Codex · Medium`; under Clone to…'s they
both read `GPT-5.6 Codex`. The duplicate was never in the data — it was in the
copy.

`StripContextMenu` then made the pair indistinguishable to the machine too. Its
`rows` keyed on `item.label`, and so did the React key, the roving tabstop and
the `activeRowKey === item.label` highlight predicate. Every same-labelled row
matched at once. FIX-007's cmdk group-id collision is the same family: identity
inferred from something that is not identity.

### The fix

`src/components/workspace/launch-target-catalog.ts` is now the one catalog —
`composeLaunchTargets`, `launchTargetAvailability`, `launchTargetPresentation`,
`resolveLaunchSource` — pure over the pool, the registry snapshot and the
per-source model catalogs. `launch-controls.tsx` lost ~90 lines of inline
composition to it and behaves identically; the "All engines and models" rule
that a source enters only when it publishes an effective model (BUG-014) is
preserved verbatim in `composeLaunchTargets`.

`availableSessionCloneTargets` is now a filter over that catalog: compose, keep
the available ones, present. Cloning into a setup the operator cannot start is
not an offer worth making, whereas the composer keeps showing it with the
missing fact attached, because that surface is where you go to fix it. That is
the only narrowing, and it is expressed as a filter rather than a second list.
The divergent path is deleted, not shimmed.

`StripMenuItem.id` is now REQUIRED, and every row key reads it. A caller cannot
omit identity, so the next hand-built menu cannot repeat this. Rows also gained
`detail` (a secondary VALUE on `hud-text-dim`, deliberately NOT the `note`
channel — readiness neutral means "designed, not built" and is spoken for) and
`accessibleLabel`, so the pair is separable by eye and by screen reader:
`Clone to Codex, GPT-5.6 Codex, High` against `…, Medium`.

⌘K's clone rows carry the same `detail` and search the same accessible label.
⌘K's launch-configuration rows and the configuration ribbon already read the
composer's catalog and now read it through the shared presentation.

### The sibling audit

Every menu that offers launch targets is now on the one catalog: the composer's
setup row, the configuration ribbon, ⌘K's launch rows, and Clone to…. Two
surfaces are legitimately different and stay that way: the Project and Session
context menus carry verbs, not targets, and `OptionMenu` already required an
`id` (decision `0033`), which is why the launcher's axes never had this bug.

One genuine divergence stays open as BUG-052: `terminal-pane.tsx` hand-rolls a
third `role="menu"` with no arrow keys, no Home/End, no Escape and no roving
tabstop. Its data is legitimately its own; its mechanism is not. It was not
folded in here because adopting `StripContextMenu` moves focus into the menu
and back out against a live xterm, and that deserves its own watched-failing
pass.

### Evidence

Regression coverage sits at both levels. `project-ribbon-menu.test.tsx` asserts
that two same-labelled rows highlight one at a time, stay independently
selectable, and resolve to different accessible names — the exact shape that
failed. `session-clone.test.ts` asserts that a saved High setup beside a Medium
default yields two rows sharing a label but differing in `detail`, `id` and
accessible label, and that Clone to…'s ids equal `composeLaunchTargets`' ids in
order, so a future divergence fails as a test rather than as a report.

The ribbon dogfood bench now mounts that same-labelled pair as a fixture, so
the failure stays visible on a real surface instead of only in a unit test. It
was driven headless against this worktree's dev server: one `data-menu-active`
row before and after ArrowDown, effort readable on the quiet channel.

Gates: `eval:workspace:ribbon:bench`, `eval:workspace:chrome` and
`eval:electron:project-agent` green against this worktree's own dev server.
`eval:electron:lifecycle` passed end to end here while the machine was quiet
and then failed twice on its final 2.5s quit race once several agents were
building; a clean `origin/master` baseline, packaged from scratch in a
throwaway worktree, fails the identical assertion at the identical step. It is
the eval's ceiling, not this change, so the gate was waived deliberately under
BUG-050, which another agent had recorded from the same evidence the same
afternoon.

## D65: a gate must name every file its script can be broken by — 2026-08-17 (BUG-058)

**The spine gate is green, and the routing that protects it was wrong.** The
report said `eval:navigation:spine` was red and that BUG-049's dialog work was
the likely cause. Neither half survived a control. What did survive is a
third instance of the map defect that has now cost three separate repairs in a
single day, so this entry spends most of its words there.

### Watched failing first, and then watched passing

A worktree cut from `origin/master` at `14194eda`, bootstrapped with
`pnpm worktree:setup`, running its own dev server on port 7313, with no source
change of any kind:

- Run 1 (cold routes, competing load): `g o reaches sessions view`,
  `recentProjects persisted in workspace layout`, `cmd+E opens the inline
  rename editor` FAIL.
- Runs 2 and 3 (still under load): a different subset fails each time.
- Runs 4, 5 and 6, serial, machine quiet: every step PASS, three times.

The ⌘⇧F step passes throughout, reporting `feedback shortcut is inert when the
distribution has no feedback service`. That is BUG-045's repair, landed by
ENG-030 WP2b-5A at `14194eda` a few hours before this pass began. The failure
the report describes — the eval stopping at the `Quick feedback` dialog on a
`4af1dc24` baseline — is BUG-045 exactly, observed on a tree where BUG-045 was
still open. **BUG-045 alone explains it. BUG-049 introduced no second failure
and did not make BUG-045's worse.**

### The real defect: the map names a surface, the script asserts more than the surface

`eval:navigation:spine` has pressed ⌘⇧F and asserted the Quick feedback dialog
since F1. Its `SURFACE_GATES` entry named five files, and none of them was
either file that step runs on:

- `src/components/feedback/product-feedback-provider.tsx`, whose
  `openQuickCapture` decides whether the dialog can open at all. This is the
  function BUG-045 was about. Its name is written into the comment beside the
  entry, in prose, three lines above a `match` that did not include the file.
- `src/components/ui/dialog.tsx`, the primitive that gives the dialog the role
  and the accessible name the script matches on
  (`getByRole('dialog', { name: 'Quick feedback' })`).

`4af1dc24` changed both. It did have to declare this gate, because it also
touched `command-verbs.ts` and `shortcut-provider.tsx`, which the map does
name — but that is luck, not routing. A change confined to the dialog
primitive and the feedback provider, which is a perfectly ordinary shape for
this surface, would have been asked for nothing.

Both files are in the match set now. So is `scripts/electron-spine-eval.mjs`,
the gate's own script, which was also absent: `eval:electron:packaged` names
`electron-packaged-smoke.mjs` and `eval:electron:project-agent` names
`lib/electron-eval.mjs` for exactly this reason, and this gate was the
exception. Without it, the three step repairs below would have been asked for
nothing.

### Naming the pattern once instead of fixing it a fourth time

Three instances in one day, all the same shape:

| Gate | File that owned the contract | Found by |
| --- | --- | --- |
| `eval:navigation:spine` | `src/components/nav/nav-history.ts` | BUG-035 |
| `eval:electron:lifecycle` | `src/components/workspace/workspace-client.tsx` | BUG-041 |
| `eval:navigation:spine` | `ui/dialog.tsx`, `product-feedback-provider.tsx` | BUG-058 |

The common cause is not carelessness. `SURFACE_GATES` is authored from the
SURFACE a gate is nominally about — its `why` field is a sentence about that
surface — while the script underneath keeps acquiring assertions that reach
past it. Every such assertion silently acquires an owner nobody routes, and
the omission is invisible by construction: the gate stays green until the
unrouted file changes, and then it goes red in someone else's landing.

The rule is now written into the map itself, beside the entry that earned it:
**when adding or widening an assertion in a gated eval, add the file that can
break it to `SURFACE_GATES` in the same change.** It belongs next to the
existing "adding a gate is a data edit here, never a code edit at the call
site", because it is the same discipline applied to the match set rather than
to the gate list.

### Three steps that reported red for the wrong reason

`g o reaches sessions view` slept a fixed 900ms and then read `page.url()`.
`cmd+E opens the inline rename editor` slept 500ms and then read
`document.activeElement` once. `recentProjects persisted in workspace layout`
reloaded the app and then read `workspace.load()` once, racing the boot write
the reloaded app performs.

This is precisely the defect BUG-045 repaired at `g m reaches spatial` and
left in three siblings, and the eval already carries the rule in a comment at
⌘[/⌘]: *"Bounded URL waits, not fixed sleeps — under load navigation can take
longer than any chosen sleep and a race here reads as a spine failure."* The
host ran at a load average of 299 during this pass, which is an ordinary
afternoon with several agent worktrees live; a debug harness confirmed that in
isolation `g o` navigates correctly both from a fresh `/workspace` and after
the rail click that precedes it in the script.

All three now wait, bounded, on the identical assertion. Nothing is relaxed:
a chord that never navigates, a layout that genuinely loses the seeded
Project, and a verb that never opens the editor each still fail, and each
still fails within the step's own ceiling.

The ⌘E step turned out to be a different fault than the other two, and the
first repair exposed it rather than fixing it. It is not a settle race after
the press; it is a READINESS race before it. `rename-tab` is available only
once a tab is active, this step follows a full reload, and a press that lands
before rehydration hits an unavailable verb and is dropped — after which no
amount of waiting can recover it. Making the preceding `recentProjects` step
finish as soon as its condition held moved the press EARLIER and made the
failure reproducible in the landing floor, which is the useful thing a fixed
sleep had been hiding. The step now waits for `[data-tab-id="spine-tab"]
[data-active]`, presses once, and then waits for the editor. That readiness
wait reports as this step's own FAIL rather than throwing, because an aborted
run prints no summary at all and a tab that never becomes active is a real
regression that must be readable as one.

The reason to bother: a gate that reads red for the wrong reason is how a
waiver starts, and this gate's waiver is unusually expensive. It is the only
check in the repository that presses ⌘[ and ⌘] against a real router round
trip, and the only real coverage of the native application menu — which is why
FIX-012 could ship a verb with a chord, a palette row and no menu item.

### Verification

`eval:navigation:spine` green on the hardened script, twice: once on a quiet
machine and once deliberately run against a concurrent full `pnpm test:run`,
which is the condition that produced the original red. `pnpm theme:check`
green (see BUG-059). `pnpm type-check` green.
`node --test scripts/check-production-theme-literals.test.mjs` green, 4/4.
`pnpm test:run` shows only 5000ms-timeout failures in DOM test files this
change does not touch; the two representative files pass in isolation, and the
host load average was 299 at the time.

## BUG-080: unreachable code was rotting gates, so it was deleted — 2026-08-17

**3,352 lines of source and six production dependencies deleted, across 64
files, in five reviewable commits.** Full suite green throughout (3,053 passed,
1 skipped), `eval:workspace:launcher`, `eval:roadmap:rail`,
`eval:electron:recents` and `eval:electron:packaged` all green, the last of
those against a real packaged build with the removed dependencies gone.

### Why a sweep at all

Five separate pieces of unreachable code were found in a single day of work,
each one AFTER it had already cost an agent real time: the 607-line pre-D49
launcher control row hidden behind `customizeOpen` (BUG-014), `ModelPicker`
whose last consumer was that row, `menu.section` declared by every verb and
read by nothing, `clear()` in `agent-model-catalog-cache.ts` with no callers
while the cache it bounded grew unbounded (BUG-033), and
`RetainedTerminalPane` superseded by `PausedAgentRecord`. Five in one day is
evidence of a population, not a coincidence. The reason it costs more here than
clutter normally does: this code is reachable by tests and evals but not by
users, which is precisely how the repo shipped three separate "the gate reads
as coverage and isn't" defects.

### The method, and what it caught that a grep would not

Unreachability was PROVEN, not inferred. Two passes:

1. An import graph over `src/`, `electron/`, `packages/`, `scripts/`, and the
   repo-root entry files (`instrumentation-client.ts`, `proxy.ts`), resolving
   relative, `@/`, and `@exawatt/*` workspace specifiers, to find modules with
   no importer and modules imported only by tests.
2. A whole-repo occurrence count of every exported identifier across
   `.ts/.tsx/.mjs/.js/.json/.md/.css/.yml/.yaml/.sql/.html`, so a registry key,
   a manifest entry, a `generated-*` declaration, a route convention, a
   dynamic import, or an IPC channel name could not be missed.

Both passes were necessary and neither was sufficient. The import graph alone
called `packages/ui-model/src/index.ts` (1,378 lines) and
`src/lib/analytics-bridge/main-process-events.ts` dead — the first because the
resolver did not yet understand workspace package names, the second because its
consumer is `instrumentation-client.ts` at the repo root. The occurrence count
alone would have kept `useAgent` in `fleet-provider.tsx` forever, because a
second `useAgent` lived in `src/lib/agents/use-agent.ts` and each hid the
other's uselessness. That is the same blindness that let `ModelPicker` survive
BUG-014's first look, and it is why the sweep was RE-RUN against its own
result: the first four commits orphaned another 178 lines.

### What was deleted

**The pre-PTY `claude -p` agent stack (1,785 lines).** `src/lib/agents/*` was
a complete renderer-side agent transport layer — provider, hook, mock and
Electron transports — with zero importers. Its Electron counterpart
`electron/main/agents/*` spawned `claude -p --output-format json` as a child
process and parsed its JSON stream; `agent-ipc.ts` registered seven
`agent:*` channels for it at every boot. The renderer could only reach those
channels through `window.electron.agent`, whose sole caller was the dead
`ElectronTransport`. So the whole chain was live-registered and unreachable:
the preload bridge existed, main handled the calls, and nothing could make
one. Superseded by the PTY session manager. `src/types/database.ts` (324
lines) and `src/types/tasks.ts` (228 lines) died with it — sole importers
`nav/project-switcher.tsx` (itself unimported) and `lib/agents/types.ts`.

**Seven shadcn primitives, and six production dependencies (674 lines).**
`form`, `sheet`, `tabs`, `badge`, `separator`, `slider`, `collapsible`,
installed by the CLI and imported by nothing, plus `use-media-query.ts`. They
were the only consumers of `react-hook-form`, `@radix-ui/react-tabs`,
`@radix-ui/react-separator`, `@radix-ui/react-slider`, and
`@radix-ui/react-collapsible`; `@hookform/resolvers` had no consumer even
before this. All six left `dependencies`, so they left the packaged app and
the production audit surface with them. `zod` looked identical from `src/` and
STAYS: `themes/contract.mjs` imports it for the theme-generator schema — a
reminder that the `.mjs` build tooling is part of the reachability question.

**The retired unit-ladder's residue (514 lines).** ENG-008's own 2026-08-03
dead-code pass retired `unit-ladder.tsx` and both consumption labs but left
behind the data and atoms they were the only consumers of. `atoms.tsx` went
522 → 155 lines, `units.ts` 200 → 81, and `clock.tsx` went entirely. That last
one is the best proof in the whole sweep that this code was *unreachable* and
not merely *unimported*: `useConsumptionClock` THROWS outside a
`ConsumptionClockProvider`, and nothing in the application has ever mounted
one, so `CapacityBar` and `ResetCountdown` could not have rendered even if
something had called them.

**Three dead re-export barrels and 33 symbols with no reference anywhere (543
lines).** `packages/core/src/state/index.ts` and `packages/core/src/oc/index.ts`
duplicated re-exports the package index already made from the deep paths;
`src/lib/appearance/index.ts` was reached only by two tests. Those tests
exercise live production code, so they were rewired to the deep paths rather
than retired — test-only reach retires the MODULE, never a test of something
real. The symbols are listed in the roadmap entry; the two worth naming here
are `resetCommandEngineForTests`, which is labelled "Tests only" and which no
test used (BUG-014's shape exactly), and the sixteen OC wire types describing
protocol methods this client never calls.

### Where "unused" would have been a symptom

BUG-033 is why this step exists: `clear()` with zero callers was not clutter,
it was a missing eviction owner, and deleting it would have hidden the defect.
Four candidates were checked against the defect they might have been hiding:

- `touchProject` ("bumps recency for the switcher/recents") — NOT a symptom.
  `openRepositoryProject` already writes `last_opened_at` on every open, in
  both the Supabase and local paths. `touchProject` was a second
  implementation written for the dead project switcher.
- `MAX_ROW_SETUPS`/`MIN_ROW_SETUPS` — NOT a symptom. The launcher row cap is
  enforced by `rowCapacityForWidth`, which carries the same 2/3/4 numbers.
- `delegationBlocked` — NOT a symptom. `blockedOn` is read directly by
  `delegation-monitor` and `local-sessions`; the predicate was a duplicate.
- `loadRailMode`/`saveRailMode` — NOT a symptom, but worth recording:
  `expose-overlay` passes `mode="open"` as a literal, so the roadmap rail's
  strip mode exists only in the gallery lab. Nothing an operator can set was
  lost, because there is nothing an operator can set.

One candidate was NOT deleted on this reasoning: the watts rung's
implementation went with the ladder, but its coefficient and basis are written
into the BUG-080 roadmap entry so ENG-008 E11 rebuilds the energy rung from
canon rather than from a function nothing ever called.

### What was found and deliberately not fixed

**465 exported symbols have no consumer outside their own module** and should
be module-private. That is a ~150-file diff of pure `export`-keyword removal,
with four agents landing concurrently, and it is a different change in kind
from deleting unreachable code — so it is named here as the next pass rather
than folded into this one.

Three gates were found red and reported with reproduced baselines, and all
three turned out to belong to agents working the same afternoon: the spine
gate's red on `4af1dc24` was BUG-045 (closed) with BUG-058 owning the routing
hole beneath it, `pnpm theme:check` is BUG-059, and the DOM suite's
load-induced failures — which failed this sweep's own landing twice on tests
it does not touch — are BUG-057. No duplicate rows were filed. What the sweep
contributed there is the baselines: every one was reproduced on an untouched
checkout before being reported, which is what let each owner separate the
machine from the change.
