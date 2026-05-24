# Exawatt

Modern interface layer for commanding fleets of agents.

## Product

Exawatt is an Electron desktop app and future hosted interface layer for commanding agents from any compatible source:

- local OpenClaw
- hosted OpenClaw
- Codex
- Claude Code
- custom harnesses
- Demo Mode

## Current Direction

- First target: simplified pseudo-parity UI for local OpenClaw.
- Next: source-agnostic Agent Source / Harness adapter layer.
- Product primitives: Workspace, Initiative, Agent, Session, Decision, Context Signal, Consumption, Approval, Policy/Budget.
- Demo Mode: first-class forever, exercising the same UI layers.

## Canonical Docs

- `docs/product/vision.md`
- `docs/product/concepts.md`
- `docs/product/demo-mode.md`
- `docs/engineering/architecture.md`
- `docs/engineering/roadmap.md`
- `src/lib/architecture/manifest.ts` powers `/overview`

See `AGENTS.md` for the documentation contract.
