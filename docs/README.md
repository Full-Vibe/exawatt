<!-- Generated for the public repository by the "public-document-set" recipe. -->
# Exawatt Docs Map

This directory stores product, engineering, research, reference, and archived project knowledge for Exawatt.

## Canon

- `docs/product/concepts.md`: canonical product vocabulary and object model.
- `docs/product/vision.md`: durable product vision.
- `docs/product/demo-mode.md`: Demo Mode product architecture and expectations.
- `docs/engineering/architecture.md`: canonical engineering architecture.
- `docs/engineering/roadmap.md`: singular engineering roadmap, status index, and conflict-resolution surface.
- `docs/engineering/decisions/`: durable architecture and product engineering decisions.

## Engineering Execution

- `docs/engineering/projects/`: deeper execution detail for roadmap items. These docs may hold milestones, acceptance criteria, design constraints, implementation notes, and future agent work packets, but they must remain owned by roadmap items.
- `docs/engineering/incidents/`: what broke in a running build, how it was proven, and which hypotheses were falsified. Evidence and method, not plan. Read before re-diagnosing a familiar symptom; see that directory's `README.md` for when to add one.

## Product Docs

- `docs/product/guides/`: customer-facing or future customer-facing how-to guides.
- `docs/product/reference/`: public-safe product concept reference. These files can explain concepts in more depth, but `docs/product/concepts.md` remains the canonical vocabulary source.

## Evidence And Inputs

- `docs/references/`: external visual, technical, or market references. Treat these as inspiration or supporting material, not canon.

## Archive

- `docs/archive/`: retired or superseded thinking. Do not treat archived material as active direction unless a current roadmap item and decision record explicitly revive it.

## Update Rule

When a change affects product meaning, architecture, roadmap sequence, or durable tradeoffs, update the canonical doc at the same time as the implementation or project doc. If two docs disagree, resolve the disagreement instead of adding a third plan.
