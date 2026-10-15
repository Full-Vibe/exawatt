/**
 * The bus message contract as the renderer reads it (ENG-029 C4, decision
 * `0052`). These are the shapes the friend-cohort packets agreed to build
 * against until P3 publishes the real ones in `packages/core/src/bus/`; when
 * that lands, this file becomes a re-export of the core types in one edit and
 * every consumer keeps compiling.
 *
 * `projectId` is the Project's key in the workspace store, its `dir`: the
 * Chatter view and the Direct composer address a Project by the same value the
 * Team tiles group by. Scope is the Project (operator, 2026-10-15: "Within a
 * project only, for now").
 */

/** One end of a message: the Session's stable address plus how it reads. */
export interface BusEndpoint {
  /** the Exawatt Session id: the address */
  sessionId: string;
  /** the operator-facing name at send time (stamped by Exawatt) */
  name: string;
  /** the harness id (`claude`, `codex`, `antigravity`, …) or `operator` */
  harness: string;
}

/** Who wrote it. An `operator` message is the human's own turn. */
type BusMessageKind = 'agent' | 'operator';

/**
 * What became of a message, in the ledger's vocabulary (B0 verdicts):
 * `delivered` — accepted by the recipient harness's own door;
 * `queued` — waiting for the recipient's turn boundary (Codex);
 * `held` / `expired` — the recipient harness's own inbound rule held it, then
 *   let it lapse (reported only where a harness says so);
 * `terminal` — typed into the recipient's terminal (Antigravity, others);
 * `undeliverable` — Exawatt could not hand it over, with the reason;
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

interface BusDelivery {
  state: BusDeliveryState;
  reason?: string;
}

export interface BusMessage {
  id: string;
  projectId: string;
  from: BusEndpoint;
  to: BusEndpoint;
  kind: BusMessageKind;
  /** epoch milliseconds, stamped by Exawatt */
  at: number;
  text: string;
  delivery: BusDelivery;
}

/** What the operator (or an Agent tool) asks the bus to send. */
export interface BusSendRequest {
  projectId: string;
  /** recipient Session id */
  to: string;
  text: string;
  kind: BusMessageKind;
}
