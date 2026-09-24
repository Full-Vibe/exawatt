'use client';

/**
 * Closing tabs, and Recently closed: the soft-close ledger's two halves (D23).
 *
 * Close grammar (D27): ⌘W closes, like Chrome. A started live Agent gets one
 * in-app confirm; drafts, unstarted tabs, and stopped tabs close at once.
 * Removal is optimistic and the stop and archive run behind it, so a close
 * never flickers through stopped or restore states. Reopen (⌘⇧T, D39)
 * restores a stopped tab from main's ledger; it never starts a process.
 */
import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { operatorPosition } from '@/components/nav/operator-position';
import type {
  ClosedSessionEntry,
  SessionDelegation,
} from '@exawatt/core/desktop-bridge';
import {
  sessionDelegationBusy,
  sessionGlyphState,
  sessionReportedBlocked,
} from '../session-status';
import {
  isRemoteAgentTab,
  newTabId,
  tabFromClosedEntry,
  tabIsLive,
  type CloseOutcome,
  type Latest,
  type Project,
  type WorkspaceLayout,
} from './workspace-model';
import { placeTab, removeTab } from './project-list';
import type { SessionOperations } from './session-operations';

export function useRecentlyClosed({
  stateRef,
  readyRef,
  operations,
  summariesRef,
  engagedRef,
  activityRef,
  delegationRef,
  beginPendingClose,
  moveOperator,
  setProjects,
  setPinnedTabId,
  setSummaries,
  setError,
}: {
  stateRef: Latest<WorkspaceLayout>;
  readyRef: Latest<boolean>;
  operations: SessionOperations;
  summariesRef: Latest<Record<string, string>>;
  engagedRef: Latest<Record<string, boolean>>;
  activityRef: Latest<Record<string, boolean>>;
  delegationRef: Latest<Record<string, SessionDelegation>>;
  /** the closed-count overlay that covers an immediate ⌘W → ⌘⇧T */
  beginPendingClose: () => () => void;
  moveOperator: (dir: string, tabId: string | null) => void;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  setPinnedTabId: Dispatch<SetStateAction<string | null>>;
  setSummaries: Dispatch<SetStateAction<Record<string, string>>>;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  /**
   * How many drafts have been thrown away (BUG-041).
   *
   * The empty-Project composer and the draft tab that continues it are ONE
   * React element, so materialising that tab must not remount the surface the
   * operator is mid-gesture in. That continuity has to end somewhere, and a
   * DISCARDED draft is the only place it should: the composer that replaces a
   * thrown-away draft is a new one and must not inherit its task or its setup.
   *
   * Deliberately a count, not a Record keyed by Project. Only the active
   * Project's composer is ever mounted, and a draft can only be closed from
   * the Project it belongs to, so a per-Project key would buy precision no
   * reachable interaction can observe — while making this hook hold a
   * `Record<string, …>` that is not keyed by a Session identity, which is the
   * one thing `session-scope.test.tsx` asks it never to do (BUG-037).
   */
  const [draftDiscards, setDraftDiscards] = useState(0);
  /** Close/archive work is tracked so browser-style reopen cannot race the
   * optimistic strip removal and read the ledger before the entry lands. */
  const closeInFlightRef = useRef<Set<Promise<CloseOutcome>>>(new Set());

  /** Repeated ⌘⇧T requests are a FIFO queue over a LIFO ledger: each request
   * waits for the previous take, then restores the next-newest entry. */
  const reopenLastClosedQueueRef = useRef<Promise<void>>(Promise.resolve());

  /** remove a tab from the layout (shared by every close path); closing
   *  the active tab activates its right neighbor, like Chrome (D24) */
  const removeTabFromLayout = useCallback(
    (tabId: string) => {
      setPinnedTabId(cur => (cur === tabId ? null : cur));
      setProjects(prev => removeTab(prev, tabId));
    },
    [setPinnedTabId, setProjects]
  );

  /** Close grammar (D27): ⌘W CLOSES, like Chrome. A started live agent
   *  gets ONE in-app confirm (the caller renders it and re-calls with
   *  force); drafts, unstarted tabs, and stopped tabs close instantly.
   *  The removal is OPTIMISTIC — the tab leaves the strip in a single
   *  transition and the stop/archive runs behind it, so a close never
   *  flickers through stopped/restore states. */
  const closeTab = useCallback(
    (tabId: string, opts: { force?: boolean } = {}): Promise<CloseOutcome> => {
      const operation = (async (): Promise<CloseOutcome> => {
        const { projects: gs } = stateRef.current;
        const g = gs.find(x => x.tabs.some(t => t.id === tabId));
        const tab = g?.tabs.find(t => t.id === tabId);
        if (!g || !tab) return { kind: 'noop' };
        if (isRemoteAgentTab(tab)) {
          // ⌘W on a coworker closes the VIEW (doc: "closing its tab closes
          // the Exawatt view, not the remote worker"). No confirm, because
          // nothing is lost; no stop, no archive, no ledger entry, and not one
          // byte to the source. Its work carries on and Exawatt stops looking.
          removeTabFromLayout(tabId);
          return { kind: 'view-closed', title: tab.title };
        }
        // Everything past here stops or archives a local process, so it needs
        // the PTY bridge; closing a coworker's view never did.
        const api = window.electron?.pty;
        if (!api) return { kind: 'noop' };
        if (tab.resumeState === 'resuming' || operations.isBusy(tabId)) {
          return { kind: 'noop' };
        }
        if (tab.lifecycle === 'draft') {
          // ⌘T ⌘W is a friction-free no-op — nothing exists yet
          removeTabFromLayout(tabId);
          // …and the empty-Project composer that takes its place is a NEW
          // draft, not the one just discarded (BUG-041).
          setDraftDiscards(current => current + 1);
          return { kind: 'discarded' };
        }
        const goal = summariesRef.current[tab.durableSessionId] ?? null;
        const live = tabIsLive(tab);
        if (live) {
          const started =
            !!(tab.sessionId && engagedRef.current[tab.sessionId]) || !!goal;
          if (!started) {
            // never given work: gone at once, banner history shed behind
            removeTabFromLayout(tabId);
            void api.closeSession(tab.durableSessionId, true).catch(() => {});
            return { kind: 'discarded' };
          }
          if (!opts.force) {
            const sessionDelegation = tab.sessionId
              ? delegationRef.current[tab.sessionId]
              : undefined;
            return {
              kind: 'needs-confirm',
              // The same derivation the tab's own light uses. Asking the
              // activity map directly called a mid-tool-call Agent idle for
              // the three seconds it took to think (BUG-008).
              turn: sessionGlyphState({
                working: !!(
                  tab.sessionId && activityRef.current[tab.sessionId]
                ),
                agent: tab.harness !== 'shell',
                started,
                delegatedBusy: sessionDelegationBusy(sessionDelegation),
                blocked: sessionReportedBlocked(sessionDelegation),
                ownTurn: sessionDelegation?.ownTurn,
              }),
            };
          }
        }
        // one clean transition, then stop + archive behind the strip
        removeTabFromLayout(tabId);
        // Recovery availability follows the same optimistic boundary as the
        // disappearing tab. Main remains authoritative for the durable count;
        // this pending overlay covers immediate ⌘W → ⌘⇧T.
        const settlePendingClose = beginPendingClose();
        const entryData = {
          durableSessionId: tab.durableSessionId,
          title: tab.title,
          titleKind: tab.titleKind,
          goal,
          harness: tab.harness,
          cwd: tab.cwd,
          projectDir: g.dir,
          projectName: g.name,
          harnessSessionId: tab.harnessSessionId,
          initialTask: tab.initialTask,
        };
        try {
          if (live) await api.closeSession(tab.durableSessionId);
          const entry = await api.archiveSession(entryData);
          return { kind: 'closed', entry };
        } catch {
          setError(
            `Could not archive ${tab.title}. Its conversation is still recoverable from its source.`
          );
          return { kind: 'noop' };
        } finally {
          settlePendingClose();
        }
      })();
      closeInFlightRef.current.add(operation);
      void operation.then(
        () => closeInFlightRef.current.delete(operation),
        () => closeInFlightRef.current.delete(operation)
      );
      return operation;
    },
    [
      activityRef,
      beginPendingClose,
      delegationRef,
      engagedRef,
      operations,
      removeTabFromLayout,
      setError,
      stateRef,
      summariesRef,
    ]
  );

  /** resurrect a soft-closed Session whole: tab, goal, provider identity,
   *  retained history — the ledger's other half (D23) */
  const reopenClosedSession = useCallback(
    async (durableSessionId: string, reuseTabId?: string): Promise<boolean> => {
      const api = window.electron?.pty;
      if (!api?.reopenSession) return false;
      // The ledger read is a main-process round trip; ⌘⇧T must not land on
      // whichever tab the operator moved to while it was in flight.
      const claim = reuseTabId
        ? operatorPosition.claimTab(
            stateRef.current.projects.find(group =>
              group.tabs.some(tab => tab.id === reuseTabId)
            )?.dir ?? '',
            reuseTabId
          )
        : operatorPosition.claimHere();
      const entry = await api.reopenSession(durableSessionId);
      if (!entry) return false;
      const tab = tabFromClosedEntry(entry, reuseTabId ?? newTabId());
      if (entry.goal) {
        setSummaries(prev => ({
          ...prev,
          [entry.durableSessionId]: entry.goal as string,
        }));
      }
      const mayMove = claim.stillCurrent();
      setProjects(prev =>
        placeTab(
          prev,
          { dir: entry.projectDir, name: entry.projectName },
          tab,
          reuseTabId
        )
      );
      if (mayMove) moveOperator(entry.projectDir, tab.id);
      return true;
    },
    [moveOperator, setProjects, setSummaries, stateRef]
  );

  const listClosedSessions = useCallback(
    async (): Promise<ClosedSessionEntry[]> =>
      (await window.electron?.pty?.closedSessions?.()) ?? [],
    []
  );

  /** Browser-style reopen (D39): each request runs after any earlier request
   * and after all close operations already in flight, then takes the ledger's
   * newest entry. Reopen restores a stopped tab; it never starts a process. */
  const reopenLastClosedSession = useCallback((): boolean => {
    const api = window.electron?.pty;
    if (!readyRef.current || !api?.closedSessions || !api.reopenSession) {
      return false;
    }
    const run = reopenLastClosedQueueRef.current.then(async () => {
      const closing = [...closeInFlightRef.current];
      if (closing.length > 0) await Promise.allSettled(closing);
      const [latest] = await listClosedSessions();
      if (!latest) return;
      const reopened = await reopenClosedSession(latest.durableSessionId);
      if (!reopened) {
        setError(`Could not reopen ${latest.title}.`);
      }
    });
    reopenLastClosedQueueRef.current = run.catch(() => {
      setError('Could not reopen the last closed tab.');
    });
    return true;
  }, [listClosedSessions, readyRef, reopenClosedSession, setError]);

  return {
    draftDiscards,
    closeTab,
    reopenClosedSession,
    reopenLastClosedSession,
    listClosedSessions,
  };
}
