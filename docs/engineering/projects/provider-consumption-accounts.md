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

> **Superseded in part 2026-10-04 by slice 3** (see the milestone log). The
> endpoint, Keychain custody, signed-transport identity and distribution gate
> described in this section are deleted; the Claude read now runs the
> operator's own `claude -p "/usage"`. What follows is the history of slice 1
> as it stood, kept because the reconnaissance, the chat-usage decision, the
> refresh policy and the off switch still hold.

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

*Superseded 2026-10-04 (slice 3): Exawatt no longer reads Claude Code's
Keychain item at all, and the "never refreshed" and "never sent expired"
rules are moot because no token is held.*

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
  own state dir. Installed builds inject `electron.net.fetch`, keeping the
  request on Exawatt's signed Chromium network boundary; routine unpackaged
  launches cannot make the remote read. The immutable runtime capability is
  separate from the mutable Privacy preference, so a settings write cannot
  reopen an unsigned development path. `app.isPackaged` is the current
  pre-split proxy for that capability. ENG-030 OS4 replaces it with
  `ownAccount.claudePlanUsage` from the distribution contract: community
  defaults absent, while a distributor with a stable signed package may
  declare `stable-signed`.
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

The cadence applies only to installed builds. Unpackaged development and eval
launches are local by default because the downloaded Electron runtime is
ad-hoc signed on macOS; focused integration testing requires the explicit
`EXAWATT_DEV_CLAUDE_PLAN_NETWORK=1` opt-in. This keeps normal product work from
creating a new firewall identity every time the Electron dependency changes.
After OS4, "installed" is insufficient by itself: automatic refresh also
requires the distribution's stable-signed capability, so an ad-hoc packaged
community build remains local by default.

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

### Signed network identity repair (2026-08-16)

The operator was approving `api.anthropic.com` in Little Snitch roughly twenty
times per day during normal Exawatt development. The plan-account service had
defaulted to Node's global `fetch`, while every unpackaged Electron launch also
enabled the default-on read. That made an ad-hoc Electron runtime — no Team ID,
revision-bound CDHash — the network identity for an automatic credentialed
request. A broad parent-process rule could not repair the leaf identity.

Repaired at both boundaries: installed builds inject `electron.net.fetch`, so
the request uses the signed Exawatt Chromium stack; unpackaged builds cannot
make it unless the narrow development opt-in is set. Unit evidence pins the
runtime policy and proves the Privacy toggle cannot expand it. Incident `0011`
carries the controlled Little Snitch reproduction and signature evidence.

### Slice 2 — the Codex plan account and a shared account service (2026-09-29)

Shaped and built with ENG-008 E15. `CodexPlanAccountService` asks the
operator's own `codex app-server` for `account/rateLimits/read` (the question
Codex's `/status` asks) through the existing `CodexAppServerClient`, one
short-lived read-side process per read at the shared five-minute cadence.
Custody is source-owned: Exawatt never reads `~/.codex/auth.json`, the request
leaves under Codex's own identity, and no distribution grant applies. A new
own-account privacy switch (`codexPlanWindows`, default on) turns it off;
automated test launches never start it; a machine with no Codex logs is never
asked. The parser is pinned to a recorded answer from the operator's Pro
account (ids redacted): windows per bucket from `rateLimitsByLimitId`, the
credit balance, and available reset credits sorted by expiry, with absent
reset data carried as absent rather than zero.

The Claude service's life (throttle, last-known persisted state, pace history,
off switch, build grant) moved into `PlanAccountService`; Claude and Codex now
supply only a reader, which is the seam a future Agent Source plugin
implements to add an account. The composite takes a list of accounts, skips an
account whose harness has no local files, and derives one pace per bucket from
the merged observation history, so Codex's log and account readings form one
series and the fresher reading wins per bucket. `ProviderPlanAccountState`
gained `rateLimitTier`, `resets`, and `credits`; the Claude reader now passes
the Keychain's `rateLimitTier` so the card reads "Max 20x". Claude's own free
reset ("Reset for free") is claimed through an endpoint Exawatt does not read,
so it is not shown.

Verified live: the production Codex reader, run against the installed
codex-cli 0.158.0, returned the Pro week at 45%, three resets expiring
2026-10-05, 10-22 and 10-29 (UTC), and the credit balance.


### Slice 3 — Claude plan usage through Claude Code's own `/usage` (2026-10-04)

Replaces slice 1's custody. The Keychain item cannot be approved once (Claude
Code rewrites `Claude Code-credentials` on each refresh and resets its partition
list), the read went through `/usr/bin/security`, and Anthropic's terms forbid
intermediating Claude.ai credentials. The operator wanted one durable
connection and no change to anyone's Claude install.

**Mechanism.** `ClaudePlanAccountService` now supplies a reader that runs the
operator's own `claude -p "/usage" --no-session-persistence --output-format
json` through their login shell (so it is found where their terminal finds it),
from Exawatt's scratch directory, with `DISABLE_AUTOUPDATER=1`, a 45 second
limit and the process group killed on timeout. The reader parses the envelope's
`result` text. Zero turns, zero cost, no session file (checked: nothing under
`~/.claude/projects`).

**Real output, captured 2026-10-04 on Claude Code 2.1.289**, pinned in
`electron/main/consumption/claude-usage.fixtures.ts`:

- Signed in (Max): `Current session: 4% used · resets Oct 4 at 7pm
  (America/Los_Angeles)`, `Current week (all models): 92% used · …`, `Current
  week (Fable): 58% used · …`, then free-text contributing sections. Resets
  print minutes only when non-zero ("7pm", "6:59pm").
- Signed out (scratch `CLAUDE_CONFIG_DIR`; `claude auth status` said
  `loggedIn: false`): exit 0, `is_error: false`, and only a cost summary
  (`Total cost: $0.0000 …`). An API-key session prints the same, so the cause is
  `no-plan`, not "signed out".

**Parser.** Line grammar `Current (session|week)( (scope))?: N% used( · resets
…)?`; the model scope is whatever is printed (`Fable`, `Sonnet only`, a future
name), slugged to the same `claude-weekly-*` ids slice 1 used so pace history
continues. The printed IANA zone and date resolve to an absolute instant by
`Intl`, judging the year in that zone and rolling to the next year when the
date lands more than a day behind the read. A `Current …` line the grammar
cannot read fails the whole report. Unknown zones, impossible dates, out-of-range
percentages and duplicate limits are each unrecognized, never guessed.

**States.** `ProviderPlanAccountState.failure`: `not-installed` (exit 127 or the
shell's "command not found"), `no-plan`, `timed-out`, `exited` (non-zero exit,
`is_error`, or a process that would not start), `unrecognized`. The Usage card
says "Couldn't read plan limits." plus the reason; the last good windows keep
their true observed time and drop out once their reset passes. The cause is not
persisted. The account statuses are now `ok | unavailable | disabled`.

**Deleted.** The Keychain read and token types, the usage-endpoint request, the
redirect/expiry rules, `isClaudePlanRemoteReadAllowed`, `remoteReadAllowed` and
the `unconfigured` status through the renderer, the capability projection and
`requiresDistributionCapability` value, the "Not configured in this build"
Privacy row state, the `eval:community:network` own-account assertion,
`EXAWATT_DEV_CLAUDE_PLAN_NETWORK`, and `distribution:custody:upgrade`. A
reintroduction guard in `claude-plan-account.test.ts` scans source for the
retired tokens.

**`ownAccount` decision.** Nothing else read it (Codex was never gated). The
resolved contract drops it. Schema 2 still accepts and validates the key, now
optional (published `contracts/distribution/v2/schema.json` loosened, backward
compatible), because stored copies of the official contract sit in Vercel, a
GitHub secret and operator custody; schema 1 is unchanged. No schema 3.

**Evidence.** Unit and fixture suite (101 tests) with mutation checks (year roll,
partial-line tolerance, reintroduced Keychain token, removed throttle, dropped
cause, ungated disabled read each fail a test). The production runner was run
against the operator's real `claude` through their fish login shell: three real
windows in about 4.4 s. In a headless Electron launch against this worktree's
dev server with an isolated user-data directory, turning the Privacy switch on
produced the real session, week and Fable windows with absolute resets and the
Usage card rendered them; turning it off served `status: disabled` and no
windows. Not run: an installed (signed) build, since the dev build is community.

**Recorded losses.** `/usage` states no plan tier (the card no longer says "Max
20x"; `claude auth status` reports `subscriptionType` without a token and is a
candidate), and it printed no extra-usage spend on 2026-10-04 although the
operator's account had it enabled in August, so the Claude spend lane is absent
until a format carrying it is seen.

**Naming.** The demo arc's G4 / ENG-008 E16 Google read was labelled "ENG-038
slice 3"; it is now slice 4.

### Review repairs to slices 2 and 3's shared account path (2026-10-04)

A high-effort review of the E15/slice 2 landing found ten defects; all were
real on master after slice 3 and are repaired together:

- **Test launches stay closed.** `PlanAccountService` gains an immutable
  `allowed` capability (false in automated launches) so a Settings write,
  which `setEnabled` honours, cannot start `claude` or `codex` inside an eval.
  `enabled` is now only the operator's switch.
- **No harness is asked before the corpus says it exists.** The composite
  nudges accounts after the scanner snapshot and only once a full scan has
  completed, so a machine without Codex never spawns an app-server, even on
  first launch. Account `source` and `revision` are cheap getters, so the
  composite no longer builds full views to read them.
- **A too-old Codex app-server is remembered** for the launch, as the
  delegation observer does (BUG-146), instead of respawned every five
  minutes; failures carry named causes (`not-installed`, `timed-out`,
  `exited`, `unrecognized`).
- **Warm launches** count a persisted read that carried only resets or spend
  as a reading. **Credits** are read from any per-limit snapshot when the
  default one is absent.
- **Pace across two sources**: a forward dip within one point is rounding
  between the rollout log and the account read, never a reset.
- Renderer: the headline speaks for the earliest meter that actually
  forecasts a run-out (a five-minute-old session could bind the glyph while a
  week beside it ran out, unspoken); a Codex card is stale only when its
  figures ARE the failed account read, so fresh log windows beside a read
  that never succeeded report normally; and projections run from now again,
  because a Codex window is only written while Codex runs and aging an old
  reading forward announced run-outs that never happened.

### Slice 4 — the Google account through Antigravity's own `/usage` (2026-10-05)

Shaped and built with ENG-008 E16 for the Google workshop demo arc (G4).

**Mechanism.** `GooglePlanAccountService` supplies a reader that runs the
operator's own `agy -p "/usage" --output-format json` through their login
shell from Exawatt's scratch directory with a 30 second limit, via the shared
`createLoginShellCommandRunner` in `harness-command-run.ts` (the Claude read
moved onto the same runner; its pinned argv, `DISABLE_AUTOUPDATER`, cwd and
timeout behaviour are unchanged). Custody is source-owned: Antigravity makes
the request under its own sign-in, Exawatt reads no credential and never reads
`~/.gemini/antigravity-cli/history.jsonl` or anything else inside that
directory. Verified 2026-10-05 on Antigravity CLI 1.2.17: the answer costs no
agent turn (`num_turns: 0`, `conversation_id: ""`), writes no conversation
(the `conversations/` directory's entry count and mtime were unchanged across
a run), prints nothing to stderr, and took about five seconds.

**Real output, captured 2026-10-05**, pinned in `agy-usage.fixtures.ts`: two
groups, "Gemini Models" and "Claude and GPT models", each with one bucket
(`id`, `window: 'weekly'`, `remaining_fraction`, `reset_time` ISO). The first
capture read the Gemini group at 0.0010104 remaining; a later one read it at 0,
with the bucket's `description` rewording itself ("You have hit your weekly
limit"). No plan tier appears anywhere in the report; `agy --help` offers no
usage flag beyond the slash command.

**Units.** The vendor states what is LEFT; the meter model states what is
used, so the fraction is inverted once in the parser
(`usedPercent = round((1 - remaining) × 1000) / 10`). `window` maps
`weekly`/`daily`/`monthly` to minutes and anything else is unrecognized
(absence over a guessed denominator). The group name less a trailing
"models" is the limit's model scope ("Gemini", "Claude and GPT"), so the
card's rows read "Gemini this week" and, when the group is spent, "Out until
reset" beside the vendor's reset instant. The bucket id is the
`limitId` (`antigravity|gemini-weekly|primary|10080`) so pace history
continues across reads.

**The ledgerless account.** Antigravity writes no usage record Exawatt reads,
so the account is not a `ConsumptionSourceId` (that registry means "local
records the scanner parses" and drives adapters, capabilities and state
repairs). `@exawatt/core` gains `PlanAccountSourceId` (a ledgered source or the
ledgerless `antigravity`), `PLAN_ACCOUNT_SOURCE_IDS` and
`isPlanAccountSourceId`; `PlanWindow.source`, `PlanWindowObservation.source`
and `ProviderPlanAccountState.source` widen to it, as do the renderer's
`ConsumptionSourceView.harness`, `ACCOUNT_NAME` (`antigravity: 'Google'`), the
account order and `buildSources`, which builds an Antigravity view with no
samples. Samples, Sessions, `HARNESS_LABEL` and the analytics grid stay keyed
by `Harness`. The id is the one ENG-003 S5.3 declares for the Agent Source, so
the account joins the ledger registry later without renaming its windows.

**Presence.** The composite learns a ledgered harness's presence from the
corpus and never starts a Codex app-server on a machine without Codex; a
ledgerless account cannot be learned that way, so `PlanAccountSource` gains an
optional `installed()` that the Google service answers with a stat of
`~/.gemini/antigravity-cli` (sticky once true). The composite neither nudges
nor carries an account whose `installed()` is false, so a machine without
Antigravity shows no Google account at all rather than a failure.

**States.** Failures ride `PlanAccountFailureCause` exactly as slice 3's do:
`not-installed` (exit 127 or the shell's "command not found"), `timed-out`,
`exited` (non-zero exit, a non-`SUCCESS` status, or a process that would not
start), `unrecognized` (no envelope, no handled `usage` command, an unknown
window name, a fraction outside 0..1, an unparsable reset, a bucket with no
id, two buckets with one id, or no buckets). A non-`SUCCESS` status whose text
asks to sign in reads `no-plan`; that shape is a guess recorded as one, since
a signed-out `agy` has not been captured. The card says "Couldn't read plan
limits." plus the cause through `ACCOUNT_APP` ("Antigravity isn't installed on
this machine."). One projection rule changed for it: a card whose read ran
and NAMED its failure is shown even with no tokens to earn it, because a
ledgerless account has no tokens and its malfunction would otherwise be
invisible; a read nothing has attempted still earns no card.

**Switch and disclosure.** Own-account privacy switch `googlePlanWindows`
(default on) through the same path as the Claude and Codex switches
(settings store, IPC argument validator, preload, bridge types, Privacy row,
`OUTBOUND_CONTROLS`), disclosed as section 7's fourth own-account path in
`outbound-data.md`.

**Evidence.** `google-plan-account.test.ts`: the parser against both real
captures, every unreadable shape as a named cause with no window, a lost read
keeping the last good windows at their true observed instant, a later good
read replacing the stale figure, the runner's pinned argv and scratch cwd, the
presence stat, and the composite skipping and omitting an absent Antigravity.
`accounts.test.ts` and `honesty.test.tsx` pin the card, the spent Gemini
group's forecast and glyph binding, the account order, and that losing the
Google read never makes a card calmer. `pnpm eval:usage:scenarios` gained two scenarios (Google
Gemini limit reached; Google not readable) and a Google card in the default
one; 33 shots green. The dev-tree Electron launch with the real account reads
is recorded in `consumption-spine.md` §E16.

**Known.** Antigravity exposes no switch for its own update check and runs one
at most every fifteen minutes on any invocation, so a read can let the
operator's `agy` check for its update exactly as their own use does; the
signed-out report shape is not captured; the meter order within the card is
the shared alphabetical rule for same-length scoped limits, so "Claude and GPT
this week" sits above "Gemini this week".
