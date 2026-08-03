# Objective Engine

Roadmap item: ENG-021

This is execution detail for ENG-021, not a separate roadmap. The engine turns
bounded operator-authored evidence into durable context cues at the right
granularity. E1 owns Session labels and the feedback/evaluation loop; later
slices may add current sub-objectives, turns, Projects, and Initiatives without
changing the Session-label contract.

## E1 — Session context labels and feedback loop

Status: E1 implemented and verified 2026-07-24; E1.1 Session comparison
projection implemented and verified 2026-07-26; E1.2 executable corpus and
E1.3 live-provider closure implemented and verified 2026-08-02

### Product contract

- A label answers why the Session exists and what work-world the operator needs
  to page back in. It describes durable intent, not the latest command output.
- A necessary subtask, revision, or direct continuation keeps the label. A
  newer durable purpose that changes the primary object or intended outcome
  enough to stand as its own Initiative replaces it, even inside the same app,
  Project, or Session. Returning to an earlier topic may restore that topic's
  label.
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

### Intake evidence — 2026-07-27

Feedback row `91c90593-a712-46ad-a4ff-3ceaa5ba7408` arrived through the label
**correction** affordance with `sentiment: -1`, but it is not a label judgment.
The shown label ("Debug Divvy shortcuts in Exawatt") was accurate; the operator
used the correction field to report a tab-strip layout defect, which is now
queued in the daily-driver adoption findings log.

Two consequences worth holding:

- **The corpus must not ingest this row.** A naive promotion of
  `context.betterLabel` into `src/lib/context-labels/gold-cases.ts` would train
  the labeler toward "It's a two-row tab with truncated text, yet whitespace in
  the right 40%" as the correct objective for that Session. Corpus additions
  stay a judged step, never an automatic one — this row is the first concrete
  case proving why.
- **A negative label vote is not always a label signal.** The correction box is
  the nearest writable surface when something on the strip looks wrong, so
  `context_label` sentiment cannot be read as label quality without inspecting
  the message. Any future accuracy metric derived from vote counts needs this
  confound stated.

### Intake evidence — 2026-08-02

Feedback row `36e966ec-d534-4aaa-845c-8c4f0d9d7300` is a genuine stale-label
correction. The Session still showed **Close projects with animation** after
its work-world had pivoted to production Agent Source architecture, Settings,
composer behavior, source-truth reconciliation, and delivery validation. The
operator replaced it with **Trustworthy agent sources and launch UX**.

This is corpus-worthy evidence for a delayed multi-turn pivot: mechanical
follow-ups should preserve a label, but a later implementation initiative that
changes both the product object and intended outcome must replace an older UX
label. A sanitized regression case was added to
`src/lib/context-labels/gold-cases.ts`; it retains the stale/current labels and
the semantic transition without copying raw Session content.

### Intake evidence — 2026-08-03

Feedback row `aa94ab2b-d8aa-4983-8cd7-b8a15537ff19` is a label correction on
the `exawatt` Project: the Session showed **Research subagent activity
visualization design** and the operator replaced it with **Improve spatial
UI**. The shown label read as a research framing of a single early
instruction; the operator's correction names the work-world at the altitude
they actually think in — the surface being improved, not the method being
used. Gold-corpus candidate: an over-specific method-flavored label vs the
operator's terser object-flavored one; a sanitized case needs the Session's
instruction sequence to be reconstructed before it can be added, so this note
records the candidate rather than the case.

Feedback row `51e51b1f-3cb6-4fdb-872b-767f1fc622a2` is a second genuine label
correction on the `exawatt` Project. The Session showed **Redesign Exawatt app
icon with transparent background** and the operator replaced it with **New app
icon**. The correction removes solution method and asset-production detail in
favor of the short work-world name the operator would use to find the Session.

Feedback row `ff068da3-017a-4cf0-bddd-2ebab2e19c47` repeats that altitude
correction. The Session showed **Verify ENG-003 S2 opencode config merge
behavior** and the operator replaced it with **OpenCode support + improved
new-agent UI**. The rejected label overfit to a verification step and roadmap
slice; the correction names the durable capability and adjacent product
surface. It is a gold-corpus candidate, but the row does not contain the
instruction sequence needed to build an honest executable case.

This reinforces the same altitude signal as the **Improve spatial UI** case:
labels should identify the durable object/outcome, not narrate the current
implementation instruction. It is a gold-corpus candidate, but the feedback row
does not carry the source instruction sequence. A sanitized executable case
must reconstruct that sequence from the attributed durable Session before it is
added; this drain records the evidence and does not invent missing inputs.

### 2026-08-02 — E1.2 executable gold-corpus gate

The corpus had become durable evidence but still depended on a reviewer to
judge outputs by inspection. It now carries explicit semantic anchors and
optional stability thresholds, and the repository evaluator reports per-case
diagnostics for required concepts, pivots, and output hygiene. The bounded test
suite executes every committed case without provider access. An opt-in live
command runs the production Anthropic request and parser against the same cases
when credentials are intentionally available; local verification never turns a
fixture into a claim about current provider behavior.

### 2026-08-02 — E1.3 live-provider closure and pivot semantics

The first credentialed run of the executable corpus passed five of six cases
and reproduced the production Agent Source correction: **Close projects with
animation** survived even after newer work established a separate Agent Source
initiative. The prompt had treated only a “genuinely unrelated” purpose as new
context, which was too coarse: two durable initiatives can share an app,
Project, and Session while differing in both primary object and intended
outcome.

The classifier now decides relationship before wording, treats the current
label as a prior hypothesis rather than a veto, and distinguishes a necessary
subtask/direct continuation from a newer purpose that could stand as its own
Initiative. Accepted or operator-authored labels resist mechanical churn but
not a clear durable-purpose pivot. Temperature is zero because this is stable
classification and retrieval copy, not creative generation. The live command
loads `.env.local` explicitly, so a green provider run is evidence about the
current configured model rather than the invoking shell's accidental exports.
Repeated live verification also caught a nondeterministic output that replaced
the explicit person anchor **Patty** with generic patient-record language.
Named-entity retention is therefore explicit and mandatory when a person,
company, product, or Project name distinguishes the work; low temperature is a
stability aid, not a substitute for that semantic contract.

## Roadmap milestone log

### 2026-07-26 — E1.1 Session comparison and titleless-tab incident

Operator report: the production Sessions cards were visually hard to read and
their body content consisted of raw terminal chrome (model/context meters,
branch state, permission hints, and prompt suggestions). A neighboring Agent
tab rendered only its source and status icons with no title.

The titleless tab was reproduced against the live persisted workspace. The
Session itself was intact: its title was the default `Claude Code`, its
`titleKind` was `default`, and its initial task remained present. Its prior
markdown-formatted context label had been rejected by the current label-hygiene
contract during restore, leaving `contextSummary` empty. D22 then deliberately
suppressed the default source title. Each subsystem behaved as designed, but
their composition had no visible text fallback. This is a product-policy
failure, not missing Session identity.

Resolution:

- supersede D22's glyph-only default-Agent rule with one total display
  projection shared by Terminal tabs and Sessions cards: durable context label,
  then explicit operator title, then **New agent**;
- percolate the reviewed `/hud-gallery` region/question tile treatment into the
  production Sessions overview with readable sans body tiers;
- retire raw xterm/scrollback previews from Sessions. Cards show only known
  turn/lifecycle/attention truth and declared or inferred roadmap plan state;
  when no plan source exists they say **No plan reported**;
- keep provider identity and compact state metadata in glyph/mono roles while
  all operational sentences and goals use the readable sans roles.

Verification completed 2026-07-26:

- the bounded full suite passed 120 files / 870 tests, including the exact
  live-state shape (`default` Agent title + missing context), blank/corrupt
  title strings, drafts, stopped Sessions, operator renames, roadmap links,
  and raw-terminal exclusion;
- lint, renderer type-check, Electron-main compilation, and the production
  Next.js build passed;
- the six-viewport workspace chrome evaluator passed, asserting visible **New
  agent** fallback, durable context identity, 16/15/14px title/current/plan
  tiers, 24px operational line height, sans body copy, and zero terminal-buffer
  leakage, with production screenshots;
- the real Electron Terminal → Sessions → Spatial → exact Session-return
  evaluator passed with the same computed typography and content assertions;
- the Project/Agent launcher and lifecycle evaluator passed its full close,
  archive, immediate `⌘⇧T`, LIFO restore, relaunch, and Project-retraction flow.

## Prior roadmap milestone log (moved from roadmap.md, 2026-07-24)

On 2026-07-24 `docs/engineering/roadmap.md` was compressed to its contract —
status, concise scope, exit criteria, a one-line milestone list, and links —
so the top-level sequence is readable in one screen. The milestone narratives
and status history that lived in the roadmap until that date are preserved
verbatim below, exactly as written, including their dates. The roadmap remains
canonical for sequence and status; this log is the durable execution detail it
points to. Nothing here is new material: it is the ENG-021 roadmap entry as it
stood on 2026-07-24.

<!-- Verbatim: docs/engineering/roadmap.md ENG-021 entry, 2026-07-24. Do not reword. -->

### ENG-021 Objective engine — context at every granularity

Status: active-build — design pass, E1 Session-context labels, and the reusable
authenticated feedback intake were implemented and verified on 2026-07-24;
later Objective Engine granularities remain planned

Direction (operator framing): context text should answer “why does this
Session exist / what was I working on / why was I doing it?” quickly enough to
page the work-world back into memory. It is not a live activity ticker. A
related follow-up keeps the established label; a genuinely unrelated operator
instruction establishes a new work-world; returning to an earlier work-world
may restore its label. Sessions used as a scratchpad still receive the best
current topic guess rather than a blank or model control token.

The first executable slice replaces W0.4's periodic, output-volume-driven local
CLI subtitle guess with an authenticated, server-owned inference path triggered
by submitted operator instructions. Electron retains and persists the last good
label across offline/provider failures. A new Session may temporarily show a
meaningful launch instruction; an attachment-only launch shows **New agent**,
never a temporary file path. The server uses bounded, redacted operator evidence
and structured output; it does not persist inference excerpts. See the
[Objective Engine project](projects/objective-engine.md) and decision `0019`.

The same slice adds authenticated product feedback available to every signed-in
user. Fast label votes and exact-label corrections write through the general
feedback intake; **Help → Submit Feedback…** accepts broader bugs, ideas, text,
and optional screenshots. Production feedback is evidence. A sanitized,
versioned gold corpus in the repository remains the reproducible tuning and
regression gate.

Builds on ENG-015 S4 context paging and ENG-016 D21's durable-Session storage,
but explicitly supersedes the `KEEP` / `NO_GOAL` control-token prompt and PTY
output sweep as the Session-label decision mechanism. Recap generation remains
a separate “what changed while away?” concern.
