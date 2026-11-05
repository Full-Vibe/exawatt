/**
 * One builder for bus records in tests, shaped exactly as the ledger keeps
 * them (envelope, each recipient's newest delivery and history), so a double
 * is never more capable than the bridge it stands in for.
 */
import { BUS_OPERATOR } from './operator';
import type { BusDeliveryState, MessageRecord } from '@exawatt/core';

export function busMessage(
  id: string,
  from: string,
  to: string | readonly string[],
  at: number,
  options: {
    state?: BusDeliveryState;
    reason?: string;
    operator?: boolean;
    projectId?: string;
    text?: string;
  } = {}
): MessageRecord {
  const recipients = typeof to === 'string' ? [to] : [...to];
  const delivery = {
    state: options.state ?? 'delivered',
    ...(options.reason ? { reason: options.reason } : {}),
    adapter: 'test',
    at,
  };
  return {
    id,
    projectId: options.projectId ?? '/work/alpha',
    from: options.operator
      ? BUS_OPERATOR
      : { sessionId: from, name: from, harness: 'claude', kind: 'agent' },
    to: recipients.map(sessionId => ({
      sessionId,
      name: sessionId,
      harness: 'codex',
    })),
    at,
    text: options.text ?? `${id} first line\nsecond line`,
    deliveries: recipients.map(sessionId => ({
      sessionId,
      delivery: { ...delivery },
      history: [{ ...delivery }],
    })),
  };
}
