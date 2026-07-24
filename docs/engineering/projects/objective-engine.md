# Objective Engine

Roadmap item: ENG-021

This is execution detail for ENG-021, not a separate roadmap. The engine turns
bounded operator-authored evidence into durable context cues at the right
granularity. E1 owns Session labels and the feedback/evaluation loop; later
slices may add current sub-objectives, turns, Projects, and Initiatives without
changing the Session-label contract.

## E1 — Session context labels and feedback loop

Status: implemented and verified 2026-07-24

### Product contract

- A label answers why the Session exists and what work-world the operator needs
  to page back in. It describes durable intent, not the latest command output.
- A related follow-up keeps the label. A genuinely unrelated submitted
  instruction replaces it. Returning to an earlier topic may restore that
  topic's label.
- The engine always returns its best topic guess. It never exposes `KEEP`,
  `NO_GOAL`, a model explanation, or an attachment/temp-file URI.
- A new Session gets immediate zero-network copy from a meaningful launch
  instruction. Attachment-only or otherwise non-semantic launches show
  **New agent** until inference succeeds.
- Provider, quota, auth, and network failures retain the last good label and
  retry after later operator evidence. They never erase or locally re-guess it.

### Ownership and boundaries

- The renderer identifies authenticated user state and sends access-token
  updates through trusted preload IPC. Provider credentials stay server-only.
- Electron main captures submitted human instructions at the existing atomic
  operator-engagement/write boundary, keeps a small recent evidence window per
  durable Session, redacts common secret shapes, coalesces newer requests, and
  calls the hosted endpoint. PTY output volume cannot trigger a label change.
- The authenticated hosted endpoint enforces request bounds and per-user quota,
  treats evidence as untrusted data, and requires schema-shaped model output.
  It returns a label, same/new-context relationship, and confidence. It does
  not persist inference evidence or write it to normal logs.
- Electron main remains the durable runtime owner for accepted labels. The
  renderer persists them with workspace state and consumes one source-agnostic
  context event.
- There is one inference implementation. A deterministic local fallback would
  create a competing semantic system; Exawatt instead retains the last good
  label and uses **New agent** only as the explicit empty-state fallback.

### Feedback and evaluation

- All authenticated users can submit general feedback. The native Help item is
  visible but disabled as **Sign in required** when signed out.
- A tab exposes a fast positive vote and a negative vote with an optional exact
  better label. A submitted correction updates the Session immediately and is
  recorded as context-label feedback.
- The general intake accepts bug/idea/general/context-label kinds, bounded text,
  surface/build/platform context, and an optional private screenshot.
- Production rows are raw evidence, not automatic training data. Sanitized
  reviewed cases are promoted into the repository's fixed corpus so prompt or
  model changes can be compared reproducibly.

### Acceptance criteria

- The stale-label regression pivots from **Implement cmd+shift+t to reopen
  tabs** to **Improve agent context summaries** after the operator changes the
  Session's purpose.
- Launching an Agent with only an image path never renders that path; it shows
  **New agent** until a meaningful label is available.
- Related follow-ups remain stable, true pivots replace the label, and a stale
  response cannot overwrite a newer request.
- Signed-out, over-quota, offline, timed-out, malformed-model-response, restart,
  and provider-error cases retain safe UI state and never expose secrets or raw
  evidence in server logs.
- Feedback authentication, row ownership, idempotency, payload bounds, private
  attachments, keyboard operation, focus behavior, and optimistic correction
  are covered by automated tests.
- A committed gold corpus includes real dogfood regressions and can score
  fidelity, stability, pivots, and output hygiene without production access.

### Verification evidence

- The bounded Vitest suite passed 107 files / 738 tests, including contract,
  API, Electron-main state-machine, and feedback-component coverage.
- Lint, renderer type-check, Electron compilation, and the production Next.js
  build passed.
- The hidden Electron evaluator passed the stale-label pivot, attachment-only
  **New agent** fallback, redaction, failure retention, hover controls, exact
  correction, general feedback, screenshot, relaunch, and persistence checks.
- Existing draft/paste and offline-authority Electron evaluators passed.
- The production Supabase migration was applied; an authenticated database
  evaluator passed owner-only rows, idempotency, anonymous denial, private
  attachment ownership, wrong-folder denial, and cleanup.
