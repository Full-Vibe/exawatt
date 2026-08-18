import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FleetProvider,
  remoteAgentToExawattAgent,
  useFleet,
} from './fleet-provider';
import type { ConnectedSourceChange, RemoteAgentView } from '@/types/electron';

/**
 * ENG-010 C2: remote coworkers stand BESIDE local Agents.
 *
 * The whole point of the seam under test is that a downstream surface needs no
 * remote branch, so these tests assert on the one fleet the board already
 * reads. Nothing here names a host, an address, a user, or a key.
 */

function remoteAgent(
  overrides: Partial<RemoteAgentView> = {}
): RemoteAgentView {
  return {
    id: 'remote-abc123',
    displayName: 'Tyler',
    projectId: 'project-field',
    projectLabel: 'Field Work',
    discoveryState: 'configured',
    placement: 'customer-hosted',
    placementLabel: 'Remote',
    adapterId: 'openclaw',
    source: { id: 'alpha', displayName: 'Workshop box' },
    nativeAgentId: 'tyler',
    primaryContextId: 'agent:tyler:main',
    workState: 'idle',
    contextCount: 3,
    observedAt: 5_000,
    createdAt: 1_000,
    lastActiveAt: 4_000,
    connection: {
      state: 'live',
      label: 'Live',
      detail: 'Live',
      observationAgeMs: 0,
      stalePresentation: false,
      failure: null,
    },
    projectionVersion: 1,
    ...overrides,
  };
}

function localSession(id: string) {
  return {
    id,
    harness: 'claude',
    title: 'claude',
    cwd: '/w/atlas',
    projectDir: '/w/atlas',
    projectName: 'Atlas',
    startedAt: 1_000,
    exited: false,
    exitCode: null,
  };
}

interface BridgeOptions {
  sessions?: ReturnType<typeof localSession>[];
  agents?: RemoteAgentView[] | (() => Promise<RemoteAgentView[]>);
}

function installBridge(options: BridgeOptions) {
  const listeners = new Set<(change: ConnectedSourceChange) => void>();
  const agents = vi.fn(async () =>
    typeof options.agents === 'function'
      ? await options.agents()
      : (options.agents ?? [])
  );
  const bridge = {
    isElectron: true,
    platform: 'darwin',
    pty: {
      list: async () => options.sessions ?? [],
      onData: () => () => {},
      onExit: () => () => {},
    },
    connectedSources: {
      agents,
      onChanged: (handler: (change: ConnectedSourceChange) => void) => {
        listeners.add(handler);
        return () => listeners.delete(handler);
      },
    },
  };
  (window as unknown as { electron: unknown }).electron = bridge;
  return {
    agents,
    emit: (change: ConnectedSourceChange) => {
      for (const handler of listeners) handler(change);
    },
  };
}

function Probe() {
  const { agents } = useFleet();
  return (
    <ul>
      {agents
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(agent => (
          <li key={agent.id} data-testid={`agent-${agent.id}`}>
            {agent.name} · {agent.presence?.placementLabel ?? 'Local'} ·{' '}
            {agent.presence?.connectionLabel ?? ''} · {agent.status}
          </li>
        ))}
    </ul>
  );
}

afterEach(() => {
  delete (window as unknown as { electron?: unknown }).electron;
  vi.restoreAllMocks();
});

describe('remoteAgentToExawattAgent', () => {
  it('shapes a remote coworker exactly like a local Agent', () => {
    const agent = remoteAgentToExawattAgent(remoteAgent());
    expect(agent.id).toBe('remote-abc123');
    expect(agent.name).toBe('Tyler');
    expect(agent.project).toBe('Field Work');
    expect(agent.projectId).toBe('project-field');
    expect(agent.sessionKey).toBe('agent:tyler:main');
    expect(agent.lastActivityAt).toBe(4_000);
    expect(agent.createdAt).toBe(1_000);
  });

  it('keeps placement, connection freshness, and work state three separate signals', () => {
    const agent = remoteAgentToExawattAgent(
      remoteAgent({
        connection: {
          state: 'reconnecting',
          label: 'Reconnecting',
          detail: 'Reconnecting',
          observationAgeMs: 90_000,
          stalePresentation: true,
          failure: 'gateway-down',
        },
      })
    );
    expect(agent.presence?.placement).toBe('customer-hosted');
    expect(agent.presence?.placementLabel).toBe('Remote');
    expect(agent.presence?.connection).toBe('reconnecting');
    expect(agent.presence?.connectionLabel).toBe('Reconnecting');
    expect(agent.presence?.stalePresentation).toBe(true);
    // Losing observation says nothing about the work.
    expect(agent.status).toBe('idle');
  });

  it('carries the source-reported work state into D40 untouched', () => {
    expect(remoteAgentToExawattAgent(remoteAgent()).status).toBe('idle');
    expect(
      remoteAgentToExawattAgent(remoteAgent({ workState: 'working' })).status
    ).toBe('working');
    // A coworker last seen working is still working; the freshness lens is
    // what says how current that is.
    const stale = remoteAgentToExawattAgent(
      remoteAgent({
        workState: 'working',
        connection: {
          state: 'stale',
          label: 'Stale',
          detail: 'Last seen 2 hours ago',
          observationAgeMs: 7_200_000,
          stalePresentation: true,
          failure: null,
        },
      })
    );
    expect(stale.status).toBe('working');
    expect(stale.presence?.stalePresentation).toBe(true);
  });

  it('carries source identity as secondary metadata, never as the name', () => {
    const agent = remoteAgentToExawattAgent(remoteAgent());
    expect(agent.name).toBe('Tyler');
    expect(agent.presence?.source).toEqual({
      id: 'alpha',
      displayName: 'Workshop box',
      adapterId: 'openclaw',
    });
  });

  it('never claims a conversation the source did not declare', () => {
    const agent = remoteAgentToExawattAgent(
      remoteAgent({ primaryContextId: null })
    );
    expect(agent.sessionKey).toBe('');
  });
});

describe('FleetProvider — remote coworkers beside local Agents', () => {
  it('joins projected remote Agents to the local fleet without displacing it', async () => {
    installBridge({
      sessions: [localSession('local-1')],
      agents: [
        remoteAgent(),
        remoteAgent({ id: 'remote-def456', displayName: 'scout' }),
      ],
    });

    render(
      <FleetProvider>
        <Probe />
      </FleetProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('agent-local-1')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('agent-remote-abc123')).toBeInTheDocument();
    });
    expect(screen.getByTestId('agent-remote-def456')).toBeInTheDocument();
    // The local Agent is still there, and is still Local.
    expect(screen.getByTestId('agent-local-1')).toHaveTextContent('· Local ·');
    expect(screen.getByTestId('agent-remote-abc123')).toHaveTextContent(
      'Tyler · Remote · Live · idle'
    );
  });

  it('joins a working remote coworker to the roster with its work state intact', async () => {
    installBridge({
      sessions: [localSession('local-1')],
      agents: [remoteAgent({ workState: 'working' })],
    });

    render(
      <FleetProvider>
        <Probe />
      </FleetProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('agent-remote-abc123')).toHaveTextContent(
        'Tyler · Remote · Live · working'
      );
    });
    // The local Agent keeps its own D40 state; neither reads the other's.
    expect(screen.getByTestId('agent-local-1')).toHaveTextContent('· idle');
  });

  it('re-reads the roster when a source reports it moved', async () => {
    let current: RemoteAgentView[] = [remoteAgent()];
    const bridge = installBridge({
      sessions: [localSession('local-1')],
      agents: async () => current,
    });

    render(
      <FleetProvider>
        <Probe />
      </FleetProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId('agent-remote-abc123')).toBeInTheDocument();
    });

    current = [
      remoteAgent({
        connection: {
          state: 'stale',
          label: 'Stale',
          detail: 'Last seen 2 hours ago',
          observationAgeMs: 7_200_000,
          stalePresentation: true,
          failure: null,
        },
      }),
    ];
    await act(async () => {
      bridge.emit({
        sourceId: 'alpha',
        phase: 'reconnecting',
        connection: {
          state: 'stale',
          label: 'Stale',
          detail: 'Last seen 2 hours ago',
          observationAgeMs: 7_200_000,
          stalePresentation: true,
          failure: null,
        },
        snapshotRevision: 1,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('agent-remote-abc123')).toHaveTextContent(
        'Tyler · Remote · Stale · idle'
      );
    });
    // The freshness changed. The coworker did not leave, and the local Agent
    // was never touched.
    expect(screen.getByTestId('agent-local-1')).toBeInTheDocument();
  });

  it('keeps the local fleet when the source read fails', async () => {
    installBridge({
      sessions: [localSession('local-1')],
      agents: async () => {
        throw new Error('bridge unavailable');
      },
    });

    render(
      <FleetProvider>
        <Probe />
      </FleetProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('agent-local-1')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('agent-remote-abc123')).toBeNull();
  });

  it('does not ask for remote coworkers when the desktop bridge is absent', async () => {
    render(
      <FleetProvider>
        <Probe />
      </FleetProvider>
    );
    // The web posture falls back to the Demo Workspace and never reaches for
    // a configured source it has no boundary for.
    await waitFor(() => {
      expect(screen.queryByTestId('agent-remote-abc123')).toBeNull();
    });
  });
});
