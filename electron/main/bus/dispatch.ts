/**
 * The bus core (ENG-029 C4, decision `0052`): address, stamp, log, deliver.
 *
 * Every send resolves its recipients in the sender's Project, stamps one
 * envelope naming all of them, logs it once, asks each recipient harness's
 * launch descriptor for its door (`messaging.agent` or `messaging.operator`)
 * and hands the message to each, recording each recipient's delivery. Each
 * recipient reads who else received it (BUG-329). Handing a message over
 * tells the turn truth who will have started the turn it opens (BUG-332).
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
  BUS_MAX_RECIPIENTS,
  busTurnInitiator,
  type AgentHarness,
  type BusDirectoryEntry,
  type BusSendResult,
  type BusSender,
  type DeliveryEvent,
  type DeliveryResult,
  type MessageEnvelope,
  type MessageRecord,
  type RecipientDelivery,
  type TurnInitiator,
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
}

/**
 * How one recipient Session can answer, as its own launch set it up: what
 * it received, never what its harness merely declares (the MCP server's
 * install or declaration can fail, and an older Session predates it).
 */
export interface BusReplyDoor {
  /** The launch handed the Agent Exawatt's MCP server: the send tool is in
   *  its own tool list. */
  tool: boolean;
  /** The Agent's own sandbox refuses the `exawatt` command's request. */
  commandSandboxed: boolean;
}

/** A Session whose launch recorded nothing: the command, without a tool. */
const NO_RECORDED_REPLY_DOOR: BusReplyDoor = {
  tool: false,
  commandSandboxed: false,
};

interface BusDispatchDeps {
  directory: BusDirectory;
  store: BusStore;
  recipients: RecipientStateSource;
  /** The recipient harness's declared doors. */
  doorsOf(harness: AgentHarness): BusDoors;
  /** How the recipient Session can answer, as its launch recorded it. */
  replyDoorOf(target: BusTarget): BusReplyDoor | undefined;
  /** What a transport is handed besides the text. */
  contextFor(target: BusTarget): Omit<BusDeliveryContext, 'text'>;
  /** A harness as the operator reads it (`Claude Code`, `Codex`). */
  harnessLabel(harness: AgentHarness | 'operator'): string;
  /** Called as a message is handed to a recipient's door: the turn it
   *  opens is this initiator's (the turn record's input), and `midTurn` is
   *  what it becomes if a turn is running. Returns the withdrawal the bus
   *  calls when the door did not deliver: a failed delivery opens no turn. */
  expectTurn?(
    ptyId: string,
    initiator: TurnInitiator,
    midTurn: 'joins' | 'next-turn'
  ): () => void;
  /** Every new record and every delivery change. */
  onRecord?(record: MessageRecord): void;
  now?: () => number;
}

export interface BusSendInput {
  from: BusSender;
  projectId: string;
  /** Every recipient: a durable Session id or `@handle` each. */
  to: readonly string[];
  text: string;
  /** The sender's own address, so a send to itself is refused. */
  senderSessionId?: string | null;
}

/** One recipient of a message being sent: where it goes and how. */
interface Recipient {
  target: BusTarget;
  handle: string;
  transport: BusTransport;
  /** Exactly what this recipient receives. */
  text: string;
}

interface HeldMessage {
  record: MessageRecord;
  recipient: Recipient;
  /** False until its message line is in the ledger: a message takes its
   *  place in the queue the moment it is accepted, so a send that logs
   *  sooner can never pass it, and nothing types it before it is logged. */
  logged: boolean;
}

/** A `queued` delivery waiting for its recipient's next turn. */
interface AwaitingTurn {
  record: MessageRecord;
  sessionId: string;
  ran: boolean;
}

function refused(
  reason: string,
  candidates?: BusDirectoryEntry[]
): BusSendResult {
  return { ok: false, reason, ...(candidates ? { candidates } : {}) };
}

/** One recipient's entry in a record. */
function entryOf(record: MessageRecord, sessionId: string): RecipientDelivery {
  const entry = record.deliveries.find(item => item.sessionId === sessionId);
  if (!entry)
    throw new Error(`${sessionId} is not a recipient of ${record.id}`);
  return entry;
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
  private awaitingTurn = new Map<string, AwaitingTurn[]>();
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
    if (!input.to.length) return refused('Say who the message is for');
    if (input.to.length > BUS_MAX_RECIPIENTS)
      return refused(
        `That message names ${input.to.length} recipients; the bus carries one to up to ${BUS_MAX_RECIPIENTS}`
      );
    // Every address resolves, or nothing is sent: a message never reaches
    // some of its recipients while naming one it could not reach.
    const addressees: BusAddressee[] = [];
    for (const to of input.to) {
      const resolution = this.deps.directory.resolve(
        input.projectId,
        to,
        input.senderSessionId ?? null
      );
      if (!resolution.ok)
        return refused(resolution.reason, resolution.candidates);
      if (
        !addressees.some(
          known =>
            known.entry.sessionId === resolution.addressee.entry.sessionId
        )
      )
        addressees.push(resolution.addressee);
    }
    const envelope = stampEnvelope({
      projectId: input.projectId,
      from: input.from,
      to: addressees.map(({ entry }) => ({
        sessionId: entry.sessionId,
        name: entry.name,
        harness: entry.harness,
      })),
      text,
      at: this.now(),
    });
    const senderHarness = this.deps.harnessLabel(input.from.harness);
    const recipients = addressees.map(addressee =>
      this.recipientOf(envelope, addressee, senderHarness)
    );

    // Held recipients take their place in their queues, and the rest their
    // place in their door's order, with no await in between: two concurrent
    // sends reach every shared recipient in the order they were accepted.
    const record: MessageRecord = { ...envelope, deliveries: [] };
    const held: HeldMessage[] = [];
    const handed: Promise<DeliveryResult>[] = [];
    for (const recipient of recipients) {
      const { target, transport } = recipient;
      const state = this.deps.recipients.state(target.ptyId);
      const mustHold =
        transport.holdWhile.length > 0 &&
        (!!this.held.get(target.ptyId)?.length ||
          (transport.holdWhile as readonly string[]).includes(state));
      if (mustHold) {
        const message: HeldMessage = { record, recipient, logged: false };
        this.heldQueue(target.ptyId).push(message);
        held.push(message);
        handed.push(
          Promise.resolve({
            state: 'queued',
            reason: holdReason(recipient.handle, state),
            adapter: transport.kind,
          })
        );
        continue;
      }
      // The state is read again once this message's turn in line comes: a
      // recipient that ended meanwhile is never handed to a door, which
      // could not tell (a queue to an ended thread is accepted and never
      // read).
      handed.push(
        this.inOrder(target.ptyId, () =>
          this.deps.recipients.state(target.ptyId) === 'ended'
            ? Promise.resolve<DeliveryResult>({
                state: 'undeliverable',
                reason: `@${recipient.handle} ended before it could read this`,
                adapter: transport.kind,
              })
            : this.deliver(record, recipient)
        )
      );
    }
    const results = await Promise.all(handed);
    record.deliveries = recipients.map((recipient, index) => {
      const event: DeliveryEvent = { ...results[index], at: this.now() };
      return {
        sessionId: recipient.target.sessionId,
        delivery: event,
        history: [event],
      };
    });

    try {
      await this.deps.store.append(record);
    } catch (error) {
      // A held message is never typed from outside the ledger; what waited
      // behind it may go now.
      for (const message of held) {
        this.unhold(message.recipient.target.ptyId, message);
        const entry = entryOf(record, message.recipient.target.sessionId);
        entry.delivery = {
          state: 'undeliverable',
          reason: `Exawatt could not log the message (${String(error)})`,
          adapter: 'bus',
          at: this.now(),
        };
        entry.history = [entry.delivery];
        this.release(message.recipient.target.ptyId);
      }
      if (held.length === recipients.length)
        return refused(`Exawatt could not log the message (${String(error)})`);
      console.error('[bus] a delivered message could not be logged', error);
    }
    for (const message of held) {
      if (!this.held.get(message.recipient.target.ptyId)?.includes(message))
        continue;
      message.logged = true;
    }
    for (const recipient of recipients)
      if (!held.some(message => message.recipient === recipient))
        this.awaitTurnIfQueued(recipient, record);
    this.deps.onRecord?.(this.copy(record));
    // A state may already allow a held message (a change raced this send).
    for (const message of held) this.release(message.recipient.target.ptyId);
    return { ok: true, record: this.copy(record) };
  }

  /** Where one addressee's copy goes, through which door, as what text. */
  private recipientOf(
    envelope: MessageEnvelope,
    addressee: BusAddressee,
    senderHarness: string
  ): Recipient {
    const target = targetOf(addressee);
    const doors = this.deps.doorsOf(target.harness);
    const kind = envelope.from.kind;
    const transport =
      (kind === 'operator' ? doors.operator : doors.agent) ??
      undeliverableTransport(
        `${this.deps.harnessLabel(target.harness)} takes no ${
          kind === 'operator' ? 'operator' : 'peer'
        } messages through Exawatt yet`
      );
    const reply = this.deps.replyDoorOf(target) ?? NO_RECORDED_REPLY_DOOR;
    return {
      target,
      handle: addressee.entry.handle,
      transport,
      text: deliveredText(
        envelope,
        senderHarness,
        addressee.entry.projectName,
        target.sessionId,
        {
          tool: reply.tool ? BUS_MCP_SEND_TOOL : null,
          commandSandboxed: reply.commandSandboxed,
        }
      ),
    };
  }

  private copy(record: MessageRecord): MessageRecord {
    return {
      ...record,
      to: record.to.map(endpoint => ({ ...endpoint })),
      deliveries: record.deliveries.map(entry => ({
        sessionId: entry.sessionId,
        delivery: { ...entry.delivery },
        history: entry.history.map(event => ({ ...event })),
      })),
    };
  }

  /** A transport that throws has failed to deliver; it never breaks a send. */
  private async deliver(
    envelope: MessageEnvelope,
    recipient: Recipient
  ): Promise<DeliveryResult> {
    const { transport, target, text } = recipient;
    // Before the door, never after: a door may open the turn as it delivers
    // (a terminal's Enter), and that turn is the sender's, not the operator's.
    const withdraw = this.deps.expectTurn?.(
      target.ptyId,
      busTurnInitiator(envelope.from),
      transport.midTurn ?? 'joins'
    );
    let result: DeliveryResult;
    try {
      result = await transport.deliver(envelope, target, {
        ...this.deps.contextFor(target),
        text,
      });
    } catch (error) {
      result = {
        state: 'unknown',
        reason: `The ${transport.kind} door failed: ${error instanceof Error ? error.message : String(error)}`,
        adapter: transport.kind,
      };
    }
    // A message that never arrived (or may not have) opens no turn: its
    // claim dies with it rather than waiting for some later, unrelated turn.
    if (result.state === 'undeliverable' || result.state === 'unknown')
      withdraw?.();
    return result;
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
    sessionId: string,
    result: DeliveryResult
  ): Promise<void> {
    const event: DeliveryEvent = { ...result, at: this.now() };
    const entry = entryOf(record, sessionId);
    entry.history.push(event);
    entry.delivery = event;
    try {
      await this.deps.store.appendDelivery(
        record.projectId,
        record.id,
        sessionId,
        event
      );
    } catch (error) {
      console.error('[bus] a delivery change could not be logged', error);
    }
    this.deps.onRecord?.(this.copy(record));
  }

  private awaitTurnIfQueued(recipient: Recipient, record: MessageRecord): void {
    const { transport, target } = recipient;
    if (
      !transport.queuedUntilTurnStart ||
      entryOf(record, target.sessionId).delivery.state !== 'queued'
    )
      return;
    const list = this.awaitingTurn.get(target.ptyId) ?? [];
    list.push({
      record,
      sessionId: target.sessionId,
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
    for (const { record, sessionId } of settled)
      void this.update(record, sessionId, {
        state: 'delivered',
        adapter: entryOf(record, sessionId).delivery.adapter,
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
        const { recipient, record } = head;
        const sessionId = recipient.target.sessionId;
        const state = this.deps.recipients.state(ptyId);
        if (state === 'ended') {
          this.unhold(ptyId, head);
          await this.update(record, sessionId, {
            state: 'undeliverable',
            reason: `@${recipient.handle} ended before it could read this`,
            adapter: recipient.transport.kind,
          });
          continue;
        }
        if (
          (recipient.transport.holdWhile as readonly string[]).includes(state)
        )
          break;
        this.unhold(ptyId, head);
        const result = await this.deliver(record, recipient);
        await this.update(record, sessionId, result);
        this.awaitTurnIfQueued(recipient, record);
      }
      if (this.deps.recipients.state(ptyId) === 'ended') {
        const orphaned = this.awaitingTurn.get(ptyId) ?? [];
        this.awaitingTurn.delete(ptyId);
        for (const { record, sessionId } of orphaned)
          await this.update(record, sessionId, {
            state: 'unknown',
            reason: 'The Session ended before its next turn started',
            adapter: entryOf(record, sessionId).delivery.adapter,
          });
      }
    });
  }
}
