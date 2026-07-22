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

Model and reasoning-effort choice are also visible and source-owned. Before a
new local Agent starts, the composer resolves the selected harness's effective
model/effort pair and exposes its available choices. Codex supplies its
installed model catalog, each model's supported efforts and default, and the
configured pair; Claude Code contributes its layered settings, account-default
alias, and supported aliases/custom entries. Changing models immediately
reconciles effort to that model's valid choices and default. Exawatt pins the
displayed pair on the launch command so the UI and process cannot drift between
composition and spawn. An override is scoped to that new Agent and does not
mutate the user's Codex or Claude configuration. A dominant environment effort
is shown as fixed because the harness would ignore a conflicting CLI choice. If
a harness cannot describe an exact value, Exawatt labels the harness default
honestly and lets the harness remain the authority instead of inventing one.

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

These policies are requests to, and enforced by, the selected harness. Exawatt
does not currently add an independent sandbox around Claude Code, Codex, or the
tools they invoke. In particular, **YOLO** means the harness receives the broad
machine authority available to the user's process. The UI must not describe a
provider-enforced mode as an Exawatt guarantee.

Model/effort discovery, create, attach, resume, branch, background, and
delegation are source capabilities. The UI should expose only capabilities an
adapter actually supports; a unified attach/resume design remains a hypothesis
for later iteration.

## Activity and assurance contract

Agent Sources differ in more than launch and resume commands. An adapter should
eventually describe which activity it reports, which controls it enforces, and
which evidence it can provide. Exawatt can then normalize the parts a source
supports while leaving unsupported facts unknown.

For example, a source may report that an Agent called a mail tool. That is
useful activity, but it does not prove that Exawatt authorized the call or that
the recipient's server accepted the message. Exawatt should keep those claims
separate through the common Event assurance facets: reported, observed,
authorized, enforced, and verified.

This contract is intentionally provider-first today:

- harness manufacturers own their sandboxes, prompts, tool policies, and
  downstream integrations;
- users bring the security model appropriate to their chosen harness;
- Exawatt exposes the selected posture and source-reported activity without
  manufacturing stronger guarantees;
- Demo Scenario Sources emit the same shapes with clearly simulated provenance.

Future adapters may point to Exawatt-owned or third-party mediators for
credentials, network access, payments, messages, or other typed actions. The
adapter contract allows that future without making those integrations current
scope.

## Managed Workspace ceilings

Personal launch preferences are the current implementation. When managed
Workspace policy arrives, its ceilings take precedence: a personal Agent
setting or YOLO preference can request less access but cannot exceed what the
Workspace permits. An adapter that cannot honor the effective ceiling must fail
visibly rather than silently start with broader authority.

This is a future governance contract, not a second policy engine in today's
desktop app.
