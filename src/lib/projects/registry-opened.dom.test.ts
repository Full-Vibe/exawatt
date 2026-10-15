// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetResolvedDistributionForTest } from '@/lib/distribution/resolved';
import type { AnalyticsEvent } from '@/lib/analytics';

const captured = vi.hoisted(() => [] as AnalyticsEvent[]);

vi.mock('@/lib/analytics', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  captureAnalyticsEvent: (event: AnalyticsEvent) => void captured.push(event),
}));

import {
  openManualProject,
  openRemoteHomeProject,
  openRepositoryProject,
} from './registry';

/** ENG-047: the open verbs record `project_opened` when, and only when, an
 *  operator gesture says why they ran. */
describe('project_opened from the registry open verbs', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_EXAWATT_DISTRIBUTION_JSON', '');
    resetResolvedDistributionForTest();
    window.localStorage.clear();
    captured.length = 0;
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllEnvs();
    resetResolvedDistributionForTest();
  });

  it('records the source, the harness hint and the binding, never the name or folder', async () => {
    await openRepositoryProject(
      { rootPath: '/Users/example/Code/secret-repo', name: 'secret-repo' },
      { source: 'suggested', harnessHint: 'claude' }
    );
    await openManualProject(
      { id: 'project-1', name: 'Contracts' },
      { source: 'connect' }
    );
    await openRemoteHomeProject(
      { id: 'home-1', name: 'Remote' },
      { source: 'connect' }
    );
    expect(captured).toEqual([
      {
        name: 'project_opened',
        surface: 'web',
        source: 'suggested',
        harnessHint: 'claude',
        bound: 'folder',
      },
      {
        name: 'project_opened',
        surface: 'web',
        source: 'connect',
        harnessHint: null,
        bound: 'folderless',
      },
      {
        name: 'project_opened',
        surface: 'web',
        source: 'connect',
        harnessHint: null,
        bound: 'folderless',
      },
    ]);
    expect(JSON.stringify(captured)).not.toContain('secret');
  });

  it('records nothing for bookkeeping opens that name no source', async () => {
    await openRepositoryProject({ rootPath: '/w/acme', name: 'acme' });
    await openManualProject({ id: 'project-2', name: 'Notes' });
    expect(captured).toEqual([]);
  });
});
