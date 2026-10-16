import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  demoBusSendResult,
  DEMO_BASE_AGENTS,
  DEMO_CHATTER,
  DEMO_PROJECTS,
} from '@exawatt/core';
import type { BusClient } from './client';
import { createDemoBusClient, demoBusMessages } from './demo-client';
import { createLiveBusClient, type BusBridge } from './live-client';
import { BUS_OPERATOR } from './operator';
import {
  markSeenThrough,
  resetSeenThroughForTest,
  seenThrough,
} from './read-state';
import {
  agentUnreadCount,
  firstLine,
  latestAt,
  newestFirst,
  threadOf,
  unreadCount,
  upsertMessage,
} from './selectors';
import type { BusDeliveryState, MessageRecord } from '@exawatt/core';
import { busMessage } from './bus.test-support';
import {
  BusClientProvider,
  useAgentUnread,
  useBusClient,
  useBusMessages,
  useProjectUnread,
} from './use-bus';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const PROJECT = '/work/alpha';

function message(
  id: string,
  from: string,
  to: string,
  at: number,
  options: Parameters<typeof busMessage>[4] = {}
): MessageRecord {
  return busMessage(id, from, to, at, {
    projectId: PROJECT,
    text: `${id} text`,
    ...options,
  });
}

function fakeBridge(messages: MessageRecord[] = []) {
  const handlers = new Set<(message: MessageRecord) => void>();
  const bridge: BusBridge = {
    list: async projectId => ({
      ok: true,
      records: messages.filter(m => m.projectId === projectId),
    }),
    thread: async (projectId, a, b) => ({
      ok: true,
      records: messages.filter(
        m =>
          m.projectId === projectId &&
          [a, b].includes(m.from.sessionId) &&
          [a, b].includes(m.to.sessionId)
      ),
    }),
    send: async request => {
      const record = message(
        'sent-1',
        BUS_OPERATOR.sessionId,
        request.to,
        NOW,
        {
          projectId: request.projectId,
          operator: true,
          text: request.text,
        }
      );
      return { delivery: record.delivery, record };
    },
    onMessage: handler => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
  return { bridge, push: (m: MessageRecord) => handlers.forEach(h => h(m)) };
}

describe('live client', () => {
  it('reports unavailable, never an empty list, when the bus namespace is absent', async () => {
    const client = createLiveBusClient(() => null);
    const list = await client.list(PROJECT);
    const thread = await client.thread(PROJECT, 'a', 'b');
    expect(list).toMatchObject({ ok: false, unavailable: true });
    expect(thread).toMatchObject({ ok: false, unavailable: true });
    expect(list).not.toHaveProperty('records');
    expect(
      (
        await client.send({
          projectId: PROJECT,
          to: 'a',
          text: 'hi',
          kind: 'operator',
        })
      ).record
    ).toBeNull();
    expect(() => client.subscribe(() => {})()).not.toThrow();
  });

  it('separates an empty ledger from a failed read', async () => {
    const empty = createLiveBusClient(() => fakeBridge().bridge);
    expect(await empty.list(PROJECT)).toEqual({ ok: true, records: [] });
    const failing = createLiveBusClient(() => ({
      ...fakeBridge().bridge,
      list: async () => {
        throw new Error('ledger unreadable');
      },
    }));
    expect(await failing.list(PROJECT)).toEqual({
      ok: false,
      reason: 'ledger unreadable',
    });
    const damaged = { ok: false as const, reason: 'line 4 is not JSON' };
    const passthrough = createLiveBusClient(() => ({
      ...fakeBridge().bridge,
      list: async () => damaged,
    }));
    expect(await passthrough.list(PROJECT)).toBe(damaged);
  });

  it('turns a thrown send into a refusal with the reason', async () => {
    const client = createLiveBusClient(() => ({
      ...fakeBridge().bridge,
      send: async () => {
        throw new Error('recipient ended');
      },
    }));
    expect(
      await client.send({
        projectId: PROJECT,
        to: 'a',
        text: 'x',
        kind: 'operator',
      })
    ).toEqual({
      delivery: {
        state: 'undeliverable',
        reason: 'recipient ended',
        adapter: 'bus',
      },
      record: null,
    });
  });
});

describe('demo client', () => {
  const messages = demoBusMessages(NOW);

  it('represents every delivery state the ledger can record', () => {
    const states: BusDeliveryState[] = [
      'delivered',
      'queued',
      'held',
      'terminal',
      'undeliverable',
      'expired',
      'unknown',
    ];
    const seen = new Set(messages.map(m => m.delivery.state));
    for (const state of states) expect(seen).toContain(state);
  });

  it('addresses Demo Sessions in the sender’s own Project', () => {
    const agents = new Map(DEMO_BASE_AGENTS.map(agent => [agent.id, agent]));
    const projectByDir = new Map(DEMO_PROJECTS.map(p => [p.dir, p.key]));
    expect(messages).toHaveLength(DEMO_CHATTER.length);
    for (const m of messages) {
      const projectKey = projectByDir.get(m.projectId);
      expect(projectKey).toBeDefined();
      expect(agents.get(m.to.sessionId)?.projectKey).toBe(projectKey);
      if (m.from.kind === 'agent') {
        expect(agents.get(m.from.sessionId)?.projectKey).toBe(projectKey);
      } else {
        expect(m.from).toEqual(BUS_OPERATOR);
      }
    }
  });

  it('is ledger-ordered, reads per Project, and refuses to send', async () => {
    const client = createDemoBusClient(NOW);
    expect(messages.map(m => m.at)).toEqual(
      messages
        .map(m => m.at)
        .slice()
        .sort((a, b) => a - b)
    );
    const project = messages[0].projectId;
    const list = await client.list(project);
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.records.every(m => m.projectId === project)).toBe(true);
    }
    expect(
      await client.send({
        projectId: project,
        to: messages[0].to.sessionId,
        text: 'x',
        kind: 'operator',
      })
    ).toEqual(demoBusSendResult());
  });
});

describe('selectors', () => {
  const a = message('1', 'a', 'b', 10);
  const b = message('2', 'b', 'a', 20);
  const op = message('3', BUS_OPERATOR.sessionId, 'a', 30, {
    operator: true,
  });
  const other = message('4', 'c', 'd', 40);

  it('replaces a record by id instead of adding a second row', () => {
    const queued = message('9', 'a', 'b', 50, { state: 'queued' });
    const delivered = message('9', 'a', 'b', 50);
    const list = upsertMessage(upsertMessage([a], queued), delivered);
    expect(list).toHaveLength(2);
    expect(list[1].delivery.state).toBe('delivered');
    expect(upsertMessage([b], a).map(m => m.id)).toEqual(['1', '2']);
  });

  it('threads a pair with the operator’s messages to either of them', () => {
    expect(threadOf([a, b, op, other], 'a', 'b').map(m => m.id)).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(
      threadOf([a, b, op, other], BUS_OPERATOR.sessionId, 'a').map(m => m.id)
    ).toEqual(['3']);
    expect(newestFirst([a, b, op]).map(m => m.id)).toEqual(['3', '2', '1']);
  });

  it('counts unread after the reading position, never the operator’s own', () => {
    expect(unreadCount([a, b, op, other], 0)).toBe(3);
    expect(unreadCount([a, b, op, other], 20)).toBe(1);
    expect(agentUnreadCount([a, b, op, other], 0, 'a')).toBe(2);
    expect(agentUnreadCount([a, b, op, other], 10, 'a')).toBe(1);
    expect(agentUnreadCount([a, b, op, other], 0, 'c')).toBe(1);
    expect(latestAt([a, other, b])).toBe(40);
  });

  it('reads the first non-empty line', () => {
    expect(firstLine('\n  hello there \nsecond')).toBe('hello there');
  });
});

describe('reading position', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSeenThroughForTest();
  });

  it('only moves forward and survives a reload', () => {
    markSeenThrough(PROJECT, 50);
    markSeenThrough(PROJECT, 20);
    expect(seenThrough(PROJECT)).toBe(50);
    resetSeenThroughForTest();
    expect(seenThrough(PROJECT)).toBe(50);
    expect(seenThrough('/other')).toBe(0);
  });
});

describe('hooks', () => {
  afterEach(() => {
    window.localStorage.clear();
    resetSeenThroughForTest();
  });

  function wrapper(client: BusClient) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return <BusClientProvider client={client}>{children}</BusClientProvider>;
    };
  }

  it('tells unavailable apart from an empty Project', async () => {
    const unavailable = renderHook(() => useBusMessages(PROJECT), {
      wrapper: wrapper(createLiveBusClient(() => null)),
    });
    await waitFor(() =>
      expect(unavailable.result.current.state.status).toBe('unavailable')
    );
    const empty = renderHook(() => useBusMessages(PROJECT), {
      wrapper: wrapper(createLiveBusClient(() => fakeBridge().bridge)),
    });
    await waitFor(() =>
      expect(empty.result.current.state).toEqual({ status: 'ok', messages: [] })
    );
  });

  it('merges pushed messages and delivery updates for its Project only', async () => {
    const first = message('1', 'a', 'b', 10, { state: 'queued' });
    const { bridge, push } = fakeBridge([first]);
    const { result } = renderHook(() => useBusMessages(PROJECT), {
      wrapper: wrapper(createLiveBusClient(() => bridge)),
    });
    await waitFor(() => expect(result.current.state.status).toBe('ok'));
    act(() => {
      push(message('1', 'a', 'b', 10));
      push(message('2', 'b', 'a', 20));
      push(message('3', 'x', 'y', 30, { projectId: '/elsewhere' }));
    });
    const state = result.current.state;
    expect(
      state.status === 'ok' && state.messages.map(m => [m.id, m.delivery.state])
    ).toEqual([
      ['1', 'delivered'],
      ['2', 'delivered'],
    ]);
  });

  it('shows a sent operator message without waiting for the push', async () => {
    const { bridge } = fakeBridge();
    const { result } = renderHook(() => useBusMessages(PROJECT), {
      wrapper: wrapper(createLiveBusClient(() => bridge)),
    });
    await waitFor(() => expect(result.current.state.status).toBe('ok'));
    await act(async () => {
      await result.current.send('a', 'hold on');
    });
    const state = result.current.state;
    expect(state.status === 'ok' && state.messages.map(m => m.text)).toEqual([
      'hold on',
    ]);
  });

  it('derives Project and Agent unread from one reading position', async () => {
    const client = createLiveBusClient(
      () =>
        fakeBridge([message('1', 'a', 'b', 10), message('2', 'c', 'b', 20)])
          .bridge
    );
    const { result } = renderHook(
      () => {
        const { state } = useBusMessages(PROJECT);
        return {
          project: useProjectUnread(PROJECT, state),
          agentA: useAgentUnread(PROJECT, 'a'),
          agentB: useAgentUnread(PROJECT, 'b'),
        };
      },
      { wrapper: wrapper(client) }
    );
    await waitFor(() => expect(result.current.project).toBe(2));
    expect(result.current.agentA).toBe(1);
    expect(result.current.agentB).toBe(2);
    act(() => markSeenThrough(PROJECT, 10));
    expect(result.current).toEqual({ project: 1, agentA: 0, agentB: 1 });
  });

  it('falls back to the live client outside a provider', () => {
    function Probe() {
      return <span>{useBusClient().kind}</span>;
    }
    render(<Probe />);
    expect(screen.getByText('live')).toBeTruthy();
  });
});
