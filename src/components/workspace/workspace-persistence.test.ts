import { describe, expect, it } from 'vitest';
import {
  parsePersisted,
  tabCanResumeAsAgent,
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
    expect(parsed?.v).toBe(5);
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
    expect(parsed?.v).toBe(5);
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
});

describe('Resume All eligibility', () => {
  const stopped = {
    id: 'tab-1',
    durableSessionId: 'durable-1',
    harness: 'claude',
    title: 'Agent',
    cwd: '/project',
    sessionId: null,
    harnessSessionId: 'provider-1',
    resumeState: 'ended-resumable',
    lifecycle: 'stopped-clean',
    exitCode: null,
    roadmapItemId: null,
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
});
