/**
 * The renderer's one seam onto the agent bus (ENG-029 B3; decision `0052`,
 * amended 2026-10-15: the store and the transport sit behind one seam). The
 * Chatter tab in Team and the Direct composer on the Fleet board read and
 * send through a `BusClient`, never through `window.electron` directly, so a
 * Demo Workspace, this machine's bus, or a later hosted relay are one swap.
 *
 * Absence is not an answer: a client that cannot reach a bus reports
 * `unavailable` with the reason. It never returns an empty list, because an
 * empty list means "no Agent has said anything", which is a different fact.
 */
import type {
  BusLedgerRead,
  BusSendRequest,
  BusSendResult,
  MessageRecord,
} from '@exawatt/core';

type BusClientKind = 'live' | 'demo';

/**
 * A read is the bus's own `BusLedgerRead`, passed through, plus the one case
 * only the client can know: there is no bus here at all.
 */
export type BusReadResult =
  | BusLedgerRead
  /** no bus in this build or source; `reason` is one honest line */
  | { ok: false; unavailable: true; reason: string };

export interface BusClient {
  readonly kind: BusClientKind;
  /** every message in one Project, in ledger order */
  list(projectId: string): Promise<BusReadResult>;
  /** every message between two addresses of one Project, in ledger order */
  thread(projectId: string, a: string, b: string): Promise<BusReadResult>;
  /** `record` null is a refusal at the sender, with the reason */
  send(request: BusSendRequest): Promise<BusSendResult>;
  /**
   * New messages and delivery updates, as they happen. A later record with an
   * id already seen replaces it (a `queued` message becoming `delivered`).
   * Returns the unsubscribe.
   */
  subscribe(listener: (message: MessageRecord) => void): () => void;
}

/** A refusal before anything was logged. */
export function refusedSend(reason: string, adapter = 'bus'): BusSendResult {
  return {
    delivery: { state: 'undeliverable', reason, adapter },
    record: null,
  };
}
