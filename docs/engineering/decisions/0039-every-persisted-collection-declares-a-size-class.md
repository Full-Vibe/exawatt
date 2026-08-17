# 0039 Every persisted collection declares a size class

Date: 2026-08-16
Status: accepted; first execution is BUG-031, BUG-032, BUG-033

## Context

Three defects, found in one read-only pass over the operator's real
`~/Library/Application Support/Exawatt`, turned out to be one shape.

| record | measured | the unbounded thing |
| --- | --- | --- |
| `workspace.json` | 4,836,360 B | 4,811,597 B of inline `data:image/jpeg;base64,…` goal visuals across 19 tabs |
| `consumption-scan/log-v1.jsonl` | 139,496,716 B / 173,571 lines | samples with no retention horizon; a per-file watermark's `seenSnapshots` reaching 191 KB on a ~190-byte record |
| `agent-model-catalogs.json` | 836,471 B | rows that are never removed, one per `(engine, shell, cwd)`, minted by every agent worktree |

Each is **a small-object store given an unbounded field**, and in each case the
unboundedness was invisible at the call site that created it:

- The layout is ids, titles, cwds, lifecycle, and the draft being typed. Every
  field on it rides one all-or-nothing write that fires 400 ms after a
  keystroke burst and on every tab switch. Nothing about `goalVisual?:
  GoalVisual | null` said "this field is a quarter of a megabyte".
- The consumption store DID have a bound — `compact()` rewrites the log from
  live state when the log exceeds twice the compacted size. But compaction
  bounds the LOG against the STATE, so it is only a bound while the state is
  bounded. Plan-window observations had a 14-day horizon; the samples beside
  them in the same store had none, so the compacted floor only ever rose.
- The catalog cache DID have a staleness rule — `read()` refuses a row past
  `CATALOG_MAX_AGE_MS`. But refusing to SERVE a row is not removing it.
  Staleness was treated as a display question, so nothing owned removal, and
  `clear()` had zero callers anywhere in the repository.

This is the storage sibling of incident `0010`: a path that can reach a wrong
state with nothing asserting it. `0010`'s version shipped an artifact nobody
read back; this version writes a record nobody bounds.

## Decision

**Every persisted collection declares a size class, and something owns
eviction.**

1. **State a bound.** Age, count, or bytes — a number, in the code, next to the
   collection. "It self-limits in practice" is not a bound. A bound whose only
   expression is a comment is not a bound.

2. **Enforce it where the value is WRITTEN, not where it is read.** Refusing to
   serve an expired row leaves it on disk. `read()` returning `null` past a TTL
   is a display rule; deletion is the storage rule, and only the write path
   (or an explicit sweep called from one) can perform it.

3. **Name the eviction owner.** Some component must be responsible for removal,
   and it must be the one that knows the retained set. For goal visuals that is
   the workspace save path, because only it sees every reference. For catalog
   rows it is the write plus a once-per-load sweep. For consumption samples it
   is the scanner's sink, where samples enter state.

4. **Anchor an age bound on the data, not the clock.** Both retention horizons
   in the consumption feature are anchored at the newest record seen. Wall time
   would let a clock jump, a machine restored from backup, or an old corpus
   silently empty the collection.

5. **A large per-Session artifact does not live in a small-object record.** It
   goes in a content-addressed side store, referenced by id, written once and
   read on demand. `electron/main/content-store.ts` is that store; it has no
   unbounded constructor, because a store that can be created without a bound
   will be.

6. **A bound is a contract, so it gets a regression test that fails on the old
   shape.** "A layout save must not scale with the number of goal visuals" and
   "N worktree cycles must not produce N rows" are assertions, not intentions.

7. **Migrate, never drop.** A bound introduced over existing data must move
   that data somewhere it survives, or leave it alone. A migration that cannot
   complete keeps the old copy.

8. **A migration is a write, so it belongs inside the store's write chain.**
   Read-then-migrate-then-save leaves a window in which a concurrent save is
   clobbered by the older document the migration is holding. Fuzz the write
   path: the workspace migration's interleaving defect was found by a
   randomized storm of concurrent loads and saves, not by reading the code.

## Consequences

- A new persisted collection without a stated bound is a review finding, the
  same way an unasserted release artifact is.
- Retention horizons that a consumer can widen (the Operator-profile
  publication anchor) are policy inputs with a clamp at both ends, not
  constants and not unbounded.
- `userData/goal-visuals/` is a new runtime component, recorded in
  `docs/engineering/architecture.md` and `src/lib/architecture/manifest.ts`.
- This is deliberately NOT an incident record. `docs/engineering/incidents/README.md`
  reserves those for a failure in a running build whose cause was not obvious
  from the code, and asks for the falsified hypotheses and the diagnostic
  method. Here there was no field failure, no wrong subsystem, and no method
  worth reusing beyond `ls -la`; what is durable is the rule, which is what a
  decision record is for.

## Open

- The consumption sample horizon still widens with an active Operator-profile
  publication anchor, so a long-lived opted-in install grows toward the
  400-day clamp. The durable answer is a bounded local archive of the derived
  `days` rows, which belongs to ENG-035.
- Nothing enumerates the persisted collections and checks each has a bound. The
  rule is a review contract, not a proof — the same gap `0010` records for its
  own assertion list.
