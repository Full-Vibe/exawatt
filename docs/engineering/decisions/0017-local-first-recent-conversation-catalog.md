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
  handoff, provenance, continuation capability, and whether enrichment would
  help.
- Each conversation source contributes a replaceable adapter. Claude Code and
  Codex provide provider history; Exawatt's Recently-closed ledger provides
  Project-owned logical Sessions, semantic goals, and retained-history reopen.
  Future local, hosted, custom, and Demo sources join the same contract instead
  of adding renderer branches.
- The active Project is the sole scope, but cwd equality is not the ownership
  model: nested directories and live git worktrees resolve to their canonical
  Project. The catalog preserves and validates the conversation's actual
  launch directory; it never flattens a nested package or worktree back to the
  Project root. Exact provider identity deduplicates records found in both Exawatt
  and a harness; the strongest title provenance owns presentation while the
  richer Exawatt whole-Session continuation remains available. When an older
  Exawatt Session did not capture its provider ID, a normalized initial task
  may reconcile it only when there is exactly one candidate on both sides;
  ambiguity means unmapped and both recoverable records remain visible.
- Discovery is bounded and local-first. Codex's indexed thread database is the
  primary metadata source and is queried by Project with a hard result limit;
  legacy installations first read only rollout metadata and open bounded
  transcript ranges after Project membership is known. Claude uses its
  Project indexes when available and a Project-local bounded fallback. One
  precomputed Project/worktree scope replaces per-candidate git calls, and a
  short main-process cache deduplicates concurrent visible-pane requests.
- Provider-native titles win. A fingerprinted, mode-0600 machine-local cache is
  second. Cache entries are schema-validated, pruned, and written through
  unique atomic staging files. A deterministic excerpt fallback is always
  available immediately.
- Catalog titles are browser labels, not Session tab names. Resume and Fresh
  carry the bounded handoff into goal metadata but start with the normal Agent
  Source identity; only an explicit operator rename owns primary tab chrome.
  Raw/native handoffs remain summarizer input, while only validated generated
  labels may seed an immediate goal subtitle.
- The new-tab composer remains a new-task surface first. Empty-composer ↓ moves
  to recents; Option+↑/↓ cycles the Agent Source. A provider-only row's primary
  action resumes its exact ID immediately. A Project-owned row with exact
  provider identity migrates into the current draft in one gesture, preserves
  the durable Exawatt Session, and consumes its soft-close ledger entry only
  after provider launch succeeds. A retained-only row reopens without guessing.
  **Fresh** creates
  a new Session with only the compact handoff and source identity as the
  initial task.
- Missing labels may be augmented asynchronously only after Exawatt
  authentication. Electron sends at most eight conversations with at most
  eight bounded operator-authored excerpts each to a hosted Exawatt endpoint.
  Common credentials are redacted locally first. The automatic feature is
  disclosed and controllable in Settings (default on); Electron main enforces
  the choice, so a renderer cannot bypass it.
  The endpoint validates the bearer session and request size, treats excerpts
  as untrusted data, and asks Anthropic's fast Haiku model for strict
  schema-shaped labels. A Supabase transaction claims per-user hourly and
  daily quota before any model call; quota-store failure is closed. The
  Anthropic key remains a server-only environment variable. The endpoint does
  not persist transcript excerpts.
- Enrichment failure is silent degradation, not launch failure. Native,
  cached, and local fallback copy continues to work offline.
- Generated labels are accepted only when both the hosted boundary and the
  desktop cache boundary verify the six-word title / 18-word handoff contract
  and reject first-person or model-preamble narration. Invalid cache rows are
  ignored and remain eligible for later enrichment.

References:

- [Claude Code CLI exact resume](https://docs.anthropic.com/en/docs/claude-code/cli-usage)
- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [Anthropic structured tool output](https://platform.claude.com/docs/en/claude_api_primer)

## Consequences

- The renderer sees normalized conversation rows and never parses provider
  files or receives an Anthropic credential.
- Project Session history and harness history form one ranked feed rather than
  competing “recent” surfaces; current open Sessions stay in the tab strip.
- Adding an Agent Source requires one catalog adapter plus its launch adapter,
  registered source capabilities, not a parallel recent-conversations UI.
- Titles can improve after first paint, but row identity and action never
  change. Full provider IDs remain visible so the operator can verify the
  migration target.
- Short excerpts may leave the machine for signed-in title augmentation. The
  privacy surface must disclose that processing and the feature must remain
  useful when augmentation is unavailable.
