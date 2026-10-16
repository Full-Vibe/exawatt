/**
 * Direct N Agents (ENG-004 V4.2): the human end of the bus, as data.
 *
 * Input only. The panel says, per recipient, what will happen before Send and
 * what happened after it; it never renders a reply, a thread, a comparison or
 * a count of answers (decision `0052`; operator 2026-10-15: a second
 * agent-communication view would "duplicate and diverge").
 */
import type {
  BusDeliveryState,
  BusSendResult,
  ExawattAgent,
} from '@exawatt/core';
import { workStateReading } from '@/components/status-light/protocol';

/** What the board knows about a recipient before anything is sent. */
type RecipientReadiness =
  /** idle or waiting: the message goes in now */
  | 'ready'
  /** mid-turn: the bus queues it for the turn's end, never interrupts */
  | 'busy'
  /** the Session ended: listed, never silently dropped, never sent */
  | 'stopped';

export interface DirectRecipient {
  agentId: string;
  name: string;
  /** source-owned harness id; null when the source did not say */
  harness: string | null;
  /** the Project directory the bus scopes the message to */
  projectId: string | null;
  readiness: RecipientReadiness;
}

export function directRecipients(
  agents: readonly ExawattAgent[]
): DirectRecipient[] {
  return agents.map(agent => ({
    agentId: agent.id,
    name: agent.name,
    harness: agent.sourceAdapterId ?? null,
    projectId: agent.projectId ?? null,
    readiness:
      agent.sessionState === 'stopped'
        ? 'stopped'
        : // the same reading the row's status light shows: one predicate
          // over one fact, so "busy" never disagrees with the light
          workStateReading(agent.status) === 'active'
          ? 'busy'
          : 'ready',
  }));
}

/** Whether this board can send at all, decided once for every row. */
export type DirectAvailability =
  | { kind: 'ready' }
  | { kind: 'unavailable'; reason: string };

/** One recipient's outcome, as it arrives. */
export type DirectResult =
  | { state: 'sending' }
  | { state: BusDeliveryState; reason?: string };

/**
 * The renderer client's answer from before it was typed against the core
 * contract (P4 is retyping it). Declared here, structurally, so Direct reads
 * either answer without depending on the renderer's own message types.
 */
type PreContractSendAnswer =
  | {
      status: 'sent';
      message: { delivery: { state: BusDeliveryState; reason?: string } };
    }
  | { status: 'refused'; reason: string };

/**
 * The bus's answer to one send, reduced to the recipient's row. This is the
 * one place that reads a send result. A `null` record is a refusal before
 * anything was logged; its `delivery` says why.
 */
export function directResultOf(
  result: BusSendResult | PreContractSendAnswer
): DirectResult {
  const delivery =
    'delivery' in result
      ? result.delivery
      : result.status === 'sent'
        ? result.message.delivery
        : { state: 'undeliverable' as const, reason: result.reason };
  return {
    state: delivery.state,
    ...(delivery.reason ? { reason: delivery.reason } : {}),
  };
}

export const SESSION_STOPPED_REASON = 'Session stopped';

/** Rows are told what Send will do, not only what it did. */
export interface RecipientNote {
  text: string;
  /** `fault` is the only emphasized tone: it needs the operator's eye. */
  tone: 'quiet' | 'pending' | 'fault';
  title?: string;
}

const STATE_WORD: Record<BusDeliveryState, string> = {
  delivered: 'delivered',
  queued: 'queued',
  held: 'held',
  terminal: 'typed into terminal',
  undeliverable: 'undeliverable',
  expired: 'expired',
  unknown: 'sent, unconfirmed',
};

export function recipientNote(
  recipient: DirectRecipient,
  availability: DirectAvailability,
  result: DirectResult | undefined,
  /** why this recipient has no bus address (a shell, a connected coworker),
   *  known before Send so the row can say so before Send */
  refused?: string
): RecipientNote | null {
  if (result) {
    if (result.state === 'sending')
      return { text: 'sending…', tone: 'pending' };
    const word = STATE_WORD[result.state];
    const fault =
      result.state === 'undeliverable' || result.state === 'expired';
    return {
      text:
        fault && result.reason
          ? `${word} · ${result.reason}`
          : result.state === 'queued'
            ? 'queued, delivers when its turn ends'
            : word,
      tone: fault ? 'fault' : 'quiet',
      ...(result.reason ? { title: result.reason } : {}),
    };
  }
  if (availability.kind === 'unavailable') {
    return { text: availability.reason, tone: 'quiet' };
  }
  if (refused) {
    return { text: `undeliverable · ${refused}`, tone: 'fault' };
  }
  if (recipient.readiness === 'stopped') {
    return {
      text: `undeliverable · ${SESSION_STOPPED_REASON}`,
      tone: 'fault',
    };
  }
  if (recipient.readiness === 'busy') {
    return { text: 'busy, will deliver when its turn ends', tone: 'quiet' };
  }
  return null;
}
