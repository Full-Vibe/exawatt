/**
 * Transitions of the open Project list: every way a verb or an event changes
 * which groups are open and which tabs they hold.
 *
 * Each is `(projects, …) → projects`, written to be handed to `setProjects`
 * as an updater, so the hook stays the one place that decides WHEN a
 * transition happens and this module the one place that decides WHAT it does.
 * None of them moves the operator; going somewhere is `moveOperator`'s.
 */
import { pickDistinctColor } from '../project-colors';
import { nextActiveTabAfterClose } from '../tab-ring';
import type { Project as RegistryProject } from '@/lib/projects/registry';
import type { PtyExitEvent } from '@exawatt/core/desktop-bridge';
import {
  applyWorkspaceDraftPatch,
  isRemoteAgentTab,
  isSessionTab,
  projectRootPath,
  type Project,
  type RemoteAgentOpenRef,
  type SessionTab,
  type WorkspaceDraftPatch,
  type WorkspaceTab,
} from './workspace-model';

/** A group about to open: its identity, before it has a colour or tabs. */
type ProjectSeed = Pick<Project, 'dir' | 'name'> &
  Partial<Pick<Project, 'rootPath' | 'registryId'>>;

/**
 * Put a tab in the group `seed.dir` names, opening that group with the
 * least-used colour when it is not open.
 *
 * A Project still always names a current tab while it has one: filling an
 * EMPTY slot says where the operator would land if he ever went there, which
 * moves nobody; overwriting a filled one would be a move, so this never does.
 * `replaceDraftId` puts the tab where that tab stands, but only while it is
 * still a draft; anything else it names is left alone and the tab appends.
 */
export function placeTab(
  projects: Project[],
  seed: ProjectSeed,
  tab: WorkspaceTab,
  replaceDraftId?: string
): Project[] {
  const i = projects.findIndex(g => g.dir === seed.dir);
  if (i === -1) {
    return [
      ...projects,
      {
        ...seed,
        color: pickDistinctColor(projects.map(g => g.color)),
        tabs: [tab],
        activeTabId: tab.id,
      },
    ];
  }
  const next = [...projects];
  const replacesDraft =
    !!replaceDraftId &&
    next[i].tabs.some(
      candidate =>
        candidate.id === replaceDraftId &&
        isSessionTab(candidate) &&
        candidate.lifecycle === 'draft'
    );
  next[i] = {
    ...next[i],
    tabs: replacesDraft
      ? next[i].tabs.map(candidate =>
          candidate.id === replaceDraftId ? tab : candidate
        )
      : [...next[i].tabs, tab],
    activeTabId: next[i].activeTabId ?? tab.id,
  };
  return next;
}

/** Swap the tab with this id for another, in place: same group, same slot. */
export function replaceTab(
  projects: Project[],
  tabId: string,
  tab: WorkspaceTab
): Project[] {
  return projects.map(grp =>
    grp.tabs.some(t => t.id === tabId)
      ? {
          ...grp,
          tabs: grp.tabs.map(t => (t.id === tabId ? tab : t)),
        }
      : grp
  );
}

/**
 * Patch one Session tab. Deliberately not total over the union: every field
 * it exists to move is a PTY fact, and a coworker tab has none of them. A
 * remote tab reaches this only through a bug, and ignoring it keeps that bug
 * from writing a lifecycle onto someone else's Agent.
 */
export function patchSessionTab(
  projects: Project[],
  tabId: string,
  patch: Partial<SessionTab>
): Project[] {
  return projects.map(g =>
    g.tabs.some(t => t.id === tabId && isSessionTab(t))
      ? {
          ...g,
          tabs: g.tabs.map(t =>
            t.id === tabId && isSessionTab(t) ? { ...t, ...patch } : t
          ),
        }
      : g
  );
}

/** Remove a tab; closing the active one activates its right neighbour,
 *  like Chrome (D24). */
export function removeTab(projects: Project[], tabId: string): Project[] {
  return projects.map(grp => {
    if (!grp.tabs.some(t => t.id === tabId)) return grp;
    const activeTabId =
      grp.activeTabId === tabId
        ? nextActiveTabAfterClose(grp.tabs, tabId)
        : grp.activeTabId;
    return {
      ...grp,
      tabs: grp.tabs.filter(t => t.id !== tabId),
      activeTabId,
    };
  });
}

/**
 * A PTY incarnation exited. PTY events are about local processes: a coworker
 * tab has no durable Session and no incarnation, so no event can name it.
 */
export function markPtyExited(
  projects: Project[],
  {
    id,
    exitCode,
    exitSignal,
  }: Pick<PtyExitEvent, 'id' | 'exitCode' | 'exitSignal'>
): Project[] {
  return projects.map(g => ({
    ...g,
    tabs: g.tabs.map(t =>
      isSessionTab(t) && t.sessionId === id
        ? {
            ...t,
            sessionId: null,
            exitCode,
            exitSignal,
            resumeState: t.harnessSessionId
              ? 'ended-resumable'
              : 'identity-missing',
            lifecycle: 'exited',
          }
        : t
    ),
  }));
}

/** Main learned a Session's provider conversation. A stopped tab that had no
 *  identity becomes resumable; a live one keeps its state. */
export function adoptObservedIdentity(
  projects: Project[],
  {
    id,
    durableSessionId,
    harnessSessionId,
  }: { id: string; durableSessionId: string; harnessSessionId: string }
): Project[] {
  return projects.map(g => ({
    ...g,
    tabs: g.tabs.map(t =>
      isSessionTab(t) &&
      (t.sessionId === id || t.durableSessionId === durableSessionId)
        ? {
            ...t,
            harnessSessionId,
            resumeState: t.sessionId ? t.resumeState : 'ended-resumable',
          }
        : t
    ),
  }));
}

/**
 * The composer reports its work-in-progress to the draft tab that owns it
 * (D28). Only a draft carries composer work, and only a Session tab can be a
 * draft: a coworker is opened, never composed. A no-op edit returns the same
 * list, so per-keystroke calls stay cheap.
 */
export function patchDraft(
  projects: Project[],
  tabId: string,
  patch: WorkspaceDraftPatch
): Project[] {
  const group = projects.find(g => g.tabs.some(t => t.id === tabId));
  const found = group?.tabs.find(t => t.id === tabId);
  const tab = found && isSessionTab(found) ? found : null;
  if (!group || !tab || tab.lifecycle !== 'draft') return projects;
  const nextTab = applyWorkspaceDraftPatch(tab, patch);
  if (
    Object.keys(patch).every(key => {
      const field = key as keyof WorkspaceDraftPatch;
      return nextTab[field] === tab[field];
    })
  )
    return projects;
  return projects.map(g =>
    g === group
      ? {
          ...g,
          tabs: g.tabs.map(t => (t.id === tabId ? nextTab : t)),
        }
      : g
  );
}

/** Re-seed the draft a Project already has with a newer request. */
export function reseedDraft(
  projects: Project[],
  dir: string,
  draftId: string,
  patch: WorkspaceDraftPatch
): Project[] {
  return projects.map(grp =>
    grp.dir === dir
      ? {
          ...grp,
          tabs: grp.tabs.map(t =>
            t.id === draftId && isSessionTab(t)
              ? applyWorkspaceDraftPatch(t, patch)
              : t
          ),
        }
      : grp
  );
}

/** Append a tab to an open Project without touching its current tab. */
export function appendTab(
  projects: Project[],
  dir: string,
  tab: WorkspaceTab
): Project[] {
  return projects.map(grp =>
    grp.dir === dir ? { ...grp, tabs: [...grp.tabs, tab] } : grp
  );
}

/** A coworker's source owns its names; a rename there shows here on open. */
export function renameRemoteAgentViews(
  projects: Project[],
  ref: Pick<RemoteAgentOpenRef, 'agentId' | 'displayName' | 'projectLabel'>
): Project[] {
  return projects.map(project => ({
    ...project,
    tabs: project.tabs.map(tab =>
      isRemoteAgentTab(tab) && tab.agentId === ref.agentId
        ? {
            ...tab,
            title: ref.displayName,
            projectLabel: ref.projectLabel,
          }
        : tab
    ),
  }));
}

/** Open an empty Project group, unless one with that key is already open. */
export function openProjectGroup(
  projects: Project[],
  seed: ProjectSeed
): Project[] {
  if (projects.some(project => project.dir === seed.dir)) return projects;
  return [
    ...projects,
    {
      ...seed,
      color: pickDistinctColor(projects.map(project => project.color)),
      tabs: [],
      activeTabId: null,
    },
  ];
}

/** Open several empty Project groups in one transition, each colour chosen
 *  against the groups before it, skipping any already open. */
export function openProjectGroups(
  projects: Project[],
  seeds: readonly ProjectSeed[]
): Project[] {
  const next = [...projects];
  for (const seed of seeds) {
    if (next.some(project => project.dir === seed.dir)) continue;
    next.push({
      ...seed,
      color: pickDistinctColor(next.map(project => project.color)),
      tabs: [],
      activeTabId: null,
    });
  }
  return next;
}

/** Open a durable Context Group whose local folder binding is absent. */
export function openContextGroup(
  projects: Project[],
  ref: { id: string; name: string; color: string | null }
): Project[] {
  const index = projects.findIndex(
    project => project.registryId === ref.id || project.dir === ref.id
  );
  if (index !== -1) return projects;
  return [
    ...projects,
    {
      dir: ref.id,
      rootPath: null,
      registryId: ref.id,
      name: ref.name,
      color:
        ref.color ?? pickDistinctColor(projects.map(project => project.color)),
      tabs: [],
      activeTabId: null,
    },
  ];
}

/** Close a Project group only while it is empty: a Project close must never
 *  orphan a live PTY off-screen. */
export function closeEmptyProjectGroup(
  projects: Project[],
  dir: string
): Project[] {
  return projects.some(
    candidate => candidate.dir === dir && candidate.tabs.length > 0
  )
    ? projects
    : projects.filter(candidate => candidate.dir !== dir);
}

/** Link the group a registry row resolved to, adopting its synced identity
 *  where the row has one. */
export function linkRegistryProject(
  projects: Project[],
  row: Pick<RegistryProject, 'id' | 'name' | 'color' | 'root_path'>
): Project[] {
  return projects.map(group =>
    group.dir === row.root_path
      ? {
          ...group,
          registryId: row.id,
          rootPath: row.root_path,
          name: row.name || group.name,
          color: row.color || group.color,
        }
      : group
  );
}

type RegistryRow = Pick<RegistryProject, 'id' | 'name' | 'color' | 'root_path'>;

function registryIndex(registry: readonly RegistryRow[]) {
  const byPath = new Map(
    registry
      .filter(project => project.root_path !== null)
      .map(project => [project.root_path, project] as const)
  );
  const byId = new Map(registry.map(project => [project.id, project]));
  return (group: Project): RegistryRow | undefined => {
    const rootPath = projectRootPath(group);
    return (rootPath ? byPath.get(rootPath) : undefined) ?? byId.get(group.dir);
  };
}

/**
 * Adopt each open Project's synced name and colour (S5 P3), and link the
 * group to its registry row for future syncs. A rename or recolour the
 * operator made while the registry read was in flight wins over the
 * now-stale snapshot: the row is linked, the local edit kept.
 */
export function reconcileRegistry(
  projects: Project[],
  registry: readonly RegistryRow[],
  editedDirs: ReadonlySet<string>
): Project[] {
  const rowFor = registryIndex(registry);
  return projects.map(g => {
    const r = rowFor(g);
    if (!r) return g;
    return editedDirs.has(g.dir)
      ? { ...g, registryId: r.id, rootPath: r.root_path }
      : {
          ...g,
          registryId: r.id,
          rootPath: r.root_path,
          name: r.name || g.name,
          color: r.color || g.color,
        };
  });
}

/**
 * Local edits that could not sync before their row's id was known. Each is
 * pushed up once the registry answers, name before colour.
 */
export function pendingRegistryEdits(
  projects: readonly Project[],
  registry: readonly RegistryRow[],
  editedDirs: ReadonlySet<string>
): Array<{ id: string; name?: string; color?: string }> {
  const rowFor = registryIndex(registry);
  const edits: Array<{ id: string; name?: string; color?: string }> = [];
  for (const g of projects) {
    const r = rowFor(g);
    if (!r || !editedDirs.has(g.dir)) continue;
    const edit: { id: string; name?: string; color?: string } = { id: r.id };
    if (g.name && g.name !== r.name) edit.name = g.name;
    if (g.color && g.color !== r.color) edit.color = g.color;
    if (edit.name !== undefined || edit.color !== undefined) edits.push(edit);
  }
  return edits;
}
