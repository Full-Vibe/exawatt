# 0045 Feedback attempts preserve delivery truth

Date: 2026-10-02
Status: adopted; presentation amended 2026-10-04 by F7; production recovery active (BUG-272)

**A feedback success means the report and every requested attachment were
saved; a retry belongs to the same immutable attempt.**

**2026-10-04 amendment:** F6 artifacts were integrated/deployed/installed, but
that did not prove authenticated production delivery. Incident 0032 identifies
the missing fingerprint INSERT grant. F7 supersedes close-on-send presentation;
immutable attempts, exact-hash reconciliation and certainty remain binding.

## Context

Operator requests ask for a shared sending-to-terminal language, consistent
notices and discoverable image paste.
Before F6, quick capture disappeared during delivery, ignored `attachmentStored`,
created a new idempotency key for each send and could clear a newer draft when
an older request finished. The hosted route could accept text while image
storage failed and skipped image recovery on duplicate requests.
Adding images and polished confirmation without addressing those contracts
would amplify misleading success and duplicate reports.

## Decision

- One composer serves the keyboard, palette and Help-menu entry points. The
  operator's execution review supersedes the original quick/full split: there
  is one running-session draft, one evidence policy and one visible send path.
  Entry commands may select the initial kind of a new draft; reopening keeps
  the existing draft's kind, evidence and captured context.
- Freeze one attempt's message, kind, context, build facts, diagnostics, image
  and idempotency key when sending. Retry reuses it. Editing creates a new
  attempt; repeated activation while pending does not create a second one.
  Draft identity owns mutation, so a late completion cannot clear or replace
  another draft.
- Replace invisible optimistic dismissal with a visible compact operation
  receipt: sending, sent, partial delivery or failure. Receipt state changes
  are immediate; only the pending spinner moves. Restore focus once so
  the user can continue working. No artificial loading duration, claimed
  percentage or success before a validated service receipt.
- A text-only report succeeds when its row is accepted. An attempt with an
  image succeeds only when the receipt confirms that image. Text saved with
  image missing is a recoverable partial result; retain the evidence and offer
  same-attempt retry or explicit completion without the image. Explicit
  completion accepts the confirmed report and stops image recovery; it neither
  removes a stored image nor proves that an earlier unconfirmed retry cannot
  still save it. The receipt confirms saved feedback while retaining image
  delivery uncertainty. A lost response
  is an unknown outcome, not proof that nothing was saved. Retry permission
  and outcome certainty are independent: honor a service problem's explicit
  `retryable` flag, keep transport/protocol uncertainty unconfirmed, and retain
  that earlier uncertainty if a later same-key retry is refused. Only a
  validated saved-report receipt resolves whether an earlier write exists.
  Reopening or typing into a draft whose earlier delivery is saved/unconfirmed
  shows the duplicate-report warning; an unchanged nonretryable attempt cannot
  be sent again.
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
  deferred. The app-wide review and paired palette/feedback study informed
  shared foundations. The operator authorizes adoption with the simplified
  receipt treatment; no further gallery approval is pending, and the study is
  retired. The compact receipt stays near the composer initially; moving it
  into a shared notice area remains a potential enhancement.

- Controls state their real keyboard behavior locally. Return sends only from
  the feedback text field; Shift Return inserts a line; focused buttons retain
  native activation; IME composition never sends. The selected enabled palette
  row carries a Return icon without replacing its registered shortcut. Image
  removal uses the preview's close icon; there is no separate Replace button.
  The attachment control, paste and drop use the same validated image path.
- Keep motion at the component boundary it explains. Shared `DialogContent`
  uses Radix-observed named CSS presence (240ms enter, 160ms exit) and a typed
  `motion: auto | none` choice; screenshot capture uses immediate `none` so the
  overlay is gone before capture. Reduced motion disables that presentation.
  Receipt pending/success/partial/error states render immediately, with only a
  reduced-motion-aware pending spinner. The operator rejected both the original
  snapshot flight and the later receipt fade/background resize: remove those
  mechanisms rather than preserve another animation subsystem. No cloned state
  visuals, receipt body fades, resizing plate or operation-motion owner remains.
  Cmd+K adopts comfortable shared overlay spacing, its keyboard footer and the
  selected enabled row's Return cue through cmdk/Radix's existing ownership.
- A shared notice lane owns placement/order for update, hint and chord notices;
  callers retain their domain lifetime and actions. Feedback receipts remain
  near the composer initially. Placement ownership does not imply a shared
  persistence policy or a new notification engine.
- Each foreground feedback service call has a 30-second AbortSignal deadline. Timeout
  preserves an unknown outcome and the frozen key for explicit retry; it does
  not prove rollback. No automatic retry is introduced.

## F7 presentation and delivery amendment (2026-10-04)

- Keep one dialog mounted across editing, pending and terminal results. Preserve
  text/evidence and render progress/recovery in place. Sending does not restore
  background focus; explicit dismissal does. The user can close while pending,
  retain the frozen attempt and reopen without losing its state.
- Shared Dialog owns truthful modal focus and release on logical dismissal;
  nonblocking notices cannot retain a focus trap or inert background. A native
  Button/action model derives labels, keyboard cues, accessibility and dispatch
  from the same enabled action; pending/disabled controls do not promise sends.
- Preserve the independent saved-report/image facts and retry permission versus
  outcome certainty. Plain user copy expresses those facts without technical
  keys. Explicit refusal does not erase an earlier unknown write; Finish without
  image stops recovery but cannot prove an earlier retry stored no image.
- Accept one PNG/JPEG/WebP image of at most 3 MiB decoded. The full serialized
  UTF-8 request must fit 4,500,000 bytes, including base64 and diagnostics. Check
  the actual wire body before dispatch and server-side, not only file size.
  Oversize input preserves the valid draft. A 5 MiB file expands beyond the
  hosted function's 4.5 MB request boundary. Direct/presigned upload is future
  work, not a bypass introduced by recovery.
- Repair the exact column grant while keeping identity/triage columns and RLS
  protected. Effective authenticated permission read-back plus an authorized
  saved receipt/row and same-key retry prove production delivery; READY,
  installed SHA, unauthenticated 401 and CORS 204 prove different contracts.
- F7 / BUG-272 owns executable scope and evidence. Material cross-surface visual
  adoption still needs the design-system gallery review; the Oct2 retired study
  is no longer acceptance for the changed retained-dialog flow.
- The operator rejected F7's first gallery as bulky. Retained continuity means
  the same report and modal, not a large receipt panel or permanently reserved
  explanation space. The compact refinement shares action/focus/material rules
  with Cmd+K while using its own writing density. A visible image is attached,
  with one remove action; optional app details use a conventional checkbox and
  disclosure. Gallery test controls remain outside the specimen. Visual
  review retains the compact height motion with trailing hints, no redundant
  heading and optional purpose help; retry/certainty ownership does not change.

## Alternatives and consequences

| Alternative | Disposition / reason |
| --- | --- |
| Close immediately and animate only the final toast | Rejected: does not show the real sending/partial state and leaves draft races intact. |
| Treat every 2xx as complete success | Rejected: the existing receipt explicitly distinguishes image storage. |
| Generate a new key on retry | Rejected: an accepted request with a lost response can become a second report. |
| Add multiple images, persistent outbox and background retries now | Deferred: each widens the wire, retention or auth lifecycle contract beyond the current operator requests. |
| Force update notices into expiring toast behavior | Rejected: actionable update truth must survive a shared visual treatment. |

Server receipt/reconciliation semantics land before the new client retry path.
The operator explicitly authorizes adoption with receipt animation removed.
The implementation contains a renderer-lifetime draft/attempt store, typed
immediate receipts, shared Dialog presence/overlay presentation and a notice
placement owner. Server fingerprint reconciliation is integrated in `902ed1b5`
and its production deployment is READY; the migration has been applied/read
back. The simplified UI is verified and integrated in
`9d6b0d46da562d59de52f5cdff685d6ecaec3ae3`; the normal landing floor and declared
surface gates passed. The gallery study is retired. Combined UI deployment is READY;
actual dogfood installation is confirmed by update-state read-back of the exact
client SHA, not inferred from a queued worker. Shared review evidence lives in
[ENG-036's project doc](../projects/design-system-of-record.md#2026-10-02--app-wide-review-shapes-paired-flows-and-shared-foundations).
ENG-025 F7 now owns reporting recovery and acceptance through the roadmap's
project reference. The above Oct2 deployment/install evidence does not establish
authenticated delivery; incident 0032 and F7 record its correction.
