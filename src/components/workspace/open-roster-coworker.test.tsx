import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { operatorPosition } from '@/components/nav/operator-position';
import type { RemoteRoster } from './remote-agent/remote-agent-roster';
import {
  openRosterCoworker,
  type RosterCoworkerOptions,
} from './open-roster-coworker';
import { isRemoteAgentTab, useWorkspaceState } from './use-workspace-state';

vi.mock('@/lib/projects/registry', () => ({
  openRepositoryProject: vi.fn(() => Promise.reject(new Error('offline'))),
  listProjects: vi.fn(() => Promise.resolve([])),
  renameProject: vi.fn(() => Promise.resolve()),
  reorderProjects: vi.fn(() => Promise.resolve()),
  setProjectColor: vi.fn(() => Promise.resolve()),
}));

const REPO = '/repo';

function sessionTab(id: string) {
  return {
    id,
    durableSessionId: `durable-${id}`,
    harness: 'claude',
    title: id,
    titleKind: 'operator',
    cwd: REPO,
    sessionId: null,
    harnessSessionId: `harness-${id}`,
    resumeState: 'ended-resumable',
    lifecycle: 'stopped-clean',
    exitCode: 0,
  };
}

function installElectron() {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    writable: true,
    value: {
      pty: {
        list: vi.fn(() => Promise.resolve([])),
        create: vi.fn(),
        closedSessions: vi.fn(() => Promise.resolve([])),
        reopenSession: vi.fn(() => Promise.resolve(null)),
        onExit: vi.fn(() => () => {}),
        focus: vi.fn(() => Promise.resolve()),
        openPath: vi.fn(() => Promise.resolve()),
      },
      workspace: {
        load: vi.fn(() =>
          Promise.resolve({
            v: 6,
            activeDir: REPO,
            lastUsedDir: REPO,
            projects: [
              {
                dir: REPO,
                name: 'repo',
                color: '#19E6FF',
                activeTabId: 'tab-asked',
                tabs: [sessionTab('tab-asked'), sessionTab('tab-other')],
              },
            ],
          })
        ),
        recovery: vi.fn(() =>
          Promise.resolve({ previousRunInterrupted: false })
        ),
        save: vi.fn(() => Promise.resolve()),
      },
    },
  });
}

/** The position source the way `workspace-client.tsx` registers it. */
async function mountedWorkspace() {
  const view = renderHook(() => useWorkspaceState());
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  operatorPosition.setSource(() => {
    const { activeProject, activeTab } = view.result.current;
    return {
      surface: '/workspace',
      tab:
        activeProject && activeTab
          ? { dir: activeProject.dir, tabId: activeTab.id }
          : null,
    };
  });
  await waitFor(() =>
    expect(view.result.current.activeTab?.id).toBe('tab-asked')
  );
  return view;
}

/** The roster read held open, the way a Gateway round trip holds it. */
function heldRosterRead() {
  let answer: ((roster: RemoteRoster | null) => void) | null = null;
  return {
    refresh: () =>
      new Promise<RemoteRoster | null>(resolve => {
        answer = resolve;
      }),
    land() {
      answer?.({
        sources: [],
        authorities: [],
        loaded: true,
        agents: [
          {
            id: 'agent-tyler',
            nativeAgentId: 'tyler',
            source: { id: 'source-1', displayName: 'Hetzner' },
            displayName: 'Tyler',
            projectId: 'project-tyler',
            projectLabel: 'Tyler',
          },
        ] as unknown as RemoteRoster['agents'],
      });
    },
  };
}

function coworkerTab(view: Awaited<ReturnType<typeof mountedWorkspace>>) {
  return view.result.current.projects
    .flatMap(project => project.tabs)
    .find(tab => isRemoteAgentTab(tab) && tab.agentId === 'agent-tyler');
}

const GESTURES: [string, RosterCoworkerOptions][] = [
  ['Connect finishing', { preferKnown: false }],
  ['opening a coworker the roster does not know yet', { preferKnown: true }],
];

describe('opening a coworker after a roster read (BUG-192)', () => {
  beforeEach(() => installElectron());

  afterEach(() => {
    operatorPosition.setSource(null);
    vi.clearAllMocks();
  });

  it.each(GESTURES)(
    '%s opens the tab quietly when he moved on during the read',
    async (_gesture, options) => {
      const view = await mountedWorkspace();
      const read = heldRosterRead();

      let opened: Promise<string | null> | null = null;
      act(() => {
        opened = openRosterCoworker(
          candidate => candidate.agentId === 'agent-tyler',
          {
            known: () => [],
            refresh: read.refresh,
            open: view.result.current.openRemoteAgent,
          },
          options
        );
      });

      // ⌘2 while the roster read is still out.
      act(() => view.result.current.selectTab(REPO, 'tab-other'));

      await act(async () => {
        read.land();
        await opened;
      });

      expect(coworkerTab(view)).toBeDefined();
      expect(view.result.current.activeTab?.id).toBe('tab-other');
    }
  );

  it.each(GESTURES)(
    '%s goes to the coworker when he stayed where he asked',
    async (_gesture, options) => {
      const view = await mountedWorkspace();
      const read = heldRosterRead();

      let opened: Promise<string | null> | null = null;
      act(() => {
        opened = openRosterCoworker(
          candidate => candidate.agentId === 'agent-tyler',
          {
            known: () => [],
            refresh: read.refresh,
            open: view.result.current.openRemoteAgent,
          },
          options
        );
      });
      await act(async () => {
        read.land();
        await opened;
      });

      expect(view.result.current.activeTab?.id).toBe(coworkerTab(view)?.id);
    }
  );
});
