<!-- SPDX-License-Identifier: Apache-2.0 -->

# Exawatt compatibility contracts

This directory is the machine-readable boundary between an Exawatt client and
a distributor. It is intentionally independent of Exawatt's hosted storage,
quota, model-provider, and deployment implementation.

Everything under `contracts/**` is licensed under Apache-2.0 so another
distributor can implement, test, and extend these protocols without adopting
the application's AGPL license. See `LICENSING.md` and
`LICENSES/Apache-2.0.txt` once the repository licensing packet lands.

## Implement a compatible distribution

1. Start with `distribution/v1/schema.json`. An absent distribution input is
   equivalent to the all-null `community.json` fixture: no account, hosted
   service, enrichment, analytics, or update capability is implied.
2. Implement only the service families you need from
   `services/v1/openapi.json`. Every non-null endpoint reference is the exact
   URL for that operation family, not a host from which the client invents
   paths.
3. Authenticate service calls with the bearer token issued by the configured
   `account`. Schema V1 rejects a non-null service or enrichment endpoint when
   `account` is null. `services.accountData` is reserved and must remain null.
4. Send `Exawatt-Service-Version: 1` on every request and response. Validate
   request and response bodies against the referenced JSON Schemas.
5. Run `pnpm test:contracts` from the repository root. The suite compiles every
   schema with Ajv 2020-12, verifies that OpenAPI references the same canonical
   schemas, and proves every valid and invalid schema fixture.
6. Run `pnpm test:service-conformance` for the executable wire matrix. It drives
   `conformance/cases.json` through a strict loopback distributor and the shared
   client boundary, including compatibility failures and no-replay behavior.

## Compatibility policy

- `protocolVersion` selects a wire protocol; it is not a feature flag.
- The client retains each configured endpoint as the pair
  `{ url, protocolVersion }`: it sends the selected version in
  `Exawatt-Service-Version` to that exact URL and requires the same header and
  value on the response before decoding its body.
- A V1 client supports only protocol version 1. It must reject an unsupported
  configured version before sending content, and treat a missing, malformed,
  or different response version as a non-retryable compatibility error.
- Request objects are closed: unknown fields are invalid. Response objects are
  additive: a V1 client must ignore fields it does not understand.
- JSON successes use `application/json`. Every non-success uses
  `application/problem+json`, and its bounded problem `status` matches HTTP.
  A client treats the wrong media type or a malformed success/problem envelope
  as a non-retryable compatibility error rather than guessing at the body.
- A future V2 service should retain its V1 codec for at least one client
  release. Clients never replay a mutating request merely to negotiate a
  version; a version mismatch degrades to the same local/absent state as an
  unconfigured capability.
- During the V1 rollout, Exawatt's reference service may temporarily accept a
  request with no version header as legacy V1. This is a server migration aid,
  not client negotiation: current clients always send the header, and every
  reference-service response declares the codec it used.
- `429`, `502`, and `503` responses may be retried only where the application
  already treats the operation as idempotent. Respect `Retry-After`. Feedback
  and operator-stat publication use idempotency keys; other POSTs must not be
  blindly replayed after an ambiguous network failure.

## Capability absence

Null means absent, not broken. The client must not make a network request for a
null capability. Context labels, summaries, and goal visuals keep their local
or last-good fallback; feedback and operator publishing remain unavailable
without affecting local work. A custom distributor can therefore implement one
family without inheriting the rest of Exawatt Cloud.

## Goal-visual privacy boundary

The V1 goal-visual request in `services/v1/schemas/goal-visuals.schema.json`
contains only `schemaVersion` and an opaque `identityKey`, and no Project name,
accepted goal label, prompt, instruction, path, or transcript. Clients derive
the 64-character key locally with a keyed SHA-256 construction or persist a
random content mapping; services must treat it as opaque. The returned image is
deterministic for that key within a service's documented generation version.

**Exawatt's own client sends this.** It did not always: until 2026-08-19 it
sent `{ schemaVersion, projectKey, label }`, where `label` was the accepted
context label, and this section read as a present-tense guarantee of a request
that had not shipped. BUG-091 migrated the client, the gallery bench, and the
hosted route together. `electron/main/pty/context-summarizer.ts` now derives the
key locally and `docs/engineering/outbound-data.md` section 4 is the account of
what leaves a machine.

Exawatt's reference service is tested against these public envelopes and
headers without importing its private implementation into the Apache-licensed
contract package.

## Agent quick map

| Need                                  | Canonical file                                     |
| ------------------------------------- | -------------------------------------------------- |
| Distribution shape and null semantics | `distribution/v1/schema.json`                      |
| Community/all-null example            | `distribution/v1/fixtures/community.json`          |
| Custom distributor example            | `distribution/v1/fixtures/custom-distributor.json` |
| HTTP operations and headers           | `services/v1/openapi.json`                         |
| Family request/response schemas       | `services/v1/schemas/*.schema.json`                |
| Executable examples                   | `services/v1/fixtures/**`                          |
| Schema/OpenAPI parity                 | `conformance/schema-parity.test.ts`                |
