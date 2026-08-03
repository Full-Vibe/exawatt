# 0016 Provider-first agency control and source-owned identity

Date: 2026-07-21
Status: accepted architectural direction; evidence and Approval defaults remain
open

## Context

Exawatt must help people understand and trust Agents that can affect files,
networks, email, messages, payments, deployments, credentials, and other parts
of the real world. The same product must span current local Claude Code and
Codex Sessions, future hosted and custom harnesses, Demo Mode, and eventually
thousands of Agents operating inside managed Workspaces.

The near-term app does not own those downstream integrations or their complete
security boundaries. Harness manufacturers provide their approval, sandbox,
tool, and execution models, and users choose the posture appropriate to each
source. Building parallel email, payment, messaging, network, or native
monitoring systems now would outrun Exawatt's current product milestone and
could conflict with the harness actually executing the work.

At the same time, treating a provider's self-reported activity as an Exawatt
safety guarantee would make future governance brittle. Exawatt needs one honest
contract that works when it is merely observing a source and when it later
mediates or enforces an action itself.

Primary evidence reviewed:

- [NIST's 2026 agent identity and authorization concept paper](https://csrc.nist.gov/pubs/other/2026/02/05/accelerating-the-adoption-of-software-and-ai-agent/ipd)
  frames agent identity, authorization, auditing, non-repudiation, tool access,
  and prompt-injection controls as linked problems.
- [NIST SP 800-207](https://csrc.nist.gov/pubs/sp/800/207/final) separates
  policy decisions from enforcement and rejects implicit trust based only on
  location or ownership.
- [Model Context Protocol security principles](https://modelcontextprotocol.io/specification/2025-03-26/index#security-and-trust-safety)
  require clear user control while acknowledging that the protocol cannot
  enforce every principle itself and that tool descriptions may be untrusted.
- [A2A Agent Discovery](https://a2a-protocol.org/latest/topics/agent-discovery/)
  separates advertised identity, capabilities, authentication, and skills;
  capability discovery is not authorization.
- [OpenTelemetry's convention guidance](https://opentelemetry.io/docs/specs/semconv/how-to-write-conventions/)
  distinguishes logical calls from physical attempts and recommends opt-in for
  sensitive or verbose attributes.
- [Open Policy Agent decision logs](https://www.openpolicyagent.org/docs/management-decision-logs)
  demonstrate traceable policy decisions with explicit masking and erasure of
  sensitive fields.

## Decision

- Agency control is a cross-cutting architectural spine through existing
  Events, Decisions, Approvals, Policies/Budgets, Artifacts, Consumption,
  Secrets/Credentials, and Agent Source adapters. It is not a fourth layer or a
  separate roadmap project.
- Near term, Exawatt is provider-secured. The Agent Source / Harness and any
  user-chosen security system own enforcement. Exawatt translates visible
  launch preferences and normalizes the activity and evidence a source exposes;
  it does not claim to independently sandbox or verify every downstream action.
- Normalized activity distinguishes declared intent, proposed action, policy or
  Approval result, attempted action, real-world effect, and supporting evidence
  when available. It independently identifies what was reported, observed,
  authorized, enforced, and verified. Missing facets remain unknown.
- Source capability is not authority. Adapters advertise supported commands,
  policy modes, activity, evidence, and enforcement ownership without implying
  that advertised capability grants permission or proves an outcome.
- Agent Source identity and authentication remain provider-owned whenever the
  local harness owns them. Exawatt may invoke the source's supported sign-in
  flow and observe its minimum status/identity output, but it does not ingest
  Claude Code or Codex account tokens. Remote Gateway and custom-source
  credentials are a narrower connection concern and may use the operating
  system keychain; this does not pull ENG-009's general Agent credential broker
  into the current slice.
- Source readiness is not one boolean. Adapters preserve installation,
  reachability, authentication, identity, version compatibility, capability,
  freshness, and provenance as independent facts, then derive a compact UI
  state from them.
- Source catalogs are runtime evidence, not product constants. Exawatt uses a
  supported machine-readable discovery contract when one exists, caches it
  with provenance and freshness, and otherwise presents only the exact
  configured value or account default the source can substantiate. Native
  source UI remains the fallback for account-aware choices that the source
  cannot expose programmatically.
- Demo Scenario Sources use the same contracts and label their provenance as
  simulated. They never imply that a real-world effect occurred.
- Exawatt does not build first-party email, payment, messaging, general network,
  or comparable action integrations as part of the current source work.
- The contracts preserve a future seam for Exawatt to become a Harness or
  compose with policy engines, credential brokers, restricted execution
  environments, network controls, and typed action providers. These may add
  actual enforcement or verification without replacing the canonical model.
- A future managed Workspace can impose absolute ceilings. Personal Agent and
  Session settings, including YOLO, may request less authority but cannot bypass
  those ceilings. A source that cannot honor the effective policy must fail
  visibly rather than execute with broader authority.
- The approval unit remains open under ENG-006: one action, a policy-bounded
  class of actions, and a bounded Session mandate are hypotheses to test.
- The evidence-retention default remains open under ENG-003. The design must
  separate low-detail structured activity from sensitive arguments, content,
  results, and secret values rather than equating observability with recording
  everything.

## Open design examples

The evidence-retention decision is concrete:

- A redacted metadata record might say: `Agent A`, `mail.send`, one recipient
  omitted, harness-reported success, Ask first policy, approved by the operator,
  with timestamps and a source event ID. It would not retain the recipient,
  subject, body, OAuth token, or tool result.
- Detailed local evidence might additionally retain the exact recipient,
  subject/body, tool arguments and result, command and file path, URL or network
  destination, message text, payment memo, or resulting diff. That is much more
  useful for investigation and replay, but can contain private communications,
  customer data, and other sensitive content.
- An entirely opt-in model would show source activity live but persist neither
  category until the user enables a Workspace or source retention setting.

The future "higher-assurance runtime" seam also has a concrete meaning. Instead
of launching a harness with the user's ordinary process authority and trusting
its report, Exawatt could one day route selected work through a credential
broker, an OS/container/VM restriction, a network proxy, or a managed remote
runner that can actually deny disallowed effects. Whether that becomes an
optional tier, and whether the ordinary desktop app stays lightweight, remain
open implementation choices rather than current commitments.

## Roadmap ownership

This decision amends existing work rather than adding another plan:

- ENG-003 owns source capability, activity, evidence, and assurance contracts.
- ENG-006 owns Approval scope and durable trust/audit decisions.
- ENG-008 owns Policy/Budget hierarchy and managed ceilings.
- ENG-009 owns the future credential-mediation seam.
- ENG-011 and ENG-012 own mixed-trust fleets and managed Workspace governance.
- ENG-013 consumes the resulting provenance and policy when orchestrating work.

## Consequences

- Today's UI can be useful without pretending Exawatt is the enforcement point.
- Sources with sparse telemetry remain compatible, but the UI must show their
  lower assurance instead of silently filling gaps.
- The same source type may have multiple configured instances without changing
  the Agent Source abstraction or teaching product surfaces provider-specific
  account rules.
- Settings can explain and repair source availability without becoming the
  credential owner for source-managed accounts.
- Later enforcement can be introduced incrementally behind the same adapter and
  Coordination contracts.
- "Safe" is not a single badge. Product surfaces should explain the relevant
  assurance facets and the named system responsible for each.
- Detailed evidence can materially improve debugging and auditability while
  also containing private communications, tool arguments, or customer data; a
  retention default requires explicit product validation before implementation.
