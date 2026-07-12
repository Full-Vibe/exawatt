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

- Project state must persist with zero Session tabs and survive closing its last
  tab.
- Project discovery and git-worktree resolution belong in Electron main, not in
  renderer path heuristics.
- Initial tasks travel through the source launch contract, not simulated terminal
  typing after spawn.
- Claude Code and Codex are initial Agent Sources, not an exhaustive enum of what
  Exawatt can manage.
- The chooser, recommendation policy, and composer are malleable hypotheses.
  Dogfood evidence may change ranking, density, terminology, or attach/resume
  presentation without reversing the object boundaries above.
