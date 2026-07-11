import { describe, expect, it } from 'vitest';
import { parsePersisted } from './use-workspace-state';

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
    expect(parsed?.projects[0].tabs.map(item => item.harnessSessionId)).toEqual(ids);
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
    expect(parsed?.v).toBe(4);
    expect(parsed?.pinnedTabId).toBe('tab-1');
    expect(parsed?.projects[0].tabs[0]).toMatchObject({
      harnessSessionId: '00000001-1111-4111-8111-111111111111',
      roadmapItemId: null,
    });
  });

  it('keeps declared roadmap links through a save/load round trip', () => {
    const parsed = parsePersisted({
      v: 4,
      lastUsedDir: '/project',
      activeDir: '/project',
      projects: [
        {
          dir: '/project',
          name: 'Project',
          activeTabId: 'tab-1',
          tabs: [{ ...tab('1'), roadmapItemId: 'ENG-017' }],
        },
      ],
    });
    expect(parsed?.projects[0].tabs[0].roadmapItemId).toBe('ENG-017');
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
    expect(parsed?.v).toBe(4);
    expect(parsed?.projects[0].tabs[0]).toMatchObject({
      harnessSessionId: null,
      roadmapItemId: null,
    });
  });
});
