/**
 * The door for a harness with none (decision `0052` §7): every message reads
 * `undeliverable` with the reason, never a silent drop.
 */
import type { BusTransport } from './types';

export function undeliverableTransport(reason: string): BusTransport {
  return {
    kind: 'none',
    holdWhile: [],
    deliver: async () => ({ state: 'undeliverable', reason, adapter: 'none' }),
  };
}
