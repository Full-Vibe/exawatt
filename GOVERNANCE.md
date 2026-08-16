# Exawatt Governance

**TL;DR: Exawatt is an operator-led open-source project with public product decisions, owned modules, and evidence-gated contributions.**

This document defines how the canonical Exawatt project makes product and
engineering decisions. The source is open and forks may diverge under the
license; that freedom does not make the canonical roadmap or official
distribution consensus-controlled.

## Roles

### Project Lead

The Project Lead has final responsibility for product direction, roadmap
priority, canonical concepts, architecture, design locks, maintainer
appointments, release designation, and trademark permissions. The current
Project Lead is [@JakeSc](https://github.com/JakeSc).

The Project Lead may delegate authority to maintainers or module owners and may
appoint a successor in a public repository record.

### Maintainers

Maintainers review and land changes within delegated scope, keep public canon
aligned with behavior, protect security and licensing boundaries, and apply
the Code of Conduct. Maintainer status is earned through sustained, high-quality
work and is appointed or removed by the Project Lead.

### Module owners

`CODEOWNERS` records the people whose review is required for sensitive modules
and design-locked areas. Ownership is stewardship, not personal possession.
Module owners are expected to explain acceptance criteria, review promptly,
and keep tests and documentation healthy.

### Contributors

Anyone acting under the Code of Conduct may report problems, propose outcomes,
join Discussions, or submit pull requests. Contributors do not need private
access or an Exawatt account.

## Decision model

Product behavior, public architecture, compatibility contracts, and the
engineering decisions needed to contribute are decided in public. Business
operations, commercial evidence, private hosted-service implementation,
credentials, and official signing custody are outside this project's
governance.

The canonical decision path is:

1. A public issue or Discussion states the user problem and desired outcome.
2. Material work is accepted into `docs/engineering/roadmap.md` under a stable
   roadmap ID, with scope, sequence, links, and exit criteria.
3. Durable tradeoffs are recorded in `docs/engineering/decisions/`.
4. A pull request implements one cohesive slice and supplies test and runtime
   evidence.
5. The responsible owner reviews it; the Project Lead resolves unresolved
   product or architectural disagreements.

Later decisions may supersede earlier ones, but the roadmap Amendment chain
must say so explicitly. A merged implementation does not silently rewrite the
product contract.

Small defects, tests, and documentation corrections may use an accepted issue
without a new roadmap milestone. Large refactors need an explicit outcome and
boundary before implementation.

## Design and architecture authority

Information architecture, canonical vocabulary, design-system primitives, and
major product surfaces are design-locked. Proposals begin with a public design
issue; implementation begins after acceptance. The live contracts are:

- `docs/product/concepts.md` for product vocabulary;
- `docs/engineering/design-system.md` for visual and interaction rules;
- `docs/engineering/architecture.md` and `/architecture` for runtime structure;
- `docs/engineering/roadmap.md` for executable priority and sequence.

Demo Mode remains first-class and uses the same UI and command layers through
a lower data-source boundary. New Agent Sources and hosted capabilities must
remain source-agnostic and preserve community operation without Exawatt
services.

## Write and review policy

External contributors submit pull requests. The Project Lead and authorized
maintainer agents may push through the direct landing queue so daily product
work remains fast. Direct write access does not waive tests, evidence,
licensing, security, or documentation requirements.

Pull requests require the relevant `CODEOWNERS` review. CLA completion, CI,
and required runtime gates must be green before an external contribution is
merged. A maintainer may reject a change that passes CI when it conflicts with
the roadmap, degrades the user experience, weakens architecture, or creates
unfunded maintenance cost.

Official releases are artifacts signed and published by Full Vibe AI. Source
availability, merge rights, and the right to call a binary official are
separate concerns; see [`TRADEMARKS.md`](TRADEMARKS.md).

## Changes to governance

Governance changes use a public pull request with rationale and an explicit
decision record. The Project Lead approves them. Changes to the CLA, license
boundary, or trademark policy also require an updated durable decision record.

Security reports and conduct cases are handled privately under
[`SECURITY.md`](SECURITY.md) and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
