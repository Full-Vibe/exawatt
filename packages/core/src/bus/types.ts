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
 *  scope is the Project, so every end always shares it. */
export interface MessageEnvelope {
  id: string;
  projectId: string;
  from: BusSender;
  /** Every recipient, in the order the sender named them: never empty,
   *  never repeated. One message is one delivery to each of them, and each
   *  is told who else received it (BUG-329). */
  to: BusEndpoint[];
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

/** One recipient's delivery: its history, oldest first, and `delivery`,
 *  the newest entry of it. */
export interface RecipientDelivery {
  /** The recipient's address, one of the envelope's `to`. */
  sessionId: string;
  delivery: DeliveryEvent;
  history: DeliveryEvent[];
}

/** One logged message: the envelope, logged once, plus each recipient's
 *  delivery in `to`'s order. */
export interface MessageRecord extends MessageEnvelope {
  deliveries: RecipientDelivery[];
}

/**
 * Who started an Agent's turn. The operator's turns (a keystroke, a launch
 * task, Direct, "Send as operator") are his to be told about when they end;
 * a turn another Agent started over the bus is that Agent's business, and
 * Chatter is where the operator notices it (BUG-332). A turn nobody can
 * attribute is the operator's: that is how every turn read before the bus.
 */
export type TurnInitiator =
  | { kind: 'operator' }
  | { kind: 'agent'; sessionId: string; name: string };

/** The turn a message opens in its recipient: an operator message is the
 *  operator's turn, a peer's note is the peer's. */
export function busTurnInitiator(from: BusSender): TurnInitiator {
  return from.kind === 'operator'
    ? { kind: 'operator' }
    : { kind: 'agent', sessionId: from.sessionId, name: from.name };
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
  /** Every recipient: a durable Session id or `@handle` each. */
  to: string[];
  text: string;
  kind: 'operator';
}

/** What a send answers: the logged record, whose `deliveries` say what
 *  happened at each recipient's door, or a refusal before anything was
 *  logged (an unknown, ended, ambiguous or cross-Project recipient, empty or
 *  oversized text, Demo) with the reason, and `candidates` listing the
 *  Sessions an ambiguous name could mean. An addressing failure refuses the
 *  whole send: a message never reaches some of the recipients it names
 *  while telling them about one it could not reach. */
export type BusSendResult =
  | { ok: true; record: MessageRecord }
  | { ok: false; reason: string; candidates?: BusDirectoryEntry[] };

/** A ledger read. A damaged ledger is `ok: false` with the reason, never an
 *  empty list (BUG-125's rule: absence is not an answer). */
export type BusLedgerRead =
  | { ok: true; records: MessageRecord[] }
  | { ok: false; reason: string };
