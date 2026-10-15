/**
 * The bus message contract as the renderer reads it (ENG-029 C4, decision
 * `0052`). These mirror P3's published B1 contract (substrate doc, "B1
 * contract", `packages/core/src/bus/types.ts`) name for name, so that when
 * the core lands on master this file becomes one re-export from
 * `@exawatt/core` and every consumer keeps compiling. Only the renderer's
 * subset is mirrored; the transport plugin interface stays main's business.
 *
 * `projectId` is the Project's directory, the key Team groups tiles by.
 * Scope is the Project (operator, 2026-10-15: "Within a project only, for
 * now").
 */

/** `agent`: a peer's note. `operator`: the user's own turn. */
type BusMessageKind = 'agent' | 'operator';

/** The operator's address; Exawatt Session ids are `session-<uuid>`, so the
 *  two never collide. */
export const BUS_OPERATOR_ID = 'operator';

/** One end of a message: the durable Session id (the address), the display
 *  name at send time, and the harness (or `operator`). */
export interface BusEndpoint {
  sessionId: string;
  name: string;
  harness: string;
}

/** The sender, as Exawatt stamped it. */
export interface BusSender extends BusEndpoint {
  kind: BusMessageKind;
}

/**
 * What became of a message, in the ledger's vocabulary (B0 verdicts):
 * `delivered` — accepted by the recipient harness's own door;
 * `queued` — waiting for the recipient's turn boundary;
 * `held` / `expired` — the recipient harness's own inbound rule held it, then
 *   let it lapse (only where a harness reports it);
 * `terminal` — typed into the recipient's terminal;
 * `undeliverable` — not handed over, with the reason;
 * `unknown` — handed over with no evidence either way.
 */
export type BusDeliveryState =
  | 'delivered'
  | 'queued'
  | 'held'
  | 'terminal'
  | 'undeliverable'
  | 'expired'
  | 'unknown';

/** One delivery outcome; `adapter` is the transport's declared kind, `bus`
 *  when the bus refused before any transport ran, `demo` in the Demo. */
interface DeliveryResult {
  state: BusDeliveryState;
  reason?: string;
  adapter: string;
}

interface DeliveryEvent extends DeliveryResult {
  at: number;
}

/** One logged message: Exawatt's envelope plus its delivery history, oldest
 *  first; `delivery` is the newest entry. */
interface MessageRecord {
  id: string;
  projectId: string;
  from: BusSender;
  to: BusEndpoint;
  /** epoch milliseconds when Exawatt accepted the send */
  at: number;
  text: string;
  delivery: DeliveryEvent;
  history: DeliveryEvent[];
}

/** The renderer's name for a logged message. */
export type BusMessage = MessageRecord;

/** `bus:send`. The renderer is always the operator. */
export interface BusSendRequest {
  projectId: string;
  /** the recipient's durable Session id, or `@handle` */
  to: string;
  text: string;
  kind: 'operator';
}

/** What a send answers. `record` is null when the bus refused before
 *  logging; `delivery.reason` then says why. */
export interface BusSendResult {
  delivery: DeliveryResult;
  record: MessageRecord | null;
}

/** A ledger read: a damaged ledger is `ok: false`, never an empty list. */
export type BusLedgerRead =
  | { ok: true; records: MessageRecord[] }
  | { ok: false; reason: string };
