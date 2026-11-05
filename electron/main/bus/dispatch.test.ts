import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AGENT_HARNESSES,
  BUS_OPERATOR_ID,
  type AgentHarness,
  type BusSendResult,
  type BusSender,
  type DeliveryEvent,
  type MessageRecord,
  type TurnInitiator,
} from '@exawatt/core';
import type { PtySessionRecord } from '@exawatt/core/desktop-bridge';
import { BusDirectory } from './directory';
import { BUS_MCP_SEND_TOOL } from './mcp-server';
import { BusDispatcher, type BusDoors, type BusReplyDoor } from './dispatch';
import { JsonlBusStore, type BusStore } from './ledger';
import type { RecipientStateSource } from './recipient-state';
import { BUS_MAX_TEXT_CHARS } from './stamping';
import type {
  BusTarget,
  BusTransport,
  RecipientState,
} from './transports/types';
import { terminalInputTransport } from './transports/terminal-input';
import { recordingTerminal } from './transports/fixtures.test-support';

// @scans electron/main/bus/*.ts

/**
 * The bus core against fixture doors: addressing, refusal, stamping, the
 * ledger, holding a message across a turn, and the settle a queue declares.
 */

const roots: string[] = [];
afterAll(() => {
  while (roots.length)
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function session(
  id: string,
  harness: PtySessionRecord['harness'],
  title: string,
  overrides: Partial<PtySessionRecord> = {}
): PtySessionRecord {
  return {
    id,
    durableSessionId: `session-${id}`,
    harness,
    title,
    projectDir: '/work/app',
    projectName: 'app',
    cwd: '/work/app',
    cols: 80,
    rows: 24,
    startedAt: 1,
    exited: false,
    exitCode: null,
    exitSignal: null,
    lastDataAt: 1,
    harnessSessionId: `thread-${id}`,
    ...overrides,
  } as PtySessionRecord;
}

/** Recipient states the test sets, announced like the real source does. */
function recipients(initial: Record<string, RecipientState> = {}) {
  const states = new Map(Object.entries(initial));
  const listeners = new Set<
    (id: string, change: 'state' | 'turn-start') => void
  >();
  const source: RecipientStateSource & {
    set(id: string, state: RecipientState): void;
    turnStart(id: string): void;
  } = {
    state: id => states.get(id) ?? 'ready',
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(id, state) {
      states.set(id, state);
      for (const listener of listeners) listener(id, 'state');
    },
    turnStart(id) {
      for (const listener of listeners) listener(id, 'turn-start');
    },
  };
  return source;
}

/** A door that records what it was handed and answers as told. */
function fixtureDoor(
  kind: string,
  answer: Partial<{ state: 'delivered' | 'queued'; reason: string }> = {},
  extra: Partial<BusTransport> = {}
) {
  const handed: { text: string; ptyId: string }[] = [];
  const transport: BusTransport = {
    kind,
    holdWhile: [],
    async deliver(_envelope, target, context) {
      handed.push({ text: context.text, ptyId: target.ptyId });
      return {
        state: answer.state ?? 'delivered',
        reason: answer.reason,
        adapter: kind,
      };
    },
    ...extra,
  };
  return { transport, handed };
}

function world(
  sessions: PtySessionRecord[],
  doors: Partial<Record<AgentHarness, BusDoors>>,
  states: Record<string, RecipientState> = {},
  wrapStore: (store: BusStore) => BusStore = store => store,
  replyDoorOf: (target: BusTarget) => BusReplyDoor | undefined = () => undefined
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-dispatch-'));
  roots.push(root);
  const store = new JsonlBusStore(root);
  const live = recipients(states);
  const terminal = recordingTerminal(true);
  const pushed: MessageRecord[] = [];
  /** What the turn truth was told, in order, with every door's hand-over:
   *  `expect <pty> <initiator>` and `door <pty>`. */
  const turns: string[] = [];
  let clock = 100;
  const dispatcher = new BusDispatcher({
    directory: new BusDirectory({ list: () => sessions }),
    store: wrapStore(store),
    recipients: live,
    doorsOf: harness => doors[harness] ?? { agent: null, operator: null },
    replyDoorOf,
    contextFor: () => ({
      terminal: terminal.door,
      runSourceCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      sourceEnvironment: async () => ({}),
    }),
    harnessLabel: harness =>
      harness === 'operator' ? 'the operator' : `${harness}-label`,
    expectTurn: (ptyId: string, initiator: TurnInitiator) =>
      turns.push(
        `expect ${ptyId} ${initiator.kind === 'agent' ? initiator.name : 'operator'}`
      ),
    onRecord: record => pushed.push(record),
    now: () => (clock += 1),
  });
  return { dispatcher, store, live, terminal, pushed, turns, root };
}

const codexSender: BusSender = {
  sessionId: 'session-pty-1',
  name: 'codex-2',
  harness: 'codex',
  kind: 'agent',
};
const operator: BusSender = {
  sessionId: BUS_OPERATOR_ID,
  name: 'operator',
  harness: BUS_OPERATOR_ID,
  kind: 'operator',
};

/** A send the bus logged. */
function recordOf(result: BusSendResult): MessageRecord {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.record;
}

/** The delivery of a send to one recipient. */
function deliveryOf(result: BusSendResult): DeliveryEvent {
  return recordOf(result).deliveries[0].delivery;
}

/** A send the bus refused before logging anything. */
function refusalOf(result: BusSendResult) {
  if (result.ok) throw new Error('expected a refusal, the send was logged');
  return result;
}

const sessions = [
  session('pty-1', 'codex', 'codex-2'),
  session('pty-2', 'claude', 'claude-1'),
];

describe('addressing and refusal', () => {
  const claudeDoor = fixtureDoor('claude-socket');
  const { dispatcher, store, pushed } = world(
    [
      ...sessions,
      session('pty-3', 'claude', 'reviewer'),
      session('pty-4', 'claude', 'reviewer'),
      session('pty-5', 'claude', 'gone', { exited: true }),
      session('pty-6', 'claude', 'elsewhere', {
        projectDir: '/work/other',
        projectName: 'other',
      }),
      session('pty-7', 'shell', 'zsh'),
    ],
    { claude: { agent: claudeDoor.transport, operator: null } }
  );
  const send = (to: string, text = 'hi') =>
    dispatcher.send({
      from: codexSender,
      projectId: '/work/app',
      to: [to],
      text,
      senderSessionId: codexSender.sessionId,
    });

  it.each([
    ['an unknown name', '@nobody', /No Agent named @nobody/],
    [
      'a recipient in another Project',
      '@elsewhere',
      /in another Project; messages stay within a Project/,
    ],
    ['an ended Session', '@gone', /has ended/],
    ['the sender itself', '@codex-2', /That is you/],
    ['a shell tab', '@zsh', /No Agent named @zsh/],
  ])('refuses %s at the sender, logging nothing', async (_case, to, reason) => {
    expect(refusalOf(await send(to)).reason).toMatch(reason);
  });

  it('refuses an ambiguous name and lists the Sessions it could mean', async () => {
    const result = refusalOf(await send('@reviewer'));
    expect(result.candidates?.map(entry => entry.sessionId).sort()).toEqual([
      'session-pty-3',
      'session-pty-4',
    ]);
    // The candidate's id then addresses it exactly.
    const exact = await send('session-pty-3');
    expect(recordOf(exact).to.map(endpoint => endpoint.sessionId)).toEqual([
      'session-pty-3',
    ]);
  });

  it('refuses empty and oversized text', async () => {
    expect(refusalOf(await send('@claude-1', ' \u0007\n ')).reason).toMatch(
      /Nothing to send/
    );
    expect(
      refusalOf(await send('@claude-1', 'x'.repeat(BUS_MAX_TEXT_CHARS + 1)))
        .reason
    ).toMatch(/carries up to/);
  });

  it('logged and pushed nothing for any refusal', async () => {
    const read = await store.read('/work/app');
    expect(
      read.ok &&
        read.records.every(record => record.to[0].sessionId === 'session-pty-3')
    ).toBe(true);
    expect(
      pushed.every(record => record.to[0].sessionId === 'session-pty-3')
    ).toBe(true);
  });
});

describe('a peer message', () => {
  it('reaches the recipient’s agent door stamped with the real sender, and is logged with its result', async () => {
    const door = fixtureDoor('claude-socket');
    const { dispatcher, store, pushed } = world(sessions, {
      claude: { agent: door.transport, operator: null },
    });
    const result = await dispatcher.send({
      from: codexSender,
      projectId: '/work/app',
      to: ['@claude-1'],
      text: '/help\u0003 review the diff\r\nplease',
    });
    expect(deliveryOf(result)).toMatchObject({
      state: 'delivered',
      adapter: 'claude-socket',
    });
    const [first, blank, ...body] = door.handed[0].text.split('\n');
    expect(first).toMatch(
      /^\[Exawatt\] Message from @codex-2 \(codex-label\) in Project app\. /
    );
    expect(blank).toBe('');
    // Control characters never reach a door; line breaks are text.
    expect(body.join('\n')).toBe('/help review the diff\nplease');
    const read = await store.read('/work/app');
    expect(read).toEqual({ ok: true, records: [recordOf(result)] });
    expect(recordOf(result).from).toEqual(codexSender);
    expect(pushed).toEqual([recordOf(result)]);
  });

  it('addresses an Agent by its own name, or by its harness when it is the only one', async () => {
    const door = fixtureDoor('claude-socket');
    const { dispatcher } = world(
      [
        session('pty-1', 'codex', 'Codex', { agentName: 'codex-2' }),
        session('pty-2', 'claude', 'Fix the login bug', {
          agentName: 'claude-1',
        }),
      ],
      { claude: { agent: door.transport, operator: null } }
    );
    for (const to of ['@claude-1', 'CLAUDE-1', '@claude']) {
      const result = await dispatcher.send({
        from: codexSender,
        projectId: '/work/app',
        to: [to],
        text: 'hi',
      });
      expect(recordOf(result).to).toEqual([
        {
          sessionId: 'session-pty-2',
          name: 'claude-1',
          harness: 'claude',
        },
      ]);
    }
    expect(door.handed[0].text.split('\n')[0]).toContain('@codex-2');
  });

  it('reads undeliverable, named, for a harness that declares no door', async () => {
    const { dispatcher } = world(sessions, {});
    const result = await dispatcher.send({
      from: codexSender,
      projectId: '/work/app',
      to: ['@claude-1'],
      text: 'hi',
    });
    expect(deliveryOf(result).state).toBe('undeliverable');
    expect(deliveryOf(result).reason).toMatch(
      /claude-label takes no peer messages/
    );
  });

  it('reads undeliverable, never handing it to the door, when the recipient ended while it waited its turn in line', async () => {
    let finishFirst!: () => void;
    const handed: string[] = [];
    const slow: BusTransport = {
      kind: 'claude-socket',
      holdWhile: [],
      async deliver(_envelope, _target, context) {
        handed.push(context.text);
        if (handed.length === 1)
          await new Promise<void>(resolve => (finishFirst = resolve));
        return { state: 'delivered', adapter: 'claude-socket' };
      },
    };
    const { dispatcher, live } = world(sessions, {
      claude: { agent: slow, operator: null },
    });
    const send = (text: string) =>
      dispatcher.send({
        from: codexSender,
        projectId: '/work/app',
        to: ['@claude-1'],
        text,
        senderSessionId: codexSender.sessionId,
      });
    const first = send('first');
    await expect.poll(() => handed.length).toBe(1);
    const second = send('second');
    live.set('pty-2', 'ended');
    finishFirst();
    expect(deliveryOf(await first).state).toBe('delivered');
    const result = await second;
    expect(deliveryOf(result)).toMatchObject({
      state: 'undeliverable',
      reason: expect.stringMatching(
        /@claude-1 ended before it could read this/
      ),
      adapter: 'claude-socket',
    });
    expect(handed).toHaveLength(1);
  });

  it('reads unknown when a door throws, and the send still answers', async () => {
    const { dispatcher } = world(sessions, {
      claude: {
        agent: {
          kind: 'broken',
          holdWhile: [],
          deliver: async () => {
            throw new Error('boom');
          },
        },
        operator: null,
      },
    });
    const result = await dispatcher.send({
      from: codexSender,
      projectId: '/work/app',
      to: ['@claude-1'],
      text: 'hi',
    });
    expect(deliveryOf(result).state).toBe('unknown');
    expect(deliveryOf(result).reason).toMatch(/boom/);
  });

  it('moves a queue’s `queued` to delivered when the recipient’s next turn starts', async () => {
    const door = fixtureDoor(
      'codex-queue',
      { state: 'queued', reason: 'next turn' },
      { queuedUntilTurnStart: true }
    );
    const { dispatcher, live, pushed, store } = world(
      [
        session('pty-1', 'claude', 'claude-1'),
        session('pty-2', 'codex', 'codex-2'),
      ],
      { codex: { agent: door.transport, operator: null } }
    );
    const result = await dispatcher.send({
      from: {
        ...codexSender,
        sessionId: 'session-pty-1',
        name: 'claude-1',
        harness: 'claude',
      },
      projectId: '/work/app',
      to: ['@codex-2'],
      text: 'hi',
    });
    expect(deliveryOf(result).state).toBe('queued');
    live.turnStart('pty-2');
    await expect
      .poll(() => pushed.at(-1)?.deliveries[0].delivery.state)
      .toBe('delivered');
    const read = await store.read('/work/app');
    expect(
      read.ok && read.records[0].deliveries[0].history.map(event => event.state)
    ).toEqual(['queued', 'delivered']);
  });
});

describe('an operator message (the user’s turn)', () => {
  const operatorDoor = terminalInputTransport({
    delivered: 'delivered',
    holdWhile: ['starting', 'running', 'blocked'],
  });

  it('is held while the recipient’s turn runs and typed when it ends: queued, then delivered', async () => {
    const { dispatcher, live, terminal, store, pushed } = world(
      sessions,
      { claude: { agent: null, operator: operatorDoor } },
      { 'pty-2': 'running' }
    );
    const result = await dispatcher.send({
      from: operator,
      projectId: '/work/app',
      to: ['session-pty-2'],
      text: '/compact',
    });
    expect(deliveryOf(result).state).toBe('queued');
    expect(deliveryOf(result).reason).toMatch(/turn to end/);
    expect(terminal.writes).toEqual([]);

    live.set('pty-2', 'running');
    expect(terminal.writes).toEqual([]);
    live.set('pty-2', 'ready');
    await expect
      .poll(() => pushed.at(-1)?.deliveries[0].delivery.state)
      .toBe('delivered');
    // Typed as written, no stamp: it is the operator's own turn.
    expect(terminal.writes).toEqual(['\x1b[200~/compact\x1b[201~', '\r']);
    const read = await store.read('/work/app');
    expect(
      read.ok && read.records[0].deliveries[0].history.map(event => event.state)
    ).toEqual(['queued', 'delivered']);
    expect(read.ok && read.records[0].from).toEqual(operator);
  });

  it('is never typed into an open question', async () => {
    const { dispatcher, live, terminal, pushed } = world(
      sessions,
      { claude: { agent: null, operator: operatorDoor } },
      { 'pty-2': 'blocked' }
    );
    const result = await dispatcher.send({
      from: operator,
      projectId: '/work/app',
      to: ['session-pty-2'],
      text: 'yes',
    });
    expect(deliveryOf(result).reason).toMatch(/open question/);
    live.set('pty-2', 'running');
    expect(terminal.writes).toEqual([]);
    live.set('pty-2', 'ready');
    await expect
      .poll(() => pushed.at(-1)?.deliveries[0].delivery.state)
      .toBe('delivered');
  });

  it('keeps two held messages in order', async () => {
    const { dispatcher, live, terminal, pushed } = world(
      sessions,
      { claude: { agent: null, operator: operatorDoor } },
      { 'pty-2': 'running' }
    );
    await dispatcher.send({
      from: operator,
      projectId: '/work/app',
      to: ['session-pty-2'],
      text: 'first',
    });
    await dispatcher.send({
      from: operator,
      projectId: '/work/app',
      to: ['session-pty-2'],
      text: 'second',
    });
    live.set('pty-2', 'ready');
    await expect
      .poll(
        () =>
          pushed.filter(
            record => record.deliveries[0].delivery.state === 'delivered'
          ).length
      )
      .toBe(2);
    expect(terminal.writes.filter(write => write !== '\r')).toEqual([
      '\x1b[200~first\x1b[201~',
      '\x1b[200~second\x1b[201~',
    ]);
  });

  it('delivers two concurrent sends to a busy recipient, both, in order, at turn end', async () => {
    const { dispatcher, live, terminal, pushed, store } = world(
      sessions,
      { claude: { agent: null, operator: operatorDoor } },
      { 'pty-2': 'running' }
    );
    const send = (text: string) =>
      dispatcher.send({
        from: operator,
        projectId: '/work/app',
        to: ['session-pty-2'],
        text,
      });
    const results = await Promise.all([send('first'), send('second')]);
    expect(results.map(result => deliveryOf(result).state)).toEqual([
      'queued',
      'queued',
    ]);
    live.set('pty-2', 'ready');
    await expect
      .poll(
        () =>
          pushed.filter(
            record => record.deliveries[0].delivery.state === 'delivered'
          ).length
      )
      .toBe(2);
    expect(terminal.writes.filter(write => write !== '\r')).toEqual([
      '\x1b[200~first\x1b[201~',
      '\x1b[200~second\x1b[201~',
    ]);
    const read = await store.read('/work/app');
    expect(
      read.ok && read.records.map(record => record.deliveries[0].delivery.state)
    ).toEqual(['delivered', 'delivered']);
  });

  it('refuses a held message its log write failed, and still delivers the one behind it', async () => {
    let failNext = true;
    const { dispatcher, live, terminal, pushed } = world(
      sessions,
      { claude: { agent: null, operator: operatorDoor } },
      { 'pty-2': 'running' },
      store => ({
        append: async record => {
          if (failNext) {
            failNext = false;
            // Slow, then fails: the second send is accepted meanwhile.
            await new Promise(resolve => setTimeout(resolve, 20));
            throw new Error('disk full');
          }
          return store.append(record);
        },
        appendDelivery: (...args) => store.appendDelivery(...args),
        read: projectId => store.read(projectId),
      })
    );
    const send = (text: string) =>
      dispatcher.send({
        from: operator,
        projectId: '/work/app',
        to: ['session-pty-2'],
        text,
      });
    const [first, second] = await Promise.all([send('first'), send('second')]);
    expect(refusalOf(first).reason).toMatch(/could not log/);
    expect(deliveryOf(second).state).toBe('queued');
    live.set('pty-2', 'ready');
    await expect
      .poll(() => pushed.at(-1)?.deliveries[0].delivery.state)
      .toBe('delivered');
    expect(terminal.writes).toEqual(['\x1b[200~second\x1b[201~', '\r']);
  });

  it('reads undeliverable when the recipient ends before its turn does', async () => {
    const { dispatcher, live, terminal, pushed } = world(
      sessions,
      { claude: { agent: null, operator: operatorDoor } },
      { 'pty-2': 'running' }
    );
    await dispatcher.send({
      from: operator,
      projectId: '/work/app',
      to: ['session-pty-2'],
      text: 'hi',
    });
    live.set('pty-2', 'ended');
    await expect
      .poll(() => pushed.at(-1)?.deliveries[0].delivery.state)
      .toBe('undeliverable');
    expect(terminal.writes).toEqual([]);
  });

  it('waits for a just-launched program to draw its input', async () => {
    const { dispatcher, live, terminal, pushed } = world(
      sessions,
      { claude: { agent: null, operator: operatorDoor } },
      { 'pty-2': 'starting' }
    );
    const result = await dispatcher.send({
      from: operator,
      projectId: '/work/app',
      to: ['session-pty-2'],
      text: 'go',
    });
    expect(deliveryOf(result).reason).toMatch(/finish starting/);
    expect(terminal.writes).toEqual([]);
    live.set('pty-2', 'ready');
    await expect
      .poll(() => pushed.at(-1)?.deliveries[0].delivery.state)
      .toBe('delivered');
  });

  it('is typed at once into a recipient that is ready', async () => {
    const { dispatcher, terminal } = world(sessions, {
      claude: { agent: null, operator: operatorDoor },
    });
    const result = await dispatcher.send({
      from: operator,
      projectId: '/work/app',
      to: ['session-pty-2'],
      text: 'go',
    });
    expect(deliveryOf(result).state).toBe('delivered');
    expect(terminal.writes).toEqual(['\x1b[200~go\x1b[201~', '\r']);
  });
});

describe('a message to several recipients (BUG-329)', () => {
  const trio = [
    session('pty-1', 'codex', 'codex-4'),
    session('pty-2', 'claude', 'claude-4'),
    session('pty-3', 'antigravity', 'gemini-1'),
  ];

  it('is one message, logged once, delivered to each through its own door, each told who else received it', async () => {
    const claude = fixtureDoor('claude-socket');
    const codex = fixtureDoor(
      'codex-queue',
      { state: 'queued', reason: 'next turn' },
      { queuedUntilTurnStart: true }
    );
    const { dispatcher, store, pushed, live, root } = world(trio, {
      claude: { agent: null, operator: claude.transport },
      codex: { agent: null, operator: codex.transport },
    });
    const result = await dispatcher.send({
      from: operator,
      projectId: '/work/app',
      to: ['@claude-4', '@codex-4'],
      text: 'Take opposing views on the cache design and talk it through.',
    });
    const record = recordOf(result);
    expect(record.to.map(endpoint => endpoint.sessionId)).toEqual([
      'session-pty-2',
      'session-pty-1',
    ]);
    expect(
      record.deliveries.map(entry => [entry.sessionId, entry.delivery.state])
    ).toEqual([
      ['session-pty-2', 'delivered'],
      ['session-pty-1', 'queued'],
    ]);
    // each recipient reads the other by address, never itself
    const toClaude = claude.handed[0].text.split('\n')[0];
    const toCodex = codex.handed[0].text.split('\n')[0];
    expect(toClaude).toContain('@codex-4');
    expect(toClaude).not.toContain('@claude-4');
    expect(toCodex).toContain('@claude-4');
    expect(toCodex).not.toContain('@codex-4');
    // one message line in the ledger, not one per recipient
    const ledger = fs
      .readdirSync(root)
      .filter(name => name.endsWith('.jsonl'))
      .map(name => fs.readFileSync(path.join(root, name), 'utf8'))
      .join('');
    expect(ledger.match(/"type":"message"/g)).toHaveLength(1);
    expect(pushed).toHaveLength(1);
    // one recipient's delivery moves on its own
    live.turnStart('pty-1');
    await expect
      .poll(() => pushed.at(-1)?.deliveries.map(entry => entry.delivery.state))
      .toEqual(['delivered', 'delivered']);
    const read = await store.read('/work/app');
    expect(
      read.ok &&
        read.records[0].deliveries.map(entry =>
          entry.history.map(event => event.state)
        )
    ).toEqual([['delivered'], ['queued', 'delivered']]);
  });

  it('holds one recipient while typing to the other, and logs the held delivery when it lands', async () => {
    const door = terminalInputTransport({
      delivered: 'delivered',
      holdWhile: ['starting', 'running', 'blocked'],
    });
    const { dispatcher, live, terminal, pushed, store } = world(
      trio,
      {
        claude: { agent: null, operator: door },
        codex: { agent: null, operator: door },
      },
      { 'pty-1': 'running' }
    );
    const record = recordOf(
      await dispatcher.send({
        from: operator,
        projectId: '/work/app',
        to: ['@claude-4', '@codex-4'],
        text: 'Compare notes.',
      })
    );
    expect(record.deliveries.map(entry => entry.delivery.state)).toEqual([
      'delivered',
      'queued',
    ]);
    expect(terminal.writes).toHaveLength(2);
    live.set('pty-1', 'ready');
    await expect
      .poll(() => pushed.at(-1)?.deliveries[1].delivery.state)
      .toBe('delivered');
    expect(terminal.writes).toHaveLength(4);
    const read = await store.read('/work/app');
    expect(
      read.ok && read.records[0].deliveries.map(entry => entry.delivery.state)
    ).toEqual(['delivered', 'delivered']);
  });

  it('is refused whole, nothing logged and nothing handed over, when one address does not resolve', async () => {
    const claude = fixtureDoor('claude-socket');
    const { dispatcher, store, pushed } = world(trio, {
      claude: { agent: claude.transport, operator: null },
    });
    const result = await dispatcher.send({
      from: codexSender,
      projectId: '/work/app',
      to: ['@claude-4', '@nobody'],
      text: 'hi',
      senderSessionId: 'session-pty-1',
    });
    expect(refusalOf(result).reason).toMatch(/@nobody/);
    expect(claude.handed).toEqual([]);
    expect(pushed).toEqual([]);
    expect(await store.read('/work/app')).toEqual({ ok: true, records: [] });
  });

  it('names a recipient once, however many ways the sender named it', async () => {
    const claude = fixtureDoor('claude-socket');
    const { dispatcher } = world(trio, {
      claude: { agent: claude.transport, operator: null },
    });
    const record = recordOf(
      await dispatcher.send({
        from: codexSender,
        projectId: '/work/app',
        to: ['@claude-4', 'session-pty-2', '@claude'],
        text: 'hi',
        senderSessionId: 'session-pty-1',
      })
    );
    expect(record.to).toHaveLength(1);
    expect(claude.handed).toHaveLength(1);
    expect(claude.handed[0].text.split('\n')[0]).not.toContain('to you and');
  });
});

describe('who starts the turn a message opens (BUG-332)', () => {
  it('tells the turn truth, before the door, that a peer’s note opens the peer’s turn and an operator message the operator’s', async () => {
    // the doors write into the same log the turn truth is told in
    let log: string[] = [];
    const recordingDoor = (kind: string): BusTransport => ({
      kind,
      holdWhile: [],
      async deliver(_envelope, target) {
        log.push(`door ${target.ptyId}`);
        return { state: 'delivered', adapter: kind };
      },
    });
    const built = world(sessions, {
      claude: {
        agent: recordingDoor('claude-socket'),
        operator: recordingDoor('terminal-input'),
      },
    });
    log = built.turns;
    await built.dispatcher.send({
      from: codexSender,
      projectId: '/work/app',
      to: ['@claude-1'],
      text: 'review this',
      senderSessionId: codexSender.sessionId,
    });
    await built.dispatcher.send({
      from: operator,
      projectId: '/work/app',
      to: ['@claude-1'],
      text: 'go on',
    });
    expect(log).toEqual([
      'expect pty-2 codex-2',
      'door pty-2',
      'expect pty-2 operator',
      'door pty-2',
    ]);
  });

  it('says nothing of a turn when nothing is handed over', async () => {
    const { dispatcher, turns, live, pushed } = world(
      sessions,
      {
        claude: {
          agent: null,
          operator: terminalInputTransport({
            delivered: 'delivered',
            holdWhile: ['running'],
          }),
        },
      },
      { 'pty-2': 'running' }
    );
    await dispatcher.send({
      from: operator,
      projectId: '/work/app',
      to: ['@claude-1'],
      text: 'later',
    });
    expect(turns).toEqual([]);
    live.set('pty-2', 'ended');
    await expect
      .poll(() => pushed.at(-1)?.deliveries[0].delivery.state)
      .toBe('undeliverable');
    expect(turns).toEqual([]);
  });
});

describe('the reply hint', () => {
  const claudeSender: BusSender = {
    ...codexSender,
    sessionId: 'session-pty-2',
    name: 'claude-1',
    harness: 'claude',
  };

  it('comes from what the recipient’s own launch received, not what its harness declares', async () => {
    const claude = fixtureDoor('claude-socket');
    const codex = fixtureDoor('codex-queue');
    const replyDoors: Record<string, BusReplyDoor> = {
      // Its launch received the MCP server.
      'pty-2': { tool: true, commandSandboxed: false },
      // Its harness declares an MCP binding, but this launch went without.
      'pty-1': { tool: false, commandSandboxed: false },
    };
    const { dispatcher } = world(
      sessions,
      {
        claude: { agent: claude.transport, operator: null },
        codex: { agent: codex.transport, operator: null },
      },
      {},
      undefined,
      target => replyDoors[target.ptyId]
    );
    await dispatcher.send({
      from: codexSender,
      projectId: '/work/app',
      to: ['@claude-1'],
      text: 'one',
      senderSessionId: codexSender.sessionId,
    });
    await dispatcher.send({
      from: claudeSender,
      projectId: '/work/app',
      to: ['@codex-2'],
      text: 'two',
      senderSessionId: 'session-pty-2',
    });
    expect(claude.handed[0].text.split('\n')[0]).toContain(BUS_MCP_SEND_TOOL);
    const withoutTool = codex.handed[0].text.split('\n')[0];
    expect(withoutTool).not.toContain(BUS_MCP_SEND_TOOL);
    expect(withoutTool).toContain('exawatt send @claude-1');
    expect(withoutTool).not.toMatch(/sandbox/);
  });

  it('warns a recipient whose sandbox refuses the command and that has no tool', async () => {
    const codex = fixtureDoor('codex-queue');
    const { dispatcher } = world(
      sessions,
      { codex: { agent: codex.transport, operator: null } },
      {},
      undefined,
      () => ({ tool: false, commandSandboxed: true })
    );
    await dispatcher.send({
      from: claudeSender,
      projectId: '/work/app',
      to: ['@codex-2'],
      text: 'two',
      senderSessionId: 'session-pty-2',
    });
    expect(codex.handed[0].text.split('\n')[0]).toMatch(
      /exawatt send @claude-1.*sandbox may block/
    );
  });
});

describe('the plugin boundary', () => {
  it('never names a harness in the bus core: doors come only from the descriptor', () => {
    const core = fs
      .readdirSync(__dirname)
      .filter(name => name.endsWith('.ts') && !name.includes('.test'))
      .map(
        name =>
          [name, fs.readFileSync(path.join(__dirname, name), 'utf8')] as const
      );
    for (const [name, source] of core) {
      for (const harness of AGENT_HARNESSES) {
        expect({
          name,
          harness,
          named: new RegExp(`['"\`]${harness}['"\`]`).test(source),
        }).toEqual({
          name,
          harness,
          named: false,
        });
      }
    }
  });
});
