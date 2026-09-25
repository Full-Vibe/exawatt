# 0044 Device power policy is separate from Agent lifecycle

Date: 2026-09-25
Status: proposed; implementation investigation is BUG-227 (ENG-016)

**A locked or dark display never means “pause Agents.” Device sleep is a
separate, explicitly controlled host-power policy.**

## Context

Incident `0029` records a Mac that used battery from 65% to 1% while its lid
was open and its display was mostly off. Recurring `caffeinate` assertions
covered virtually the whole interval. A live assertion belonged to Claude Code
running inside Exawatt. Installed Claude Code 2.1.282 independently showed a
busy-state `caffeinate -i -t 300`, renewed every four minutes. Exawatt does not
own that child process's assertion, and no supported Claude setting for
disabling it was found. The same behavior is reported in upstream issues
[#85261](https://github.com/anthropics/claude-code/issues/85261) and
[#21432](https://github.com/anthropics/claude-code/issues/21432).

The repository's installed Electron is 43.1.0. Its shipped `powerMonitor`
types include lock/unlock and AC/battery events plus `isOnBatteryPower()`;
`powerSaveBlocker` includes `prevent-app-suspension`, which permits the display
to turn off. This provides the app-owned host seam needed for a future policy,
but cannot release an assertion made directly by Claude.

The incident also found a Fleet frame-scheduling defect (BUG-228), but there
is no historical frame count or per-process energy sample proving Fleet caused
the discharge. Fix it on its own evidence.

## Proposed decision

1. **Display state does not own Session state.** Screen lock, display-off,
   window hiding, and losing focus must not pause, signal, or relaunch an Agent.
   The existing Pause action stops a source process and interrupts active work;
   its confirmation says unfinished work may need retrying. Automatically
   invoking it from a lock event would silently discard the user's running
   operation.
2. **The app does not promise unattended work by holding a machine awake by
   default.** When macOS sleeps, local work is subject to the operating
   system's suspension and the source's recovery behavior. Exawatt records and
   presents what happened; it does not relabel OS suspension as a clean Agent
   pause.
3. **Offer a device-local keep-awake policy, independent of Project and
   Workspace.** Proposed choices: `Never`, `On AC only` (default), and `On AC
   and battery`. It applies only to actively working, locally hosted Sessions
   whose harness exposes a supported way to honor the choice. “On AC only”
   releases Exawatt's assertion immediately on battery transition. “On AC and
   battery” is explicit consent to increased battery use.
4. **Keep the display free to sleep.** When the policy holds the system awake,
   use Electron's `prevent-app-suspension` capability; do not prevent display
   sleep. Do not hold the machine awake for idle Agents, local shells, waiting
   approval/attention, Demo Mode, or remote Agents that run on another host.
5. **Never kill, wrap, or patch a harness-owned power process to simulate
   control.** A source that cannot honor the setting must be identified as
   uncontrolled; the app must not claim that its battery choice governs that
   source. Claude Code's current built-in inhibitor therefore blocks shipping a
   truthful global “Never” / battery-safe promise until Anthropic supplies a
   supported opt-out or another reviewed source-level integration controls it.

The device choice belongs to the local Electron host, not a launch profile or
Workspace: it affects the physical machine and every local Project. Hosted
Exawatt may display a remote source's reported execution state, but a browser
cannot set sleep policy on the Agent's host. Demo Mode exercises the same
policy projection through its data boundary without creating an OS assertion.

## Alternatives considered

| Policy | Disposition | Reason |
| --- | --- | --- |
| Auto-pause when locked or the display turns off | Reject | Locking is commonly a brief privacy action; screen-off is not system sleep. The pause path interrupts active work and can lose an unanswered request. |
| Keep every local Agent's Mac awake on AC and battery | Reject as default | It turns background work into an unbounded battery commitment. The incident demonstrates the cost. Offer it only as an explicit device choice. |
| Let macOS manage sleep, without a control or status | Accept only as current fallback | Safe default for work Exawatt can control, but insufficient while a harness installs its own inhibitor invisibly. Diagnose and disclose ownership where possible. |
| Device-local, source-aware, AC-sensitive keep-awake policy | Recommend | Keeps display lock independent, protects unplugged devices by default, and makes continued battery work an explicit operator choice. It depends on supported per-source controls and honest capability reporting. |
| Kill `caffeinate` or intercept it in `PATH` | Reject | Claude recreates it while busy; process interception is undocumented, races the harness, changes normal source behavior, and creates no durable or source-agnostic contract. |

## Execution order and exit criteria

BUG-227 owns execution; this is not a second plan.

1. Preserve BUG-228's Fleet scheduling repair as a distinct change. Measure its
   actual board frames and renderer/GPU cost after fixing it; do not claim it
   would have prevented incident `0029`.
2. Establish which shipped harnesses have a documented, supported sleep
   control. For Claude Code, wait for or obtain a supported upstream opt-out;
   do not invent an environment variable or rewrite user settings based on a
   minified implementation detail. Represent unsupported control as
   `uncontrolled` in host facts.
3. Specify one source-agnostic local-host policy contract and its lifecycle:
   active-work truth acquires the app-owned assertion; idle, completed,
   attention-blocked, shutdown, and unsupported Sessions do not; AC-only
   releases on battery transition; every acquire has one release. Keep
   renderer visibility and `Session` lifecycle out of the decision.
4. Implement Settings and host status only once the contract can state exactly
   which local Sessions the setting controls. Explain that locked Agents keep
   running on AC and that battery mode either permits system sleep or knowingly
   holds it awake. Never display a success state when a harness-owned inhibitor
   bypasses that policy.
5. Before release, compare the same real local task on AC and battery with the
   display visible, locked/display-off, and after sleep/wake. Verify
   `pmset -g assertions` identifies only the expected Exawatt-owned assertion,
   the screen still sleeps, unplugging releases AC-only mode, source work
   resumes or reports interruption honestly, and no task is silently
   interrupted by lock. Include all supported harnesses and a non-Electron
   hosted control. Keep per-process energy attribution separate from frame
   counts and app CPU.

## Primary references

- [Electron 43 `powerMonitor`](https://www.electronjs.org/docs/latest/api/power-monitor)
- [Electron 43 `powerSaveBlocker`](https://www.electronjs.org/docs/latest/api/power-save-blocker)
- [Apple IOKit assertion types](https://developer.apple.com/documentation/iokit/iopmassertiontypes)
- [Claude Code issue #85261](https://github.com/anthropics/claude-code/issues/85261)
- [Claude Code opt-out request #21432](https://github.com/anthropics/claude-code/issues/21432)

## Evidence boundary

The existing incident establishes the Mac stayed awake under repeated
assertions and that a current Claude process used one. It does not establish
that every historical assertion came from Claude or that Fleet was the main
energy consumer. The product policy stays proposed until the operator reviews
the AC default and the supported-harness boundary; the implementation gates
above remain open.
