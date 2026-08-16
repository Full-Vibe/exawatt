import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { operatorPosition } from '@/components/nav/operator-position';
import { useWorkspaceState } from './use-workspace-state';

vi.mock('@/lib/projects/registry', () => ({
  // Signed out / offline is the registry's normal failure and the launch path
  // swallows it, which keeps this test about focus and nothing else.
  openRepositoryProject: vi.fn(() => Promise.reject(new Error('offline'))),
  listProjects: vi.fn(() => Promise.resolve([])),
  renameProject: vi.fn(() => Promise.resolve()),
  reorderProjects: vi.fn(() => Promise.resolve()),
  setProjectColor: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/launch-configurations', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/lib/launch-configurations')>();
  return { ...actual, recordLaunchConfigurationSuccess: vi.fn() };
});

const REPO = '/repo';

/** A persisted layout with a draft tab selected and a live Agent beside it. */
function persistedLayout() {
  return {
    v: 6,
    activeDir: REPO,
    lastUsedDir: REPO,
    projects: [
      {
        dir: REPO,
        name: 'repo',
        color: '#19E6FF',
        activeTabId: 'tab-draft',
        tabs: [
          {
            id: 'tab-draft',
            durableSessionId: 'durable-draft',
            harness: 'claude',
            title: 'New agent',
            titleKind: 'default',
            cwd: REPO,
            sessionId: null,
            harnessSessionId: null,
            resumeState: 'identity-missing',
            lifecycle: 'draft',
            exitCode: null,
          },
          {
            id: 'tab-other',
            durableSessionId: 'durable-other',
            harness: 'claude',
            title: 'Other agent',
            titleKind: 'operator',
            cwd: REPO,
            sessionId: null,
            harnessSessionId: 'harness-other',
            resumeState: 'ended-resumable',
            lifecycle: 'stopped-clean',
            exitCode: 0,
          },
        ],
      },
    ],
  };
}

/** `pty.create` held open, the way a cold provider or a fresh worktree holds
 *  a real launch open — the whole condition BUG-018 lives in. */
function pendingCreate() {
  let settle: ((value: unknown) => void) | null = null;
  const create = vi.fn(
    () =>
      new Promise(resolve => {
        settle = resolve;
      })
  );
  return {
    create,
    land(session: Record<string, unknown>) {
      settle?.({ ok: true, session });
    },
  };
}

function session(durableSessionId: string) {
  return {
    id: `pty-${durableSessionId}`,
    durableSessionId,
    harness: 'claude',
    title: 'Claude Code',
    cwd: REPO,
    projectDir: REPO,
    projectName: 'repo',
    harnessSessionId: null,
    exited: false,
    startedAt: Date.now(),
  };
}

function installElectron(create: ReturnType<typeof pendingCreate>['create']) {
  const pty = {
    list: vi.fn(() => Promise.resolve([])),
    create,
    closedSessions: vi.fn(() => Promise.resolve([])),
    reopenSession: vi.fn(() => Promise.resolve(null)),
    onExit: vi.fn(() => () => {}),
    focus: vi.fn(() => Promise.resolve()),
    openPath: vi.fn(() => Promise.resolve()),
  };
  const workspace = {
    load: vi.fn(() => Promise.resolve(persistedLayout())),
    recovery: vi.fn(() => Promise.resolve({ previousRunInterrupted: false })),
    save: vi.fn(() => Promise.resolve()),
  };
  Object.defineProperty(window, 'electron', {
    configurable: true,
    writable: true,
    value: { pty, workspace },
  });
  return { pty, workspace };
}

/**
 * The position source the way `workspace-client.tsx` registers it: read live
 * from the workspace's own active Project and tab. Mirroring the real
 * derivation is the point — a test that fed the authority a hand-written
 * position would prove only that the authority works.
 */
function trackPosition(
  read: () => {
    activeProject: { dir: string } | null;
    activeTab: { id: string } | null;
  }
) {
  operatorPosition.setSource(() => {
    const { activeProject, activeTab } = read();
    return {
      surface: '/workspace',
      tab:
        activeProject && activeTab
          ? { dir: activeProject.dir, tabId: activeTab.id }
          : null,
    };
  });
}

async function mountedWorkspace() {
  const view = renderHook(() => useWorkspaceState());
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  trackPosition(() => view.result.current);
  await waitFor(() =>
    expect(view.result.current.activeTab?.id).toBe('tab-draft')
  );
  return view;
}

function tabById(
  view: Awaited<ReturnType<typeof mountedWorkspace>>,
  id: string
) {
  return view.result.current.projects[0]?.tabs.find(tab => tab.id === id);
}

describe('a late launch does not move the operator (BUG-018)', () => {
  let launcher: ReturnType<typeof pendingCreate>;

  beforeEach(() => {
    launcher = pendingCreate();
    installElectron(launcher.create);
  });

  afterEach(() => {
    operatorPosition.setSource(null);
    vi.clearAllMocks();
  });

  it('promotes the draft in place but leaves him on the Agent he switched to', async () => {
    const view = await mountedWorkspace();

    let launched: Promise<boolean> | null = null;
    act(() => {
      launched = view.result.current.launch({
        harness: 'claude',
        dir: REPO,
        reuseTabId: 'tab-draft',
      });
    });

    // He gives up waiting and goes to work on another Agent.
    act(() => view.result.current.selectTab(REPO, 'tab-other'));
    expect(view.result.current.activeTab?.id).toBe('tab-other');

    // …and only then does the provider come up.
    await act(async () => {
      launcher.land(session('durable-draft'));
      await launched;
    });

    // The Session is real and its own tab says so.
    expect(tabById(view, 'tab-draft')?.lifecycle).toBe('running');
    expect(tabById(view, 'tab-draft')?.sessionId).toBe('pty-durable-draft');
    // He was not moved.
    expect(view.result.current.activeTab?.id).toBe('tab-other');
  });

  it('activates the launched Agent when he never left the draft', async () => {
    const view = await mountedWorkspace();

    let launched: Promise<boolean> | null = null;
    act(() => {
      launched = view.result.current.launch({
        harness: 'claude',
        dir: REPO,
        reuseTabId: 'tab-draft',
      });
    });
    await act(async () => {
      launcher.land(session('durable-draft'));
      await launched;
    });

    expect(tabById(view, 'tab-draft')?.lifecycle).toBe('running');
    expect(view.result.current.activeTab?.id).toBe('tab-draft');
  });

  it('appends a new Session quietly when he left the Project it came from', async () => {
    const view = await mountedWorkspace();

    let launched: Promise<boolean> | null = null;
    act(() => {
      launched = view.result.current.launch({ harness: 'claude', dir: REPO });
    });
    act(() => view.result.current.selectTab(REPO, 'tab-other'));

    await act(async () => {
      launcher.land(session('durable-new'));
      await launched;
    });

    expect(view.result.current.projects[0].tabs).toHaveLength(3);
    expect(view.result.current.activeTab?.id).toBe('tab-other');
  });
});
