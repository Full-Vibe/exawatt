import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  RemoteAgentView,
  SourceCommandAuthorityView,
} from '@/types/electron';
import { RemoteAgentPane } from './remote-agent-pane';
import type { RemoteRoster } from './remote-agent-roster';
import type {
  ConversationReply,
  RemoteAgentBridge,
} from './remote-agent-surface';

afterEach(cleanup);

/**
 * BUG-148: a coworker's pane is where the operator's draft, the undelivered
 * outbox and the transcript already read all live. The stage hides an
 * inactive pane the way it hides a terminal; it never unmounts it, so a tab
 * switch throws none of that away and re-reads nothing over the tunnel.
 */

const TAB = {
  id: 'tab-tyler',
  title: 'Tyler',
  agentId: 'remote-abc123',
  sourceId: 'alpha',
  projectLabel: 'Field Work',
};

function remoteAgent(): RemoteAgentView {
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
  };
}

const WRITE: SourceCommandAuthorityView = {
  sourceId: 'alpha',
  displayName: 'Workshop box',
  authority: 'write',
  awaitingApproval: false,
  canApproveOnSource: true,
  approveCommands: null,
};

const ROSTER: RemoteRoster = {
  sources: [],
  agents: [remoteAgent()],
  authorities: [WRITE],
  loaded: true,
};

function bridge(): RemoteAgentBridge {
  return {
    conversation: vi.fn(
      async (): Promise<ConversationReply> => ({
        ok: true,
        contextId: 'agent:tyler:main',
        turns: [
          {
            id: 'turn-1',
            role: 'agent',
            text: 'Three quotes in.',
            timestamp: 1_700_000_000_000,
          },
        ],
        hasMore: false,
      })
    ),
    send: vi.fn(async () => ({ ok: true as const })),
    onConversation: () => () => undefined,
  };
}

describe('a coworker pane on the workspace stage', () => {
  it('keeps the draft and the transcript through being hidden and shown again', async () => {
    const api = bridge();
    const view = render(
      <RemoteAgentPane bridge={api} layout="full" roster={ROSTER} tab={TAB} />
    );
    await act(async () => {});
    await screen.findByText('Three quotes in.');
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Half a message' },
    });

    // ⌘2: another tab takes the stage, this pane goes hidden.
    view.rerender(
      <RemoteAgentPane bridge={api} layout="hidden" roster={ROSTER} tab={TAB} />
    );
    await act(async () => {});
    const hidden = document.querySelector('[data-pane="hidden"]');
    expect(hidden).not.toBeNull();
    expect(hidden!.querySelector('textarea')).not.toBeNull();

    // ⌘1: back. Nothing was torn down, so nothing needs carrying.
    view.rerender(
      <RemoteAgentPane bridge={api} layout="full" roster={ROSTER} tab={TAB} />
    );
    await act(async () => {});
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'Half a message'
    );
    expect(screen.getByText('Three quotes in.')).toBeInTheDocument();
    expect(api.conversation).toHaveBeenCalledTimes(1);
  });

  it('selects its tab from a press only while it is on screen', () => {
    const onActivate = vi.fn();
    const view = render(
      <RemoteAgentPane
        bridge={bridge()}
        layout="right"
        onActivate={onActivate}
        roster={ROSTER}
        tab={TAB}
      />
    );
    fireEvent.mouseDown(document.querySelector('[data-pane="right"]')!);
    expect(onActivate).toHaveBeenCalledTimes(1);

    view.rerender(
      <RemoteAgentPane
        bridge={bridge()}
        layout="hidden"
        onActivate={onActivate}
        roster={ROSTER}
        tab={TAB}
      />
    );
    fireEvent.mouseDown(document.querySelector('[data-pane="hidden"]')!);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
