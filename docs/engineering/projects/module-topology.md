# Module-owned code and verification topology (ENG-039)

Execution detail for roadmap item ENG-039. The roadmap holds the contract;
this doc holds the narrative of each seam as it is adopted.

## Roadmap milestone log

### 2026-09-13 — M0 first seam: the Agent Source readiness fact model

**One fact model replaced four local fixes, and ⌘T paints from memory.**
Landed for BUG-062, BUG-082 and incident `0018`; the rule is decision `0040`.

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

Next seams, in the order the evidence suggests: the model-catalog read (the
same stale-while-revalidate shape, already disk-backed by BUG-115, still
cwd-scoped so a fresh worktree pays every catalog probe), then the launch
orchestration in `launch-controls.tsx`, which still owns model choice,
permission persistence and the draft tab's patch stream in one component.
