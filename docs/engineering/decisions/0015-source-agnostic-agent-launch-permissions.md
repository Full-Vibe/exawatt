# 0015 Source-agnostic Agent launch permissions

Date: 2026-07-18
Status: accepted, expected to evolve with harness capabilities

Decision `0016` clarifies that these modes are enforced by the selected harness
today and must later resolve within non-bypassable managed Workspace ceilings.

## Context

Exawatt launches Claude Code and Codex as local Agent Sources. Their current
CLIs expose more than a safe-versus-dangerous boolean:

- Claude Code supports default prompting, Auto mode backed by a classifier, and
  bypass permissions.
- Codex supports workspace sandboxing with human approvals, automatic approval
  review, and a full approval-and-sandbox bypass.

The operator wants new local Agents to start without approval friction by
default, while retaining a visible lower-access choice per Project and harness.
Encoding either provider's flag directly in the composer would make the UI part
of that provider adapter and would not generalize to future sources.

Evidence reviewed on 2026-07-18:
[Claude Code permission modes](https://code.claude.com/docs/en/permission-modes)
and
[Codex agent approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security.md).

## Decision

- Exawatt defines three source-agnostic launch policies:
  - `prompt`: the harness keeps human approval in the loop;
  - `auto`: a harness safety reviewer or classifier evaluates escalation;
  - `unrestricted`: approval and sandbox boundaries are bypassed.
- The composer shows those as **Ask first**, **Auto-review**, and **YOLO**.
  Unrestricted access is visible and warning-colored; it is not a hidden
  default. The policy menu explains consequences in plain language and remains
  fully keyboard-operable.
- A new user+Project+harness combination defaults to `unrestricted`, matching
  the operator's requested local workflow. The personal choice is stored in
  Electron `userData/settings.json` by stable Project directory and source.
  Changing the selector persists immediately, while the in-memory draft remains
  effective if persistence is temporarily unavailable.
- Claude Code maps the policies to `--permission-mode default`,
  `--permission-mode auto`, and `--dangerously-skip-permissions`.
- Codex maps them to workspace-write plus on-request approvals,
  workspace-write plus on-request approvals with `approvals_reviewer =
"auto_review"`, and `--dangerously-bypass-approvals-and-sandbox`.
- The renderer passes the policy as launch data. Provider flags are assembled
  only inside the PTY/source boundary. Future adapters advertise the policies
  they actually support.
- Exact local resume uses the current remembered Project+harness policy. The
  launch policy is personal runtime policy, not provider conversation identity.
- Preference loading gates Agent start so a stale or default policy cannot race
  a saved choice. A settings read failure visibly falls back to `prompt`; it
  never silently escalates to `unrestricted`.
- If a harness version, account, model, provider, or administrator does not
  allow a selected mode, Exawatt surfaces the harness response. It does not
  silently fall back to unrestricted access.

## Consequences

- YOLO Agents receive the user's full machine authority. The visible selector
  and plain-language description must keep that fact legible.
- Auto-review is capability-dependent. Claude Code currently gates Auto mode by
  version, account, model, provider, and administrator settings; its rejection
  remains an honest harness result.
- Personal launch preferences remain machine-local and do not modify a
  repository's Claude or Codex configuration.
- Shells are unaffected because they are Project tools, not Agent Sources.
- The three shared policies are an adapter contract, not a claim that every
  source implements identical security mechanics.
