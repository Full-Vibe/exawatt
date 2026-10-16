/**
 * The bus core (ENG-029 C4, decision `0052`): address, stamp, log, deliver.
 *
 * Every send resolves its recipient in the sender's Project, stamps the
 * envelope, asks the recipient harness's launch descriptor for the door
 * (`messaging.agent` or `messaging.operator`) and hands the message to it.
 * This module never knows a mechanism and never branches on a harness id;
 * it knows only what a transport declares: its kind, the recipient states
 * it must not type into (`holdWhile`), and whether its `queued` becomes
 * `delivered` when the recipient's next turn starts.
 *
 * Delivery is unconditional on Exawatt's side: no approval, quota, counter
 * or loop detector. Holding is not policing: a message is held only where
 * typing would land in a running turn or an open dialog, and it is typed the
 * moment that ends. Messages to one Session go through its doors in order.
 */
import {
  busHandle,
  type AgentHarness,
  type BusSendResult,
  type BusSender,
  type DeliveryEvent,
  type DeliveryResult,
  type MessageEnvelope,
  type MessageRecord,
} from '@exawatt/core';
import type { BusAddressee, BusDirectory } from './directory';
import type { BusStore } from './ledger';
import type { RecipientStateSource } from './recipient-state';
import {
  BUS_MAX_TEXT_CHARS,
  cleanBusText,
  deliveredText,
  stampEnvelope,
} from './stamping';
import { BUS_MCP_SEND_TOOL } from './mcp-server';
import type {
  BusDeliveryContext,
  BusTarget,
  BusTransport,
  RecipientState,
} from './transports/types';
import { undeliverableTransport } from './transports/undeliverable';

/** The two doors a harness declares (its descriptor's `messaging`). */
export interface BusDoors {
  agent: BusTransport | null;
  operator: BusTransport | null;
  /** How the recipient's Agents reach the bus: with an MCP door, the reply
   *  hint names the send tool in their own tool list. */
  outbound?: { mcp: unknown };
}

interface BusDispatchDeps {
  directory: BusDirectory;
  store: BusStore;
  recipients: RecipientStateSource;
  /** The recipient harness's declared doors. */
  doorsOf(harness: AgentHarness): BusDoors;
  /** What a transport is handed besides the text. */
  contextFor(target: BusTarget): Omit<BusDeliveryContext, 'text'>;
  /** A harness as the operator reads it (`Claude Code`, `Codex`). */
  harnessLabel(harness: AgentHarness | 'operator'): string;
  /** Every new record and every delivery change. */
  onRecord?(record: MessageRecord): void;
  now?: () => number;
}

export interface BusSendInput {
  from: BusSender;
  projectId: string;
  /** Durable Session id or `@handle`. */
  to: string;
  text: string;
  /** The sender's own address, so a send to itself is refused. */
  senderSessionId?: string | null;
}

interface HeldMessage {
  record: MessageRecord;
  target: BusTarget;
  transport: BusTransport;
  text: string;
  /** False until its message line is in the ledger: a message takes its
   *  place in the queue the moment it is accepted, so a send that logs
   *  sooner can never pass it, and nothing types it before it is logged. */
  logged: boolean;
}

function refused(reason: string, candidates?: BusSendResult['candidates']) {
  return {
    delivery: { state: 'undeliverable', reason, adapter: 'bus' },
    record: null,
    ...(candidates ? { candidates } : {}),
  } satisfies BusSendResult;
}

function holdReason(handle: string, state: RecipientState): string {
  if (state === 'starting') return `Waiting for @${handle} to finish starting`;
  if (state === 'blocked')
    return `Waiting for @${handle} to answer its open question`;
  return `Waiting for @${handle}'s turn to end`;
}

function targetOf(addressee: BusAddressee): BusTarget {
  const { session, entry } = addressee;
  return {
    sessionId: entry.sessionId,
    ptyId: session.id,
    name: entry.name,
    harness: session.harness,
    harnessSessionId: session.harnessSessionId ?? null,
    cwd: session.cwd,
  };
}

export class BusDispatcher {
  /** Per recipient process: the order its doors are used in. */
  private chains = new Map<string, Promise<void>>();
  /** Per recipient process: messages waiting for a state their door allows. */
  private held = new Map<string, HeldMessage[]>();
  /**
   * Per recipient process: `queued` records its next turn delivers, and
   * whether it has run since. A harness that runs a queue drains it before
   * it idles, and back-to-back turns show no idle gap to call a start, so a
   * recipient that has run and then gone idle has taken the message too.
   */
  private awaitingTurn = new Map<
    string,
    { record: MessageRecord; ran: boolean }[]
  >();
  private readonly now: () => number;
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: BusDispatchDeps) {
    this.now = deps.now ?? Date.now;
    this.unsubscribe = deps.recipients.subscribe((ptyId, change) => {
      if (change === 'turn-start') this.settleAwaiting(ptyId, true);
      else {
        this.settleAwaiting(ptyId, false);
        this.release(ptyId);
      }
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  async send(input: BusSendInput): Promise<BusSendResult> {
    const text = cleanBusText(input.text);
    if (!text) return refused('Nothing to send');
    if (text.length > BUS_MAX_TEXT_CHARS)
      return refused(
        `That message is ${text.length} characters; the bus carries up to ${BUS_MAX_TEXT_CHARS}`
      );
    const resolution = this.deps.directory.resolve(
      input.projectId,
      input.to,
      input.senderSessionId ?? null
    );
    if (!resolution.ok)
      return refused(resolution.reason, resolution.candidates);
    const { addressee } = resolution;
    const target = targetOf(addressee);
    const doors = this.deps.doorsOf(target.harness);
    const transport =
      (input.from.kind === 'operator' ? doors.operator : doors.agent) ??
      undeliverableTransport(
        `${this.deps.harnessLabel(target.harness)} takes no ${
          input.from.kind === 'operator' ? 'operator' : 'peer'
        } messages through Exawatt yet`
      );
    const envelope = stampEnvelope({
      projectId: input.projectId,
      from: input.from,
      to: {
        sessionId: addressee.entry.sessionId,
        name: addressee.entry.name,
        harness: addressee.entry.harness,
      },
      text,
      at: this.now(),
    });
    const delivered = deliveredText(
      envelope,
      this.deps.harnessLabel(input.from.harness),
      addressee.entry.projectName,
      doors.outbound?.mcp ? BUS_MCP_SEND_TOOL : null
    );

    const state = this.deps.recipients.state(target.ptyId);
    const mustHold =
      transport.holdWhile.length > 0 &&
      (!!this.held.get(target.ptyId)?.length ||
        (transport.holdWhile as readonly string[]).includes(state));
    if (mustHold) {
      const record = this.recordOf(envelope, {
        state: 'queued',
        reason: holdReason(addressee.entry.handle, state),
        adapter: transport.kind,
      });
      // The queue is taken (or made) and the message placed in it with no
      // await in between, so two concurrent sends share one queue in the
      // order they were accepted.
      const held: HeldMessage = {
        record,
        target,
        transport,
        text: delivered,
        logged: false,
      };
      this.heldQueue(target.ptyId).push(held);
      try {
        await this.deps.store.append(record);
      } catch (error) {
        this.unhold(target.ptyId, held);
        // What waited behind it may go now.
        this.release(target.ptyId);
        return refused(`Exawatt could not log the message (${String(error)})`);
      }
      held.logged = true;
      this.deps.onRecord?.(this.copy(record));
      // The state may already allow it (a change raced this send).
      this.release(target.ptyId);
      return { delivery: { ...record.delivery }, record: this.copy(record) };
    }

    const result = await this.inOrder(target.ptyId, () =>
      this.deliver(transport, envelope, target, delivered)
    );
    const record = this.recordOf(envelope, result);
    try {
      await this.deps.store.append(record);
    } catch (error) {
      console.error('[bus] a delivered message could not be logged', error);
    }
    this.awaitTurnIfQueued(transport, target, record);
    this.deps.onRecord?.(this.copy(record));
    return { delivery: { ...record.delivery }, record: this.copy(record) };
  }

  private recordOf(
    envelope: MessageEnvelope,
    result: DeliveryResult
  ): MessageRecord {
    const event: DeliveryEvent = { ...result, at: this.now() };
    return { ...envelope, delivery: event, history: [event] };
  }

  private copy(record: MessageRecord): MessageRecord {
    return {
      ...record,
      delivery: { ...record.delivery },
      history: record.history.map(event => ({ ...event })),
    };
  }

  /** A transport that throws has failed to deliver; it never breaks a send. */
  private async deliver(
    transport: BusTransport,
    envelope: MessageEnvelope,
    target: BusTarget,
    text: string
  ): Promise<DeliveryResult> {
    try {
      return await transport.deliver(envelope, target, {
        ...this.deps.contextFor(target),
        text,
      });
    } catch (error) {
      return {
        state: 'unknown',
        reason: `The ${transport.kind} door failed: ${error instanceof Error ? error.message : String(error)}`,
        adapter: transport.kind,
      };
    }
  }

  private inOrder<T>(ptyId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(ptyId) ?? Promise.resolve();
    const next = previous.then(work);
    const settled = next.then(
      () => {},
      () => {}
    );
    this.chains.set(ptyId, settled);
    void settled.then(() => {
      if (this.chains.get(ptyId) === settled) this.chains.delete(ptyId);
    });
    return next;
  }

  private async update(
    record: MessageRecord,
    result: DeliveryResult
  ): Promise<void> {
    const event: DeliveryEvent = { ...result, at: this.now() };
    record.history.push(event);
    record.delivery = event;
    try {
      await this.deps.store.appendDelivery(record.projectId, record.id, event);
    } catch (error) {
      console.error('[bus] a delivery change could not be logged', error);
    }
    this.deps.onRecord?.(this.copy(record));
  }

  private awaitTurnIfQueued(
    transport: BusTransport,
    target: BusTarget,
    record: MessageRecord
  ): void {
    if (!transport.queuedUntilTurnStart || record.delivery.state !== 'queued')
      return;
    const list = this.awaitingTurn.get(target.ptyId) ?? [];
    list.push({
      record,
      ran: this.deps.recipients.state(target.ptyId) === 'running',
    });
    this.awaitingTurn.set(target.ptyId, list);
  }

  private settleAwaiting(ptyId: string, turnStarted: boolean): void {
    const list = this.awaitingTurn.get(ptyId);
    if (!list?.length) return;
    const state = this.deps.recipients.state(ptyId);
    const settled = list.filter(item => {
      if (state === 'running') item.ran = true;
      return turnStarted || (item.ran && state === 'ready');
    });
    if (!settled.length) return;
    const waiting = list.filter(item => !settled.includes(item));
    if (waiting.length) this.awaitingTurn.set(ptyId, waiting);
    else this.awaitingTurn.delete(ptyId);
    for (const { record } of settled)
      void this.update(record, {
        state: 'delivered',
        adapter: record.delivery.adapter,
      });
  }

  /** The recipient's one hold queue, made on first use. */
  private heldQueue(ptyId: string): HeldMessage[] {
    let queue = this.held.get(ptyId);
    if (!queue) {
      queue = [];
      this.held.set(ptyId, queue);
    }
    return queue;
  }

  /** Take one message out of its queue, and the queue away once empty. */
  private unhold(ptyId: string, message: HeldMessage): void {
    const queue = this.held.get(ptyId);
    if (!queue) return;
    const index = queue.indexOf(message);
    if (index >= 0) queue.splice(index, 1);
    if (!queue.length) this.held.delete(ptyId);
  }

  /** Type every held message its door now allows, in order. */
  private release(ptyId: string): void {
    if (!this.held.get(ptyId)?.length && !this.awaitingTurn.get(ptyId)?.length)
      return;
    void this.inOrder(ptyId, async () => {
      // Read at each step, never kept across an await: a send may add to
      // the queue while a message is being typed.
      for (;;) {
        const head = this.held.get(ptyId)?.[0];
        // Not logged yet: its send releases again once it is.
        if (!head || !head.logged) break;
        const state = this.deps.recipients.state(ptyId);
        if (state === 'ended') {
          this.unhold(ptyId, head);
          await this.update(head.record, {
            state: 'undeliverable',
            reason: `@${busHandle(head.target.name)} ended before it could read this`,
            adapter: head.transport.kind,
          });
          continue;
        }
        if ((head.transport.holdWhile as readonly string[]).includes(state))
          break;
        this.unhold(ptyId, head);
        const result = await this.deliver(
          head.transport,
          head.record,
          head.target,
          head.text
        );
        await this.update(head.record, result);
        this.awaitTurnIfQueued(head.transport, head.target, head.record);
      }
      if (this.deps.recipients.state(ptyId) === 'ended') {
        const orphaned = this.awaitingTurn.get(ptyId) ?? [];
        this.awaitingTurn.delete(ptyId);
        for (const { record } of orphaned)
          await this.update(record, {
            state: 'unknown',
            reason: 'The Session ended before its next turn started',
            adapter: record.delivery.adapter,
          });
      }
    });
  }
}
