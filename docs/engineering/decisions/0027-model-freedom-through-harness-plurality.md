# 0027 Model freedom arrives through harness plurality, not credential injection

Date: 2026-08-03
Status: accepted

## Context

Exawatt's product canon says it commands Agents "from any compatible source",
but the two launchable sources are Claude Code and Codex, and each runs exactly
one vendor's models. An operator who wants Kimi K3, GLM, DeepSeek, Qwen, or a
model on his own machine has no path through Exawatt at all.

The operator named four motives on 2026-08-03, all of them accepted:

1. **cheaper daily driving** — run real work on an open model, escalate to Opus
   when it matters;
2. **escaping rate limits** — a one-gesture way to keep working when a plan
   window closes mid-task;
3. **product credibility** — a demo in which only Claude and Codex appear
   contradicts the source-agnostic thesis the whole product rests on;
4. **local/private inference** — LM Studio and Ollama are already on his
   machine; "nothing leaves this machine" is a real posture, not a hypothetical.

Two mechanisms were researched against the installed CLIs and the current
vendor documentation.

**Credential injection into a single-vendor harness.** Claude Code routes to any
Anthropic-Messages gateway through `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`
(with `ANTHROPIC_API_KEY` explicitly empty), and
`CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` populates its `/model` picker
from the gateway's `/v1/models`. This is genuinely cheap: Exawatt's PTY spawn
already composes an env, and `agent-models.ts` already reads the resulting
catalog through the SDK `initialize` control response, so a Kimi or OpenRouter
session would flow through the existing composer with no catalog work at all.
Codex has the analogous seam through `model_providers` in `config.toml`.

**A harness that is multi-provider by design.** `opencode` 1.3.4 is already
installed and authenticated on the operator's machine against three providers.
Its CLI surface maps almost one-to-one onto Exawatt's existing harness
descriptor: model and exact variant on a named primary agent selected with
`--agent`, `-s <id>` for exact resume, `--prompt` for an initial task, and
`opencode models --verbose` for parseable catalog discovery. S2's pre-build
measurement corrected the initial assumption that root-TUI `--variant` and an
Exawatt-owned `OPENCODE_CONFIG` document were safe universal seams; the
implementation amendment below records the measured mechanism.

## Decision

**Exawatt gains models by adding harnesses that are multi-provider by design,
not by injecting provider credentials into single-vendor harnesses.**

- `opencode` becomes Exawatt's third launchable Agent Source (ENG-003 S2). It
  is the engine through which OpenRouter, Moonshot/Kimi, and local LM Studio /
  Ollama models reach a Session.
- Authentication stays **source-owned**, exactly as it is for Claude Code and
  Codex. The operator runs the source's own sign-in once; Exawatt observes
  readiness and never receives, stores, or forwards a provider key. ENG-003's
  exit criterion "no local provider token is stored by Exawatt" survives this
  change verbatim, and decision `0016`'s provider-first boundary is unamended.
- A provider is therefore never a thing Exawatt connects to. It is a fact a
  source reports about itself, carried through the same declaration/capability
  contract that already distinguishes installed, reachable, authenticated,
  compatible, and fresh.
- Local inference is not a special mechanism. A local provider is an ordinary
  provider whose facts happen to include "no network egress"; it earns a
  distinct _readout_, never a distinct code path.

### Why not credential injection

- Anthropic's own gateway documentation states plainly that it "doesn't support
  routing Claude Code to non-Claude models through any gateway." Shipping that
  as a product feature would make Exawatt the support surface for a
  configuration its vendor disclaims, on a harness whose request semantics are
  built around one model family.
- Codex removed `wire_api = "chat"` in February 2026. Custom providers must
  speak the OpenAI **Responses** API, so most raw open-model endpoints need a
  translating gateway in front — infrastructure Exawatt would then own.
- Injection requires Exawatt to hold and forward a provider key. That is the
  precise thing decision `0016` scoped away from the near-term product, and it
  would convert a clean observation boundary into a custody boundary in the
  service of an unsupported configuration.
- The catalog convenience is real but small, and it is not lost: `opencode
models` is a first-class discovery contract of exactly the kind ENG-003
  already prefers over inference.

### What is deliberately left open

- **A named exception may later be argued** for a vendor that publishes and
  supports an Anthropic-compatible endpoint for its own model — Moonshot's
  `https://api.moonshot.ai/anthropic` is the concrete candidate. That would be
  an amendment to this record with its own evidence, not an unwritten
  loophole. Nothing here forecloses it.
- **A robust Connections / Integrations system** for authenticating Exawatt with
  third-party vendors is accepted direction (operator, 2026-08-03) and belongs
  to ENG-009, deliberately unshaped pending its own design pass. When it exists,
  it may legitimately hold gateway credentials — decision `0016` already permits
  OS-keychain material for gateway and custom-source connections. This decision
  says only that model freedom must not wait for it, and must not be the reason
  it gets built in a hurry.

## Consequences

- ENG-003 grows S2 (the `opencode` adapter) and S3 (provider and model
  plurality as observed truth, including the local readout).
- Every surface that reads a harness must stop assuming two. `HARNESS_META`,
  `AGENT_SOURCE_ORDER`, the ⌘K launch rows, the status glyphs, and the brand
  colour set all become genuinely N-ary; a third real source is the forcing
  function that proves the abstraction the product has been claiming.
- Delegation observability is a per-source fact, not a global one. `opencode`
  ships with `delegation: { observable: false }` until its own reporting is
  verified end-to-end, exactly as Codex did — an absent affordance, never an
  empty one.
- Consumption gains a source whose spend is billed by a third party in real
  dollars. That is an opportunity (the first measured, rather than modelled,
  dollar figure in ENG-008's unit ladder) and it is deliberately sequenced
  after the launch path lands.

## Implementation amendment — 2026-08-03

Installed OpenCode 1.3.4 deep-merges a document named by `OPENCODE_CONFIG` with
the global document, but that environment variable may already belong to the
user and later project/content layers can override it. The root interactive TUI
also does not accept `--variant`.

Exawatt therefore inserts one collision-resistant primary agent through a
guarded `OPENCODE_CONFIG_CONTENT` value and selects it with `--agent`. That
agent carries the chosen `provider/model`, exact source-reported variant, and
ordered permission policy. Measurement with global, user-owned
`OPENCODE_CONFIG`, project, and launch-content layers preserved every unrelated
sentinel in both user documents. If `OPENCODE_CONFIG_CONTENT` is already set,
Exawatt preserves it and refuses launch. This amends the injection mechanism,
not the decision to gain model freedom through a multi-provider harness with
source-owned authentication.

OpenCode persists that selected agent name on the first user message. S2 uses
the collision-resistant name as a source-owned causal marker when exporting a
new session candidate, so exact resume identity never depends on recency or a
nearest-timestamp guess.
