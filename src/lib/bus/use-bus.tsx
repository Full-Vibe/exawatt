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
import { refusedSend, type BusClient } from './client';
import { createLiveBusClient } from './live-client';
import { useSeenThrough } from './read-state';
import { agentUnreadCount, unreadCount, upsertMessage } from './selectors';
import type { MessageRecord, BusSendResult } from '@exawatt/core';

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
  | { status: 'ok'; messages: MessageRecord[] }
  | { status: 'unavailable'; reason: string }
  | { status: 'error'; message: string };

/**
 * One Project's messages in ledger order, kept current by the bus's push.
 * `null` Project reads nothing (and is not `unavailable`).
 */
export function useBusMessages(projectId: string | null): {
  state: BusMessagesState;
  /** Send as operator to one Session of this Project. */
  send: (to: string, text: string) => Promise<BusSendResult>;
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
    let loaded: MessageRecord[] | null = null;
    const early: MessageRecord[] = [];
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
      if (result.ok) {
        loaded = early.reduce<MessageRecord[]>(
          (messages, message) => upsertMessage(messages, message),
          result.records
        );
        setState({ status: 'ok', messages: loaded });
      } else if ('unavailable' in result) {
        setState({ status: 'unavailable', reason: result.reason });
      } else {
        setState({ status: 'error', message: result.reason });
      }
    });
    return () => {
      reads.invalidate();
      unsubscribe();
    };
  }, [client, projectId, reads]);

  const send = useCallback(
    async (to: string, text: string) => {
      if (!projectId) return refusedSend('Open a Project first');
      const result = await client.send({
        projectId,
        to,
        text,
        kind: 'operator',
      });
      const sent = result.record;
      if (sent && sent.projectId === projectId) {
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
