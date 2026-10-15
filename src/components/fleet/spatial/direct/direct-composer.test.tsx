import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FleetAgentView } from '@exawatt/ui-model';
import { createLiveBusClient, type BusBridge } from '@/lib/bus/live-client';
import { createDemoBusClient } from '@/lib/bus/demo-client';
import type { BusClient } from '@/lib/bus/client';
import type { BusDeliveryState } from '@exawatt/core';
import { BusClientProvider } from '@/lib/bus/use-bus';
import { SpatialSelectionPanel } from '../spatial-selection-panel';
import type { DirectRecipient } from './direct-model';
import { useDirect, type RecipientAddress } from './use-direct';

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const PROJECT = '/code/alpha';

function view(id: string): FleetAgentView {
  return {
    id,
    name: `Agent ${id}`,
    status: 'idle',
    goal: 'Hold',
    project: 'Alpha',
    sessionKey: id,
    lastActivityAt: 0,
    cost: 0,
    costRate: 0,
    tokenRate: 0,
    turnCount: 0,
    activityCount: 0,
    hasHeartbeat: false,
    needsOperator: false,
    active: false,
    statusRank: 1,
  };
}

const RECIPIENTS: DirectRecipient[] = [
  {
    agentId: 'a',
    name: 'Agent a',
    harness: 'claude',
    projectId: PROJECT,
    readiness: 'ready',
  },
  {
    agentId: 'b',
    name: 'Agent b',
    harness: 'codex',
    projectId: PROJECT,
    readiness: 'busy',
  },
  {
    agentId: 'c',
    name: 'Agent c',
    harness: 'claude',
    projectId: PROJECT,
    readiness: 'stopped',
  },
];

/** This machine's bus at its real boundary: the live client over a bridge
 *  double shaped like the preload namespace, answering per recipient. */
function bridge(states: Record<string, BusDeliveryState>) {
  const sent: Parameters<BusBridge['send']>[0][] = [];
  const double: BusBridge = {
    list: async () => [],
    thread: async () => [],
    send: async request => {
      sent.push(request);
      return {
        status: 'sent',
        message: {
          id: `m-${request.to}`,
          projectId: request.projectId,
          from: { sessionId: 'operator', name: 'You', harness: 'operator' },
          to: { sessionId: request.to, name: request.to, harness: 'claude' },
          kind: 'operator',
          at: 1,
          text: request.text,
          delivery: { state: states[request.to] ?? 'unknown' },
        },
      };
    },
    onMessage: () => () => undefined,
  };
  return { sent, double };
}

const addresses = async (ids: readonly string[]) =>
  new Map<string, RecipientAddress>(
    ids.map(id => [id, { address: `session-${id}` }])
  );

function Harness({
  client,
  onClear = () => undefined,
}: {
  client: BusClient;
  onClear?: () => void;
}) {
  const direct = useDirect({
    client,
    recipients: RECIPIENTS,
    resolveAddresses: addresses,
  });
  return (
    <BusClientProvider client={client}>
      <SpatialSelectionPanel
        agent={null}
        selectedAgents={RECIPIENTS.map(entry => view(entry.agentId))}
        scopeActivity={null}
        activity={[]}
        delegation={null}
        statusColors={{ active: '#4ea', blocked: '#fa6', idle: '#889' }}
        needsOperatorCallout={{
          border: '#333',
          background: '#111',
          text: '#eee',
          detail: '#ccc',
          signal: '#f80',
        }}
        faultCallout={{
          border: '#333',
          background: '#111',
          text: '#eee',
          detail: '#ccc',
          signal: '#f80',
        }}
        isDemo={false}
        opening={false}
        handoffError={null}
        now={0}
        onOpenSession={() => undefined}
        onClearSelection={onClear}
        onInspectAgent={() => undefined}
        direct={{
          recipients: RECIPIENTS,
          addresses: direct.addresses,
          availability: direct.availability,
          results: direct.results,
          sending: direct.sending,
          onSend: direct.send,
        }}
      />
    </BusClientProvider>
  );
}

const tone = (agentId: string) =>
  document
    .querySelector(`[data-direct-result="${agentId}"]`)
    ?.getAttribute('data-direct-tone') ?? null;

describe('Direct N Agents', () => {
  it('sends once per reachable recipient and shows each result', async () => {
    const { sent, double } = bridge({
      'session-a': 'delivered',
      'session-b': 'queued',
    });
    render(<Harness client={createLiveBusClient(() => double)} />);
    // Before Send: the busy row says it will wait; the stopped row is listed.
    expect(tone('b')).toBe('quiet');
    expect(tone('c')).toBe('fault');
    expect(tone('a')).toBeNull();

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'run the tests' } });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.map(request => request.to).sort()).toEqual([
      'session-a',
      'session-b',
    ]);
    expect(sent.every(request => request.kind === 'operator')).toBe(true);
    await waitFor(() =>
      expect(document.querySelector('[data-direct-result="a"]')).not.toBeNull()
    );
    expect(tone('a')).toBe('quiet');
    expect(tone('b')).toBe('quiet');
    // Never dropped: the stopped Session still answers, and was never sent.
    expect(tone('c')).toBe('fault');
    expect(input).toHaveValue('');
  });

  it('answers honestly where nothing can be sent', async () => {
    render(<Harness client={createDemoBusClient(0)} />);
    expect(document.querySelectorAll('[data-direct-result]').length).toBe(
      RECIPIENTS.length
    );
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'hello' } });
    expect(document.querySelector('[data-direct-send]')).toBeDisabled();
  });

  it('reports a build without a bus as unavailable, never as sent', async () => {
    render(<Harness client={createLiveBusClient(() => null)} />);
    // Every row carries the reason, the ready one included.
    await waitFor(() => expect(tone('a')).toBe('quiet'));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'hello' },
    });
    await waitFor(() =>
      expect(document.querySelector('[data-direct-send]')).toBeDisabled()
    );
  });

  it('clears the text on Escape first, then hands Escape to the board', async () => {
    const onClear = vi.fn();
    const { double } = bridge({});
    render(
      <Harness client={createLiveBusClient(() => double)} onClear={onClear} />
    );
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'draft' } });
    act(() => {
      fireEvent.keyDown(input, { key: 'Escape' });
    });
    expect(input).toHaveValue('');
    expect(onClear).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
