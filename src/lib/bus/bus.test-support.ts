/**
 * One builder for bus records in tests, shaped exactly as the ledger keeps
 * them (envelope, newest delivery, history), so a double is never more
 * capable than the bridge it stands in for.
 */
import { BUS_OPERATOR } from './operator';
import type { BusDeliveryState, MessageRecord } from '@exawatt/core';

export function busMessage(
  id: string,
  from: string,
  to: string,
  at: number,
  options: {
    state?: BusDeliveryState;
    reason?: string;
    operator?: boolean;
    projectId?: string;
    text?: string;
  } = {}
): MessageRecord {
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
    to: { sessionId: to, name: to, harness: 'codex' },
    at,
    text: options.text ?? `${id} first line\nsecond line`,
    delivery,
    history: [delivery],
  };
}
