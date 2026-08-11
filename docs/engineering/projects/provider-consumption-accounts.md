# Provider consumption accounts (ENG-038)

Execution detail for roadmap item ENG-038. The roadmap section carries the
contract; this doc carries the evidence, the mechanism, and the milestone log.

The item is the consumption spine's OTHER source class: **credentialed,
remote, read-only** vendor-account reads, structurally separate from the
local parse whose no-credential/no-network thesis is load-bearing
(`consumption-spine.md` §4, §7). Nothing here amends that thesis: the scanner
service gained no network code; the vendor read is a sibling main-process
module merged behind the same IPC seam.

## 1. Slice 1 — Claude plan-window visibility (landed 2026-08-11)

Operator pull, same day: claude.ai/settings/usage showed rich plan truth
(Max 20x — session %, weekly all-models %, weekly per-model %, resets, usage
credits) while Exawatt's Usage popover said "No plan record on disk —
unmetered here, not at zero". "It's missing Claude even though I have
visibility here." Local absence is definitive (spine §4), so the only honest
fix is the vendor read this item was created for.

### Endpoint reconnaissance

- **The endpoint**: `GET https://api.anthropic.com/api/oauth/usage`, headers
  `Authorization: Bearer <oauth token>` + `anthropic-beta: oauth-2025-04-20`.
  Extracted from the installed Claude Code binary (2.1.228): its `/usage`
  implementation logs `fetchUtilization: GET /api/oauth/usage`, and the
  binary carries both the endpoint path and the beta header. The aftermarket
  tools (Usagebar, ccusage) consume the same endpoint with the same
  credential.
- **Response shape** (verified live against the operator's real Max account,
  2026-08-11): a self-describing `limits[]` array — `{ kind: session |
  weekly_all | weekly_scoped, group: session | weekly, percent, resets_at,
  scope: { model: { display_name } } | null, severity, is_active }` — which
  is what claude.ai's own usage page renders; legacy top-level
  `five_hour`/`seven_day` buckets (`utilization`, `resets_at`); a raft of
  null experiment codename buckets that visibly churn (`tangelo`,
  `nimbus_quill`, `cinder_cove`, …); and usage-credit spend as both a modern
  `spend` block (`used/limit` in minor currency units, `percent`, `enabled`)
  and a legacy `extra_usage` block.
- **Parse policy** (`electron/main/consumption/claude-plan-account.ts`,
  `parseClaudeUsage`): `limits[]` primary, keyed by the vendor's own `group`
  vocabulary for window length (`session` = 300 min, `weekly` = 10,080 min)
  so a renamed `kind` still parses; legacy buckets as fallback; codename
  buckets never parsed; unknown groups skipped — absence over a guessed
  denominator. Stable per-window ids per the plan-window bucket rule:
  `claude-session`, `claude-weekly-all`, `claude-weekly-<model-slug>`
  (e.g. `claude-weekly-fable`), with claude.ai's own names as `limitName`
  ("Current session", "Weekly — all models", "Weekly — Fable").
- **Instability posture**: the endpoint is undocumented and the response
  demonstrably carries churn. Every failure mode — network down, non-2xx,
  expired token, unparsable or drifted schema — degrades to the
  pre-ENG-038 absence. No error state exists in the UI; a prior successful
  observation stays served at its TRUE `observedAt` for the existing
  freshness rule (live/stale/expired) to judge. Never a stale number
  presented as fresh.

### Credential custody

The token is the one Claude Code itself already holds on this machine:
macOS Keychain, service **`Claude Code-credentials`**, a JSON payload whose
`claudeAiOauth` block carries `accessToken`, `refreshToken`, `expiresAt`
(ms), `scopes`, `subscriptionType` (e.g. `max`), `rateLimitTier`.

Custody invariants, all unit-pinned in `claude-plan-account.test.ts`:

- read in place via `/usr/bin/security find-generic-password -w` at request
  time; held in a local variable for one request; never copied, persisted,
  or logged (the keychain error path deliberately carries a fixed message)
- sent only to `api.anthropic.com`; `redirect: 'error'` so it can never be
  replayed to another host
- an expired token is never sent, and Exawatt NEVER refreshes it — rotating
  the refresh token would race Claude Code's own credential lifecycle; the
  read degrades to absence until Claude Code's normal use refreshes it
- the persisted last-known state (`userData/consumption-plan/claude.json`)
  and the served view contain windows/spend/plan-type only — a test scans
  for the token and for any `accessToken` key
- `refreshToken` is read into nothing: the parse extracts only
  `accessToken`, `expiresAt`, `subscriptionType`

This is interim custody, not a Connection. ENG-009 owns the first-class
Connection shape; when it lands, this migrates onto it (recorded under
ENG-009's relations).

### Architecture

- `electron/main/consumption/claude-plan-account.ts` — the adapter
  (`parseClaudeUsage`, pure) + `ClaudePlanAccountService` (keychain read,
  fetch, cadence, persistence, revision/notify). Its ONLY write path is its
  own state dir.
- `electron/main/consumption/provider-plan-composite.ts` — implements the
  scanner's `ConsumptionScannerLike` seam over both sources: merges
  `planWindows` (`origin: 'provider-account'`), `windowObservations`,
  `windowRates`, and the new optional snapshot field
  `providerPlanAccounts`; serves `revision = scanner + plan` (both
  monotonic). Registered in `main.ts` in place of the bare scanner.
- Contract additions (`@exawatt/core`): `PlanWindow.origin`
  (`'local-log' | 'provider-account'`, absent = local),
  `PlanWindow.providerSessionId: ''` for vendor windows,
  `ProviderPlanAccountState`/`ProviderPlanSpend` on the snapshot —
  additive, version unchanged.
- Renderer: zero new data paths. Vendor windows flow through the existing
  `planWindows` → `buildSources` → `CapacityWindowView` pipe;
  `capacityWindowFromPlan` now prefers the provider's own `limitName` (the
  only way two same-length weeklies read apart — this also lets Codex's
  occasional model-scoped `limit_name` render truthfully) and carries
  `planLevel` for vendor windows. The meter popover adds ONE caption under
  Claude's rows; `/usage`'s Headroom band renders the rows with no change
  at all.

### The chat-usage tension, decided

Plan windows are PLAN truth: they include claude.ai chat burn, and that is
the point — the same ceilings gate agent launches, and a meter that omitted
chat burn would clear a launch the vendor would refuse. Presentation keeps
the widening out of the burn story: vendor windows render per-source under
claude.ai's own window names with the one-line disclosure "From your Claude
account — plan-wide, including claude.ai."; they enter no rollup, no
Session, no Project, and no attribution surface. On the assurance ladder
they are `reported` (vendor-reported) with nothing locally `observed` —
`origin: 'provider-account'` carries that fact on the record.

### Refresh policy

No dedicated timer. `maybeRefresh()` rides every snapshot pull and rescan —
the renderer already pulls on revision pushes and runs a polite 5-minute
visible rescan, and opening `/usage` or the meter popover triggers pulls —
throttled main-side to one fetch per 5 minutes + 0–45 s jitter, single-
flight, with failures consuming the same cadence slot (no retry storms).
The vendor page self-describes as sub-minute fresh; five minutes is
deliberately conservative for a third-party undocumented endpoint.

### The off switch

`Settings → Privacy → Your own accounts → Claude plan usage`
(`claudePlanWindows.enabled`), one toggle beside the since-you-left recap in
the own-account group (the operator's own sign-in; Exawatt is never on the
path). **Default ON** — recorded decision: the operator pulled this feature
the same day, and own-account features default on under decision `0031`'s
disclosure contract. Off is enforced at the boundary in the service: no
request is constructed, the very next view serves absence, and the persisted
last-known state stays local for a later re-enable. This is Exawatt's first
direct desktop read of a vendor API; the outbound-data manifest carries its
row.

### Deliberately deferred

- **Spend-class UI**: the endpoint's usage-credit figures are captured on
  the snapshot (`ProviderPlanSpend`, e.g. the operator's $201.60 of $200
  monthly credits) so the model has the dimension, but no dollars render.
  The spend-class surface — plan / overage / metered-API as a modeled
  dimension with reconciliation language — is a later slice.
- **Other vendors** (ChatGPT/Codex analytics, Anthropic Console workspace
  cost, OpenAI billing): per-vendor reconnaissance pending; each has its own
  credential class and stability story.
- **Connection custody** (ENG-009), as above.

## Roadmap milestone log

### Slice 1 — Claude plan-window visibility (landed 2026-08-11)

Design pass + first slice together on operator pull. Everything above.

Verified headfully on THIS machine's real Max account (fresh user-data,
worktree dev server): the meter popover showed Codex's weekly beside three
Claude rows — Current session 34% (resets 1h 6m), Weekly — all models 41%,
Weekly — Fable **75%** (resets 5d 11h) — with the Fable weekly correctly
taking the chrome headline as the tightest live window and the plan-wide
disclosure line under the rows; `/usage`'s Headroom band rendered the same
rows with pace verdicts, and the provenance caption switched truthfully to
"plan windows from your Claude account" (the original "no provider API"
line was now false with vendor rows on screen and became conditional — the
one piece of existing copy this slice had to touch). The reconnaissance
curl and the rendered values tracked claude.ai's own page live, including
climbing DURING verification as the landing session itself burned tokens.
The Privacy switch round-tripped through the real IPC: OFF removed the
Claude rows and restored the honest absence row on the next pull with no
restart; ON restored them (last-known state serves immediately; the next
cadence slot refreshes). Screenshots: `/tmp/exawatt-eng038-verify/`
(session-scoped).

Tests: adapter fixtures (success/legacy/drift/codenames), custody
invariants (expired-token-never-sent, token-never-persisted,
single-host+no-redirect, cadence), honest-failure degradation, composite
revision monotonicity, renderer window naming/plan-level carry, settings
parse + Privacy-surface switch behavior. Full suite green.

For the record: `eval:electron:tenancy` remains red on master independent
of this change — it still drives the pre-D49 "Open shell in" launcher
affordance that no longer exists in `src` (verified by grep); its repair
stays owed to the launcher line (ENG-016), and demo-tenancy behavior was
verified through the green unit seams (`usage-client`, `live-store`,
tenant-consumption suites) exactly as the E5 landing did.
REPAIRED 2026-08-11 (`1a5d449`, ENG-016): the eval now drives the D49
catalog ("All engines and models" → "Shell in <project>") through the
shared `openShellFromLauncher` helper and runs all 48 checks green;
details in the ENG-016 findings log.
