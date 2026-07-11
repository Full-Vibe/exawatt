# 0010 Durable Project registry synced in Supabase

Date: 2026-07-10
Status: accepted

## Context

Projects (canon "Project / Context Group") were DERIVED, not stored: a Project
was resolved from a live session's directory (`project-resolve.ts`) and kept in
the local `workspace.json` only while it had a surviving tab. Killing the last
session forgot the Project — only `lastUsedDir` survived — so there was no way
to open or browse a Project that was not currently running one. The gap
surfaced in dogfood (ENG-015 S5). In code the concept was also mislabeled
`Initiative`, which canon reserves for the durable-goal primitive (ENG-005).

## Decision

- Projects become a durable, curated registry stored in Supabase
  (`public.projects`), user-scoped via RLS, synced across the operator's
  machines. The mislabeled `Initiative` code concept is renamed to **Project**.
- Identity/layout split: durable Project IDENTITY (name, color, resolved root
  path, git remote, recency, sort order, archive) lives in Supabase and SYNCS;
  the ephemeral session/tab LAYOUT stays local in `workspace.json` and does NOT
  sync — Machine A's live tabs must not materialize on Machine B — referencing
  a Project by its resolved directory.
- The canonical Project claims the `projects` table; the legacy demo kanban
  table is renamed `demo_projects` (its queries repointed via a PostgREST embed
  alias so the demo keeps working). The table is shaped for the general
  grouping via a `kind` discriminator; v1 only writes `kind='repository'` with
  a resolved root_path. A `resolution_rule` for inferred/semantic/customer/goal
  kinds is deferred until a second kind exists.
- Resolution bridge: launching a session best-effort upserts the Project by
  (user, resolved root path) and bumps recency; a registry failure (offline,
  signed out) never blocks launching.
- Open/browse UX: a native directory picker (⌘N, and a Browse control) opens a
  new Project; a ⌘K Projects group opens known Projects even with no live
  session. A Project whose root_path is absent on the current machine offers
  "locate on this machine" — re-bind the single root_path via the picker.

## Consequences

- A Project stays known with zero live sessions and syncs across the operator's
  machines; open/browse is possible without a running session.
- Registry writes run in the authenticated renderer under RLS and are
  best-effort, so offline/signed-out use never blocks the terminal.
- root_path is machine-specific but stored as one synced column; the "locate"
  flow re-binds it. Cross-machine path divergence is only partially handled
  until per-machine path bindings land.
- The registry is the shared source of truth the spatial board's Project zones
  (ENG-004) can read, not a terminal-only structure.
- Test infra mints a scoped session to exercise the authed registry path in
  automation (dev/NODE_ENV-gated `TestAuthBridge`, `EXAWATT_TEST_DIR` dialog
  hook); both are inert in production.

## Alternatives rejected

1. Keep Projects derived from sessions (status quo). Cannot open/browse a
   Project without a live session; forgets Projects when their sessions end.
2. Store the registry locally only (per-machine JSON). Simpler, but no
   cross-machine sync and no path toward the workspace-scoped product.
3. Name the physical table `context_groups` to avoid touching the demo.
   Considered (and briefly adopted), but the operator preferred the idiomatic
   `projects` name; the demo kanban is being buried (ENG-016) and the reclaim
   is mechanical, aided by a PostgREST embed alias.
4. Sync the session/tab layout too. Rejected — live tabs are machine- and
   moment-specific; syncing them would materialize one machine's processes on
   another.
