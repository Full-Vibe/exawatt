# 0004 Keep Product Vocabulary Literal and Utilitarian

Status: accepted

Date: 2026-07-01

## Context

Gastown (Steve Yegge) demonstrates that an abstract, opinionated metaphor vocabulary (Mad Max roles, heavy-industry nouns) can work for orchestrating hundreds to thousands of agents, and the 2026-06-24 Kevin Ridsdale conversation raised whether Exawatt should adopt similarly abstract analogies for its product nouns — the argument being that at fleet scale, literal nouns like "project" start to feel odd for a pocket of a thousand workers against one goal.

Current canon (`docs/product/concepts.md`) uses literal terms: Workspace, Initiative, Project / Context Group, Agent, Session, and so on.

## Decision

Stick with literal, utilitarian vocabulary for canonical concepts for now. Do not introduce themed metaphor nouns into product canon, UI labels, or docs.

One scoped exception: the energy/wattage framing (tokens as metered energy) is canonical narrative because it is load-bearing in the product name and the Consumption model. It is a framing for how resources behave, not a renaming of concepts — an Agent stays an Agent.

Explicitly leave the option open: a future decision record may introduce a more abstract or opinionated vocabulary layer if literal terms stop fitting, most plausibly for fleet-scale grouping nouns where "project" breaks down.

## Consequences

- UI labels and docs keep using the terms in `docs/product/concepts.md`.
- Contributors and agents should not introduce themed jargon into product surfaces.
- Revisit trigger: when fleet-scale grouping (hundreds to thousands of agents per goal) makes literal nouns feel wrong in real usage, open a new decision record rather than drifting informally.
