'use client';

/**
 * Starting a Session: the ⌘T draft tab that composes one (D24/D28), the
 * launch itself, launching in the active Project, and Clone.
 *
 * A launch waits on a worktree checkout and a cold provider, so it can land
 * long after the operator asked. Promoting the new tab to live always
 * happens; going there happens only while the claim taken at the ask is
 * still current (BUG-018).
 */
import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  operatorPosition,
  type OperatorMoveClaim,
} from '@/components/nav/operator-position';
import { recordLaunchConfigurationSuccess } from '@/lib/launch-configurations';
import type { AgentPermissionMode, PtyHarness } from '@exawatt/core';
import type { PtySessionRecord } from '@exawatt/core/desktop-bridge';
import { HARNESS_META } from '../harnesses';
import {
  DEFAULT_AGENT_PERMISSION_MODE,
  isAgentSourceId,
  loadAgentModelCatalog,
  loadAgentSourcePreferences,
  loadAgentSourceRegistry,
  permissionModeFor,
} from '../agent-sources';
import {
  cloneTargetSourceReady,
  sessionClonePrompt,
  tabCanClone,
  type CloneSessionTarget,
} from '../session-clone';
import {
  applyWorkspaceDraftPatch,
  isSessionTab,
  newDraftTab,
  newDurableSessionId,
  newTabId,
  projectRootPath,
  tabFromPtySession,
  type Latest,
  type Project,
  type WorkspaceDraftPatch,
  type WorkspaceLayout,
} from './workspace-model';
import { appendTab, patchDraft, replaceTab, reseedDraft } from './project-list';

export interface LaunchOptions {
  /** Preserve the initiating gesture's focus authority across preparation. */
  focusClaim?: OperatorMoveClaim;
  harness: PtyHarness;
  dir: string;
  permissionMode?: AgentPermissionMode;
  /** model pinned for this launch after resolving the source's current default */
  model?: string;
  /** reasoning effort pinned for this launch; omitted for a harness default */
  effort?: string;
  /** optional first user task for a new interactive Agent Session */
  initialPrompt?: string;
  /** Resume one provider conversation by its durable harness identity. */
  resumeSessionId?: string;
  /** Goal metadata for a resumed conversation; never written to the PTY. */
  statedTask?: string;
  /** Immediate context subtitle while the resumed harness restores. */
  restoredSubtitle?: string;
  /** Retained Exawatt Session to adopt after a successful provider launch.
   * The ledger entry is consumed only after create succeeds. */
  restoreSessionId?: string;
  /** create a git worktree (<repo>-wt/<branch>) and launch inside it */
  worktreeBranch?: string;
  /** roadmap item this session will work on (ENG-017 S4, optional) */
  roadmapItemId?: string;
  /** launch INTO an existing draft tab (D24 new-tab page), keeping its
   *  strip position and id */
  reuseTabId?: string;
}

export function useSessionLaunch({
  stateRef,
  sizeRef,
  summariesRef,
  engagedRef,
  observedIdentitiesRef,
  addSession,
  moveOperator,
  syncProjectIdentity,
  setProjects,
  setError,
  setLastUsedDir,
}: {
  stateRef: Latest<WorkspaceLayout>;
  /** the pane's estimated terminal size for a NEW process (see
   *  `WorkspaceStateOptions.getInitialSize`) */
  sizeRef: Latest<(() => { cols: number; rows: number } | null) | undefined>;
  summariesRef: Latest<Record<string, string>>;
  engagedRef: Latest<Record<string, boolean>>;
  observedIdentitiesRef: Latest<ReadonlyMap<string, string>>;
  addSession: (
    session: PtySessionRecord,
    tabId?: string,
    roadmapItemId?: string | null,
    initialTask?: string | null
  ) => string;
  moveOperator: (dir: string, tabId: string | null) => void;
  syncProjectIdentity: (ref: { rootPath: string; name: string }) => void;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setLastUsedDir: Dispatch<SetStateAction<string>>;
}) {
  /** Clone requests currently spawning, keyed `tabId:targetId`. A ref, not
   *  state: it exists to make a duplicate request a no-op, and re-rendering
   *  the workspace on it would only add churn. Not Session-keyed, and every
   *  entry is deleted by the request that added it. */
  const cloningRef = useRef(new Set<string>());

  // ---- verbs ----
  const launch = useCallback(
    async (opts: LaunchOptions): Promise<boolean> => {
      const api = window.electron?.pty;
      if (!api) {
        setError(
          'Local Agent launch is unavailable. Restart Exawatt and try again.'
        );
        return false;
      }
      const dir = opts.dir.trim();
      if (!dir) {
        setError('Choose a Project directory for this session.');
        return false;
      }
      const launchLabel = opts.harness === 'shell' ? 'shell' : 'Agent';
      // BUG-018: everything below this line waits on a worktree checkout and a
      // cold provider, so it may land minutes after the operator asked. State
      // the position that authorises going to the new Session NOW, while the
      // ask is his. ⌘T launches from the draft tab itself, so that tab is the
      // position; every other path launches from wherever he stands.
      const claim =
        opts.focusClaim ??
        (opts.reuseTabId
          ? operatorPosition.claimTab(
              stateRef.current.projects.find(group =>
                group.tabs.some(tab => tab.id === opts.reuseTabId)
              )?.dir ?? dir,
              opts.reuseTabId
            )
          : operatorPosition.claimHere());
      try {
        let cwd = dir;
        if (opts.worktreeBranch) {
          const wt = await api.createWorktree(dir, opts.worktreeBranch.trim());
          if (!wt.ok) {
            setError(wt.error);
            return false;
          }
          cwd = wt.path;
        }
        const size = sizeRef.current?.() ?? null;
        const tabId = opts.reuseTabId ?? newTabId();
        const restoredEntry = opts.restoreSessionId
          ? (await api.closedSessions()).find(
              entry => entry.durableSessionId === opts.restoreSessionId
            )
          : undefined;
        if (
          restoredEntry &&
          (restoredEntry.harness !== opts.harness ||
            (restoredEntry.harnessSessionId &&
              restoredEntry.harnessSessionId !== opts.resumeSessionId))
        ) {
          setError(
            'The saved Session no longer matches this provider conversation.'
          );
          return false;
        }
        const durableSessionId =
          restoredEntry?.durableSessionId ?? newDurableSessionId();
        const statedTask =
          restoredEntry?.initialTask ?? opts.statedTask?.trim() ?? null;
        const restoredSubtitle =
          restoredEntry?.goal ?? opts.restoredSubtitle?.trim() ?? null;
        const res = await api.create({
          harness: opts.harness,
          cwd,
          title: HARNESS_META[opts.harness].label,
          durableSessionId,
          ...(opts.permissionMode
            ? { permissionMode: opts.permissionMode }
            : {}),
          ...(opts.model?.trim() ? { model: opts.model.trim() } : {}),
          ...(opts.effort?.trim() ? { effort: opts.effort.trim() } : {}),
          ...(opts.initialPrompt?.trim()
            ? { initialPrompt: opts.initialPrompt.trim() }
            : {}),
          ...(opts.resumeSessionId
            ? { resumeSessionId: opts.resumeSessionId }
            : {}),
          ...(statedTask ? { statedTask } : {}),
          ...(restoredSubtitle ? { restoredSubtitle } : {}),
          ...(size ?? {}),
        });
        if (!res.ok) {
          setError(res.error);
          return false;
        }
        const observedIdentity =
          observedIdentitiesRef.current.get(res.session.durableSessionId) ??
          null;
        const launchedSession =
          observedIdentity && !res.session.harnessSessionId
            ? { ...res.session, harnessSessionId: observedIdentity }
            : res.session;
        if (restoredEntry) {
          // Commit the soft-close migration only after the provider process is
          // live. A failed create leaves the recoverable ledger entry intact.
          try {
            await api.reopenSession(restoredEntry.durableSessionId);
          } catch (cause) {
            console.warn(
              'Could not consume migrated Session ledger entry',
              cause
            );
          }
        }
        setError(null);
        setLastUsedDir(dir);
        // Promoting the tab to live ALWAYS happens; going there happens only
        // while the ask is still current. Conflating the two is what let a
        // late launch yank the operator off the Agent he had moved to.
        //
        // Asked BEFORE the tab lands, so the answer is about where the
        // operator stands and never about a position this launch just changed.
        const mayMove = claim.stillCurrent();
        // WHERE the Session landed, which is a Project group and not a path
        // string. Reusing a draft places the tab in the group that already
        // holds it, by tab identity; `launchedSession.projectDir` is MAIN's
        // view of the working directory, and the two are not the same name for
        // the same place. An exact provider resume launches in the directory
        // the provider's own history recorded, which the conversation catalog
        // realpaths — so on macOS a Project opened as `/var/…` comes back as
        // `/private/var/…`. Moving the operator to that string set `activeDir`
        // to a key no Project group has: `activeProject` went null, the ribbon
        // lost its Project, and the next launch verb opened the Project opener
        // instead of a composer, which reads as a verb that silently does
        // nothing (BUG-039). Go to the TAB; ask the layout where it is.
        const landedIn = opts.reuseTabId
          ? (stateRef.current.projects.find(group =>
              group.tabs.some(tab => tab.id === opts.reuseTabId)
            ) ?? null)
          : null;
        const landedDir = landedIn?.dir ?? launchedSession.projectDir;
        if (opts.reuseTabId) {
          // the draft becomes the live tab in place — same id, same spot
          const tab = tabFromPtySession(
            launchedSession,
            tabId,
            opts.roadmapItemId ?? null,
            statedTask || opts.initialPrompt?.trim() || null
          );
          setProjects(prev => replaceTab(prev, tabId, tab));
        } else {
          addSession(
            launchedSession,
            tabId,
            opts.roadmapItemId ?? null,
            statedTask || opts.initialPrompt?.trim() || null
          );
        }
        if (mayMove) moveOperator(landedDir, tabId);
        // Resolution bridge (ENG-015 S5 P3): register/refresh this directory's
        // Project in the durable, synced registry. Best-effort — a registry
        // failure (offline, not signed in) must NEVER stop the operator opening
        // a session, so it runs detached and swallows its own errors.
        //
        // The same landed identity: registering main's realpath would mint a
        // SECOND registry Project for the Project the operator is looking at.
        syncProjectIdentity({
          rootPath: landedDir,
          name: landedIn?.name ?? launchedSession.projectName,
        });
        return true;
      } catch (cause) {
        const detail =
          cause instanceof Error && cause.message ? `: ${cause.message}` : '.';
        setError(`Could not start the ${launchLabel}${detail}`);
        return false;
      }
    },
    [
      addSession,
      moveOperator,
      observedIdentitiesRef,
      setError,
      setLastUsedDir,
      setProjects,
      sizeRef,
      stateRef,
      syncProjectIdentity,
    ]
  );

  /**
   * Start a new Agent Session from bounded Exawatt-owned context. Clone never
   * supplies resumeSessionId (provider continuity) and never mutates or closes
   * the originating Session.
   *
   * Clone reads preferences, the source registry, and the model catalog before
   * it can spawn anything, so seconds pass with the menu already closed and no
   * new tab yet. The operator reads that gap as "nothing happened" and asks
   * again — and used to get a second billed Agent for it (2026-08-04). One
   * clone per (tab, target) may be in flight; a repeat is dropped, not
   * duplicated.
   */
  const cloneSessionOnce = useCallback(
    async (tabId: string, target: CloneSessionTarget): Promise<boolean> => {
      const project = stateRef.current.projects.find(group =>
        group.tabs.some(tab => tab.id === tabId)
      );
      const found = project?.tabs.find(candidate => candidate.id === tabId);
      // Clone starts a NEW local Agent from locally read current Session context.
      // A coworker's context is its source's, and Exawatt holds no authority
      // to spawn anything there, so the verb simply does not reach one.
      const tab = found && isSessionTab(found) ? found : null;
      const contextSummary = tab
        ? (summariesRef.current[tab.durableSessionId] ?? null)
        : null;
      if (
        !project ||
        !tab ||
        !tabCanClone(tab, {
          engaged: !!(tab.sessionId && engagedRef.current[tab.sessionId]),
          contextSummary,
        })
      ) {
        setError('Only started Agent Sessions can be cloned.');
        return false;
      }

      const focusClaim = operatorPosition.claimTab(project.dir, tabId);
      let currentContext: Awaited<
        ReturnType<
          NonNullable<
            NonNullable<typeof window.electron>['pty']
          >['cloneContext']
        >
      >;
      try {
        currentContext = await window.electron!.pty!.cloneContext(
          tab.durableSessionId
        );
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : 'Current Session context could not be read.'
        );
        return false;
      }
      const [preferenceLoad, registryLoad, modelCatalog] = await Promise.all([
        loadAgentSourcePreferences(),
        loadAgentSourceRegistry('launch', true),
        loadAgentModelCatalog(target.source, project.dir),
      ]);
      // A clone refuses exactly what the main-process gate refuses
      // (`cloneTargetSourceReady`, one verdict for every surface).
      const targetReady = cloneTargetSourceReady(registryLoad.snapshot, target);
      const modelReady =
        target.modelId === modelCatalog.effectiveModel ||
        modelCatalog.models.some(model => model.id === target.modelId);
      if (registryLoad.status !== 'live' || !targetReady || !modelReady) {
        setError(
          registryLoad.error?.message ??
            'That Agent Source is not available for a new Session.'
        );
        return false;
      }

      // The menu's origin remains the owner across asynchronous source reads.
      // Closing or moving it cancels; switching focus cannot redirect a clone.
      const stillHere = stateRef.current.projects
        .find(group => group.dir === project.dir)
        ?.tabs.find(candidate => candidate.id === tabId);
      if (
        !stillHere ||
        !isSessionTab(stillHere) ||
        stillHere.durableSessionId !== tab.durableSessionId ||
        stillHere.cwd !== tab.cwd ||
        stillHere.sessionId !== tab.sessionId
      )
        return false;

      const permissionMode = permissionModeFor(
        preferenceLoad.preferences,
        project.dir,
        target.source,
        preferenceLoad.usedSafeFallback
          ? 'prompt'
          : DEFAULT_AGENT_PERMISSION_MODE
      );
      const cloned = await launch({
        focusClaim,
        harness: target.source,
        dir: tab.cwd,
        permissionMode,
        model: target.modelId,
        effort: target.effort ?? undefined,
        initialPrompt: sessionClonePrompt({
          target: target.source,
          initialTask: tab.initialTask,
          contextSummary,
          currentContext,
        }),
        statedTask: tab.initialTask ?? contextSummary ?? undefined,
        roadmapItemId: tab.roadmapItemId ?? undefined,
      });
      if (cloned) {
        void recordLaunchConfigurationSuccess(project.dir, {
          sourceId: target.sourceId,
          modelId: target.modelId,
          effort: target.effort,
        }).catch(() => undefined);
      }
      return cloned;
    },
    [engagedRef, launch, setError, stateRef, summariesRef]
  );

  const cloneSession = useCallback(
    async (tabId: string, target: CloneSessionTarget): Promise<boolean> => {
      const inFlightKey = `${tabId}:${target.id}`;
      if (cloningRef.current.has(inFlightKey)) return false;
      cloningRef.current.add(inFlightKey);
      try {
        return await cloneSessionOnce(tabId, target);
      } catch (error) {
        setError(
          error instanceof Error ? error.message : 'Clone could not be started.'
        );
        return false;
      } finally {
        cloningRef.current.delete(inFlightKey);
      }
    },
    [cloneSessionOnce, setError]
  );

  /** launch in the active project's directory (fallback: last used) —
   *  the one dir-resolution path for ⌘T, palette commands, and buttons */
  const launchHere = useCallback(
    (harness: PtyHarness): boolean => {
      const { projects: gs, activeDir: ad, lastUsedDir: lu } = stateRef.current;
      const activeProject = gs.find(group => group.dir === ad);
      const dir = activeProject ? projectRootPath(activeProject) : lu || null;
      if (!dir) {
        setError('Choose a Project directory for this session.');
        return false;
      }
      void launch({ harness, dir });
      return true;
    },
    [launch, setError, stateRef]
  );

  /** ⌘T (D24): a new tab exists the moment you ask for it — a draft tab
   *  in the active (or given) Project whose pane is the composer. One
   *  draft per Project; asking again selects it. Returns null when no
   *  Project is open (caller falls back to the Project chooser). */
  const createDraftTab = useCallback(
    (dirArg?: string, seed: WorkspaceDraftPatch = {}): string | null => {
      const requestedSource =
        seed.draftSource && isAgentSourceId(seed.draftSource)
          ? seed.draftSource
          : undefined;
      const requested: WorkspaceDraftPatch = {
        ...seed,
        ...(requestedSource ? { draftSource: requestedSource } : {}),
      };
      const { projects: gs, activeDir: ad } = stateRef.current;
      const dir = dirArg ?? ad;
      const g = dir ? gs.find(x => x.dir === dir) : undefined;
      if (!g) return null;
      const existing = g.tabs.find(
        t => isSessionTab(t) && t.lifecycle === 'draft'
      );
      if (existing) {
        if (Object.keys(requested).length > 0) {
          setProjects(prev => reseedDraft(prev, g.dir, existing.id, requested));
        }
        moveOperator(g.dir, existing.id);
        return existing.id;
      }
      const seededTab = applyWorkspaceDraftPatch(
        newDraftTab(g.dir, requestedSource ?? null),
        requested
      );
      setProjects(prev => appendTab(prev, g.dir, seededTab));
      moveOperator(g.dir, seededTab.id);
      return seededTab.id;
    },
    [moveOperator, setProjects, stateRef]
  );

  /** the composer reports its work-in-progress here (D28): the draft tab
   *  owns the typed task and chosen source, so switching tabs, switching
   *  Projects, or relaunching the app never loses draft work. No-op edits
   *  return the same state so per-keystroke calls stay cheap. */
  const updateDraft = useCallback(
    (tabId: string, patch: WorkspaceDraftPatch) => {
      setProjects(prev => patchDraft(prev, tabId, patch));
    },
    [setProjects]
  );

  return {
    launch,
    cloneSession,
    launchHere,
    createDraftTab,
    updateDraft,
  };
}
