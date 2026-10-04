# 0046 Reading does not resolve attention

Date: 2026-10-04
Status: accepted direction; implementation planned

**Seeing an Agent request clears unread, not the outstanding work.**

## Context

The existing S1 focus contract clears attention when the operator opens a
Session. This conflates noticing a request with resolving it. The operator
accepted the email-inbox analogy: an item may be read but still await a reply
or triage. BUG-259/260 and BUG-257/258/264/265 belong to this broader separation
of operator state, source requests and execution truth.

The current Cmd+J projection orders operator gates by age and excludes turn-end
results. The operator accepted prioritizing blocked Agents, then questions from
still-working Agents, then finished results, oldest within each class. This is
an intentional future interaction change, not a description of shipped code.

## Decision

- Read/unread records operator inspection. An outstanding needs-you request
  records unresolved work. Execution records what the source says is running.
  These dimensions may coexist and must not be collapsed into one enum.
- Unread and already-read results must be distinguishable. Exact visual
  treatment remains exploratory; it is not a blocker to semantic shaping.
  Keep purpose legible and positions stable. No automatic dim/fold/hide/close
  treatment is approved by this decision. Unresolved requests remain needs-you
  even after reading; completion and unread are separate facts.
- Opening a Session acknowledges inspection without resolving its request.
  Source-confirmed resolution retires that request; focus or arbitrary PTY
  keystrokes alone cannot prove resolution. Weak or unavailable source evidence
  remains explicit uncertainty. Per-source resolution evidence is implementation
  shaping work, not an excuse for an indefinite guessed blocker.
- Cmd+J prioritizes hard blockers, then questions while work continues, then
  unread finished results, oldest within each class. Read finished results do
  not perpetually occupy the queue. A completed result remains a result, not a
  fabricated blocker. Mark unread returns operator intent without re-firing the
  original notification. All targets have a visible reason to be visited.
- Marker, queue, command availability and notifications consume shared
  transitions and identities. An unresolved request becoming read must not
  ring again merely because focus changed. Preserve sound preferences.
- Predictability is the presentation goal. Prefer existing contextual command
  hints for any needed explanation over new permanent queue chrome or settings.
  Exact copy and queue traversal behavior remain a design proposal; no visual
  approval is implied.

## Implementation boundaries and proof

ENG-015/016 own semantics and persistence; ENG-004 consumes them in Fleet;
ENG-039 supplies bounded module ownership. Extend existing turn-truth,
Session-lifecycle, navigation and checkpoint owners rather than adding a
parallel engine. No new source, cloud service or full Initiative model is needed.

Before implementation, specify pass traversal so repeated Cmd+J presses can
visit all eligible targets even when the highest-priority requests remain
unresolved; selection must not ping-pong forever between two blockers. Specify
what happens to a visited target, a newly arriving hard block and an exhausted
pass without moving Project/tab positions. Acceptance includes read-but-open
requests, working-with-question, unknown evidence, several persistent blockers,
unread results, duplicate events and exact-Session restart restoration.

Persistence separates durable operator intent from refreshed execution facts.
Previously paused Agents remain paused. After an update, formerly running Agents restore paused with their context and
attention intact; offer one explicit action to resume that eligible set using
exact conversation identities. Partial/unsupported resume remains individually
visible and must not silently create a new conversation. Previously paused
Agents are not included in that set. No automatic execution is added now.

A future explicit "Restart and resume active" alternative may sit beside
"Restart and pause active" in restart or quit-confirmation UX. The operator
left placement open and prefers the simpler pause-first behavior now. Preserve
the distinction between pre-restart running intent and restored process state
so the later choice is possible without inventing another lifecycle. This is
future scope, not permission to build its controls in the current pass.

The [ENG-036 shaping brief](../projects/design-system-of-record.md#2026-10-04--everyday-use-polish-shaping-and-research-basis)
owns the research ledger and before/after usability checks. Those sources
motivate evaluation; they do not prove this queue ordering is optimal.
