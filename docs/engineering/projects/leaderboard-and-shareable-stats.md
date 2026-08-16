# Leaderboard and shareable stats (ENG-035)

Owning roadmap item: `ENG-035` in `docs/engineering/roadmap.md`.

Status: shaped and approved 2026-08-03; active build.

## Product thesis

**Agentmaxxing is competitive self-expression for the emerging operator
class. Exawatt turns otherwise invisible machine labor into a public identity,
a high score, and evidence that one person can command extraordinary productive
capacity.**

The cultural hook is deliberately larger than a usage dashboard:

- a viral acquisition loop built from public operator profiles and shareable
  records
- an identity artifact that compounds like a GitHub contribution graph
- a Strava-shaped competitive arena that gives existing operators a reason to
  push their practice
- a public proof of Exawatt's central claim: intelligence is a metered utility,
  tokens are its energy, and operators will command increasingly large fleets

`Agentmaxxing` is community slang, not a permanent canonical product concept.
Durable surface nouns are **Operator profile**, **Leaderboard**, and **Run**.
A Run is a public measurement projection of an existing Session turn and its
delegation tree; it is not a new work primitive alongside Session or Event.

The operator is the protagonist. The agents are the fleet. Tokens are the
energy behind the feat. The desired reaction to a shared record is: **"Holy
shit, this person commands N machines"** and **"How can I become as productive
as that?"**

## Research synthesis

The 2026 tokenmaxxing phenomenon proved both the appetite and the failure mode.
Public and internal leaderboards turned token consumption into status, but raw
volume was easy to game and frequently confused adoption with value. Existing
products already commoditize token totals, estimated cost, and streak cards.
Exawatt should celebrate aggressive intelligence consumption without rewarding
waste as the highest form of practice.

Three reference patterns survive the research:

1. **GitHub identity artifact.** A long-lived, glanceable history matters more
   than a transient rank. Private work can contribute aggregate public counts
   without disclosing the work itself.
2. **Strava activity and personal record.** The recurring social object is one
   exceptional Run shared into an existing conversation; the profile is the
   career, and the leaderboard gives the feat context.
3. **Multi-axis rankings.** Artificial Analysis and OpenRouter let the same
   arena rank different truths rather than hiding judgment inside one composite
   score. Global rank supplies spectacle; weekly windows remain reachable.

Research references:

- <https://www.axios.com/2026/05/13/tokenmaxxer-ai-claude-code-codex>
- <https://apnews.com/article/ai-token-openai-anthropic-corporate-31bb80ac1cd7862d05f6397177d826b1>
- <https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference>
- <https://arxiv.org/abs/2006.02371>
- <https://artificialanalysis.ai/>
- <https://openrouter.ai/rankings>
- <https://support.strava.com/en-us/articles/15401736-group-challenges>

## Confirmed product decisions

- Participation is explicit opt-in. No public telemetry exists before the
  operator sees the exact upload boundary and chooses **Publish my profile**.
- V1 is one global arena, filterable by metric and by **This week** / **All
  time**. Friends, clubs, teams, follows, feeds, likes, and comments are later.
- Every opted-in user can participate. Agentmaxxer identity is not gated by an
  achievement threshold.
- GitHub identity is required for V1, but it only seeds a provider-neutral
  Exawatt profile (`handle`, display name, avatar, links, identities). A signed-
  in operator links GitHub to the existing account rather than creating a
  parallel Exawatt user.
- Publishing starts at opt-in; V1 does not backfill local history.
- Privacy is one master public-profile switch plus one exact disclosure, not a
  per-field settings matrix. Turning it off stops sync and removes the profile
  and rows from public queries while local history remains local.
- Cheating is a good problem to have. V1 uses idempotency and sanity bounds but
  makes no tamper-proof claim. Public evidence says **Recorded by Exawatt** and
  carries source/assurance truth.
- No public task, prompt, response, transcript, Project, repository, branch,
  path, filename, diff, Artifact content, or Session/provider identifier leaves
  the machine.
- Public Run captions are architected as an optional future field but are not
  collected or rendered in V1.
- The visual direction is dark Exawatt, restrained and identity-focused. It is
  not a dense HUD, terminal imitation, generic analytics dashboard, or crypto
  casino. The activity graph dominates the profile; bolder high-score treatment
  is reserved for Run receipts and personal records.

## Measurement contract

### Run boundary

A Run is rooted in one operator prompt to one Session and includes every
delegated descendant the source reports beneath that turn.

- **Starts:** the root operator prompt is submitted.
- **Continues:** steering messages and answers to Agent questions increment
  `interventionCount` but do not split the Run.
- **Pauses active time:** an operator gate with no working descendant keeps the
  same Run open but accrues elapsed time, not active agent time.
- **Ends:** the root and every reported descendant settle, stop, or fault. A
  root turn-end while children are live does not end the Run; ENG-023's shared
  turn-truth rule already treats that tree as working.
- **Source honesty:** when a source cannot report delegation or a boundary,
  the affected fact is unavailable or derived with explicit assurance; it is
  never silently read as one Agent or an exact boundary.

Independent top-level Sessions remain independent Runs even while they overlap.
Fleet metrics aggregate overlapping Runs across the operator.

### Public metrics

There is no opaque Exawatt score. One table ranks four transparent axes:

| Axis      | Rank value             | Meaning                                                                                                            |
| --------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Command   | autonomous agent-hours | Integral of active reported/observed Agents over time. Twelve Agents for two hours = 24 agent-hours. Default axis. |
| Endurance | longest hands-off span | Longest continuous active span inside a Run without operator input.                                                |
| Fleet     | peak concurrent Agents | Maximum simultaneously active top-level Agents and reported descendants.                                           |
| Tokens    | normalized tokens      | ENG-008 `weightedTokens`; raw token totals remain visible context, never the only status signal.                   |

Each public Run records:

- elapsed milliseconds
- active milliseconds for the tree
- longest hands-off milliseconds
- intervention count when the source can observe operator messages; otherwise
  unavailable, never a misleading zero
- peak active members across every concurrent Session in Exawatt while the Run was live
- agent-milliseconds (the exact basis for agent-hours)
- raw token total and normalized tokens
- contributing Agent Source ids and assurance facets
- terminal outcome (`settled`, `stopped`, `faulted`, or `unknown`) as a fact,
  not an eligibility filter

The daily identity graph defaults to autonomous agent-hours with absolute,
versioned intensity thresholds. V1 rungs are 0, `<1`, `1–4`, `4–12`, `12–24`,
and `24+` agent-hours. A fully saturated day therefore means at least 24
agent-hours of observed command, whether produced by persistence, concurrency,
or both. Other axes may reuse the graph later; V1 keeps one reading.

### Assurance

Every derivation carries the existing Exawatt truth grammar:

- `reported`: the harness emitted the boundary/member fact
- `observed`: Exawatt observed events or timestamped usage locally
- `derived`: Exawatt applied a documented inactivity/boundary rule
- `unavailable`: the source cannot support the claim

The public UI may collapse these into concise source text, but storage and the
local contract preserve them separately so a future verification layer does
not require a migration of meaning.

## Hosted privacy boundary

Decision `0029` is authoritative. The allowed V1 upload is:

- GitHub-seeded public profile: handle, display name, avatar URL, optional
  public links, and identity-provider name
- consent version, profile-enabled state, local timezone, and sync timestamp
- per-day aggregates: local date, agent-milliseconds, Run count, peak fleet,
  longest hands-off milliseconds, raw tokens, normalized tokens, sources, and
  assurance summary
- per-Run aggregates listed above, with a random public id and a one-way local
  idempotency key

The server never receives raw local identifiers or content. Authenticated
operators may insert/update/delete only their own rows. Anonymous reads go
through public views/RPCs that expose only enabled profiles and allowlisted
columns; `auth.users`, email, internal `user_id`, consent metadata, and sync
keys never appear in a public response.

## Architecture

Build 10 miles ahead, one mile now:

```text
Claude / Codex / future source adapters
                 │
                 ▼
       Local OperatorStatsSource
       ├─ LiveLocalOperatorStatsSource (Electron main)
       └─ DemoOperatorStatsSource (fixtures/evals only)
                 │
                 ▼
      pure @exawatt/core derivation
      Runs → days → rankable snapshot
                 │
        explicit publish consent
                 │
                 ▼
       authenticated sync endpoint
                 │
                 ▼
       Supabase aggregate tables
       ├─ private owner writes
       └─ public allowlisted reads
                 │
                 ▼
  /leaderboard · /operator/[handle] · /run/[id]
```

Rules:

- Source adapters produce facts; ranking and bucketing are pure shared code.
- Demo Mode drives the same UI/view-model boundary and can never publish.
- Electron main owns local filesystem reads. Renderer/public pages never read
  harness files and never receive prompt/transcript content for this feature.
- Sync payloads use a versioned schema and replace/upsert idempotently. The
  hosted side recomputes leaderboard ranks from canonical aggregates rather
  than trusting client-submitted rank.
- GitHub is an identity adapter, not a database schema assumption. Additional
  identity providers add adapters, not alternate profile tables.
- ENG-008's normalized compute model is reused; Agentmaxxing does not invent a
  second token-weight system. The local stats service is deliberately reusable
  by ENG-008 E5's future live Usage source.

## Design brief

### 1. Feature summary

An opt-in public identity and competitive arena for power operators running
agent fleets. It must make one person's commanded capacity instantly legible,
turn exceptional Runs into shareable social receipts, and motivate a saturated
practice without claiming that token waste equals productivity.

### 2. Primary user action

Publish a profile, understand the operator's current high scores at a glance,
and share a Run or profile URL into an existing social conversation.

### 3. Design direction

Brand words: **commanding, lucid, kinetic**. Use the approved dark Exawatt
ground and the design-system type/spacing rungs, but lower chrome density than
the operational app. The profile should feel durable like GitHub and motivating
like Strava. One saturated activity field is the memorable object. High-score
moments may become louder through scale and a single rare accent; no gradients,
glow soup, glass stacks, fake terminal chrome, or ornamental sparklines.

### 4. Layout strategy

- **Leaderboard:** compact identity header; axis and window controls; one
  semantic rank table; the signed-in operator stays locatable even at low rank.
- **Profile:** identity and rank context first; dominant year activity field;
  four records in a typographic rail rather than four identical cards; recent
  Runs below as a plain activity list.
- **Run receipt:** duration is the visual headline; fleet, agent-hours, hands-
  off time, interventions, and energy form the proof line; source/assurance is
  quiet but visible; one Share action.
- Mobile changes the leaderboard from table rows to ranked records and keeps
  every metric available. The activity field scrolls or reflows intentionally;
  it is never shrunk into illegibility.

### 5. Key states

- signed out: public arena readable; publishing asks for GitHub sign-in
- signed in, not linked: link GitHub without creating a second account
- linked, not published: local preview plus exact disclosure and one publish
  action
- syncing: existing public state remains visible with a concise sync status
- #1 of 1: real leaderboard state, never a special fake empty state
- empty week: profile remains credible; weekly row reads no recorded activity
- disabled profile: excluded from public queries; owner sees the republish path
- source unavailable/partial: affected metric reads unavailable, not zero
- API/network failure: local stats remain intact; retry is explicit and safe
- mobile/narrow, 200% zoom, keyboard-only, reduced motion

### 6. Interaction model

Axis and window controls update the same leaderboard in place, preserve URL
query state, and remain keyboard navigable. Profile graph cells expose date and
agent-hours on focus/hover. Run rows open permanent receipt pages. Share uses
the native share sheet when available and copies the canonical URL otherwise.
Publishing and disabling are explicit state transitions with visible outcomes;
no modal is required for first publish because the disclosure is the page.

### 7. Content requirements

Production voice only: nouns, values, records, and short factual captions.
Allowed explanatory ceiling: **"How long useful work continued without needing
you."** Cultural language such as **Agentmaxxing** and **Idle capacity is wasted
intelligence** belongs in the public identity framing, not repeated inside
every metric. Never say productive work was verified. Never expose task copy.

### 8. Implementation references

- `docs/engineering/design-system.md` — authoritative rungs and voice
- Impeccable `spatial-design.md` — asymmetric hierarchy and responsive table
- Impeccable `typography.md` — large record contrast and tabular values
- Impeccable `interaction-design.md` — consent, tabs, focus, loading/errors
- Impeccable `color-and-contrast.md` — dark-ground contrast
- Impeccable `responsive-design.md` — profile/table adaptation
- Impeccable `ux-writing.md` — disclosure, errors, and action labels

### 9. Open questions

None block V1. Later passes may add non-GitHub identity, clubs/friends, optional
public captions, additional graph axes, cryptographic attestation, outcome-
linked Artifact evidence, and image export. None should enter the first slice.

## Execution contract

### A0 — plan, privacy decision, and canon

Deliver this project doc, decision `0029`, roadmap state, amendment chain, and
marketing language before application code. This is the plan-first gate.

Acceptance:

- every approved discovery conclusion is represented once
- exact upload/non-upload fields are named
- Run and ranking formulas are deterministic enough to test
- no unshaped scope remains hidden in the roadmap

### A1 — pure stats kernel and corpus proof

Add a source-neutral `operator-stats` package surface under `@exawatt/core`:
versioned facts, Run derivation, active-span integration, daily bucketing,
leaderboard sorting, graph rungs, payload validation, and fixtures for Claude,
Codex, delegation, steering, gates, overlapping independent Runs, unavailable
capabilities, and timezone boundaries.

Before UI, measure the installed local corpus through the adapter and record:
how many exact vs derived Runs are available, longest Run, peak fleet, total
agent-hours, and any source facts that cannot support the contract. Amend the
contract rather than fabricating missing precision.

Acceptance:

- twelve Agents for two hours equals exactly 24 agent-hours
- steering does not split a Run; an inactive gate pauses active time
- a root yield with a live child does not end the Run
- independent overlapping Sessions stay separate Runs but aggregate fleet size
- rank ties are deterministic and timezone bucketing is pinned
- malformed/unbounded payloads fail closed

### A2 — hosted aggregate spine and identity

Add the Supabase migration, RLS, public allowlisted query functions/views,
authenticated sync/disable endpoints, GitHub identity linking, and versioned
payload validation. Configure the production GitHub OAuth provider and document
its redirect boundary without committing secrets.

Acceptance:

- anonymous callers can read only enabled allowlisted public data
- one user cannot mutate another profile or aggregates
- disabled profiles disappear from every public query
- retries/upserts cannot inflate totals
- no forbidden local field exists in the migration or request payload

### A3 — local live source, consent, and sync

Add one Electron-main local adapter and narrow IPC contract. The renderer sees
only the sanitized snapshot it can display/upload. Add the publish preview and
master switch, exact disclosure, GitHub-link state, sync status, offline/error
recovery, and Demo source through the same interface with publishing disabled.

Acceptance:

- no read or upload occurs merely by visiting the surface
- the first network write follows explicit publish consent
- the payload can be printed in tests and contains only allowlisted fields
- signed-out/offline/live/demo states are distinct and honest

**Amended 2026-08-10 — publishing is a durable preference, not a per-sync
ritual** (operator, verbatim: "I don't want to preview local stats as a user.
Just auto-publish or pause publishing, based on a preference switch"; decision
`0029`'s dated amendment carries the consent reasoning). The mandatory
preview→publish two-step is retired. Consent is now the off-by-default
`operatorProfile.autoPublish` switch (Electron settings store; absent means
off), surfaced on the publish panel and as Settings → Privacy's fourth,
structurally separate "Public sharing" group — both wired to the same stored
preference. While on, the renderer-owned scheduler
(`src/lib/operator-stats/auto-sync.ts`, started from
`instrumentation-client.ts`) syncs shortly after launch, then six-hourly, and
immediately on flip-on, all through one coalesced executor that re-reads the
preference at execution time — no upload can happen with the switch off or
absent, and a gated state never emits analytics; genuine failures count as
`hosted_call_failed` service `operator_stats`. The panel became a status
surface: switch (Publishing on / Publishing paused), last-synced time, honest
paused / waiting-for-GitHub / syncing / up-to-date / failed-retries states, a
small **Sync now**, and **Remove public profile** as the distinct
profile-takedown action (which also pauses publishing so a scheduled sync
cannot resurrect it). The A3 acceptance list above still holds under the new
vehicle: no read or upload happens by visiting, and the first write still
follows explicit consent — the flip.

**Repaired 2026-08-16 — one Consumption reader and application-durable sync
state.** Operator stats is now a projection of the existing incremental
main-process Consumption service. A sync waits for its settled sample view,
filters to the V1 public sources, and never cold-scans the multi-gigabyte
corpus or assembles plan-window observations. The consent anchor,
last-successful timestamp, and cached public-profile state moved from renderer
`localStorage` into the Electron settings store because packaged launches use
random localhost ports. Existing profiles missing that durable anchor recover
the owner-only hosted `joined_at` value before reading local history; new
profiles still begin exactly at consent. The panel distinguishes local scan,
local state, network, authentication, identity, request, and hosted-service
failures with concise recovery copy instead of one opaque failure line.

### A4 — public arena, profile, and Run receipt

Build `/leaderboard`, `/operator/[handle]`, and `/run/[id]`; add production
navigation entries in the public header and Electron `⌘K`, plus
metadata/OpenGraph URLs. Prototype the materially new
profile/receipt visual state in `/hud-gallery` first, then percolate accepted
components to public surfaces and retire the study in the same milestone.

Acceptance:

- Command/Endurance/Fleet/Tokens and week/all-time share one URL-addressable
  ranking grammar
- the real operator appears as #1 of 1 after publishing
- activity field, rank table, and receipts work at narrow/mobile widths, 200%
  zoom, keyboard-only, and reduced motion
- empty/error/partial states are intentional
- a Run URL shares through native share or clipboard fallback
- typing `leaderboard` in Electron `⌘K` shows and executes the Leaderboard row
  without changing `/leaderboard` from public to app-route presentation

### A5 — dogfood proof and closure

Apply the production migration/config, sync the operator's first real post-opt-
in snapshot, verify the public URLs from a signed-out browser, capture visual
evidence, update architecture docs/manifest to the runtime truth, run relevant
unit/API/Electron/browser checks, land, deploy, and install the dogfood app.

Exit criteria:

- `0jake0` (or the GitHub-linked operator handle) is visibly #1 on a real
  public leaderboard containing exactly one enabled profile
- the public profile shows a real current activity graph and records derived
  after opt-in, never fixture data
- a public Run receipt exposes no forbidden content or identifiers
- disabling the profile removes it anonymously without touching local history
- commit is reachable from `origin/master`; Vercel/Supabase state is live; the
  clean-master Electron dogfood installation completes

## Verification matrix

| Layer           | Required proof                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| Pure derivation | focused Vitest contract/fixture suite plus full `pnpm test:run`                                           |
| Payload/privacy | schema validation, forbidden-key recursion test, size/bounds tests                                        |
| Supabase        | migration/RLS integration eval against linked project or isolated local stack                             |
| API             | unauthenticated/authenticated/other-user/disable/idempotent retry route tests                             |
| UI              | component tests for tabs, table semantics, graph focus, consent, partial/empty/error; destination-manifest contract test |
| Visual          | Playwright screenshots of leaderboard/profile/Run at desktop and mobile; contrast and 200% zoom review    |
| Electron        | own-worktree dev server plus identity-checked local snapshot → consent → sync and `⌘K` → Leaderboard evals |
| Delivery        | `agent:land` with all relevant verifies and `--dogfood`; signed-out production URL check after deployment |

## Findings log

- 2026-08-16 (operator report: the last week of usage is absent): **the public
  profile was frozen because its local sync path failed before POST.** The
  production profile contained 51 agent-hours entirely on 2026-08-03 and zero
  on every day from 2026-08-04 through 2026-08-16, even though the installed
  app had `operatorProfile.autoPublish=true`. A real-corpus Electron evaluation
  reproduced `RangeError: Maximum call stack size exceeded`: Operator stats
  ran a second cold scan over 3,844 Claude/Codex files and about 4.48 GB, then
  spread 195,650 Codex plan-window observations into one function call. Those
  observations are not part of the public payload at all.

  A second persistence defect made recovery unsafe: the packaged app serves
  each launch from a random `127.0.0.1:<port>`, while the consent anchor,
  last-sync time, and published flag were stored in origin-scoped
  `localStorage`. LevelDB evidence showed fresh per-port consent timestamps on
  2026-08-16, so a relaunch could move the start boundary forward and omit the
  missing week even after the scanner stopped crashing. The repair makes the
  incremental Consumption service the sole corpus reader, removes large-array
  spread calls from the remaining generic scan/derivation paths, persists
  publication state in Electron settings, and restores the original boundary
  from authenticated hosted metadata for existing profiles. Regression proof
  covers 130,000 observations, settled samples-only projection, durable state,
  legacy-boundary recovery, owner metadata, and actionable panel failures.
  The same own-worktree Electron evaluator that failed on the installed corpus
  then completed successfully through the repaired main-process IPC with four
  sanitized recent Runs across one local day.

- 2026-08-10 (operator decision, verbatim: "I don't want to preview local
  stats as a user. Just auto-publish or pause publishing, based on a
  preference switch."): **the preview→publish two-step gated the wrong
  moment.** The operator — #1 on the board, `operator_profiles.enabled=true`,
  already past first consent — wanted his frozen profile refreshed and was
  made to re-run a disclosure ritual designed for someone who had never
  consented. Shipped the same day: publishing became the off-by-default
  `operatorProfile.autoPublish` preference (the A3 amendment above), with
  automatic coalesced syncs while on and the preview demoted to optional
  passive disclosure. This also gives the 2026-08-06 staleness finding its
  owner-facing surface: the panel now states "waiting for GitHub link" when
  the switch is on but the identity is gone, instead of freezing silently.

- 2026-08-06 (external-user audit, `projects/external-user-readiness.md`):
  **the GitHub identity backing the public profile no longer exists, and A2's
  acceptance was too weak to catch it.** `operator_profiles` holds a genuine
  GitHub subject (`275063`, provider handle `JakeSc`) written by a real
  `sync_operator_stats` call on 2026-08-04 — so the link unquestionably worked
  once. `auth.identities` now holds four rows, all `google`, and no `github`
  row at all. The `auth` audit log retains nothing from that window, so what
  removed it cannot be recovered.

  Consequences, both read from the code rather than reproduced (reproducing
  would rewrite the operator's published aggregates): `githubIdentity()` in
  `/api/operator-stats` returns null and answers **409 "Link GitHub before
  publishing your operator profile"** before the RPC is reached, and
  `sync_operator_stats` would independently raise `linked GitHub identity
  required`. Meanwhile `get_operator_leaderboard` still serves the profile
  anonymously — rank 1, 184,072,156 agent-ms, avatar from GitHub 275063 — so
  the public face is live but frozen at its 2026-08-04 sync with nothing
  anywhere saying so.

  Two corrections follow. **Acceptance:** A2/A5 tracked this as one-time
  provider configuration, which "publish once" satisfies; it must become
  identity persistence plus a **later** successful resync. **Product:** a
  missing link must surface — a publicly visible profile that silently cannot
  refresh is exactly the unverified-value failure decision `0029` forbids,
  arriving through staleness rather than through a wrong number.

- 2026-08-04 (partner conversation `2026-08-04-dan-rosenberg`, operator-accepted
  the same day — roadmap amendment recorded): **the public arena must lead with
  output, not input.** Dan Rosenberg is a creative director and positioned the
  objection explicitly as a marketing one: "I am probably the most
  marketing-minded regular person that you're going to talk to about this, who's
  going to tell you people don't think that way. The token thing is probably
  going to work for internal things, but as soon as you make that a public
  focus, people are like, oh, you're wasting money." Three distinct problems
  with the A0/A1 axes as a PUBLIC surface:
  - *It reads as spend, not capability.* "If anything, it's just kind of saying,
    look at how much money I spent, look at how much energy I've used." The
    audience already believes each prompt boils off bottles of water — accurate
    or not, that is the frame the number lands in.
  - *It is gameable in a way the design pass never addressed.* "If I'm just
    having agents twiddling their thumbs, technically they're still — I'm
    commanding them for hours, right?" Command agent-hours integrates active
    Agents over time; an Agent that is up and idle still accrues. This is a
    measurement objection, not only a copy objection.
  - *Output is the claim people actually respond to.* "Instead of saying you
    spent 51 hours, you can say we launched 20 projects in a month… 51 hours is
    the amount of time you've been in the game." Plus the portfolio corollary:
    "you can tell me you launched 20 projects, but if they're all [garbage] I'm
    going to know you're not that good" — hence a visible list of the launches
    and a props/upvote axis.

  Operator direction from the same call: cheap proxies first (commits,
  publishes, releases — things Exawatt can plausibly observe), harder outcome
  measures (users made happy) stay unshaped. Internal and among-friends
  competition on hours is untouched — the operator and a friend are actively
  trash-talking over Endurance, and that loop works. What changes is the public
  headline and, consequently, the A1 public-metrics table. Open question the
  design pass must answer honestly: Exawatt observes agent activity, not
  launches, so either it earns a real signal (git/release/deploy observation
  under the existing assurance ladder) or it declines the claim — a
  self-reported "projects launched" counter would be the exact
  unverified-value failure decision `0029` forbids.

- 2026-08-04 — **FIX-003 copy half FIXED.** Every public axis label is now
  written for a first-time visitor:
  Command → **Agent hours**, Endurance → **Longest hands-off**, Fleet → **Peak
  fleet size**, Tokens → **Tokens used**. The ids were renamed to match in a
  follow-up the same day (operator: "we don't have any links and I don't want
  to have legacy debt"): `command`/`endurance`/`fleet`/`energy` →
  `agent-hours`/`hands-off`/`peak-fleet`/`tokens` across the `LeaderboardAxis`
  union, the ranking kernel, the `?metric=` URL contract, and the
  `get_operator_leaderboard` RPC (migration `20260805002000`). The old
  vocabulary is REMOVED, not aliased — the RPC guard now raises on `command`,
  which was verified against production before the app shipped. `energy` for
  "tokens" was the clearest instance of the debt: an id that never matched its
  own label. An unknown `?metric=` still falls back to the default axis rather
  than erroring, so a stale link degrades instead of breaking. Descriptions were rewritten to plain
  statements ("Longest stretch your agents ran without needing you"), and the
  same labels percolated to the operator profile record rail, the activity
  graph heading ("Agent hours by day"), the run receipt rail, the publish
  panel preview line, and the `⌘K` surface summary. `formatAgentHoursLong`
  ("51 agent hours") now carries the unit wherever no column header or label
  supplies it — page/OG descriptions, compact run rows, and graph-cell
  `aria-label`s — because "51 h" standing alone was the original defect in
  miniature. Verified with headless shots of `/leaderboard`,
  `/operator/jakesc`, and a real run receipt against the worktree dev server.
  **Two asks from the capture deliberately did NOT ship here:** peak fleet
  counting subagents (a public-number change owed to the A1 measurement
  contract) and the retro on how this copy passed the A4 gallery study — both
  ride the output-pivot pass above.

- 2026-08-04 (operator quick capture `26d8caed`, FIX-003, superseded by the
  fix above; kept for the original diagnosis): the
  `/leaderboard` axis copy is unintelligible to a visitor — and to the
  operator. "Command: 51h" reads as nonsense (Command as a duration label),
  "Endurance" and "Fleet" are unexplained jargon. Direction from the capture:
  self-explanatory labels — "Peak fleet size" instead of "Fleet",
  "Tokens used" instead of "Tokens" — and every axis must make sense to
  someone who has never seen Exawatt. One semantics change rides along: the
  fleet-size axis should count subagents, not just top-level Agents; ENG-023's
  delegation tree is the truth source, and the A1 measurement contract needs a
  deliberate amendment (it changes public numbers, so it cannot slip in as a
  copy fix). The capture also asked for a retro: this copy shipped through the
  A4 gallery study without tripping any gate, which is exactly the failure
  ENG-036's production-voice authority exists to catch — extend its copy gate
  to public web surfaces, not just the app.

## Roadmap milestone log

### 2026-08-03 — A0 design pass

Shaped through an operator interview after research into tokenmaxxing,
GitHub contribution identity, Strava competition, existing AI coding usage
leaderboards, and multi-axis model rankings. The pass rejected raw consumption
as the sole status hierarchy, an opaque composite score, social-network scope,
historical backfill, public task text, and anti-cheat infrastructure. It chose
transparent multi-axis rank, autonomous agent-hours as the default identity
signal, one opt-in public profile, GitHub-seeded/provider-neutral identity, and
a dark restrained public visual system.

### 2026-08-03 — A1 foundation and A2/A3 runtime boundaries

Implementation established a source-neutral `@exawatt/core` operator-statistics
kernel rather than deriving leaderboard meaning inside React, Electron, or SQL.
The kernel accepts sanitized activity facts, derives Run and local-day
aggregates, ranks the four transparent axes, and validates a versioned
aggregate-only upload payload with unknown fields rejected at every level. Its
first installed-source adapter conservatively reconstructs activity intervals
from timestamped Claude Code and Codex Consumption samples, caps inferred gaps,
and labels derived evidence rather than claiming exact live turn truth.

Electron main owns machine-local scanning behind one trusted, operator-triggered
IPC method. The renderer receives only the publishable preview; public ids and
idempotency keys are hashes, not local Session or harness identifiers. The
hosted code path resolves the authenticated GitHub identity server-side and
atomically replaces the caller's bounded day and Run projection through an RLS
schema. Anonymous reads are limited to enabled profiles exposed by dedicated
leaderboard, profile, and Run functions. Preview, publish, sync, and disable are
separate actions; disabling changes public visibility without altering local
history.

A1's kernel and fixtures were implemented in this pass; the installed-source
proof below closes the milestone. A2 stays active-build until the one-time
GitHub OAuth App registration and provider configuration are live. A3 and A4
closed after the Electron IPC and visual/browser proofs below. A5 owns the
remaining integration, deployment, production URL, and dogfood installation.

### 2026-08-03 — installed corpus and visual proof

The read-only installed-source scan after the operator's explicit publication
request found 12 post-opt-in Runs: 0 exact, 12 timestamp-derived, and all 12
honestly marked partially unavailable because Codex does not report delegation
and local Consumption records do not expose steering messages. The aggregate
contained 2.55 autonomous agent-hours, a 17m 33s derived hands-off span, a
cross-Session peak fleet of 10, and 49.1M normalized tokens. These values came
from the same local adapter and pure kernel used by the publish preview; no
fixture, prompt, response, path, Project, or provider Session id entered the
measurement output.

The shared profile/receipt treatment was mounted temporarily in
`/hud-gallery`, reviewed through Playwright at 1440px and 390px, and retired
after acceptance. The narrow view had no horizontal overflow. The activity
field remained legible, the identity hierarchy held, and the amber high-score
treatment stayed isolated to the shareable Run record rather than coloring the
whole arena.

The production migration was applied and its anonymous/owner boundaries were
rechecked after application. Because GitHub exposes no API or CLI for creating
an OAuth App and this project had no client credentials, the operator's first
profile used an explicit service-boundary seed: the GitHub account verified by
the authenticated local `gh` session plus the same post-consent aggregate the
Electron adapter produced. This is an operator override, not the product sync
path. The normal RPC still requires a real `auth.identities` GitHub link and
rejects spoofed or non-GitHub callers. At seed time the public board contained
exactly one enabled profile: `@jakesc`, ranked #1 on all four axes with 12 Runs,
3.03 agent-hours, 20m 52s derived endurance, fleet peak 10, and 52.2M normalized
tokens. One-time OAuth App registration remains the only A2 blocker.

### 2026-08-03 — A4 command-discovery correction

Immediate dogfood found that the built Leaderboard did not appear in `⌘K`.
The palette projected only `APP_SURFACES`; Leaderboard had deliberately been
classified as a public route, so the A4 implementation's header link satisfied
the ambiguous phrase “production navigation entry” while leaving no command
row. The acceptance and verification matrix named public-page behavior but not
Electron discovery, and the manifest tests could validate only destinations
already registered. This was an execution-contract and navigation-model gap,
not cmdk's separately recorded fuzzy-ranking defect.

The correction makes the navigation manifest a registry of product
destinations rather than app routes alone. Route presentation and palette
eligibility are explicit independent fields; `APP_SURFACES` is now a derived
subset, while Leaderboard stays a marketing route and joins the palette through
the same registry. Unit coverage locks that classification/eligibility pair,
and the Electron navigation evaluator searches the rendered palette, executes
**Go to Leaderboard**, verifies `/leaderboard`, and requires its public footer.
Future milestone contracts must name each required discovery face explicitly;
“navigation entry” alone is not acceptance language.

### 2026-08-16 — A3 leaderboard freshness repair

Production inspection and an installed-corpus Electron evaluation isolated the
missing week to the local pre-upload path, not leaderboard ranking or hosted
aggregation. The public row last advanced on 2026-08-03. Auto-publishing was
enabled, but Operator stats performed an independent multi-gigabyte cold scan
and overflowed V8 while merging an unrelated plan-window history. Separately,
its origin-scoped timestamps reset as Electron chose a new localhost port.

The landed repair reuses the watermarked Consumption service's settled sample
view, hardens generic corpus aggregation against V8 argument ceilings, and
moves all publication lifecycle metadata behind validated Electron settings
IPC. An authenticated owner-only status read supplies the original hosted
consent date only for legacy profiles missing local durable state. Public
payload fields, recursive rejection, GitHub identity enforcement, Demo
boundary, and no-pre-consent-history policy are unchanged. The publish panel
now identifies the failing layer and the automatic retry behavior in the
existing design-system status treatment.
