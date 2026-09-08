/**
 * The assembled renderer/preload contract for an existing remote Agent.
 *
 * This deliberately crosses the same `window.electron.connectedSources`
 * boundary each production surface uses. It catches composition regressions
 * that isolated Connect, roster, Team, and Agent tests cannot: closing before
 * the atomic mapping answer, failing to refresh the projected identity, or
 * opening a source-native id that the Agent pane cannot resolve.
 */

import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoalVisualPreferenceProvider } from '@/components/goal-visuals/goal-visual-preference-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ConnectedSourceView } from '@exawatt/core';
import type {
  ConnectedAgentMappingInput,
  RemoteAgentView,
} from '@/types/electron';
import { ConnectSourceDialog } from './connect-source-dialog';
import { ExposeOverlay } from './expose-overlay';
import { RemoteAgentPane, useRemoteCoworkers } from './remote-agent';
import { NO_FLEET_ATTENTION } from './session-status';

vi.mock('@/lib/goal-visuals/preference-source', () => ({
  createGoalVisualPreferenceSource: () => ({
    kind: 'web' as const,
    load: async () => false,
    save: async (enabled: boolean) => enabled,
    subscribe: () => () => undefined,
  }),
}));

const SOURCE: ConnectedSourceView = {
  id: 'source-1',
  adapterId: 'openclaw',
  placement: 'customer-hosted',
  displayName: 'Workshop box',
  transportKind: 'ssh-alias',
  alias: 'atlas-box',
  credentialOwner: 'source-owned-ssh',
  hasDeviceCredential: true,
};

const CONNECTION = {
  state: 'live' as const,
  label: 'Live',
  detail: 'Observed now',
  observationAgeMs: 0,
  stalePresentation: false,
  failure: null,
};

function projectedAgent(mapping: ConnectedAgentMappingInput): RemoteAgentView {
  return {
    id: `projected:${SOURCE.id}:${mapping.nativeAgentId}`,
    displayName: mapping.displayNameOverride ?? 'social-poster',
    projectId: mapping.projectId,
    projectLabel: mapping.projectLabel ?? 'social-poster',
    discoveryState: 'configured',
    placement: SOURCE.placement,
    placementLabel: 'Remote',
    adapterId: SOURCE.adapterId,
    source: { id: SOURCE.id, displayName: SOURCE.displayName },
    nativeAgentId: mapping.nativeAgentId,
    primaryContextId: 'agent:social-poster:main',
    workState: 'idle',
    contextCount: 1,
    observedAt: 10,
    createdAt: 1,
    lastActiveAt: 10,
    connection: CONNECTION,
    projectionVersion: 1,
  };
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <GoalVisualPreferenceProvider>
      <TooltipProvider>{children}</TooltipProvider>
    </GoalVisualPreferenceProvider>
  );
}

describe('Connect → mapping → roster → Team → Agent', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    delete (window as unknown as { electron?: unknown }).electron;
    window.localStorage.clear();
  });

  it('keeps Connect open through the atomic write, then opens the projected Agent identity', async () => {
    let agents: RemoteAgentView[] = [];
    let settleMapping:
      | ((result: { ok: true; mapped: number }) => void)
      | undefined;
    const mapAgents = vi.fn(
      async (_sourceId: string, mappings: ConnectedAgentMappingInput[]) =>
        new Promise<{ ok: true; mapped: number }>(resolve => {
          agents = mappings.map(projectedAgent);
          settleMapping = resolve;
        })
    );
    const conversation = vi.fn(async (agentId: string) => ({
      ok: true as const,
      agentId,
      sourceId: SOURCE.id,
      contextId: 'agent:social-poster:main',
      turns: [],
      hasMore: false,
      characterCount: 0,
      observedAt: 10,
      connection: CONNECTION,
    }));

    const connectedSources = {
      list: vi.fn(async () => [SOURCE]),
      sshAliases: vi.fn(async () => ({
        aliases: [
          {
            alias: 'atlas-box',
            hasHostName: true,
            hasUser: true,
            hasIdentityFile: false,
          },
        ],
        configPresent: true,
        incompleteIncludes: false,
      })),
      add: vi.fn(async () => ({ ok: true as const, source: SOURCE })),
      connect: vi.fn(async () => ({
        ok: true as const,
        sourceId: SOURCE.id,
        agents: [
          {
            nativeAgentId: 'agent-alpha',
            displayName: 'social-poster',
            discoveryState: 'configured' as const,
            contextCount: 1,
            hasPrimaryConversation: true,
            mapping: null,
          },
        ],
        status: {
          sourceId: SOURCE.id,
          displayName: SOURCE.displayName,
          adapterId: SOURCE.adapterId,
          placement: SOURCE.placement,
          placementLabel: 'Remote',
          observing: true,
          phase: 'connected' as const,
          connection: CONNECTION,
          version: null,
          capabilities: [],
          identityDrift: false,
          snapshotRevision: 1,
        },
        observed: null,
      })),
      mapAgents,
      agents: vi.fn(async () => agents),
      commandAuthority: vi.fn(async () => [
        {
          sourceId: SOURCE.id,
          displayName: SOURCE.displayName,
          authority: 'write' as const,
          awaitingApproval: false,
        },
      ]),
      onChanged: vi.fn(() => () => undefined),
      detach: vi.fn(async () => ({ ok: true })),
      requestCommandAuthority: vi.fn(),
      conversation,
      send: vi.fn(async () => ({ ok: true as const })),
      onConversationUpdate: vi.fn(() => () => undefined),
    };
    (window as unknown as { electron: unknown }).electron = {
      connectedSources,
    };

    function Harness() {
      const [connectOpen, setConnectOpen] = useState(true);
      const [openAgentId, setOpenAgentId] = useState<string | null>(null);
      const { roster, coworkers, refresh } = useRemoteCoworkers();
      const coworker = coworkers.find(agent => agent.agentId === openAgentId);
      return (
        <>
          <ExposeOverlay
            projects={[]}
            summaries={{}}
            attention={NO_FLEET_ATTENTION}
            activeTabId={null}
            remoteCoworkers={coworkers}
            onPick={() => undefined}
            onOpenRemoteAgent={setOpenAgentId}
            onClose={() => undefined}
          />
          <ConnectSourceDialog
            open={connectOpen}
            onOpenChange={setConnectOpen}
            onConnected={result => {
              void refresh().then(next => {
                const projected = next?.agents.find(
                  agent =>
                    agent.source.id === result.sourceId &&
                    agent.nativeAgentId === result.openNativeAgentId
                );
                if (projected) setOpenAgentId(projected.id);
              });
            }}
          />
          {coworker && (
            <RemoteAgentPane
              tab={{
                id: `tab:${coworker.agentId}`,
                title: coworker.name,
                agentId: coworker.agentId,
                sourceId: coworker.sourceId,
                projectLabel: coworker.projectLabel,
              }}
              roster={roster}
            />
          )}
        </>
      );
    }

    render(<Harness />, { wrapper: Providers });
    fireEvent.click(await screen.findByRole('button', { name: /OpenClaw/ }));
    fireEvent.click(await screen.findByRole('button', { name: /atlas-box/ }));
    await screen.findByRole('heading', { name: 'Agents' });
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.click(
      await screen.findByRole('button', { name: /Connect and open/ })
    );

    await waitFor(() => expect(mapAgents).toHaveBeenCalledOnce());
    expect(document.querySelector('[data-connect-source]')).not.toBeNull();
    expect(document.querySelector('[data-expose-agent]')).toBeNull();

    const [sourceId, mappings] = mapAgents.mock.calls[0]!;
    expect(sourceId).toBe(SOURCE.id);
    expect(mappings).toHaveLength(1);
    expect(mappings[0]!.projectId).not.toMatch(/[\\/]/);

    await act(async () => {
      settleMapping?.({ ok: true, mapped: mappings.length });
    });

    const projectedId = projectedAgent(mappings[0]!).id;
    const tile = await waitFor(() => {
      const node = document.querySelector(
        `[data-expose-agent="${projectedId}"]`
      );
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });
    expect(document.querySelector('[data-connect-source]')).toBeNull();
    fireEvent.click(tile);
    await waitFor(() =>
      expect(
        document.querySelector(`[data-remote-agent-pane="${projectedId}"]`)
      ).not.toBeNull()
    );
    expect(conversation).toHaveBeenCalledWith(projectedId, {});
    expect(connectedSources.detach).not.toHaveBeenCalled();
  });
});
