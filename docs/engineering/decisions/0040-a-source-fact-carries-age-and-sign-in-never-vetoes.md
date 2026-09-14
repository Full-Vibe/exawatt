# 0040 A source fact carries its age, and a sign-in negative never vetoes a launch

Date: 2026-09-13
Status: accepted; first execution is BUG-062, BUG-082, incident `0018` (ENG-039 M0 seam)

## Context

Three reports were one shape: a fact about an Agent Source was published
without saying how it was arrived at or how old it was, and every surface
then treated it as a present verdict.

- **BUG-062.** ⌘T showed placeholder cards and a dead Start until the source
  registry answered LIVE for every source and every launchable source had
  reported a model catalog. The registry is a login-shell `--version` and
  auth probe per source, cached in memory for five seconds, with no persisted
  last-known-good, so any ⌘T more than five seconds after the last one
  re-ran thirteen login shells: 4.3 to 5.1 seconds on the operator's machine,
  measured, in front of a design partner.
- **BUG-082.** Settings painted `Unknown · Open the Electron desktop app to
  inspect this local source` inside the desktop app, because its initial
  state was the no-bridge fallback, and the launcher's blocked reason was
  `${label}: ${stateLabel}`, a state enum with no cause. BUG-063 had given
  the fact model `known: false` for a probe that never answered, but there
  was no `checking` distinct from `unknown` and no `stale` distinct from
  `failed`.
- **Incident `0018`.** `claude auth status` answered `loggedIn: false`, exit 1.
  Exawatt vetoed every launch. One ordinary `claude -p` request refreshed the
  credential and the next status read signed in. An answered negative that
  was wrong, and every veto Exawatt had for it prevented the one action that
  repaired it.

## Decision

**A reported fact about a source carries coverage, age, and provenance, and
surfaces render `checking`, `known`, `stale`, and `unobserved` as different
things.**

1. **Every snapshot declares where it came from.** `AgentSourceSnapshot.observation`
   is required, like `unobservedProbes`: `live` (this process probed it),
   `remembered` (the last complete observation persisted on this machine,
   painted while this process revalidates; `observedAt` is the original
   time, so the age is honest), or `declared` (nothing on this machine has
   observed it; the web fallback).
2. **Freshness is by age, in one place.** `agentSourceFactFreshness` in
   `@exawatt/core`: `checking` while a probe runs and nothing fresh is
   painted; `known` within the five-minute window the model-catalog cache
   already uses; `stale` past it; `unobserved` when nothing complete exists
   and no probe is running.
3. **The composer paints from memory first and revalidates behind it.** The
   last complete observation of each source is persisted in
   `agent-source-observations.json` (size class: one row per adapter, thirty
   days behind the newest row, same login shell; evicted at every write and
   swept on load, per decision `0039`). A probe that times out writes
   nothing, so the memory stays and ages. A registry whose every launchable
   source is a complete, live `ready` is served for five minutes without a
   re-probe; anything less keeps the five-second window.
4. **Start needs only the selected source's fact.** The row is ready once the
   saved policy and a painted registry exist. A model catalog never gates the
   row: an engine without one paints as a draft chip and fills in when its
   catalog lands.
5. **A remembered negative never vetoes.** The main-process gate treats a
   remembered snapshot as `known: false`: this process asked and got no
   answer, so the memory is painted but is not a present verdict.
6. **A sign-in negative informs and never vetoes.** Sign-in is the source's
   own to refresh, and running the source is how it refreshes or asks. An
   answered `action-required` reads `${label}: not signed in` on the
   composer's status line and in Settings, dated when stale, with Start live;
   the launch proceeds and the source runs its own sign-in in the pane. Only
   a fact the source cannot repair by running refuses: not installed, a
   version Exawatt does not support, or checks that failed. `launchable`
   now means exactly "Exawatt would spawn it".
7. **A blocked launch names the fact, never a state label.** One verdict
   function, `agentSourceLaunchVerdict`, produces the fact and the sentence
   for the gate, the composer, the catalog and Settings, so they cannot
   disagree.
8. **Hint and reason reveals never shift layout.** The launcher's status line
   is a reserved box with three registers (blocking, informing, checking),
   never a conditional paragraph.

## Consequences

- BUG-063's `known: false` arm is unchanged and still has no `message`
  field; the fact model widens what counts as "not a present verdict".
- The pre-launch gate no longer sends the operator to Settings to sign in.
  Settings keeps its Sign in action and its reconciliation loop, which now
  waits for `ready` rather than for "spawnable".
- Every hand-rolled "only the newest request may commit" counter is one
  primitive, `useLatestRequest`, and a ratchet test refuses a new one.
- `docs/engineering/architecture.md` records the persisted collection; the
  design system records the readiness vocabulary and the reserved line.
- What this deliberately does not do: add billed inference to discovery,
  raise the probe deadlines (BUG-063's reasoning stands), or persist an
  incomplete observation.

## Open

- Nothing observes a source's successful use outside Exawatt (the Terminal
  use in incident `0018`), so an aged negative is dated but not superseded
  by that evidence. Exawatt's own successful launches are recorded in
  `sourceRecency`; a later pass may let a launch newer than a remembered
  negative present it as superseded rather than merely stale.
