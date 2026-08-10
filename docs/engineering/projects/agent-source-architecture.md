# Unified Agent Source architecture (ENG-003)

Execution detail for roadmap item ENG-003. This document is not a roadmap; the
sequence, status, and exit criteria live in `docs/engineering/roadmap.md`.

Related canon: decision `0016` (provider-first agency control), decision `0027`
(model freedom through harness plurality), `docs/product/concepts.md`
(Agent Source / Harness, Launch Configuration).

## S2 — the `opencode` adapter

Status: landed 2026-08-03.

`opencode` is Exawatt's third launchable Agent Source and the engine through
which non-Anthropic, non-OpenAI, and local models reach a Session. Decision
`0027` records why this, rather than credential injection into Claude Code.

### Observed CLI surface

Measured against the installed `opencode 1.3.4` on the operator's machine
(2026-08-03), which is already authenticated against three providers:

| Exawatt need        | `opencode` 1.3.4 mechanism                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| interactive launch  | `opencode --agent <unique-launch-agent>`; `--prompt` seeds the first turn                                          |
| initial task        | `--prompt <text>` / `opencode run <message>`                                                                       |
| model selection     | launch-agent `model: provider/model` (`-m` also exists)                                                            |
| effort selection    | launch-agent `variant: <exact catalog key>`; root TUI does **not** accept `--variant`                              |
| exact resume        | `-s <sessionID>` (`--fork` branches instead of continuing)                                                         |
| catalog discovery   | `opencode models --verbose`: `provider/model` plus a JSON record                                                   |
| provider/auth truth | `opencode auth list` reports credential presence; `serve --pure` `/provider` distinguishes supported and connected |
| permissions         | ordered `permission` map on the unique launch agent; last matching rule wins                                       |
| per-launch config   | guarded `OPENCODE_CONFIG_CONTENT` containing only that unique agent                                                |
| named worker        | `--agent <name>`, `opencode agent list` / `create`                                                                 |
| version             | `opencode --version`                                                                                               |
| headless / protocol | `opencode serve`, `opencode acp`, `--format json`                                                                  |

`--agent` is the pre-existing hook for ENG-028 Agent Types: a Type that
declares an `opencode` requirement can be satisfied by a real mechanism rather
than a simulated one.

### Verification gate — measured before adapter work

All seven assumptions were measured against the installed `opencode 1.3.4` on
2026-08-03 before adapter code was written:

1. **The first assumption is true in one direction and false as a universal
   precedence claim.** With an ordinary global config plus a document named by
   `OPENCODE_CONFIG`, 1.3.4 deep-merged both documents: unrelated global
   provider, agent, MCP, model, and permission sentinels survived, injected
   sentinels appeared, and the named document won direct collisions. The
   reverse test then treated `OPENCODE_CONFIG` as user-owned input. Replacing
   that environment variable would necessarily discard the user's named
   document, and later project config and `OPENCODE_CONFIG_CONTENT` layers can
   override it anyway. Source inspection and a four-layer matrix measured the
   actual order as global → `OPENCODE_CONFIG` → project/config directories →
   `OPENCODE_CONFIG_CONTENT` → managed config → `OPENCODE_PERMISSION`.

   The shipping seam is therefore a collision-resistant primary agent inserted
   by `OPENCODE_CONFIG_CONTENT`, selected with `--agent`. In a matrix containing
   global config, a user-owned `OPENCODE_CONFIG`, project config, and Exawatt's
   launch agent, every unrelated model/provider/agent/MCP sentinel survived and
   the unique agent's model, variant, and ordered permission rules remained
   intact. A real interactive TUI showed that exact agent, model, and variant.
   An already-populated `OPENCODE_CONFIG_CONTENT` cannot be composed safely:
   Exawatt preserves it, marks the source degraded for launch, and refuses the
   spawn instead of replacing it. Both directions are thus answered: the
   user's global and `OPENCODE_CONFIG` documents merge and survive; the one
   later content seam Exawatt cannot merge is never overwritten.

2. **The rich CLI catalog is parseable, but has a source-specific record
   shape.** Plain `opencode models` returned 94 `provider/model` rows across the
   four currently connected providers. `opencode models --verbose` returned
   each ID followed by a pretty-printed JSON object containing name,
   `providerID`, family, costs, limits, capabilities, and variants. The adapter
   parses complete ID-plus-JSON records with hard output and row bounds. The
   richer `opencode serve --pure` `/provider` endpoint was also verified, but
   starting and owning a daemon is unnecessary for S2. A provider-filter miss
   prints `Provider not found` and, importantly, exits zero in 1.3.4, so exit
   status alone is not catalog truth.
3. **Variants are exact per-model source data.** Verbose catalog records and the
   `/provider` response agree on each model's accepted variant keys. The set
   varies by provider and model; no global list and no default variant can be
   inferred. The root 1.3.4 TUI rejects `--variant` and prints help, although
   headless commands accept it. A unique primary-agent config carrying `model`
   and `variant`, selected with `--agent`, was verified in the real TUI and is
   the interactive mechanism. Exawatt exposes only keys reported for the
   selected model and leaves effort unset when none are reported.
4. **A fresh session ID exists only after the first turn begins.** Opening the
   TUI produced no session. A first `run` event produced `ses_…`; passing that
   exact ID to `-s` resumed it, and `session list --format json` reported stable
   ID, directory, and timestamps. The adapter snapshots IDs before the first
   submitted turn, then exports each new directory-matching candidate and
   binds only the row whose first user message carries this launch's
   collision-resistant agent name. That source-owned marker proves causality
   even when other OpenCode sessions start concurrently. The ID is persisted
   and resumed only with `-s`; recency, `--continue`, and nearest-timestamp
   guesses are never used as identity.
5. **Delegation is observable headlessly but not through the interactive PTY
   contract.** A real Task-tool run emitted a child `sessionId` in JSON tool
   metadata. The TUI PTY exposes no structured event channel, so the S2
   declaration remains `observable: false` with the explicit reason “OpenCode
   PTY does not report delegated work.” No empty delegation affordance ships.
6. **Credential presence is observable; credential validity is not.** The real
   `auth list` reported three source-owned credentials without their values; an
   isolated profile reported zero while a built-in zero-cost model still ran.
   An isolated invalid Anthropic credential was listed as present, and its
   request failed with a 401 event while the CLI process still exited zero.
   The registry may report credential presence and launch source-owned auth,
   but it does not claim validity or infer expiry/action-required from the list.
7. **Supported and connected providers are distinct facts.** The verified
   `/provider` response separated 178 supported providers in `all` from the
   four currently `connected`; OpenRouter was supported but unconnected.
   `opencode models` reports the connected/built-in catalog, and an
   unconfigured provider filter is not a source-readiness failure. S2 preserves
   source-reported `provider/model` IDs; S3 owns the full supported-versus-
   connected provider readout.

### Implementation shape

The adapter seam already exists and is the whole point of ENG-003 S1/S1.1. The
work is filling it out, not extending it:

- `contracts/agent-sources.json` gains an `opencode` source declaration
  (adapterId, label, connection name, colour, install guide URL, capabilities);
  `pnpm agent-sources:generate` regenerates the shared declarations. **Do not
  hand-edit the generated file.**
- `electron/main/pty/harness-registry.ts` owns a per-launch-agent binding. It
  emits a unique primary agent carrying model, exact variant, and an ordered
  permission map, injects it through guarded `OPENCODE_CONFIG_CONTENT`, and
  selects it with `--agent`; exact resume adds `-s`. No event channel is
  declared because delegation reporting is not observable through the PTY.
- `electron/main/pty/agent-models.ts` gains `listOpencodeModels`, following the
  Codex path: read what the source reports, cache with provenance and
  freshness, and never invent rows. The shaped fallback-to-config assumption
  was amended after verification: `opencode debug config` emits the full
  resolved document and may include provider settings, so Exawatt does not read
  it merely to recover a model. When catalog discovery fails, the result is an
  explicit source-default/unknown state rather than a fabricated row.
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
  way it never mutates `~/.claude` or `~/.codex`. The small per-launch agent is
  process-scoped, contains no provider credential, and is not persisted by
  Exawatt. An occupied user `OPENCODE_CONFIG_CONTENT` value is preserved and
  blocks launch rather than being replaced.
- A model catalog is runtime evidence with provenance, never a product
  constant. No hardcoded list of open models ships in this repo.

### Roadmap milestone log

#### 2026-08-03 — S2 landed

- Passed the seven-item pre-build verification gate against installed OpenCode
  1.3.4. Bidirectional config testing corrected the original assumption:
  `OPENCODE_CONFIG` merges but is not the final layer, while a guarded unique
  agent in `OPENCODE_CONFIG_CONTENT` preserves both global and user-named
  config; an occupied content seam fails closed.
- Added OpenCode to the generated Agent Source declaration, runtime registry,
  Settings, composer, native/palette launch paths, live verbose model catalog,
  exact interactive effort variants, per-launch agent/permission config,
  native recent-session rows, source-marker-proven post-first-turn exact
  session binding, and `-s` resume. Successful catalog observations carry a
  five-minute context-keyed cache with original freshness/provenance; failures
  remain immediately retryable.
- Kept provider credentials source-owned and delegation explicitly unavailable
  at the PTY boundary. Provider plurality UI remains S3.

## S3 — provider and model plurality as observed truth

Status: shaped 2026-08-03, follows S2.

S2 makes one multi-provider source launchable. S3 makes the _provider_ legible
without making it a second product boundary.

- A provider is a fact a source reports about itself — configured or not,
  reachable or not, local or remote — carried through the same declaration
  contract as every other source fact. It is not an entity Exawatt connects to.
- **Model choice at scale.** With hundreds of reachable models, the flat
  `Select` that serves six Claude rows stops working. The picker becomes
  searchable and grouped by provider, with the operator's own recent and pinned
  models first; this is the model choice inside the Launch Configuration
  ribbon's quiet Customize disclosure (decision `0028`), not a separate
  surface. This scalable picker lands before the ribbon reaches the production
  composer or as D46's first implementation slice.
- **Local inference gets a distinct readout, not a distinct path.** A provider
  whose endpoint is on this machine is marked as such — nothing leaves the
  machine, no billed dollars, and ENG-008's watts rung is the honest unit rather
  than an aspirational one. Per the operator (2026-08-03) the near-term job is
  the _UI that shows the app supports this_, under the ENG-026 readiness
  grammar; running local inference is not itself a near-term requirement.
- Exit posture is unchanged from ENG-003's existing criteria: every displayed
  catalog or effective model has a named source or an explicit unknown, and a
  supported-but-unconfigured provider is visibly different from a broken one.

## Demand evidence

- 2026-08-10 (triage, feedback row `b813c1b0-0673-41e1-8e13-1e3905ee736d`,
  operator): "Support for Hermes, Kilo Code, and Gemini coding agents." Three
  more named sources for the registry's queue. No scope shaped here; each
  candidate goes through the same S2-style adapter evaluation (local record
  truth, capability declaration, decision `0027` endpoint rules) when its
  turn comes.

## Open questions carried forward

- Whether a vendor-published Anthropic-compatible endpoint (Moonshot's is the
  concrete candidate) ever earns a named exception to decision `0027`. It would
  be an amendment with evidence, not an unwritten loophole.
- Whether `opencode`'s ACP / `serve` surface is a better long-term integration
  than a PTY, and what that would mean for a product whose current terminal
  regime is deliberately a real terminal. Not a near-term question; recorded so
  it is not rediscovered.
- Resolved by D46's operator-confirmed lightweight-launcher contract: a Launch
  Configuration whose provider, source, model, or requirement becomes
  unavailable stays discoverable and selectable for inspection, names the
  missing fact, and disables launch. It never disappears or silently
  substitutes another value. The ENG-028 rule — Types declare what they
  require, sources declare what they can do — remains the capability frame.
