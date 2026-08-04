# 0019 Server-owned Session context inference

Date: 2026-07-24
Status: accepted

Amended 2026-08-03 by decision `0031`, pending ENG-030 OS1: the bounded
evidence, structured-result, stale-response, and durable-last-good contracts
survive, but one proprietary Exawatt-hosted endpoint is no longer the target
architecture. The open client moves to local/source-owned or explicitly
configured inference and removes the baked hosted default before OSS release.

## Context

The first Session subtitle implementation periodically sent terminal
scrollback to a locally installed Claude CLI. It chose candidates by PTY output
volume and asked the model to emit `KEEP`, `NO_GOAL`, or a six-word goal. In
dogfood this routinely timed out, accepted model narration, remained stuck on
an earlier task, and exposed an image temp path as a launch subtitle. Terminal
bytes are weak evidence for why a Session exists; submitted operator
instructions are the actual change boundary.

The operator also wants immediate rating/correction of these labels and a more
general in-product feedback path for all authenticated users.

## Decision

- One authenticated hosted endpoint owns Session-label inference. It receives
  bounded, locally redacted operator evidence, applies per-user quota, invokes a
  server-held model credential, and requires structured output.
- Electron main triggers inference after meaningful submitted operator
  instructions. It coalesces concurrent work and rejects stale responses.
- The last accepted label is durable state. Offline, auth, quota, timeout, and
  provider failures retain it. A meaningful launch instruction may be shown
  provisionally; attachment-only or unusable input shows **New agent**.
- No deterministic local summarizer competes with the hosted model. Shared
  evidence and response schemas preserve a future direct-provider adapter seam
  without building a second implementation now.
- Model evidence is not persisted by the inference endpoint. Authenticated
  explicit feedback is stored separately in a general product-feedback model;
  private attachments are optional. Sanitized reviewed feedback may be promoted
  into a versioned repository evaluation corpus.

## Consequences

- Label changes align with human intent instead of terminal redraws, while a
  retained label keeps offline behavior calm and predictable.
- A signed-out user can still launch and use local Agents, but receives only the
  provisional or retained label and cannot submit product feedback.
- The hosted service becomes an availability dependency for improving labels,
  not for starting, resuming, or operating a Session.
- Sending operator-authored evidence across the cloud boundary is explicit. It
  is minimized, redacted, request-bounded, authenticated, quota-controlled, and
  excluded from normal application logs.
