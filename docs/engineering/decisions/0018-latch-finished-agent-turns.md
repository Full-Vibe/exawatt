# 0018 Latch finished Agent turns

Date: 2026-07-22
Status: accepted

## Context

Exawatt exposes one shared Agent turn-state vocabulary across the tab strip,
Sessions, and the command switcher: working, finished, unseen, and new. The
local Claude Code and Codex integrations receive a raw PTY stream, not a
provider-owned structured turn lifecycle.

The first implementation equated recent PTY output with working. Three later
corrections filtered resize redraws, aligned main/renderer adoption, and fixed
BEL plus acknowledgement ordering. The visible oscillation still returned:
after a completed turn showed its green check, an idle TUI repaint, title
update, or terminal protocol reply emitted bytes and changed it back to the
teal working half-circle despite no new operator command.

Raw output is evidence that the terminal changed. It is not sufficient evidence
that a finished Agent turn restarted.

## Decision

- Electron main remains the owner of normalized local turn state.
- Before an Agent turn settles, non-resize output may establish working and the
  existing quiet or real-BEL boundary may finish it.
- Finished is latched for Agent Sessions. Later provider redraws, title output,
  and terminal protocol replies continue into scrollback and the visible
  terminal but cannot reopen working.
- A guaranteed-human marker travels atomically with terminal input. Electron
  main clears the latch before writing that input to the PTY, so a synchronous
  process echo cannot race ahead of the next-turn boundary. Startedness still
  emits only once; turn engagement may occur repeatedly.
- Shells do not have Agent turns and remain working/quiet by output activity.
- A future Agent Source that supplies structured turn events may replace this
  inference behind the source boundary without changing the UI contract.

## Consequences

- The green finished check is stable and explainable: it changes only when the
  operator gives that Agent more work.
- Passive output can no longer create false working status, false mid-turn close
  warnings, or cross-surface status churn.
- An Agent that truly resumes autonomously after Exawatt has latched finished
  remains visually finished until operator engagement or a future structured
  source event. This conservative false-negative is preferred to repeated
  false-positive working signals from indistinguishable PTY noise.
- The latch is runtime state. Relaunch still reconstructs live working truth
  from Electron main and durable Session startedness as before.

## Amendment (2026-08-04, BUG-001)

Scoped exception for a source with NO reported-turn channel at all (today:
Codex, OpenCode — `harness-registry.ts` wires no `eventChannel` for either).
For those sources, inference is the *only* signal that exists: there is no
hook-reported `ownTurn` to corroborate a settle, and no hook event to manage
the latch independently of the PTY stream the way Claude's
`noteHarnessTurnStart`/`noteHarnessTurnEnd` do. A settle produced by
byte-quiescence alone is a guess, not a fact, and this decision's original
"conservative false-negative is preferred" reasoning assumed the alternative
was permanent flicker — not a permanent, unrecoverable wrong answer for the
rest of a turn that is demonstrably still running (the literal BUG-001
symptom: a Codex tab showed the finished glyph while the agent kept working).

For a session with no reported-turn source, `onData` no longer honors the
`settled` latch against non-BEL bytes: real subsequent output reopens
`working` the same way it would before the session ever settled. The latch
still fully applies — unchanged — for any session with a reported-turn
source, which is Claude today and is a durable claim: `reportedTurn(id)`
becomes non-null on that session's first hook event and stays non-null for
the Session's life, so this exception structurally cannot reach a Claude
Session once hooks are live. The tradeoff is bounded and self-correcting: the
worst case is an occasional flicker back to `working` from repaint noise on a
truly-finished Codex tab, which goes quiet again within the same quiescence
window — strictly better than the stuck-wrong failure this amendment fixes.

The durable fix remains real Codex reported-turn integration (Codex's own
`notify` hook mechanism is real and already used elsewhere on this machine;
wiring it into Exawatt is new scope, not covered by this amendment) — this
amendment only changes what happens while that source has no signal at all.
