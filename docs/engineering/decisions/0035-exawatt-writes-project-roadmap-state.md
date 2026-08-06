# 0035 Exawatt may write a Project's roadmap state

Date: 2026-08-03
Status: accepted

## Superseded numbering

This record was drafted as `0027`, renumbered to `0029`, and is now **`0035`**.
Both renumberings resolved collisions with records that had already been
committed: `0027-model-freedom-through-harness-plurality.md` first, then
`0029-opt-in-aggregate-telemetry-for-public-agentmaxxing.md`, which landed
earlier in git history and therefore keeps `0029`. `0035` is the next free
number after `0034-proxied-analytics-ingest.md`. The number is settled; do not
renumber it again. Any surviving reference to "decision `0029`" that concerns
roadmap-state writes, ENG-017, or the project roadmap lens means this record.

## Context

ENG-017 has been read-only since S0. Its scope says plainly: _"read-only first: no editing or assignment from Exawatt; declared links are machine-local view annotations, never repo writes."_ S10 kept the manipulable gestures gated for a year of milestones, and S13.5 recorded that reordering and status transitions would be repo writes needing their own decision rather than an inherited assumption.

On 2026-08-03 the operator lifted that gate directly: _"Yes indeed, manipulate roadmap state in the repo. Maybe pop a permission dialog with always allow / don't ask me again."_

The enabling fact is that the parser already carries a `RoadmapSourceRef` (file + 1-based line) on every item and every milestone, so a status flip or a milestone tick is a single known line, and a queue move is a block between two known headings. Surgical edits do not require re-serializing the document.

## Decision

Exawatt may write a Project's `roadmap.md`, under five constraints.

### 1. Scope is sequence and state — never prose

Permitted:

- move an item within the queue
- change an item's status (now / next / later / parked)
- tick or untick a milestone's done-state

Not permitted: editing scope, exit criteria, descriptions, or any prose; creating items or milestones. The roadmap file's contract is written **for agents**, and an agent editing it in full prose is already how every item advances. Exawatt manipulates the queue; it does not become a markdown editor for a document it does not author.

### 2. Writes require declared conformance

Exawatt writes only to a roadmap that **declares conformance** to the published convention (`docs/product/reference/roadmap-convention.md`). A merely-tolerated file — one the parser read on a best-effort basis — is read-only, because surgical edits against structure the parser guessed at is how a canonical file gets corrupted.

This makes the operator's own framing load-bearing: an Exawatt-ready repo is _manipulable_, and a non-conforming repo visibly is not, with a remediation path rather than a silent downgrade (ENG-017 S13.6).

### 3. Exawatt writes the file and never runs git

The edit lands in the working tree as an ordinary modification, exactly as if the operator had made it by hand. ENG-019's rule — _Exawatt coordinates and displays but never runs git on the agent's behalf_ — survives unchanged.

The operator's phrase "while the commit is happening" (2026-08-03) is read here as **the write being applied**, not as authorization for Exawatt to run `git commit`. Making Exawatt commit is a separate reversal of ENG-019 and needs its own explicit decision; do not infer it from this one.

### 4. Permission rides the Project's existing launch policy, behind its own seam

The write obeys the Project's established Ask first / Auto-review / YOLO policy (ENG-016 D14), so the operator reasons about one permission per Project rather than two.

Per the operator's instruction to _"architect such that we can change this in the future"_, roadmap-write permission is nevertheless modeled as its own named permission whose default resolver reads the launch policy. Separating them later is then a resolver change, not a refactor. The recorded reservation stands: an operator editing their own roadmap and an agent being allowed to act are genuinely different questions, and folding them together may not survive contact with multiplayer (ENG-034) or managed Workspaces (ENG-012).

### 5. Concurrency: refuse, never merge

Agents edit this file too, and the lens already watches it (S5). Every write re-reads the file and verifies it is unchanged since the parse the operator acted on. If it moved, the write is refused and the lens re-renders with the new truth. Exawatt never merges, never force-writes, and never resolves a conflict on the operator's behalf.

### 6. The operator sees what happened

- the change **animates in place** — the row moves, or the status visibly flips, so the edit is watched rather than discovered
- an **inline pending / applied / failed** affordance during the write, in place, not as a toast
- a **short undo window** immediately after, which reverses the edit in the file

### Implementation hardening (2026-08-03 review)

The compare/refuse boundary is a per-real-file transaction, not two unrelated
reads around an uncoordinated write. Exawatt serializes its own writes and undo,
revalidates the parsed semantic target inside that transaction, and atomically
replaces the markdown file. Real-path containment rejects a Project-local
symlink whose target escapes the Project.

The parser is also the writer's structural authority. A declared id must resolve
to exactly one item; a milestone line must be one of that item's parsed
`Milestones:` entries; compact backlog metadata and shipped history are
read-only; and reordering requires the item's effective status to agree with its
physical section. These rules keep renderer mistakes from widening the main
process's sequence/state-only capability.

## Consequences

- ENG-017's read-only posture is now partial, not absolute: the lens reads everything and writes a narrow, structural subset. The exit criterion that matters — _"the visualization reads from repo state; deleting Exawatt loses no project state"_ — is untouched, because everything Exawatt writes is the repo's own vocabulary in the repo's own file.
- A dirty working tree can now originate from Exawatt. `pnpm agent:land` deliberately refuses dirty worktrees, so an operator reorder mid-session can surprise a landing agent. Surfacing the modified-file state was deliberately NOT chosen by the operator; if that surprise materializes in dogfood, revisit it here rather than adding a silent auto-commit.
- Conformance becomes user-visible and consequential, not just a parser diagnostic.

## Alternatives considered

- **Ask a running agent to make the edit.** Perfectly consistent with existing canon and far too slow — the operator is changing three characters, and an agent round trip is seconds-to-minutes with nondeterministic results.
- **Write and commit.** Cleaner repository state, and it reverses ENG-019 as a side effect of a UI convenience. Rejected as a side effect; available as its own decision.
- **A global Settings toggle instead of a dialog.** Rejected: the first write is the moment consent is meaningful, and a toggle buried in Settings is not present at that moment.
- **Full prose editing.** Rejected: it makes Exawatt the author of a document written for agents, and formatting drift in a canonical file is expensive and silent.
