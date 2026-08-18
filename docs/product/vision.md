<!-- Generated for the public repository by the "public-document-set" recipe. -->
# Exawatt Vision

Exawatt is the modern interface layer for commanding fleets of agents.

The near-term problem is immediate and practical: current individual-agent control interfaces are too geeky, too low-level, and too hard to trust. OpenClaw is the first target because its local agent UI does not yet give operators a clear, beautiful way to understand what agents are doing, redirect them, inspect their work, or operate them continuously.

The long-term problem is larger: agent workforces will grow from one or two agents into fleets of hundreds, thousands, and eventually more. Humans need an interface that can zoom from high-level initiatives and resource allocation down to a single agent session, decision, artifact, or approval.

Exawatt should make agent operation accessible enough for a non-technical person to set an Initiative and trust agents to work against it, while remaining powerful enough for an organization to operate large digital workforces with spend controls, secrets, context signals, approvals, and auditability.

At that scale Exawatt becomes more than a viewer: it is the organizational
substrate and eventually a compatible Harness for thousands of Agents acting in
the real world. It must let operators distinguish what an Agent intended, what
it attempted, what actually happened, which authority permitted it, which
system enforced the limit, and what evidence supports the outcome.

The path there is graduated. Near term, harness manufacturers provide the
security boundary and users bring their chosen security model; Exawatt makes
that posture and the available activity legible. Future Exawatt governance may
mediate high-impact actions and safely admit less-trusted Agents, but those
integrations are not near-term scope.

The interface should reduce the cost of context switching by clustering related agent work and surfacing only the highest-leverage human decisions. Those decisions should be framed as taste, value, priority, or conflict-resolution choices whenever possible, not as low-level supervision.

## Product Direction

Exawatt is an Electron desktop app and future hosted interface layer for commanding agents from any compatible source:

- local OpenClaw
- hosted OpenClaw
- Codex
- Claude Code
- custom harnesses
- Demo Mode

OpenClaw local control is the first implementation target, not the product boundary.

## Product Principles

1. **Source-agnostic agent control.** Exawatt commands agents from many harnesses through common concepts.
2. **Demo Mode is first-class.** Collaborators and users should be able to experience the product without live agents, using the same UI layers.
3. **High resolution control.** Users can macro-manage Initiatives and resource allocation or zoom into one Agent Session.
4. **Trust through truthful assurance.** Decisions, artifacts, consumption,
   context, approvals, and agent activity should be visible and inspectable.
   Exawatt distinguishes source-reported, observed, authorized, enforced, and
   verified facts rather than implying guarantees it does not provide.
5. **Architect 10 miles ahead, build one mile at a time.** The model should anticipate hosted and multi-source fleets while implementation starts with local OpenClaw.
6. **Mom-friendly language, power-user depth.** The product should explain itself without exposing low-level plumbing by default.
7. **High-leverage decision routing.** The system should ask for human attention at meaningful leverage points, using recommended paths and orthogonal decision prompts to constrain agent work without dragging the user into every detail.
8. **The whole map is visible.** (operator, 2026-08-02) The real app shows its complete intended information architecture — including surfaces and affordances that are not built yet — so the product communicates the vision as it is used, and visibly expands as the roadmap lands. Forthcoming capability carries a subtle-but-clear grammar: muted presence with an explanatory tooltip or similar, never jammed-in copy, never fake data, never a simulated live capability — principle 4's truthfulness always holds. Demo Mode may show the same surfaces populated. Continuous demoing to users, enterprise customers, and prospective contributors is a standing posture, not an event.

## Strategic Posture (operator, 2026-08-02)

Positions taken during the 2026-08-02 grooming session. They are canonical direction, deliberately held loosely — the operator expects them to evolve.

### Energy is true north, correctly deferred

The energy framing — allocating wattage to goals rather than tasks to agents (ENG-014) — is the genuine long-range thesis and the company's name. It is also **not yet earnable**: presenting watts as measured before the data supports it would violate principle 4. Energy therefore lives in naming, marketing, and the concept model now, and the product earns it as Consumption normalization matures (ENG-008 E3). Do not fabricate watts to make the metaphor land sooner.

### The repository is the project substrate — not a coding artifact

Synthesized from the operator's own framing: _"it makes sense for any given project to have a repo for state, even if not just coding."_

This resolves what looked like a fork between "coding-first" and "work-shaped". It is neither:

- **The state model is work-shaped.** A Project is a durable, versioned, portable workspace — which is usually a git repo. A marketing Project has a repo because git is an excellent state store, not because anything compiles. Briefs, campaigns, decisions, roadmaps, and the ENG-029 blackboard all live there the same way code does. `Project` must never quietly come to mean "codebase".
- **The harness mechanics stay coding-first.** Worktrees, branches, and diffs are properties of _coding harnesses_, not of Projects. They must not be forced onto a research or marketing Agent, and they must not leak into the Project model.

The practical rule for agents: repo-native is correct and should deepen; repo-native _as a coding assumption_ is debt. When a new capability assumes a build, a branch, or a diff, record it as a coding-harness mechanic rather than a Project truth.

## Reference Use Case

The founding operator's real daily workflow (macOS Spaces → one terminal
window per initiative → many tabs, several running coding agents in git
worktrees) is documented in `docs/product/operator-workflow.md`. It is the
canonical near-term dogfood target: replicate it 1:1, then improve it
incrementally on the way to fleet scale.

## Near-Term Outcome

The first product milestone is a simplified, beautiful pseudo-parity interface for a local OpenClaw instance:

- agent/session list
- focus/chat view
- cron/heartbeat visibility
- tool/activity events
- semantic clustering of related agent work
- history
- stop/abort/send-message controls
- health/config visibility
- Live Mode and Demo Mode using the same UI architecture

## Long-Term Outcome

Exawatt becomes the command center for large agent fleets:

- Workspaces contain Initiatives.
- Initiatives are pursued by Agents.
- Agents operate through Sessions.
- Context Signals feed useful state into work.
- Decisions accumulate at the right scope.
- Consumption is tracked across cost, tokens, energy, time, tool calls, and compute.
- Policies, budgets, approvals, secrets, and credentials govern safe operation.
- Local and hosted harnesses are unified behind Agent Source adapters.
- Managed Workspaces can impose ceilings no personal setting or Agent can
  bypass.
- Provider-owned security can graduate into Exawatt-mediated enforcement
  without replacing the source-agnostic product model.
