import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FleetAgentView } from '@exawatt/ui-model';
import { createLiveBusClient, type BusBridge } from '@/lib/bus/live-client';
import { busMessage } from '@/lib/bus/bus.test-support';
import { createDemoBusClient } from '@/lib/bus/demo-client';
import type { BusClient } from '@/lib/bus/client';
import type { BusDeliveryState } from '@exawatt/core';
import { BusClientProvider } from '@/lib/bus/use-bus';
import { SpatialSelectionPanel } from '../spatial-selection-panel';
import type { DirectRecipient } from './direct-model';
import { useDirect, type RecipientAddress } from './use-direct';
import { useBackOut } from '@/lib/shortcuts/back-out';

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
    list: async () => ({ ok: true, records: [] }),
    thread: async () => ({ ok: true, records: [] }),
    send: async request => {
      sent.push(request);
      const record = busMessage(`m-${request.to}`, 'operator', request.to, 1, {
        operator: true,
        projectId: request.projectId,
        text: request.text,
        state: states[request.to] ?? 'unknown',
      });
      return { delivery: record.delivery, record };
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
  // The board's selection rung, as the Fleet client joins the ladder.
  useBackOut({
    rung: 'grid',
    ambient: true,
    back: () => {
      onClear();
      return true;
    },
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

  it('knows whether a bus exists without reading the ledger', () => {
    const { double } = bridge({});
    const list = vi.spyOn(double, 'list');
    const ready = renderHook(() =>
      useDirect({
        client: createLiveBusClient(() => double),
        recipients: RECIPIENTS,
        resolveAddresses: addresses,
      })
    );
    // Answered on the first render, not after a read comes back.
    expect(ready.result.current.availability).toEqual({ kind: 'ready' });
    const absent = renderHook(() =>
      useDirect({
        client: createLiveBusClient(() => null),
        recipients: RECIPIENTS,
        resolveAddresses: addresses,
      })
    );
    expect(absent.result.current.availability.kind).toBe('unavailable');
    expect(list).not.toHaveBeenCalled();
  });

  it("reads the Project's messages once for every recipient's unread", async () => {
    const { double } = bridge({});
    const list = vi.fn(async () => ({
      ok: true as const,
      records: [
        busMessage('1', 'session-a', 'session-b', 5, { projectId: PROJECT }),
        busMessage('2', 'session-c', 'session-a', 6, { projectId: PROJECT }),
      ],
    }));
    double.list = list;
    render(<Harness client={createLiveBusClient(() => double)} />);
    await waitFor(() =>
      expect(document.querySelector('[data-direct-unread="2"]')).not.toBeNull()
    );
    expect(
      [...document.querySelectorAll('[data-direct-unread]')].map(node =>
        node.getAttribute('data-direct-unread')
      )
    ).toEqual(['2', '1', '1']);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith(PROJECT);
  });

  it('clears the text on Escape first, then lets the board release the selection', async () => {
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
