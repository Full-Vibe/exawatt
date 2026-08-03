<!-- Generated for the public repository by the "public-document-set" recipe. -->
# 0029 Opt-in aggregate telemetry for public Agentmaxxing

Date: 2026-08-03
Status: accepted

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

- **Default-on anonymized analytics.** Rejected: it does not produce the public
  identity the user wants and violates the product's trust posture.
- **Raw transcripts with server-side aggregation.** Rejected: needless content
  exposure and lock-in; all required measurements can be derived locally.
- **GitHub as the permanent profile schema.** Rejected: the operator class will
  extend beyond developers quickly.
- **Per-metric privacy controls in V1.** Rejected: consent becomes harder to
  understand and test. One exact boundary and one master switch are safer.
- **Tamper-proof attestation before launch.** Rejected: high cost before a real
  adversary exists, and most harness facts are not cryptographically signed.

