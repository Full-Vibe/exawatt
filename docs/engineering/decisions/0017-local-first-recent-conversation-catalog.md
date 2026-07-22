# 0017 Local-first recent-conversation catalog

Date: 2026-07-22
Status: accepted, adapter set expected to expand

## Context

The new-tab composer made starting an Agent immediate, but it gave no legible
way to migrate work already underway in Claude Code or Codex. Asking an
operator to remember and type a provider UUID is technically possible and
practically hostile, especially when a project has many recent conversations.

Provider storage shapes differ, and not every provider supplies a useful title.
A UI that reads Claude or Codex files directly would make provider internals a
renderer concern and would not admit hosted OpenClaw, custom harnesses, or Demo
Mode later. Blocking the browser on model summarization would also break the
desktop's offline authority.

Exact identity remains non-negotiable. Claude Code documents resuming a
specific session with `--resume <session-id>`; Exawatt must never substitute a
latest-by-directory guess.

## Decision

- Electron main owns a `RecentConversationCatalog` that normalizes exact
  provider ID, Agent Source, Project directory, timestamps, title, short
  handoff, provenance, and whether enrichment would help.
- Each Agent Source contributes a replaceable adapter. The first adapters are
  Claude Code and Codex; future local, hosted, custom, and Demo sources join the
  same contract instead of adding renderer branches.
- Discovery is bounded and local-first. Adapters inspect at most the newest 300
  JSONL files and bounded prefix/suffix ranges, isolate malformed or rotating
  files, filter known harness envelopes, and scope results to the canonical
  Project directory.
- Provider-native titles win. A fingerprinted, mode-0600 machine-local cache is
  second. A deterministic excerpt fallback is always available immediately.
- The new-tab composer remains a new-task surface first. Empty-composer ↓ moves
  to recents; Option+↑/↓ cycles the Agent Source. A recent row's primary action
  resumes its exact ID immediately. **Fresh** creates a new Session with only
  the compact handoff and source ID as the initial task.
- Missing labels may be augmented asynchronously only after Exawatt
  authentication. Electron sends at most eight conversations with at most
  eight bounded operator-authored excerpts each to a hosted Exawatt endpoint.
  The endpoint validates the bearer session and request size, treats excerpts
  as untrusted data, and asks Anthropic's fast Haiku model for strict
  schema-shaped labels. The Anthropic key remains a server-only environment
  variable. The endpoint does not persist transcript excerpts.
- Enrichment failure is silent degradation, not launch failure. Native,
  cached, and local fallback copy continues to work offline.

References:

- [Claude Code CLI exact resume](https://docs.anthropic.com/en/docs/claude-code/cli-usage)
- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [Anthropic structured tool output](https://platform.claude.com/docs/en/claude_api_primer)

## Consequences

- The renderer sees normalized conversation rows and never parses provider
  files or receives an Anthropic credential.
- Adding an Agent Source requires one catalog adapter plus its launch adapter,
  not a parallel recent-conversations UI.
- Titles can improve after first paint, but row identity and action never
  change. Full provider IDs remain visible so the operator can verify the
  migration target.
- Short excerpts may leave the machine for signed-in title augmentation. The
  privacy surface must disclose that processing and the feature must remain
  useful when augmentation is unavailable.
