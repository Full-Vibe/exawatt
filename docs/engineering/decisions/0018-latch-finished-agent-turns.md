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
