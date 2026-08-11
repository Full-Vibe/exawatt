<!-- Generated for the public repository by the "public-document-set" recipe. -->
# 0031 Default-on PostHog and configurable hosted enrichment

Date: 2026-08-03
Status: accepted — implemented by ENG-030 OS1 for official distributions;
community-build scope amended by decision `0036`

Amended 2026-08-10 by decision `0036`: the controls and disclosure contract
below remain binding for official Exawatt distributions, but production builds
made from the public repository no longer default to Exawatt analytics or
Exawatt-hosted enrichment. Community builds are service-neutral and make no
Exawatt network calls unless a distributor supplies its own compatible
configuration. The earlier official-and-OSS default is superseded.

## Context

The pre-open-source audit found no general product analytics, an explicit
opt-in aggregate publisher for public Operator profiles, and two different
classes of outbound behavior that should not be conflated:

- ordinary product analytics, which the open-source client currently lacks;
- Exawatt-hosted context-label and goal-visual endpoints, which process bounded
  product content to provide product features rather than analytics.

The operator initially said: “Have PH on by default in OSS / production builds,
configurable off (just like Supabase or npm) — kill the proprietary hosted
thing, that's too much.” The first promotion interpreted this as requiring
removal of Exawatt-hosted enrichment. The operator clarified that removal is
not required: OSS users may opt into the hosted features, or receive them by
default, and benefit from them.

The binding objection is therefore an opaque, mandatory proprietary dependency,
not the existence of a useful hosted service. Open source does not require zero
network behavior. It requires behavior that is legible in the source, narrowly
scoped, independently controllable, and nonessential to core operation.

## Decision

### Product analytics

Official production distributions and production builds from the open-source
repository initialize PostHog by default. Development and test behavior remains
separately configurable.

The implementation must be open-source legible:

- one public, versioned event allowlist; no DOM autocapture, session replay,
  prompt/response capture, terminal content, source code, repository/Project
  names, paths, filenames, diffs, task text, credentials, environment values,
  or raw source/Session identifiers;
- a documented runtime opt-out and build/environment switch that suppresses
  initialization and emission, not merely dashboard ingestion;
- configurable PostHog host and project key so a distributor can disable,
  redirect, or self-host the sink without patching product code;
- anonymous installation identity stays distinct from account identity unless
  a later, disclosed decision explicitly joins them;
- the repository carries the exact outbound-data manifest, defaults, retention
  assumptions, and verification method.

This analytics stream is not the public Operator profile. Decision `0029`'s
explicit preview-and-publish consent, content exclusions, and disable/delete
contract remain intact for public identity and Run aggregates. Product feedback
also remains an intentional user submission rather than an analytics event.

### Hosted feature processing

Exawatt may continue to provide hosted context labels, conversation enrichment,
and goal visuals to official and open-source clients. These services may be
opt-in or default-on; ENG-030 OS1 must resolve that product choice explicitly
rather than inheriting today's behavior by accident.

Whichever default is chosen, the boundary must be open-source legible:

- disclose the exact destination, input classes, purpose, default, and retention
  behavior separately from product analytics;
- provide an independent user control that prevents hosted feature calls, plus
  a distributor/build configuration for disabling or replacing the endpoint;
- keep hosted failure non-blocking and retain a deterministic local fallback so
  ordinary Agent operation and Demo Mode remain useful without an Exawatt
  account or backend;
- do not treat PostHog consent or configuration as consent for feature content
  processing.

Decision `0019`'s durable technical properties remain: bounded evidence,
structured results, stale-response rejection, last-good state, and no competing
inference paths with ambiguous authority. Its Exawatt-hosted implementation is
allowed to remain if OS1 makes the boundary explicit and controllable.

## Consequences

- ENG-030 OS1 is a gate for the first public open-source release, not a request
  to implement analytics or replace enrichment during this documentation
  promotion.
- The current hosted endpoints do not need to be removed merely because the
  client becomes open source.
- The Privacy page must be reconciled to the actual analytics and hosted-feature
  boundaries before release.
- Adding an analytics event requires changing the public allowlist and tests;
  installing PostHog does not authorize arbitrary capture.
- Official builds gain default aggregate adoption/product signals while users
  and downstream distributors retain a real off switch.
- OSS trust comes from legibility, independent controls, and graceful fallback,
  not from pretending the product has no hosted services.

## Alternatives considered

- **No analytics.** Rejected: the operator wants the open and official clients
  to produce ordinary aggregate product feedback by default.
- **Opt-in product analytics.** Rejected for the general PostHog stream. It
  remains the policy for publishing public Operator identity and Run records.
- **PostHog autocapture/session replay.** Rejected: easy collection is not worth
  making the OSS boundary impossible to explain or audit.
- **Mandatory or opaque hosted enrichment.** Rejected: a closed dependency that
  cannot be understood, disabled, or survived would undermine OSS trust.
- **Remove Exawatt-hosted enrichment.** Rejected: OSS users can benefit from the
  service when its boundary and controls are honest. Whether the feature is
  default-on or opt-in remains an explicit OS1 design choice.
