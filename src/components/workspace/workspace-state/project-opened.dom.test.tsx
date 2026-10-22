// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsEvent } from '@/lib/analytics';
import { resetResolvedDistributionForTest } from '@/lib/distribution/resolved';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';
import { RecentProjects } from './recent-projects';
import type { Project, WorkspaceLayout } from './workspace-model';

const captured = vi.hoisted(() => [] as AnalyticsEvent[]);
const registry = vi.hoisted(() => ({ refuses: false }));

vi.mock('@/lib/analytics', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  captureAnalyticsEvent: (event: AnalyticsEvent) => void captured.push(event),
}));

// The registry as a signed-in operator meets it when his session cannot be
// refreshed (BUG-150): every write refuses.
vi.mock('@/lib/projects/registry', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/projects/registry')>();
  const refusing =
    <A extends unknown[], R>(write: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> =>
      registry.refuses
        ? Promise.reject(new Error('The Project registry is unavailable.'))
        : write(...args);
  return {
    ...real,
    listProjects: refusing(real.listProjects),
    openRepositoryProject: refusing(real.openRepositoryProject),
    openManualProject: refusing(real.openManualProject),
    openRemoteHomeProject: refusing(real.openRemoteHomeProject),
  };
});

import {
  openManualProject,
  openRemoteHomeProject,
  openRepositoryProject,
  recordProjectOpened,
} from '@/lib/projects/registry';
import { useWorkspaceProjects } from './use-workspace-projects';

function openedEvents() {
  return captured.filter(event => event.name === 'project_opened');
}

function renderVerbs() {
  let layout: WorkspaceLayout = {
    projects: [],
    activeDir: null,
    lastUsedDir: '',
    pinnedTabId: null,
  };
  const stateRef = {
    get current() {
      return layout;
    },
  };
  const { result } = renderHook(() =>
    useWorkspaceProjects({
      stateRef,
      recents: new RecentProjects(),
      setProjects: update => {
        const projects =
          typeof update === 'function'
            ? (update as (prev: Project[]) => Project[])(layout.projects)
            : update;
        layout = { ...layout, projects };
      },
      setActiveDir: () => undefined,
      setLastUsedDir: () => undefined,
      setError: () => undefined,
      moveOperator: () => undefined,
    })
  );
  return result;
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_EXAWATT_DISTRIBUTION_JSON', '');
  resetResolvedDistributionForTest();
  window.localStorage.clear();
  captured.length = 0;
  registry.refuses = false;
  installBridgeDouble({
    projects: {
      resolve: vi.fn(async path => ({
        ok: true as const,
        projectDir: path,
        projectName: path.split('/').at(-1) ?? path,
      })),
    },
  });
});

afterEach(() => {
  removeBridgeDouble();
  window.localStorage.clear();
  vi.unstubAllEnvs();
  resetResolvedDistributionForTest();
});

/** ENG-047: `project_opened` is recorded by the gesture, never by the write. */
describe('project_opened', () => {
  it('records the source, the harness hint and the binding, never the name or folder', () => {
    recordProjectOpened(
      { source: 'suggested', harnessHint: 'claude' },
      'folder'
    );
    recordProjectOpened({ source: 'connect' }, 'folderless');
    expect(openedEvents()).toEqual([
      {
        name: 'project_opened',
        surface: 'desktop',
        source: 'suggested',
        harnessHint: 'claude',
        bound: 'folder',
      },
      {
        name: 'project_opened',
        surface: 'desktop',
        source: 'connect',
        harnessHint: null,
        bound: 'folderless',
      },
    ]);
  });

  it('is never recorded by a registry write, which is bookkeeping', async () => {
    await openRepositoryProject({
      rootPath: '/Users/example/Code/secret-repo',
      name: 'secret-repo',
    });
    await openManualProject({ id: 'project-1', name: 'Contracts' });
    await openRemoteHomeProject({ id: 'home-1', name: 'Remote' });
    expect(openedEvents()).toEqual([]);
  });

  it('is recorded when the Project opens, even when its registry row cannot sync', async () => {
    registry.refuses = true;
    const verbs = renderVerbs();
    await act(async () => {
      await verbs.current.openProject('/Users/example/Code/secret-repo', {
        source: 'recent',
      });
    });
    expect(openedEvents()).toEqual([
      expect.objectContaining({ source: 'recent', bound: 'folder' }),
    ]);
    expect(JSON.stringify(captured)).not.toContain('secret');
  });

  it('is recorded for a folderless Project opened from the chooser', () => {
    const verbs = renderVerbs();
    act(() => {
      verbs.current.openContextProject(
        { id: 'project-1', name: 'Contracts', color: null },
        { source: 'recent' }
      );
    });
    expect(openedEvents()).toEqual([
      expect.objectContaining({ source: 'recent', bound: 'folderless' }),
    ]);
  });

  it('is recorded once per imported folder, under the reason each was given', async () => {
    const verbs = renderVerbs();
    await act(async () => {
      await verbs.current.importProjectsAt(
        ['/w/suggested', '/w/picked'],
        new Map([
          [
            '/w/suggested',
            { source: 'suggested' as const, harnessHint: 'codex' as const },
          ],
        ])
      );
    });
    expect(openedEvents()).toEqual([
      expect.objectContaining({ source: 'suggested', harnessHint: 'codex' }),
      expect.objectContaining({ source: 'import', harnessHint: null }),
    ]);
  });

  it('is recorded by nothing that registers a folder an Agent launched in', async () => {
    const verbs = renderVerbs();
    act(() =>
      verbs.current.syncProjectIdentity({ rootPath: '/w/a', name: 'a' })
    );
    await act(async () => undefined);
    expect(openedEvents()).toEqual([]);
  });

  it('cannot be skipped: every open verb requires the reason (type-checked)', () => {
    const verbs = renderVerbs();
    const typeOnly = () => {
      // @ts-expect-error a Project opens for a reason (ENG-047 `source`)
      void verbs.current.openProject('/w/a');
      // @ts-expect-error a Project opens for a reason (ENG-047 `source`)
      void verbs.current.openProjectAt('/w/a');
      // @ts-expect-error a Project opens for a reason (ENG-047 `source`)
      verbs.current.openContextProject({ id: 'p', name: 'P', color: null });
    };
    expect(typeOnly).toBeTypeOf('function');
  });
});
