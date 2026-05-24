# 0002 Make Demo Mode First-Class

Status: accepted

Date: 2026-05-24

## Context

Exawatt needs to operate real agents, but it also needs to be demonstrable to investors, collaborators, and users without requiring live agent infrastructure.

The repo already contains a Supabase-backed animated demo flow for dashboards and boards.

## Decision

Demo Mode is a first-class product mode forever.

Demo Mode should exercise the same UI and command layers as Live Mode through lower-level Agent Source / data-source adapters.

## Consequences

- Demo code should not be treated as disposable.
- Demo data must be clearly separated from live user data.
- The current Supabase demo flow is preserved as `legacy-supabase-task-demo`.
- Future demo implementations should normalize into the same Workspace, Initiative, Agent, Session, Event, Decision, Artifact, and Consumption concepts as Live Mode.
