import { describe, expect, it } from 'vitest';
import {
  adoptObservedIdentity,
  appendTab,
  closeEmptyProjectGroup,
  linkRegistryProject,
  markPtyExited,
  openContextGroup,
  openProjectGroup,
  openProjectGroups,
  patchDraft,
  patchSessionTab,
  pendingRegistryEdits,
  placeTab,
  reconcileRegistry,
  removeTab,
  renameRemoteAgentViews,
  replaceTab,
  reseedDraft,
} from './project-list';
import type {
  Project,
  RemoteAgentTab,
  SessionTab,
  WorkspaceTab,
} from './workspace-model';

function tab(id: string, overrides: Partial<SessionTab> = {}): SessionTab {
  return {
    kind: 'session',
    id,
    durableSessionId: `durable-${id}`,
    harness: 'claude',
    title: 'Claude Code',
    titleKind: 'default',
    cwd: '/a',
    sessionId: `pty-${id}`,
    harnessSessionId: null,
    resumeState: 'live',
    lifecycle: 'running',
    exitCode: null,
    roadmapItemId: null,
    initialTask: null,
    ...overrides,
  };
}

const draft = (id: string) =>
  tab(id, {
    lifecycle: 'draft',
    resumeState: 'identity-missing',
    sessionId: null,
    draftTask: null,
    draftTouched: false,
  });

const coworker = (id: string): RemoteAgentTab => ({
  kind: 'remote-agent',
  id,
  title: 'Scout',
  sourceId: 'source-1',
  nativeAgentId: 'scout',
  agentId: `agent-${id}`,
  projectLabel: 'Exawatt',
});

function group(
  dir: string,
  tabs: WorkspaceTab[],
  activeTabId: string | null = tabs[0]?.id ?? null
): Project {
  return { dir, name: dir.slice(1), color: '#ff0000', tabs, activeTabId };
}

const ids = (project: Project | undefined) => project?.tabs.map(t => t.id);

describe('placeTab', () => {
  it('opens the group with a colour no open group uses, and selects the tab there', () => {
    const next = placeTab(
      [group('/a', [])],
      { dir: '/b', name: 'b' },
      tab('t')
    );
    expect(next[1]).toMatchObject({ dir: '/b', activeTabId: 't' });
    expect(next[1].color).not.toBe(next[0].color);
  });

  it('appends to an open group without moving its current tab', () => {
    const next = placeTab(
      [group('/a', [tab('x')])],
      { dir: '/a', name: 'a' },
      tab('t')
    );
    expect(ids(next[0])).toEqual(['x', 't']);
    expect(next[0].activeTabId).toBe('x');
  });

  it('fills an empty current-tab slot, which moves nobody', () => {
    const next = placeTab(
      [group('/a', [], null)],
      { dir: '/a', name: 'a' },
      tab('t')
    );
    expect(next[0].activeTabId).toBe('t');
  });

  it('takes a draft’s place, and only a draft’s', () => {
    const projects = [group('/a', [tab('x'), draft('d')])];
    expect(
      ids(placeTab(projects, { dir: '/a', name: 'a' }, tab('t'), 'd')[0])
    ).toEqual(['x', 't']);
    expect(
      ids(placeTab(projects, { dir: '/a', name: 'a' }, tab('t'), 'x')[0])
    ).toEqual(['x', 'd', 't']);
  });
});

describe('tab transitions', () => {
  it('replaces a tab in its slot', () => {
    const next = replaceTab(
      [group('/a', [tab('x'), draft('d'), tab('y')])],
      'd',
      tab('d', { lifecycle: 'running' })
    );
    expect(next[0].tabs[1]).toMatchObject({ id: 'd', lifecycle: 'running' });
    expect(ids(next[0])).toEqual(['x', 'd', 'y']);
  });

  it('patches a Session tab and never a coworker that shares its id', () => {
    const projects = [group('/a', [coworker('same'), tab('t')])];
    expect(
      patchSessionTab(projects, 'same', { lifecycle: 'exited' })[0].tabs[0]
    ).toEqual(coworker('same'));
    expect(
      patchSessionTab(projects, 't', { lifecycle: 'exited' })[0].tabs[1]
    ).toMatchObject({ lifecycle: 'exited' });
  });

  it('closing the current tab activates its neighbour; closing another keeps it', () => {
    const projects = [group('/a', [tab('x'), tab('y'), tab('z')], 'y')];
    expect(removeTab(projects, 'y')[0]).toMatchObject({ activeTabId: 'z' });
    expect(removeTab(projects, 'x')[0]).toMatchObject({ activeTabId: 'y' });
    expect(ids(removeTab(projects, 'x')[0])).toEqual(['y', 'z']);
  });
});

describe('PTY events', () => {
  it('an exit stops exactly the tab that incarnation belonged to', () => {
    const projects = [
      group('/a', [
        tab('resumable', { harnessSessionId: 'conversation' }),
        tab('unidentified'),
        tab('other'),
      ]),
    ];
    let next = markPtyExited(projects, {
      id: 'pty-resumable',
      exitCode: 0,
      exitSignal: null,
    });
    next = markPtyExited(next, {
      id: 'pty-unidentified',
      exitCode: 1,
      exitSignal: 'SIGKILL',
    });
    expect(next[0].tabs).toMatchObject([
      {
        sessionId: null,
        lifecycle: 'exited',
        resumeState: 'ended-resumable',
        exitCode: 0,
      },
      {
        sessionId: null,
        lifecycle: 'exited',
        resumeState: 'identity-missing',
        exitSignal: 'SIGKILL',
      },
      { sessionId: 'pty-other', lifecycle: 'running' },
    ]);
  });

  it('an identity makes a stopped tab resumable and leaves a live one live', () => {
    const projects = [
      group('/a', [
        tab('live'),
        tab('stopped', {
          sessionId: null,
          resumeState: 'identity-missing',
          lifecycle: 'exited',
        }),
      ]),
    ];
    const live = adoptObservedIdentity(projects, {
      id: 'pty-live',
      durableSessionId: 'durable-live',
      harnessSessionId: 'c1',
    });
    const stopped = adoptObservedIdentity(live, {
      id: 'pty-gone',
      durableSessionId: 'durable-stopped',
      harnessSessionId: 'c2',
    });
    expect(stopped[0].tabs).toMatchObject([
      { harnessSessionId: 'c1', resumeState: 'live' },
      { harnessSessionId: 'c2', resumeState: 'ended-resumable' },
    ]);
  });
});

describe('drafts', () => {
  it('a no-op composer report returns the same list', () => {
    const typed = patchDraft([group('/a', [draft('d')])], 'd', {
      draftTask: 'Brief',
    });
    expect(typed[0].tabs[0]).toMatchObject({ draftTask: 'Brief' });
    expect(patchDraft(typed, 'd', { draftTask: 'Brief' })).toBe(typed);
  });

  it('only a draft takes composer work', () => {
    const projects = [group('/a', [tab('live'), coworker('c')])];
    expect(patchDraft(projects, 'live', { draftTask: 'x' })).toBe(projects);
    expect(patchDraft(projects, 'c', { draftTask: 'x' })).toBe(projects);
  });

  it('re-seeding a draft with a new source forgets the old model choice', () => {
    const projects = [
      group('/a', [{ ...draft('d'), draftSource: 'claude', draftModel: 'm' }]),
    ];
    expect(
      reseedDraft(projects, '/a', 'd', { draftSource: 'codex' })[0].tabs[0]
    ).toMatchObject({ draftSource: 'codex', draftModel: null });
  });

  it('a new draft appends without taking the Project’s current tab', () => {
    const next = appendTab([group('/a', [tab('x')])], '/a', draft('d'));
    expect(ids(next[0])).toEqual(['x', 'd']);
    expect(next[0].activeTabId).toBe('x');
  });
});

describe('Project groups', () => {
  it('opening an open Project changes nothing', () => {
    const projects = [group('/a', [])];
    expect(openProjectGroup(projects, { dir: '/a', name: 'a' })).toBe(projects);
  });

  it('an import opens each new Project once, with distinct colours', () => {
    const next = openProjectGroups(
      [group('/a', [])],
      [
        { dir: '/a', name: 'a' },
        { dir: '/b', name: 'b' },
        { dir: '/c', name: 'c' },
        { dir: '/b', name: 'b' },
      ]
    );
    expect(next.map(project => project.dir)).toEqual(['/a', '/b', '/c']);
    expect(new Set(next.map(project => project.color)).size).toBe(3);
  });

  it('a Context Group opens folderless, and only once', () => {
    const ref = { id: 'project-1', name: 'Research', color: null };
    const next = openContextGroup([], ref);
    expect(next[0]).toMatchObject({
      dir: 'project-1',
      rootPath: null,
      registryId: 'project-1',
      tabs: [],
      activeTabId: null,
    });
    expect(openContextGroup(next, ref)).toBe(next);
  });

  it('never closes a Project that still holds a tab', () => {
    const projects = [group('/a', [tab('x')]), group('/b', [])];
    expect(closeEmptyProjectGroup(projects, '/a')).toBe(projects);
    expect(
      closeEmptyProjectGroup(projects, '/b').map(project => project.dir)
    ).toEqual(['/a']);
  });

  it('a coworker’s names follow its source', () => {
    const next = renameRemoteAgentViews([group('/a', [coworker('c')])], {
      agentId: 'agent-c',
      displayName: 'Scout Prime',
      projectLabel: 'Renamed',
    });
    expect(next[0].tabs[0]).toMatchObject({
      title: 'Scout Prime',
      projectLabel: 'Renamed',
    });
  });
});

describe('registry identity', () => {
  const row = (id: string, root: string | null, name = '', color = '') => ({
    id,
    root_path: root,
    name,
    color,
  });

  it('links a resolved row and adopts the synced name and colour it has', () => {
    const [linked] = linkRegistryProject(
      [group('/a', [])],
      row('r1', '/a', 'Alpha')
    );
    expect(linked).toMatchObject({
      registryId: 'r1',
      rootPath: '/a',
      name: 'Alpha',
      color: '#ff0000',
    });
  });

  it('a local edit made while the registry read was in flight wins', () => {
    const projects = [
      { ...group('/a', []), name: 'Local name' },
      group('/b', []),
    ];
    const registry = [
      row('r1', '/a', 'Stale', '#000000'),
      row('r2', '/b', 'Synced'),
    ];
    const next = reconcileRegistry(projects, registry, new Set(['/a']));
    expect(next[0]).toMatchObject({ registryId: 'r1', name: 'Local name' });
    expect(next[1]).toMatchObject({ registryId: 'r2', name: 'Synced' });
    expect(pendingRegistryEdits(projects, registry, new Set(['/a']))).toEqual([
      { id: 'r1', name: 'Local name', color: '#ff0000' },
    ]);
  });

  it('matches a folderless group by its Project id', () => {
    const folderless = { ...group('project-1', []), rootPath: null };
    expect(
      reconcileRegistry(
        [folderless],
        [row('project-1', null, 'Research')],
        new Set()
      )[0]
    ).toMatchObject({ registryId: 'project-1', name: 'Research' });
  });

  it('owes the registry nothing for a Project nobody edited', () => {
    expect(
      pendingRegistryEdits(
        [group('/a', [])],
        [row('r1', '/a', 'Other', '#000000')],
        new Set()
      )
    ).toEqual([]);
  });
});
