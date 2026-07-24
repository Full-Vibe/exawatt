<!-- Generated for the public repository by the "public-document-set" recipe. -->
# The Operator Workflow ("Exawatt v0")

Canonical description of the founding operator's real day-to-day agent
workflow, recorded 2026-07-02. This is the reference use case for the
near-term dogfood arc: Exawatt's first immediately-usable version should
replicate this workflow 1:1, then improve it incrementally. Treat this doc
as product canon (operator-stated intent, not third-party research).

## The workflow today

- Each **macOS Space** maps to one company / project / initiative in the
  operator's head (in Exawatt parlance: roughly an Initiative, sometimes a
  whole Workspace).
- Each Space contains **one terminal window** dedicated to that
  company/initiative, plus ambient context for the Space (e.g. the relevant
  browser window).
- Each terminal window contains **many terminal tabs**. Some tabs are plain
  shells; several run **coding agents (Claude Code) in parallel, each in its
  own git worktree** — typically a couple at a time per initiative, 1–6
  agents across the machine.
- **Context switching = switching Spaces/windows.** Moving from (say)
  Exawatt work to Cortex EHR work is a full mental context swap keyed to the
  window switch. Within a window, several parallel workstreams (tabs) share
  that one context.

This is agent fleet management done in a really crappy, really contrived
way — which is exactly why it is the right thing to replace first. In the
absence of Exawatt, this workflow IS "Exawatt v0."

## Mapping to canonical concepts

| Today (macOS)                        | Exawatt concept                  |
| ------------------------------------ | -------------------------------- |
| Space (one per company/project)      | Initiative (within a Workspace)  |
| Terminal window (one per Space)      | The Initiative's working surface |
| Terminal tab                         | Session (interactive)            |
| Coding agent in a tab + worktree     | Agent + Session (Claude Code)    |
| Browser window / ambient Space state | Context Signals (future)         |
| Switching Spaces                     | Context switching between groups |

## The dogfood arc (operator-stated)

1. **Parity v0:** replicate the behavior 1:1 in the Exawatt UI —
   windows-per-initiative, tabs-per-window, parallel coding agents in
   worktrees. Minimal, immediately usable daily.
2. **Incremental improvements layered on parity**, in rough order of
   stated interest:
   - naming the terminal window or tab
   - automatically summarizing the micro-context into a small subtitle so
     context switching is easier and clearer ("what was I working on over
     here?")
   - extremely good keyboard shortcuts for very fast navigation
   - automatic context augmentation
   - all scoped to the 1–6 coding-agent use case first
3. **Directory = project (operator, 2026-07-02):** launching a session
   always requires a project directory (never a silent home-dir default;
   home is meaningless as an initiative and harnesses won't durably trust
   it) with the last-used directory remembered. The working directory is
   the grouping key that maps sessions to a Project/Initiative: tabs of the
   same project share a color and cluster adjacently; different projects
   get distinct colors.
4. **The grander plan:** 10 agents → tens → hundreds → tens of thousands.
   The 3D Fleet Command / spatial surface (ENG-004) is built for that scale
   and this arc grows into it — the terminal workspace is the near-term
   rung on the same ladder, not a fork. AMENDED 2026-07-03 (operator): the
   terminal workspace is a FIRST-CLASS UI REGIME, not a transitional one —
   "a dressed-up, augmented, way-better TMUX interface that's AI-native,"
   developed IN PARALLEL with the spatial regime. Per the modular-UI-regimes
   architecture, both are independent skins over the same session/fleet
   system. AMENDED 2026-07-06 (operator, tentative): the regimes
   deliberately DIVERGE rather than converge — the terminal regime is the
   solid, approachable daily driver for 1–10 agents (its excellence arc is
   ENG-015: attention, keyboard velocity, exposé/motion, context paging);
   the map's identity heads toward an RTS-style unit-selection command
   surface for hundreds-to-thousands of agents. Both stay long-lived
   runtime options the operator picks per moment.
5. **Stellar before scale (operator, 2026-07-06):** before the long-arc
   items, the 1–10 agent experience must be stellar — attention &
   notifications, speed of control, visual juice & game feel, context at a
   glance, and research-backed context-switching support (helping the human
   page dramatically different contexts in and out). This is roadmap item
   ENG-015.

## Dogfood interview refinements (2026-07-10)

Durable conclusions from the operator interview that scoped ENG-016
(daily-driver adoption), ENG-017 (Project roadmap lens), and ENG-018
(durable, resumable sessions):

- **Don't take the Spaces mapping literally.** Exawatt should be ONE window
  the operator switches to on the Mac; inside it, Project clusters replace
  macOS Spaces and switching clusters/tabs replaces switching Spaces. No
  multi-OS-window requirement.
- **Adoption blockers named** (now ENG-016 scope): an installed,
  Spotlight-launchable app that automatically tracks top-of-tree; legible
  launch/revive (auto-revive today reads as "an arbitrary coding agent …
  weird and opaque"); terminal fundamentals (scrollback search, copy/select
  ergonomics, image paste, performance); chrome and keyboard polish to a
  Slack / Superhuman / Linear bar, including an Escape-backs-out hierarchy
  with terminal-focus semantics respected.
- **Integration loop: agents self-integrate.** Worker agents commit, rebase,
  and push to master themselves from their worktrees. Exawatt stays out of
  git mechanics near-term; worktree create/pick at launch is enough.
- **Project state is repo-canonical.** Each project's roadmap/queue — "does
  every agent have enough food to eat?" — lives statefully, durably, and
  malleably in that project's repo docs. Exawatt adds a really good
  visualization of it (ENG-017), and may manage/assign the queue in the
  future (toward ENG-013). Today the work is 80–95% coding agents; over
  time it drifts toward higher-level, less terminal-nerd operation and
  non-code work classes (marketing, outreach, email) — recorded for
  direction, not near-term scope.
- **Notifications: default quiet.** Dock badge + bounce is the right level
  for the operator; native macOS notifications are a real future user
  feature but must be configurable and default off. Phone/remote reach is
  later.
- **Persistence: tolerable short-term, standing pain long-term.** Machine
  restarts, app updates, context compaction, and network loss all make
  resuming agents painful in the status-quo workflow; Exawatt should
  eventually beat this, not just match it (ENG-018).
- **Plain shells are occasional.** Agent sessions are the center of
  gravity; the existing shell harness covers the rest.
- **Desktop delivery is one trusted build (operator, 2026-07-10):** the installed
  daily-driver app packages its own renderer instead of loading the hosted site
  into a privileged PTY bridge. During dogfood, the agent landing `master`
  builds and installs it as part of closeout; signed/notarized update delivery
  follows as a near-term product mechanism.
- **Resume exact conversations, never "latest" (operator, 2026-07-10):** several
  agents commonly work in the same Project at once. Each Exawatt tab must retain
  one exact Claude/Codex session ID so four tabs resume the same four
  conversations. Directory and recency are insufficient identity.
- **Dogfood and building run together (operator, 2026-07-10):** the operator
  supplies continuous usage evidence while coding agents keep executing the
  adoption plan. No agent pauses for a separate week-long validation phase.

## Why this matters

The operator wants to **use and dogfood Exawatt continuously** while the
bigger phases are executed. Every roadmap decision about near-term scope
should be checked against: "does this get the operator running their real
daily work inside Exawatt sooner, without conflicting with the long-term
model?"

## Session context cues

The small tab subtitle is a re-entry cue: **why does this Session exist, what
was I working on, and what is the reason for that work?** It should let the
operator page the Session's world back into memory. It is not a transcription
of the last command or a live activity indicator.

Sessions are used both for deep work and as convenient scratchpads. Related
subtasks keep the established cue; a genuinely unrelated instruction changes
it; returning to an earlier topic may restore the earlier cue. The product
always shows its best current guess, with **New agent** as the honest fallback
for an attachment-only or otherwise non-semantic launch. It never presents a
temp-file path, `KEEP`, `NO_GOAL`, or model narration as user-facing context.
