'use client';

/**
 * React access to the bus. The client comes from context: the live client by
 * default, the Demo client wherever the Demo Workspace provides it, so a
 * surface never decides which bus it is reading.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLatestRequest } from '@/hooks/use-latest-request';
import type { BusClient, BusSendResult } from './client';
import { createLiveBusClient } from './live-client';
import { useSeenThrough } from './read-state';
import { agentUnreadCount, unreadCount, upsertMessage } from './selectors';
import type { BusMessage, BusSendRequest } from './types';

let liveClient: BusClient | null = null;
function defaultClient(): BusClient {
  liveClient ??= createLiveBusClient();
  return liveClient;
}

const BusClientContext = createContext<BusClient | null>(null);

export function BusClientProvider({
  client,
  children,
}: {
  client: BusClient;
  children: ReactNode;
}) {
  return (
    <BusClientContext.Provider value={client}>
      {children}
    </BusClientContext.Provider>
  );
}

export function useBusClient(): BusClient {
  return useContext(BusClientContext) ?? defaultClient();
}

export type BusMessagesState =
  | { status: 'loading' }
  | { status: 'ok'; messages: BusMessage[] }
  | { status: 'unavailable'; reason: string }
  | { status: 'error'; message: string };

/**
 * One Project's messages in ledger order, kept current by the bus's push.
 * `null` Project reads nothing (and is not `unavailable`).
 */
export function useBusMessages(projectId: string | null): {
  state: BusMessagesState;
  send: (request: Omit<BusSendRequest, 'projectId'>) => Promise<BusSendResult>;
} {
  const client = useBusClient();
  const reads = useLatestRequest();
  const [state, setState] = useState<BusMessagesState>({ status: 'loading' });

  useEffect(() => {
    if (!projectId) {
      reads.invalidate();
      setState({ status: 'loading' });
      return;
    }
    const ticket = reads.begin();
    setState({ status: 'loading' });
    // a push that lands while the read is in flight is kept and merged
    let loaded: BusMessage[] | null = null;
    const early: BusMessage[] = [];
    const unsubscribe = client.subscribe(message => {
      if (message.projectId !== projectId) return;
      if (loaded === null) {
        early.push(message);
        return;
      }
      setState(current =>
        current.status === 'ok'
          ? { status: 'ok', messages: upsertMessage(current.messages, message) }
          : current
      );
    });
    void client.list(projectId).then(result => {
      if (!ticket.current) return;
      if (result.status === 'ok') {
        loaded = early.reduce<BusMessage[]>(
          (messages, message) => upsertMessage(messages, message),
          result.messages
        );
        setState({ status: 'ok', messages: loaded });
      } else if (result.status === 'unavailable') {
        setState({ status: 'unavailable', reason: result.reason });
      } else {
        setState({ status: 'error', message: result.message });
      }
    });
    return () => {
      reads.invalidate();
      unsubscribe();
    };
  }, [client, projectId, reads]);

  const send = useCallback(
    async (request: Omit<BusSendRequest, 'projectId'>) => {
      if (!projectId) {
        return { status: 'refused', reason: 'No Project' } as const;
      }
      const result = await client.send({ ...request, projectId });
      if (result.status === 'sent' && result.message.projectId === projectId) {
        const sent = result.message;
        setState(current =>
          current.status === 'ok'
            ? { status: 'ok', messages: upsertMessage(current.messages, sent) }
            : current
        );
      }
      return result;
    },
    [client, projectId]
  );

  return { state, send };
}

/** Unread in one Project: the Chatter tab's badge. */
export function useProjectUnread(
  projectId: string | null,
  state: BusMessagesState
): number {
  const seen = useSeenThrough(projectId);
  return useMemo(
    () => (state.status === 'ok' ? unreadCount(state.messages, seen) : 0),
    [seen, state]
  );
}

/**
 * Unread messages one Agent sent or received, for Fleet's selection panel
 * (ENG-004 V4.2, packet P5). Reads the same Project messages and the same
 * reading position as the Chatter tab, so the two never disagree.
 */
export function useAgentUnread(
  projectId: string | null,
  sessionId: string | null
): number {
  const { state } = useBusMessages(projectId);
  const seen = useSeenThrough(projectId);
  return useMemo(
    () =>
      state.status === 'ok' && sessionId
        ? agentUnreadCount(state.messages, seen, sessionId)
        : 0,
    [seen, sessionId, state]
  );
}
