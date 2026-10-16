import { describe, expect, it } from 'vitest';
import {
  busDeliveredText,
  busHandle,
  busStampLine,
  busThread,
  demoBusSendResult,
} from './envelope';
import {
  BUS_DELIVERY_STATES,
  BUS_OPERATOR_ID,
  isBusDeliveryState,
  type BusDeliveryState,
  type BusDirectoryEntry,
  type BusEndpoint,
  type BusMessageKind,
  type BusSender,
  type DeliveryEvent,
  type DeliveryResult,
  type MessageEnvelope,
  type MessageRecord,
  type MessagingTransport,
} from './types';
import type { BusStampLabels } from './envelope';

const labels: BusStampLabels = {
  senderHarness: 'Codex',
  projectName: 'exawatt',
};

function envelope(overrides: Partial<MessageEnvelope> = {}): MessageEnvelope {
  return {
    id: 'm-1',
    projectId: '/work/exawatt',
    from: {
      sessionId: 'session-a',
      name: 'Codex 2',
      harness: 'codex',
      kind: 'agent',
    },
    to: { sessionId: 'session-b', name: 'claude-1', harness: 'claude' },
    at: 1,
    text: '/help me review the diff',
    ...overrides,
  };
}

describe('the bus stamp', () => {
  it('opens with one line naming the real sender, its harness, the Project and the reply', () => {
    const text = busDeliveredText(envelope(), labels);
    const [first, blank, ...rest] = text.split('\n');
    expect(first).toBe(busStampLine(envelope(), labels));
    expect(first).toContain(`@${busHandle('Codex 2')}`);
    expect(first).toContain(labels.senderHarness);
    expect(first).toContain(labels.projectName);
    expect(first).toContain(`exawatt send @${busHandle('Codex 2')}`);
    expect(blank).toBe('');
    expect(rest.join('\n')).toBe(envelope().text);
  });

  it('offers the recipient’s own send tool first when it has one, the command still beside it', () => {
    const line = busStampLine(envelope(), {
      ...labels,
      replyTool: 'exawatt_send_message',
    });
    const handle = busHandle('Codex 2');
    expect(line.indexOf('exawatt_send_message')).toBeGreaterThan(-1);
    expect(line.indexOf('exawatt_send_message')).toBeLessThan(
      line.indexOf(`exawatt send @${handle}`)
    );
    expect(line).not.toContain('\n');
  });

  it('never lets an agent message begin with a slash', () => {
    for (const text of ['/help', '/clear everything', ' /x']) {
      expect(busDeliveredText(envelope({ text }), labels)).not.toMatch(
        /^\s*\//
      );
    }
  });

  it('types an operator message exactly as written', () => {
    const operator = envelope({
      from: {
        sessionId: BUS_OPERATOR_ID,
        name: 'operator',
        harness: BUS_OPERATOR_ID,
        kind: 'operator',
      },
      text: '/compact',
    });
    expect(busDeliveredText(operator, labels)).toBe('/compact');
  });

  it('folds any display name to a typeable handle', () => {
    expect(busHandle('Fix the Login bug!')).toBe('fix-the-login-bug');
    expect(busHandle('codex-2')).toBe('codex-2');
    expect(busHandle('Code_Reviewer')).toBe('code_reviewer');
    expect(busHandle('   ')).toBe('agent');
  });
});

describe('the bus vocabulary', () => {
  it('recognizes exactly the declared delivery states', () => {
    for (const state of BUS_DELIVERY_STATES)
      expect(isBusDeliveryState(state)).toBe(true);
    expect(isBusDeliveryState('sent')).toBe(false);
    expect(isBusDeliveryState(null)).toBe(false);
  });

  it('answers every Demo send as undeliverable, never as a delivery', () => {
    const result = demoBusSendResult();
    expect(result.record).toBeNull();
    expect(result.delivery.state).toBe('undeliverable');
    expect(result.delivery.reason).toBeTruthy();
  });

  it('reads one thread in both directions, oldest first', () => {
    const record = (id: string, from: string, to: string, at: number) =>
      ({
        ...envelope({ id, at }),
        from: { ...envelope().from, sessionId: from },
        to: { ...envelope().to, sessionId: to },
        delivery: { state: 'delivered', adapter: 'x', at },
        history: [{ state: 'delivered', adapter: 'x', at }],
      }) satisfies MessageRecord;
    const records = [
      record('3', 'b', 'a', 3),
      record('1', 'a', 'b', 1),
      record('2', 'a', 'c', 2),
    ];
    expect(busThread(records, 'a', 'b').map(r => r.id)).toEqual(['1', '3']);
  });
});

describe('the transport plugin contract', () => {
  /** A transport is any adapter with a declared kind and one `deliver`; the
   *  record a ledger keeps is built from what it answers and nothing else. */
  const fixtureTransport: MessagingTransport<BusEndpoint, { busy: boolean }> = {
    kind: 'fixture-door',
    async deliver(_envelope, target, context): Promise<DeliveryResult> {
      return context.busy
        ? {
            state: 'queued',
            reason: `${target.name} is mid-turn`,
            adapter: this.kind,
          }
        : { state: 'delivered', adapter: this.kind };
    },
  };

  it('records the adapter a transport declares and its reason', async () => {
    const message = envelope();
    const results = await Promise.all(
      [false, true].map(busy =>
        fixtureTransport.deliver(message, message.to, { busy })
      )
    );
    const history: DeliveryEvent[] = results.map((result, index) => ({
      ...result,
      at: index + 2,
    }));
    const record: MessageRecord = {
      ...message,
      delivery: history[history.length - 1],
      history,
    };
    const states: BusDeliveryState[] = record.history.map(event => event.state);
    expect(states).toEqual(['delivered', 'queued']);
    expect(record.delivery.adapter).toBe(fixtureTransport.kind);
    expect(record.delivery.reason).toContain(message.to.name);
  });

  it('lists a directory entry under the handle a sender types', () => {
    const sender: BusSender = { ...envelope().from };
    const kind: BusMessageKind = sender.kind;
    const entry: BusDirectoryEntry = {
      sessionId: sender.sessionId,
      name: sender.name,
      harness: sender.harness,
      projectId: '/work/exawatt',
      projectName: 'exawatt',
      handle: busHandle(sender.name),
      state: 'live',
    };
    expect(kind).toBe('agent');
    expect(busStampLine(envelope(), labels)).toContain(`@${entry.handle} `);
  });
});
