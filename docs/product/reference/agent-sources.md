# Agent Sources

An Agent Source, or Harness, is a runtime/provider boundary that can create, observe, and control agents.

Exawatt should stay source-agnostic.

Examples:

- local OpenClaw
- hosted OpenClaw
- Codex
- Claude Code
- custom harnesses
- Demo Scenario Source

OpenClaw is the first implementation target, not the product boundary.

## Launch contract

Project selection and Agent launch are separate commands. An open Project may
have zero Sessions. Starting an Agent may include an optional initial task and a
visible source choice; the source adapter decides how that request maps to a
local process, remote Agent, or provider Session.

Near-term Claude Code and Codex Sessions are PTY-backed. That transport is an
implementation detail, not a requirement for future sources. Shells remain
secondary Project tools.

Source recommendations are personal and reversible. Exawatt may remember the
last source used per Project and fall back to personal recency, but must not
silently hard-code one provider for every user or Project.

Create, attach, resume, branch, background, and delegation are source
capabilities. The UI should expose only capabilities an adapter actually
supports; a unified attach/resume design remains a hypothesis for later
iteration.
