# 0001 Retire Godot/Helios As Active Architecture

Status: accepted

Date: 2026-05-24

## Context

The repo previously explored a Godot-based V2 interface under the codename Helios. That work captured useful product thinking about high-resolution fleet command, focus views, and game-inspired interfaces.

The current product direction is Exawatt: an Electron desktop app and future hosted interface layer for commanding agents from any compatible source.

## Decision

Retire Godot/Helios as active architecture.

Preserve useful historical thinking in `docs/archive/`, but remove active Godot project files and remove Helios/Godot from current roadmap and architecture docs.

## Consequences

- Exawatt remains the product name.
- Electron and Next.js are the active application stack.
- Game-development interface thinking can still inform design quality, density, animation, and zoomable fleet command.
- Future architecture docs should not describe Godot or Helios as active work unless a new decision supersedes this one.
