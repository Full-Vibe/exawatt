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
   schemas, and proves every valid and invalid fixture.

## Compatibility policy

- `protocolVersion` selects a wire protocol; it is not a feature flag.
- A V1 client supports only protocol version 1 and must reject configured or
  returned versions it does not understand before sending content.
- Request objects are closed: unknown fields are invalid. Response objects are
  additive: a V1 client must ignore fields it does not understand.
- A future V2 service should retain its V1 codec for at least one client
  release. Clients never replay a mutating request merely to negotiate a
  version; a version mismatch degrades to the same local/absent state as an
  unconfigured capability.
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

**That is the target, not yet the shipped client.** CORRECTED 2026-08-18: this
section read as a present-tense privacy guarantee, and the sentence below was
the only thing qualifying it. Today Exawatt's own client sends
`{ schemaVersion, projectKey, label }` (`electron/main/pty/context-summarizer.ts`),
where `label` is the accepted context label, and the hosted route derives the
identity server-side. So the accepted goal label does reach the service on the
shipped path. `docs/engineering/outbound-data.md` section 4 is the accurate
account of what leaves a machine today; this schema is what the client-derived
key migration moves to, and it is the shape a distributor should implement
against. Until that migration lands, do not read this section as a statement
about the current Exawatt client.

The current private hosted routes predate this publication contract. Runtime
call-site and hosted-handler alignment is a separate migration; these schemas
define the compatibility target and deliberately do not import private route
code.

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
