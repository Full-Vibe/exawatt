# ENG-046 First-run on-ramp: your projects, one click, first Agent

Owning roadmap item: `docs/engineering/roadmap.md` → ENG-046. Execution detail, not an independent roadmap.

<!-- exawatt:public-omit-begin the operator brief is private source material -->
Source: the 2026-10-14 operator brief (`docs/research/operator-briefs/2026-10-14-gemini-bus-direct-onboarding-analytics-brief.md`) and the research record `docs/research/market/2026-10-14-agent-bus-group-command-and-on-ramp-landscape.md` §5.
<!-- exawatt:public-omit-end -->

## Outcome

A person who already runs Claude Code, Codex or Antigravity opens Exawatt for
the first time and sees the projects they actually work in, most recent first,
each with the harness that last touched it. One click opens one. ⌘T starts an
Agent in it with that harness already chosen. Nothing to read, nothing to
import, nothing to configure. The operator's framing: "one click to pop open an
existing project inside Exawatt. Not a ton of copy that you have to read."

The answer to "does Exawatt need to import them?" is no. Exawatt reads each
harness's own project store, shows what it finds, and only creates a Project
record when the user opens one. The harness stores remain the only truth for
history; Exawatt's registry is the only truth for Project identity; the folder
is the join.

## Fixed decisions

- **Harness stores are read, never written.** `~/.claude.json`'s `projects`
  map, `~/.claude/projects/<encoded cwd>/`, `~/.codex/config.toml`'s
  `[projects."<path>"]` table, `~/.codex/sessions/*/rollout-*.jsonl` (first
  line carries `cwd`), and Antigravity's `~/.gemini/config/projects/*.json`
  (`name`, `projectResources`) are discovery evidence. Claude Code documents
  its entry format as internal and version-dependent, so every reader fails
  soft: an unreadable store yields no suggestions and a named diagnostic, never
  an empty list that looks like "no projects" (the absence rule).
- **Suggestions, not import.** Decision `0013` stands: opening is inert, and
  nothing continuously watches the filesystem. The stores are read when the
  chooser opens and on an explicit refresh. A suggestion becomes a registry
  row only when opened; "Open all recent" is one explicit gesture that opens
  the listed rows, never the raw store.
- **The join key is the git common directory.** A worktree folds into its
  repository (`project-resolve.ts` already does this; operator, 2026-10-15,
  asked whether to mirror Claude Code's one-entry-per-worktree instead: "I'm
  not sure. We'll shift this around over time. Start with 1."); the same folder known
  to Claude Code, Codex and Antigravity is one suggestion with three badges;
  a Codex Agent opened in a folder Claude Code knows lands in the same Exawatt
  Project. A folder without git is its own Project. This is decision `0037`
  §3 applied to discovery: identity is Exawatt's and opaque, the folder is a
  binding, and a source is never silently promoted into a Project.
- **Cloud chat Projects are linked by the user, not discovered.** claude.ai
  and ChatGPT expose no API that lists a user's Projects; Claude Code's own
  "Projects" are cloud threads whose local half runs through Remote Control.
  Until an API exists, a Project may carry a user-pasted link to such a
  Project as a binding (later milestone); Exawatt never claims the two are
  the same thing.
- **The filter is strict and explainable.** A directory entry is suggested
  when it exists, is not the home directory, `Downloads`, a temporary path or
  anything under `Library`, is a git root or carries a project marker
  (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `.git`), is not
  merely a non-git parent of other suggestions, and saw activity within the
  last 30 days (older entries sit behind "Show older"). Ranking is by last
  activity across all stores.
- **Not a wizard.** The first-run surface is the existing chooser with a
  populated "Your projects" section; the three buttons (Browse Folder, Import
  Folder, Connect a server) stay where they are. The account card stays an
  invitation, never a gate (ENG-030 OS0). With no harness installed, the
  chooser shows the setup choices and Try Demo from the D54 brief's "No
  source ready" state.
- **Privacy.** Every read is local and disclosed on the download page's
  machine disclosures beside the existing transcript reads. Analytics (ENG-047)
  carries `project_opened` with a `source` and `harness_hint` and never a
  name or path.

## Measured on the operator's Mac (2026-10-14)

| Store | Raw entries | Exist on disk | Git roots | Active in 30 days |
| --- | --- | --- | --- | --- |
| Claude Code `~/.claude.json` projects | 85 | 33 | 20 | about 10 after the filter (20 transcript directories had activity, 8 of them scratch, temp or home paths) |
| Codex `config.toml` trust table | 32 | 23 | 18 | not measured (five entries are Exawatt eval temp dirs) |
| Antigravity project files | 3 | n/a | n/a | n/a |

The filter matters: without it a first run would offer the home directory
itself, a backups volume and five temporary eval directories.

## Milestones

- **O1 Harness project suggestions (main process).** One reader per store
  behind one `HarnessProjectSuggestion` shape (`path`, `commonDir`,
  `harnesses[]`, `lastActivityAt`, `evidence`), the filter above, worktree
  folding, dedupe, and a named diagnostic per unreadable store. Fixtures for
  each store's real shape; tests for the filter, the parent-collapse rule and
  fail-soft. IPC `projects:suggestions` beside `projects:scan-directory`.
- **O2 Your projects in the chooser.** The chooser's first section lists
  suggestions with harness badges, relative last activity and one-click open
  (inert, D14); "Open all recent"; "Show older". An opened suggestion upserts
  the registry row by `root_path` exactly as Browse does, and the composer
  recommends the suggesting harness. Measured: a fresh install with the
  operator's stores reaches a running Agent in two clicks and a typed task.
- **O3 First-Agent hand-off.** After the first open, the composer is focused
  with the recommended harness and the Project's recent conversations visible
  (ENG-016 D31 catalog), so "Continue where Claude Code left off" is one
  click. No new surface.
- **O4 Bindings beyond the folder (later).** The registry's single
  `root_path` grows into `bindings[]`, each an attribute, never a join key.
  Spec written 2026-10-15 (the "Bindings spec" section below); the build
  stays unshaped until a user asks for the chat-Project link.

## Ownership boundaries

- Store readers live in `electron/main/projects/`; the renderer never reads
  the filesystem. `conversation-catalog.ts` keeps owning per-Project history;
  O1 reuses its encoding helpers rather than duplicating them.
- The chooser (`project-opener.tsx`) and the registry (`src/lib/projects/`)
  keep their contracts; O2 adds a section, not a second chooser (D14, D49).
- ENG-003 S5.3.1 owns the Gemini sign-in step that the on-ramp shows when
  Antigravity is installed and `agy models` reads unknown.
- ENG-047 owns the events; ENG-046 only calls them.

## Acceptance

- A fresh install on a machine with the three stores shows the user's real
  projects, most recent first, with no scratch, temp, home or parent-only
  rows, within two seconds of opening the chooser.
- An unreadable or absent store produces a diagnostic line and no suggestions
  from that store; the other stores still list.
- Opening a suggestion creates no process, one registry row, and the same
  Project identity that Browse would have created for that folder.
- The same folder known to two harnesses is one row with two badges, and an
  Agent of either harness lands in that one Project.
- Nothing is written to any harness store, proven by a checksum before and
  after the eval.

## Bindings spec (2026-10-15)

What an Exawatt Project is once it can carry more than one folder and the
evidence of three harness stores and two chat products. This is a contract
the operator can argue with, not code; O4 builds it when a user asks, and O1
to O3 are built against it so nothing they store has to be undone.

<!-- exawatt:public-omit-begin the evidence file is private research -->
Evidence: `docs/research/market/2026-10-15-harness-project-stores-and-exawatt-bindings.md`
(every store on the operator's Mac read read-only on 2026-10-15; vendor
documentation of the same day).
<!-- exawatt:public-omit-end -->

### The record

```text
Project
  id              opaque, Exawatt-owned; never derived from anything below
  name            the operator's label; seeded once at creation, never
                  overwritten by a store afterwards
  kind            'repository' | 'manual' | 'remote-home' (unchanged)
  bindings[]      zero or more; each an attribute, never a join key
  color, sort_order, last_opened_at, archived_at (unchanged)

Binding
  kind            'folder' | 'claude-code-directory' | 'codex-directory'
                  | 'antigravity-project' | 'claude-cloud-project'
                  | 'chatgpt-project'
  ref             what the kind names (below)
  machine_id      present on every path-shaped kind; a path is per machine
  label           the store's own name, when it has one
  source          'user' (pasted or picked) | 'discovery' (read from a store)
  observed_at     when Exawatt last saw this evidence or the user bound it
```

What each kind names, and what Exawatt may do with it:

| kind | `ref` | Evidence of | Exawatt may |
| --- | --- | --- | --- |
| `folder` | an absolute directory on `machine_id`; today's `root_path` | where the Project lives on this machine | open, launch, Finder, worktree verbs |
| `claude-code-directory` | the exact key of Claude Code's per-directory entry (`~/.claude.json` → `projects`) or the `cwd` its transcripts record | Claude Code has run here; trust accepted or not; last start | show the badge, recommend the harness, rank by last activity, list its conversations |
| `codex-directory` | the exact key of Codex's `[projects."<path>"]` entry or a thread's `cwd` | Codex has run here; trusted | the same |
| `antigravity-project` | the `id` of `~/.gemini/config/projects/<id>.json` (its `folderUri`s name the folders) | Antigravity groups conversations here | the same, and pass `--project <id>` at launch when the operator wants Antigravity's own grouping to match |
| `claude-cloud-project` | a `claude.ai/code/projects/...` URL the user pasted | the user says this cloud Project is about this work | open the link; never list, match or claim equivalence |
| `chatgpt-project` | a ChatGPT project URL the user pasted | the same | the same |

A store that has a display name (Antigravity, the Codex app, both chat
products) contributes it as `label`; Claude Code and the Codex CLI have none,
and the folder's basename stands in. The label never renames the Project.

### The join rule

- An Agent of any harness opening in a directory resolves that directory
  with `git rev-parse --git-common-dir` (`project-resolve.ts`): a linked
  worktree and a subdirectory both fold to the repository's working
  directory; a directory outside git is itself.
- The Project is the one whose `folder` binding on this machine equals that
  resolved directory. There is at most one (today the `(user_id, root_path)`
  unique index; tomorrow a partial unique index on folder bindings per
  machine).
- Harness-store bindings are never looked up to find a Project. They are
  attached to the Project the folder join found, or carried by a suggestion
  until that suggestion is opened. The same holds for cloud links.
- No Project has that folder: discovery lists a suggestion; a Project is
  created only by an explicit open (chooser, suggestion click, Browse,
  launch). Discovery never creates a row.
- Worktrees fold for now (operator, 2026-10-15: "Start with 1. We'll shift
  this around over time."). When that changes, a worktree becomes a second
  `folder` binding on the same Project, not a second Project, and the join
  rule above is unchanged.

### Invariants

1. **Identity survives rebind and detach.** Adding, replacing or removing
   any binding, including the last `folder`, never changes `id`; a Project
   with zero bindings is valid and openable, and folder-dependent verbs are
   simply absent (decision `0037` §3).
2. **Stores are never written.** Every `discovery` binding is the result of
   a read. Exawatt never writes `~/.claude.json`, `~/.claude/projects/`,
   `~/.codex/config.toml`, `~/.codex/sessions/`, any Codex SQLite file,
   `~/.gemini/config/projects/` or Antigravity's SQLite. Passing
   `--project <id>` to `agy` is the harness writing its own store through
   its own CLI, and only when the operator asked for it.
3. **A suggestion becomes a row only on open.** A suggestion carries its
   folder and its discovery bindings; opening it creates the row and its
   bindings in one gesture, exactly the row Browse would have created for
   that folder.
4. **One row per folder, N badges.** The folder join is unique per machine
   and user; the same folder known to Claude Code, Codex and Antigravity is
   one Project with three discovery bindings, and never three rows. A
   harness arriving later adds a binding, never a row.
5. **A binding is dated evidence, never truth.** Each carries `observed_at`.
   A store entry that disappears (a purge, the 30-day transcript sweep, a
   deleted or moved directory) makes the binding stale, not the Project
   deleted: Exawatt shows the state (folder missing, harness no longer
   knows it) and keeps the row. A refresh re-reads the stores; nothing
   watches the filesystem (decision `0013`).

### Explicit non-bijections

- **Worktrees.** Every store is keyed per working directory; Exawatt folds
  to the repository, so one Project ↔ many store entries. Claude Code folds
  only its auto memory and permission approvals across worktrees; the Codex
  app leaves worktrees made outside it without a project. The fold is the
  operator's choice and is reversible by the rule above.
- **Parent and nested directories.** A store remembers the home directory,
  a parent of several repositories and a package inside one. The filter
  drops parents that are not git roots; the join folds subdirectories. Some
  entries therefore map to no Project and some to a Project they did not
  name.
- **Deleted, moved and purged directories.** No store records a move; each
  accumulates a new entry and keeps the old, and on a real machine most
  Claude Code entries point at directories that no longer exist. Claude
  Code's purge removes its knowledge of a directory and the retention sweep
  removes transcripts but not the entry; an Exawatt row keeps its identity
  through all of it. Rebinding the folder is a user act.
- **Entry versus transcript.** Claude Code keeps per-directory entries and
  per-directory transcripts, and each exists without the other. A reader
  unions them and reads the transcript's own `cwd`, because the transcript
  directory name is a lossy encoding that cannot be decoded.
- **Cloud projects with no API.** Claude Code Projects and ChatGPT Projects
  cannot be listed, matched or opened by Exawatt; a Claude Code Project
  thread that runs locally through Remote Control is an ordinary local
  session with a working directory and no project signal; teleport moves a
  session, not a project; "a local session doesn't have these options".
  The binding is a link the user pasted and nothing more.
- **Antigravity's default bucket and multi-folder projects.** Conversations
  started without `--project` land in `default-cli-project`, which has no
  folders and maps to no Project; a user project may list several folders,
  so one Antigravity project may attach to several Exawatt Projects.
- **The Codex app's own projects.** They have ids and roots in local SQLite,
  but the app has not assigned them to the CLI's threads, so the directory
  is the usable evidence and the app's id is a later binding kind at most.

### Migration from `root_path` (shape only; no migration is written here)

Today: `projects.root_path TEXT NULL` with a unique `(user_id, root_path)`
index; `git_remote TEXT NULL` written at creation and never read; the local
registry mirrors the same DTO in storage version 1.

Target shape:

```text
project_bindings
  id            uuid
  project_id    → projects.id (cascade)
  kind          text
  ref           text
  machine_id    text NULL          present for folder and *-directory kinds
  label         text NULL
  source        text               'user' | 'discovery'
  observed_at   timestamptz
  created_at    timestamptz
  unique (project_id, kind, ref, machine_id)
  partial unique (user_id, machine_id, ref) where kind = 'folder'
```

Order of work when O4 is built: (1) add the table and backfill one `folder`
binding per row from `root_path` with this machine's id; (2) move the folder
join and `rebindProjectPath` onto folder bindings; (3) delete `root_path`
and its unique index in the same landing, and bump the local registry's
storage version with a one-time migration of v1 rows. No shim keeps
`root_path` alive. `git_remote` stays as a cross-machine rematch hint until a
sync design needs it; it is not a join.

### Open questions for the operator

1. **Several folders in one Project.** Codex and Antigravity allow a
   frontend and a backend in one project. Allow N `folder` bindings with
   different repositories, with the first as primary for launch and Finder?
   Proposed: allow when asked, primary = first; nothing in the join changes.
2. **Antigravity's own grouping.** Pass `--project <id>` at launch so
   Antigravity's store groups conversations the way Exawatt does (Antigravity
   then writes its own store on the operator's behalf), or leave its default
   bucket alone? Proposed: leave it alone until the mismatch is felt.
3. **Cross-machine.** A synced account sees a Project whose folder is on
   another Mac. Proposed: `machine_id` on every path-shaped binding, one
   folder binding per machine, `git_remote` as a rematch hint; not a join.
4. **Stale badges.** When a harness entry is purged or the folder is gone,
   show the badge as stale, or drop it on the next refresh? Proposed: keep
   it for one refresh with its date, then drop; the row stays.
5. **Local threads of a cloud Project.** No documented signal says a local
   session is a Claude Code Project thread. Proposed: do nothing; the
   session is an ordinary Agent in the folder's Project.

## Roadmap milestone log

### 2026-10-14 — created from the operator brief

### 2026-10-15 — the cohort is both kinds of person, and the first run is one Start screen

Round 1: "Both, about evenly." Round 2, on a machine with no harness: "It
should be smart and detect that and give clear remediation and next steps
for the user. It should be clear, holistic, clean, and obvious inside our
application not just like a feature-jammed single-use UI." Round 3, offered
three shapes, the operator chose one Start screen from existing parts.

**O0 shape, decided.** The empty-Project state (today one centered Open
Project button and the account card) becomes a Start screen assembled from
pieces that already exist and already carry their own truth:

1. **Agents you can run**: the Settings source cards, in the composer's
   order, each with its one next step (Sign in, Install guide, Recheck) and
   decision `0051`'s line on the Gemini card. Nothing installs on the user's
   behalf.
2. **Your projects**: ENG-046's suggestions with harness badges and one-click
   open; "Pick a folder" when there are none.
3. **Try the Demo**: the existing Workspace switch.

It stays the empty-Project state forever (a home, never a once-only wizard),
so the ⌘N chooser, the composer and this screen are the same components
arranged once. O0 prototypes it at `/hud-gallery` across the five states
(no harness; installed, signed out; ready with projects; ready with none;
Demo) for operator review before O2 and O5 wire it into production.

Shaped in one pass with the research record. The operator's decisions are in
the brief; the agent's standing decisions (join key, suggestions over import,
user-linked chat Projects) are recorded there so they can be reversed.

### 2026-10-15 — O4 bindings spec written

The Project record with `bindings[]`, the folder join, five invariants, the
non-bijections and the migration shape from `root_path` are in the "Bindings
spec (2026-10-15)" section above. Measured the same day on the operator's
Mac: 37 distinct projects across the three stores after folding, 19 of them
known to more than one harness, and most Claude Code entries pointing at
directories that no longer exist, which is what made "a binding is dated
evidence" an invariant rather than a nicety. O4's build stays unshaped until
a user asks for the chat-Project link.

### 2026-10-15 — O0 study landed, awaiting operator review

Route: `/hud-gallery/start-screen` (`src/app/hud-gallery/start-screen/`),
linked from the gallery index under Review workbenches. Landed as `50c9544c`.
Every control is in the URL: `?state=&theme=&width=&card=`.

**The five states**, one composition each (Agents you can run, then Your
projects or Pick a folder, then Try the Demo; no steps, no progress, no
dismiss):

1. `no-harness`: six cards, each Not installed with Install guide and
   Recheck; Pick a folder with Browse, Import and Connect a server; the Demo
   row.
2. `signed-out`: Antigravity installed, Google not signed in. The Gemini
   card (ENG-003 S5.3.1 face: "Gemini" over "Antigravity CLI") reads Action
   required with the one next step "Sign in to Google in Antigravity",
   Recheck beside it, and decision `0051`'s one line with the FAQ link.
3. `ready-projects`: Claude Code, Codex and Gemini ready; eight authored
   suggestions ranked by last activity, harness badges per row, relative
   time, six inside the 30-day window and two behind "Show older (2)", "Open
   all recent". Clicking a row shows the hand-off: the real `AgentLauncher`
   with the suggesting engine selected and the not-installed engine dimmed
   with its reason (O3's moment, shown once).
4. `ready-empty`: the same cards, Pick a folder, the Demo row.
5. `demo`: the Try the Demo row switched: Demo named with its tagline, the
   ribbon of ten Voltaic Projects with Agent counts, the active Project's
   Agents under real `StatusLight`s, and Personal as the way back.

Themes Classic, Air and Night; desktop and a 520px frame; reduced motion
checked (the study carries no motion). Keyboard reachable: every row and
step is a button.

**Reused as is:** `Button`, `SourceIdentityMark`, `SettingsSourceMark`,
`StatusLight`, `AgentLauncher` with the launcher bench's cold setups and
`benchAxes`, `DEMO_WORKSPACE` and `PERSONAL_WORKSPACE`, `OUTBOUND_CONTROLS`,
the Voltaic fixture (`DEMO_PROJECTS`, `DEMO_BASE_AGENTS`), the composer's
engine order and source declarations, the workspace HUD roles and the theme
registry.

**Copied, so the production packet knows what to make controllable:** the
Settings source card (rail row, state pill and the repair actions are
private to `AgentSourcesSettings`, bound to the registry IPC); the chooser's
Project row and its Browse / Import / Connect footer (inline in
`ProjectOpener`, bound to the registry and the native picker); the account
menu's Workspace row (inside the dropdown); the Demo ribbon's Project chip
(`TabStrip` over live state); `AccountFirstRunCard` (reads Supabase, the
pathname and storage). Two study decisions to confirm: the cards paint from
the shared HUD and action roles rather than the Settings-scoped neutrals,
because the Start screen lives on the workspace stage; next steps use the
one button recipe (`outline`, Recheck `ghost`) rather than Settings' amber
repair button, because six accent buttons on a home screen would break the
one-primary-action rule.

**Questions for the operator:**

1. Six cards or only the installed ones? The composer's order shows every
   engine, so the no-harness state is six install guides.
2. Does the account invitation keep floating over the Start screen (it
   covers the top-right cards, including Gemini's state), or become a fourth
   row under Try the Demo?
3. After a one-click open, is the composer alone enough, or should the
   Project's recent conversations sit beside it from the first open (O3)?

Verification: `page.test.tsx` pins the contract only (five distinct states,
one next step per card, section order, the 30-day split derived from the
fixture, the hand-off, the Demo switch, no em dash); lint, type-check,
`theme:check`, `copy:check`, `eval:gallery:labels` against the worktree's
dev server; 54 screenshots (5 states × 3 themes × 2 widths, plus older,
opened, card-on and reduced-motion variants) reviewed by eye.


### 2026-10-15 — O0 study reviewed; three answers and one folder per Project

The study at `/hud-gallery/start-screen` (`50c9544c`) went to the operator
with its three questions. His answers, verbatim in the brief:

- **Engine cards**: show installed engines; with none installed, one "Add an
  engine" card opens the roster. "I don't want to force (or imply / guide)
  users to install all three things if that's not their cup of tea." A row of
  install guides is out.
- **Account invitation**: a fourth row under Try the Demo, for now ("I'd need
  to see it to give feedback. let's go with 1 for now").
- **After a one-click open**: the composer above the Project's recent
  conversations with Continue on each (O3), from the first open.
- **Several folders per Project**: one folder per Project for now ("I'm
  leaning toward 2"; he wants to see how other apps do it). Comparators from
  the 2026-10-14 record: the Codex desktop app ("Add folder", one primary),
  Zed and multi-root VS Code and Cursor allow several; Claude Desktop and
  Conductor bind one. `bindings[]` keeps the door open without building it.

The study is revised to these answers before O2/O5 copy anything from it.