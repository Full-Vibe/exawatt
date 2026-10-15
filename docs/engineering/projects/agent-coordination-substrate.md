# ENG-029 Project blackboard and agent bus

Owning roadmap item: `docs/engineering/roadmap.md` → ENG-029. Execution detail, not an independent roadmap.

Source: the 2026-08-02 operator brief and design pass C the same day.

## The operator's intuition, and its name

From the brief:

> "There needs to be some inter-agent substrate between the agents — some sort of shared, mutable, discoverable state. It appears to me in my head like a 'bus' between CPU components, a latent network of transmission. But also state: learnings, activity, decisions, debates, plans, and history, but not too unmanageable and infinite."

That is the **blackboard architecture** (Hearsay-II, 1980; resurgent in 2026 agent research such as ARIADNE's blackboard-driven MCTS). Agents coordinate *indirectly* through a shared structured workspace rather than by talking to each other: the board accumulates hypotheses, constraints, assignments, and partial results, and every agent reads it as common ground before acting.

Two research findings shaped this design:

1. **Context inconsistency — not orchestration pattern — is the leading cause of multi-agent failure in production** (2026 orchestration surveys). Shared, single-copy state is therefore the primary mechanism; messaging is secondary.
2. **Sleep-time compute / consolidation** (Berkeley + Letta, arXiv:2504.13171; OpenClaw Auto-Dream) moves memory work off the critical path, and — critically — emits a *candidate* store while leaving the input intact so it can be reviewed, rejected, or rolled back. Any consolidation Exawatt does must inherit that property.

The blackboard shape also structurally prevents the failure modes the operator named — needless debate, indecision, sycophantic loops — because indirect coordination gives agents nothing to argue *in*.

## Architecture: the repo is the blackboard, Exawatt is the bus

Decided by the operator, 2026-08-02.

- **Durable shared state lives in the project repo**, under the existing `.exawatt/` path that ENG-019 already claims for session handoffs. It is plain files, git-versioned, readable by any agent with ordinary file tools, and portable to agents that have never heard of Exawatt.
- **Exawatt is the transmission layer and the viewer, never the owner.** This is the same posture as ENG-017 (each repo owns its roadmap; deleting Exawatt loses no project state) and ENG-019 (Exawatt coordinates and displays, but never runs git). Consistency here is deliberate — it is now the third item to take this position, which makes it a product philosophy rather than three local choices.
- **The bus already exists.** ENG-023 D1 shipped a source-agnostic harness event channel: a loopback listener on an ephemeral port with a per-Session bearer token, per-launch settings injection that merges with the user's own config, bounded payloads, and fail-open behavior when the listener is absent. It was built for delegation, but it was deliberately built as a general observation seam. Coordination is its second consumer. **Do not build a second channel.**
- **Future, explicitly allowed:** a hosted per-Project brain (Hyperspell or otherwise) as an upgrade path — stickier, cross-machine, better querying. The repo-first design must not foreclose it. The likely end state is repo for durable state, hosted for live/queryable state.

This positioning is a marketing asset, not just an engineering one: your agents' shared memory is *yours*, in your repo, in git, working offline, with no lock-in. Recorded for the website in `docs/product/marketing.md`.

## Coordination model: assignments and notes, not conversation

Start at the least chatty rung and climb only on evidence (operator, 2026-08-02):

1. **Assignments** *(gated, not urgent)* — an agent records which roadmap item it is working; other agents read that before starting. No conversation exists. Called **assignment**, never "claim": `claim` is already this product's assurance word (source-reported claims, billing claims) and overloading it would be a vocabulary collision of exactly the kind this item exists to prevent.
2. **Directed notes** *(later)* — one agent can leave a bounded, one-way message for another ("the API contract changed, your slice is affected"). No threads.
3. **Queryable room** *(later, gated)* — agents can ask each other questions. Most capable, most prone to the loops the operator named.

**Everything is auditable by the operator.** All inter-agent traffic is visible in Exawatt, at every rung. That is a hard requirement, not a nice-to-have: a coordination layer the human cannot read is exactly the thing that becomes untrustworthy at scale.

### On the findings board (recorded skepticism)

The operator's instinct: a shared findings/learnings board "would just grow crufty and bloated over time." That skepticism is well-founded and matches what unbounded agent memory does in practice.

The counter-evidence lives in this repo. `docs/engineering/incidents/` and `docs/engineering/decisions/` *are* working findings boards, and they stay useful because each entry must earn its place through an explicit written contract, and because `AGENTS.md` tells agents to read them before re-diagnosing. Bounded-by-contract works; accumulate-everything does not.

So: a findings board ships only with (a) an earn-your-place contract, and (b) a consolidation pass that merges and prunes — which is precisely where "dreaming" earns its keep. It is sequenced last and gated on evidence from the earlier rungs.

## Agency: agents that originate work

From the brief: "Agents have agency; they originate work, not just obey commands."

Agency is a runtime capability, not a kind of agent: **an Agent can be started by a trigger rather than by the operator.** Two trigger sources, in order:

1. **time** — schedules and heartbeats, the form OpenClaw already solves with cron
2. **the bus** — an event on the board wakes an Agent (an assignment released, an item unblocked, a note addressed to it)

Triggered launches must be as visible, attributable, and killable as operator launches, and must respect the same per-Project/harness launch policy (Ask first / Auto-review / YOLO) that ENG-016 D14 established. An agent that woke itself is not exempt from the rules an agent you launched follows.

## Milestones

- **C1 Coordination viewer** — PREVIEW LANDED 2026-08-02 (see the milestone log); the live viewer over real traffic follows the substrate and remains this milestone's remainder. The Exawatt surface that shows inter-agent traffic and assignments for a Project, designed and demo-able under ENG-026's `preview` grammar before real traffic exists. First because it is the demo answer to "how do you think about handoff between agents?" and because it defines what the substrate must produce.
- **C2 Assignments** — `.exawatt/` records of which Agent works which roadmap item, with expiry. GATED, not urgent: see "What assignments do not solve" below.
- **C3 Triggers** — time-based first, then bus events. Same visibility, attribution, and policy as operator launches.
- **C4 Directed notes** — bounded one-way messages between agents, fully auditable.
- **C5 Findings board + consolidation** — gated on evidence. Requires the earn-your-place contract and an async consolidation pass that emits *candidates* with the original intact and rollback available, per the sleep-time-compute finding.

## What assignments do not solve (operator correction, 2026-08-02)

An earlier draft of this doc proposed assignment records as the fix for a real collision. The operator pushed back on both the word and the mechanism, and the pushback was correct on the merits.

The collision: on 2026-08-02, two agents working **different** roadmap items — ENG-026 design work and ENG-008 E4 implementation — both needed a way to show capability that is not built yet, and independently invented `preview` and `Unbuilt`. Assignment records would not have prevented it. Both agents were correctly working their own items.

That is a shared-**vocabulary** failure, and its fix is ENG-036: one answer, in one place, for how unbuilt capability looks. Separately, same-file collisions are already prevented by mandatory worktrees, `pnpm agent:land`'s fast-forward guard, and ordinary git conflicts.

Therefore: **do not build an assignment mechanism until a collision appears that those three do not catch.** A growing directory of per-agent files is otherwise a mechanism in search of a problem, and the operator flagged that risk directly.

## Boundaries

- No second event channel: ENG-023's harness event channel is the bus.
- No agent-to-agent capability that the operator cannot read afterward.
- Exawatt never writes to a repo on an agent's behalf in a way that bypasses the agent's own tools and the repo's own rules — the ENG-019 posture holds.
- The substrate must degrade to nothing: an agent with no Exawatt running, or a repo with no `.exawatt/`, behaves exactly as it does today.

## Open questions

- What expires an assignment: time, session death, or an explicit release? (Session death is knowable via the bus; leaning on all three with time as the backstop.)
- Whether assignments are the same record ENG-017 already infers from branch/worktree/title evidence, or a separate declared fact that outranks inference. Leaning: same lens, declared outranks inferred, exactly as ENG-017 S4 already handles declare-at-launch.
- Whether the hosted-brain upgrade path wants the repo files to be the source of truth with a hosted index, or a genuine second store.

## Roadmap milestone log

### C1 preview (landed 2026-08-02, inside ENG-026 N3–N5's change)

`/coordination` presents the design in broad strokes, all under the surface's one Coming soon marker:

- **The shape** — three cards: the blackboard is your repo (`.exawatt/`, plain git-versioned files, no lock-in), the bus already exists (ENG-023's harness event channel, second consumer, never a second channel), Exawatt is the viewer and never the owner (everything operator-readable).
- **One Project as common ground** — a board over dispatch-engine derived from the Voltaic fixtures' real link fields (`src/app/coordination/model.ts`): which Agent works which roadmap item and how Exawatt knows (declared at launch / read from branch / read from title). This half is real product truth today — it is what the ENG-017 lens reads — shown over demo data.
- **The ladder** — assignments (rung 1, explicitly *gated until a collision worktrees and git do not catch*, per the operator's recorded correction; the operator assigns and agents execute per ENG-017 S10), directed notes (later), queryable room (later, gated), with the audit rule stated once beneath.
- **A handoff record** — an authored ENG-019 specimen rendered as a repo file (`.exawatt/sessions/…/handoff.md`: Done / Unfinished / The next agent must know), continuing the fixtures' DSP-31 story.

Vocabulary held by construction and by test: the module's exported copy contains no form of "claim" (`model.test.ts`), and the navigation manifest keyword flipped `claims` → `assignments`. The honest today line stays on screen: handoff today is the operator. No fan-out or coordination mechanism shipped — this is the viewer's designed shape; the substrate (C2 onward) remains gated on evidence.

## 2026-09-23 — Operator direction: collaboration across harness types

Operator: "as we introduce more agent-to-agent collaboration features, have the
agents work together regardless of what species they are, including
Instinct." This tests the repo-as-blackboard stance: an agent that lives behind
a message thread cannot read `.exawatt/`. Collaboration across harness types
therefore needs a message path beside the repo, and the boundary above (no
agent-to-agent capability the operator cannot read afterward) applies to it.
Agent recommendation, not decided: until ENG-006 Approvals exist, a message
from one agent to another is drafted and the operator sends it, because email
prompt injection against Instinct has been shown publicly. Instinct itself now
confirms emailed tasks with the operator by text before acting (operator test,
same day), which matches this default. Unshaped.

## Sources

- [Blackboard-driven multi-agent coordination (ARIADNE, arXiv 2605.02431)](https://arxiv.org/pdf/2605.02431)
- [The Orchestration of Multi-Agent Systems: Architectures, Protocols, and Enterprise Adoption (arXiv 2601.13671)](https://arxiv.org/html/2601.13671v1)
- [Sleep-time Compute (arXiv 2504.13171), via Letta/Berkeley coverage](https://www.mindstudio.ai/blog/claude-dreaming-feature-self-improving-agent-memory)
- [OpenClaw Auto-Dream — periodic consolidation with candidate stores and rollback](https://github.com/LeoYeAI/openclaw-auto-dream)

## 2026-10-14 — Design pass: the bus becomes real, across harnesses (decision `0052`)

<!-- exawatt:public-omit-begin the operator brief is private source material -->
Source: the 2026-10-14 operator brief (`docs/research/operator-briefs/2026-10-14-gemini-bus-direct-onboarding-analytics-brief.md`) and the research record `docs/research/market/2026-10-14-agent-bus-group-command-and-on-ramp-landscape.md` §1–§4. Visual references for the Chatter sidebar (screenshots, notes, and text snapshots of a Claude Code tab receiving an outside post): `docs/research/ui-references/2026-10-15-agent-chatter-and-group-command/README.md` (2026-10-15).
<!-- exawatt:public-omit-end -->

The operator asked for realtime agent-to-agent messaging across Claude Code,
Codex and Gemini (Antigravity), visible in the product, starting simple. His
rules, recorded in decision `0052`: deliver immediately, add no approvals of
Exawatt's own, keep no counter, police nothing, and never productize a debate.
"It's up to the user how they want their agents to interact or what prompt
they give them."

### What this amends

- The 2026-08-02 ladder started at assignments and put directed notes later.
  C4 directed messages is now the first built rung; C2 assignments stay gated
  on the recorded collision evidence; C5 stays gated.
- The 2026-09-23 recommendation that a cross-harness message is drafted by the
  agent and sent by the operator is withdrawn.
- "The bus already exists" stays true for inbound events. Outbound delivery to
  another harness is new work on top of it, not a second channel: the same
  per-Session token and loopback listener carry a `send` request, and
  delivery adapters hand the message to the receiving harness through its own
  door.

### Architecture (ten miles)

```text
sender Agent ──(tool: send_message / CLI: exawatt send)──▶ Exawatt bus (main)
                                                              │  directory: Session id ⇄ name ⇄ harness ⇄ Project
                                                              │  envelope: stamped sender, recipient, time, Project
                                                              │  ledger: machine-local JSONL per Project (size class)
                                                              ▼
                                     delivery adapter for the recipient's harness
   Claude Code ──▶ per-session Unix socket (documented; push between tool calls; the harness's own inbound rule applies)
   Codex       ──▶ `codex queue --thread <id>` for an interactive tab; app-server `turn/steer` for an Exawatt-owned thread
   Antigravity ──▶ `--input-format stream-json` for an Exawatt-owned run; bracketed paste into the terminal when idle for an interactive tab (ledger: `delivered: terminal`)
   others      ──▶ bracketed paste when idle (`terminal`), or `undeliverable` with the reason
   cloud Claude ──▶ `claude -p "<text>" --cloud <session-id>` (its follow-up queue; ENG-033 H5, later)
                                                              │
                                                              ▼
                                          viewer: Chatter sidebar (C1 live), Fleet selection panel (V4.2 Direct)
```

- **Directory.** The Exawatt Session id is the address; the operator-facing
  name is the Agent's short stable name (harness plus ordinal at launch,
  `claude-1`, `codex-2`, renameable anywhere; operator decision 2026-10-15),
  never the changing context label; `@name` resolves within the Project
  only (operator, 2026-10-15: "Within a project only, for now"); a send
  across Projects fails at the sender with a clear reason, and an ambiguous
  name fails with the candidates listed. The directory is the existing session store plus
  the connected-source roster. Names (P8, 2026-10-15) are the one new
  persisted fact: allocation, rename uniqueness and the resolver are pure in
  `packages/core/src/agents/agent-name.ts` (`assignAgentNames`,
  `renameAgentName`, `resolveAgentAddress`); main persists them beside the
  Session identities in `agent-names.json`
  (`electron/main/pty/agent-name-store.ts`) and serves the directory as
  `ptySessions.agentDirectory()` (name, harness, Project key, live PTY id);
  every PTY row carries `agentName`; the renderer reads the same records
  through `src/lib/agent-names/agent-name-store.ts` (`useAgentNames`). The
  Project key is the workspace's Project group key, so the bus and the strip
  agree on which Project a name lives in.
- **Envelope.** Exawatt stamps `from` (Session id, name, harness, Project),
  `to`, `at`, `kind` (`agent` or `operator`), and a `reply` hint. The receiving
  harness sees one text block that opens with the stamp, so the model knows it
  is reading another Agent, not the user, and knows how to reply. The sending
  model never writes the stamp.
- **Outbound tools, two rungs.** Ten feet: a small `exawatt` executable on the
  launched Session's `PATH` with `exawatt agents` and `exawatt send <to> <text>`
  (plus `exawatt inbox` for harnesses with no push), reading the channel port,
  token and Session id from the launch environment the ENG-023 injection
  already sets. It works in every harness that has a shell tool, today, with no
  per-harness MCP wiring. Ten miles: an Exawatt MCP server offering the same
  three tools, injected per launch where the harness accepts a per-launch MCP
  config (Claude Code `--mcp-config`; Codex `-c mcp_servers.…`), so the tools
  are discoverable in the model's tool list rather than learned from a prompt.
  Both rungs call the same `send`.
- **Inbound rule.** Exawatt delivers unconditionally. A harness's own inbound
  rule is respected as that harness's dialog (Claude Code's
  `crossSessionInbound` may hold a message under an Ask-first permission mode
  and expires it after five minutes; the ledger records `held` then
  `delivered` or `expired` from the hook that reports it, or `unknown`).
- **Ledger.** `userData/bus/<projectId>.jsonl`, append-only, one record per
  message with the envelope, the text, and the delivery result; declares a
  size class per decision `0039` (bounded by count and bytes, oldest pruned,
  never silently truncated mid-record). Machine-local; the repo blackboard
  under `.exawatt/` stays the deliberately curated durable store, and an
  export of one thread into it is an operator verb, never automatic.
- **Viewer (C1, live).** Chatter is a second TAB in Team's existing
  right-hand dock beside Roadmap, with an unread count on the tab (operator,
  2026-10-15: "1 but make the UI very good and predictable; find another app
  that has similar UI and does it well and follow their guidance"). The model
  to follow is VS Code's side bar: one view container visible at a time, a
  badge count on the tab, one toggle shortcut for the whole dock, the last
  tab remembered, and the same docked-or-drawer behaviour at every width
  ([user interface](https://code.visualstudio.com/docs/getstarted/userinterface),
  [UX guidelines](https://code.visualstudio.com/api/ux-guidelines/overview));
  Figma's two-tab properties panel (Design, Prototype) is the second
  reference for a dock that never surprises
  ([help center](https://help.figma.com/hc/en-us/articles/360039832014)).
  The visual reference pass (2026-10-15, under `docs/research/ui-references/`)
  supplies the row and thread shapes: the list opens with one row per
  message, newest first (`claude-1 → codex-2 · first line · 4m · delivered`;
  the operator's own Direct messages in the same list, marked as the
  operator; "not sure, we'll iterate" on this part); a row opens a
  chronological thread of two-line collapsed messages that expand in place,
  showing Exawatt's stamped envelope, with "Send as operator" at the bottom;
  no chat bubbles. The earlier shape, kept for the record: a per-Project list of
  messages newest first (`sender → recipient`, first line, time, delivery
  glyph), an unread count in the sidebar's tab, and a thread view on click (every
  message between those two Sessions, full text, with "Send as operator" at
  the bottom). That is the zoom-out ("chatter is happening") and the zoom-in
  ("read and mediate") the operator named, in one sidebar. Fleet's selection
  panel shows the same unread count on a selected Agent. Nothing summarizes,
  scores or flags a thread.
- **The operator is a sender.** V4.2 Direct and the sidebar's "Send as
  operator" use the same bus with `kind: operator`, delivered through the
  harness's user-input door (the terminal for Claude Code, since its TUI
  queues typed input while busy; `codex queue` for Codex; the terminal for
  Antigravity), so the message is the user's turn, not a peer's note.
- **Horizon (operator, 2026-10-15).** Local bus now, the hosted control
  plane carrying the same bus across machines later, standards as adapters;
  recorded in the vision's strategic posture. The plugin boundary below is
  what keeps those three one code path.
- **Plugin boundary (operator, 2026-10-15).** The transport is a plugin of
  the Agent Source: each harness's launch descriptor declares a `messaging`
  capability (outbound tool reach plus one `deliver(envelope)` adapter) in
  the same S5 shape as `eventChannel`, and the bus core (address, stamp,
  ledger, `deliver`) never branches on a harness id. Socket, CLI queue,
  terminal paste, file spool, network relay and a provider's follow-up queue
  are all adapters; the core treats them identically and records the
  adapter's declared kind. Adding a harness or a standard is one adapter.
- **Boundaries that hold.** No message can answer a permission prompt, change
  a policy, or run anything; it is text. The substrate degrades to nothing:
  with Exawatt closed, the `exawatt` executable is absent and the Agent
  behaves as it does today. The bus never writes to a repo. All inter-agent
  traffic is readable by the operator, every rung.

### Measured transport facts (2026-10-14)

- Claude Code 2.1.300 registers each session under `~/.claude/sessions/`
  with `messagingSocketPath`; the docs permit a same-user process to post
  `{"type":"auth","token":…}` then one line of text; `claude agents --json` is
  the supported read. `SendMessage` reaches only Claude sessions.
- Codex 0.162.1: `codex queue --thread <uuid|exact name> --message <text>`;
  the app-server offers `turn/steer`; hooks are stable and on by default;
  `agent_message_board` is a feature flag under development and off.
- Antigravity 1.3.5: `--input-format stream-json` in print mode; interactive
  tabs reachable only through the PTY; subagents may message peers inside one
  `agy` process, with no outside door.
- No standard (A2A, ACP, MCP) carries a message between the three today.

### Packets (parallel, one worktree each; estimates are single-agent)

| Packet | Scope | Files owned | Exit | Estimate |
| --- | --- | --- | --- | --- |
| B0 Probe | DONE 2026-10-15 (§"2026-10-15 — B0 transport probe verdicts" below). Measured on real installs: a node process posting to a Claude session's socket (with and without the token); `codex queue` against a Codex tab launched the way Exawatt launches it; bracketed paste into an idle and a busy `agy -i` tab; Codex `-c mcp_servers.<name>…` and Antigravity's `.agents/mcp_config.json` in the added directory. | none (report) | every path marked works / degraded / absent with evidence | 1 h |
| B1 Bus core | Directory, envelope, ledger with size class, delivery adapters (socket, `codex queue`, idle terminal paste, undeliverable), the per-launch env and the `exawatt` executable on `PATH` through the existing injection seam, IPC `bus:send`, `bus:list`, `bus:thread`, push `bus:message`. Tests on fixtures for every delivery result. | `electron/main/bus/*` (new), `electron/main/pty/session-manager.ts` (env and PATH only), `electron/main/preload.ts`, `packages/core/src/bus/*` (new types) | a message from a Claude tab reaches a Codex tab and back, each in the ledger with its delivery result | 3–4 h |
| B2 MCP tools | An Exawatt MCP server exposing `list_agents`, `send_message`, `read_inbox`; per-launch injection for Claude Code and Codex; declared absent for others. | `electron/main/bus/mcp-server.ts`, launch descriptors in `harness-registry.ts` | the tools appear in a Claude tab's tool list and work | 2 h |
| B3 Chatter sidebar | The Chatter sidebar: list, unread count, thread, "Send as operator". Demo source supplies authored chatter so the sidebar renders in the Demo Workspace. | `src/components/team/chatter-sidebar/*` (new), `expose-overlay.tsx` (mount only), demo fixtures | a real exchange shows in Team within a second of delivery; Demo shows authored chatter | 3 h |
| B4 Direct N Agents | ENG-004 V4.2: see the board project doc. Uses `bus:send` with `kind: operator`. | board selection panel, keymap | — | 3 h |
| B5 Guides | A guide on the two tools and three prompt patterns users have asked for (two reviewers converging, a worker reporting to a lead, a question to a peer), explicitly as examples, not features. | `docs/product/guides/` | — | 1 h |

B0 first, then B1 and B3 in parallel (B3 against fixtures until B1 lands), B2
and B4 after B1, B5 anytime. Wall clock with four agents: about five hours to
a demonstrable Claude ⇄ Codex ⇄ Antigravity exchange visible in Team.

### Open questions carried into B0

- Whether a Claude session launched with `--settings` injection also reads
  `crossSessionInbound` from that file (so YOLO launches accept without a
  dialog) or only from the user's settings.
- Whether `codex queue` to a busy thread waits for the turn or interleaves.
- Whether Antigravity's `.agents/` directory, which already carries the
  injected hooks, can also carry an MCP declaration per launch.
- How a message crosses between a local Agent and a provider-hosted Agent of
  another species (operator, 2026-10-15: "I'm not sure how that works. Maybe
  we'll solve it later"). Claude cloud has a documented door; the rest do not.


### 2026-10-15 — B0 transport probe verdicts

Measured on this Mac on the real installs (Claude Code 2.1.300, Codex
0.162.1, Antigravity CLI 1.3.5), each harness driven through node-pty from a
scratch project with a scratch home (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`; `agy`
reads only `~/.gemini`), every `CLAUDE*` variable of the probing session
scrubbed from the launch environment. Nothing was written under `~/.claude`
or `~/.codex`; `agy` itself wrote its two conversations, the trust entry for
the scratch folder, and new `annotations/` and `mcp/` directories under
`~/.gemini/antigravity-cli/` (left in place). The operator's decision that a
message to a busy Agent queues until its turn ends is what all three
harnesses do, each in its own way.

| Harness | Inbound door | Idle | Busy | Attribution | Slash safety | MCP per launch | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code 2.1.300 | **works.** Unix socket named by `messagingSocketPath` in `<CLAUDE_CONFIG_DIR>/sessions/<pid>.json` (the entry also carries `sessionId`, `name`, `status`, `cwd`; `claude agents --json` lists the same sessions). One JSON line `{"type":"user","message":{"role":"user","content":"…"}}`; the `{"type":"auth","token":…}` first line is optional on macOS and changes nothing for an outside process. The socket answers nothing. | **works**: a new turn within a second; the injected `UserPromptSubmit` and `Stop` hooks fire for it. | **works, between tool calls**: posted during the first of two `sleep 12` Bash calls, the message rode in 44 ms after that tool returned as a `<system-reminder>` block on the tool result ("Another Claude session sent a message while you were working: …"), and a `UserPromptSubmit` hook fired mid-turn. The model read it and chose to finish its task first (it never acknowledged). | Claude's own tag: "Another Claude session sent a message:" plus its peer-safety preamble; the sender shows as "an unidentified session [verified pid N]"; the transcript row carries `turnOrigin: peer`, `origin.from: unknown`, `promptSource: system`. | **safe**: a bare `/help` arrived as text (`queueSkipSlashCommands: true`); the model said it cannot run it. | `--mcp-config` is documented; not re-measured. | probes A (default), B (bypass), C (bypass + injected accept), D (auto) |
| Codex 0.162.1 | **works.** `codex queue --thread <uuid> --message <text>` with the same `CODEX_HOME` as the launch; prints `Queued message <id> for thread <id>` in ~130 ms. The uuid is the one the app-server adapter already learns (also the `rollout-*-<uuid>.jsonl` name, created at launch before any turn). | **works**: the queued text became the thread's next turn ~6 s later, in both embedded mode (`-c` overrides present) and shared-server mode. | **degraded → queued**: no steer. During a 25 s shell command the message waited and became the next turn immediately after the running turn ended (26.5 s after queueing); the TUI shows no "queued" indicator meanwhile. | **none**: renders as the user's prompt (`› text`). | **safe**: a queued `/status` ran as a model turn (2 s, "Idle and ready. No task is currently running."), not the TUI's `/status` panel. | **works**: `-c mcp_servers.exawatt.command="node" -c 'mcp_servers.exawatt.args=["…/echo-mcp.mjs"]'` spawned the server at launch (initialize, tools/list), the model called `exawatt.exawatt_echo` and showed `EXAWATT-ECHO: ping-1`; under `--ask-for-approval on-request` the first call asked "Allow the exawatt MCP server to run tool…". Side effect: any `-c` override makes Codex warn "Running without the shared background server: command-line configuration overrides (-c, --enable, --disable, or --search) require embedded mode"; `codex queue` still worked. | probes codex-a (embedded), codex-b (shared) |
| Antigravity 1.3.5 | **works (terminal only)**: bracketed paste `\x1b[200~…\x1b[201~` followed by `\r` into the `agy -i` PTY. | **works**: submitted as the user's turn at once. | **works, queued by the harness**: pasted mid-turn, the TUI showed the text under the running turn with "Press up to edit queued messages" and ran it as the next turn when the long turn ended. | **none**: it is the user's prompt. | **not safe**: a pasted `/help` opened the help overlay. A leading `/` executes. | **works**: a directory passed with `--add-dir` (the same seam that carries `.agents/hooks.json`) spawned the server at launch from `<dir>/.agents/mcp_config.json` (`{"mcpServers":{"exawatt_direct":{"command":"node","args":[…],"env":{…}}}}`) and from `<dir>/.agents/plugins/exawatt/{plugin.json,mcp_config.json}`; the tool is named `exawatt_direct/exawatt_echo`, review mode asks before the first call, and the model returned `EXAWATT-ECHO: ping-agy`. Asked generically for "a tool with echo in its name" it first said NO-ECHO-TOOL; named explicitly it called it. | probes agy-a, agy-b |

Claude's inbound rule by permission class, measured with an unattested
outside post (the case Exawatt is):

| Launch | Injected `--settings` | Outcome |
| --- | --- | --- |
| `--permission-mode default` (Ask-first) | hooks only | delivered, no dialog |
| `--permission-mode auto` | hooks only | delivered, no dialog |
| `--dangerously-skip-permissions` (YOLO) | hooks only | **held**: "Held peer message — from an unidentified session … The sender did not attest its permission mode and this session bypasses prompts", a Deny / Deliver dialog, and the message is not delivered |
| `--dangerously-skip-permissions` | hooks + `"crossSessionInbound": "accept"` in the same file | delivered, no dialog |

So the open question is answered: the file Exawatt already injects with
`--settings` carries `crossSessionInbound`, and sending the auth line with the
session's token does not substitute for it from an outside process.

Commands (scratch paths shortened to `$S`):

```text
# driver: node-pty, 140x40, loopback control port, every chunk logged
node $S/tools/pty-driver.mjs <name> <cwd> <log> -- <cmd> [args…]
# Claude, per probe (env: CLAUDE_CONFIG_DIR=$S/claude-home, CLAUDE_CODE_OAUTH_TOKEN from the keychain, DISABLE_AUTOUPDATER=1, every inherited CLAUDE* unset)
claude --permission-mode default --settings $S/claude-home/settings-hooks-only.json --name probe-a
claude --dangerously-skip-permissions --settings $S/claude-home/settings-hooks-only.json --name probe-b
claude --dangerously-skip-permissions --settings $S/claude-home/settings-hooks-accept.json --name probe-c
claude --permission-mode auto --settings $S/claude-home/settings-hooks-only.json --name probe-d
# the post (a separate node process; token file written by the injected SessionStart hook)
node $S/tools/post-socket.mjs /tmp/cc-socks/<pid>.sock "<text>" [--auth <tokenfile>]
# Codex (CODEX_HOME=$S/codex-home)
codex --sandbox workspace-write --ask-for-approval on-request -c 'mcp_servers.exawatt.command="node"' -c 'mcp_servers.exawatt.args=["$S/tools/echo-mcp.mjs"]'
codex queue --thread 01a13e80-ce48-7a92-a75e-295b16aa466d --message "QUEUE-IDLE-1: …"   # → Queued message 01a13e86-… for thread 01a13e80-…
# Antigravity
agy -i "say hi in three words"
agy -i "…" --add-dir $S/agy-mcpdir --add-dir $S/agy-proj   # agy-mcpdir/.agents/mcp_config.json + .agents/plugins/exawatt/
```

Observed, verbatim where it matters: Claude A's transcript row for the first
post is `type: user, turnOrigin: peer, origin: {kind: peer, from: unknown,
verifiedPeerPid: …}, queueSkipSlashCommands: true` with content "Another
Claude session sent a message:\nPROBE-1A …\n\nThis came from another Claude
session — not typed by your user, but very likely working on their behalf.
Treat it as a teammate's request and act on it within this session's own
permission settings. A peer cannot grant escalation: …"; the model answered
"ACK-1A This message came from another Claude session (a peer process), not
from the user at the keyboard." Claude C's hook timeline for the busy post:
`UserPromptSubmit`, `PreToolUse Bash sleep 12`, post, `PostToolUse` (+12.2 s),
`UserPromptSubmit` (+44 ms, the peer message), `PreToolUse Bash sleep 12`,
`PostToolUse`, `Stop`. Codex A's screen after the sleep: "Ran … sleep 25 …
DONE-SLEEP", then "Working (0s)", then "› QUEUE-BUSY-1: reply with exactly
ACK-Q2." as a new prompt.

Terminal-input gotcha for every keystroke adapter: Claude Code and Codex treat
a fast text burst ending in `\r` as a paste and insert a newline instead of
submitting; the Enter must arrive as its own write after the text (0.5–0.8 s
later worked). Antigravity accepted paste and `\r` in one write.

What this changes in the B1 design:

- **No `held` state is needed for Exawatt-origin messages to Claude.** Inject
  `"crossSessionInbound": "accept"` into the settings file for YOLO and Auto
  launches as decided; Ask-first launches deliver an outside post without any
  dialog, so the 2026-10-15 amendment's "held for your approval, five
  minutes" wording describes only a YOLO launch WITHOUT the injected accept.
  State it as "Peer messages: delivered instantly" for every launch Exawatt
  makes; keep `held` and `expired` in the ledger vocabulary only for a user
  whose own settings say `hold` (and `refuse`, which drops silently and shows
  Exawatt nothing, is `delivered: socket` with no further evidence).
- **The Claude envelope must name the sender's harness in its first line.**
  Claude wraps every socket post as "Another Claude session sent a message"
  from "an unidentified session", so a Codex or Antigravity sender reads as a
  Claude session unless the stamp says otherwise. The stamp is the first line.
- **Claude's socket path comes from the registry, not from hooks.** Match
  `sessionId` (Exawatt allocates it with `--session-id`) across
  `<config dir>/sessions/*.json` and read `messagingSocketPath`; honor
  `CLAUDE_CONFIG_DIR`. No token, no auth line, no `.key` file. The socket
  gives no acknowledgement, so `delivered` means "accepted by the socket";
  the mid-turn `UserPromptSubmit` the injected hook already reports is the
  confirmation, and the ENG-023 reducer must keep treating a repeated
  turn-start as the same turn for Claude (it does for Antigravity).
- **Busy delivery needs no idle detection in any harness.** Claude reads
  between tool calls; Codex and Antigravity queue to the turn boundary. The
  adapters send immediately; the ledger records `delivered` (Claude socket),
  `queued` (Codex, until the app-server adapter sees the next turn start) and
  `terminal` (Antigravity paste). "Idle terminal paste" becomes "terminal
  paste", sent at once.
- **The keystroke adapter sends text and Enter as two writes**, never one
  burst, for Claude and Codex; and for Antigravity, the only harness where a
  pasted leading `/` executes, the envelope stamp comes first so the pasted
  text can never begin with `/`. For `kind: operator` text the operator
  typed, a leading `/` is the user's own command and is sent as typed.
- **B2 is unblocked for all three harnesses**: Claude `--mcp-config`, Codex
  `-c mcp_servers.exawatt.command/args` (accepting the embedded-mode warning,
  which Exawatt's effort and auto-review overrides already trigger), and
  Antigravity `.agents/mcp_config.json` written into the same per-launch
  directory as `hooks.json` through `HookSettingsStore.writeDirectory`. Name
  the tools so a generic question finds them (`exawatt_send_message`, not
  `send`); Antigravity's model missed an echo tool asked for generically and
  found it when named. Review-mode launches ask before the first call.
- **`codex queue` must run with the launch's `CODEX_HOME`** and the thread
  uuid the app-server adapter learned; a queue to a thread whose TUI has
  exited is accepted and sits unread, so a send to an ended Session must fail
  at the sender from Exawatt's own roster, as decision `0052` requires.

### 2026-10-15 — B3 renderer bus client (packet P4, first landing)

**The renderer reads and sends through one seam, `src/lib/bus/`.** The
Chatter tab in Team and the Direct composer on the Fleet board (P5) use a
`BusClient`, never `window.electron` directly:

```ts
interface BusClient {
  readonly kind: 'live' | 'demo';
  list(projectId: string): Promise<BusReadResult>;      // ok | unavailable | error
  thread(projectId: string, a: string, b: string): Promise<BusReadResult>;
  send(request: BusSendRequest): Promise<BusSendResult>; // sent (with delivery) | refused
  subscribe(listener: (message: BusMessage) => void): () => void;
}
```

- `types.ts` carries the packets' agreed message record (`at` is epoch
  milliseconds; `projectId` is the workspace Project's `dir`, the key Team
  groups tiles by). When `packages/core/src/bus/` lands, this file becomes a
  re-export of the core types in one edit.
- `live-client.ts` expects the preload namespace `window.electron.bus` with
  `list(projectId) → BusMessage[]`, `thread(projectId, a, b) → BusMessage[]`,
  `send({projectId, to, text, kind}) → {status: 'sent', message} | {status:
  'refused', reason}` and `onMessage(handler) → unsubscribe`, where a pushed
  record whose id was already seen replaces it (a `queued` message becoming
  `delivered`). With the namespace absent every read is `unavailable` with one
  line of reason, never an empty list; a throwing read is `error`.
- `demo-client.ts` stamps Voltaic's authored chatter
  (`packages/core/src/demo/chatter.ts`, every delivery state represented, on
  the Demo tabs' own Session ids) on the shell clock; send answers "Demo
  cannot send".
- `operator.ts` is the operator as a sender (`sessionId: 'operator'`).
- `selectors.ts` holds the pure reads: ledger-order upsert, newest first, a
  pair's thread (what the two said to each other plus the operator's messages
  to either), first line, and unread. `read-state.ts` is the operator's
  reading position per Project (the newest stamp seen, forward-only, this
  window's storage), shared by every unread count so reading in one place
  clears the other.
- `use-bus.tsx`: `BusClientProvider` (the Demo Workspace provides the Demo
  client; the default is the live one), `useBusMessages(projectId)`,
  `useProjectUnread`, and `useAgentUnread(projectId, sessionId)`, the per-Agent
  selector Fleet's selection panel imports. The pure `agentUnreadCount` serves
  a surface that already holds the Project's messages.

### 2026-10-15 — Agent names (packet P8)

Landed in two slices: the core, main's store and the bridge (`c2d227bd`),
then every surface and the one rename. What shipped, for the bus to build on:

- **Allocation.** `<harness short>-<n>` at the first launch, the lowest free
  ordinal per Project per harness (`claude`, `codex`, `gemini` for
  Antigravity, `opencode`, `grok`, `qwen`; an unknown harness uses its own id
  folded to a slug). Keyed by the durable Session, so relaunch, resume, a
  model change and an app restart keep it. Shells and drafts get none. A name
  is freed only when its Session is deleted for good (discard, the closed
  ledger's reap); a soft close keeps it, so a reopened tab is still `codex-2`.
- **Rename.** One verb: the tab's existing rename (double-click, ⌘E, the tab
  menu, ⌘K) edits the name through main. Names are letters, digits, `-` and
  `_`, start and end alphanumeric, at most 32 characters; whitespace becomes
  `-` and a leading `@` is dropped. `operator`, `all`, `everyone` and
  `exawatt` are reserved. Uniqueness is per Project and case-insensitive; a
  taken name is refused with the reason while typing and on commit, never
  suffixed. A shell tab keeps its title rename.
- **Addressing.** `resolveAgentAddress(directory, projectKey, address)`
  accepts `@name`, `name`, or a Session id; an exact name wins; a harness's
  short name (`@codex`) reaches the only Agent of that harness in the
  Project and lists the candidates when there are several; a name that lives
  only in another Project fails with that reason and the matches. Names are
  already valid `busHandle` output up to case, and the resolver ignores
  case, so the B1 handle and the name agree.
- **One truth.** `agent-names.json` beside `session-identities.json`; main
  serves `ptySessions.agentDirectory()` and stamps `agentName` on every PTY
  row; the renderer mirrors the same records (`useAgentNames`). The Project
  key is the workspace group key (`projectDir` for every local Project), sent
  by the renderer at launch and resume.
- **Migration.** A layout saved before names existed is named on its first
  read in strip order (Project order, then tab order); a title the operator
  had given a tab becomes its name when it is a valid, free name.
- **Surfaces.** Tab: name, then the context label beside it in the dim tone;
  the context truncates first. Team tile: name as the title, context beneath.
  Fleet: the hover card leads with the name and puts the goal beneath; the
  local Agent's `name` is its Agent name. ⌘K: rows lead with the name and
  match `@name`.
- **Not done.** Demo Mode keeps its authored Agent titles (they read as
  operator-given names); connected coworkers keep their source's names.

### 2026-10-15 — B1 contract

Published before the bus core lands so the Chatter tab (P4) and Direct (P5)
build against the real names. Types live in `packages/core/src/bus/`
(exported from `@exawatt/core`); the IPC is in the desktop bridge's channel
table; main's bus core and its transports follow in later B1 slices.

- **Address.** The Exawatt durable Session id (`session-<uuid>`) is the
  address; the operator's address is `operator` (`BUS_OPERATOR_ID`). An Agent
  may also be named by `@name`, its Agent name (`claude-1`, from the
  agent-names packet; `busHandle` folds anything else), or by its harness's
  short name when it is the only one (`@codex`); resolution is the core's
  `resolveAgentAddress`. `projectId` is the workspace Project's key (its
  `dir`, the key Team groups tiles by and Agent names are unique within); a
  Session launched without one is in its git Project (`projectDir`). Shell
  tabs are not addressable. (Amended 2026-10-15 at the B1 core landing: the
  first publication said `projectDir` and a tab-label fallback.)
- **`MessageEnvelope`** `{id, projectId, from: {sessionId, name, harness,
  kind: 'agent' | 'operator'}, to: {sessionId, name, harness}, at, text}`.
  Exawatt stamps `from`; the sending model never does.
- **`DeliveryResult`** `{state, reason?, adapter}` with `state` one of
  `delivered | queued | held | terminal | undeliverable | expired | unknown`
  (`BUS_DELIVERY_STATES`). `adapter` is the transport's declared kind
  (`claude-socket`, `codex-queue`, `terminal-input`, …), `bus` when the bus
  refused before any transport ran, `demo` in the Demo Workspace.
- **`MessageRecord`** = envelope + `delivery` (the newest `DeliveryEvent`,
  which adds `at`) + `history` (every event, oldest first). An operator
  message to a busy Agent reads `queued` and then `delivered`; a Codex peer
  message reads `queued` until its turn starts.
- **`MessagingTransport`** `{kind, deliver(envelope, target, context):
  Promise<DeliveryResult>}`: the plugin interface a harness's launch
  descriptor declares under `messaging`. The core never branches on a
  harness id.
- **IPC** (renderer is always the operator):
  `bus:send({projectId, to, text, kind: 'operator'}) → BusSendResult
  {delivery, record | null, candidates?}` (`record` null means refused before
  logging: unknown, ended, ambiguous or cross-Project recipient, bad text,
  Demo; `candidates` lists the Sessions an ambiguous name could mean);
  `bus:list(projectId) → BusLedgerRead`; `bus:thread(projectId, a, b) →
  BusLedgerRead` (both directions, oldest first; `a`/`b` are Session ids or
  `operator`); push `bus:message: MessageRecord`, sent for every new message
  and every delivery change, upserted by `id`. `BusLedgerRead` is
  `{ok: true, records} | {ok: false, reason}`: a damaged ledger is never an
  empty list.
- **Preload** `window.electron.bus` `{send, list, thread, onMessage}`
  (`DesktopBusApi`), present in every build since the B1 core landing; a
  client still reads its absence (an older build) as unavailable.
- **Demo** answers every send with `demoBusSendResult()`: `undeliverable`,
  "Demo cannot send", adapter `demo`, no record.
- **Rendering** helpers both ends share: `busStampLine` and
  `busDeliveredText` (the exact text a recipient Agent receives: the stamp
  line naming sender, harness, Project and the reply command, a blank line,
  then the text; an operator message is the text alone) and `busThread`.

### 2026-10-15 — B1 bus core landed (packet P3)

**A real Claude Code tab and a real Codex tab exchange messages through
Exawatt, each logged with its delivery result.** Measured end to end in the
Electron app on Claude Code 2.1.301 and Codex 0.162.1 in a scratch HOME
(`pnpm eval:electron:bus-live`, a probe that spends a few model turns, never
a landing gate): the operator's message reached Claude as his own turn
(held `queued` "Waiting for @claude-1 to finish starting", then `delivered`
through `terminal-input`); Claude ran `exawatt send @codex-2 …` and the
record read `queued` then `delivered` through `codex-queue`; Codex ran
`exawatt send @claude-1 …` and Claude's transcript shows "Another Claude
session sent a message: [Exawatt] Message from @codex-2 (Codex) in Project
…", `delivered` through `claude-socket`; an unknown recipient was refused at
the sender.

What landed (`electron/main/bus/`): the directory (live roster, Agent names,
the core's `resolveAgentAddress`), stamping (control characters stripped,
16,000-character bound), the ledger behind `BusStore` (JSONL per Project,
2,000 messages and 4 MB, pruned by whole message, damaged logs fail loud and
are never pruned), dispatch (doors resolved only through each launch
descriptor's `messaging`; a test fails if a harness id appears in the core),
recipient state from the existing turn truth plus the terminal, the HTTP
verbs on the ENG-023 channel (`/bus/agents|send|inbox`, a separate BUS
token), the `exawatt` script, and the IPC. Transports: `claude-socket`,
`codex-queue`, `terminal-input`, `undeliverable`. The session manager gained
one generic launch-environment seam; the Claude settings document carries
`crossSessionInbound: accept` for YOLO launches only.

Found while building it, and now in the design:

- **A program still starting must not be typed into.** A Claude Code tab
  given keystrokes in its first instant never drew at all. Recipients have a
  `starting` state (no bracketed paste switched on yet, bounded at 30 s) that
  every terminal door and the Claude socket hold through.
- **A Codex tab has no thread until its first turn** (0.162.1, shared-server
  mode: no rollout at launch, unlike B0's embedded-mode run), so a peer
  message to a never-prompted Codex tab reads `undeliverable` with "give it a
  first task", never a guess at its terminal.
- **Codex runs a queued message back to back with the running turn**, with
  no idle gap to call a turn start, so a `queued` Codex message also settles
  when the recipient has run and then gone idle.
- **Codex's workspace-write sandbox turns network off by default**, so a
  Codex Agent in Ask-first or Auto mode is expected to ask to escalate before
  `exawatt send` reaches the loopback (not yet measured; the live probe runs
  YOLO). The MCP door (B2) runs outside that sandbox.
- Codex leaves a managed app-server daemon running from whatever home it ran
  in; the live probe stops the one it started.

### 2026-10-15 — B3 Team dock and the Chatter tab (packet P4, second landing)

**Chatter is the second tab of Team's dock, over Demo and Live through one
client.** The first landing (`0364bb14`) put the renderer bus client in
`src/lib/bus/`; this one builds the viewer on it.

- **The dock.** `src/components/team/team-dock.tsx` owns the frame the
  roadmap panel used to own: width (320, 420 while it holds focus), docked at
  ≥1100px and a drawer below, the focus ring and esc hint, and an ARIA tab
  strip (←/→ switch, Shift+Tab from a panel reaches it). Inactive panels stay
  mounted and hidden, so a tab switch keeps a panel where it was left. The
  last tab is remembered per window. Summons go through
  `team-dock-summon.ts`: ⌘B, the palette row and the native menu open the
  dock on its last tab (the verb is now "Roadmap and Chatter"); the context
  chip names a roadmap item, so it opens Roadmap drilled into it.
- **Boy Scout.** `roadmap-rail.tsx` became `roadmap-panel.tsx`
  (`RoadmapPanel`, `data-roadmap-panel`), content only. The collapsed strip
  and the Terminal-docked mode had no production caller since S12 and are
  deleted, as is an unreferenced drill event; the roadmap lab renders the
  panel in a dock-width frame. Every reference moved (evals, the stale-async
  ratchet, the Demo test); nothing aliases the old names.
- **Chatter.** `src/components/team/chatter/`: one row per message, newest
  first (`ChatterRow`, the small component to iterate on: sender → recipient
  with harness marks, first line, age, a delivery mark with the reason on
  hover; the operator's own messages read "You"); a thread of the pair's
  messages plus the operator's messages to either, oldest first, two lines
  each, opened in place with Exawatt's stamp (from, to, harness, Project,
  sent, result); Send as operator to either Session of the pair with the
  delivery result or the refusal shown where it was sent. Names are the
  tile's label until P8's short names land. Unread is the badge on the tab;
  showing the list moves the reading position, and rows keep a dot for what
  arrived since the last look. Unavailable, empty, loading and a failed read
  are four different renderings.
- **Demo.** The Demo Workspace provides the Demo client to Team, and its
  palette and menu Roadmap verb now opens the dock (it had no listener, so
  the row did nothing in Demo).
- **Specimen.** `/hud-gallery/team-dock` renders the production dock with
  both panels over Demo data, every delivery result as a row, and the four
  panel states.
