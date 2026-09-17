# 0040: Delegation observation health is independent of turn truth

- Date: 2026-09-16
- Status: accepted
- Roadmap: ENG-023 D5.1 / BUG-133 half 2

**Preserve verified children and disclose missing authority on the source.**

Codex's read-side server can refuse a lifecycle method needed for ambiguous
externally owned turns. Losing that authority does not mean the children ended
or the parent finished. A root-wide failure discards unrelated valid evidence;
keeping last-known children instead would invent current life.

Each root's lineage read establishes membership; each child turn read establishes
its own lifecycle; ambiguous children depend on their immediate parent's activity
read. A failure withdraws only the claims depending on that read. Reconciliation
remains atomic and completion requires positive source evidence.

Observation coverage has a separate owner and source-agnostic projection:
complete, partial, unavailable. It spans active Sessions, distinguishes empty
success from failed observation, and drops exited/reidentified observations.
The source's existing Settings Delegation row shows the observed fact, provenance
and explanation. It does not alter source launchability or the parent turn model.
Provider version labels come from the protocol; actual responses determine health.

This supersedes D5's whole-root failure for child reads. Root lineage/connection
loss still withdraws the root. No fallback to terminal bytes, files, process trees,
last-known membership, or version blacklists is authorized. D7's census/lifecycle
owner remains intact. Harness context injection and aggregate/filter population
repair are separate scopes.
