<!-- Generated for the public repository by the "public-document-set" recipe. -->
# 0036 Open client, permissive compatibility spec, private cloud

Date: 2026-08-10
Status: accepted — implementation is ENG-030 OS2–OS6; amended 2026-08-11:
counsel review is trigger-deferred, not a publication gate (see Amendment);
amended 2026-08-16: automatic own-account network reads require a
distribution-declared stable signing identity

## Context

The operator's objective for opening Exawatt is distribution and a developer
community first, with later revenue from Exawatt-operated cloud offerings. The
operator also wants to retain control over product direction, official builds,
security, service cost, and the ecosystem; does not want a proprietary company
to strip the application code into a closed competing product; and does want
other repositories and harnesses to adopt an agent-readable Exawatt
compatibility contract without importing Exawatt's implementation.

The researched model is the Element/Matrix split, with one distribution
property borrowed from Code - OSS / Visual Studio Code:

- a permissively licensed interoperability specification;
- a copyleft application and implementation;
- company-owned hosted services and official distribution;
- a contributor agreement that preserves both the public commons and the
  company's ability to grant alternative commercial licenses;
- a thin company distribution layer that consumes an immutable public source
  revision rather than maintaining a private fork of the product.

The existing repo is not publication-safe as a unit. It mixes the client and
public engineering canon with partner conversations, operator briefs,
marketing and monetization strategy, production Supabase state, hosted route
implementations, admin identity, signing/release machinery, and official
service configuration. Its history also contains material that must never be
made public.

## Decision

### 1. Two repositories, one-way dependency

`Full-Vibe/exawatt` becomes the fresh public repository and the canonical home
of daily product engineering. The current private repository is renamed
`Full-Vibe/exawatt-company`; it remains the living company and hosted-service
repository, not an archive.

The dependency points one way:

```text
exawatt-company (private) -> exawatt (public)
```

The private repository may pin an immutable public commit for an official
build and consume versioned public contracts. The public repository must
clone, build, test, run Demo Mode, and operate local Agent Sources without any
private checkout, private package, Exawatt account, or Exawatt service.

There is no bidirectional mirror and no copied private product fork. A contract
change lands compatibly in public first; the private service adopts the
versioned contract; an official client capability is enabled only after the
service supports it.

Repository names describe purpose, not visibility. `exawatt-company` covers
business canon, hosted services, production operations, and official
distribution; GitHub already records that the repository is private.

### 2. Public and private canon are classified by subject

Public:

- product concepts, behavior, architecture, and engineering decisions needed
  to understand, modify, test, or contribute to the public application;
- the engineering roadmap and its execution detail;
- the Exawatt roadmap convention and future compatibility specifications;
- security and outbound-data behavior of the public and official clients.

Private:

- partner and customer source material, operator briefs, corporate records,
  pricing, monetization, fundraising, go-to-market, competitive strategy, and
  other business decisions;
- Exawatt-hosted implementation and operations, production administration,
  service credentials, and official signing/release custody.

A mixed decision is split: the public record owns the product contract and
observable behavior; the private record may own commercial reasoning or
company-operating detail. Public canon never needs a private link in order to
be actionable.

### 3. License boundary

The selected working licenses are:

- **AGPL-3.0-or-later** for the Exawatt application and reusable Exawatt
  implementation packages;
- **Apache-2.0** for the agent-readable Exawatt compatibility specification,
  schemas, examples, and conformance fixtures;
- proprietary ownership for the private hosted implementation, company canon,
  production operations, and official distribution overlay;
- a separate trademark policy for the Exawatt name, icon, official-build
  designation, and any future Exawatt Ready conformance mark.

AGPL is a share-back boundary, not a non-compete. It permits commercial forks
but requires covered modifications to remain available under the same license,
including covered modifications operated for users over a network. A modified
distribution may not present itself as official Exawatt, use Exawatt's signing
identity or update channel, or consume Exawatt-hosted services by default.

Counsel review of the license selection, trademark policy, and CLA is
**trigger-deferred, not a publication gate** (amended by the operator,
2026-08-11 — "too early"). Publication proceeds on standard instruments:
unmodified OSI license texts, an off-the-shelf license-grant CLA with the
perpetual-OSI commitment, template-derived trademark policy, and mechanical
dependency-license and asset-provenance scans. Qualified counsel is engaged
when a trigger fires: the first commercial license or paid tier, an
enterprise customer requiring legal assurance, a live dispute, or fundraise
diligence. Refined 2026-08-14 after external review: "off-the-shelf" means
**verbatim adoption of a proven instrument** — Element's published CLA
already carries the perpetual-OSI commitment and is the default choice. If
the CLA text ends up requiring any custom drafting, that adds one earlier
trigger: a short specialist review of the CLA and the private-overlay
boundary before the first external contribution is merged. Repository
publication itself is never gated on counsel; the CLA is the one instrument
whose defects are permanent once contributions are accepted under it, and
the overlay question only becomes live at the same moment external code
does. A future review may correct legal mechanics without reopening the
product goal: open distribution and contribution, mandatory sharing of
implementation forks, permissive adoption of the compatibility contract,
private cloud value. The AGPL-reach question is contained by ownership: the
operator holds copyright in the original work and the CLA grants cover
contributions, so license obligations bind licensees, never Exawatt's own
private use. A low-cost USPTO trademark filing for the Exawatt mark is worth
doing before broad visibility; it is an option, not a gate.

### 4. Contribution rights

External contributors sign a short, automated Contributor License Agreement.
It is a license grant, not copyright assignment:

- contributors retain ownership of their work;
- accepted contributions remain available in the public application under an
  OSI-approved open-source license;
- contributors certify they have the right to submit the work;
- Exawatt receives the rights needed to distribute the complete application
  under AGPL and to grant alternative commercial licenses later.

This is more ceremony than DCO alone, but it prevents a future commercial
license from requiring permission from every historical contributor. The
public commitment to keep accepted contributions available under an OSI
license is part of the agreement, not marketing copy.

### 5. Exawatt-ready means the existing Markdown contract

The public compatibility wedge begins with the already accepted Exawatt
roadmap convention. A repository becomes roadmap-ready by adopting the
plain-Markdown grammar and declaring `exawatt-roadmap: v2` in its canonical
roadmap. Decision `0011` remains binding: there is no `.exawatt/roadmap.json`
or other roadmap sidecar to drift from the Markdown source of truth.

The `.exawatt/` directory remains the home for adjacent repo-owned coordination
state such as Session handoffs, assignments, and future notes. It complements
the canonical roadmap; it does not duplicate it.

The first public release does not need a permissively licensed general-purpose
SDK. Other tools adopt the Apache-licensed specification and conformance
fixtures. Exawatt implementation code remains under AGPL.

### 6. Community builds are offline-first and service-neutral

A build made from the public repository has no Exawatt production endpoint,
Supabase configuration, analytics sink, update feed, or official-build marker
by default. It runs Demo Mode and local Agent Sources, and may be configured by
its distributor to use that distributor's compatible services.

The private official-distribution pipeline pins an exact public commit and
supplies official branding, endpoint configuration, analytics configuration,
Apple signing/notarization, and the update channel. Official binaries remain
source-correspondent to the public application revision.

Packaging alone is not evidence of a durable network identity. A local
community package can be ad-hoc signed even though Electron reports it as
packaged, and an automatic credentialed read from that artifact recreates the
firewall-approval churn recorded in incident `0011`. The distribution contract
therefore also declares whether the distributor supplies a stable signed
identity for Exawatt-owned own-account traffic. The community default declares
none; the official overlay declares the capability alongside signing custody;
a downstream distributor may declare it for its own stable signed build. This
field controls local behavior only. It is never proof of officiality or
authorization to use an Exawatt service.

Every distributable desktop build carries the public
`ReleaseProvenanceV1` contract. It records the application version, exact
public commit, distribution-configuration SHA-256, composition profile, and
composition SHA-256. A `community` composition has no overlay commit; an
`official-desktop` composition must record the exact private overlay commit.
The composition digest covers canonical UTF-8 JSON of every preceding field
except the digest itself. The Apache-licensed JSON Schema is the compatibility
surface; the public application package supplies strict parse, create, hash,
and verify utilities. This record proves source correspondence and detects
composition drift. It is evidence and telemetry, never authorization or proof
that a caller may use an Exawatt-hosted service.

Exawatt's server never treats a shared desktop secret, endpoint URL, public
OAuth client id, build header, or self-reported delivery channel as proof of an
official binary. Hosted access is defended with authenticated accounts,
entitlements, authorization, quotas, global ceilings, kill switches, audit
logs, and abuse controls. Community builds being unconfigured prevents
accidental use; server controls contain motivated abuse.

Apple App Attest on macOS 27 or later is a future defense-in-depth option for
stronger official-instance evidence. It is not a launch dependency and does
not raise the first public release's macOS floor.

This supersedes decision `0031` only where that record made production builds
from the open-source repository default to Exawatt analytics or allowed
community builds to consume Exawatt-hosted enrichment. Decision `0031`'s
content exclusions, independent controls, deterministic fallback, and honest
outbound-data disclosure remain binding for official distributions.

### 7. Canonical project control remains explicit

Open source does not make product direction consensus-driven. The canonical
repository remains operator-led:

- roadmap-gated contributions;
- owned modules and CODEOWNERS;
- design-locked product surfaces;
- public architecture and acceptance contracts;
- agent-assisted pre-review;
- signed official releases and Exawatt-controlled trademarks.

Forks are free to diverge under the license. They do not redefine the Exawatt
roadmap, official product, compatibility version, or release channel.

## Consequences

- The public project becomes a real daily-development home, not a periodically
  exported mirror.
- The current private repo keeps its valuable history and continues as company
  infrastructure without exposing private evidence.
- Community builds make zero Exawatt network calls by default; the present
  hard-coded hosted defaults must move behind the official distribution
  boundary before publication.
- The public application is harder to absorb into a closed proprietary fork
  than an MIT or Apache application, while the compatibility specification is
  deliberately easy to implement elsewhere.
- A commercial fork that complies with AGPL remains legally possible. Brand,
  hosted-service access, canonical governance, and operational quality are
  separate control surfaces.
- Contributor CLA completion becomes part of the PR gate.

## Alternatives rejected

- **MIT or Apache for the application.** Excellent for code reuse; permits the
  exact closed proprietary extraction the operator does not want.
- **MPL-2.0.** File-level share-back permits a proprietary surrounding product
  too easily for this application boundary.
- **GPLv3 without AGPL.** Protects distributed desktop forks but leaves a
  modified hosted interface available without a network source offer.
- **FSL, BSL, or another competition-restricting source-available license.**
  Can prohibit competing offerings, but conflicts with the stated goal to
  genuinely open-source Exawatt for distribution and community.
- **Public repo as a mirror of private daily development.** External
  contributors work against delayed state and cannot participate in the real
  engineering loop.
- **Public repo depending on private packages or CI.** Makes the advertised
  open client non-reproducible and turns private access into an undeclared
  contribution prerequisite.
