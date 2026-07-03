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

| Today (macOS)                        | Exawatt concept                    |
| ------------------------------------ | ---------------------------------- |
| Space (one per company/project)      | Initiative (within a Workspace)    |
| Terminal window (one per Space)      | The Initiative's working surface   |
| Terminal tab                         | Session (interactive)              |
| Coding agent in a tab + worktree     | Agent + Session (Claude Code)      |
| Browser window / ambient Space state | Context Signals (future)           |
| Switching Spaces                     | Context switching between groups   |

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
3. **Directory = project (operator, 2026-07-02):** igniting a session
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
   system: the operator commands sessions as **visual entities on the world
   map** OR as terminal tabs, choosing per moment; the terminal pane is the
   shared focus surface both drop into.

## Why this matters

The operator wants to **use and dogfood Exawatt continuously** while the
bigger phases are executed. Every roadmap decision about near-term scope
should be checked against: "does this get the operator running their real
daily work inside Exawatt sooner, without conflicting with the long-term
model?"
