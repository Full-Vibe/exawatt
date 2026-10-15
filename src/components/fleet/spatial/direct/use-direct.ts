'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { BusClient } from '@/lib/bus/client';
import { DEMO_CANNOT_SEND } from '@/lib/bus/demo-client';
import {
  SESSION_STOPPED_REASON,
  directResultOf,
  type DirectAvailability,
  type DirectRecipient,
  type DirectResult,
} from './direct-model';

/** A recipient's bus address, or why it has none. */
export type RecipientAddress = { address: string } | { refused: string };

/**
 * Sends one operator message to every recipient, one bus send each
 * (decision `0052`), and keeps each recipient's result as it arrives.
 *
 * `resolveAddresses` maps the board's Agents to bus addresses: the durable
 * Session id on this machine, the Agent's own id in the Demo. It is injected
 * because the board's Agent id is a runtime handle, not the address.
 */
export function useDirect({
  client,
  recipients,
  resolveAddresses,
}: {
  /** the board's bus: this machine's, or the Demo's on the Demo board */
  client: BusClient;
  recipients: readonly DirectRecipient[];
  resolveAddresses: (
    agentIds: readonly string[]
  ) => Promise<ReadonlyMap<string, RecipientAddress>>;
}) {
  const key = recipients.map(recipient => recipient.agentId).join('\u001f');
  const [results, setResults] = useState<ReadonlyMap<string, DirectResult>>(
    () => new Map()
  );
  const [addresses, setAddresses] = useState<
    ReadonlyMap<string, RecipientAddress>
  >(() => new Map());
  const [busReason, setBusReason] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const recipientsRef = useRef(recipients);
  useLayoutEffect(() => {
    recipientsRef.current = recipients;
  }, [recipients]);

  // A new working set starts clean: results belong to the set they went to.
  useEffect(() => {
    setResults(new Map());
    let current = true;
    const ids = recipientsRef.current.map(recipient => recipient.agentId);
    void resolveAddresses(ids).then(resolved => {
      if (current) setAddresses(resolved);
    });
    return () => {
      current = false;
    };
  }, [key, resolveAddresses]);

  // Whether a bus exists here is the client's answer, read through the seam:
  // an unavailable read names the reason the rows then show.
  const probeProject = recipients.find(entry => entry.projectId)?.projectId;
  useEffect(() => {
    if (client.kind === 'demo' || !probeProject) return;
    let current = true;
    void client.list(probeProject).then(read => {
      if (current)
        setBusReason(read.status === 'unavailable' ? read.reason : null);
    });
    return () => {
      current = false;
    };
  }, [client, probeProject]);

  const availability: DirectAvailability = useMemo(
    () =>
      client.kind === 'demo'
        ? { kind: 'unavailable', reason: DEMO_CANNOT_SEND }
        : busReason
          ? { kind: 'unavailable', reason: busReason }
          : { kind: 'ready' },
    [busReason, client.kind]
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || availability.kind !== 'ready') return false;
      const targets = recipientsRef.current;
      setSending(true);
      try {
        const resolved = await resolveAddresses(
          targets.map(recipient => recipient.agentId)
        );
        setAddresses(resolved);
        setResults(
          new Map(
            targets.map(recipient => [
              recipient.agentId,
              recipient.readiness === 'stopped'
                ? { state: 'undeliverable', reason: SESSION_STOPPED_REASON }
                : { state: 'sending' },
            ])
          )
        );
        const settle = (agentId: string, result: DirectResult) =>
          setResults(previous => new Map(previous).set(agentId, result));
        // Stopped Sessions are listed and answered, never sent: an ended
        // Session has no door, and the row already said so before Send.
        await Promise.all(
          targets
            .filter(recipient => recipient.readiness !== 'stopped')
            .map(async recipient => {
              const address = resolved.get(recipient.agentId);
              if (!address || 'refused' in address || !recipient.projectId) {
                settle(recipient.agentId, {
                  state: 'undeliverable',
                  reason:
                    address && 'refused' in address
                      ? address.refused
                      : 'No Session to deliver to',
                });
                return;
              }
              const result = await client.send({
                projectId: recipient.projectId,
                to: address.address,
                text: trimmed,
                kind: 'operator',
              });
              settle(recipient.agentId, directResultOf(result));
            })
        );
        // TODO(ENG-047 F1): emit `agent_directed` {recipients, delivered} once
        // the funnel's allowlisted event lands; nothing may send it before.
        return true;
      } finally {
        setSending(false);
      }
    },
    [availability.kind, client, resolveAddresses]
  );

  return { availability, results, addresses, sending, send };
}
