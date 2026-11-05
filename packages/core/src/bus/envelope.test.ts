import { describe, expect, it } from 'vitest';
import {
  busDeliveredText as deliveredTo,
  busDeliveryTo,
  busHandle,
  busRecipientList,
  busStampLine as stampTo,
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

/** The stamp and text as the first recipient reads them. */
const busStampLine = (message: MessageEnvelope, labels: BusStampLabels) =>
  stampTo(message, labels, 'session-b');
const busDeliveredText = (message: MessageEnvelope, labels: BusStampLabels) =>
  deliveredTo(message, labels, 'session-b');

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
    to: [{ sessionId: 'session-b', name: 'claude-1', harness: 'claude' }],
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

  it('says plainly that the command may be refused when the recipient’s sandbox blocks it and it has no tool', () => {
    const handle = busHandle('Codex 2');
    const line = busStampLine(envelope(), {
      ...labels,
      replyCommandSandboxed: true,
    });
    expect(line).toContain(`exawatt send @${handle}`);
    expect(line).toMatch(/sandbox may block/);
    expect(line).not.toContain('\n');
    // With the tool, the tool is the answer and no warning is needed.
    expect(
      busStampLine(envelope(), {
        ...labels,
        replyTool: 'exawatt_send_message',
        replyCommandSandboxed: true,
      })
    ).not.toMatch(/sandbox/);
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

  const operatorFrom: BusSender = {
    sessionId: BUS_OPERATOR_ID,
    name: 'operator',
    harness: BUS_OPERATOR_ID,
    kind: 'operator',
  };
  const together: BusEndpoint[] = [
    { sessionId: 'session-b', name: 'claude-4', harness: 'claude' },
    { sessionId: 'session-c', name: 'codex-4', harness: 'codex' },
  ];

  it('names every other recipient of a peer message, and only the others (BUG-329)', () => {
    const message = envelope({ to: together });
    const toClaude = stampTo(message, labels, 'session-b');
    const toCodex = stampTo(message, labels, 'session-c');
    expect(toClaude).toContain('to you and @codex-4');
    expect(toClaude).not.toContain('@claude-4');
    expect(toCodex).toContain('to you and @claude-4');
    expect(toCodex).not.toContain('@codex-4');
    expect(toClaude).not.toContain('\n');
    // one recipient: nobody else to name
    expect(busStampLine(envelope(), labels)).not.toContain('to you and');
  });

  it('tells each recipient of an operator message who else was asked and how to reach them (BUG-329)', () => {
    const message = envelope({
      from: operatorFrom,
      to: together,
      text: 'Take opposing views on the cache design and talk it through.',
    });
    const toCodex = deliveredTo(message, labels, 'session-c');
    const [first, blank, ...rest] = toCodex.split('\n');
    expect(first).toMatch(/^\[Exawatt\]/);
    expect(first).toContain('@claude-4');
    expect(first).toContain('exawatt send @claude-4');
    expect(first).not.toContain('@codex-4');
    expect(blank).toBe('');
    expect(rest.join('\n')).toBe(message.text);
    const three = envelope({
      from: operatorFrom,
      to: [
        ...together,
        { sessionId: 'session-d', name: 'gemini-1', harness: 'antigravity' },
      ],
      text: 'Compare notes.',
    });
    expect(deliveredTo(three, labels, 'session-b')).toContain(
      'exawatt send @codex-4,@gemini-1'
    );
  });

  it('keeps an operator command an exact command, whoever else received it', () => {
    const message = envelope({
      from: operatorFrom,
      to: together,
      text: '/compact',
    });
    expect(deliveredTo(message, labels, 'session-b')).toBe('/compact');
  });

  it('reads one `to` as each recipient once, in the order named', () => {
    expect(busRecipientList('@claude-4, @codex-4 @claude-4')).toEqual([
      '@claude-4',
      '@codex-4',
    ]);
    expect(busRecipientList('  ')).toEqual([]);
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
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBeTruthy();
  });

  it('reads one thread in both directions, oldest first', () => {
    const record = (id: string, from: string, to: string[], at: number) =>
      ({
        ...envelope({ id, at }),
        from: { ...envelope().from, sessionId: from },
        to: to.map(sessionId => ({ ...envelope().to[0], sessionId })),
        deliveries: to.map(sessionId => ({
          sessionId,
          delivery: { state: 'delivered', adapter: 'x', at },
          history: [{ state: 'delivered', adapter: 'x', at }],
        })),
      }) satisfies MessageRecord;
    const records = [
      record('3', 'b', ['a'], 3),
      record('1', 'a', ['b'], 1),
      record('2', 'a', ['c'], 2),
      record('4', 'a', ['c', 'b'], 4),
    ];
    expect(busThread(records, 'a', 'b').map(r => r.id)).toEqual([
      '1',
      '3',
      '4',
    ]);
    expect(busDeliveryTo(records[3], 'b')?.delivery.state).toBe('delivered');
    expect(busDeliveryTo(records[3], 'z')).toBeUndefined();
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
        fixtureTransport.deliver(message, message.to[0], { busy })
      )
    );
    const history: DeliveryEvent[] = results.map((result, index) => ({
      ...result,
      at: index + 2,
    }));
    const record: MessageRecord = {
      ...message,
      deliveries: [
        {
          sessionId: message.to[0].sessionId,
          delivery: history[history.length - 1],
          history,
        },
      ],
    };
    const [{ delivery, history: logged }] = record.deliveries;
    const states: BusDeliveryState[] = logged.map(event => event.state);
    expect(states).toEqual(['delivered', 'queued']);
    expect(delivery.adapter).toBe(fixtureTransport.kind);
    expect(delivery.reason).toContain(message.to[0].name);
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
