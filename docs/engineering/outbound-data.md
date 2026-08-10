# Outbound data manifest

**Every network destination the Exawatt client can reach, what leaves the
machine for each, and how to turn each one off.**

Decision `0031` requires the repository to carry this manifest; decision `0034`
requires it to describe the analytics proxy explicitly. It is engineering
canon, not marketing copy: if the code and this file disagree, the file is a
bug. Verify it against the source before trusting it — every row names the file
that makes the call.

Audited 2026-08-06 for ENG-030 OS1.1/OS1.2.

## The one thing that surprises people

The packaged desktop app does not load a remote page. `electron/main/main.ts`
extracts the renderer and starts a **package-local Next server on
`http://127.0.0.1:<random ephemeral port>`**. So a renderer `fetch('/api/...')`
goes to loopback, and any onward call is made **from the user's own machine**.

That is why analytics get special treatment (below): a relative `/ingest` in
the desktop renderer would have made the user's machine talk to PostHog
directly — the exact outbound identity decision `0034` exists to prevent.

## Summary

| Destination | Category | Default | Off switch |
| --- | --- | --- | --- |
| `www.exawatt.ai/ingest` → PostHog (`us.i.posthog.com`, `us-assets.i.posthog.com`) | Product analytics | On in production builds | Runtime opt-out; `NEXT_PUBLIC_ANALYTICS_DISABLED`; omit `NEXT_PUBLIC_POSTHOG_KEY`; redirect via `NEXT_PUBLIC_POSTHOG_HOST` |
| `www.exawatt.ai/api/context-labels` → `api.anthropic.com` | Hosted feature | On when signed in | Settings → Privacy → Session context labels; `EXAWATT_CONTEXT_LABELS=0` |
| `www.exawatt.ai/api/conversations/summarize` → `api.anthropic.com` | Hosted feature | On when signed in | Settings → Privacy → Conversation summaries |
| `www.exawatt.ai/api/goal-visuals` → `fal.run`, `*.fal.media` | Hosted feature | On when signed in | Settings → Privacy → Agent tile backgrounds |
| `claude` CLI → `api.anthropic.com` (the **user's own** Claude Code sign-in) | Own-account feature (re-entry recap) | On | Settings → Privacy → Since-you-left recaps; `EXAWATT_SUMMARIES=0` |
| `<project>.supabase.co` | Account, sync, feedback, stats | On when signed in | Sign out; individual features listed below |
| `<project>.supabase.co/storage/.../desktop-updates` | App updates | Always on in signed builds | No user switch (known gap) |
| Locally spawned agent harnesses | User's own tools | On user action | Do not launch an Agent |

Signed out, the desktop app is nearly silent: context labels, goal visuals,
conversation summaries, Project sync, feedback, and stats all short-circuit on
a missing access token. What still runs is the update check, the loopback
renderer, locally spawned agents, and — once shipped — product analytics.

---

## 1. Product analytics — PostHog, through Exawatt's own proxy

**Destination.** The client posts to `/ingest` on an Exawatt origin. Next
rewrites that to `https://us.i.posthog.com/:path*` and
`/ingest/static/:path*` to `https://us-assets.i.posthog.com/static/:path*`
(`next.config.ts`). The desktop app's only analytics destination is
`exawatt.ai`.

Proxying is not concealment. The rewrite is in open-source configuration, the
destination is named here, and the Privacy page says analytics are relayed to
PostHog through Exawatt. What it buys is a single stable outbound identity on
the user's machine (ENG-016 D17, incident `0002`), not deniability.

**Host resolution** (`src/lib/analytics/config.ts`):

| Surface | `api_host` | Why |
| --- | --- | --- |
| Hosted web app | `/ingest` (relative) | Same-origin; the rewrite runs on the hosted deployment |
| Packaged desktop app | `https://www.exawatt.ai/ingest` (absolute) | Relative would resolve to the loopback renderer server, making the user's machine the thing that talks to PostHog |
| Any surface with `NEXT_PUBLIC_POSTHOG_HOST` | that value | Distributor redirect or self-host |

**What is sent.** Four events and nothing else. The complete property set:

| Event | Properties |
| --- | --- |
| `app_launched` | `allowlist_version`, `surface` (`desktop`\|`web`), `platform` (`darwin`\|`win32`\|`linux`\|`web`\|`unknown`), `delivery` (`signed`\|`dogfood`\|`hosted`\|`unknown`), `app_version` (version-shaped string or null), `signed_in` (boolean) |
| `sign_in_attempted` | `allowlist_version`, `surface`, `method` (`google`\|`github`\|`password`\|`unknown`), `outcome` (`started`\|`succeeded`\|`failed`\|`unknown`), `failure` (closed enum or null) |
| `hosted_call_failed` | `allowlist_version`, `surface`, `service` (closed enum of the hosted endpoints above), `failure` (`network`\|`timeout`\|`unauthorized`\|`rate_limited`\|`quota_exhausted`\|`server_error`\|`invalid_response`\|`unknown`), `status_code` (integer 100–599 or null) |
| `app_crashed` | `allowlist_version`, `surface`, `scope` (`renderer`\|`main`\|`gpu`\|`utility`\|`agent_harness`), `reason` (`crashed`\|`killed`\|`out_of_memory`\|`launch_failed`\|`unresponsive`\|`unknown`), `app_version` |

Plus PostHog's `$exception` event, which `capture_exceptions` produces for an
uncaught renderer error. It is allowlisted the same way the four events above
are: exactly two crash payload properties may leave, and both are rebuilt
rather than forwarded.

| Property | What survives |
| --- | --- |
| `$exception_list` | Per exception: `type`, `value` (always `'<redacted>'`), `mechanism` (`type`, `handled`, `synthetic`), and `stacktrace.frames` reduced to `function`, `filename`, `lineno`, `colno`, `in_app`, `platform`, `lang` |
| `$exception_level` | One of `fatal`, `error`, `warning`, `log`, `info`, `debug`; anything else becomes `error` |

The message text is **removed** before send (`value: '<redacted>'`), and stack
frame locations are reduced to a path, so neither an error string nor a machine
path leaves. Exception type and stack shape remain, which is enough to group
crashes. Every other property in the crash payload namespace — `$exception_*`
or `$sentry_*`, including a property a future posthog-js release invents — is
dropped, so the SDK cannot widen this surface without a deliberate change to
`ANALYTICS_EXCEPTION_PROPERTIES`. `$exception_steps`, PostHog's free-text
breadcrumbs, is additionally denylisted; the SDK only emits it when
`error_tracking.exception_steps` is enabled, which this client never does.

Every event also carries PostHog's own SDK metadata: library version, browser
and OS class, screen size, timezone, session id, and the anonymous
installation id described below.

**What is never sent.** Prompts, agent responses, terminal content, source
code, repository or Project names, filesystem paths, filenames, diffs, task
text, credentials, environment values, and raw source or Session identifiers.
This is enforced structurally, not by convention:

- `src/lib/analytics/events.ts` is the only emission path, and every property a
  caller can set is a closed enum, a boolean, a bounded integer, or a
  shape-validated version string. There is nowhere to put free text.
- `src/lib/analytics/redact.ts` runs as PostHog's `before_send`: a
  non-allowlisted event is dropped outright, an allowlisted event keeps only
  its declared properties, `$exception` keeps only the two crash payload
  properties above, and person properties (`$set`, `$set_once`) are always
  discarded.
- URL-bearing properties (`$current_url`, `$pathname`, `$referrer`, `$title`,
  campaign parameters) are both denylisted in PostHog config and stripped in
  `before_send`. In the desktop app `$current_url` would otherwise carry
  `http://127.0.0.1:<port>/workspace/session/<id>`.
- Autocapture, session recording, surveys, heatmaps, web experiments, and
  pageview capture are all off. The SDK loads no remote script
  (`disable_external_dependency_loading`), which also keeps the desktop app's
  `script-src 'self'` CSP intact.

**Identity.** `distinct_id` is an anonymous UUID generated locally on first
launch and stored under `exawatt.analytics.installation-id.v1`. The client
never calls `identify()`, never sets person properties, and never sends an
Exawatt account id. Installation identity and account identity stay separate
(decision `0031`); `signed_in` is a boolean, never a user.

**Default.** On in production builds — official distributions and production
builds from the open-source repository. Never initialized in development or
test builds.

**How to turn it off.**

| Control | Effect |
| --- | --- |
| Runtime opt-out (`setAnalyticsOptOut(true)`, persisted at `exawatt.analytics.opt-out.v1`) | PostHog is never initialized on the next launch, and emission stops immediately in the current one |
| `NEXT_PUBLIC_ANALYTICS_DISABLED=1` at build time | Same, for a whole distribution |
| No `NEXT_PUBLIC_POSTHOG_KEY` | Same |
| `NEXT_PUBLIC_POSTHOG_HOST=https://your-sink/…` | Events go to your sink instead; Exawatt receives nothing |

All four suppress **initialization and emission**, not merely ingestion: when
analytics are off, `posthog-js` is never imported, so there is no queue and
nothing to flush later.

**Main-process coverage (ENG-030 OS1.5b).** Electron main observes facts worth
counting — its own hosted-call failures (sections 2–4) and process crashes —
but has no analytics path of its own: decision `0034` gives the desktop app
exactly one analytics destination, and it lives in the renderer. Main queues
typed `hosted_call_failed` / `app_crashed` events in a bounded in-memory
bridge (`electron/main/analytics-bridge.ts`, 16 events, drop-oldest, no
persistence), and the renderer drains them through the same allowlisted
emission path as every other event
(`src/lib/analytics-bridge/main-process-events.ts`, started from
`instrumentation-client.ts`). Every drained payload is re-validated against
the allowlist before emission; when analytics are off, the renderer still
drains and drops. Main never talks to any analytics host itself, and a
failure caused by the operator switching a feature off is never counted —
only genuine attempt-and-fail. Crashes at quit that no renderer drains are
accepted losses.

**Retention.** Events live in Exawatt's PostHog project under that project's
retention settings. The proxy does not store a copy. PostHog project retention
is dashboard state and is not verifiable from this repository.

---

## 2. Hosted context labels — `www.exawatt.ai/api/context-labels`

- **Called by** `electron/main/pty/context-summarizer.ts` (Electron main, not
  the renderer). **Server** `src/app/api/context-labels/route.ts`.
- **Sent** (≤32 KB JSON): the durable session key, **the Project display name
  in cleartext**, the current label, the **initial operator instruction**, and
  **up to eight recent operator prompts** (≤1600 characters each) with
  timestamps. No redaction is applied on this path.
- **Onward**: the request JSON is forwarded verbatim as the user message to
  `api.anthropic.com/v1/messages` (`ANTHROPIC_CONTEXT_MODEL ??
  ANTHROPIC_SUMMARY_MODEL ?? claude-haiku-4-5`), using Exawatt's key.
- **Purpose**: the label on an Agent tab and Session.
- **Default**: on, and only when signed in.
- **Off**: `EXAWATT_CONTEXT_LABELS=0` or `EXAWATT_SUMMARIES=0`;
  `EXAWATT_CONTEXT_LABEL_ENDPOINT` redirects it. **There is no user-facing
  toggle** — a known gap, and the highest-exposure hosted path in the app.
- **Retention**: a per-user quota row (`claim_context_label_quota`); the
  evidence itself is not persisted by the route. Anthropic's retention for API
  traffic applies upstream.

## 3. Hosted conversation summaries — `www.exawatt.ai/api/conversations/summarize`

- **Called by** `electron/main/pty/conversation-catalog.ts`. **Server**
  `src/app/api/conversations/summarize/route.ts`.
- **Sent** (≤40 KB): up to eight conversations as `{ key, turns[] }`, where
  `key` is an opaque `harness:id` (no path, no Project name) and `turns` are
  user-turn excerpts read from local Claude Code / Codex transcripts,
  truncated to 700 characters each. Secrets are stripped before send
  (`redactHostedSummaryText`: PEM blocks, `sk-`/`sk-ant-`/`xox*`/`ghp_`/`npm_`/
  `AIza`/`AKIA` tokens, JWTs, and `password:`/`api_key=`/`authorization:`
  values).
- **Onward**: `api.anthropic.com/v1/messages` (`ANTHROPIC_SUMMARY_MODEL ??
  claude-haiku-4-5`).
- **Purpose**: titles and short summaries in the conversation browser.
- **Default**: on when signed in.
- **Off**: Settings → Preferences → automatic hosted summaries
  (`src/app/settings/notifications-settings.tsx`);
  `EXAWATT_CONVERSATION_SUMMARY_URL` redirects it.

## 4. Goal visuals — `www.exawatt.ai/api/goal-visuals` → fal.ai

- **Called by** `electron/main/pty/context-summarizer.ts`. **Server**
  `src/app/api/goal-visuals/route.ts`, `src/lib/goal-visuals/server.ts`.
- **Sent to Exawatt** (≤2 KB, three fields): `schemaVersion`, `projectKey` —
  a SHA-256 digest of the project directory or name, so the path never leaves —
  and `label`, the accepted context label (≤72 characters).
- **Sent to fal.ai**: **not the label.** Bytes of the identity digest index
  fixed scene/palette/atmosphere/composition tables to build a generic
  landscape prompt plus a deterministic seed (`goalVisualProviderPrompt`).
  fal.ai receives no Exawatt content. `X-Fal-Store-IO: 0` is set.
- **Onward**: the generated image is fetched from an allowlisted `*.fal.media`
  URL and cached in Supabase Storage under `<userId>/<identityKey>.jpg`.
- **Default**: on when signed in.
- **Off**: Settings → Privacy → Agent tile backgrounds (also "Backgrounds" in
  Team's chrome — same preference); `EXAWATT_GOAL_VISUAL_ENDPOINT` redirects it.

## 5. Supabase — account, sync, feedback, stats

Project `NEXT_PUBLIC_SUPABASE_URL`. Reached by the renderer
(`src/lib/supabase/client.ts`) and by Electron main
(`electron/main/auth-coordinator.ts`).

| Surface | Sent | Default |
| --- | --- | --- |
| OAuth (Google/GitHub) and email/password | PKCE exchange; the provider consent page opens in the **system browser**, not in the app | On explicit user action |
| Session refresh | refresh token | Signed in |
| Project registry (`src/lib/projects/registry.ts`) | Project name, **full absolute local path**, color, order, last opened | Signed in, on every Project open |
| Product feedback ⌘⇧F (`/api/feedback`) | Message text, kind, sentiment, surface, app version, build SHA, platform, context (URL, viewport, Project name, durable session id), optional **screenshot of the app window** | Only when the user submits |
| Operator profile / stats (`/api/operator-stats`) | GitHub identity plus numeric day and Run aggregates; no Project, path, or prompt data | **Off by default, switch-governed** (decision `0029` amended 2026-08-10): the Publishing switch (leaderboard panel, and Settings → Privacy → Public operator profile — `operatorProfile.autoPublish`) is the consent act; while on, syncs run automatically (shortly after launch, then ~6-hourly, `src/lib/operator-stats/auto-sync.ts`); off or absent means nothing is scanned or sent; `DELETE` removes the profile and pauses publishing |
| Public leaderboard/profile reads | nothing outbound; anonymous reads | Only when visiting `/leaderboard` or `/operator/<handle>` |
| Quota RPCs | `claim_*_quota` calls for the three hosted features | With those features |

Turn all of it off by signing out; the app remains fully usable for local Agent
work and Demo Mode without an account.

## 6. App updates — Supabase Storage

- `electron/main/updater.ts` via `electron-updater`, feed
  `https://<project>.supabase.co/storage/v1/object/public/desktop-updates/macos/arm64`
  (`electron-builder.yml`).
- Fetches `latest-mac.yml`, then the release zip. Unauthenticated against a
  public bucket; sends only what an HTTP request implies (IP, user agent).
- Runs five seconds after launch in packaged **signed** builds, regardless of
  sign-in state. Dogfood builds never check.
- **No user setting disables it** — a known gap.

## 7. Locally spawned agent harnesses

The app launches Claude Code, Codex, OpenCode, and OpenClaw as local processes
(`electron/main/pty/session-manager.ts`). Their network behavior is their own,
under the user's own credentials, and is out of scope for this manifest — with
one exception worth naming: the re-entry recap
(`electron/main/pty/context-summarizer.ts`) spawns `claude -p --model haiku`
and pipes it up to 6000 characters of the session's own ANSI-stripped terminal
scrollback, unredacted. That reaches Anthropic under the **user's** Claude Code
credentials, never Exawatt's — nothing about it is hosted by Exawatt, which is
why the Privacy surface presents it in its own "Your own accounts" group
rather than under hosted features.

- **Purpose**: the "since you left" line in the context bar when the operator
  returns to a Session (ENG-016 D18).
- **Default**: on.
- **Off**: Settings → Privacy → **Since-you-left recaps**
  (`reentryRecap.enabled`), enforced at the boundary: off reads no scrollback,
  records no away checkpoints, and spawns no process; a recap already in
  flight finishes but its output is discarded. `EXAWATT_SUMMARIES=0` remains
  the environment override; `EXAWATT_SUMMARIZER_CMD` redirects the engine.

Everything else is local: `/api/oc/token` reads the OpenClaw gateway token off
disk and returns a `127.0.0.1` address; `/api/dev-identity` exists only in
development.

## 8. What the client does *not* do

- No advertising, attribution, or third-party analytics beyond the single
  PostHog stream described in section 1.
- No session replay, DOM autocapture, heatmaps, or surveys.
- No crash reporter other than PostHog's redacted `$exception`.
- No runtime font, script, or asset fetch from a CDN: `next/font` self-hosts at
  build time, and the analytics SDK loads no remote extension.
- No telemetry from Demo Mode that differs from Live Mode; the events above are
  the whole stream.

## Verification method

- Analytics allowlist and redaction: `pnpm vitest run src/lib/analytics`. The
  tests assert the event set, the exact property keys, that forged content
  cannot reach a payload, that exception messages and loopback URLs are
  stripped, and that an undeclared crash payload property is dropped rather
  than forwarded.
- Host split: the same suite asserts the desktop `api_host` is the absolute
  hosted origin and never a loopback address.
- End to end: run a production build with the network inspector open, or watch
  the app's outbound connections in a firewall tool. The desktop app should
  show `exawatt.ai` and — when signed in and using hosted features — the
  Supabase project host; no PostHog, Anthropic, or fal hostname should appear.

## Known gaps

- ~~Context labels have no user-facing toggle.~~ **Closed 2026-08-07 (ENG-030
  OS1.5):** `contextLabels.hosted` is a real preference, enforced at the
  boundary in `context-summarizer.ts` — when it is off no evidence is
  assembled and no request is constructed, and an in-flight answer is
  discarded rather than applied. All three hosted features are now surfaced
  together on the Settings → Privacy surface.
- ~~The re-entry recap is still untoggleable.~~ **Closed 2026-08-07 (ENG-030
  OS1.5):** `reentryRecap.enabled` is a real preference with its own row on
  Settings → Privacy, in a **"Your own accounts"** group separate from hosted
  features — it sends the most, least redacted, in this manifest, and it goes
  to Anthropic under the user's own Claude Code sign-in, never through
  Exawatt. Off is enforced at the boundary in `context-summarizer.ts`: no
  scrollback is read and no recap process is spawned; in-flight output is
  discarded. `EXAWATT_SUMMARIES=0` survives as the environment override.
- The update check cannot be disabled from the UI.
- The Privacy page must be reconciled with this manifest in the same release
  that ships analytics (ENG-030 OS1.4, decision `0034`). Until then, treat this
  file as the accurate one.
- Retention windows for PostHog and for Anthropic API traffic are vendor
  settings and are not verifiable from this repository.
