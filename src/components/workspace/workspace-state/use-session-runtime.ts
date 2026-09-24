'use client';

/**
 * The process behind a retained Session tab: resume it (one tab, a
 * Project, or everything), change its model, or pause a Project's Agents.
 *
 * Each verb replaces or stops a PTY incarnation while the tab, its durable
 * Session identity, and its place in the strip stay put. A replacement
 * belongs to the retained Session, never to whichever tab is selected when
 * the process answers, and a close wins over adoption.
 */
import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type {
  PtySessionRecord,
  SessionModelChange,
} from '@exawatt/core/desktop-bridge';
import { HARNESS_META } from '../harnesses';
import {
  DEFAULT_AGENT_PERMISSION_MODE,
  loadAgentSourcePreferences,
  permissionModeFor,
} from '../agent-sources';
import {
  REVIVE_FAILED,
  isSessionTab,
  resumableAgentTabsInProject,
  runtimeAdoptionPatch,
  tabCanResumeAsAgent,
  tabIsLive,
  type Latest,
  type ResumeBatchProgress,
  type SessionTab,
  type WorkspaceLayout,
  type WorkspaceTab,
} from './workspace-model';
import type { SessionOperations } from './session-operations';

export function useSessionRuntime({
  stateRef,
  sizeRef,
  operations,
  summariesRef,
  updateTab,
  setError,
}: {
  stateRef: Latest<WorkspaceLayout>;
  sizeRef: Latest<(() => { cols: number; rows: number } | null) | undefined>;
  operations: SessionOperations;
  summariesRef: Latest<Record<string, string>>;
  updateTab: (tabId: string, patch: Partial<SessionTab>) => void;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  const [resumeBatchProgress, setResumeBatchProgress] =
    useState<ResumeBatchProgress | null>(null);
  /** A replacement belongs to the retained Session, never to whichever tab
   * happens to be selected when the process responds. Close wins over adoption. */
  const adoptSessionRuntime = useCallback(
    async (tab: SessionTab, session: PtySessionRecord): Promise<boolean> => {
      const retained = stateRef.current.projects
        .flatMap(project => project.tabs)
        .find(candidate => candidate.id === tab.id);
      if (
        !retained ||
        !isSessionTab(retained) ||
        retained.durableSessionId !== tab.durableSessionId
      ) {
        await window.electron?.pty?.closeSession(session.durableSessionId);
        return false;
      }
      const observedExit = operations.observedExit(
        tab.durableSessionId,
        session.id
      );
      updateTab(tab.id, runtimeAdoptionPatch(tab, session, observedExit));
      return true;
    },
    [operations, stateRef, updateTab]
  );

  const resumeTab = useCallback(
    async (tabId: string, selectedHarnessId?: string): Promise<boolean> => {
      const api = window.electron?.pty;
      if (!api) return false;
      const found = stateRef.current.projects
        .flatMap(project => project.tabs)
        .find(candidate => candidate.id === tabId);
      const tab = found && isSessionTab(found) ? found : null;
      if (
        !tab ||
        tabIsLive(tab) ||
        tab.resumeState === 'resuming' ||
        operations.isBusy(tabId)
      )
        return false;
      const exactId = selectedHarnessId ?? tab.harnessSessionId;
      if (tab.harness !== 'shell' && !exactId) {
        setError(
          `Choose the exact ${HARNESS_META[tab.harness].label} conversation.`
        );
        return false;
      }
      // Admission precedes every await, including preference loading.
      operations.begin(tabId);
      updateTab(tabId, {
        resumeState: 'resuming',
        lifecycle: 'resuming',
        exitCode: null,
        exitSignal: null,
      });
      try {
        const projectDir =
          stateRef.current.projects.find(project =>
            project.tabs.some(candidate => candidate.id === tabId)
          )?.dir ?? tab.cwd;
        const preferenceLoad =
          tab.harness === 'shell' ? null : await loadAgentSourcePreferences();
        const permissionMode =
          tab.harness === 'shell'
            ? undefined
            : permissionModeFor(
                preferenceLoad!.preferences,
                projectDir,
                tab.harness,
                preferenceLoad!.usedSafeFallback
                  ? 'prompt'
                  : DEFAULT_AGENT_PERMISSION_MODE
              );
        // A close while preferences were loading must not launch anything.
        if (
          !stateRef.current.projects.some(project =>
            project.tabs.some(
              candidate =>
                candidate.id === tabId &&
                isSessionTab(candidate) &&
                candidate.durableSessionId === tab.durableSessionId
            )
          )
        )
          return false;
        const restoredSubtitle =
          summariesRef.current[tab.durableSessionId] ?? undefined;
        const result = await api.create({
          harness: tab.harness,
          cwd: tab.cwd,
          title: tab.title,
          durableSessionId: tab.durableSessionId,
          ...(permissionMode ? { permissionMode } : {}),
          ...(exactId ? { resumeSessionId: exactId } : {}),
          ...(tab.launchModel ? { model: tab.launchModel } : {}),
          ...(tab.launchEffort ? { effort: tab.launchEffort } : {}),
          ...(tab.initialTask ? { statedTask: tab.initialTask } : {}),
          ...(restoredSubtitle ? { restoredSubtitle } : {}),
          ...(sizeRef.current?.() ?? {}),
        });
        if (!result.ok) throw new Error(result.error);
        const adopted = await adoptSessionRuntime(
          { ...tab, harnessSessionId: exactId ?? null },
          result.session
        );
        if (adopted) setError(null);
        return adopted;
      } catch (cause) {
        updateTab(tabId, {
          resumeState: 'failed',
          lifecycle: 'failed',
          exitCode: REVIVE_FAILED,
        });
        const detail =
          cause instanceof Error && cause.message ? `: ${cause.message}` : '.';
        setError(`Could not resume ${tab.title}${detail}`);
        return false;
      } finally {
        operations.end(tabId, tab.durableSessionId);
      }
    },
    [
      adoptSessionRuntime,
      operations,
      setError,
      sizeRef,
      stateRef,
      summariesRef,
      updateTab,
    ]
  );

  const changeSessionModel = useCallback(
    async (tabId: string, choice: SessionModelChange) => {
      const api = window.electron?.pty;
      const tab = stateRef.current.projects
        .flatMap(project => project.tabs)
        .find(item => item.id === tabId);
      if (!api || !tab || !isSessionTab(tab) || !tab.sessionId)
        throw new Error('Session is no longer running.');
      if (operations.isBusy(tabId))
        throw new Error('A Session operation is already in progress.');
      operations.begin(tabId);
      try {
        const result = await api.changeModel(tab.sessionId, choice);
        if (!result.ok) throw new Error(result.error);
        await adoptSessionRuntime(tab, result.session);
      } finally {
        operations.end(tabId, tab.durableSessionId);
      }
    },
    [adoptSessionRuntime, operations, stateRef]
  );

  const pauseProject = useCallback(
    async (projectDir: string, confirmedSessionIds?: string[]) => {
      const tabs =
        stateRef.current.projects.find(project => project.dir === projectDir)
          ?.tabs ?? [];
      const targets = tabs
        .filter(isSessionTab)
        .filter(
          tab =>
            tab.harness !== 'shell' &&
            (confirmedSessionIds
              ? confirmedSessionIds.includes(tab.durableSessionId)
              : !!tab.sessionId)
        );
      const sessionIds = targets.map(tab => tab.durableSessionId);
      const api = window.electron?.pty;
      if (!api?.pauseSessions) throw new Error('Project pause is unavailable.');
      if (targets.some(tab => operations.isBusy(tab.id)))
        throw new Error('A Session operation is already in progress.');
      targets.forEach(tab => operations.begin(tab.id));
      try {
        const result = await api.pauseSessions(
          sessionIds,
          confirmedSessionIds !== undefined
        );
        if (result.kind === 'completed') {
          for (const item of result.results) {
            if (item.status !== 'paused' && item.status !== 'already-paused')
              continue;
            const tab = targets.find(
              target => target.durableSessionId === item.durableSessionId
            );
            if (tab)
              updateTab(tab.id, {
                sessionId: null,
                lifecycle: 'stopped-clean',
                exitCode: null,
                exitSignal: null,
              });
          }
        }
        return { ...result, sessionIds };
      } finally {
        targets.forEach(tab => operations.end(tab.id, tab.durableSessionId));
      }
    },
    [operations, stateRef, updateTab]
  );

  const resumeTabs = useCallback(
    async (tabs: WorkspaceTab[]) => {
      const eligible = tabs.filter(tabCanResumeAsAgent);
      if (eligible.length === 0) return;
      setResumeBatchProgress({ completed: 0, total: eligible.length });
      let resumed = 0;
      try {
        for (const [index, tab] of eligible.entries()) {
          if (await resumeTab(tab.id)) resumed += 1;
          setResumeBatchProgress({
            completed: index + 1,
            total: eligible.length,
          });
        }
      } finally {
        setResumeBatchProgress(null);
      }
      const failed = eligible.length - resumed;
      if (failed > 0) {
        setError(
          `${resumed} ${resumed === 1 ? 'agent' : 'agents'} resumed; ${failed} ${failed === 1 ? 'agent needs' : 'agents need'} review.`
        );
      }
    },
    [resumeTab, setError]
  );

  const resumeAll = useCallback(() => {
    void resumeTabs(stateRef.current.projects.flatMap(project => project.tabs));
  }, [resumeTabs, stateRef]);

  const resumeProject = useCallback(
    (projectDir: string) => {
      void resumeTabs(
        resumableAgentTabsInProject(stateRef.current.projects, projectDir)
      );
    },
    [resumeTabs, stateRef]
  );

  return {
    resumeBatchProgress,
    resumeTab,
    changeSessionModel,
    pauseProject,
    resumeAll,
    resumeProject,
  };
}
