// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetResolvedDistributionForTest } from '@/lib/distribution/resolved';
import {
  archiveProject,
  listProjects,
  openRepositoryProject,
  renameProject,
  reorderProjects,
  setProjectColor,
} from './registry';

describe('Community Project registry', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_EXAWATT_DISTRIBUTION_JSON', '');
    resetResolvedDistributionForTest();
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllEnvs();
    resetResolvedDistributionForTest();
  });

  it('persists repository Projects locally and reuses a known root', async () => {
    const created = await openRepositoryProject({
      rootPath: '/Users/tester/Code/nebula-console',
      name: 'nebula-console',
      gitRemote: 'git@example.test:demo/nebula-console.git',
    });
    await renameProject(created.id, 'Nebula Console');
    await setProjectColor(created.id, '#55c2ff');
    const reopened = await openRepositoryProject({
      rootPath: '/Users/tester/Code/nebula-console',
      name: 'ignored-on-reopen',
    });

    expect(reopened.id).toBe(created.id);
    expect(reopened.name).toBe('Nebula Console');
    expect(reopened.color).toBe('#55c2ff');
    expect(await listProjects()).toEqual([reopened]);
    expect(window.localStorage.key(0)).toContain(
      'ai.exawatt.community:projects:v1'
    );
  });

  it('supports ordering and soft removal without a hosted account', async () => {
    const first = await openRepositoryProject({
      rootPath: '/tmp/first',
      name: 'First',
    });
    const second = await openRepositoryProject({
      rootPath: '/tmp/second',
      name: 'Second',
    });

    await reorderProjects([second.id, first.id]);
    expect((await listProjects()).map(project => project.id)).toEqual([
      second.id,
      first.id,
    ]);

    await archiveProject(second.id);
    expect((await listProjects()).map(project => project.id)).toEqual([
      first.id,
    ]);
  });
});
