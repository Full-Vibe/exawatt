# 0045 Feedback attempts preserve delivery truth

Date: 2026-10-02
Status: adopted for the operator-requested ENG-025 F6 plan; implementation pending

**A feedback success means the report and every requested attachment were
saved; a retry belongs to the same immutable attempt.**

## Context

Operator requests ask for a shared sending-to-terminal language, consistent
notices and discoverable image paste.
The quick composer currently disappears during delivery. Its provider ignores
`attachmentStored`, creates a new idempotency key for each send and can clear a
newer draft when an older request finishes. The hosted route can accept text
while image storage fails, and skips image recovery on duplicate requests.
Adding images and polished confirmation without addressing those contracts
would amplify misleading success and duplicate reports.

## Decision

- Freeze one attempt's message, kind, context, build facts, diagnostics, image
  and idempotency key when sending. Retry reuses it. Editing creates a new
  attempt; repeated activation while pending does not create a second one.
  Draft identity owns mutation, so a late completion cannot clear or replace
  another draft.
- Replace invisible optimistic dismissal with a visible compact operation
  receipt: sending, sent, partial delivery or failure. Restore focus once so
  the user can continue working. No artificial loading duration, claimed
  percentage or success before a validated service receipt.
- A text-only report succeeds when its row is accepted. An attempt with an
  image succeeds only when the receipt confirms that image. Text saved with
  image missing is a recoverable partial result; retain the evidence and offer
  same-attempt retry or explicit completion without the image. A lost response
  is an unknown outcome, not proof that nothing was saved.
- Reconcile report and attachment idempotency server-side. Duplicate responses
  describe actual saved evidence, missing evidence can finish on retry,
  concurrent retries converge, and a changed payload cannot reuse the key to
  alter the accepted report. Implement with owned private-storage paths and
  narrowly scoped database constraints as required; do not relax account or
  triage-column authority. Preserve existing rows and V1 wire compatibility.
- Share presentation across feedback receipts, hints and update notices while
  keeping their domain behavior. A hint may expire; an actionable update
  retains its restart/dismiss contract; a feedback failure retains recovery.
  This primitive is not a new Agent attention or notification model.
- Keep the first increment to one image and explicit foreground retries. No
  durable outbox, automatic network retry, anonymous send or submitter status
  service. The current authenticated intake and compatible-service boundary
  remain the authority.
- Preserve drafts on dismissal/failure while running; restart persistence is
  deferred. An app-wide review informs a paired palette/feedback gallery study
  before extracting shared foundations. The compact receipt is the initial
  destination; moving it into a shared notice area is a potential enhancement.

## Alternatives and consequences

| Alternative | Disposition / reason |
| --- | --- |
| Close immediately and animate only the final toast | Rejected: does not show the real sending/partial state and leaves draft races intact. |
| Treat every 2xx as complete success | Rejected: the existing receipt explicitly distinguishes image storage. |
| Generate a new key on retry | Rejected: an accepted request with a lost response can become a second report. |
| Add multiple images, persistent outbox and background retries now | Deferred: each widens the wire, retention or auth lifecycle contract beyond the current operator requests. |
| Force update notices into expiring toast behavior | Rejected: actionable update truth must survive a shared visual treatment. |

Server receipt/reconciliation semantics land before the new client retry path.
The gallery review gates visual adoption, not source investigation or backend
work. Runtime architecture and existing product behavior remain unchanged in
this planning commit. Update their canonical projections when F6 implements
the attempt owner. Shared review evidence lives in
[ENG-036's project doc](../projects/design-system-of-record.md#2026-10-02--app-wide-review-shapes-paired-flows-and-shared-foundations).
ENG-025 F6 owns reporting execution and acceptance through the roadmap's
project reference.
