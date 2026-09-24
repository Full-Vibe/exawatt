import { describe, expect, it } from 'vitest';
import {
  RecentProjects,
  mergeOpenProjects,
  readPersistedRecents,
  recordClosedProject,
  type RecentProject,
} from './recent-projects';
import type { Project } from './workspace-model';

const project = (dir: string, color = ''): Project => ({
  dir,
  name: dir.slice(1),
  color,
  tabs: [],
  activeTabId: null,
});

const recent = (dir: string, lastOpenedAt = 1): RecentProject => ({
  dir,
  name: dir.slice(1),
  lastOpenedAt,
});

describe('Project recency', () => {
  it('ranks open Projects first and keeps closed ones behind them', () => {
    const merged = mergeOpenProjects(
      [project('/b', '#222222')],
      [recent('/a'), recent('/b'), recent('/c')],
      50
    );
    expect(merged).toEqual([
      { dir: '/b', name: 'b', color: '#222222', lastOpenedAt: 50 },
      recent('/a'),
      recent('/c'),
    ]);
  });

  it('is bounded', () => {
    const many = Array.from({ length: 20 }, (_, i) => recent(`/p${i}`));
    const merged = mergeOpenProjects([project('/open')], many, 9);
    expect(merged).toHaveLength(12);
    expect(merged[0].dir).toBe('/open');
  });

  it('moves a closing Project to the front once', () => {
    expect(
      recordClosedProject(project('/b'), [recent('/a'), recent('/b')], 7).map(
        entry => entry.dir
      )
    ).toEqual(['/b', '/a']);
  });

  it('reads a record that is not a list as empty', () => {
    expect(
      readPersistedRecents('corrupt' as unknown as RecentProject[] | undefined)
    ).toEqual([]);
    expect(readPersistedRecents(undefined)).toEqual([]);
  });

  it('remembers a Project closed before any save saw it', () => {
    const recents = new RecentProjects();
    recents.replace([recent('/old')]);
    recents.recordClosed(project('/just-opened'), 5);
    const saved = recents.mergeOpen([project('/still-open')], 6);
    expect(saved.map(entry => entry.dir)).toEqual([
      '/still-open',
      '/just-opened',
      '/old',
    ]);
  });
});
