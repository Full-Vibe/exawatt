import { describe, expect, it } from 'vitest';
import {
  parsePersisted,
  resumableAgentTabsInProject,
  tabCanResumeAsAgent,
  tabFromPtySession,
  type Project,
  type WorkspaceTab,
} from './use-workspace-state';

const tab = (id: string, harnessSessionId?: string) => ({
  id: `tab-${id}`,
  harness: 'claude' as const,
  title: `Agent ${id}`,
  cwd: '/project',
  sessionId: `pty-${id}`,
  ...(harnessSessionId ? { harnessSessionId } : {}),
});

describe('workspace persistence v3', () => {
  it('preserves four distinct exact identities in one Project', () => {
    const ids = [1, 2, 3, 4].map(
      n => `0000000${n}-1111-4111-8111-111111111111`
    );
    const parsed = parsePersisted({
      v: 3,
      lastUsedDir: '/project',
      activeDir: '/project',
      projects: [
        {
          dir: '/project',
          name: 'Project',
          activeTabId: 'tab-1',
          tabs: ids.map((id, index) => tab(String(index + 1), id)),
        },
      ],
    });
    expect(parsed?.projects[0].tabs.map(item => item.harnessSessionId)).toEqual(
      ids
    );
  });

  it('migrates old tabs to identity missing instead of inventing an ID', () => {
    const parsed = parsePersisted({
      v: 2,
      lastUsedDir: '/project',
      activeDir: '/project',
      projects: [
        {
          dir: '/project',
          name: 'Project',
          activeTabId: 'tab-1',
          tabs: [tab('1')],
        },
      ],
    });
    expect(parsed?.projects[0].tabs[0].harnessSessionId).toBeNull();
  });
});

describe('workspace persistence v4 (ENG-017 S4)', () => {
  it('upgrades a v3 layout with linkless tabs, preserving everything else', () => {
    const parsed = parsePersisted({
      v: 3,
      lastUsedDir: '/project',
      activeDir: '/project',
      pinnedTabId: 'tab-1',
      projects: [
        {
          dir: '/project',
          name: 'Project',
          color: '#19E6FF',
          activeTabId: 'tab-1',
          tabs: [tab('1', '00000001-1111-4111-8111-111111111111')],
        },
      ],
    });
    expect(parsed?.v).toBe(6);
    expect(parsed?.pinnedTabId).toBe('tab-1');
    expect(parsed?.projects[0].tabs[0]).toMatchObject({
      harnessSessionId: '00000001-1111-4111-8111-111111111111',
      roadmapItemId: null,
      durableSessionId: 'tab-1',
      lifecycle: 'stopped-clean',
      exitCode: null,
    });
  });

  it('migrates v4 links while assigning non-aliased durable identities', () => {
    const parsed = parsePersisted({
      v: 4,
      lastUsedDir: '/project',
      activeDir: '/project',
      projects: [
        {
          dir: '/project',
          name: 'Project',
          activeTabId: 'tab-1',
          tabs: [
            { ...tab('1'), roadmapItemId: 'ENG-017' },
            { ...tab('2'), roadmapItemId: null },
          ],
        },
      ],
    });
    expect(parsed?.projects[0].tabs[0].roadmapItemId).toBe('ENG-017');
    expect(parsed?.projects[0].tabs.map(item => item.durableSessionId)).toEqual(
      ['tab-1', 'tab-2']
    );
  });

  it('chains a v1 initiatives layout all the way to v4', () => {
    const parsed = parsePersisted({
      v: 1,
      lastUsedDir: '/project',
      activeDir: '/project',
      initiatives: [
        {
          dir: '/project',
          name: 'Project',
          activeTabId: 'tab-1',
          tabs: [tab('1')],
        },
      ],
    });
    expect(parsed?.v).toBe(6);
    expect(parsed?.projects[0].tabs[0]).toMatchObject({
      harnessSessionId: null,
      roadmapItemId: null,
      durableSessionId: 'tab-1',
      lifecycle: 'stopped-clean',
    });
  });
});

describe('workspace persistence v5 (ENG-018)', () => {
  it('preserves an inert Project with no Session tabs', () => {
    const parsed = parsePersisted({
      v: 5,
      lastUsedDir: '/project',
      activeDir: '/project',
      projects: [
        {
          dir: '/project',
          name: 'Project',
          activeTabId: null,
          tabs: [],
        },
      ],
    });
    expect(parsed?.projects).toEqual([
      {
        dir: '/project',
        name: 'Project',
        activeTabId: null,
        tabs: [],
      },
    ]);
  });

  it('preserves lifecycle and repairs duplicate durable IDs deterministically', () => {
    const parsed = parsePersisted({
      v: 5,
      lastUsedDir: '/project',
      activeDir: '/project',
      projects: [
        {
          dir: '/project',
          name: 'Project',
          activeTabId: 'tab-1',
          tabs: [
            {
              ...tab('1'),
              durableSessionId: 'same',
              roadmapItemId: null,
              lifecycle: 'interrupted',
              exitCode: null,
            },
            {
              ...tab('2'),
              durableSessionId: 'same',
              roadmapItemId: null,
              lifecycle: 'nonsense',
              exitCode: 7,
            },
          ],
        },
      ],
    });

    expect(parsed?.projects[0].tabs[0].lifecycle).toBe('interrupted');
    expect(parsed?.projects[0].tabs[1]).toMatchObject({
      durableSessionId: 'tab-2-session',
      lifecycle: 'stopped-clean',
      exitCode: 7,
    });
  });

  it('round-trips the durable goal fields and tolerates their absence (D21)', () => {
    const parsed = parsePersisted({
      v: 5,
      lastUsedDir: '/project',
      activeDir: '/project',
      projects: [
        {
          dir: '/project',
          name: 'Project',
          activeTabId: 'tab-1',
          tabs: [
            {
              ...tab('1', '00000001-1111-4111-8111-111111111111'),
              durableSessionId: 'session-1',
              roadmapItemId: null,
              lifecycle: 'stopped-clean',
              exitCode: null,
              initialTask: 'Overhaul the YC intake flow',
              contextSummary: 'Fix YC intake feature',
              goalVisual: {
                identityKey: 'goal-identity',
                revision: 2,
                state: 'ready',
                dataUrl: 'data:image/webp;base64,YWJj',
              },
            },
            {
              // pre-D21 layout: no goal fields
              ...tab('2'),
              durableSessionId: 'session-2',
              roadmapItemId: null,
              lifecycle: 'stopped-clean',
              exitCode: null,
            },
          ],
        },
      ],
    });
    expect(parsed?.projects[0].tabs[0]).toMatchObject({
      initialTask: 'Overhaul the YC intake flow',
      contextSummary: 'Fix YC intake feature',
      goalVisual: {
        identityKey: 'goal-identity',
        revision: 2,
        state: 'ready',
      },
    });
    expect(parsed?.projects[0].tabs[1].initialTask).toBeUndefined();
    expect(parsed?.projects[0].tabs[1].contextSummary).toBeUndefined();
    expect(parsed?.projects[0].tabs[1].goalVisual).toBeUndefined();
  });

  it('round-trips a content-bearing draft tab (D28)', () => {
    const parsed = parsePersisted({
      v: 5,
      lastUsedDir: '/project',
      activeDir: '/project',
      projects: [
        {
          dir: '/project',
          name: 'Project',
          activeTabId: 'tab-draft',
          tabs: [
            {
              id: 'tab-draft',
              durableSessionId: 'session-draft',
              harness: 'claude',
              title: 'New tab',
              cwd: '/project',
              sessionId: null,
              harnessSessionId: null,
              roadmapItemId: null,
              lifecycle: 'draft',
              exitCode: null,
              initialTask: null,
              contextSummary: null,
              draftTask: 'Half-written task brief',
              draftSource: 'codex',
              draftModel: 'gpt-5.6-terra',
              draftEffort: 'high',
              draftTouched: true,
              draftWorktree: true,
              draftBranch: 'agent/finish-intake',
              draftRoadmapItemId: 'ENG-017',
            },
          ],
        },
      ],
    });
    expect(parsed?.projects[0].tabs[0]).toMatchObject({
      lifecycle: 'draft',
      titleKind: 'default',
      draftTask: 'Half-written task brief',
      draftSource: 'codex',
      draftModel: 'gpt-5.6-terra',
      draftEffort: 'high',
      draftTouched: true,
      draftWorktree: true,
      draftBranch: 'agent/finish-intake',
      draftRoadmapItemId: 'ENG-017',
    });
  });

  it('repairs the bounded D31 catalog prompt leak without erasing normal renames', () => {
    const parsed = parsePersisted({
      v: 5,
      lastUsedDir: '/project',
      activeDir: '/project',
      projects: [
        {
          dir: '/project',
          name: 'Project',
          activeTabId: 'tab-leaked',
          tabs: [
            {
              id: 'tab-leaked',
              durableSessionId: 'session-leaked',
              harness: 'codex',
              title:
                "I'm going to give you a call transcript with Dr. Matt Rosenberg, along…",
              cwd: '/project',
              sessionId: 'pty-leaked',
              harnessSessionId: 'provider-leaked',
              roadmapItemId: null,
              lifecycle: 'running',
              exitCode: null,
              initialTask: 'Are your E&M codes based on AMA guidelines?',
              contextSummary: 'Verify E&M codes use AMA guidelines',
            },
            {
              id: 'tab-renamed',
              durableSessionId: 'session-renamed',
              harness: 'codex',
              title: 'E&M billing audit',
              cwd: '/project',
              sessionId: 'pty-renamed',
              harnessSessionId: 'provider-renamed',
              roadmapItemId: null,
              lifecycle: 'running',
              exitCode: null,
              initialTask: 'Audit E&M billing',
              contextSummary: 'Audit E&M billing',
            },
          ],
        },
      ],
    });

    expect(parsed?.v).toBe(6);
    expect(parsed?.projects[0].tabs[0]).toMatchObject({
      title: 'Codex',
      titleKind: 'default',
    });
    expect(parsed?.projects[0].tabs[1]).toMatchObject({
      title: 'E&M billing audit',
      titleKind: 'operator',
    });
  });
});

describe('workspace persistence v6 title ownership', () => {
  it('preserves the manual inactive-Project disclosure preference', () => {
    const parsed = parsePersisted({
      v: 6,
      lastUsedDir: '/project',
      activeDir: '/project',
      projects: [
        {
          dir: '/project',
          name: 'Project',
          activeTabId: null,
          ribbonExpanded: true,
          tabs: [],
        },
      ],
    });
    expect(parsed?.projects[0].ribbonExpanded).toBe(true);
  });

  it('preserves an explicit rename even when it matches the source label', () => {
    const parsed = parsePersisted({
      v: 6,
      lastUsedDir: '/project',
      activeDir: '/project',
      projects: [
        {
          dir: '/project',
          name: 'Project',
          activeTabId: 'tab-1',
          tabs: [
            {
              ...tab('1', 'provider-1'),
              durableSessionId: 'session-1',
              title: 'Claude Code',
              titleKind: 'operator',
              roadmapItemId: null,
              lifecycle: 'running',
              exitCode: null,
            },
          ],
        },
      ],
    });

    expect(parsed?.projects[0].tabs[0]).toMatchObject({
      title: 'Claude Code',
      titleKind: 'operator',
    });
  });
});

describe('workspace Agent recovery eligibility', () => {
  const stopped = {
    id: 'tab-1',
    durableSessionId: 'durable-1',
    harness: 'claude',
    title: 'Agent',
    titleKind: 'operator',
    cwd: '/project',
    sessionId: null,
    harnessSessionId: 'provider-1',
    resumeState: 'ended-resumable',
    lifecycle: 'stopped-clean',
    exitCode: null,
    roadmapItemId: null,
    initialTask: null,
  } satisfies WorkspaceTab;

  it('includes stopped exact agents but excludes shells, live, and unidentified tabs', () => {
    expect(tabCanResumeAsAgent(stopped)).toBe(true);
    expect(tabCanResumeAsAgent({ ...stopped, harness: 'shell' })).toBe(false);
    expect(
      tabCanResumeAsAgent({
        ...stopped,
        resumeState: 'live',
        sessionId: 'pty-1',
      })
    ).toBe(false);
    expect(tabCanResumeAsAgent({ ...stopped, harnessSessionId: null })).toBe(
      false
    );
  });

  it('keeps Project recovery inside the selected Project boundary', () => {
    const project = (dir: string, tabs: WorkspaceTab[]): Project => ({
      dir,
      name: dir.slice(1),
      color: '#19E6FF',
      tabs,
      activeTabId: tabs[0]?.id ?? null,
    });
    const other = { ...stopped, id: 'tab-2', cwd: '/other' };
    const projects = [
      project('/project', [
        stopped,
        { ...stopped, id: 'shell', harness: 'shell' },
      ]),
      project('/other', [other]),
    ];

    expect(
      resumableAgentTabsInProject(projects, '/project').map(tab => tab.id)
    ).toEqual(['tab-1']);
    expect(projects[1].tabs[0]).toBe(other);
  });
});

describe('PTY tab adoption', () => {
  it('reconstructs an unknown exited PTY as a stopped durable tab', () => {
    const adopted = tabFromPtySession(
      {
        id: 'pty-ended',
        durableSessionId: 'session-ended',
        harness: 'shell',
        title: 'Shell',
        cwd: '/project',
        projectDir: '/project',
        projectName: 'Project',
        cols: 120,
        rows: 40,
        startedAt: 100,
        exited: true,
        exitCode: 0,
        lastDataAt: 200,
        harnessSessionId: null,
      },
      'session-ended'
    );

    expect(adopted).toMatchObject({
      id: 'session-ended',
      durableSessionId: 'session-ended',
      sessionId: null,
      resumeState: 'identity-missing',
      lifecycle: 'exited',
      exitCode: 0,
      titleKind: 'default',
      startedAt: 100,
    });
  });
});
