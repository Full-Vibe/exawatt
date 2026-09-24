'use client';

/**
 * Workspace hydration (ENG-018): on mount, adopt what main still runs and
 * restore the saved layout without spawning anything; then stay subscribed
 * to main's PTY event stream for the life of the workspace.
 *
 * One effect owns both on purpose. Events that arrive between the `pty:list`
 * snapshot resolving and the seed merge must win over that snapshot, and the
 * only way to know which ones did is to be the subscriber while the read is
 * in flight. A load that fails is not a first launch: it surfaces as a load
 * failure and keeps every save gated behind readiness until a retry lands.
 */
import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  useLatestRequest,
  type RequestTicket,
} from '@/hooks/use-latest-request';
import type {
  GoalVisual,
  PtyAttention,
  PtyReentryRecap,
  PtySessionRecord,
  SessionDelegation,
} from '@exawatt/core/desktop-bridge';
import type { WorkspaceLoadFailure } from '../workspace-storage-recovery';
import { loadTerminalFont } from '../terminal-font';
import {
  isSessionTab,
  type Latest,
  type Project,
  type WorkspaceLayout,
} from './workspace-model';
import { dropDetachedRemoteTabs, parsePersisted } from './persisted-layout';
import {
  persistedContextSummaries,
  persistedGoalVisualRefs,
  restoreLayout,
  resumeIdentityHints,
  seedSessionStores,
  unresolvedGoalVisual,
  withReconciledIdentities,
} from './layout-restore';
import { adoptObservedIdentity, markPtyExited } from './project-list';
import type { RecentProjects } from './recent-projects';
import type { SessionOperations } from './session-operations';

type Setter<T> = Dispatch<SetStateAction<T>>;

/**
 * The ids of the sources Exawatt still has a record of.
 *
 * `null` means Exawatt could not ask — no desktop bridge, or a read that
 * failed. That is not the same answer as "no sources", and the caller must not
 * treat it as one.
 */
async function readConfiguredSourceIds(): Promise<ReadonlySet<string> | null> {
  const api = window.electron?.connectedSources;
  if (!api?.list) return null;
  try {
    const sources = await api.list();
    return new Set(sources.map(source => source.id));
  } catch {
    return null;
  }
}

export function useWorkspaceHydration({
  stateRef,
  observedIdentitiesRef,
  operations,
  recents,
  setProjects,
  setActiveDir,
  setLastUsedDir,
  setPinnedTabId,
  setReady,
  setSummaries,
  setGoalVisuals,
  setAttention,
  setActivity,
  setEngaged,
  setDelegation,
  setReentryRecap,
  addSession,
  reconcileWithRegistry,
}: {
  stateRef: Latest<WorkspaceLayout>;
  /** identities main announced before React committed their tab; this hook
   *  is the one writer */
  observedIdentitiesRef: Latest<Map<string, string>>;
  operations: SessionOperations;
  recents: RecentProjects;
  setProjects: Setter<Project[]>;
  setActiveDir: Setter<string | null>;
  setLastUsedDir: Setter<string>;
  setPinnedTabId: Setter<string | null>;
  setReady: Setter<boolean>;
  setSummaries: Setter<Record<string, string>>;
  setGoalVisuals: Setter<Record<string, GoalVisual>>;
  setAttention: Setter<Record<string, PtyAttention>>;
  setActivity: Setter<Record<string, boolean>>;
  setEngaged: Setter<Record<string, boolean>>;
  setDelegation: Setter<Record<string, SessionDelegation>>;
  setReentryRecap: Setter<PtyReentryRecap | null>;
  addSession: (session: PtySessionRecord, tabId?: string) => string;
  reconcileWithRegistry: (ticket: RequestTicket) => void;
}) {
  const [workspaceLoadFailure, setWorkspaceLoadFailure] =
    useState<WorkspaceLoadFailure | null>(null);
  const [hydrationAttempt, setHydrationAttempt] = useState(0);
  const retryWorkspaceLoad = useCallback(async () => {
    if (workspaceLoadFailure?.required) {
      await window.electron?.workspace?.retryRecovery();
    }
    setWorkspaceLoadFailure(null);
    setHydrationAttempt(attempt => attempt + 1);
  }, [workspaceLoadFailure]);

  // ---- mount: adopt live sessions, restore ended layout without spawning ----
  /** One hydration read per mount (or per retry); a newer one, or unmount,
   *  supersedes it. */
  const hydrationRequests = useLatestRequest();
  useEffect(() => {
    const api = window.electron?.pty;
    const ws = window.electron?.workspace;
    if (!api) return;
    const hydration = hydrationRequests.begin();
    // flags cleared by events BETWEEN the pty:list snapshot resolving and
    // the seed merge must stay cleared — main won't re-broadcast for them
    const clearedBeforeSeed = new Set<string>();
    // Same race guard for D29's working ride-along: a quiet transition after
    // main captured the list must not be overwritten by the stale snapshot.
    const quietBeforeSeed = new Set<string>();
    // And for delegation (ENG-023 D3a): the last child ending between the
    // snapshot and the seed merge publishes null, which deletes nothing from
    // an empty map — without this guard the stale snapshot then resurrects a
    // rail no future event will clear until the next spawn.
    const settledBeforeSeed = new Set<string>();

    void (async () => {
      // the font settles here too: the revive loop below reads the spawn
      // size via getInitialSize, whose cell metrics come from the resolved
      // font — spawning with defaults while a custom font loads recreates
      // the TUI init-width race
      const [live, persistedRaw, recovery, configuredSourceIds] =
        await Promise.all([
          api.list(),
          ws?.load() ?? Promise.resolve(null),
          ws?.recovery() ?? Promise.resolve({ previousRunInterrupted: false }),
          // Which sources are still configured. A DETACHED source is gone by
          // operator decision, and its coworker tabs must not come back with
          // the layout. Only an ANSWERED list decides that: a read that failed,
          // or a build with no connected-sources capability at all, is not
          // evidence that anything was detached, so the tabs stay and the pane
          // says what it could not read (BUG-063's rule).
          readConfiguredSourceIds(),
          loadTerminalFont(),
        ]);
      if (!hydration.current) return;
      const decoded = parsePersisted(persistedRaw);
      if (persistedRaw !== null && persistedRaw !== undefined && !decoded) {
        throw new Error('Saved workspace format is not supported');
      }
      let persisted = dropDetachedRemoteTabs(decoded, configuredSourceIds);
      if (persisted && api.reconcileResumeIdentities) {
        const hints = resumeIdentityHints(persisted);
        if (hints.some(tab => !tab.harnessSessionId)) {
          try {
            const reconciled = await api.reconcileResumeIdentities(hints);
            if (!hydration.current) return;
            persisted = withReconciledIdentities(persisted, reconciled);
          } catch (cause) {
            console.warn('Session identity reconciliation failed', cause);
          }
        }
      }
      // goal subtitles (D21) and their last ready visual: the persisted
      // layout restores each Session's goal first, through main's stores.
      let restoredSummaries: ReadonlyArray<readonly [string, string | null]> =
        [];
      let restoredGoalVisuals: ReadonlyArray<
        readonly [string, GoalVisual | null]
      > = [];
      if (persisted) {
        const persistedSummaries = persistedContextSummaries(persisted);
        const restoreContext = api.restoreContext;
        restoredSummaries = restoreContext
          ? await Promise.all(
              persistedSummaries.map(
                async ([durableSessionId, summary]) =>
                  [
                    durableSessionId,
                    await restoreContext(durableSessionId, summary),
                  ] as const
              )
            )
          : persistedSummaries;
        if (!hydration.current) return;
        const persistedGoalVisuals = persistedGoalVisualRefs(persisted);
        const restoreGoalVisual = api.restoreGoalVisual;
        restoredGoalVisuals = restoreGoalVisual
          ? await Promise.all(
              persistedGoalVisuals.map(
                async ([durableSessionId, visual]) =>
                  [
                    durableSessionId,
                    await restoreGoalVisual(durableSessionId, visual),
                  ] as const
              )
            )
          : persistedGoalVisuals.map(
              ([durableSessionId, visual]) =>
                [durableSessionId, unresolvedGoalVisual(visual)] as const
            );
        if (!hydration.current) return;
      }
      const seeds = seedSessionStores(
        live,
        { summaries: restoredSummaries, goalVisuals: restoredGoalVisuals },
        {
          attentionCleared: clearedBeforeSeed,
          quiet: quietBeforeSeed,
          settled: settledBeforeSeed,
        }
      );
      if (Object.keys(seeds.summaries).length > 0) {
        setSummaries(prev => ({ ...seeds.summaries, ...prev }));
      }
      if (Object.keys(seeds.goalVisuals).length > 0) {
        setGoalVisuals(prev => ({ ...seeds.goalVisuals, ...prev }));
      }
      if (Object.keys(seeds.attention).length > 0) {
        setAttention(prev => ({ ...seeds.attention, ...prev }));
      }
      if (Object.keys(seeds.activity).length > 0) {
        setActivity(prev => ({ ...seeds.activity, ...prev }));
      }
      if (Object.keys(seeds.engaged).length > 0) {
        setEngaged(prev => ({ ...seeds.engaged, ...prev }));
      }
      if (Object.keys(seeds.delegation).length > 0) {
        setDelegation(prev => ({ ...seeds.delegation, ...prev }));
      }
      const { restored, unclaimed } = restoreLayout(persisted, live, {
        observedIdentities: observedIdentitiesRef.current,
        previousRunInterrupted: recovery.previousRunInterrupted,
      });
      /** where the restored layout put the operator, if anywhere */
      let restoredActiveDir: string | null = null;
      if (restored) {
        setProjects(restored.projects);
        restoredActiveDir = restored.activeDir;
        setActiveDir(restoredActiveDir);
        setLastUsedDir(restored.lastUsedDir);
        recents.replace(restored.recentProjects);
        if (restored.pinnedTabId) setPinnedTabId(restored.pinnedTabId);
      }
      // PTY incarnations unknown to the persisted layout (e.g. created or
      // exited since the last save) — or the whole fresh-start case. Exited
      // entries reconstruct an honest stopped tab; dropping them here would
      // make Terminal disagree with the local Fleet/Spatial inventory.
      //
      // Adoption appends and moves nobody. Only a workspace with no restored
      // position needs one, and it lands on the FIRST adopted Session rather
      // than on whichever one happened to be enumerated last.
      for (const s of unclaimed) {
        addSession(s, s.exited ? s.durableSessionId : undefined);
      }
      if (!restoredActiveDir) {
        const [firstAdopted] = unclaimed;
        if (firstAdopted) setActiveDir(firstAdopted.projectDir);
      }
      setReady(true);
      // reconcile durable identity (S5 P3) — async, so a slow/offline registry
      // never delays the terminal.
      reconcileWithRegistry(hydration);
    })().catch(async () => {
      // Failed reads are not first launch. Keep every save/checkpoint gated
      // behind readiness until the operator can load the preserved layout.
      const recovery = await ws?.storageRecovery?.().catch(() => undefined);
      if (!hydration.current) return;
      setWorkspaceLoadFailure(recovery ?? { required: false });
    });

    const offExit = api.onExit(
      ({ id, durableSessionId, exitCode, exitSignal }) => {
        operations.recordExit(stateRef.current.projects, {
          id,
          durableSessionId,
          exitCode,
          exitSignal,
        });
        setProjects(prev => markPtyExited(prev, { id, exitCode, exitSignal }));
      }
    );
    const offIdentity = api.onIdentity?.(
      ({ id, durableSessionId, harnessSessionId }) => {
        observedIdentitiesRef.current.set(durableSessionId, harnessSessionId);
        setProjects(prev =>
          adoptObservedIdentity(prev, {
            id,
            durableSessionId,
            harnessSessionId,
          })
        );
      }
    );
    const offContext = api.onContext?.(({ durableSessionId, summary }) => {
      setSummaries(prev => ({ ...prev, [durableSessionId]: summary }));
    });
    const offGoalVisual = api.onGoalVisual?.(({ durableSessionId, visual }) => {
      setGoalVisuals(prev => ({ ...prev, [durableSessionId]: visual }));
    });
    const offRecap = api.onRecap?.(next => {
      const { projects: groups, activeDir: dir } = stateRef.current;
      const active = groups.find(group => group.dir === dir);
      const tab = active?.tabs.find(
        candidate => candidate.id === active.activeTabId
      );
      if (tab && isSessionTab(tab) && tab.sessionId === next.id) {
        setReentryRecap(next);
      }
    });
    const offActivity = api.onActivity?.(({ id, working }) => {
      if (working) quietBeforeSeed.delete(id);
      else quietBeforeSeed.add(id);
      setActivity(prev => {
        if (working) return prev[id] ? prev : { ...prev, [id]: true };
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });
    const offEngaged = api.onEngaged?.(({ id }) => {
      setEngaged(prev => (prev[id] ? prev : { ...prev, [id]: true }));
    });
    // Harness-reported delegation (ENG-023). A Session that finishes its last
    // child drops out of the record entirely, so surfaces read "no delegated
    // work" rather than "zero children" — absent is not the same as none.
    const offDelegation = api.onDelegation?.(({ id, delegation: next }) => {
      if (next) settledBeforeSeed.delete(id);
      else settledBeforeSeed.add(id);
      // Main decides what is worth publishing and sends null otherwise, so
      // the liveness rule lives in exactly one place. Re-deriving it here is
      // what let the switcher and the strip disagree about one Session.
      setDelegation(prev => {
        if (!next) {
          if (!(id in prev)) return prev;
          const cleared = { ...prev };
          delete cleared[id];
          return cleared;
        }
        return { ...prev, [id]: next };
      });
    });
    const offAttention = api.onAttention?.(({ id, attention: att }) => {
      if (att) clearedBeforeSeed.delete(id);
      else clearedBeforeSeed.add(id);
      setAttention(prev => {
        if (att) return { ...prev, [id]: att };
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });
    return () => {
      hydrationRequests.invalidate();
      offExit();
      offIdentity?.();
      offContext?.();
      offGoalVisual?.();
      offRecap?.();
      offActivity?.();
      offEngaged?.();
      offDelegation?.();
      offAttention?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrationAttempt]);

  return { workspaceLoadFailure, retryWorkspaceLoad };
}
