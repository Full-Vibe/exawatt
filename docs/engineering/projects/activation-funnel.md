# ENG-047 Activation funnel: visit, download, first launch, first Project, first Agent, return

Owning roadmap item: `docs/engineering/roadmap.md` → ENG-047. Execution detail, not an independent roadmap. Decision `0053` records the operator's choice and the event set.

## Outcome

The operator opens one PostHog dashboard and reads, for the people he is
talking to this week: who visited and from which site, who downloaded, who
launched, who opened a Project, who started an Agent, who came back the next
day, and where each cohort stopped. No names, no paths, no task text, no
session replay.

## What exists

One PostHog client (`src/lib/analytics/`) serves the website and the Electron
renderer; the main process queues typed events through `analytics-bridge.ts`.
Four allowlisted events (`app_launched`, `sign_in_attempted`,
`hosted_call_failed`, `app_crashed`) plus redacted `$exception`; autocapture,
page views, replay, heatmaps and flags are off; `distinct_id` is an anonymous
installation UUID in `localStorage`; ingest rides `/ingest` on `exawatt.ai`
(decision `0034`). The allowlist is enforced in `events.ts` and `redact.ts`
and mirrored in `docs/engineering/outbound-data.md` §1, the Privacy page and
their tests, which fail when the three drift. Community builds carry no
analytics (decision `0036`).

## Milestones

- **F0 Stable installation id (BUG-171).** Move the analytics opt-out and the
  installation id into the Electron settings store so a fallback-port launch
  neither forgets the opt-out nor mints a new id. Prerequisite for every
  install-level count.
- **F1 Events.** Add `page_viewed`, `download_requested`, `project_opened`,
  `agent_launched`, `agent_directed` with exactly the properties decision
  `0053` names; extend the allowlist, the redactor, the manifest, the Privacy
  page and the tests in one landing. `page_viewed` fires on route change in
  the website shell only (never in the Electron renderer); `download_requested`
  fires server side in `/download/artifact`; `project_opened` fires in the
  registry's open verbs with the `source` the chooser passes; `agent_launched`
  fires in `pty:create` after the launch is accepted; `agent_directed` fires
  from ENG-004 V4.2's Direct.
- **F2 The web-to-app link.** The download page shows "Open Exawatt" after a
  download, as `exawatt://welcome?w=<web distinct id>`; the app's deep-link
  handler (`electron/main/deep-link.ts`, beside `auth/callback`) records the
  alias once and shows nothing new. Disclosed beside the button. No clipboard,
  no token in the DMG.
- **F3 Dashboard.** One funnel insight and one "stuck" insight in the
  Exawatt PostHog project, with the week's cohort as a filter; linked from the
  private operator notes, not the product.
- **F4 Read-back.** After the first full day, compare PostHog's install count
  with the Supabase update-feed downloads and record the ratio, so decision
  `0034`'s warning (first-party ingest "will look higher") is calibrated
  rather than guessed.
- **F5 Signed-in activity stream** (decision `0053`, amended 2026-10-15). A
  new account-keyed Supabase table (the dormant `activity_events` is
  task-shaped and is replaced) receives, for signed-in accounts only, the
  activation events plus Session-level activity: opened, launched, directed,
  finished, with harness and placement, never prompt or output text and
  never a path. Written from the main process through the existing
  authenticated client; disclosed at sign-in and on the Privacy page; read by
  the operator in Supabase (an in-app admin view is a later question).
  Migrations are validated in PGlite before `supabase db push`.

## Ownership boundaries

- `src/lib/analytics/` owns the allowlist and the redactor; no surface
  captures an event by string literal.
- The outbound-data manifest and the Privacy page are edited in the same
  landing as the allowlist, by construction of the existing tests.
- ENG-046 and ENG-004 call the events; they do not define them.

## Acceptance

- Every new event appears in `outbound-data.md` §1 and the Privacy page with
  its exact property list, and `manifest.test.ts` passes.
- A redacted `page_viewed` carries `path` and `referrer_host` only; a URL with
  a query string, a UTM or a click id yields the same event with none of it.
- A community build sends nothing (existing test extended to the new events).
- The deep link records one alias per installation and ignores repeats and
  malformed ids.
- The funnel shows the operator's own fresh-install run end to end.

## Roadmap milestone log

### 2026-10-14 — created from the operator brief and decision `0053`
