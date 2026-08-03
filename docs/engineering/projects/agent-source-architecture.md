# Unified Agent Source architecture (ENG-003)

Execution detail for roadmap item ENG-003. This document is not a roadmap; the
sequence, status, and exit criteria live in `docs/engineering/roadmap.md`.

Related canon: decision `0016` (provider-first agency control), decision `0027`
(model freedom through harness plurality), `docs/product/concepts.md`
(Agent Source / Harness, Launch Configuration).

## S2 — the `opencode` adapter

Status: shaped 2026-08-03 (operator design pass), not started.

`opencode` is Exawatt's third launchable Agent Source and the engine through
which non-Anthropic, non-OpenAI, and local models reach a Session. Decision
`0027` records why this, rather than credential injection into Claude Code.

### Observed CLI surface

Measured against the installed `opencode 1.3.4` on the operator's machine
(2026-08-03), which is already authenticated against three providers:

| Exawatt need               | `opencode` mechanism                                     |
| -------------------------- | -------------------------------------------------------- |
| interactive launch         | `opencode [project]` (TUI); `--prompt` seeds the first turn |
| initial task               | `--prompt <text>` / `opencode run <message>`              |
| model selection            | `-m provider/model`                                       |
| effort selection           | `--variant <high\|max\|minimal\|…>` (provider-specific)   |
| exact resume               | `-s <sessionID>` (`--fork` to branch instead of continue) |
| catalog discovery          | `opencode models [provider]` — one `provider/model` per line |
| provider/auth truth        | `opencode providers` (alias `auth`) — credential list      |
| permissions                | `permission` map in a config document: `allow` / `ask` / `deny` per action, last match wins |
| per-launch config          | `OPENCODE_CONFIG` env pointing at a config file; `OPENCODE_CONFIG_DIR` for agents/commands/modes/plugins |
| named worker               | `--agent <name>`, `opencode agent list` / `create`        |
| version                    | `opencode --version`                                      |
| headless / protocol        | `opencode serve`, `opencode acp`, `--format json`         |

`--agent` is the pre-existing hook for ENG-028 Agent Types: a Type that
declares an `opencode` requirement can be satisfied by a real mechanism rather
than a simulated one.

### Verify before building — these are assumptions, not facts

1. **Does `OPENCODE_CONFIG` merge with or replace the user's config?** Claude
   Code's `--settings` was verified to MERGE (ENG-023 D1), which is what makes
   per-launch injection safe for users who are not the operator. If `opencode`
   replaces, per-launch permission control must be achieved another way and the
   injection must not silently discard the operator's own providers, agents, and
   MCP servers. **Nothing ships until this is measured, both directions.**
2. **Is `opencode models` output stable and machine-parseable across
   providers?** It is currently `provider/model` per line with no metadata; the
   catalog contract needs display names, descriptions, and supported variants.
   Determine whether a richer form exists (`--format json`, the `serve` HTTP
   surface, or the models.dev catalog it reads) before parsing text.
3. **Which variants does a given model actually accept?** `--variant` is
   documented as provider-specific. Exawatt's effort picker must offer only what
   the source will accept, or offer nothing and say so — never a list that
   produces a launch failure.
4. **Does a fresh session id exist before launch, or only after?** Claude Code
   allocates (`allocatesFreshSessionId: true`), Codex does not. Determine
   `opencode`'s behaviour; ENG-018's exact-resume contract depends on it and
   `--continue`/recency-based attachment is forbidden.
5. **Does `opencode` report delegation?** Until verified end-to-end it declares
   `delegation: { observable: false, reason: … }`, exactly as Codex does. An
   absent affordance, never an empty one.
6. **What does authentication status look like when it is missing or expired?**
   The registry's `action-required` state needs an observable fact, not an
   inference from a failed launch.
7. **Provider naming.** `opencode` reported `Provider not found: openrouter`
   before OpenRouter is configured. The registry must distinguish "this source
   is ready but that provider is not configured" from "this source is not
   ready" — they are different facts with different recoveries.

### Implementation shape

The adapter seam already exists and is the whole point of ENG-003 S1/S1.1. The
work is filling it out, not extending it:

- `contracts/agent-sources.json` gains an `opencode` source declaration
  (adapterId, label, connection name, colour, install guide URL, capabilities);
  `pnpm agent-sources:generate` regenerates the shared declarations. **Do not
  hand-edit the generated file.**
- `electron/main/pty/harness-registry.ts` gains a descriptor:
  `permissionFlags` (via the injected config document rather than argv, if S2's
  verification allows), `modelInvocation` (`-m`), `effortInvocation`
  (`--variant`), `resumeInvocation` (`-s`), `freshInvocation`, and no
  `eventChannel` until delegation reporting is verified.
- `electron/main/pty/agent-models.ts` gains `listOpencodeModels`, following the
  Codex path: read what the source reports, cache with provenance and
  freshness, fall back to the exact configured value, and never invent rows.
- `electron/main/pty/agent-source-registry.ts` gains `inspectOpencode`, keeping
  installation / reachability / authentication / identity / compatibility /
  model-discovery as the six independent facts the existing sources maintain.
- Renderer: `AGENT_SOURCE_META`, `HARNESS_META`, `HarnessGlyph`, and the ⌘K
  launch rows are already registry-derived or single-file; the third source is
  the forcing function that proves it. Any surface found hardcoding two sources
  is a defect this milestone fixes.

### Boundaries

- Exawatt never receives, stores, or forwards a provider key. Sign-in is the
  source's own flow, launched and rechecked exactly as Claude Code's and
  Codex's are.
- Exawatt never mutates the user's `~/.config/opencode/opencode.json`, the same
  way it never mutates `~/.claude` or `~/.codex`. Per-launch documents live in
  Exawatt's own state directory and are inspectable.
- A model catalog is runtime evidence with provenance, never a product
  constant. No hardcoded list of open models ships in this repo.

## S3 — provider and model plurality as observed truth

Status: shaped 2026-08-03, follows S2.

S2 makes one multi-provider source launchable. S3 makes the *provider* legible
without making it a second product boundary.

- A provider is a fact a source reports about itself — configured or not,
  reachable or not, local or remote — carried through the same declaration
  contract as every other source fact. It is not an entity Exawatt connects to.
- **Model choice at scale.** With hundreds of reachable models, the flat
  `Select` that serves six Claude rows stops working. The picker becomes
  searchable and grouped by provider, with the operator's own recent and pinned
  models first; this is the model axis of the Launch Configuration editor
  (decision `0028`), not a separate surface.
- **Local inference gets a distinct readout, not a distinct path.** A provider
  whose endpoint is on this machine is marked as such — nothing leaves the
  machine, no billed dollars, and ENG-008's watts rung is the honest unit rather
  than an aspirational one. Per the operator (2026-08-03) the near-term job is
  the *UI that shows the app supports this*, under the ENG-026 readiness
  grammar; running local inference is not itself a near-term requirement.
- Exit posture is unchanged from ENG-003's existing criteria: every displayed
  catalog or effective model has a named source or an explicit unknown, and a
  supported-but-unconfigured provider is visibly different from a broken one.

## Open questions carried forward

- Whether a vendor-published Anthropic-compatible endpoint (Moonshot's is the
  concrete candidate) ever earns a named exception to decision `0027`. It would
  be an amendment with evidence, not an unwritten loophole.
- Whether `opencode`'s ACP / `serve` surface is a better long-term integration
  than a PTY, and what that would mean for a product whose current terminal
  regime is deliberately a real terminal. Not a near-term question; recorded so
  it is not rediscovered.
- How a Launch Configuration that names an unavailable provider degrades. The
  ENG-028 rule — Types declare what they require, sources declare what they can
  do — is the frame; an under-capable launch must show what is missing rather
  than silently substituting.
