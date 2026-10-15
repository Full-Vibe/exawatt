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
  repository (`project-resolve.ts` already does this); the same folder known
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
  `root_path` grows into bindings (`folder`, `antigravity-project`,
  `claude-project-link`, `chatgpt-project-link`), each an attribute, never
  a join key. Unshaped until a user asks for the chat-Project link.

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
