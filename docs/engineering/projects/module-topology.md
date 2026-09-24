# Module-owned code and verification topology (ENG-039)

Execution detail for roadmap item ENG-039. The roadmap holds the contract;
this doc holds the narrative of each seam as it is adopted.

## Roadmap milestone log

### 2026-09-23 — M1 first slice: Electron main is a composition root

**`main.ts` went from 1,761 lines to 339 and now only wires modules; three
bugs in that code were fixed by the split.** It had 25 module-level `let`s,
ran `app.whenReady()` on import, and no test could load it, so every change to
one of its five responsibilities meant reading all of them.

| Module | Owns | Suite |
| --- | --- | --- |
| `renderer-server.ts` | unpacking, spawning, readiness, stop, cache pruning, the child's lifeline | fake child process, plus real processes for the lifeline (10) |
| `renderer-port.ts` | the port the renderer origin carries (BUG-022) | temp `userData`, fake port availability (11) |
| `deep-link.ts` | protocol registration, vetting, held links | fake window (12) |
| `window.ts` | construction over `window-shape.ts`, navigation boundary, startup stage, trusted origin | fake BrowserWindow (15) |
| `menu-controller.ts` | the menu's runtime state and its three channels | real template, fake install (6) |
| `app-ipc.ts` | main's own channel tables and their composer | per table, plus the composer (17) |
| `ipc-table.ts` | registration as data, keyed by channel name through `handleTrusted` | (5) |
| `shutdown-sequence.ts` | every step of quit, restart and update-restart; `before-quit` | the real coordinator over fakes (17) |
| `command-surface.ts` | bootstrap and the `CommandRuntime` it fills | injected runtime modules (8) |
| `build-identity.ts`, `main-diagnostics.ts`, `installed-build.ts` | what the process is; instrumentation; the update-ready watch | (8), (3), (2) |

Registration is a table in both directions: module registrars are rows in one
ordered list, and main's own channels are records keyed by channel name. The
table declares no channel names and no payload types, so the typed
desktop-bridge contract can adopt it unchanged.

What this does not yet do: M1's mechanical enforcement (deep-import and cycle
refusal, declared runtime environments). The modules exist and are tested in
isolation; nothing yet stops the next change from importing across them.

The three fixes that fell out:

- **BUG-070.** The renderer server was stopped only from `before-quit`, which a
  SIGKILL, crash or Force Quit never runs. Its launch now runs a four-line
  `-e` prelude that exits on end of file from stdin, a pipe whose only writer
  is main; the kernel closes that writer however main ends. Rejected:
  `utilityProcess` (needs the ready event, and the warm renderer starts before
  it) and a ppid poll (a second of latency for the same signal).
- **BUG-022.** An install keeps one port in `renderer-port.json`: kept when
  free, an OS port for one launch when taken (empty storage that does not
  carry over, the kept origin untouched), a new home after three taken
  launches or an unreadable record. Chosen over moving each `localStorage`
  store because it repairs the class, covers IndexedDB and sessionStorage, and
  stops a dead origin accumulating per launch. What it cannot do on a fallback
  launch is BUG-171.
- **BUG-050.** The eval inferred "a native modal is up" from "did not close in
  2.5 s". Every shutdown dialog now names itself on main's console first, the
  eval fails on that line, and the product half (no dialog on a non-workspace
  quit with only stopped Sessions) is a unit test.

Falsified along the way: the lifecycle gate was not red on a quiet machine
(baseline `origin/master` passed it end to end before any change), and its
record's premise that the last launch "supplies no dialog responses" was
stale; every launch passes `confirm`.

### 2026-09-13 — M0 first seam: the Agent Source readiness fact model

**One fact model replaced four local fixes, and ⌘T paints from memory.**
Landed for BUG-062, BUG-082 and incident `0021`; the rule is decision `0043`.

The seam is the readiness chain: saved preferences → source registry → row.
Before, it lived inline in `launch-controls.tsx` as six pieces of state and a
`launcherSettled` expression that required the registry to be LIVE for every
source and a model catalog for every launchable one. It is now three modules
with one public shape each:

| Module | Runtime | Owns | Suite |
| --- | --- | --- | --- |
| `packages/core/src/agent-sources.ts` | shared kernel | `AgentSourceObservation`, `agentSourceFactFreshness`, `agentSourceLaunchVerdict`, `launchableAgentSourceState` | main and renderer consume the same verdict; `agent-source-registry.test.ts` pins the gate on it |
| `electron/main/pty/agent-source-observation-store.ts` | main | the persisted last-known-good per adapter, its size class and eviction | `agent-source-observation-store.test.ts` (disk) |
| `electron/main/pty/agent-source-registry.ts` | main | folds memory into discovery, `rememberedAgentSources`, the settled-good cache window, the gate | `agent-source-registry.test.ts` |
| `src/components/workspace/use-agent-source-registry.ts` | renderer | the ONE reader: checking placeholder → remembered → live, newest-wins | driven through the composer and Settings suites |
| `src/components/workspace/launcher/launcher-model.ts` | renderer, DOM-free | `launcherReadiness`, `launcherStatusLine`, `draftLauncherSetup` | `launcher-model.test.ts` names "not yet checked" vs "checked and failed" as transitions |
| `src/hooks/use-latest-request.ts` | renderer | "only the newest request may commit" | `use-latest-request.test.tsx`; `use-latest-request.ratchet.test.ts` refuses a new hand-rolled counter |

Measured on the operator's machine (load 10 to 12, fish login shell,
real CLIs), the same probe before and after
(`scripts/composer-registry-cold-probe.mjs`,
`scripts/agent-source-registry-probe.mjs`):

| | before | after |
| --- | --- | --- |
| ⌘T → live Start, registry cache expired | 4.3 to 5.1 s (three samples), placeholder cards throughout | 48 to 58 ms, three real chips (three samples) |
| login shells per ⌘T | 13 | 0 while the last observation is complete and settled (`ready` or `not-installed`, within five minutes); otherwise the probe runs behind an already-live row |
| app restart, first ⌘T | same as a cold read | Start live in 51 ms from the persisted memory, revalidated behind it |
| one cold registry read | 4.5 s, 13 shells | unchanged by design (BUG-063's deadlines stand); the remembered read is 0.1 ms, 0 shells |

What moved and why it is a seam rather than a fix:

- The four sequence counters in `launch-controls.tsx` (`branchEditSeq`,
  `permissionSaveSeq`, `modelLoadSeq`, `modelRefreshSeq`) and its three
  `let cancelled` effects are gone; so are the generation refs in
  `use-remote-coworkers`, `use-project-roadmap`,
  `use-fleet-roadmap-attention` and `agent-sources-settings`. Each is a
  `useLatestRequest` channel. The ratchet test lists the eleven sites that
  remain and fails on a twelfth.
- `launch-controls.tsx` shrank from 2,094 to about 2,050 lines while gaining
  the memory-first paint; the presentation helpers and the draft-chip
  builder moved into `launcher-model.ts`.
- D49's "hold inert cards until every launchable engine has reported a
  catalog" is amended: the row freezes its order at the readiness chain's
  `ready` phase (policy, pool, painted registry), engines without a pool
  configuration paint as draft chips whose model line shims until the
  catalog lands, and the engine being adjusted shows the choice in progress
  on its chip. Nothing reorders under the pointer.
- The launcher's status line is reserved (`data-launcher-status`), with
  three registers; `/hud-gallery/agent-launcher` gained the "Painted from
  memory" and "Not signed in" scenarios.

Falsified along the way, so the next agent does not re-diagnose:

- The composer's own tests expected Start to be pressable BEFORE the row
  settles (a pool that never loads, catalogs that never answer). That is the
  contract: Start needs the saved policy and a painted registry, never the
  ranking or the catalogs.
- D70's cold-renderer probe never expired the registry cache, which is why
  its samples read tens of milliseconds and BUG-062 stayed "unconfirmed";
  the one 1,474 ms sample in that report was the registry.

The same class surfaced once more before this landed, in the fleet roadmap
producer: a roadmap read that failed wrote the same `absent` a Project with
no roadmap gets, so a roadmap over the reader's byte limit read as quiet on
the strip, the Project dot and ⌘J. BUG-162 gives it the fact model's answer
(`failed` is unknown, the last good parse stands as a fact with an age, the
producer declares itself blind, and one Project's reads share a
`createLatestRequest` channel so an older read cannot land after a newer
one). The residual it declares: the strip and ⌘J have no "unwatched"
vocabulary yet; `sealAttentionView` carries the blind Sessions beside the
signals for the surface that gains it.

Next seams, in the order the evidence suggests: the model-catalog read (the
same stale-while-revalidate shape, already disk-backed by BUG-115, still
cwd-scoped so a fresh worktree pays every catalog probe), then the launch
orchestration in `launch-controls.tsx`, which still owns model choice,
permission persistence and the draft tab's patch stream in one component.
