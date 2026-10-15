/**
 * The agent-to-agent bus contract (ENG-029 C4, decision `0052`).
 *
 * Exawatt is the bus: it addresses, stamps, logs and hands a message to the
 * recipient harness's own door. These are the values every layer shares —
 * main's bus core and its transport plugins, the desktop bridge, the Chatter
 * dock tab and Fleet's Direct composer. Nothing here knows a mechanism: how a
 * message reaches Claude Code, Codex or Antigravity is a `MessagingTransport`
 * the harness's launch descriptor declares, and the ledger records only the
 * adapter's declared kind.
 */
import type { AgentHarness } from '../agent-sources';

/** `agent`: a peer's note, delivered at once through the harness's peer
 *  door. `operator`: the user's own turn (Direct, "Send as operator"), held
 *  while the recipient's turn runs and typed when it ends. */
export type BusMessageKind = 'agent' | 'operator';

/** The operator's address. Never a Session id: Exawatt mints those as
 *  `session-<uuid>`, so the two can never collide. */
export const BUS_OPERATOR_ID = 'operator';

/** One end of a message. `sessionId` is the Exawatt durable Session id — the
 *  address, stable across a model change or a resume; `name` is the display
 *  name at send time, kept so the ledger still reads after a rename. */
export interface BusEndpoint {
  sessionId: string;
  name: string;
  harness: AgentHarness | typeof BUS_OPERATOR_ID;
}

/** The sender, as Exawatt stamped it. Never written by the sending model. */
export interface BusSender extends BusEndpoint {
  kind: BusMessageKind;
}

/** What Exawatt stamps on every message. `projectId` is the Project's
 *  directory (`projectDir`, the same key the renderer groups Agents by);
 *  scope is the Project, so both ends always share it. */
export interface MessageEnvelope {
  id: string;
  projectId: string;
  from: BusSender;
  to: BusEndpoint;
  /** Epoch milliseconds when Exawatt accepted the send. */
  at: number;
  text: string;
}

/** Every delivery state a ledger may hold, in the order a reader explains
 *  them. `held` and `expired` exist for a harness that reports its own hold;
 *  no Exawatt launch produces them (decision `0052`, 2026-10-15). */
export const BUS_DELIVERY_STATES = [
  'delivered',
  'queued',
  'held',
  'terminal',
  'undeliverable',
  'expired',
  'unknown',
] as const;

export type BusDeliveryState = (typeof BUS_DELIVERY_STATES)[number];

export function isBusDeliveryState(value: unknown): value is BusDeliveryState {
  return (
    typeof value === 'string' &&
    (BUS_DELIVERY_STATES as readonly string[]).includes(value)
  );
}

/** One delivery outcome. `adapter` is the transport's declared kind
 *  (`claude-socket`, `codex-queue`, `terminal-input`, …) or `bus` when the
 *  bus itself refused before any transport ran. `reason` is operator- and
 *  agent-legible prose, present whenever the state is not plain success. */
export interface DeliveryResult {
  state: BusDeliveryState;
  reason?: string;
  adapter: string;
}

/** A delivery outcome as the ledger keeps it. */
export interface DeliveryEvent extends DeliveryResult {
  at: number;
}

/** One logged message: the envelope plus its delivery history, oldest
 *  first. `delivery` is the newest entry of `history`. */
export interface MessageRecord extends MessageEnvelope {
  delivery: DeliveryEvent;
  history: DeliveryEvent[];
}

/** A Session the bus can address. Shell tabs are not Agents and never
 *  appear; an ended Session stays listed so a send to it fails by name. */
export interface BusDirectoryEntry extends BusEndpoint {
  projectId: string;
  projectName: string;
  /** The `@handle` a sender types: the Agent's name (`busHandle`). */
  handle: string;
  state: 'live' | 'ended';
}

/** What a transport plugin is: one adapter that hands an envelope to a
 *  harness's door and says what happened. The bus core addresses, stamps,
 *  logs and calls `deliver`; it never knows the mechanism. Main supplies the
 *  target and context types. */
export interface MessagingTransport<Target = unknown, Context = unknown> {
  /** The adapter name the ledger records. */
  kind: string;
  deliver(
    envelope: MessageEnvelope,
    target: Target,
    context: Context
  ): Promise<DeliveryResult>;
}

/** `bus:send`. The renderer is always the operator: the kind is fixed so the
 *  UI can never speak as an Agent. */
export interface BusSendRequest {
  projectId: string;
  /** The recipient's durable Session id, or `@handle`. */
  to: string;
  text: string;
  kind: 'operator';
}

/** What a send answers. `record` is null when the bus refused before
 *  logging (unknown, ended, ambiguous or cross-Project recipient, empty or
 *  oversized text, Demo); `delivery` then carries the reason, and
 *  `candidates` lists the Sessions an ambiguous name could mean. */
export interface BusSendResult {
  delivery: DeliveryResult;
  record: MessageRecord | null;
  candidates?: BusDirectoryEntry[];
}

/** A ledger read. A damaged ledger is `ok: false` with the reason, never an
 *  empty list (BUG-125's rule: absence is not an answer). */
export type BusLedgerRead =
  | { ok: true; records: MessageRecord[] }
  | { ok: false; reason: string };
