# Exawatt roadmap convention (v1)

The Exawatt roadmap convention is a markdown grammar for a repo-canonical
roadmap. A repo that follows it gets a live roadmap lens in Exawatt: the
queue of work, what each agent session is executing, and what comes next —
read directly from the repo's own docs. The roadmap stays canonical, durable,
and malleable in the repo; Exawatt reads it and never writes it.

The convention is deliberately plain markdown. Agents and humans author the
roadmap exactly as they would without Exawatt; there is no sidecar file, no
YAML manifest, and no generated artifact to keep in sync.

## Discovery

Exawatt looks for the first existing file, in this order, from the repo
root:

1. `ROADMAP.md`
2. `docs/engineering/roadmap.md`
3. `docs/ROADMAP.md`
4. `roadmap.md`

## Conformance marker (optional)

A frontmatter block may declare the convention explicitly:

```markdown
---
exawatt-roadmap: v1
---
```

With the marker, Exawatt treats the file as `declared` conformant. Without
it, a file whose structure matches the grammar is `detected`. The marker is
recommended once a repo adopts the convention — it makes intent unambiguous
and lets future versions evolve safely.

## Grammar

### Queue sections

Level-2 headings partition the queue and set the default status of the items
inside them. Recognized section names (case-insensitive; trailing decoration
after the name is ignored):

| Section heading | Default status |
| --- | --- |
| `## Now` (or `## Current`) | `now` |
| `## Next` | `next` |
| `## Later` (or `## Backlog`, `## Future`) | `later` |
| `## Shipped` (or `## Done`, `## Completed`) | `shipped` |
| `## Parked` (or `## Icebox`) | `parked` |

Content under any other level-2 heading (vision statements, operating
models, status legends) is documentation, not queue state; Exawatt ignores
it silently.

The queue is linear in v1: within `now`/`next`/`later`, document order is
queue order. One `now` item at a time is the intended shape — the lens
treats the first non-done item as the active station.

### Items

An item is a level-3 heading inside a queue section:

```markdown
### ENG-017 Project roadmap lens
```

The leading token is the item id when it matches `[A-Z][A-Z0-9]*-<digits>`
(`ENG-017`, `P0-03`, `ACME-7`). Ids are how sessions link to items — branch
names, worktree paths, and session goals that mention the id link
automatically — so give items ids. A heading without an id is still a valid
item; it gets a synthetic slug and links only by title match (weaker).

### Status line

The first `Status:` line inside an item overrides its section's default
status. The first word after `Status:` is the status token; everything after
it is a free-form status note that Exawatt displays verbatim.

```markdown
Status: active-build — design resolved 2026-07-11 (operator interview).
```

Status token aliases (case-insensitive):

| Canonical | Accepted tokens |
| --- | --- |
| `now` | `now`, `active`, `active-build`, `in-progress`, `building` |
| `next` | `next` |
| `later` | `later`, `backlog` |
| `shipped` | `shipped`, `done`, `complete`, `completed`, `landed`, `✅` |
| `parked` | `parked`, `stale`, `deferred`, `paused`, `on-hold` |

Two tokens are position-neutral — they carry lifecycle information and keep
the section's queue status:

- `planned` means "not started"; where it sits in the queue comes from its
  section (`planned` under `## Next` stays a next item).
- `blocked` sets an orthogonal blocked flag the lens renders as a badge.

An unrecognized status token keeps the section default and surfaces as a
diagnostic — Exawatt reports what it could not read instead of guessing.

### Labeled blocks

Inside an item, these labels begin bullet blocks (label on its own line,
bullets following, blank lines allowed between):

```markdown
Scope:

- what the item covers

Exit criteria:

- how we know it is done

Milestones:

- [x] S1 Convention + parser
- S2 Read-only rail (landed 2026-07-11): rail, states, trust strip.

Project doc:

- `docs/engineering/projects/project-roadmap-lens.md`
```

Milestone bullets may carry a short id token (`S2`, `D4`, `M10`). A
milestone is done when its checkbox is checked (`- [x]`), when its text
contains a `(landed …)` or `(shipped …)` marker, or when it carries `✅`.

All other prose inside an item (paragraphs, `Sequencing:` notes, extra
labeled lists) belongs to the item as description text. It is preserved,
never treated as an error.

## A minimal conformant roadmap

```markdown
---
exawatt-roadmap: v1
---

# Acme roadmap

## Now

### ACME-003 Billing export

Status: now — started 2026-07-02.

Scope:

- CSV export of invoices

Exit criteria:

- finance downloads the month-end CSV without engineering help

Milestones:

- [x] M1 schema
- [ ] M2 export endpoint

## Next

### ACME-007 Webhooks

## Later

### Dark mode

## Shipped

### ACME-001 Auth
```

## What Exawatt does and does not do

- Exawatt reads the roadmap and links live agent sessions to items by
  inference (branch, worktree, session goal, commit subjects) and by
  optional declare-at-launch. Link confidence is always visible.
- Exawatt never writes the file, never reorders the queue, and never
  assigns work in v1. The only edit path is opening the file in your
  editor.
- Unrecognized structure is reported honestly (`showing 7 recognized
  items · 3 lines unrecognized`), never silently dropped or guessed at.

## Migrating an existing roadmap

Written for the agent doing the adaptation:

1. Partition existing content under the five queue sections. Work in
   flight goes under `## Now`, the ordered queue under `## Next` and
   `## Later`, history under `## Shipped`, deliberate deferrals under
   `## Parked`.
2. Make each work item a `### <ID> <Title>` heading. Mint stable ids with
   a short repo prefix (`ACME-1`, `WEB-14`) if none exist; keep existing
   ids (ticket numbers, `P0-03`-style) if they match the id shape.
3. Move per-item detail into the item: a `Status:` line where the section
   default is not enough, `Scope:` / `Exit criteria:` / `Milestones:`
   blocks where the material exists. Prose can stay as prose.
4. Tables, checklists-as-roadmap, and phase headings do not parse —
   convert them. A table row becomes an item heading; a checklist becomes
   `Milestones:` under the item it details; a `### Phase N` heading
   becomes an item with an id.
5. Add the `exawatt-roadmap: v1` frontmatter marker.
6. Keep everything else (vision, legends, decision logs) under its own
   non-queue headings — it is ignored and does no harm.

The parser does not learn legacy formats; adaptation is a one-shot edit per
repo, and the roadmap stays fully readable without Exawatt.

## Reserved for future versions

- Multi-track roadmaps: a future frontmatter key may point at multiple
  queue files or name parallel tracks. v1 is one linear queue per repo.
- Non-code work classes (marketing, outreach, inbox queues) flow through
  the same grammar when they arrive; nothing in v1 is code-specific.
