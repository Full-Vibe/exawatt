'use client';

/**
 * Project groups: opening, importing, and closing them, and their durable
 * registry identity (S5 P3).
 *
 * The open list is the workspace's; this hook owns the verbs that change
 * which groups are in it and the best-effort sync of their name, colour,
 * and order to the registry. A registry failure (offline, not signed in)
 * never stops a verb: every sync runs detached and swallows its own errors.
 */
import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  operatorPosition,
  type OperatorMoveClaim,
} from '@/components/nav/operator-position';
import {
  openRepositoryProject,
  listProjects,
  renameProject as registryRenameProject,
  reorderProjects as registryReorderProjects,
  setProjectColor as registrySetProjectColor,
} from '@/lib/projects/registry';
import type { RequestTicket } from '@/hooks/use-latest-request';
import {
  isRemoteAgentTab,
  newTabId,
  projectRootPath,
  remoteAgentGroupDir,
  type Latest,
  type Project,
  type RemoteAgentOpenRef,
  type RemoteAgentTab,
  type WorkspaceLayout,
} from './workspace-model';
import {
  closeEmptyProjectGroup,
  linkRegistryProject,
  openContextGroup,
  openProjectGroup,
  openProjectGroups,
  pendingRegistryEdits,
  placeTab,
  reconcileRegistry,
  renameRemoteAgentViews,
} from './project-list';
import type { RecentProjects } from './recent-projects';

export function useWorkspaceProjects({
  stateRef,
  recents,
  setProjects,
  setActiveDir,
  setLastUsedDir,
  setError,
  moveOperator,
}: {
  stateRef: Latest<WorkspaceLayout>;
  recents: RecentProjects;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  setActiveDir: Dispatch<SetStateAction<string | null>>;
  setLastUsedDir: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | null>>;
  moveOperator: (dir: string, tabId: string | null) => void;
}) {
  /** One projected Agent can have one tab-opening transaction at a time. */
  const remoteAgentOpenInFlightRef = useRef<
    Array<{ agentId: string; task: Promise<string> }>
  >([]);
  // dirs whose identity the operator edited locally — the reconcile-on-load
  // must not clobber a rename/recolor made while the registry fetch was still
  // in flight (its snapshot is already stale), and instead pushes it up.
  const editedDirsRef = useRef<Set<string>>(new Set());

  const syncProjectIdentity = useCallback(
    (ref: { rootPath: string; name: string }) => {
      void openRepositoryProject(ref)
        .then(proj => {
          setProjects(prev => linkRegistryProject(prev, proj));
          if (!proj.color) {
            const group = stateRef.current.projects.find(
              project => project.dir === proj.root_path
            );
            if (group) {
              void registrySetProjectColor(proj.id, group.color).catch(
                () => {}
              );
            }
          }
        })
        .catch(() => {});
    },
    [setProjects, stateRef]
  );

  /**
   * Reconcile durable identity with the registry once the layout is loaded.
   * Async, so a slow or offline registry never delays the terminal: adopt
   * each Project's synced name/color (a rename/recolor made on another
   * machine or a prior run shows here) and link the group to its registry
   * row for future syncs. The caller's ticket decides whether the answer
   * still belongs to the workspace it asked for.
   */
  const reconcileWithRegistry = useCallback(
    (ticket: RequestTicket) => {
      void listProjects()
        .then(registry => {
          if (!ticket.current || registry.length === 0) return;
          // A rename/recolor made during this async window must win over
          // the now-stale registry snapshot: link the row but keep the
          // local edit (it's pushed up below so it still syncs). Otherwise
          // adopt the synced name/color.
          const editedDirs = editedDirsRef.current;
          setProjects(prev => reconcileRegistry(prev, registry, editedDirs));
          // Edits made before the row's id was known couldn't sync (the verbs
          // guard on registryId); now that we have the ids, push them up.
          for (const edit of pendingRegistryEdits(
            stateRef.current.projects,
            registry,
            editedDirs
          )) {
            if (edit.name !== undefined) {
              void registryRenameProject(edit.id, edit.name).catch(() => {});
            }
            if (edit.color !== undefined) {
              void registrySetProjectColor(edit.id, edit.color).catch(() => {});
            }
          }
        })
        .catch(() => {});
    },
    [setProjects, stateRef]
  );

  /** Open a Project independently of Sessions. Main-process resolution keeps
   *  git worktrees grouped under the same durable Project identity. */
  const openProject = useCallback(
    async (dir: string): Promise<boolean> => {
      const claim = operatorPosition.claimHere();
      const result = await window.electron?.projects?.resolve(dir);
      if (!result) return false;
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      const canonicalDir = result.projectDir;
      const mayMove = claim.stillCurrent();
      setProjects(prev =>
        openProjectGroup(prev, {
          dir: canonicalDir,
          name: result.projectName,
        })
      );
      // The Project is registered either way; going to it needs the ask to
      // still be his (the resolve is a main-process round trip).
      if (mayMove) moveOperator(canonicalDir, null);
      setLastUsedDir(canonicalDir);
      setError(null);
      syncProjectIdentity({
        rootPath: canonicalDir,
        name: result.projectName,
      });
      return true;
    },
    [moveOperator, setError, setLastUsedDir, setProjects, syncProjectIdentity]
  );

  /**
   * Open a connected coworker's conversation (ENG-033 H2).
   *
   * The same gesture as opening a local Session, and the same result: a tab in
   * the strip, selected. Asking twice returns to the tab that already exists
   * rather than opening a second view of one coworker.
   *
   * Opening reaches nothing. No Gateway call, no command, no state change on
   * the source: the tab is a view, and the surface it renders is what reads
   * the conversation.
   *
   * A caller that awaited anything before asking (a roster read, most often)
   * passes the claim it took BEFORE that await (BUG-192). Without one, the
   * claim is taken here, which is only right for a synchronous gesture.
   */
  const openRemoteAgent = useCallback(
    (
      ref: RemoteAgentOpenRef,
      focusClaim?: OperatorMoveClaim
    ): Promise<string> => {
      const inFlight = remoteAgentOpenInFlightRef.current.find(
        entry => entry.agentId === ref.agentId
      );
      if (inFlight) return inFlight.task;
      const claim = focusClaim ?? operatorPosition.claimHere();
      const task = (async () => {
        const registryProject = await listProjects()
          .then(
            rows => rows.find(project => project.id === ref.projectId) ?? null
          )
          .catch(() => null);
        const currentProject = stateRef.current.projects.find(
          project =>
            project.registryId === ref.projectId ||
            project.dir === ref.projectId ||
            (registryProject?.root_path !== null &&
              registryProject?.root_path !== undefined &&
              projectRootPath(project) === registryProject.root_path)
        );
        const dir =
          currentProject?.dir ??
          registryProject?.root_path ??
          remoteAgentGroupDir(ref);
        const existing = stateRef.current.projects
          .flatMap(project =>
            project.tabs.map(tab => ({ dir: project.dir, tab }))
          )
          .find(
            entry =>
              isRemoteAgentTab(entry.tab) && entry.tab.agentId === ref.agentId
          );
        if (existing) {
          // The source owns the names; a rename there shows here on next open.
          setProjects(prev => renameRemoteAgentViews(prev, ref));
          if (claim.stillCurrent()) moveOperator(existing.dir, existing.tab.id);
          return existing.tab.id;
        }
        const tab: RemoteAgentTab = {
          kind: 'remote-agent',
          id: newTabId(),
          title: ref.displayName,
          sourceId: ref.sourceId,
          nativeAgentId: ref.nativeAgentId,
          agentId: ref.agentId,
          projectLabel: ref.projectLabel,
        };
        // The Project this Agent was mapped to at Connect time may not be
        // open. It is still where the coworker belongs, so the group opens
        // with the mapping's own label rather than the coworker landing in
        // whichever Project the operator happens to be standing in.
        setProjects(prev =>
          placeTab(
            prev,
            {
              dir,
              rootPath: registryProject?.root_path ?? null,
              registryId: registryProject?.id ?? ref.projectId,
              name: ref.projectLabel || ref.displayName,
            },
            tab
          )
        );
        if (claim.stillCurrent()) moveOperator(dir, tab.id);
        return tab.id;
      })();
      const transaction = { agentId: ref.agentId, task };
      remoteAgentOpenInFlightRef.current.push(transaction);
      const release = () => {
        remoteAgentOpenInFlightRef.current =
          remoteAgentOpenInFlightRef.current.filter(
            entry => entry !== transaction
          );
      };
      task.then(
        () => release(),
        () => release()
      );
      return task;
    },
    [moveOperator, setProjects, stateRef]
  );

  /** Open a durable Context Group whose local folder binding is absent. */
  const openContextProject = useCallback(
    (ref: { id: string; name: string; color: string | null }): void => {
      setProjects(prev => openContextGroup(prev, ref));
      moveOperator(ref.id, null);
    },
    [moveOperator, setProjects]
  );

  /** Curated import adds inert Projects in one state transition. Every path is
   *  resolved again at the trust boundary even when it came from our scanner. */
  const importProjects = useCallback(
    async (directories: string[]): Promise<boolean> => {
      const unique = [...new Set(directories)];
      if (unique.length === 0) return false;
      const claim = operatorPosition.claimHere();
      const resolved = await Promise.all(
        unique.map(directory => window.electron?.projects?.resolve(directory))
      );
      const failedIndex = resolved.findIndex(result => !result || !result.ok);
      if (failedIndex >= 0) {
        const failed = resolved[failedIndex];
        setError(
          failed && 'error' in failed
            ? failed.error
            : 'Project discovery is unavailable in this app build.'
        );
        return false;
      }
      const refs = resolved.filter(
        (result): result is Extract<NonNullable<typeof result>, { ok: true }> =>
          !!result && result.ok
      );
      if (refs.length === 0) return false;
      const mayMove = claim.stillCurrent();
      setProjects(prev =>
        openProjectGroups(
          prev,
          refs.map(ref => ({ dir: ref.projectDir, name: ref.projectName }))
        )
      );
      const first = refs[0];
      if (mayMove) moveOperator(first.projectDir, null);
      setLastUsedDir(first.projectDir);
      setError(null);
      for (const ref of refs) {
        syncProjectIdentity({
          rootPath: ref.projectDir,
          name: ref.projectName,
        });
      }
      return true;
    },
    [moveOperator, setError, setLastUsedDir, setProjects, syncProjectIdentity]
  );

  /**
   * Remove an EMPTY Project from the open workspace without deleting its
   * durable registry/library identity. Callers own any Agent close flow first;
   * this guard prevents a Project close from orphaning a live PTY off-screen.
   */
  const closeProject = useCallback(
    (dir: string): boolean => {
      const { projects: groups, activeDir: currentDir } = stateRef.current;
      const index = groups.findIndex(project => project.dir === dir);
      const project = groups[index];
      if (!project || project.tabs.length > 0) return false;

      // A just-opened Project may not have reached the debounced layout save.
      // Seed recency synchronously so ⌘N can always bring a closed group back.
      recents.recordClosed(project, Date.now());

      setProjects(previous => closeEmptyProjectGroup(previous, dir));
      if (currentDir === dir) {
        setActiveDir(groups[index + 1]?.dir ?? groups[index - 1]?.dir ?? null);
      }
      return true;
    },
    [recents, setActiveDir, setProjects, stateRef]
  );

  // ── Arrangement (D20): order is an interface once ⌘digit ordinals
  // exist. Tabs arrange within their Project; Projects arrange globally.
  // Order persists with the layout; Project order also pushes best-effort
  // to the registry's sort_order so it syncs across machines.
  const syncProjectOrder = useCallback((ordered: Project[]) => {
    const ids = ordered
      .map(project => project.registryId)
      .filter((id): id is string => !!id);
    if (ids.length > 1) void registryReorderProjects(ids).catch(() => {});
  }, []);

  const setProjectColor = useCallback(
    (dir: string, color: string) => {
      editedDirsRef.current.add(dir);
      setProjects(prev => prev.map(g => (g.dir === dir ? { ...g, color } : g)));
      // sync to the durable registry so the recolor persists + syncs (best-effort)
      const g = stateRef.current.projects.find(p => p.dir === dir);
      if (g?.registryId) {
        void registrySetProjectColor(g.registryId, color).catch(() => {});
      }
    },
    [setProjects, stateRef]
  );

  const renameProject = useCallback(
    (dir: string, name: string) => {
      const next = name.trim();
      if (!next) return;
      editedDirsRef.current.add(dir);
      setProjects(prev =>
        prev.map(g => (g.dir === dir ? { ...g, name: next } : g))
      );
      // sync to the durable registry so the rename persists + syncs (best-effort)
      const g = stateRef.current.projects.find(p => p.dir === dir);
      if (g?.registryId) {
        void registryRenameProject(g.registryId, next).catch(() => {});
      }
    },
    [setProjects, stateRef]
  );

  return {
    syncProjectIdentity,
    reconcileWithRegistry,
    syncProjectOrder,
    openProject,
    openRemoteAgent,
    openContextProject,
    importProjects,
    closeProject,
    renameProject,
    setProjectColor,
  };
}
