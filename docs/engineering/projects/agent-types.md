# ENG-028 Agent Types

Owning roadmap item: `docs/engineering/roadmap.md` → ENG-028. Execution detail, not an independent roadmap.

Source: the 2026-08-02 operator brief and design pass C the same day.

## Direction

From the brief:

> "Right now I use Exawatt for 100% coding... in the future we need to support all types of agents. So marketing functions, communication, coordination, finance, research, etc. Maybe this looks like a meta-harness layer of context that wraps a Claude Code (or something) subharness with some System prompt, SOUL.md, set of tools and permissions... Like an Agent Type. For example, I want my company's Design Engineer / Chief Design Officer / Designer to participate in others' front-end work, ensuring that all new UI surface either adheres to the style guide, or deliberately improves it as a reviewer / collaborator gate. I want to be able to talk to my Designer over time. I want him to get better and improve automatically over time."

And:

> "Perhaps our UI should convey which *type* of agent is running a given project, not just which harness happens to be orchestrating it."

That last sentence is the product claim: **the harness is the engine; the Type is the worker.** Today Exawatt's UI says "Claude Code" where it should eventually say "your Designer, running on Claude Code."

## What an Agent Type is

A named, portable bundle that Exawatt applies at launch:

- identity — a `SOUL.md`-style statement of who this worker is, not what task to do
- instructions and standing responsibilities
- required tools and permissions
- default model and reasoning effort
- (later) accumulated self-knowledge that improves over time

**Mechanism already proven.** ENG-023 D1 verified that Exawatt can inject per-launch settings into Claude Code via `claude --settings <file>` — settings that MERGE with the user's own project hooks rather than clobbering them, written into Exawatt's own state directory, never mutating `~/.claude`. That is exactly the injection seam an Agent Type needs. ENG-016 D35 already crosses a typed launch boundary carrying model and effort. Types extend an existing path rather than inventing a meta-harness.

**Storage.** Types are repo-storable *and* portable across projects; the operator explicitly rejected the framing that those are mutually exclusive. Design toward a documented file format so a Type can live in a project repo, follow the operator between projects, and eventually be shared or vended by others.

## Portability across harness classes

The operator raised the real problem: a Designer on Claude Code (files, git, code) and a Designer on OpenClaw (messaging, browsing, general purpose) are not the same worker, and this industry is young enough that any fixed answer will be wrong. The instruction was **architect for change.**

Accepted approach: **Types declare what they require; sources declare what they can do.** ENG-003 already models per-source capability truth, including the distinction between installed-or-advertised capabilities and capabilities actually connected to a live Session. Launching a Type onto a source that cannot satisfy it shows exactly what is missing instead of silently degrading into a worse worker wearing the right name. No new concept; one existing concept used at a second altitude.

## On SOUL.md and self-improvement

The operator cited OpenClaw's default SOUL.md — *"You're not a chatbot. You're becoming someone."* — for its depth and future-facing leverage. Researched 2026-08-02: SOUL.md is deliberately not a system prompt. System prompts say what to do; soul files say who to be. The template carries three sections — **Core Truths**, **Boundaries**, **Vibe** — and closes with "This file is yours to evolve. As you learn who you are, update it," with the convention that the user is told when the agent changes it.

Two properties Exawatt should inherit:

1. **Self-authorship with disclosure.** A Type may evolve its own identity file, and the operator is always shown what changed. Silent self-modification is not acceptable in a product that sells truthful assurance (vision principle 4).
2. **Improvement is a reviewable proposal, not an unlogged mutation** — the same constraint the coordination consolidation pass inherits from sleep-time-compute research (ENG-029 C5).

Talking to your Designer over time — the operator's stated want — is a durable Type-scoped conversation that outlives any single Session. That is a real design problem: Sessions are the current unit of conversation, and a Type-scoped thread crosses them. Deliberately left unshaped here.

## Scaling a Type

The brief asks how a Designer serves many Projects at once — "clones or delegates for high-bandwidth work... some notion of horizontal or vertical scaling." Note that ENG-023 already made delegation visible as fleet truth, so a Type that fans out is observable through machinery that exists. Shaping how a Type spawns and supervises its own instances is deliberately deferred.

## Milestones

- **T1 Agent Type preview** — LANDED 2026-08-02 (see the milestone log). The Agent Type chip as an ENG-026 `announced` affordance on Sessions cards, plus the `/agent-types` preview surface. Makes the product claim ("your Designer, running on Claude Code") visible before the mechanism exists.
- **T2 Type format and launch application** — the documented file format and the launch path that applies a Type through the existing settings-injection seam, with capability requirements declared against ENG-003 source truth.
- **T3 Reviewer/collaborator Types** — the operator's concrete first case: a Designer that participates in others' front-end work as a gate that either enforces the style guide or deliberately improves it.
- **T4 Type-scoped conversation and self-improvement** — talking to a Type across Sessions; evolution of its identity file as reviewable, disclosed proposals. Unshaped.

## Boundaries

- A Type never mutates the user's harness configuration (`~/.claude`, `~/.codex`); injection stays per-launch and inspectable, exactly as ENG-023 established.
- A Type never claims a capability its source cannot deliver.
- Types do not become a second permission system: launch policy remains ENG-016 D14's per-Project/harness Ask first / Auto-review / YOLO, enforced by the provider (decision `0016`).

## Roadmap milestone log

### T1 (landed 2026-08-02, inside ENG-026 N3–N5's change)

The `/agent-types` surface presents the concept over Voltaic's authored roster: the one-worker-two-engines claim (Engineer running on Claude Code and Codex, engines observed from `DEMO_BASE_AGENTS` fixture truth, never asserted), a Type spec sheet showing the portable bundle (identity / instructions / tools / defaults, with defaults derived as the roster's dominant model+effort), and the four-Type library where the non-coding desks carry a `preview desk` label so the direction never reads as shipped capability. Derivations live in `src/app/agent-types/model.ts`, test-enforced (partition of Projects and Agents, capability honesty, determinism). Entry point: a composer-source-row control beside the engine picker — where a Type will be chosen — navigating to the surface (the ⌘K preview-row pattern; not an announced chip, because it works).

The Type chip landed on **Sessions cards** as `AnnouncedChip size="micro"` beside the harness glyph: a source that declares a Type names it (the Demo Workspace's desks can), an untyped live Session shows the empty `Type` slot, shell sessions get none (a plain shell is not a worker). **Deliberately omitted: the tab-strip chip.** The D42-reviewed ribbon condenses tabs to 46px where the chip would erase the status glyph — the only state signal at that width — so "tabs" is served by the Session tab's context menu carrying the surface-adjacent affordances instead; revisit if the ribbon ever gains a roomier standing presentation. Recorded here so the omission is a decision, not a drift.
