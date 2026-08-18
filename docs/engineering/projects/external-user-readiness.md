<!-- Generated for the public repository by the "public-document-set" recipe. -->
# External-user readiness

Execution detail for **ENG-030 OS0 and OS1.1–OS1.4**, with cross-links to
ENG-025 F3/F3.1 and ENG-035 A2. This document owns no scope of its own; every
slice points back at the roadmap item that owns it.

## Why this exists

Audit run 2026-08-06 against production, on the operator's question: "I have two
users aside from myself — is the app keeping up with the fact that it's not just
me?"

The answer was that the multi-user path had **never been exercised once**.

Two conclusions follow, and they point in opposite directions:

1. **Sign-in mechanically works.** The full chain works in a shipped app:
   system-browser PKCE → Supabase → the ephemeral-port
   `http://127.0.0.1:<port>/auth/electron-callback` → the `exawatt://` deep
   link → session installed. `protocols: exawatt` reaches shipped builds
   because `electron-builder.dogfood.yml` extends the base config that
   declares it. **Do not re-investigate this.**
2. **Nobody else has used it.** Signed out, the app silently loses context
   labels, conversation summaries, goal visuals, Project registry sync, and
   the ⌘⇧F capture bar — which is a documented no-op without a session
   (`product-feedback-provider.tsx`). Nothing prompts, and nothing explains
   what is off.

The failure is therefore **discovery and observability**, not mechanism. Three
specific defects carry it:

- The account menu — the obvious place to look — offers `Sign out` when signed
  in and **nothing at all** when signed out. The only sign-in affordance is a
  header button, plus a `⌘K` row that appears only when the Project registry
  query fails.
- `/auth/callback` discards the result of `exchangeCodeForSession` and redirects
  to `/workspace` either way, so a failed exchange is indistinguishable from a
  successful one.
- There is **no password-reset route anywhere**. Both auth forms offer
  email/password, which has produced zero accounts; if anyone uses it and
  forgets, that is a dead end.

## Slice map

| Slice | Owner | Substance |
| --- | --- | --- |
| OS0.1 | ENG-030 | `Sign in` in the account menu; one-time dismissible first-run card. Non-blocking, no nagging |
| OS0.2 | ENG-030 | Password-reset route and forgot-password link |
| OS0.3 | ENG-030 | `/auth/callback` reports exchange failure instead of swallowing it |
| OS0.4 | ENG-030 | Sign-up stays open; accepted gap is invitee→account attribution |
| OS1.1 | ENG-030 | Proxied PostHog ingest (decision `0034`) |
| OS1.2 | ENG-030 | Minimal event slice: launch, sign-in outcome, hosted-call failure, crash |
| OS1.3 | ENG-030 | `service_ceiling` inside the three `claim_*_quota` functions, kill switch, alert threshold |
| OS1.4 | ENG-030 | Privacy page corrected before analytics ship |
| OS1.6 | ENG-030 | Update failures leave evidence: persistent updater log, the reason on screen, `Check for Updates…` in the app menu |
| A2 | ENG-035 | GitHub identity persistence and a later successful resync |
| F3 / F3.1 | ENG-025 | Operator lane vs suggestions lane; scope the untriaged count |

## Constraints that bind every slice

- **Never a wall.** ENG-030 OS0 already promises that ordinary local Agent
  operation and Demo Mode stay fully usable without an Exawatt account, and the
  vision's strategic posture forbids taxing the single-operator path with
  "setup, accounts, or ceremony it does not need." Sign-in discoverability is an
  invitation, never a gate.
- **The submitter is owed a success, not a conversation.** Operator position
  (2026-08-06): no reply or acknowledgement loop for non-operator feedback. A
  clear success state on Enter — which the existing `sent` confirmation already
  provides — is the whole contract.
- **Disclosure ships with the behavior, not after it.** Principle 4 makes the
  Privacy page correction a blocker on the analytics slice.

## Progress log

### 2026-08-16 — OS1.4 reopened and closed properly: `/privacy` and `/terms` were still false

**OS1.4 was marked landed on 2026-08-06 and the pages stayed wrong.** A
pre-launch audit re-read every factual claim on `/privacy` and `/terms`
against the code and found six false ones on the Privacy page and three on
Terms. The interesting part is not the list, it is why it survived a slice
whose stated exit was "Privacy page corrected before analytics ship".

**Root cause: the pages had no owner and no oracle.** `outbound-data.md` is
pinned to the analytics allowlist by `manifest.test.ts`, and `OUTBOUND_CONTROLS`
is pinned to the Settings surface by `privacy-settings.test.tsx`. `/privacy`
was pinned to nothing, so it was the one link in the disclosure chain that
could rot without failing anything. It rotted in both directions: forward,
because it described a hosted SaaS the product never became; and sideways,
because it named privacy controls under labels Settings has never used, which
makes a disclosure unusable even where it is technically true.

What was false, and what the code says:

| Claim | Reality |
| --- | --- |
| "Disabling the profile removes those records from public queries" | The switch calls `setOperatorAutoPublish`; only `Remove public profile` runs `disable_operator_profile`, and public reads filter `WHERE p.enabled = true`. Pausing leaves the profile up |
| Collects "prompts, outputs, logs" of agents and tasks | No table holds agent content. `agent_tasks` and `activity_events` survive in `database.ts` types with no writer |
| Collects "pages visited, time spent" | `$current_url`, `$pathname`, `$referrer`, `$title` are denylisted twice, and autocapture, pageview capture, and session replay are all off |
| "Product analytics are collected by default" and can be switched off | The release build passes no `NEXT_PUBLIC_POSTHOG_KEY`, so the downloaded build never initializes analytics at all. See BUG-022 for the switch's own persistence defect |
| A "third-party payment processor", "our pricing page", "refund policy" | No billing code, no Stripe, no `/pricing` |
| "a cloud-based platform", "web-based dashboard, API access", "task scheduling, log aggregation"; "you must create an account" | A macOS Apple-silicon desktop app that runs agents locally, with a deliberately account-free `/download` and first run |

**The repair is the test, not the copy.** `src/app/legal-surfaces.test.ts`
pins the load-bearing claims to `OUTBOUND_CONTROLS`,
`ANALYTICS_PROPERTY_DENYLIST`, the release build's analytics configuration,
and the absence of a billing implementation. Adding an outbound control now
fails the Privacy page
until it is described; shipping analytics in a release build fails the
sentence that says it does not; adding Stripe fails the Terms page. That is
the property OS1.4 was supposed to have and did not.

**Two findings beyond the pages.** `outbound-data.md` §2 itself carried two
stale sentences ("No redaction is applied on this path" and "There is no
user-facing toggle"), both disproved by `context-summarizer.ts` and by the
file's own Known-gaps section. A manifest that is canon still needs reading
against the code, not just trusting. Separately, `/workspace`, `/settings`,
`/eval`, and `/fleet/spatial` are public in `proxy.ts` so the offline Electron
renderer can reach them, which also left them crawlable with no `robots.txt`
in the repo; they now carry the same `robots: { index: false }` metadata
`/hud-gallery` and `/usage` already had, and `robots.ts` deliberately does
*not* `Disallow` them, because a blocked page is a page whose `noindex` is
never read.

### 2026-08-14 — OS1.6, from a user stuck on 0.1.7

An external user reported a failed update. The published feed was healthy
(`0.1.9`, 100% rollout, every asset reachable), so the failure was on his
machine, and **nothing in the product could say why**. Three gaps compounded:

- **No log.** `electron-updater`'s default logger is bare `console`
  (`AppUpdater.js`), the repo has no `electron-log` dependency, and a packaged
  app's stdout goes nowhere. The reason existed for the lifetime of one
  `console.info` call and was then gone.
- **The reason was captured and then thrown away.** `updater.ts` already
  clipped `error.message` into its status object; the renderer notice rendered
  the constant string `Update failed. Exawatt <version> remains installed.`
  and never showed it.
- **No manual re-check.** The updater fires once, five seconds after launch.
  A user could not retry, and an operator could not ask them to.

The only diagnosis available was a scripted terminal relaunch on the user's
machine, which is both invasive and unavailable when support is one
back-and-forth. OS1.6 replaces it: `userData/logs/updater.jsonl` (rotating,
via the D28 `createDiagnosticsLog` sibling) receives every phase transition,
every `electron-updater` log line at every level, and structured errors with
`code`/`statusCode`/clipped stack. The notice states the reason. `Check for
Updates…` in the app menu reports the state as a sentence.

**The silent state is the one worth naming.** `startProductUpdater` is gated
on `buildInfo.delivery === 'signed'`, so a hand-delivered build never checks,
never fails, and shows nothing forever. That is indistinguishable from "up to
date" to the person holding it. `ProductUpdateStatus.enabled` now carries the
distinction and the log records the `disabledReason`
(`unsigned-delivery` / `not-packaged` / `test-run`).

**Standing consequence.** Any subsystem that can fail on an external user's
machine without leaving a file is not shippable. Auth (`auth.jsonl`), the
summarizer (`summarizer.jsonl`), and now the updater (`updater.jsonl`) follow
the same pattern; the next one should too.

### 2026-08-06 — OS0.1–OS0.3, OS1.1–OS1.4, F3/F3.1, and the 0029 collision

Six parallel tracks; all landed together. What each one actually built is in
the roadmap's milestone lines. Three things worth keeping here because they
are findings, not deliverables:

- **Supabase default privileges defeat a plain `REVOKE … FROM PUBLIC`.**
  Proved against a real Postgres while building OS1.3: a `SECURITY DEFINER`
  function revoked from `PUBLIC` was still executable by `authenticated`,
  because Supabase's default grants on schema `public` re-add it. Without the
  explicit `REVOKE … FROM PUBLIC, anon, authenticated`, any signed-in user
  could have called the ceiling helper in a loop and burned the global
  allowance without touching their own quota. **Any future `SECURITY DEFINER`
  function in this project must revoke all three roles by name.**
- **One boolean, three causes.** `claim_*_quota` returns `false` for the
  caller's own quota, the global ceiling, and the kill switch alike, so the
  routes cannot attribute a refusal. The user-facing copy was made neutral
  ("at capacity right now") rather than claiming it is the user's quota or
  promising an hour the kill switch will not honor. Precise attribution would
  need a second read-only RPC consulted on the refusal path — deliberately not
  built; see Open.
- **A headless browser is a bot, and PostHog drops bots silently.** After the
  proxy was fixed, production still showed zero `app_launched` events. The
  cause was the verification, not the product: `capture()` returns `undefined`
  before `before_send` runs when `_is_bot()` is true and
  `opt_out_useragent_filter` is false (the default) — no log, no request, no
  error, while `__loaded` is true and the instance looks healthy. Since this
  repo's standing rule is that evals run headless, **the default way to check
  this feature will always show zero events.** Proved by flipping
  `opt_out_useragent_filter: true` in a scratch build, after which the
  identical code emitted to `/ingest/e/` normally. The guard is documented in
  `src/lib/analytics/client.ts`; do not ship the flag to silence it.
- **A rewrite is not a route, and the auth gate does not know the difference.**
  `/ingest` was added to `next.config.ts` but not to `PUBLIC_PREFIXES` in
  `src/proxy.ts`, so production answered every analytics request with a 307 to
  `/sign-in`. Analytics emission is fire-and-forget by design, so **nothing
  surfaced it** — the deploy looked healthy and would have collected zero
  events indefinitely. It was caught only by curling the live endpoint after
  deploying. Two durable lessons: any new `next.config.ts` rewrite needs a
  matching public-prefix entry, and a fire-and-forget outbound path must be
  verified against production rather than inferred from its configuration.
- **The hosted-feature boundary is wider than assumed.** Writing the outbound
  data manifest turned up that `/api/context-labels` sends the Project name in
  cleartext plus up to eight raw operator prompts, with no user-facing toggle
  at the time (env var only) — while `/api/conversations/summarize`, which
  sends only opaque `harness:id` keys, *does* redact. That was a decision
  `0031` compliance gap, not a defect in this work; ENG-030 OS1.5 closed the
  toggle half on 2026-08-07, and both entry points route through
  `redactContextEvidence` now. Read this bullet as the state on the day it was
  written.

Verification: full suite green (1812 passed / 1 skipped, against a 1733
baseline on `master`); `pnpm type-check` and `pnpm lint` clean; the ceiling
eval passes 87 checks against a throwaway Postgres 17.10 — **not** against
production.

## Open

- ~~Context labels have no user-facing off switch, and send the most.~~
  **Closed 2026-08-07 (ENG-030 OS1.5); recorded here 2026-08-18.**
  `contextLabels.hosted` is a real preference with its own row on Settings →
  Privacy, enforced at the boundary in
  `electron/main/pty/context-summarizer.ts`: off assembles no evidence and
  constructs no request. Decision `0031`'s "independent user control that
  prevents hosted feature calls" is satisfied. This item sat open for eleven
  days after the code closed it, in a PUBLIC-classified file, which is the
  same decay decision `0021` was corrected for on 2026-08-18 —
  `src/lib/hosted-features/outbound-disclosure.test.ts` now fails on a live
  "no off switch" sentence about a control that has one. What remains true is
  the volume: context labels are still the widest-sending Exawatt-hosted path
  in the product, and `docs/engineering/outbound-data.md` section 2 states it.
- **Refusal attribution.** A user who trips the global ceiling or the kill
  switch cannot be told which. The cheap fix is a read-only
  `service_availability(service)` RPC consulted only on the rare refusal path,
  so no extra round-trip on the happy path. Not built — the neutral copy is
  honest, just imprecise.
- ~~Analytics coverage is renderer-only.~~ **Closed 2026-08-07 (ENG-030
  OS1.5b):** Electron main now queues typed `hosted_call_failed` /
  `app_crashed` events into a bounded in-memory bridge
  (`electron/main/analytics-bridge.ts`) that the renderer drains through the
  allowlisted `captureAnalyticsEvent` path, so main-process hosted-call
  failures (context labels, goal visuals, conversation summaries) and
  main/gpu/utility/renderer crashes are counted while main still has no
  analytics destination of its own.
- **Account deletion and export.** The Privacy page promises access,
  correction, deletion, and portability via `privacy@exawatt.ai`. None of it is
  implemented, and whether that mailbox is monitored is unverified. A real gap
  before wider distribution.
