# 0013 Separate Project opening from Agent launch

Date: 2026-07-12
Status: accepted, expected to evolve with dogfood evidence

## Context

The first terminal workspace treated directory selection and process creation as
one gesture: opening a directory immediately spawned a shell. It also presented
shell, Claude Code, and Codex as equivalent launch choices. That matched the
underlying PTY implementation but not the product model. A Project should remain
available when no process is running, while Claude Code, Codex, Gemini CLI,
OpenClaw, Hermes, hosted runtimes, and future sources expose different Agent and
Session lifecycles.

The operator wants fast access to a curated library of roughly a dozen Projects,
an optional parent-folder import convenience, and an Agent-first start flow that
can grow beyond coding CLIs without committing Exawatt to one provider.

## Decision

- Opening or selecting a Project is inert. It never implicitly starts a shell,
  Agent, or Session.
- `Command-N` opens an Exawatt Project chooser backed by the durable registry and
  local fallback state. The native folder picker remains an explicit fallback.
- Parent-folder import is optional, one level deep, reviewed before commit, and
  never a continuously watched assumption about every user's filesystem.
- Starting work uses a compact Agent composer: optional initial task, visible
  Agent Source, Start action, and secondary launch options. An empty task starts
  a blank interactive Session.
- The most recently used source for that Project becomes its next recommendation
  automatically. Personal source recency is the fallback. The visible selector
  keeps the recommendation reversible; no provider becomes a permanent product
  default.
- A plain shell is a Project tool, not an Agent Source. It remains available as
  a secondary action and shortcut.
- The UI speaks in Agent terms while the current Claude Code and Codex adapters
  may still use PTYs internally. Provider-specific process commands remain
  behind the source/PTY boundary.
- New-versus-attach semantics for durable OpenClaw, Hermes, hosted, or other
  Agents remain deliberately unresolved. The source capability model must leave
  room for create, attach, resume, and branch without exposing speculative UI.

## Consequences

- Project state must support zero Session tabs without implicitly launching
  work. AMENDED 2026-07-27 by decision `0022`: both an explicitly opened empty
  Project and a Project whose last Agent closed remain open; inactive empties
  settle into a compact dormant ribbon tail. Only explicit Project close
  removes the open group. Registry and recency identity survive either way.
- An open Project must remain the same addressable object in Terminal, Sessions,
  and Spatial even with zero Agents or Sessions. Agent-derived grouping alone is
  insufficient; sources expose a Project catalog, and later Agents join its
  stable identity rather than creating a parallel group.
- Project discovery and git-worktree resolution belong in Electron main, not in
  renderer path heuristics.
- Initial tasks travel through the source launch contract, not simulated terminal
  typing after spawn.
- Claude Code and Codex are initial Agent Sources, not an exhaustive enum of what
  Exawatt can manage.
- The chooser, recommendation policy, and composer are malleable hypotheses.
  Dogfood evidence may change ranking, density, terminology, or attach/resume
  presentation without reversing the object boundaries above.

## 2026-07-22 amendment: close the exhausted open group

Dogfood showed that retaining a Project chip forever after its last Agent
closed turned the open workspace into a second Project library. The durable
chooser already owns library membership. Terminal now acknowledges the final
Agent close by showing the existing empty composer for three seconds, retracts
the Project right-to-left, and removes only the open group. A right-click
**Close project** action uses the same transition and confirms before stopping
remaining tabs. Explicitly opening an empty Project is still inert and stable;
only the close-last-Agent transition auto-closes it. AMENDED by D39: the shared
close verb follows the active object. `Command-W`, the command palette, and the
native Session menu close the active tab when present and close an active empty
Project otherwise.

AMENDED 2026-07-24 after lifecycle review: the three-second grace state yields
to new operator intent. Pointer or keyboard engagement cancels its pending
close, and the first composer edit atomically creates a draft Agent tab carrying
the complete launch configuration. Background source/model discovery cannot
make an untouched empty Project durable. The Project strip retracts from the
right; surviving flex groups use a bounded layout transition so removal does
not end in a lateral snap.

## 2026-07-27 amendment: retain and dormantly partition empty Projects

Further density dogfood reversed the automatic removal portion of the prior
amendment. The Project view is expected to gain Project-owned value beyond
running Agents, and automatic close conflated an exhausted child collection
with the lifecycle of its parent object. Closing the last Agent now leaves the
Project open; once inactive for a short tunable dwell its constant-height header
animates into a stable dormant tail. `Command-W` on the selected empty Project
and **Close project** remain explicit close. Decision `0022` owns the elastic
two-row layout, persisted disclosure, Initiative projection, and motion
contract.
