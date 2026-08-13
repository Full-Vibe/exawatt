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

## S4 — the Grok Build adapter

Status: landed 2026-08-13. Shaped 2026-08-12 and operator-pulled during the
Grok Bot category wave (2026-08-11) so source-plurality has a fourth, timely
proof at the ENG-030 launch moment. The shaped facts below were taken from the
harness's own repository docs; the landing log at the end of this section
records what a real install confirmed, what it CORRECTED, and what remains
unverified for want of a credential. Full recon with sources in
`docs/research/market/2026-08-12-agent-fleet-market-and-grok-wave.md` §5.

**What it is, and what it is not.** Grok Build is xAI's open-source
(Apache-2.0, `github.com/xai-org/grok-build`) terminal coding agent — a
Rust/Ratatui interactive TUI, launchable per directory, v1.0.0 on 2026-08-07,
accessible on SuperGrok $30/mo, X Premium+ $40/mo, or `XAI_API_KEY`
pay-as-you-go. It is NOT Grok Bot (the $300/mo cloud "AI teammates" product),
which has no public API/CLI/SDK and is not a candidate Agent Source. Its
integration surfaces deliberately clone Claude Code's, which is why the recon
verdict is easy-to-medium — the cheapest adapter this item has evaluated.

**Why now, beyond the wave.** Grok-the-model is already launchable through S2
`opencode` (official xAI `/connect` OAuth since May 2026, plus OpenRouter), so
S4 adds the native harness — its TUI, subagents (documented ceiling: 8
concurrent, depth 1), plan mode, and on-disk record — not model access. That
also means the composer's Grok story is honest in two tiers: available today
via opencode, native harness when S4 lands.

Verified integration facts:

- **Launch**: binary `grok`; `grok --cwd <dir> -m <model> "<initial prompt>"`;
  `--resume <id>` / `-c` for continuation. Interactive TUI over PTY exactly
  like the existing three sources; hosting model unchanged.
- **Auth is source-owned**: browser OAuth into `~/.grok/auth.json` (0600,
  auto-refresh, hot-reloaded) or `grok login --device-auth`; `XAI_API_KEY`
  fallback. Exawatt never reads, stores, or refreshes the token — the
  "no local provider token is stored by Exawatt" criterion holds unchanged,
  and decision `0027` is untouched because this is a native harness, not
  provider-credential injection.
- **State home**: `~/.grok/`, overridable per-launch with `GROK_HOME` —
  per-Session isolation of injected configuration is trivial and preferred,
  mirroring how ENG-023 keeps injected Claude settings in Exawatt's own state
  directory.
- **Status truth**: hooks are deliberately Claude Code-compatible —
  `Notification` with `permission_prompt` / `idle_prompt` / `task_complete`
  matchers, blocking `Stop`/`SubagentStop` with Claude-style decision JSON,
  `PreToolUse`, and `type: "http"` hooks. The ENG-023 harness event channel's
  vocabulary maps nearly one-to-one; payloads are camelCase (Claude's are
  snake_case) and tool names differ (`run_terminal_command` vs `Bash`), so
  the adapter owns a small translation table, not a new mechanism. Delegation
  is observable (`SubagentStop`), so the capability contract declares push.
- **Consumption**: sessions persist at
  `~/.grok/sessions/<url-encoded-cwd>/<uuidv7>/` with `signals.json` (token
  usage, tool/turn counters), `summary.json` (model, timestamps, counts), and
  `updates.jsonl` (typed ACP event stream). ENG-008's scanner gains a source
  whose token totals need no transcript parsing. Path derivation must
  reproduce the harness's URL-encoding of the cwd exactly (255-byte
  slug+hash fallback case exists).
- **Headless/eval**: `grok -p --output-format streaming-messages-json` is
  byte-compatible with Claude Code's stream-json, and `grok agent` exposes a
  standard ACP JSON-RPC server — recorded as a future integration seam under
  the same open question S2 carries for `opencode serve`, not S4 scope.

Risks and unknowns to verify on a real install, before the adapter is called
done:

- model-catalog enumeration is undocumented — probe `grok inspect` JSON and
  the ACP `initialize` response; fall back to observed configuration under
  the same provenance rules as Claude's offline fallback
- Grok Build has its own worktree/fork machinery (`~/.grok/worktrees`,
  `--worktree`, `/fork`) that could fight Exawatt-managed worktrees — launch
  must not trigger it implicitly, and the eval asserts the Session works in
  the Exawatt-provided directory
- it auto-loads `~/.claude/settings.json` hooks for compatibility — verify
  whether a user's own Claude hooks cross-fire inside Exawatt-launched Grok
  sessions and, if so, disable via `[compat]` in the injected `GROK_HOME`
  config with the same inspectable-disclosure rule ENG-023 applies to
  injected Claude settings
- per-tier rate limits are undocumented; Consumption must not infer plan
  headroom (existing rule, restated because this vendor publishes none)
- trust history is part of the source's truthful description: the July 2026
  repo-exfiltration incident (fixed, then open-sourced as damage control) is
  why the adapter surfaces the harness's own privacy switches in the
  capability description rather than hiding them
- xAI's written ToS position on third-party orchestrator use of subscription
  OAuth is unpublished (behaviorally tolerated via official opencode
  integration and Superconductor); the April-2026 Anthropic precedent says
  treat subscription-backed access as revocable — the registry's degraded
  states must already tell that story honestly

Acceptance (S2's bar, restated for this source):

- Grok Build appears in Settings and the ⌘T catalog through the same
  generated declaration and registry contract; installed/not-installed/
  sign-in-required/incompatible states derive from normalized facts
- launch composes `GROK_HOME`-isolated configuration, the chosen model, and
  the Exawatt worktree; the Session reaches first prompt with TUI fidelity
- status lights ride hook events, not TUI scraping, wherever a hook exists;
  a needs-you gate (permission prompt) reads identically before and after
  tab focus, per the D4 rule
- `signals.json`-derived Consumption rows land under the source with
  provenance, absent-never-zero
- dedicated Electron eval in the S2 pattern covers launch, status truth, and
  the injected-configuration disclosure
- operator credential prerequisite recorded: a SuperGrok plan or API key on
  the dogfood machine is needed before the eval can run live

### Roadmap milestone log

#### 2026-08-13 — S4 landed, with two shaped assumptions corrected

**Grok Build launches, resumes, and reports consumption; it does not report
delegation.** Verified against a real install — `grok 1.0.3`, installed
non-interactively from npm `@xai-official/grok`, plus its open-source tree
(`github.com/xai-org/grok-build`, Apache-2.0, 25k stars) — rather than from
docs alone. What the install confirmed, what it corrected, and what could not
be exercised are kept separate below, because the difference is the whole
value of the exercise.

**Verified live on the installed binary**

- The launch surface: `--cwd`, `-m`, a positional initial prompt,
  `--permission-mode {default,acceptEdits,auto,dontAsk,bypassPermissions,plan}`,
  `--resume [id]`, `-c/--continue`, `--reasoning-effort`, and — beyond the
  shaped contract — `-s/--session-id <UUID>`, which names a NEW conversation.
  That last one upgrades identity: Exawatt allocates the session id before the
  first turn exactly as it does for Claude Code, so no post-hoc catalog
  binding (OpenCode's S2 problem) is needed at all.
- `grok models` is the only non-interactive command that reports auth state,
  and it prints the catalog in the same breath: one banner line naming the
  credential source, then `Default model:`, then the listing. It answers
  UNAUTHENTICATED with the built-in catalog, so the source is legible before
  sign-in. There is no `--json`, no per-model description, and no effort
  enumeration on this surface.
- `grok inspect --json` reports the resolved configuration, including a
  `configSources.layers` list and an `externalCompat.cells` matrix — the
  inspectable disclosure surface for everything below.
- **The Claude cross-fire risk is real.** On this machine a fresh Grok home
  still loaded `~/.claude/settings.local.json` permissions (12 rules),
  `~/.claude/hooks/guard-claude-dir.sh` as a `pre_tool_use` hook, and
  `~/.claude/Claude.md` as project instructions — each tagged
  `vendor: "claude", compatibilityStatus: "enabled"`. Setting
  `GROK_CLAUDE_HOOKS_ENABLED=0` flips them to `disabled` with `source: "env"`,
  verified through `grok inspect --json`. Exawatt deliberately does NOT set
  it: this is Grok Build's own documented, default-on compatibility feature,
  not an Exawatt-caused defect, and silently disabling a harness feature is
  the kind of surprise the injected-configuration rule exists to prevent. The
  switch is named in the capability reference so an operator who wants it off
  knows where it lives.
- `$GROK_HOME/hooks/*.json` discovery works: a document written there is
  listed by `grok inspect --json` with its event, matcher, and source.

**Verified from the harness's own source (authoritative — it is the
serializer), not from prose**

- The hook envelope is camelCase (`hookEventName`, `sessionId`, `cwd`,
  `workspaceRoot`, `permissionMode`) with event-specific fields flattened in:
  `toolName`/`toolUseId`/`toolInput`, `notificationType`, and — better than
  Claude's — `subagentId`/`subagentType`/`description` DIRECTLY on
  `SubagentStart`, so a spawn label needs no correlation staging at all.
- The tool alias table is exact: `Bash`→`run_terminal_command`,
  `Task`/`Agent`→`spawn_subagent`, `AskUserQuestion`→`ask_user_question`,
  `Read`→`read_file`, `Edit`/`Write`→`search_replace`. Matchers are exact-set
  for simple `A|B` patterns (with alias expansion) and unanchored regex
  otherwise, so Claude's anchoring workaround is unnecessary here.
- Notification types emitted: `permission_prompt`, `idle_prompt`,
  `task_complete`, `agent_error`.
- `type: "http"` hooks are **HTTPS-only** (`validate_hook_url` rejects any
  other scheme before the loopback IP allowance is even consulted) and carry
  no custom headers. The ENG-023 channel's plain-HTTP loopback listener is
  therefore unreachable from a Grok HTTP hook; a `command` hook would be the
  only shape, and it receives the envelope on stdin.

**Correction 1 — `signals.json` is not the ledger.**

The shaped scope named `signals.json` as the token record needing "no
transcript parsing". Its actual fields are `turnCount`, `toolCallCount`,
`contextTokensUsed`, `contextWindowTokens`, `totalTokensBeforeCompaction`,
`toolsUsed`, `primaryModelId` — live occupancy and counters, with no
cumulative input/output/cache totals anywhere. Reading context occupancy as
consumption would report a number that FALLS after a compaction. The billed
record is `updates.jsonl`'s `turn_completed` update, whose `usage` is a
per-prompt `PromptUsage` keyed by the harness's own `prompt_id` — a genuine
idempotency key, and a JSONL stream that fits ENG-008's existing chunked,
watermarked adapter unchanged. One normalization is load-bearing: on the ACP
wire `inputTokens` is the FULL prompt sum including both cache buckets, so
the parser subtracts them exactly as the Codex parser does.

**Correction 2 — there is no per-launch hook seam on the interactive TUI, so
delegation is declared unobservable.**

The shaped scope expected `GROK_HOME` per-Session isolation to make hook
injection "trivial". On a real install it is not, and the reason matters:
`grok_home()` is a single `OnceLock` resolving `$GROK_HOME` or `~/.grok` for
EVERYTHING — `auth.json`, `config.toml`, `sessions/`, `trusted_folders.toml`,
`hooks/`, `worktrees/`, `mcp_credentials.json`. Relocating it per Session
would sign the operator out, discard their model/MCP/tool configuration, reset
folder trust (silently disabling their project hooks and MCP servers), and
detach their session corpus from the one `grok sessions` reads. Three
alternatives were evaluated and rejected on the evidence:

1. **Write into `~/.grok/hooks/`.** Additive and visible in Grok's own Hooks
   tab, but it mutates the user's harness configuration (the rule that keeps
   Exawatt out of `~/.claude` and `~/.codex`) and would fire a loopback POST
   inside every Grok session on the machine, including ones Exawatt never
   started.
2. **`--plugin-dir <DIR>`** — the vendor's OWN per-connection injection point,
   documented as "used by the Agent SDKs", always trusted, hooks and MCP
   activate without a prompt. It exists on `grok agent` (the ACP server), not
   on the root TUI: `grok --plugin-dir …` errors with `unexpected argument`.
3. **`--agent <path>`** — a per-launch agent definition file whose frontmatter
   may carry `hooks:`, merged into the live registry at the PRIMARY session
   (not only subagents), and unconditionally allowed because a file outside
   `~/.grok/agents/` resolves to `AgentScope::BuiltIn`. Mechanically this
   works. It was rejected because supplying a definition REPLACES the
   operator's default Grok agent — its system prompt, toolset, and plan mode —
   to attach a status listener, which trades the harness's actual behavior for
   a light. No inherit-and-extend form is documented, and guessing one against
   an install that cannot be exercised end to end is exactly the move the
   fail-closed rule forbids.

So Exawatt injects nothing, and the capability declares
`observable: false` with the reason on the record. The eval asserts the
absence positively: `GROK_HOME` and `GROK_AUTH_PATH` are both `unset` inside
the launched child, and the argv carries no `--settings` and no `--agent`.
Status rides the same inference Codex and OpenCode use. ENG-015's
`teamWorkingWithoutGate` rule is untouched and now has a case pinning that a
source with no reported record keeps ordinary bell behavior.

**Also verified: the cwd encoding, including its fallback.**

`encode_cwd_dirname` URL-encodes the cwd with Rust's `urlencoding` (unreserved
bytes verbatim, UPPERCASE hex — `encodeURIComponent` is NOT equivalent, it
leaves `!'()*` alone) when the result is <= 255 bytes, and otherwise uses
`{slug}-{blake3_hex16}`. Exawatt reproduces the first branch exactly and
resolves the second through the `.cwd` metadata file the harness writes for
that purpose, rather than reimplementing BLAKE3 — the harness's own
`decode_cwd_from_dirname` reads the same file, and a hash Exawatt recomputed
could silently disagree after any upstream change. Tests use the harness's own
`LONG_CWDS` regression fixtures.

**Unverified, and why**

Live hook FIRING was never exercised: `grok` validates authentication before a
session starts, so a fabricated `XAI_API_KEY` cannot reach `SessionStart`. The
hook payload contract above therefore comes from the harness's serializer
rather than from captured traffic. This does not affect what shipped — nothing
subscribes — but it is the gate on the follow-up below. The operator
credential prerequisite the shaped scope recorded still stands.

**Follow-up, recorded not built**

`grok agent` (ACP JSON-RPC over stdio/WebSocket, with `--plugin-dir` for
per-connection hooks and `--client-identifier`) is the seam that would give
Grok Build full ENG-023 status truth without touching the operator's state
home. It is the same open question S2 carries for `opencode serve` — whether a
protocol transport belongs in a product whose current terminal regime is
deliberately a real terminal — and it now has a concrete second data point.
Headless `-p --output-format streaming-messages-json` (byte-compatible with
Claude Code's stream-json) remains out of scope.

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
