# 0011 Repo-canonical roadmap convention, published and parsed

Date: 2026-07-11
Status: accepted

## Context

ENG-017 needs to read each Project's roadmap/queue from that Project's repo.
The original scope line said "stay format-tolerant rather than inventing a
proprietary format," but a survey of the operator's real repos found six
mutually incompatible roadmap shapes (Now/Next/Later ENG items, table
backlogs with ID/Status columns, phase headings with emoji statuses,
milestone headers, version headers with checklists). A parser tolerant of
all of them would guess constantly and be honest never. In the design
interview (2026-07-11) the operator resolved the tension: Exawatt publishes
a definition format that compatible repos adopt.

## Decision

- Exawatt publishes the **Exawatt roadmap convention v1**
  (`docs/product/reference/roadmap-convention.md`): a plain-markdown grammar
  — queue sections `Now/Next/Later/Shipped/Parked`, `### <ID> <Title>`
  items, `Status:` lines resolved through a published alias table, labeled
  `Scope:`/`Exit criteria:`/`Milestones:`/`Project doc:` blocks, optional
  `exawatt-roadmap: v1` frontmatter marker.
- The convention is **pure markdown with no sidecar**. Agents author
  roadmaps as markdown; a parallel machine file (yaml/json) would drift the
  day an agent edits the markdown, and read-only Exawatt could not resync
  it.
- The parser (in `@exawatt/core`) is **tolerant within the published
  grammar and diagnostic-honest outside it**: the alias table is the only
  leniency; unrecognized structure produces counted diagnostics with line
  anchors and is never guessed into items. The parser does not learn legacy
  formats — existing repos adapt via the migration guide in the spec.
- Exawatt's own `docs/engineering/roadmap.md` is conformant through the
  alias table with zero edits, which is the existence proof that the
  convention costs nothing to author.

## Consequences

- "Roadmap state lives in the repo; Exawatt visualizes it" gets a concrete
  contract both sides (authoring agents, the lens) can target.
- Sibling repos need a one-shot adaptation edit each (ENG-017 S5 validates
  the migration guide against two or three of them).
- The lens can trust what it renders and say exactly what it could not
  read, which is the trust posture the read-only v1 requires.
- Future format evolution has a versioning seam (the frontmatter marker).

## Alternatives rejected

1. Format-tolerant parsing of every observed convention. Guessy by
   construction; every wrong guess erodes the lens's authority, and each
   new repo shape grows the heuristic pile.
2. A machine-readable sidecar (`roadmap.yaml`, `.exawatt/roadmap.json`).
   Second source of truth; drifts immediately under agent edits; violates
   "durable, malleable, repo-canonical" markdown authoring.
3. Frontmatter-heavy markdown (per-item YAML metadata). Closer, but makes
   the roadmap worse to read and edit as a document — the roadmap must stay
   a first-class human/agent doc, not a database in disguise.
