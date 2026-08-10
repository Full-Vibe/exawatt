<!-- Generated for the public repository by the "public-document-set" recipe. -->
# 0029 Opt-in aggregate telemetry for public Agentmaxxing

Date: 2026-08-03
Status: accepted

Amended 2026-08-03 by decision `0031`: this decision continues to govern the
explicit publication of public Operator identity and Run aggregates. Its
rejection of default-on analytics no longer applies to the separate,
content-excluding PostHog product-analytics stream accepted for production and OSS
builds.

Amended 2026-08-10: the consent vehicle changed from mandatory
preview-then-publish to an off-by-default publishing switch whose enabling is
the consent act; steady-state syncs run automatically while it is on. See the
dated section at the end. The upload allowlist, forbidden-upload list, and
public read boundary are unchanged.

## Context

Exawatt has never uploaded general product telemetry. ENG-008 reads Claude Code
and Codex usage locally; product positioning promises that customer work and
shared agent memory remain theirs. ENG-035 deliberately introduces a public
operator profile and global leaderboard, which cannot exist without a hosted
aggregate. This is the first non-optional hosted dependency for a visible
product feature and therefore cannot inherit an unstated analytics posture.

The product value is social: operators opt in because they want a public
identity, rank, and shareable Run receipts. Covert or default-on collection
would destroy the trust required for bottom-up adoption and is unnecessary.

## Decision

Exawatt may upload a narrowly allowlisted aggregate only after explicit,
versioned operator consent to publish a public profile.

### Consent and lifecycle

- Visiting any Agentmaxxing surface performs no local scan or upload by itself.
- Before the first write, the operator sees the exact fields that will leave
  the machine and a local preview of the resulting profile.
- **Publish my profile** records the consent version, enables the public
  profile, and starts idempotent sync. No pre-consent history is uploaded; V1
  begins at opt-in.
- One master switch stops future sync and removes the profile and its rows from
  anonymous public queries. Local source history is unchanged.
- Account deletion remains the irreversible deletion path for hosted personal
  data under the existing privacy contract.

### Identity

V1 publishing requires a GitHub identity. Existing Exawatt users link GitHub to
their current Supabase user rather than creating a second account. Hosted
profiles remain provider-neutral: handle, display name, avatar URL, public
links, and identity-provider metadata. GitHub is the first adapter, not the
schema boundary.

### Allowed upload

- public profile fields: handle, display name, avatar URL, optional public
  links, identity provider
- private control fields: owner user id, consent version, enabled state, local
  timezone, last sync time
- daily aggregates: local date, agent-milliseconds, Run count, peak fleet,
  longest hands-off span, raw tokens, normalized tokens, source ids, assurance
  summary
- Run aggregates: elapsed/active/hands-off milliseconds, interventions, peak
  members, agent-milliseconds, raw/normalized tokens, source ids, assurance,
  terminal outcome, random public id, and one-way idempotency key

### Forbidden upload

Prompts, responses, transcript content, source code, repository or Project
names, branches, paths, filenames, diffs, Artifact content, task descriptions,
credentials, environment values, raw local Session/provider ids, and source
file locations. The payload validator rejects unknown fields recursively.

### Public read boundary

- Authenticated users may write only rows owned by their Supabase user id.
- Anonymous callers read only enabled profiles through allowlisted public
  views/RPCs.
- Public responses never contain email, internal user id, consent metadata,
  last-sync internals, or idempotency keys.
- Leaderboard rank is server-derived from stored aggregates, never accepted
  from the client.

### Assurance and integrity

Public data says **Recorded by Exawatt**, not verified. Source and assurance
facets survive in storage. V1 uses deterministic derivation, idempotent upsert,
payload bounds, and impossible-value rejection, but no anti-cheat or
cryptographic attestation. Cheating is explicitly deferred until real abuse
justifies the system cost.

### Hosted dependency

Supabase is the V1 aggregate store and GitHub identity broker; Next.js routes
provide authenticated sync and public read composition. Local source adapters
and pure derivation remain independent of Supabase so another control plane can
replace it without rewriting measurement semantics.

## Consequences

- The statement "nothing leaves this machine" is no longer globally true once
  an operator publishes. Local Usage surfaces must retain their current claim
  for local data and link to the explicit Agentmaxxing exception where
  relevant.
- Privacy review is part of the feature contract. Adding one uploaded field
  requires amending this decision, payload schema, disclosure, and tests.
- GitHub provider configuration and hosted availability become launch
  dependencies for publishing, while local agent operation remains fully
  offline-capable.
- Public profiles can expand to other identity providers, clubs, teams, and
  attestation without changing the local measurement contract.
- A public profile is not an employment-productivity claim. Exawatt publishes
  commanded capacity and source-observed activity, not independently verified
  business value.

## Alternatives considered

- **Default-on anonymized analytics as the mechanism for public profiles.**
  Rejected: it does not produce the public identity the user wants. Decision
  `0031` later accepts a separately allowlisted, configurable PostHog stream for
  ordinary product analytics; public profile publication remains opt-in.
- **Raw transcripts with server-side aggregation.** Rejected: needless content
  exposure and lock-in; all required measurements can be derived locally.
- **GitHub as the permanent profile schema.** Rejected: the operator class will
  extend beyond developers quickly.
- **Per-metric privacy controls in V1.** Rejected: consent becomes harder to
  understand and test. One exact boundary and one master switch are safer.
- **Tamper-proof attestation before launch.** Rejected: high cost before a real
  adversary exists, and most harness facts are not cryptographically signed.

## Amended 2026-08-10 — the switch is the consent, syncs are automatic

Operator direction, verbatim: **"I don't want to preview local stats as a
user. Just auto-publish or pause publishing, based on a preference switch."**
The operator — an already-consented published profile owner — hit the
mandatory preview→publish two-step when all he wanted was his frozen profile
refreshed. The ritual was designed as a first-consent disclosure; as the
steady-state sync UX it was friction with no consent value.

What changes:

- **Consent remains explicit and prior to the first upload**, but its vehicle
  is now a durable preference: `operatorProfile.autoPublish` in the desktop
  settings store, **default off** (absent means off — the opposite polarity
  from every decision-`0031` switch). Flipping it on is the consent act, and
  the flip carries the disclosure inline: the exact aggregate shared, what
  never leaves, that recording starts at the flip with no backfill, and that
  GitHub seeds the identity. The mandatory local preview is retired; a
  passively shown local aggregate is optional disclosure, and nothing blocks
  on it.
- **While the switch is on, syncs are automatic**: once shortly after launch
  (delayed well past startup) and on a long interval, plus immediately when
  the switch turns on. Every trigger funnels through one coalesced executor
  that re-reads the preference at execution time; no upload of any kind can
  happen while the switch is off or absent. Sync failures are silent to the
  operator beyond an honest panel status and are counted as
  `hosted_call_failed` (service `operator_stats`) — a paused, signed-out, or
  unlinked state performs no call and never emits.
- **The master off switch splits into its two honest meanings.** Pausing
  (switch off) stops future sync; the profile stays visible, frozen.
  **Remove public profile** remains the action that takes the profile and its
  rows out of public queries, and it pauses publishing as a side effect so a
  scheduled sync cannot resurrect what the operator just took down.
  Re-enabling the switch is the explicit republish path.
- The switch appears in two places wired to the same stored preference:
  the leaderboard publish panel and Settings → Privacy, where public sharing
  is a fourth structurally separate group — it is the only control there that
  makes data public, and the only one that defaults off.
- `consentVersion` stays 1: the disclosed boundary — allowlist, exclusions,
  no backfill, GitHub-seeded identity — is unchanged; only the vehicle of the
  consent act changed.

Unchanged and untouchable: the allowed-upload allowlist, the forbidden-upload
list, the payload validator's recursive unknown-field rejection, the public
read boundary, and account deletion as the hosted-data deletion path.
