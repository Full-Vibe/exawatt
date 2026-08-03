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

- **C1 Coordination viewer** — the Exawatt surface that shows inter-agent traffic and assignments for a Project, designed and demo-able under ENG-026's `preview` grammar before real traffic exists. First because it is the demo answer to "how do you think about handoff between agents?" and because it defines what the substrate must produce.
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

## Sources

- [Blackboard-driven multi-agent coordination (ARIADNE, arXiv 2605.02431)](https://arxiv.org/pdf/2605.02431)
- [The Orchestration of Multi-Agent Systems: Architectures, Protocols, and Enterprise Adoption (arXiv 2601.13671)](https://arxiv.org/html/2601.13671v1)
- [Sleep-time Compute (arXiv 2504.13171), via Letta/Berkeley coverage](https://www.mindstudio.ai/blog/claude-dreaming-feature-self-improving-agent-memory)
- [OpenClaw Auto-Dream — periodic consolidation with candidate stores and rollback](https://github.com/LeoYeAI/openclaw-auto-dream)
