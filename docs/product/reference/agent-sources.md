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

Launch permission policy is also visible, personal, and reversible. Exawatt
uses one source-agnostic three-level contract:

- `prompt`: keep harness approval prompts active;
- `auto`: use a harness-provided safety reviewer or classifier;
- `unrestricted`: bypass approvals and sandboxing.

The source adapter translates those policies into provider-specific controls.
For current local sources, `auto` maps to Claude Code Auto mode and Codex
automatic approval review; `unrestricted` maps to each CLI's dangerous bypass
flag. A harness must advertise a policy before the composer offers it.

The machine-local preference is keyed by user, Project, and Agent Source. New
pairs default to `unrestricted` (shown as **YOLO**) and the composer keeps that
high-impact state visible. The selector explains each policy in place and saves
changes immediately, including draft choices made before an Agent starts.
Source changes from the composer, palette, or shortcuts restore that source's
pair-specific choice. Resuming a local Session uses the current remembered
policy for its Project and source; the policy is not part of provider
conversation identity. If personal preferences cannot be read, Exawatt uses
`prompt` (shown as **Ask first**) as a visible safe fallback. If a harness or
account cannot use a selected policy, Exawatt surfaces the harness response and
does not silently broaden access.

Create, attach, resume, branch, background, and delegation are source
capabilities. The UI should expose only capabilities an adapter actually
supports; a unified attach/resume design remains a hypothesis for later
iteration.
