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
- **F5 Signed-in activity stream** (decision `0053`, amended 2026-10-15;
  operator: "PH for both"). For signed-in accounts only, the activation
  events plus Session-level activity (opened, launched, directed, finished,
  with harness and placement; never prompt or output text, never a path) are
  captured under a second PostHog distinct id, the account id. No
  `identify`, no alias: the installation person and the account person stay
  two people, so the funnel's anonymous install is never joined to a name,
  and `0031`'s separation holds. Disclosed at sign-in and on the Privacy
  page; read by the operator in PostHog beside the funnel. No new Supabase
  table.

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

### 2026-10-15 — F0: the opt-out and the installation id are main's

BUG-171 closed. Electron main holds the analytics record in `settings.json`
(`analytics: { optedOut, installationId? }`, parsed by
`parseAnalyticsDeviceRecord` in the settings schema, forward-compatible so an
older build never quarantines the file over it). The renderer reads it
through `analytics:identity` and writes the switch through
`analytics:set-opt-out` (`electron/main/analytics-identity.ts`,
`src/lib/analytics/identity.ts`). A launch on a fallback port reads the same
answer as every other launch, and the desktop SDK now keeps its state in
memory (`persistence: 'memory'`), so the loopback origin holds no analytics
state at all.

Choices made:

- **Migration is one offer, and an opt-out always wins it.** A desktop origin
  that kept the pre-F0 keys offers them with the identity read; a device
  without a record adopts both, a device with one keeps its own id, and a
  legacy opt-out overrides an opted-in record. The renderer deletes its copy
  once main answers, so the offer happens once per origin.
- **Reading is strict.** `readSettings` (new, shared with
  `readSafetyControls`) answers `unreadable` for an inaccessible or corrupt
  file; analytics then do not start that launch, and an id that could not be
  written is never used. Absence is not an answer.
- **Opting out forgets the id** (the client comment already claimed it did);
  opting back in mints a new one at the next launch.
- **Only a starting client mints.** The Privacy switch reads without
  `ensureId`, and a community build asks main nothing because the
  distribution decides before identity is read.

### 2026-10-15 — F1, F2 and F5: the events, the web-to-app link, the signed-in stream

**Ten allowlisted events, two streams, one join.** `events.ts` adds
`page_viewed`, `download_requested`, `project_opened`, `agent_launched`,
`agent_directed` (decision `0053`'s exact properties) and `agent_finished`
(the amendment's "finished", account stream only). `outbound-data.md` §1,
`/privacy` and their tests changed in the same landing; the Privacy page now
renders its event list from `src/lib/analytics/disclosure.ts`, which is typed
over the allowlist, so an event cannot reach the wire without reaching the
page.

| Event                | Where it fires                                                                                       | Properties                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `page_viewed`        | website only: the landing view in `instrumentation-client.ts`, then Next's `onRouterTransitionStart` | `path` (path only, identifier segments masked as `:id`), `referrer_host` (landing view only, external sites only) |
| `download_requested` | server, `/download/artifact`, in `after()`                                                           | `platform`, `arch` (from the artifact file name)                                                                  |
| `project_opened`     | the registry's open verbs, when the caller passes `{ source, harnessHint? }`                         | `source`, `harness_hint`, `bound`                                                                                 |
| `agent_launched`     | `pty:create`, after the launch is accepted; never a Shell                                            | `harness`, `placement` (`local` for every process main starts), `permission_mode`, `first_for_install`            |
| `agent_directed`     | allowlisted; P5's Direct calls `captureAnalyticsEvent`                                               | `recipients`, `delivered`                                                                                         |
| `agent_finished`     | main's `ptySessions` `exit` for an Agent it saw start                                                | `harness`, `placement`                                                                                            |

Every event also carries `allowlist_version` and `surface`.

Choices made:

- **`placement` is canon's `AgentSourcePlacement`** (`local`,
  `customer-hosted`, `exawatt-hosted`), so a hosted Agent can report into the
  same property later; every process `pty:create` starts is `local`.
- **`project_opened` needs a reason.** The verbs record only when the caller
  says why (`source`); registering the folder an Agent launched in, or a
  reconcile, records nothing. Wired today: the chooser's Browse (`browse`)
  and its Project list (`recent`), curated import (`import`), Connect
  (`connect`). ENG-046 P1 passes `suggested` with the harness hint. The ⌘K
  palette's Project rows reach `requestOpenProject(dir)` and pass no source
  yet.
- **An unknown `source` drops the event** rather than filing it under a
  guessed one.
- **`download_requested` is keyed by the visitor's web id**, which the
  download page appends (`w`) only while analytics run in that browser; no id,
  no event, so an opted-out visitor, whose choice lives in their own browser,
  is never counted server side.

**F2, the link.** After a click on Download, the page offers "Open Exawatt"
(`exawatt://welcome?w=<web id>`, or no `w` when analytics are off) with its
disclosure beside the button. `deep-link.ts` routes `welcome` to
`recordWebLink`, which accepts a lowercase UUID only, claims
`settings.json` `analytics.webLinked` once (never while opted out, never on
an unreadable file), and queues `web_alias` on the bridge; the renderer posts
one `$create_alias` from the installation id to the web id. Repeats and
malformed ids record nothing, and the app shows nothing new beyond coming
forward.

**F5, the mechanism.** `posthog-js` keeps one distinct id per instance and
refuses `alias()` with `person_profiles: 'never'`, so three sends post
straight to the configured ingest origin (`<ingestOrigin>/batch/`,
`src/lib/analytics/ingest.ts`) with an explicit `distinct_id`, through the
same allowlist (`scrubEventProperties`) and only after the same decision: the
server's `download_requested`, the alias, and the account stream. The account
stream (`account-stream.ts`) runs in the desktop renderer, reads the signed-in
account from the account client's own session (`onAuthStateChange`, no
request), and for `app_launched`, `project_opened`, `agent_launched`,
`agent_directed` and `agent_finished` posts a record whose `distinct_id` is
the account UUID and whose properties are the event's declared ones and
nothing else. No `identify`, no alias, no installation id, no SDK device or
session id. Events captured before the session answers wait (bounded) and
are then sent or dropped. Chosen over a main-process sender because the
renderer already owns the decision, the opt-out and the allowlist, and main
holds no analytics configuration (`community-closure.test.ts` pins that);
chosen over a second `posthog-js` instance because a memory-persisted second
instance would still attach its own device and session ids. Main's part is
only what it alone observes: Agent processes starting and ending, and the
link. Disclosed on the sign-in and sign-up pages (`AccountActivityNotice`,
official builds only) and on `/privacy`.

**F0 follow-up.** The device record also holds `agentLaunched` and
`webLinked`; opting out forgets the id and keeps those facts, so opting back
in does not claim a second first launch. A record without an id now adopts a
legacy origin's id rather than minting one.

### 2026-10-15 — F3: the dashboard, as definitions

No PostHog personal API key is in this worktree's environment (only the
public project key, `NEXT_PUBLIC_POSTHOG_KEY`), so the insights were not
created through the API. These are the exact definitions; create them in the
Exawatt PostHog project (SQL insight, paste the `query` object, or New
insight → SQL and paste the `query.query` text), put them on one dashboard
named "Activation funnel", and link it from the private operator notes. They
have not been run against live data yet; the first fresh-install run is the
check (exit criterion).

Shared rules, both insights:

- A person is an installation (or a browser), merged with its web id when
  the "Open Exawatt" alias exists. The signed-in account stream is excluded
  (`$lib = 'exawatt-account-stream'`), so an account never counts twice.
- `{filters}` binds the insight's date range: set it to the week of the
  cohort being read. The funnel's steps must happen in order inside that
  range.
- Day-2 return is a desktop launch on a later calendar day than the first
  one, derived here from `app_launched` (decision `0053`: never sent).

**Insight 1, "Activation funnel"** (visit → download → first launch → first
Project → first Agent → day-2 return):

```json
{
  "kind": "DataVisualizationNode",
  "source": {
    "kind": "HogQLQuery",
    "filters": { "dateRange": { "date_from": "-7d" } },
    "query": "WITH people AS (SELECT person_id, minIf(toUnixTimestamp(timestamp), event = 'page_viewed') AS visit, minIf(toUnixTimestamp(timestamp), event = 'download_requested') AS download, minIf(toUnixTimestamp(timestamp), event = 'app_launched' AND properties.surface = 'desktop') AS launch, minIf(toUnixTimestamp(timestamp), event = 'project_opened') AS project, minIf(toUnixTimestamp(timestamp), event = 'agent_launched') AS agent, minIf(toDate(timestamp), event = 'app_launched' AND properties.surface = 'desktop') AS first_day, maxIf(toDate(timestamp), event = 'app_launched' AND properties.surface = 'desktop') AS last_day FROM events WHERE {filters} AND event IN ('page_viewed', 'download_requested', 'app_launched', 'project_opened', 'agent_launched') AND coalesce(properties.$lib, '') != 'exawatt-account-stream' GROUP BY person_id), reached AS (SELECT visit > 0 AS s1, s1 AND download >= visit AS s2, s2 AND launch >= download AS s3, s3 AND project >= launch AS s4, s4 AND agent >= project AS s5, s5 AND last_day > first_day AS s6 FROM people) SELECT step, people FROM (SELECT 1 AS n, 'Visited the site' AS step, countIf(s1) AS people FROM reached UNION ALL SELECT 2, 'Downloaded', countIf(s2) FROM reached UNION ALL SELECT 3, 'Launched the app', countIf(s3) FROM reached UNION ALL SELECT 4, 'Opened a Project', countIf(s4) FROM reached UNION ALL SELECT 5, 'Started an Agent', countIf(s5) FROM reached UNION ALL SELECT 6, 'Came back on a later day', countIf(s6) FROM reached) ORDER BY n"
  },
  "display": "ActionsBar"
}
```

The `minIf(...) > 0` tests rely on ClickHouse returning 0 for a `minIf` with
no matching row; a step a person never reached is 0 and fails every later
comparison.

**Insight 2, "Where installs stop"** (installs with a launch and no Project;
a Project and no Agent; an Agent and no second launch), with up to ten
example person ids per stage so the operator can open one in PostHog:

```json
{
  "kind": "DataTableNode",
  "source": {
    "kind": "HogQLQuery",
    "filters": { "dateRange": { "date_from": "-7d" } },
    "query": "SELECT multiIf(projects = 0, '1. Launched, no Project', agents = 0, '2. Project, no Agent', launches < 2, '3. Agent, no second launch', '4. Came back') AS stopped_at, count() AS installs, groupArray(10)(toString(person_id)) AS examples FROM (SELECT person_id, countIf(event = 'project_opened') AS projects, countIf(event = 'agent_launched') AS agents, countIf(event = 'app_launched') AS launches FROM events WHERE {filters} AND event IN ('app_launched', 'project_opened', 'agent_launched') AND properties.surface = 'desktop' AND coalesce(properties.$lib, '') != 'exawatt-account-stream' GROUP BY person_id HAVING launches > 0) GROUP BY stopped_at ORDER BY stopped_at"
  }
}
```

**Beside them, the signed-in activity stream** (F5), one row per event, the
account UUID as the person; join it to a name in Supabase, never in PostHog:

```json
{
  "kind": "DataTableNode",
  "source": {
    "kind": "HogQLQuery",
    "filters": { "dateRange": { "date_from": "-7d" } },
    "query": "SELECT timestamp, distinct_id AS account, event, properties.harness AS harness, properties.placement AS placement, properties.source AS opened_from, properties.recipients AS recipients, properties.delivered AS delivered FROM events WHERE {filters} AND properties.$lib = 'exawatt-account-stream' ORDER BY timestamp DESC LIMIT 500"
  }
}
```
