# Live Mode And Demo Mode

Exawatt supports Live Mode and Demo Mode as first-class product modes.

## Live Mode

Live Mode connects to real Agent Sources:

- local OpenClaw
- hosted OpenClaw
- Codex
- Claude Code
- custom harnesses

The first implementation target is local OpenClaw control.

## Demo Mode

Demo Mode uses simulated, recorded, or curated data sources to exercise the same UI. It exists so Exawatt can be shown and tested without live agents.

Demo Mode is part of the product architecture, not just a development shortcut.
It should emit the same activity, policy, Approval, evidence, and assurance
shapes as Live Mode, while clearly identifying simulated provenance. Demo Mode
must not imply that an effect occurred in the real world.
