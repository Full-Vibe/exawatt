<!-- Generated for the public repository by the "public-document-set" recipe. -->
# Consumption spine (ENG-008 E0–E5)

Execution detail for roadmap item **ENG-008**. The roadmap owns status, scope,
and exit criteria; this doc owns the contract, the corpus evidence, and the
open questions.

Thesis under test: honest Consumption is a **read-only local parse** over files
the harnesses already write, not a provider-billing integration.

**Verdict: the thesis holds.** Every unit the canon asks for is derivable from
local logs for both sources, Project attribution is complete, and nothing
required a provider API, a credential, or a network call. Two findings change
the plan rather than confirm it — a cold scan is far too expensive to run
inline (§5), and ENG-023's claim that delegated spend dwarfs parent spend is
not supported by the corpus (§3).

## 1. Contract

`packages/core/src/consumption/` — pure TypeScript, no React, DOM, Electron, or
Three.js. Filesystem access is an injected port (`ConsumptionFileSystem`), so
the parsers are unit-testable against fixtures and Demo Mode drives the
identical code path. The Node implementation is exported only from
`@exawatt/core/server`.

| Type | Role |
| --- | --- |
| `RawUsage` | input / cacheRead / cacheWrite / output / reasoning tokens, web searches, web fetches |
| `ConsumptionSample` | one usage record: `at`, `source`, `model`, `effort`, `providerSessionId`, `cwd`, `gitBranch`, `usage`, `assurance`, `idempotencyKey`, `contextWindow`, `delegation` |
| `ConsumptionDelegation` | `agentId`, `parentSessionId`, `agentType`, `spawnDepth` — `null` on a non-delegated sample |
| `PlanWindow` | `limitId`, `usedPercent`, `windowMinutes`, `resetsAt`, `planType`, `observedAt` |
| `ConsumptionRollup` | scope, window, `totals`, `weightedTokens`, `sessionCount`, `samples`, `assurance` |
| `ConsumptionDiagnostics` | 14 counters — every record the parse could not fully use is counted, never silently dropped |

`delegation` is **required and explicitly nullable**. An optional field would
let a call site omit delegation status and silently read as "not delegated";
requiring `null` forces every construction site to state it.

Rollups are available by session, project, day, model, source, roadmap item,
and workspace. `ownTotals` / `ownWeightedTokens` expose a Session's own turns
separately from its delegated children, so a surface can show an honest total
**and** the split.

**Sources.** `claude-code`, `codex`, and — since ENG-003 S4 (2026-08-13) —
`grok`. Grok Build's usage rides `~/.grok/sessions/<url-encoded cwd>/<uuid>/
updates.jsonl`, whose `turn_completed` update carries a per-prompt
`PromptUsage`. Its `signals.json` is deliberately NOT read: that file records
live context occupancy (`contextTokensUsed`, `contextWindowTokens`) and turn
and tool counters, with no cumulative token totals — reading occupancy as
consumption would report a figure that FALLS after a compaction. Grok reports
no plan window and no delegation on a usage record (its subagents run as their
own session directories), so both are `false` in `SOURCE_CAPABILITIES` and
render as absent, never as zero.

### Normalization

`weightedTokens` is a model-size-weighted compute proxy, per `concepts.md`, with
an explicit editable basis in `model-weights.ts` — relative model weights and
per-unit multipliers (decode, cache read, cache write), resolved by
longest-prefix match on the model id. **No public per-token price is treated as
truth.** The operator is on subscription plans where per-token price is not what
is actually paid, and provider pricing changes independently of the data.
`resolveModelWeight` reports `explicit: false` when it fell back, so a surface
can disclose when a weight was assumed.

One per-source normalization is load-bearing and easy to get wrong. `RawUsage.
inputTokens` is FRESH, uncached input. Claude Code already reports it that way;
Codex's `input_tokens` includes its cache counters, and Grok Build's ACP-wire
`inputTokens` includes BOTH `cachedReadTokens` and `cacheCreationTokens`. Both
parsers subtract, floored at zero — an inconsistent record under-reports rather
than emitting a negative.

## 2. Corpus (measured 2026-07-24, this machine)

| | Claude Code | Codex |
| --- | --- | --- |
| files | 2,444 | 356 |
| lines | 143,832 | 420,962 |
| bytes | 653 MB | 2,005 MB |
| samples emitted | 26,166 | 70,037 |
| delegated records | 23,397 | 0 |
| provider session ids | 2,070 | 302 |
| **operator** sessions | **61** | **302** |
| **machine-invoked** sessions | **2,009** | **0** |

Totals: **96,203 samples across 2,800 files and 2.66 GB**, over 69 resolved
Projects.

> **Read the session rows carefully — a raw session count is not a count of
> work.** 2,009 of Claude Code's 2,070 provider session ids are Exawatt's own
> goal-subtitle summarizer: it invokes `claude -p --model haiku` per Session and
> every call opens a fresh session id. They are **97% of Claude session ids and
> 1.5% of Claude tokens** (114.0M of 7,697.8M). Any per-Session surface that
> does not separate them is almost entirely noise, and Exawatt's own overhead
> books silently against the Projects it is measuring. See §3a. `linesUnparsable: 0` and `truncatedFinalLines: 0` on this corpus —
both paths are still covered by fixtures, since a mid-write crash is a matter of
timing, not of whether the code handles it.

**Retention** bounds every historical claim:

- Claude Code: earliest sample **2026-05-28**, latest 2026-07-25 — roughly a
  two-month floor.
- Codex: earliest sample **2025-11-19**, latest 2026-07-25 — roughly eight
  months.

Any window longer than about two months is Codex-only and must say so. Neither
harness documents its retention policy, so treat both as observed floors that
can shorten without notice, not as guarantees.

## 3. Attribution and delegation

**Project attribution: 100.0%.** Zero of 96,203 samples lack a `cwd`
(`recordsWithoutCwd: 0`, `recordsWithoutSessionId: 0`). Claude Code writes `cwd`
and `gitBranch` on every assistant line; Codex writes `cwd` in `session_meta`.
This was the number that decided whether the feature could be truthful, and it
is unambiguous.

One honest caveat: having a resolvable `cwd` is not the same as that `cwd`
mapping to a **known** Exawatt Project. Attribution to the durable Project
registry is E2's job and can still fall short of 100%; what the corpus
establishes is that the data never forces a guess.

`recordsWithoutModel: 273` (0.28%) fall back to the default weight and are
disclosed rather than assumed.

**Delegated spend, measured:**

| Measure | Delegated share of Claude usage |
| --- | --- |
| samples | 9,853 / 26,166 = **37.7%** |
| raw tokens | 1,223.3M / 6,813.5M = **18.0%** |
| normalized tokens | 1,101.3M / 4,645.6M = **23.7%** |

`spawnDepth` histogram: `null: 7,063`, `1: 2,764`, `2: 26`. Depth is unknown for
most delegated samples because the sibling `meta.json` is not always present;
depth 2 confirms nested delegation happens and must not be assumed away.

> **This corrects ENG-023.** That item states delegated spend "dwarfs their
> parents' own usage locally." On this corpus it does not — it is 18% of raw and
> 24% of normalized Claude tokens. It is far too large to ignore (a spine that
> skipped it would under-report Claude by nearly a quarter) but it does not
> dominate. ENG-023's wording should be corrected to avoid propagating a claim
> the data does not support.

**Double counting — resolved, and it was real.** Claude `requestId`s span parent
and subagent transcripts: 397 request ids appear in both. Summing per-file or
per-adapter would double-count every one. The merge is therefore **corpus-global
on `idempotencyKey`**, collapsing 43,221 duplicate records across the scan. This
is the single easiest way for these numbers to be wrong and it is covered by
unit tests, not just by the observed count.

Codex emits **0** delegated records, as ENG-023 predicted. The contract
represents this as an **absent capability**, never as zero — a Codex Session's
delegated share is unavailable, which is a different fact from "it delegated
nothing."

### 3a. Operator work vs machine-invoked work

`ConsumptionSample.entrypoint` carries the source's own invocation marker
verbatim — Claude Code's `entrypoint`, Codex's `originator` — and
`isOperatorEntrypoint` classifies it. Measured entrypoint mix:

| Source | Entrypoints observed (records) |
| --- | --- |
| Claude Code | `cli` 26,726 · `sdk-cli` 3,717 · `claude-desktop` 614 |
| Codex | `codex-tui` 68,845 · `codex_exec` 1,367 · `codex_cli_rs` 707 · `Codex Desktop` 236 |

On this corpus `sdk-cli` is perfectly correlated with haiku and `cli` never is,
but **the discriminator is the entrypoint, not the model.** The summarizer's
model is a configuration choice that can change, and a haiku turn inside an
interactive session is real operator work. Both cases are pinned by tests.

Unknown entrypoints and `null` classify as **operator work**. Under-reporting is
the worse failure: a marker this parser has not seen must still appear in a
total rather than silently vanishing.

**Open judgment call:** `codex_exec` (1,367 records) is the shape-analogue of
`claude -p` — non-interactive Codex. It is currently classified as operator work
because Exawatt does not invoke it, so those records are presumed to be the
operator's own scripting. If another tool on this machine drives `codex exec`,
that presumption is wrong and the classification should move.

### 3b. Which source actually dominates

This matters because only Codex reports a plan window (§4), so "how much of the
operator's work can a capacity meter speak to" depends entirely on which
denominator is honest:

| Denominator | Claude Code | Codex |
| --- | --- | --- |
| operator sessions | 61 (17%) | **302 (83%)** |
| raw tokens | 7,583.8M (45%) | **9,415.9M (55%)** |
| normalized tokens | **4,645.6M (77%)** | 1,371.8M (23%) |

Codex is the majority of real sessions and of raw tokens; Claude dominates only
model-weighted compute, because its sessions are far larger and run heavier
models. A capacity meter is therefore **more** useful than a naive session count
suggests, not less — it speaks to 83% of the Sessions the operator actually
opens.

## 4. Capacity truth

**Codex reports plan windows on disk.** 12 distinct windows were recovered,
including a live weekly window at **75% used** (`windowMinutes: 10080`,
`planType: pro`). Two different `limitId`s appear, which means **plan identity is
not global** — a rollup must key windows by `limitId`, not by source.

**Claude Code records no plan or quota data locally. This is now definitive.** A
structured key search across the entire `~/.claude` tree for
`rate_limits`, `used_percent`, `resets_at`, `window_minutes`, `plan_type`,
`five_hour`, `weekly_limit`, and `quota_remaining` returns **zero** matches. An
earlier text search appeared to hit inside `~/.claude/transcripts/`, but those
matches were message *content* — a user typing the word "quota" — not structured
fields. There is nothing to parse, so E1's asymmetry is permanent until Anthropic
changes what it writes, and a Claude plan meter must read as *unreported*.

> **Cross-reference (2026-08-11).** The local absence above remains
> definitive and is exactly WHY Claude plan truth became ENG-038's separate
> source class: slice 1 of `provider-consumption-accounts.md` now reads the
> vendor's own account endpoint (credentialed, remote, read-only — the one
> Claude Code's `/usage` consults) and merges the windows into the same
> snapshot as `origin: 'provider-account'`. Nothing in THIS spine gained a
> credential or a network call; when that read is off or failing, Claude
> reads as unreported here exactly as this section states.

Two open problems the scan exposed, both for the UI rather than the parser:

1. **Staleness.** Recovered windows include observations from 2026-03 and
   2026-05 sitting beside a live one. A meter that renders a four-month-old
   window at 1% is lying quietly. `PlanWindow` carries `observedAt`; the surface
   needs a freshness rule, and a window past its own `resetsAt` should read as
   expired rather than current.
2. **Degenerate windows.** Some records carry `windowMinutes: 0`. These must be
   discarded rather than divided by.

### Operator brief 2026-08-03 — the multi-vendor reality and three goals (deliberately unshaped)

The operator, describing their real daily workflow the day the Usage surface
shipped: "I find myself switching between claude.ai settings/usage, the
platform.claude.com workspace cost page, the platform.openai.com billing
overview, and chatgpt.com/codex analytics usage to check all my consumption and
usage as my agents burn down my plan. I have a few goals: time / spend
management: ensure I'm not blasting through my week's allotment too quickly,
ensuring I have enough tokens for the thing I know I need to work on tomorrow;
while at the same time ensure I am tokenmaxxing within my plans: if I have some
free allocation that will reset soon, I want to see that. I pay for the pro
plans for OpenAI / Claude so I want to use the maximum I can under the limits.
I also pay for overage tokens and pay per token via the API keys as well. So it
would be good to see all this in one place — much in the same way analogously
that cmd+t in our app is sort of an aggregator for starting agents of different
harnesses or vendors, sort of making that distinction less meaningful."

Read as direction, this states one thesis and three goals over it:

- **The aggregator thesis**: Usage should absorb the four vendor tabs the way
  ⌘T absorbed vendor launch — the vendor distinction becomes less meaningful.
  This eventually requires provider usage/billing APIs (`reported`/`verified`
  rungs of the assurance ladder), which stay deliberately OUT of the local E5
  slice; the seam is already modelled (assurance, `PlanWindow` keyed by
  `limitId`, source-agnostic samples).
- **Pace management** (validated by today's build): don't blast the weekly
  allotment — headroom + reset + pace is already the headline currency.
- **Reserve-aware planning** (new, unshaped): "enough tokens for the thing I
  know I need to work on tomorrow" — a notion of planned future work drawing
  against remaining headroom. Touches ENG-017 (the queue knows tomorrow's
  work) and ENG-014 (allocation).
- **Tokenmaxxing** (new, unshaped): the inverse alert — free allocation that
  resets soon is a use-it-or-lose-it opportunity, not a comfort. Today's
  meter/page only warn about running out; nothing surfaces expiring headroom.
- **Overage and API pay-per-token** (new, unshaped): the operator's real spend
  spans plan windows, plan overage, and metered API keys; the model must
  eventually represent all three spend classes, not just plan windows.

No scope is shaped here; each bullet awaits its design pass. Roadmap carries a
one-line pointer under ENG-008.

## 5. Performance — the finding that changes the plan

A full cold scan of the real corpus: **19.3 s wall clock, ~617 MB heap delta,
2.66 GB read.**

That is far outside any interactive budget and roughly two orders of magnitude
too slow to run on a workspace surface. ENG-008's exit criterion — "a full local
corpus scan completes within an interactive budget and never blocks the
workspace" — **is not met by a cold scan and cannot be.** Codex alone accounts
for 2.0 GB across 356 files, because rollout transcripts carry full
conversation content alongside the `token_count` events we actually want.

Incremental scanning is therefore mandatory, not an optimization. The port
already carries the machinery: `ConsumptionWatermark` records a per-file byte
offset plus a carry buffer for a partial trailing line, and `resumePoint` skips
a file whose size and mtime are unchanged. What remains before E2 can be
considered done:

- persist watermarks across launches (they are currently per-scan)
- a first-run cost that is explicitly backgrounded and cancellable, never inline
- a bounded, streaming rollup so peak heap does not scale with corpus size
- for Codex specifically, consider seeking to the last `token_count` event
  rather than reading whole rollouts, since cumulative totals make earlier
  events redundant

**RESOLVED 2026-08-10 by the E5 scanner** (milestone log below): watermarks,
samples, and window history persist in userData; the first scan is
backgrounded, chunk-bounded, and cancellable; and the working set is the
merged sample map, never the corpus. Measured on the corpus as it stands
today (grown to **3,642 files / 4.31 GB / 127,849 merged samples**): cold
first scan 16.7 s in the background with 85 MB resident after it, **warm
launch 0.43 s** to a served snapshot, **incremental pass 0.08 s reading only
the 168 KB that was appended**, cancel to idle in 75 ms. The Codex tail-seek
idea above was deliberately NOT taken: skipping middle `token_count` events
would erase the per-day/per-hour time series the rollups and charts read;
chunked reads bound the heap without giving up day-level truth.

## 6. Assurance

Every rollup carries its facet, and the facets stay independent:

- **reported** — the harness wrote the figure into its own log.
- **observed** — Exawatt read that file on this machine.
- **verified** — never claimed. Nothing here is reconciled against provider
  billing, and no surface may imply it is.
- **authorized / enforced** — not applicable to a read-only parse. Nothing in
  this slice authorizes or enforces a ceiling.

Local log reads are `observed`; Codex plan windows are `reported`;
`intersectAssurance` degrades a mixed rollup to the weakest facet of its inputs
rather than averaging.

ENG-038's vendor-account plan windows (2026-08-11) occupy the `reported` rung
with a different claimant: the VENDOR reported the figure and nothing was
locally observed — `PlanWindow.origin: 'provider-account'` carries that fact,
and such windows never enter rollups, so `intersectAssurance` never sees them.

## 7. Privacy

The parse reads only usage records, identifiers, timestamps, model ids, `cwd`,
and `gitBranch`. It does not read, retain, or emit message content, prompts,
tool output, or file contents. Test fixtures are hand-authored, not copied from
the corpus. The numbers in this doc are aggregates; no session content, prompt
text, or project path appears here.

This is the direct argument for publishing these adapters as open source: the
feature reads `~/.claude` and `~/.codex`, and the cheapest way to earn that
trust is to let anyone audit exactly what is read and confirm nothing leaves the
machine.

## 8. Roadmap milestone log

### BUG-032 — samples get the retention horizon observations always had (landed 2026-08-16)

**A log bound is not a state bound.** `consumption-scan/log-v1.jsonl` had
reached 139,496,716 bytes / 173,571 lines on the operator's machine — 164,998
`sample`, 6,421 `mark`, 2,152 `obs` envelopes — and every one of them is
streamed and `JSON.parse`d inside `ensureStarted()` **before `ready` resolves**,
which is before `/usage`, the Fleet board, or `settledSamplesSince` can answer
anything. Measured hydrate: **2,753 ms**.

**Root cause, stated precisely.** `compact()` rewrites the log FROM LIVE
STATE. That makes the log's size a function of the state's size, so §5's
promise that "the log's bloat is bounded" only holds while the state is
bounded. It never was. `WindowObservationAccumulator` gave plan-window
observations a 14-day horizon — bounded by `buckets x (horizon / slot)`
regardless of how many raw records the corpus holds — and the samples sitting
beside it in the same store got nothing. The compacted floor was therefore the
full sample set, monotonically rising, and `shouldCompact`
(`appendedBytes > compactedBytes * 2 + slack`) compared the log against a
number that could only go up. Compaction was designed as a log bound with no
corresponding state bound.

**Fix.** `ConsumptionSampleWindow` (`packages/core/src/consumption/sample-window.ts`)
is the missing state bound, written in the same shape as the observation
accumulator it sits beside:

- the horizon is **anchored at the newest sample seen, never at wall time**, so
  a clock jump or a corpus restored from backup cannot silently empty it;
- it is enforced where samples are **written** (`sink.samples` in the scanner,
  and the hydrate loop in the store), so a sample outside the horizon never
  enters state and therefore never enters the log compaction rewrites;
- the default is 14 days — the same horizon observations use, and twice the
  7-day window every rendered surface actually reads (`LIVE_WINDOW_DAYS`).

Two dependent corrections fell out of the same reading:

- **The compaction floor became honest.** `compactedBytes` loaded from meta is
  a historical artifact; a state that SHRANK (retention, deleted transcripts)
  could never trigger the compaction that reclaims the space. The store now
  measures `retainedBytes` — what a compaction would write today — while it
  streams, and lowers the floor to it.
- **A fourth unbounded field, inside the watermark.** `ConsumptionWatermark` is
  a ~190-byte record (path, size, mtime, offset) with one open field:
  `sessionContext`. The Codex parser's `seenSnapshots` dedupe set grows one
  entry per turn and rides it, reaching **191 KB on a single watermark**; 492
  Codex watermarks held 9.8 MB of the log's 10.4 MB of marks. It is only a
  parse-time duplicate filter over the tail a watermark already says is new —
  the durable idempotency owner is `mergeSamples` keyed by `idempotencyKey` —
  so it is bounded to its newest 256 entries in `parseCodexRollout`, and rows
  written before the bound are clamped as they hydrate.
- **`snapshot()` stopped re-parsing the corpus.** It runs on every
  `workspace:changed`, i.e. every tab switch, and re-`Date.parse`d every
  retained sample each call. The window keeps the instant it parsed on
  admission, so `since()` reads it.

**The horizon is a policy input, not a constant, and that is load-bearing.**
One consumer's window is not fixed by this module. Rendered surfaces read 7
days. The Operator-profile publication (ENG-035) rescans everything since its
opt-in anchor and `sync_operator_stats` **replaces the caller's public
aggregate atomically** (`DELETE FROM operator_days WHERE user_id = claimant`),
so silently pruning under it would truncate a live published profile — the
operator's own `operatorProfile` is `autoPublish: true`, anchored
2026-08-03, syncing daily. `main.ts` therefore widens the horizon to cover an
active anchor and `resolveSampleHorizonMs` clamps it at 400 days, which is the
hosted contract's own `days` cap: past that the payload is rejected anyway, so
retaining the samples behind it buys nothing.

**Measured, on the operator's real log:**

| | before | after |
| --- | --- | --- |
| `log-v1.jsonl` | 139,496,716 B | 36,760,158 B (3.8x, and bounded) |
| retained samples | 138,485 | 41,151 |
| hydrate before `ready` | 2,753 ms | 250 ms (11x) |
| `snapshot()` per tab switch | 13.8 ms | 3.4 ms |

The first launch after this change still reads the old 139.5 MB log once,
compacts it (the load-time floor makes `shouldCompact` true), and every launch
after that pays the 250 ms.

**Regression coverage.** `packages/core/src/__tests__/consumption-sample-window.test.ts`
holds the bound itself (270 days of one sample per day retains 15); the store
test proves a log whose state shrank now compacts, at a scale past the
compaction slack; the scanner test proves the fixture's July half never enters
state OR the persisted log under the default horizon and does under a widened
one; the parse test proves the watermark's snapshot set is bounded while
incremental dedupe still works.

**Open.** The horizon still widens with an Operator-profile publication
anchor, so a long-lived opted-in install grows toward the 400-day ceiling. The
durable answer is a bounded local archive of the derived `days` rows (the
hosted side caps them at 400 and `runs` at 500), which would let the raw
horizon stay flat at 14 days. That belongs to ENG-035, not here.

### E4 — Expository Consumption surface (landed 2026-08-02)

The spine was real but invisible: a package plus a fixture workbench, with
nothing a user or prospective contributor could look at. E4 turns
Consumption into a production surface whose job is to EXPLAIN.

**Route and reach.** `/consumption`, registered in `src/components/nav/surfaces.ts`
as an `app`-tier surface — the same tier as Settings — so it is reachable from
⌘K, the go chord (`g u` since E9 2026-08-11; originally `g c`), and every
manifest-driven affordance. It is deliberately
NOT a command altitude: Terminal → Sessions → Spatial stays exactly three. It is
also in `proxy.ts`'s public prefixes, like Settings, because it must render in
the offline Electron renderer and reads nothing but its own demo source.

**Four acts, one scroll**, each headed by the question it answers in plain
language:

1. *What is this costing me right now?* — capacity and pacing, with Codex's
   reported plan windows beside Claude Code's explicit non-reporting.
2. *Where did it go?* — Workspace → Project → Session, raw units first,
   delegated spend inside every Session total with the split visible.
3. *What did it buy?* — burn joined to the roadmap lens, per-milestone figures
   labelled an amortization rather than a measurement.
4. *Where this goes* — ENG-014's allocation lever as a visibly unbuilt
   affordance.

Between acts 2 and 3 sits a direct, anchored answer to the operator brief's
recorded user question, "how are you tracking cost per agent?", and after act 3
the five assurance facets are EXPLAINED — what each would mean, and what is
actually true here — rather than merely displayed.

**The unit ladder is the expository spine.** Four rungs (tokens, normalized
compute, dollars, watts), each stating its own epistemic status, its basis, and
its caveat in place, with a loud rule between rungs 1 and 2 reading
"measurement stops here — everything below is modelled". The dollar rung states
that it is not billing truth; the watt rung states that it is an order of
magnitude and is why the product is called Exawatt. The normalized basis is
composed from core's own exported constants so the printed sentence cannot drift
from the arithmetic beside it (`src/components/consumption/units.ts`).

**Extraction, not a fork.** `flux.ts` and `atoms.tsx` moved out of the lab into
`src/components/consumption/`, joined by `model.ts` (the one view-model),
`capacity.tsx`, `delegation.tsx`, `coverage.tsx`, `unit-ladder.tsx`,
`assurance-legend.tsx`, `unbuilt.tsx`, and `clock.tsx`. Both
`/hud-gallery/consumption-lab` and `/consumption` render those components; the
lab's fixtures now type-alias the shared view-model, so a fixture that compiles
in the workbench is a shape the production surface can render.

Two translations live in `model.ts` and are load-bearing:

- `DisplayUsage` segments are **disjoint** so they can be stacked, while core's
  `reasoningTokens` is a **subset** of `outputTokens`. Adding core's fields
  naively would double-count every Codex turn.
- `reasoning: null` means the source *cannot report it*, decided from
  `SOURCE_CAPABILITIES` rather than by testing the number for zero.

`windowFreshness` closes §4's first open problem: a window past its own
`resetsAt`, or a reading older than the window it describes, renders as
unreported rather than at its last value.

**Demo Mode through the real contracts.** `demo-source.ts` emits genuine
`ConsumptionSample`s and `PlanWindow`s and rolls them up with core's own
`rollupByProject` / `rollupBySession` / `rollupByRoadmapItem` / `rollupWorkspace`.
Swapping the sample producer for `scanConsumption()` changes nothing downstream.
Figures are shaped to the corpus measured above: cache reads dominate by an
order of magnitude, delegated runs are ~20% of normalized Claude burn, Codex
records no delegation at all, ~18% of burn is attributed to no roadmap item, and
Exawatt's own `claude -p` summarizer appears as many session ids carrying ~1% of
the volume — separated by entrypoint, never folded into the Projects it
measures. `src/components/consumption/model.test.ts` pins each of those
properties so the demo cannot quietly drift away from the corpus.

**"Designed, not built" is one convention.** `Unbuilt` renders a dashed outline
in the neutral unknown grey (never the violet consumption channel), a tag naming
the roadmap item that would build it, and `inert` contents that cannot be
clicked, focused, or tabbed to. It is used for act 4's allocation lever and for
act 1's ceiling controls, and `UnbuiltLegend` states what it means where a
reader meets their first instance.

Deliberately still out of scope: incremental scanning, live wiring, budget
enforcement, and any dollar figure presented as fact.

**Reconciliation owed to ENG-026** — RESOLVED 2026-08-02 by ENG-026 N0/N1
(narrative in `vision-complete-ia.md`): `Unbuilt`/`UnbuiltLegend` moved to the
shared `src/components/readiness/` set and the tag now speaks the app-wide
**Coming soon** token; `/consumption` is registered `preview` in the navigation
manifest and its header marker is manifest-driven, so E5's flip to `live` is a
one-line manifest change; and the intervention-rate metric renders as its own
"Asked by a user" section (an intervention = an operator message after launch,
modeled in `interventionStats` with per-Session / per-active-hour / per-100k
cuts and the untouched-session share; `DemoSessionSpec.interventions` is
required so a construction site must state 0). E5 additionally owes the live
intervention count (`UserPromptSubmit` via the ENG-023 channel for Claude Code;
user turns in Codex rollouts).

### Closing-review fixes (2026-08-03)

- **Per-source window label.** The surface hardcoded "seven days" (unit
  ladder) and "this week" (Act 3 heading, cost-per-agent, attribution
  footnote, intervention detail) while the Demo tenant's Voltaic corpus is
  fourteen days. `DemoConsumption` now carries `windowLabel` ("seven days" /
  "fourteen days") and every window-naming sentence reads it. The Act 3
  heading also gained its scope clause: "…% of **operator** burn…" — the
  percentage is computed over operator work only, with overhead separated.
- **Interventions authored in the corpus.** The Voltaic source derived
  intervention counts formulaically at view time under copy claiming
  "measured, not surveyed"; `DemoFleetAgent.interventions` is now a required
  authored fixture field (heroes match their transcripts, test-enforced) and
  the derivation is deleted.

### E7 — Attribution rides every entity (landed 2026-08-03)

Operator scope decision: consumption appears on entities app-wide, with
plan-window headroom + pace as the headline currency, never dollars. E7 is
the first execution of that: the two entity surfaces an operator already
reads — Team tiles and the Fleet board — carry burn without leaving their
altitude.

**One derivation, no surface-private math.** Fixture Agents get
`demoAgentBurn` (`packages/core/src/demo/burn.ts`): raw tokens across all
units plus model-size-weighted tokens through the canonical E3 proxy
(`consumption/model-weights.ts`), delegated runs included at their own model
weight. The Demo fleet transport maps it into two new OPTIONAL
`AgentMetrics` fields (`rawTokens`, `normalizedTokens`) — the live local
transport reports neither, so live Sessions are absent, never zero, until
E5. `@exawatt/ui-model`'s `computeAgentBurn`/`selectFleetBurn`
(`consumption-burn.ts`) normalize once for everyone: `share` (slice of the
scope's normalized total) and `intensity` (against the hottest reporting
agent/zone).

**Team tiles.** Each exposé Session tile carries a Tufte word-sized readout
under Next: raw tokens this Session (`34.9M tokens`, mono chrome-meta) and
a 3px share bar over the FLUX track. Monochrome until notable — the FLUX
channel lights only past the ramp's calm→warm boundary (0.62 intensity),
so one hot session reads magenta while the rest stay quiet. The exact
figure, the workspace share, and the bar's basis ride the title tooltip
and the tile's accessible name.

**Fleet burn lens — RETIRED FROM PRODUCTION 2026-08-03, corrected here
2026-08-14.** This paragraph described a shipped affordance for eleven days
after it stopped existing. The ENG-004 "one continuous world" board pass
(`bc43842`, same day) deleted the `?lens=` URL param, the Status/Burn
segmented control, and the `lens` prop pass-through in
`spatial-fleet-client.tsx` at the operator's own direction ("the normalized
Burn lens/readout had no legible operator job" — Amendment chain,
2026-08-03). The 2026-08-13 `/usage` audit caught the drift by driving the
real board; re-verified 2026-08-14 on the operator's live corpus:
`data-board-lens="status"`, zero controls matching /burn/i, and `B` inert.
What survives is deliberate and undeleted: `OperationsBoardSurface` still
accepts a `lens` prop, `/eval/t5-operations-board` and `/eval/t10-board-scale`
still drive both lenses, and the shared derivation is intact — so a future
surface with a shaped operator job can mount it without rebuilding it. **E7
therefore has one live carrier (Team tiles), not two.** The original design,
for the record:

`?lens=burn` on `/fleet/spatial` (segmented control
beside the projection switcher, `B` key, `data-board-lens`): population
dots and status-mark hues recolor from the D40 protocol to the FLUX
pressure ramp through the SAME instanced mesh — a parallel color palette,
not a second mesh system. Shape still carries status (D30 redundant
channels); zone DOM controls own the exact figure (`18% of burn`,
`usage unreported` in the neutral grey); a ramp legend sits under the
toggle. Zone intensity normalizes against the hottest zone
(choropleth uses the full ramp); aggregate dots carry zone intensity
because per-dot identity does not survive aggregation — an honest
granularity statement, not a shortcut. Status stays the default lens, the
lens lives in the URL like the projection, and attention semantics
(triage order, `needsAttention`) never read it — a hot-burn agent is not
"blocked".

Verification: `eval:r3f` 100/100, `eval:spatial` all-PASS, the Electron
workspace-tenancy eval PASS, 1296 unit tests green (new
`consumption-burn.test.ts` pins the normalization and the zone/piece
propagation). Headless screenshots reviewed: Demo Team tiles with 27
readouts (hottest magenta, rest monochrome), the board in both lenses
with the dispatch-engine zone reading hottest at 18% share.

### E8 — Production composite page (landed 2026-08-03)

Supersedes E4's four-act narrative as the shipped `/consumption` UI. The
operator reviewed the three full-page directions in
`/hud-gallery/consumption-redesign` and picked a **composite**: Direction A
("Console") supplies the top — plan-window cards with headroom, reset, pace
vs even burn, and projected exhaustion, plus the headroom-over-time chart —
and Direction B ("Ops board") supplies the floor — the dense monospace
entity grid where every operator session is a row. Quality bar set verbatim:
"don't make the UI suck — make it super clear and crisp and understandable."
The gallery directions stay frozen as the design record; the production page
carries its own copies (`src/app/consumption/derive.ts`, `chrome.tsx`).

**Band structure**, answering am I OK? → where is it going? → what should I
change?:

1. Demo-data assurance banner — the E4 one-liner, per-tenant chip
   (`Demo data` / `Demo Workspace`), unchanged honesty claims.
2. Plan-window cards — tightest window as the headline card (display-rung
   percent, projection at reset, pace bar with even-burn tick, %/h
   observed); other windows as compact cards; Claude Code as an absent
   hatched channel with its observed 5h raw figure — no plan record, never
   0%.
3. Headroom-over-time for the tightest window — measured shape scaled to
   the harness's reported percent (labelled as such), even-burn diagonal,
   hatched projection to reset.
4. Attribution — one pivot (Project / Session / Model / Source / Roadmap
   item), normalized by default with a raw-units mode (unit-stack bars +
   legend). Bars are doors.
5. The session grid — every operator session a row: identity tick, live /
   recency, delegated `+N`, src/model, burn sparkline, raw, norm, impact
   bar, intervention count. Rows are doors into the same drill panel.
   Voltaic's 115 sessions stay comfortable behind a 14-row fold with an
   explicit `Show all…` expander that names the folded count and burn.
6. Ratio diagnostics as one quiet tile row — cache-miss share, cache
   re-read leverage, reasoning share, delegated share (not-recorded stays
   grey), **intervention rate** (the ENG-026 N2 stats compressed to a tile;
   detail in the tooltip), Exawatt overhead. The ENG-014 allocation lever
   survives beside it as an `AnnouncedChip` — chip-scale, honestly unbuilt.

The **drill panel** is the page's only dollars, always labelled
`modelled · list-price model · not billing truth`, and is never empty (the
top pivot row is the default door). Both corpora run through the same
view-model and the ENG-027 tenant gate exactly as before.

**A new honesty case the grid forced:** Voltaic's fourteen-day history
contains 88 provider sessions with samples but no fleet identity record.
They render as rows with measured figures and honestly absent identity —
neutral-grey `Session <id8>` titles, `—` interventions ("no session
record"), project resolved from the launch directory — and they join the
Session pivot and drill lists so pivot totals reconcile. Absent identity is
shown, never invented and never folded away.

**Deleted:** `act-capacity.tsx`, `act-attribution.tsx`, `act-outcome.tsx`,
`act-allocation.tsx`, `intervention-rate.tsx` (the acts and essay sections).
The Ops board's events ticker was deliberately not carried: the grid's live
rows and intervention column already carry those signals, and it did not
earn its space. **Kept:** the shared atoms (`atoms.tsx`, `flux.ts`,
`units.ts`, `model.ts`, capacity/coverage/delegation primitives) — the page
mounts `Sparkline`, `UnitStack`, `UnitLegend`, and `modelledDollars`.
`unit-ladder.tsx` and `assurance-legend.tsx` remain as components (E4's
expository register, still honest) but are no longer mounted anywhere; if
nothing re-mounts them by E5 they should retire with the consumption-lab
fold-in. [Resolved 2026-08-03: nothing re-mounted them; the retirement was
pulled forward — see the study-retirement entry below.] Type on the new page is kernel rungs only — the E4 fractional
scale (`text-[13.5px]` etc.) left `src/app/consumption/` with the acts.

**The rename, executed the same day:** the display name lives once in
`CONSUMPTION_SURFACE_NAME` (`packages/core/src/surface-names.ts` since ENG-016 D57, shared with the Electron main process),
consumed by the page h1, the `/usage` segment metadata (browser tab +
Electron window title), the navigation manifest entry, the ⌘K shortcut
labels, the architecture manifest's surface node, and (since ENG-016 D57)
the Electron Go-menu row, which reads the shared constant instead of
mirroring it by hand. The naming
research confirmed **Usage** (17 of ~22 reference products) and the
operator agreed, then overrode the interim redirect plan: **hard cut** —
the page moved to `/usage` and `/consumption` 404s, no redirect, no legacy
debt. Every internal reference was swept to `/usage` (nav manifest, Go
menu, ⌘K labels, ambient-meter click-through + popover copy, tenant-gate
route set, proxy public prefixes, `surfaces.test.ts`); stored pre-rename
command-surface memory fails validation and falls back to the default
surface by design. Internal ids keep historical spellings (`consumption`
surface id, `go-consumption`, `src/components/consumption/` — kept, per
the ids-are-addresses rule, as the cheap consistent option) and the
canonical CONCEPT stays Consumption (`concepts.md` unchanged); the wattage
brand lives inside the page (FLUX, headroom), never in the nav label. The
E6 ambient meter ships enabled in chrome with the operator-picked
fraction-bar form (`AMBIENT_CHROME_METER_ENABLED: true`,
`CHROME_METER_FORM: 'bar'` — both already wired).

Verified: type-check, lint, full `pnpm test:run` (1306 passed), the
ENG-027 Electron tenancy eval (PASS against this tree's dev server), and
1440w screenshots of both corpora plus drill-panel / raw-mode / expanded-grid
interaction states, all with zero console errors.

### Usage-loop review fixes (2026-08-03)

Consolidated fixes from three verified reviews (code/architecture + UI/UX) of
the usage loop. The operator's bar: one instrument, not four features that
agree by luck. Landed as one change (ENG-008):

- **One tenant-aware snapshot seam.** The ambient chrome meter read
  `demoConsumption()` unconditionally while `/usage` tenant-switched to the
  Voltaic corpus — in the Demo tenant the title bar and the page disagreed on
  every number (84% vs 71%, resets 2d6h vs 3d5h). Both now read
  `useTenantConsumption()` (`src/components/consumption/use-tenant-consumption.ts`),
  one corpus and one pinned clock (`view.nowMs`) per tenant. The meter
  comment that claimed this invariant is now structurally true.
- **One pace derivation.** Even-pace verdicts were computed three times with
  two bands (meter ±5, page ±4, gallery ±4). `meter-model` now owns the band
  (`PACE_EVEN_BAND = 5`), the verdict (`classifyPace`), the derivation
  (`readWindowPace`), and the words (`paceSentence` / `paceLabel`); the page's
  `WindowPace` is the meter's `MeterReading`, and the frozen consumption-redesign
  workbench imports the classifier rather than re-banding. One vocabulary
  survives: "even pace" (never "even burn"), and one exhaustion verb, "spent"
  (never "exhausts"). Unit-tested at the source (`meter-model.test.ts`,
  `src/app/usage/derive.test.ts`).
- **Window freshness on the page.** `/usage` consumed every reported window
  with no freshness filter while the meter filtered — at E5 a four-month-old
  window would have headlined the page. `allPaces` now flows through
  `readAllWindows`, the same live-only discipline (§4's staleness rule).
- **Printed basis matches the arithmetic.** The attribution normalized
  tooltip printed `WEIGHT_BASIS_SENTENCE` — a stale design-era ratio table
  (codex 1.4, reasoning ×5) — while the figures are weighted by
  `@exawatt/core` model weights. It now prints `NORMALIZED_BASIS_SENTENCE`
  (stated from core's own constants); the stale table moved out of
  production (`flux.ts`) into its only consumer, the frozen consumption-lab
  workbench (`consumption-lab/weights.ts`). Production has exactly one
  weight truth: core.
- **Strip and scope readout agree.** The Fleet metrics strip bucketed
  `error` into idle while the V3.2 scope readout folds error→blocked — the
  same screen showed "16 blocked 88 idle" against "25 blocked 79 idle".
  `fleet-manager` and `mock-fleet` metrics now use the board's
  needs-attention semantics (error counts as blocked), documented on
  `FleetMetrics`; `context-groups` already did.
- **`rawTokens` optionality restored end-to-end.** `FleetAgentView.rawTokens`
  flattened absent to 0 (erasing the absent-never-zero distinction
  `AgentMetrics` preserves), and hotfix 10d5be7 then hardcoded `rawTokens: 0`
  into the gallery fixtures. The field is optional again; consumers gate on
  presence, not `> 0`.
- **Meter popover fixes.** (a) Click-through now dismisses the popover;
  (b) the translucent-panel bug — the site header's backdrop-filter material
  breaks compositing of an overflowing absolutely-positioned descendant — is
  fixed idiomatically by rendering the popover through a portal on
  `document.body` (verified: forcing opacity did not fix it; leaving the
  backdrop root does). Footer copy moved to production register ("Open
  Usage").
- **Readiness markers carry no roadmap IDs.** `ComingSoonMarker` / `Unbuilt`
  render `owner` as a tooltip only — internal roadmap IDs no longer render
  in production chrome ("Coming soon · ENG-008" on the /usage h1, ENG-012/028/029/033
  on preview surfaces). The Demo banner keeps the honesty.
- **Raw-units mode is a real reordering.** Bars scale to the raw max
  (previously each bar was full-width), rows sort by raw total (previously
  normalized order under raw figures), and the overflow line states raw
  units, not nt.
- **Live ≠ hot.** The session grid and drill panel marked live rows in
  `FLUX.hot` magenta — on a consumption surface that channel must mean burn
  intensity only. Live markers now use the status protocol's Active blue;
  sparklines and impact bars stay in FLUX regardless of liveness.
- **Small honesty/legibility fixes.** Grid gap 8→12px separates the
  right-aligned NORM figure from the left-aligned IMPACT header; the V3.2
  scope readout's token figure states basis and window ("raw · session");
  the burn-lens legend says "share of normalized burn", agreeing with its
  aria label; every diagnostics tile states its window (corpus window or
  5h).

Recorded as owed, not built here: the keyboard path for band multi-select +
the Direct verb (ENG-004 doc), the `/usage` hardcoded ground colors
(ENG-032 debt note), and — for the demo-data owner — the Personal demo
week's tightest window is authored permanently hot at `DEMO_NOW_MS`, so the
meter's monochrome calm register is unreachable in demos until the corpus
gains a calm variant (data choice, not a meter bug). The aggregator/reserve
directions this review brushed against are already captured as E9/E10.

### Usage hierarchy pass — the five questions become the page (2026-08-03)

Driven by verbatim feedback from the day's live demo call:
operator — "this UI really sucks. It looks like an engineer built
it, which I did"; guest — "with all the different text treatments, I have no
idea where to read or what to look at or what the key takeaway is"; operator's
requirements in one sentence — "how much is left, how fast am I going, am I on
pace, am I overheating the engine, and how much am I spending"; guest, about a
long run — "how many tokens did that use?" and whether context ever compacted
("context rot… it needs more measurements for each run"). Landed as one
change (ENG-008):

- **Treatment diet.** The complaint was the count itself: the page carried
  ~30 distinct text treatments (family × size × weight × case × color —
  six size rungs, two-color button states, five one-off colored labels, a
  private colored SVG voice). It now renders through SIX roles, enforced as
  components in `src/app/usage/chrome.tsx` (page title · display numeral ·
  micro section label · body value · mono data · muted caption) with color
  as data-state only: FLUX ramp on consumption numerals/fills, `FLUX.hot` on
  a genuinely overheating window, unknown-grey on absence, Active blue on
  live markers, identity ticks. Controls, selection, and the demo banner
  dropped their FLUX tint — chrome is neutral; only data is colored. (The
  brief's "amber for hot" is deliberately NOT amber: the channel-ownership
  rule reserves amber for chrome attention, so hot stays `FLUX.hot`.)
- **One glance zone.** The Headroom band leads with the tightest live
  window as the page's single dominant statement — display-numeral percent
  in the pressure ramp + "resets in X · <pace verdict>" in plain words
  (the shared `paceLabel` vocabulary) + the pace bar. Every other window,
  and every source with no plan record (hatched, absent-never-zero), sits
  beside it as subordinate rows of the same answer.
- **The five questions are the structure.** Bands in the order the operator
  asked them: **Headroom** (how much is left) · **Burn** (%/h per window +
  the measured-shape chart, all chart lettering one dim mono voice) ·
  **Pace** (verdict + projection at reset per window) · **Heat** (only
  windows that exhaust before reset or run hot, with the meter's
  remediation line; calm state otherwise) · **Spend** (modelled dollars for
  the corpus window, split by source + overhead, "list-price model · not
  billing truth"). The attribution pivot + session grid + shared drill
  panel remain below as the drill-down floor ("where is it going"), with
  diagnostics as the quiet last row. The old plan-window card band and
  headroom-over-time band merged into Headroom/Burn.
- **Per-run measurement (the guest's ask).** The drill header now answers
  "how many tokens did THAT use" as a display numeral (`N nt` + raw
  beside it). A single-session drill adds **context-window pressure**:
  Codex rollouts carry context truth in the corpus (`model_context_window`
  272K on every sample; peak footprint + compactions newly authored in the
  fixture inputs — `contextPeakTokens`/`compactions` on `DemoSessionSpec`
  and `DemoFleetAgent`, codex entries only), rendered as "peak N% of 272K ·
  compacted ×n" with a pressure bar; Claude Code records neither, so its
  sessions read "not recorded" — absent, never zero (unit-tested in
  `derive.test.ts`). E5's live parse owes the real read: Codex cumulative
  token counts → peak/compaction; Claude stays honestly unreported.
- **Kept invariants.** The tenant seam (meter == page, one corpus and one
  pinned clock), pace single-source (`meter-model` words/band/derivation),
  bars-as-doors into the one drill panel, the honesty grammar (demo
  banner, no-plan-record hatch, unreported channels, outside-fleet-record
  rows), keyboard focus paths, and the ambient meter untouched.

Treatment count, the metric of the complaint: ~30 distinct treatments → 6
roles (strict family×size×weight×case tuples: 12 → 7, the seventh being the
chart's 10px SVG mono lettering). Evidence: before/after screenshots at
1440w in both tenants and both themes, `/tmp/exa-pw/usage-hierarchy/`
(session-scoped) and the ENG-008 landing commit.

### Study retirement (2026-08-03, ENG-036/ENG-008)

With `/usage` shipped (E8) and the bar meter form live (E6), the workbench
rule ("retire a gallery study once its subject ships") was applied to the
whole consumption exploration surface in one dead-code pass, pulling the
planned E5 fold-in forward:

- **Routes deleted:** `/hud-gallery/consumption-lab` (2,523 lines, incl. the
  private frozen `weights.ts` ratio table) and
  `/hud-gallery/consumption-redesign` (2,769 lines — the three direction
  studies whose winning composite is `/usage`). The design record lives in
  git history, the review screenshots, and the E6/E8 entries above.
- **Components retired (importer-verified dead):** `unit-ladder.tsx` and
  `assurance-legend.tsx` (zero importers since E8); `capacity.tsx`,
  `coverage.tsx`, `delegation.tsx`, and `model.ts`'s
  `tightestWindow`/`reportingCoverage` (only consumers were the deleted
  labs). The four-form ambient-meter gallery study
  (`meter/gallery-study.tsx` + its `/hud-gallery` section) retired with the
  form pick live.
- **Kept, with the consumer that saved it:** `atoms.tsx`, `flux.ts`,
  `units.ts`, `model.ts`, `clock.tsx`, `demo-source.ts`,
  `use-tenant-consumption.ts` (all mounted by `/usage`, the meter, or the
  spatial burn lens); the entire live meter (`meter-model`, `meter-forms`,
  `ambient-meter-chrome`, `meter-popover`, and `fixtures.ts`, which
  `meter-model.test.ts` exercises); the readiness-grammar gallery study
  (its surfaces are still preview).
- No eval or script navigated to the retired routes; the gallery index test
  keeps its kept-section assertions. Two references that arrived while this
  pass was in flight went with it: the ENG-032 T3C `CapacityPopover` material
  assertion (the shared overlay contract stays asserted through the live
  `MeterPopover` case in `material-popovers.test.tsx`) and the
  `gallery-study.tsx` allowlist line in
  `scripts/check-production-theme-literals.mjs`.

### E9 — Pace opportunity design options (landed 2026-08-10; pick recorded 2026-08-11: C + B — ship entry below)

The tokenmaxxing half of the 2026-08-03 brief ("if I have some free
allocation that will reset soon, I want to see that... I want to use the
maximum I can under the limits") had data but no voice: `pace: 'behind'` +
`msToReset` + headroom are pure derivations over `PlanWindow`, and the
settled escalation idiom (monochrome-until-hot, silent-below-hot) was decided
against the running-out goal — so the operator's best case rendered as the
calmest state on screen. The constraint that shaped everything: opportunity
must NOT borrow the alarm channel (no FLUX warm/hot, no amber, no status
colors, no motion) or the operator learns to ignore both.

**Three directions**, each state-switchable across five fixtures
(comfortable / mildly behind / strongly behind near reset / opportunity
expired / dual-signal) and each shown in BOTH placements — the ambient meter
popover and `/usage`'s Headroom band — in `/hud-gallery#pace-opportunity`
(`src/app/hud-gallery/pace-opportunity-study.tsx`, predicate + fixtures in
`pace-opportunity-model.ts`):

- **A · Quiet chip** — one added object: an outline chip in the monochrome
  family ("67% unused · resets 9h") past the threshold. Strong glance,
  but it is standing furniture during deliberate idle, and it adds an object
  class the popover otherwise does not have.
- **B · Expiry geometry** — no new object: the pace bars draw the region
  that dies unused (fill → projection hatch → +45° neutral hatch to the
  ceiling, boundary tick at the projected landing). Honest magnitude-as-area
  and the lowest overclaim risk, but weak at popover scale and it introduces
  a third hatch meaning beside "unreported" (−45° grey) and "projection"
  (−45° color) — a texture legend at micro scale.
- **C · Metric swap + coach (recommended)** — the line the operator already
  reads changes what it says: the pace-deficit sentence becomes
  "72% free · expires in 9h", `/usage`'s verdict swaps to "72% free to
  spend", and one coach line in the quiet register appears at the closing
  tier ("Weekly window resets in 9h with 72% free — front-load the heavy
  runs."), in the same slot as the hot remediation line with a priority
  rule: hot always wins. The only direction with a memory — the expired
  state keeps a one-line ledger caption on `/usage` ("Weekly window reset
  25m ago · closed with 67% unused"); the popover stays clean. Adoption
  cost: amends the shared pace vocabulary in `meter-model` — one place,
  both placements inherit.

**Trigger predicate** (proposed here, unit-pinned in
`pace-opportunity-model.test.ts`; production adoption follows the pick):

    opportunity = state ∈ {healthy, warm} ∧ pace = behind
                ∧ floor ≥ 15 pts ∧ reset ≥ 30m away
    closing     = floor ≥ 30 pts ∨ reset ≤ ¼ window

where **floor** = even-pace% − used% — the share that expires unused even if
burn returns to even pace this instant. It is pure geometry over two reported
facts, so the gate is burn-noise-free, and a floor of N pts requires N% of
the window to have elapsed, so a large floor can only exist late in a window
(reset proximity is partially structural). **course** = 100 − projected% is
the at-current-burn number the copy shows; it moves with the burn estimate,
so it never gates. 15 pts is 3× the shared even band (~45m of full-rate work
on a 5-hour window, ~a day of allocation on a weekly); hot/spent windows
never speak (the alarm wins outright); under 30m of runway nothing can still
be launched. The operator's verbatim shape (weekly at 28%, resets 9h → 72%
free, floor 67) sits deep in the closing tier; the real recovered weekly at
75% used never triggers. The standing false positive is named, not hidden:
**deliberate idle** — overnight every window drifts behind and no threshold
can distinguish sleeping from money on the table, which is exactly why the
voice must be quiet enough to survive being ignored and may never share the
alarm channel.

The dual-signal fixture proves the separation: the hot 5-hour window keeps
the FLUX ramp and the coach slot while the expiring weekly stays grey and
subordinate in every direction. By construction the opportunity window
almost never headlines the chrome glyph (tightest = max used%), so the voice
lives in subordinate rows and secondary lines — the glyph itself is
untouched in all three directions.

Evidence: headless Night-theme screenshots of every direction × state ×
placement via `scripts/pace-opportunity-shot.mjs`
(`/tmp/exawatt-e9-opportunity/`, 20 shots); 9 predicate tests + the gallery
index test green; type-check clean. Production surfaces untouched — the
operator picks a direction before any wiring.

### E9 — Pace opportunity SHIPPED: the C + B combination (landed 2026-08-11)

**Operator pick (2026-08-11): Direction C everywhere, plus Direction B's
expiry geometry on the `/usage` pace bars only.** B stays off the popover —
the study's own finding that a 4px hatch region needs reading held; Direction
A (the quiet chip) did not ship. Landed on live data (E5), so every number
below is a real PlanWindow the first time it renders.

What moved where:

- **The predicate is production.** `opportunityOf` + the four thresholds
  moved from the gallery model into `meter-model` — the file that already
  owns THE pace derivation, band, and vocabulary — so the chrome meter and
  `/usage` inherit one opportunity verdict the same way they inherit one
  pace verdict. The gallery model file keeps only the five review fixtures
  and imports the production predicate; the specimens can no longer drift.
- **The vocabulary amendment (Direction C's stated adoption cost).**
  `paceSentence` re-frames a firing window — open tier "24% will expire
  unused at this pace", closing tier "72% free · expires in 9h" — and
  `paceLabel` becomes "72% free to spend" in the calm color. One place;
  the popover rows, the popover header, the Headroom verdict line, and the
  Pace band all inherit with no call-site re-phrasing. Subordinate Headroom
  rows lead with "N% free · resets in …" while a firing row's popover
  caption brightens to panel text at the closing tier (color never moves —
  the alarm channel is untouched).
- **One coach arbiter.** `opportunityCoach(readings)` is the only door to
  the coach slot in BOTH placements: any hot or spent window silences it
  outright (HOT ALWAYS OUTRANKS), otherwise the best closing opportunity
  speaks one line in the quiet register ("Weekly window resets in 9h with
  72% free — front-load the heavy runs."). The popover renders it in the
  hot hint's slot (`data-meter-coach`); the Headroom band as a caption.
- **The ledger (the expired state's memory), `/usage` only.** `ClosedCycle`
  + `ledgerLine` in `meter-model`; the derivation `liveClosedCycles` in
  `live-source` reads the snapshot's `windowObservations` (newly carried
  through `LiveConsumptionInputs` → `DemoConsumption.closedCycles` →
  `Verdict`). Three gates keep it honest: the current cycle is young
  (≤ ¼ window — the closing tier's own fraction), the previous cycle's
  final observation sits within slack of the reset (max(30m, 5% of window)
  — Codex writes rate limits with every response, so burn near the close
  always leaves a fresher observation; an unobserved close makes NO claim),
  and the unused share clears the 15-pt floor (at close, even-pace = 100%,
  so unused IS the floor). Demo corpora carry no observation history and
  honestly render no ledger.
- **Direction B's geometry, merged into the production `PaceBar`.** When
  the trigger fires, the bar draws projected-landing → ceiling in the +45°
  neutral expiry hatch behind a hairline boundary tick. The study's noted
  hatch collision was resolved by separating on three cues at once: angle
  (+45° vs both −45° textures), ink (neutral chrome vs ramp color vs
  unknown grey), and DENSITY — the period widened from the study's 5px to
  7px so the region reads sparser even where a 6px-tall bar makes the angle
  hard to see. Verified legible against the adjacent unreported channel in
  Night and Air; recorded as the third hatch meaning in
  `design-system.md`. The popover mini bars never draw it.
- **The chord followed the name:** `g u` for Usage (id `go-consumption`
  unchanged — ids are addresses; `g c` burned, no alias; `g u` was unbound
  in the registry and the fixed families). Cheat-sheet, ⌘K, and the
  Electron menu all read the registry, so no other surface changed.

Tests: the study's 9 predicate tests moved into `meter-model.test.ts` with
the promotion (fixture cases still pin the operator's verbatim shape);
new suites pin the swap vocabulary, the coach arbiter (dual-signal: alarm
wins the slot while the row still swaps; exhausted silences the same way),
the ledger derivation's three gates, and meter-vs-page verdict AGREEMENT
(`derive.test.ts`: for every fixture window, `allPaces` and
`readAllWindows` produce identical `OpportunityRead`s and identical words).

Evidence: gallery screenshots of every state through the now-production
predicate (`/tmp/exawatt-e9-ship-shots/`, Night + Air), and a headful
Electron run on THIS machine's real corpus (EXAWATT_TEST=1, throwaway
userData, real `~/.claude`/`~/.codex` scan): the real weekly — 4% used,
8 pts behind, resets 6d 3h — sits under the 15-pt floor and the voice is
correctly SILENT ("behind even pace by 8 pts", no coach, no geometry),
while the ledger truthfully reports "Weekly window reset 20h 18m ago ·
closed with 100% unused" — the operator's actual expired opportunity from
the prior weekly cycle, observed, not extrapolated. The study stays in the
gallery with its header updated (subject partly shipped; Direction A
remains the open review candidate).

### E1 + E5 data half — the incremental watermarked scanner (landed 2026-08-10)

**Live local consumption now exists as a main-process service with a typed
IPC seam; the renderer's source swap is the remaining half of E5.** Two
commits: the contract first (so the renderer half could build against it in
parallel), then the scanner.

**The contract** (`packages/core/src/consumption/live-snapshot.ts`, one seam
both sides import): `consumption:snapshot` returns a versioned
`LiveConsumptionSnapshot` — corpus-globally merged `ConsumptionSample`s
(bounded by `sinceMs` on request), `planWindows` (latest per bucket, keyed by
`planWindowKey` = limitId+scope+windowMinutes), a bounded `windowObservations`
history with derived `windowRates` (%/h), the main-owned durable-Session ↔
provider-conversation `sessionIdentities` index (E2's join, exposed rather
than re-derived), lifetime diagnostics, and
`scanState { phase: idle | first-scan | incremental, progress, lastScanAt,
corpusBytes, firstScanComplete, revision, cancelled }`. `consumption:updated`
pushes are notification-only (revision + scan state, never samples);
`consumption:rescan` and `consumption:cancel-scan` are the verbs. Preload:
`window.electron.consumption`.

**Scanner design** (`electron/main/consumption/scanner-service.ts` +
`state-store.ts`), built to the three §5 rules:

- *Never block the workspace.* Lazy start on the first snapshot pull; the
  first scan is explicitly backgrounded and cancellable with progress, reads
  in bounded chunks (4 MB in main — every chunk boundary is an event-loop
  turn, so PTY/IPC traffic keeps flowing), yields between files, and bumps
  the revision progressively — newest files scan first, so the meter's live
  windows appear long before the pass ends. `snapshot()` never waits on
  scanning.
- *A byte is read at most once per life of its file.* Per-file watermarks
  (offset + size + mtime + Codex session context) persist in
  `userData/consumption-scan/` as an append-only JSONL log plus an atomic
  meta file. Appends are ordered samples-before-their-watermark, so a torn
  tail can cost a re-read but can never record a watermark whose samples were
  lost; an aborted file's mark records only its covered extent so it can
  never be skipped as complete. Per-sample assurance is constant per source,
  so it is stripped on disk and re-attached shared on load (state file
  157 → 98 MB, warm load 1.04 → 0.43 s). Compaction bounds log bloat at
  ~2x live size.
- *Push-first, pull-insured change detection.* `fs.watch` on both corpus
  roots with a 10 s trailing debounce drives incremental passes — live truth
  while agents burn, zero polling when idle. A snapshot pull older than five
  minutes kicks an insurance pass (FSEvents can drop), and `rescan` is
  explicit. A poll timer was rejected: it would stat all day to defend
  against a rare failure the pull path already covers.

**Capacity truth (E1) is enforced at this boundary:** windows are keyed by
`planWindowKey`, never by source and never by `limitId` alone — the corpus
proves one `limit_id` carries both a primary and a secondary window, and the
live machine now shows a second `limitId` (`codex_bengalfox`) beside `codex`,
confirming plan identity is not global. `windowMinutes <= 0` records are
discarded AND counted (119 on the real corpus). The latest observation per
bucket carries `observedAt`, so the renderer's existing `windowFreshness`
rule (live / stale / expired, §4's staleness answer) keeps working unchanged.
Claude Code has no window record at all — absent, never zero. Pace is now
OBSERVED, not authored: the corpus's own `rate_limits` history (downsampled,
one point per bucket per 15 minutes, 14-day horizon) yields %/h per window
within one reset cycle — a pace across a reset is never computed, an
unobservable pace is absent rather than zero, and a flat window reports a
real 0 (live weekly window measured at 0.72 %/h).

**Real-corpus numbers** (`pnpm eval:consumption-scan`, reads the operator's
actual `~/.claude` + `~/.codex` in place; state in a throwaway temp dir):

| | §5 baseline (2026-07-24) | E5 scanner (2026-08-10) |
| --- | --- | --- |
| corpus | 2,800 files / 2.66 GB | 3,642 files / 4.31 GB |
| cold scan | 19.3 s **inline** | 16.7 s **backgrounded, cancellable** |
| heap | ~617 MB delta | 699 MB transient peak, **85 MB resident** |
| warm launch | n/a (rescan every time) | **0.43 s** to a served snapshot |
| incremental pass | n/a | **0.08 s, 168 KB read** (the appended tails) |
| cancel | n/a | 75 ms to idle, partial progress kept |

Two consequences recorded honestly: (1) persisted samples now OUTLIVE
harness pruning — once scanned, a sample survives the harness deleting its
transcript, which quietly extends §2's retention floors forward from today;
that is a fact for open question 4, not a decision about it. (2) The full
eight-month snapshot payload is ~145 MB JSON-equivalent (83 MB for a 35-day
window, assembled in ~24 ms) — the renderer half should pull the window its
surface renders via `sinceMs` rather than the whole history; if even that
proves heavy, the next lever is a rollup-shaped request, not a fatter push.

Assurance unchanged: everything here is `observed`/`reported`; nothing is
`verified`. Privacy invariants are now unit-pinned, not just stated: the
service's only write path is its own state store, the tests assert every
write lands under the state dir and corpus mtimes are untouched, and the
eval never copies corpus data anywhere.

### E5 — live source swap, renderer half (landed 2026-08-10)

The Personal tenant stops reading authored fixtures: `/usage`, the ambient
meter, the Team exposé tiles, and the Fleet burn lens now render THIS
machine's real Claude Code and Codex corpus, read by Electron main behind
the E5 IPC contract (`@exawatt/core` `consumption/live-snapshot.ts`, landed
separately as the contract-first commit) and rolled up in the renderer
through the SAME `buildDemoConsumption` path both demo corpora travel —
E4's "swap the sample producer and nothing downstream changes" promise,
kept literally.

**Seam design.** Three layers, each pure below the one above:

- `live-source.ts` — the third producer of the one view shape. Fixture-
  drivable, no IPC: samples + plan windows + identity + the workspace's
  project registry in, `DemoConsumption` out.
- `live-store.ts` — the ONE bridge consumer for the whole renderer: one
  `consumption:updated` subscription, revision-gated pulls bounded to the
  seven-day view window (`sinceMs`), a 60-second now-re-pin so resets and
  pace tick between scans, a polite five-minute incremental `rescan()`
  while visible, and an honest EMPTY pending view while the first pull is
  in flight — never demo numbers wearing a live face. The tenant-seam
  invariant (meter == page, one corpus, one clock) extends to Live because
  a second subscriber cannot exist.
- `use-tenant-consumption.ts` — Demo tenant keeps Voltaic; Personal reads
  the live store; the bannered demo week survives only where no bridge
  exists (the hosted web app, which has no local filesystem to read).

**E2 attribution, live.** Session → Project → Workspace: provider sessions
join the fleet's durable Sessions through main's identity index
(`sessionIdentities` on the snapshot — the renderer never re-derives
identity from log contents), with titles and project roots joined from the
fleet's own records (live PTYs, the closed-session ledger, the workspace
layout). Project grouping is cwd-keyed against the workspace's project
registry and worktree-aware — `…/exawatt-e5-live` beside `…/exawatt`
belongs to the exawatt Project, the same convention `pnpm worktree:setup`
creates — and the resolver now travels ON the view (`resolveProject`), so
the outside-fleet-record grid rows attribute a launch directory exactly the
way the Project rollups did instead of exact-matching. A provider session
with no fleet identity keeps the E8 pattern: measured figures, honestly
absent identity. A cwd matching no registered Project resolves to null and
stays visibly unattributed — the data never forces a guess (§3).

**E3 normalization, live.** `weightedTokens` arrives through core's own
model-weight basis via the shared rollups; the page's stated basis remains
`NORMALIZED_BASIS_SENTENCE` printed from core's constants. No second weight
table was created. The "editable" half of E3's basis remains OWED: a
settings-respecting override belongs to a deliberate settings design pass,
not an ad-hoc UI bolted on here.

**Capacity honesty, live.** Plan windows dedupe defensively to the latest
observation per `limitId` (the contract already guarantees it; a duplicated
card is how the page starts lying); the meter's freshness discipline then
judges the survivor — the 60-day-old recovered window renders in the source
list but can never headline. Projection rates prefer main's trend-derived
`windowRates`; a limitId with no derivable trend falls back to the window's
own observed average since its start — a real single-observation
derivation, never a fabricated zero. `planType` now passes through from the
plan's own record instead of assuming `pro` (fixed for all three corpora).

**THE FLIP.** `readiness: 'preview'` → `'live'` in the navigation manifest —
the one-line change E5 was designed to be. The Coming-soon marker and ⌘K
preview notes disappear manifest-driven; `/usage` drops the demo banner
whenever live data is on screen. The live read's entire added chrome is one
Caption line while a first or partial read is in flight ("Reading local
logs · N of M files" / "Partial read of local logs") plus a freshness fact
in the existing footer ("read 2m ago") — the operator's bar: excellent UI,
almost no added copy. A fresh machine renders absence (absent channels, "No
sessions in this window"), never the demo corpus masquerading.

**E7 goes live.** Team exposé tiles read per-tab burn by each tab's
captured provider identity (`harnessSessionId`) and the Fleet burn lens
receives the same figures through `LocalSessionSnapshot.rawTokens` /
`normalizedTokens` into the optional `AgentMetrics` fields — both through
the one shared `computeAgentBurn` seam the Demo transport already used.
Unreported stays absent: a Session with no measured samples renders no
readout and stays off the ramp.

**Honest-null interventions.** `DemoSessionSpec.interventions` widened to
`number | null`: authored corpora still state numbers, live identities
carry null until the contract does better, and unrecorded sessions stay OUT
of the intervention-rate denominator — an unobserved session is not an
untouched one, and folding it in would flatter the rate.

**Owed, with owners** (all against the snapshot contract, main half):

1. **Live intervention counts** — Claude Code's `UserPromptSubmit` already
   arrives on the ENG-023 harness channel and Codex user turns are already
   parsed (today counted as `linesWithoutUsage` and dropped); the snapshot
   carries neither, so the count renders "not recorded". Owed to the next
   contract revision (scanner agent).
2. **Live context pressure** — Codex peak footprint + compactions from
   cumulative token counts (the hierarchy pass owed this to E5; it is now
   owed precisely to the snapshot). Claude Code stays honestly unreported.
3. **Live roadmap links** — declared-at-launch `roadmapItemId` exists on
   workspace tabs (ENG-017 S4); joining it into the roadmap pivot is owed
   to ENG-017's declaration path. Until then the pivot states "Not
   attributed" for live sessions.
4. **Editable weight basis** (E3) — owed to a settings design pass.

**Two defects the real corpus caught that no fixture had** (both fixed and
pinned the same day):

- *Window identity is the full bucket, never limitId alone.* The scanner
  keys `windowRates` by `planWindowKey` (limitId + scope + windowMinutes)
  because one real limitId carries both a primary and a secondary window.
  The renderer's dedupe and `CapacityWindowView.limitId` now use the same
  bucket identity — limitId alone would have collapsed two real windows
  into one, and duplicate React keys would have conflated the popover's
  headline match.
- *Pulls are single-flight and monotonic.* On the first real scan the boot
  pull resolved AFTER an updated-triggered pull (the scanner streams
  progressive revisions) and painted the earlier, emptier snapshot over
  live data — `/usage` showed 0 records while the Team tiles showed burn.
  The store now runs one pull at a time with a queued rerun, and an
  applied snapshot can only be replaced by an equal-or-newer revision.

Verified on THIS machine's real corpus (headful Electron, `EXAWATT_TEST=1`,
fresh user-data seeded with copies of the real workspace layout / identity
index / closed-session ledger — never auth state): 13,043 usage records
and 283 provider sessions in the seven-day window; the headline the real
tightest window (Codex weekly at 3%, resets 6d 19h, meter == page); real
Projects attributed through the registry (exawatt 890.1M nt with worktree
sessions folded in, three other real projects, No Project honest);
identified sessions carrying fleet titles beside outside-record
`Session <id8>` rows; interventions "—/not recorded" everywhere (owed,
above); 13 Team exposé tiles carrying live token readouts with the hottest
in the FLUX channel. Demo tenant re-verified unchanged (Voltaic fortnight,
71% == meter). Screenshots: `/tmp/exawatt-e5-live-data/`,
`/tmp/exawatt-e5-web/`, `/tmp/exawatt-e5-electron/` (session-scoped) and
the landing commits.

Tests: `live-source.test.ts` (attribution incl. worktrees and
longest-root, identity join, honest-null interventions incl. the
not-recorded diagnostics tile, window-bucket identity incl. the shared-
limitId pair, freshness, the meter==page tightest-window invariant on the
live view, empty corpus, overhead separation, spark/rate math),
`live-store.dom.test.ts` (web fallback, joined identity through a faked
bridge, revision-gated refetching, the stale-snapshot drop), burn-attach
and `AgentMetrics` carry-through tests, and the readiness tests updated
for the flip. Full suite green.

One rotted-eval note for the record: `eval:electron:tenancy` (and several
sibling Electron evals) still drive the pre-D49 "Open shell in" launcher
affordance, which no longer exists in `src` — red on master independent of
this change. Demo-tenancy behavior was verified through the unit seams and
the browser/Electron passes above instead; repairing those eval scripts
belongs to the launcher line (ENG-016), not E5.
REPAIRED 2026-08-11 (`1a5d449`, ENG-016): all nine scripts now open shells
through the D49 catalog via the shared `openShellFromLauncher` helper;
`eval:electron:tenancy` (48 checks) and `eval:navigation:electron` run
green. Remaining retired-affordance rot in other evals (declare-at-launch
popover, legacy Customize "Agent Source" select) is tracked as BUG-014.

### Usage honesty repair — five audit defects (landed 2026-08-14)

**A source we cannot read must never make the page calmer.** That is the
whole entry. The E12 design pass's audit of our own surface drove the real
Electron app against the operator's real corpus (7,871 usage records, 249
provider sessions) and found five verified defects; four were code, one was
this document lying about a retired affordance. None of them were visible
as breakage — every one of them rendered a clean, confident page.

#### D1 — the honesty inversion (severe)

**Reproduced, verbatim.** With Claude plan windows switched off in
Settings → Privacy, `/usage` headlined:

```
Codex · Weekly window     5% used · 95% free to spend
Claude Code · plan        no plan record
                          208.1M raw observed · 5h
                          "Claude Code keeps no plan, quota, or rate-limit
                           record in its local files."
```

Two lies in one band. The sentence is a CAPABILITY claim about local files,
printed over a credential state; and the headline is the most reassuring
reading the page can produce, chosen at the moment it knows least. For a
multiplexer the property scales exactly the wrong way: **the fewer vendors
you can read, the healthier the page looks.**

**Root cause, in three links.** `claude-plan-account.ts` degrades to absence
on every failure (as designed) → `windowFreshness` drops its stale windows →
the source has zero windows → `silentSources` renders the static capability
sentence. The state that distinguishes the causes — `ProviderPlanAccountStatus`
on `LiveConsumptionSnapshot.providerPlanAccounts` — existed on the wire the
whole time and `grep -rn providerPlanAccounts src/` returned nothing.
`live-store.buildState()` simply never read the field.

**Fix.** One new derivation and one new fact on the shared reading:

- `planReadState(source, nowMs)` (`model.ts`, beside `windowFreshness`
  because it is the same class of rule) answers with four states instead of
  one: `reported`, `none` (no account read is configured — the pre-ENG-038
  capability fact, and the ONLY state that may wear the harness sentence),
  `off`, `unreadable`. `off` and `unreadable` are the UNKNOWN states.
- `MeterReading.fleetUnknown` rides the one shared pace derivation, and
  `opportunityOf` returns null on it. That single guard silences the entire
  E9 voice — the free-to-spend metric swap, the expiry hatch geometry, and
  the coach line — because all five of its call sites route through that
  function. It rides the reading rather than being threaded as an argument
  precisely because those call sites only ever hold one reading.
- Headroom leads its captions with the partial-verdict fact
  (`Claude account is turned off — this verdict covers the sources that
  reported.`), the absent channel says `read turned off` / `position
  unknown` with one short fact about the read itself, and
  `meterAriaLabel` carries the same sentence for the 71px glyph that cannot
  show it.

**What it deliberately does NOT do:** re-rank the headline across windows it
cannot read (you can only rank what you can read), or touch the alarm
channel. Unknown outranks opportunity; hot still outranks everything.

After, same machine, same switch:

```
Codex · Weekly window     5% used · resets in 5d 5h · 20 pts behind even pace
Claude account · plan     read turned off
                          285.3M raw observed · 5h
                          "Claude account reads are turned off in Settings."
Grok Build · plan         no plan record          ← capability fact preserved
"Claude account is turned off — this verdict covers the sources that reported."
```

#### D2 — credits crossed IPC and were dropped

`ProviderPlanSpend` (`live-snapshot.ts:79-100`) carried the operator's real
`$201.60 of $200` and no renderer read it, while the Spend band showed only
`≈ $3,868 modelled · list-price model · not billing truth`. Now it renders
in its own lane behind a divider with its own `plan credits ·
vendor-reported` basis. **It is never summed with the modelled figure** —
plan credits, overage, and metered API are disjoint ledgers and one total
across them is a number nobody is charged. A unit test asserts that adding
credits does not move the modelled figure by a cent, and the lane vanishes
entirely when the read is off rather than showing a stale amount.

#### D3 — the grid read the wrong field

14 of 14 rows titled `Claude Code`, while the Team altitude showed
"Unified consumption dashboard across AI platforms" for the same sessions.
`assembleIdentities` took `title` raw from the PTY / closed-session ledger /
workspace tab, which is the harness default unless the operator renamed the
tab; `sessionDisplayCopy` — the resolver the tab strip and Team tiles use —
was never called. `DurableMeta` now carries harness, title ownership,
lifecycle, and context summary from whichever record knows the Session, and
the grid, the Session pivot, and the drill panel all render its `primary`.
Measured after: **14 distinct real names**, with `Session 2a86040d` still
correctly dimmed as outside the fleet record.

The two neighbouring symptoms are NOT the same root cause and were made
explicit rather than fixed:

- **`INT` is `—` everywhere** because the snapshot carries no intervention
  counts yet (owed to E5, §Owed). The per-cell tooltip stopped claiming "no
  session record" for a Session that has one, and the legend states
  `Interventions: not recorded` when no row in scope carries a count — a
  column of em-dashes otherwise reads as "every session ran untouched".
- **The Roadmap pivot's single `Not attributed` row** is a missing input,
  not a measurement: a live Session carries no roadmap link until ENG-017's
  declaration path exists. `pivotAbsenceNote` says so, and gives the
  empty-corpus Attribution band the empty state it never had.

#### D4 — plan-wide truth labelled as harness truth

The hero read `Claude Code · Weekly — Fable` for an Anthropic-ACCOUNT figure
that meters claude.ai chat too, and ENG-038's disclosure existed only in the
meter popover. `ACCOUNT_LABEL` + one `windowOwnerLabel(source, window)`
derivation now name an account-scoped window for its account everywhere it
appears — Headroom hero and rows, Burn asides, Pace, Heat, the popover
header, the meter's aria label — while a locally-parsed window stays under
its harness. The plan-wide line renders on the page that shows the number.

#### D5 — the Fleet burn lens is dead, and this document said otherwise

Not a code defect. Driven on the real board (not read from source):
`data-board-lens="status"`, zero controls matching /burn/i, `B` inert. The
lens left production on 2026-08-03 with `bc43842` at the operator's own
direction, and the E7 entry above kept claiming it for eleven days. Both the
E7 milestone line and the E7 log entry are corrected; the lens prop, the two
eval rigs, and the shared derivation stay undeleted.

#### Verification

Real-app, on the operator's real corpus, following the audit's own method:
his `workspace.json`, `session-identities.json`, `closed-sessions.json`,
`settings.json`, warm `consumption-scan/`, and `consumption-plan/` copied
into an isolated `EXAWATT_USER_DATA` so his running app was never touched;
`EXAWATT_TEST=1` against this worktree's own dev server; the failed-read
state reproduced by flipping his own privacy switch in the isolated copy
only. Before/after screenshots of the Headroom, Spend, and Sessions bands
and the Fleet board are in the delivery report.

45 unit assertions pin the root causes, not the fixes. D1 gets all four
failure modes the repair must survive — **source disabled, token expired
(with the persisted last-known windows the adapter leaves behind), network
failure, and never configured** — each asserting that the position reads
unknown, the opportunity voice is silent, and the honest `behind even pace`
verdict survives. Two guard rails come with them: a fleet with no account
read configured still speaks the opportunity voice (the pre-ENG-038
behaviour this must not break), and unknown never mutes a hot window's alarm.

**Out of scope on purpose.** The page's structure, band order, restatement
count, and visual language are the E12 design pass's to change; these diffs
are surgical and invent no new visual vocabulary. Audit debts not touched
here and still open: live context pressure for Codex drills (#7), Grok Build
half-wired into the grid's hardcoded source binary (#9), the empty corpus's
fabricated `0%` diagnostics (#11), the Burn band vanishing silently with no
window (#12), the closed-cycle ledger's two vocabularies (#14), heat ordered
by used-% rather than time-to-exhaust (#15), 62 hover-only tooltips (#16),
and the absent `/usage` surface gate (#19).

### E12 — Usage as the vendor multiplexer: design options (landed 2026-08-14, awaiting the operator's pick)

**Three directions are live at `/hud-gallery/usage-directions`, over a real
capture of this machine, in six states each, deep-linked as
`?d=roster|ledger|instrument&s=<state>`. The recommendation is C
(Instrument) as the page's first screen with A (Roster) as its second block
and B (Ledger) as the drill — not one of the three as-is.**

#### What the four research lanes settled before this pass

The architecture was not relitigated here; the directions differ in
EXPRESSION only. Settled and enforced in `model.ts`: headline
(bound-framed, with coverage) → needs-attention rows (only when non-empty) →
the full source roster → per-source detail; the glance is a projection of
the detail (same rows, same order, fewer columns) rather than a second
computation; permanently partial is normal, so `unreadable` (a malfunction,
carries a repair verb) is a different row state from `unavailable` (a
settled fact about the account, product language, no alarm colour); the
residual is a named drawn row; provenance and as-of travel with the number;
rate not total for unequal periods.

The **monotonicity constraint** is the load-bearing one, and it is
structural rather than a code-review rule:

> Losing information must never move the headline in the reassuring direction.

Three mechanisms enforce it. `ROSTER` is a fixed list, so the coverage
denominator can never shrink to what happened to succeed. A failed read
keeps its last good windows at their TRUE `observedAt` instead of dropping
them, so the evidence that produced a bad verdict survives the failure that
would otherwise erase it. And the lower-bound prefix is applied exactly when
the total is knowably incomplete. `model.test.ts` pins all three (22 checks).

#### The data

Captured 2026-08-14 from the operator's own machine, read-only: the shipped
`ConsumptionScannerService` over `~/.claude/projects` + `~/.codex/sessions`
with a throwaway state dir, the real ENG-038 `ClaudePlanAccountService` read
(status `ok`, plan `max`, extra usage $201.60 of $200 with extra usage
**off**), and his app's own persisted plan-window history (516 observations)
for the real burn rates. 8,777 samples, 245 provider sessions, 3.9 GB corpus.
His running app was never touched and nothing was written outside temp.

The capture is frozen in `snapshot.ts` — a deterministic review rig, the
roadmap-lab precedent — so the three directions can be compared without the
numbers moving underneath the review.

Five of the six states are the capture with information removed or
reclassified. **One is authored and says so on screen**: there is no
all-clear moment anywhere in three days of recorded plan history — the
Fable weekly never dropped below 96% — so the state in which the page is
allowed to say "you are fine" had to be authored rather than measured. That
is itself a finding: on this operator's machine the dangerous rendering is
not reachable from his own data.

#### Measured, on the real capture

| | above the fold | distinct numerals | page height | verdict at reading index |
| --- | --- | --- | --- | --- |
| `/usage` today (audit baseline) | 133 text nodes | 34 | 2,148 px | not present — a `%` figure, not a verdict |
| A · Roster | 91 | 23 | 1,285 px | 5 |
| B · Ledger | 77 | 17 | 1,555 px | 1 |
| C · Instrument | **32** | **13** | **1,030 px** | 2 |

The two audit questions, answered on screen in all three:

- **"Am I fine right now?"** — baseline 8–12 s and ambiguous, because the
  glance showed `97%` with no vendor, window or unit and the answer required
  opening a 553 px popover carrying four windows in three framings. All three
  directions answer it with a verdict word in the first block: **under 1 s**
  to read (4–5 words at display size, first in reading order, no
  cross-reference). C is fastest in practice because nothing else competes
  above the fold.
- **"What runs out first?"** — baseline 20–30 s, because `Heat` ranked by
  percent-consumed rather than time-to-exhaustion and the reader had to
  cross-reference four projected values against four reset times. All three
  name it in the clause immediately after the verdict: **~3 s**
  (`Claude Max · Weekly — Fable is spent in 12h 28m, 2d 10h before it
  resets.`). The ordering fix is in the model — `byBite` sorts by
  time-to-exhaustion first — so it holds in every direction.

Seconds here are derived from word counts at a normal reading rate, not a
stopwatch on a human; the node and numeral counts are machine-measured and
are the comparable figures.

#### Per-direction assessment

**A · Roster** — the source roster IS the page: one row per vendor account,
identity + windows + state word + as-of, tape meters with the even-pace and
limit bugs drawn on the scale, `j`/`k` + Enter for per-source detail.

- Glance: verdict at reading index 5, 91 nodes and 23 numerals above the
  fold. The slowest of the three, because the roster starts on the first
  screen.
- Five states: the strongest. Row geometry is visibly fixed — an unreadable
  Claude keeps all three window rows and swaps the state column; a
  never-connected Grok occupies exactly the same space with the unreported
  hatch at tape height. The state machinery is the subject, so it is legible
  without explanation.
- Deep dive: weakest. It has per-source detail and nothing else — no pivots,
  no attribution, no sessions. It answers "which account" and cannot answer
  "which project".
- Cost: lowest. It is the E9 pace vocabulary, the existing atoms, and one
  new row component.
- Sacrifices: the 20-minute zone entirely, and a screen of vertical budget
  the moment a fourth account appears.

**B · Ledger** — one reconciling table: an independently computed row-zero
total, drawn residual rows, provenance and as-of as COLUMNS, pivotable with
`←`/`→` over Project · Source · Model · Session, `j`/`k` rows, `/` filter.

- Glance: verdict at reading index 1 — the earliest of the three — but 77
  nodes and 17 numerals above the fold, so the verdict is fast and the rest
  of the screen is not.
- Five states: good, and uniquely it makes incompleteness ARITHMETIC. The
  session pivot reconciles to `1,384,199,932 nt against a total of
  1,402,676,852 nt, a gap of 18.5M nt` with the tail drawn as its own row,
  and `Plan burn with no local session` sits permanently in every pivot
  carrying `not measurable` — the gap `/usage` has nowhere to put today
  (audit §4E) finally has a home.
- Deep dive: by far the strongest, and the only direction with a real
  keyboard model over the data.
- Cost: highest. Four pivots, a filter, a keyboard grid, and a residual
  taxonomy that has to be right in every pivot.
- Sacrifices: calm. It is a table, and it looks like one — the operator's
  own show-and-tell complaint about `/usage` ("looks like an engineer built
  it") is the risk this direction carries.

**C · Instrument** — one verdict at display size, one primary tape with
labelled even-pace and limit bugs, the expiring-unused window as a PEER
beside it rather than a footnote, five roster pips beside the coverage line,
and everything else behind two drill buttons.

- Glance: the clear winner — 32 nodes and 13 numerals above the fold, a 76%
  reduction from the audit baseline, and the whole answer fits one screen at
  1,030 px with room left.
- Five states: adequate at the headline (the degraded note, the coverage
  line and the amber pips all move correctly) but the roster detail is one
  click away, so `unavailable` vs `not-connected` — the distinction the
  research says is load-bearing — is only visible after a drill.
- Deep dive: earned rather than absent. Its **read-history strip** is the one
  thing in this study that nothing in the 170-shot corpus does: a
  Grafana-style state timeline per source over three days, built from the
  real observation series. On this machine it reads **Claude Max 86% read,
  Codex Pro 14% read** — the vendor lane's "Codex windows are a passive echo
  of the last API response" finding, rendered. It is the difference between
  "the number is low" and "nobody asked the number in eighteen hours".
- Cost: middle. The instrument itself is cheap; the timeline needs the
  observation series on the snapshot, which E1/E5 already carry.
- Sacrifices: the roster's at-a-glance completeness. Five pips are a
  presence check, not a legible state.

#### Recommendation

**Ship C's first screen over A's roster, with B as the drill.** They are not
alternatives; they are three altitudes of the same settled architecture, and
the research says the failure is always at the seam between them.

- **C is the 2-second zone.** 32 nodes and 13 numerals is the only figure in
  this study that is genuinely a glance, and the expiring-unused peer is the
  cleanest resolution of the dual signal found anywhere — the two voices are
  side by side at equal weight, so neither is a footnote to the other.
- **A is the 20-second zone, as C's second block.** The roster has to be on
  the page, not behind a button: it is the only place a source that reported
  nothing can be seen, and hiding it behind a drill re-creates exactly the
  audit failure where a broken read is indistinguishable from a quiet one.
- **B is the 20-minute zone.** Its pivots, residuals and keyboard model are
  the deep dive; its row-zero reconciliation is what makes the bound-framed
  headline checkable rather than merely asserted.
- **C's read-history strip ships with A's roster**, as the roster's own
  per-row column rather than a separate drill — it is per-source read health,
  which is exactly what the roster row is about.

What I would NOT ship: B's headline treatment (accurate but flat, and it
buys nothing C's does not), and A's full-page roster as the first screen
(correct but slow, and the operator has already told us what a wall of rows
reads like).

#### Research findings this pass could not use as stated

- **A vendor-native "all clear" is not reachable from this operator's data.**
  Every honest state in the matrix is a variation on "one window is spent".
  The all-clear rendering had to be authored and labelled as such. Any future
  eval that asserts a calm state must carry its own fixture; it cannot be
  captured.
- **"Never render 0 or 100" is not sufficient as a rule.** The corpus states
  it as a token-level rule; on this data the reassuring move was available
  through the SET (a dropped row, a coverage denominator computed from what
  succeeded) with every individual number honest. The rule had to be
  restated as monotonicity over the headline and enforced by a fixed roster.
- **The read timeline needs a coverage model, not an event plot.** Plotting
  observations as instants produced a comb of hairlines reading 5%/4%; the
  legible and honest version treats each observation as covering forward
  until the next, capped at a gap threshold. Same data, opposite conclusion.
- **A single "stale" threshold is wrong per source.** Codex's window is a
  passive echo, so an hour of silence is ordinary; a credentialed pull that
  is an hour old is not. Thresholding on `min(window, 6h)` keeps the
  attention block empty in the ordinary case — which the corpus says is the
  whole point of having one.
- **`caut`'s "print which fetch strategy won" did not earn a slot.** With two
  live sources on two fixed strategies it is a constant string. Revisit when
  a vendor has more than one path to the same account (CodexBar #2427).
- **Provenance as a first-class COLUMN only pays off in B.** In A and C it is
  a caption; giving it a column in a two-source roster wastes the width.

#### Evidence

- `/hud-gallery/usage-directions?d=<roster|ledger|instrument>&s=<state>`
- `/tmp/exawatt-e12-shots/` — 3 directions × 6 states, viewport + full page +
  text dump, plus the three drill captures and `measure.json`
- `/tmp/exawatt-e12-shots-night/` — the same matrix under Night
- `src/app/hud-gallery/usage-directions/model.test.ts` — 22 checks pinning
  the monotonicity constraint, the absence states, the broken/settled split,
  the glance-is-a-projection rule, and the drawn residual

### BUG-016 — a dead local scanner stops looking like Demo Mode (landed 2026-08-16)

**Three states, and a snapshot that no longer exists.** Incident `0012` holds
the diagnosis, the falsified hypotheses and the recipe; this entry is what
changed and why the change is where it is.

**The defect was worse than filed, in the direction that matters.** The
2026-08-13 audit recorded "`/usage` falls back to the authored demo week under
a `Demo data` banner". Reproduced in a worktree before touching anything, that
turned out to be the BROWSER half — a dev server has no `window.electron`, so
the demo corpus is genuinely correct there. Inside the app, with the command
engine dead, the page rendered:

```
Partial read of local logs
HEADROOM   No source reports a live plan window.
Codex · plan          no plan record · 0 raw observed · 5h
SPEND      Operator sessions  ≈ $0.00 modelled
SESSION    No sessions in this window
```

No banner. A complete live read of zero is a STRONGER claim than the demo
corpus it was reported as: it says this machine burned nothing. The page broke
its own D1 rule — *absent is never zero, unknown is never absent* — about
itself, fourteen days after that rule was written into it.

**Why the store could not know.** `bridge()` is `window.electron?.consumption`,
which preload exposes unconditionally, so inside Electron the store is never
`unavailable`. `refetch()`'s catch keeps the last honest state, which with
nothing yet read means `pending` forever, which `useTenantConsumption` reads as
`live: true` over an empty view. Three states, four situations.

**The structural cause is one directory on the wrong path.**
`dist-electron/node_modules` is a PACKAGING snapshot: electron-builder ships
`dist-electron/**/*` and excludes `node_modules/**/*`. Nothing in development
needs it — resolution from `dist-electron/main/main.js` walks up to the
checkout's own `node_modules`, where pnpm links `@exawatt/core` at
`packages/core`, which is why a fresh worktree works. But once any packaging or
`prepare-main`-prefixed eval wrote a snapshot, it SHADOWED the workspace for
every later dev launch, and `electron:compile` rebuilt the package without
refreshing the copy. Four days of drift later, main constructed a class its
copy did not export and `bootstrapCommandSurface` threw before
`registerConsumptionIPC` ever ran.

**Impossible over loud, and the reason.** The brief allowed either refreshing
the copy on compile or comparing and failing loudly. Neither is needed: the
snapshot is DISCARDED on compile. Compile is the step that rebuilds
`@exawatt/core`, so it is the step that invalidates any snapshot of it, and
after it the Electron main reads the same module graph as the renderer, the
tests and the evals. Packaging stages a fresh one immediately before
electron-builder consumes it — every packaging flow already runs
`electron:compile` → `electron:prepare-main` → electron-builder in that order.
`eval:electron:agent-sources` and `eval:electron:grok-source` lost their
`pnpm electron:prepare-main &&` prefix, which was doing nothing but
manufacturing the hazard.

**The engine's state is now a fact, not a string on a splash.**
`electron/main/command-engine.ts` registers `app:command-engine` before
bootstrap starts and broadcasts `app:command-engine-changed`; it imports no
service and no `@exawatt/core`, so it survives the failure it reports.
`setTrustedRendererOrigin` moved to the moment the renderer URL resolves — it
ran at the tail of bootstrap, which would have made the one channel whose job
is to report a failed bootstrap reject its own renderer.

**On screen.** `LiveConsumptionStatus` gains `paused`, set by the engine
channel or by a first pull that cannot answer at all (a scanner that dies after
boot produces the same fact, so it gets the same state). A read that already
succeeded keeps its numbers and its own `read Xm ago` age. `/usage` renders, in
the demo banner's slot and the Consumption channel's own `unknown` ink:

```
Command engine paused
Nothing on this page was read from this machine · local reads resume when the engine starts
```

Demo Mode is untouched. No bridge still means the demo corpus, explicitly
bannered, because that is the honest answer where no local filesystem exists.

**Evidence.** Reproduced before the fix (splash `Command engine paused`, no
`[data-command-altitude]`, `/usage` zeroed with no banner, stderr
`WindowObservationAccumulator is not a constructor` at
`ConsumptionScannerService`), then the same launch after: with the snapshot
staled and the fix in, `/usage` shows the paused banner and no `Demo data`;
after `pnpm electron:compile`, the app reaches the workspace and renders a real
read. `pnpm eval:consumption-scan` runs the real scanner service against the
159 MB corpus with no snapshot present at all. Three new harness tests
(`scripts/electron-eval.test.mjs`), four store tests, and three page tests
pinning the three-state presentation.

## 9. Open questions for the operator

1. **Cold-scan cost** (§5) — RESOLVED 2026-08-10 by the E5 scanner: the first
   run is backgrounded, cancellable, and one-time (16.7 s on today's corpus);
   every later launch serves persisted state in 0.43 s. A first launch shows a
   progressively filling corpus (newest files first) rather than a blank one.
2. **ENG-023's delegation claim** (§3) is contradicted by measurement and was
   corrected in the roadmap on 2026-07-24.
3. **Plan-window staleness and multiple `limitId`s** (§4) — the mechanics are
   settled (windows keyed by `planWindowKey`, expired/stale filtered by the
   renderer's `windowFreshness`, and the live machine now really does show two
   plan identities — `codex` and `codex_bengalfox`). Still open as PRODUCT
   judgment: whether a second live identity deserves its own surface treatment
   or just a subordinate row.
4. **Retention asymmetry** (§2) — Claude's ~2-month floor caps any longer-window
   comparison to Codex-only. Confirm whether that is acceptable or whether
   Exawatt should retain its own rollups to outlive harness pruning. NOTE
   2026-08-10: the E5 scanner's persisted samples already outlive pruning as a
   side effect (once scanned, always retained, from today forward); deciding to
   PRUNE with the harness would now be the deliberate act, not retaining.

## 10. E11 — multi-provider local spend (open item, 2026-08-03)

Opened by the ENG-003 S2 design pass (decision `0027`): `opencode` becomes a
third launchable source, and the models it reaches are billed by a third party
in real dollars.

Why it matters to this item specifically: the unit ladder draws an explicit
line where measurement stops and modelling begins, and every dollar figure on
`/usage` today is on the modelling side of it. A Session run through OpenRouter
or a comparable provider produces a *billed* figure — the first measured dollar
in the product. A locally-run model produces a truthful `$0`, and is the one
place where the watts rung is literally measurable rather than aspirational.

Constraints inherited, not renegotiated:

- **The spine's thesis stands: read-only local parse, no credential, no network
  call.** `opencode stats` reports token usage and cost locally; that local
  record is what this item reads, in exactly the way the Claude and Codex
  corpora are read. This is what keeps E11 inside ENG-008 rather than inside
  ENG-038.
- **A credentialed read of an OpenRouter account belongs to ENG-038**, not
  here. The moment this needs a vendor API key it has changed source class, and
  ENG-038 exists precisely so that change is deliberate rather than quiet.
- **Exawatt holds no provider key** (decision `0027`), so E11 has no credential
  custody question of its own.
- **Absent, never zero.** A source that reports no cost renders as absent — the
  same rule E7 already enforces for burn.
- **Attribution rides the existing identity join.** A multi-provider Session is
  a Session; it rolls up through E2's durable-Session ↔ provider-conversation
  identity like any other, not through a parallel path.

Sequencing (operator, 2026-08-03): land the launch path first. This stays an
open item rather than a milestone so ENG-008 does not widen mid-flight; it
becomes real when ENG-003 S2 has shipped and there are Sessions to measure.
