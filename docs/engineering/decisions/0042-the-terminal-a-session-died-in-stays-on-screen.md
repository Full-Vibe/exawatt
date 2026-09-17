# 0042 The terminal a Session died in stays on screen; a Session opened after its death is a record

Date: 2026-09-23
Status: accepted; first execution is BUG-046 (ENG-015 S6.4)

## Context

Two contracts about a paused Agent disagreed, and `eval:workspace:split`
failed 9/10 on exactly the check where they met.

- **D26, the pin contract** (2026-07-21): "watch one, drive one" includes
  watching the pinned Agent FINISH, so a pinned pane survives its Session's
  exit and keeps showing retained scrollback with the restore bar, until the
  operator unpins or closes the tab.
- **BUG-013 / incident `0008`, the record contract** (2026-08-13): a paused
  Agent is a RECORD to be read, not a terminal to be replayed. Replaying the
  saved bytes at a width other than the one they were emitted at produced
  the operator's "jumbled, unreadable text", and reading them at all was a
  main-process parse that froze the app. `RetainedTerminalPane` was deleted;
  the record never loads the transcript on open.

After BUG-013, `workspace-client` swapped every ended Session's pane for the
record the moment `sessionId` went null, including a pane the operator was
watching at that moment. The split eval's assertion that `[data-pane="right"]
.xterm` survives the exit was the D26 half of the contract, and nothing had
re-decided it; BUG-046 recorded the failure and that the split had a script
but no gate.

Reading both contracts side by side, they are not about the same moment.
D26 is about a Session the operator is LOOKING AT when it ends. BUG-013 is
about a Session the operator OPENS after it has ended (a relaunch, a tab
restored from disk, a tab whose terminal was never mounted). The first has
an xterm on screen that already holds every byte; the second has nothing on
screen and would have to read them.

## Decision

**The terminal a Session died in stays on screen. A Session opened after its
death is a record.**

1. A Session that ends while its `TerminalPane` is mounted keeps that pane,
   same React key, same tree position, with the lifecycle bar
   (`SessionRestorePanel`) laid over its top edge. The xterm keeps the buffer
   it already painted, so the exit adds no IPC read and no replay; the
   width the bytes were drawn at is the width they stay at. The pane is
   released when the tab closes, when a resume starts a new incarnation, or
   when the renderer is torn down.
2. A Session with no mounted terminal (relaunch, restored layout, a tab
   whose pane never mounted) renders the record: the lifecycle bar, then
   the task, the summary, and the saved size, with the transcript one click
   away. The record's contract from BUG-013 is unchanged: it never reads the
   transcript to render.
3. `eval:workspace:split` owns the first rule and joins `SURFACE_GATES` for
   `workspace-client`, `split-layout`, `terminal-pane` and
   `session-restore-panel`; `eval:workspace:paused` keeps owning the second.
4. Both presentations say the same words. The lifecycle word, its one-line
   ending, its tone and its verb come from the shared vocabulary in
   `packages/ui-model/src/session-lifecycle.ts` (ENG-015 S6.4), so the bar
   over a dead terminal and the bar over a record cannot disagree.

## Consequences

- A pinned Agent finishing in a split is watched to the end, which is what
  the pin was for. An active Agent that exits under the operator's eyes
  keeps its final output on screen instead of swapping to a summary of it.
- The lifecycle bar overlays the pane's top rows rather than pushing the
  terminal down. `terminal-pane.tsx` positions itself, and this change does
  not touch it; xterm keeps the viewport at the bottom, so the rows covered
  are the oldest visible ones and scroll back into view.
- A dead terminal keeps the memory and the WebGL context it already held
  while live, until its tab closes. That is no more than the live state
  cost, and the relaunch case with sixteen paused Agents (incident `0008`)
  still mounts zero terminals. Incident `0008`'s open question about a real
  GPU's context budget is unchanged by this decision.
- Resume replaces the old incarnation: while `resumeState` is `resuming`
  the pane shows the resuming line, and the new `sessionId` mounts a new
  terminal. A failed resume keeps the old terminal on screen under a bar
  that says so.

## Evidence boundary

`eval:workspace:split` 10/10 on the change (previously 9/10 on
`origin/master`, reproduced by BUG-046 on a detached worktree). The
screenshot `split-dead-pin.png` shows the pinned shell's own `[session
exited 0]` under the `Closed · Shell closed · history kept · Start new
shell` bar. Nothing here was measured on the operator's live fleet; the
allocation argument rests on incident `0008`'s finding that the transcript
read, not the xterm, was the cost.
