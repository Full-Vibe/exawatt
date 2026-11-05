import { describe, expect, it } from 'vitest';
import type { BusSendResult, MessageRecord } from '@exawatt/core';
import type { PtySessionRecord } from '@exawatt/core/desktop-bridge';
import { BusDirectory } from './directory';
import { createBusHttpHandler } from './http';
import type { BusSendInput } from './dispatch';

function session(
  id: string,
  title: string,
  overrides: Partial<PtySessionRecord> = {}
) {
  return {
    id,
    durableSessionId: `session-${id}`,
    harness: 'claude',
    title,
    projectDir: '/work/app',
    projectName: 'app',
    cwd: '/work/app',
    exited: false,
    ...overrides,
  } as PtySessionRecord;
}

/** What the bus answers a send: by default each named recipient reached,
 *  `states` overriding one recipient's delivery. */
function delivered(
  input: BusSendInput,
  states: Record<string, 'delivered' | 'queued' | 'undeliverable'> = {}
): BusSendResult {
  const to = input.to.map(handle => ({
    sessionId: `session-${handle}`,
    name: handle.replace(/^@/, ''),
    harness: 'codex' as const,
  }));
  return {
    ok: true,
    record: {
      id: 'm-1',
      projectId: input.projectId,
      from: input.from,
      to,
      at: 1,
      text: input.text,
      deliveries: to.map((endpoint, index) => {
        const state = states[input.to[index]] ?? 'delivered';
        const event = {
          state,
          adapter: 'claude-socket',
          at: 1,
          ...(state === 'delivered' ? {} : { reason: 'its turn is running' }),
        };
        return {
          sessionId: endpoint.sessionId,
          delivery: event,
          history: [event],
        };
      }),
    },
  };
}

function handler(
  answer: (input: BusSendInput) => BusSendResult = input => delivered(input),
  records: MessageRecord[] = []
) {
  const sends: BusSendInput[] = [];
  const directory = new BusDirectory({
    list: () => [
      session('pty-1', 'claude-1'),
      session('pty-2', 'codex-2', { harness: 'codex' }),
      session('pty-3', 'other', {
        projectDir: '/work/other',
        projectName: 'other',
      }),
      session('pty-4', 'gone', { exited: true }),
    ],
  });
  const handle = createBusHttpHandler({
    directory,
    dispatcher: {
      send: async input => {
        sends.push(input);
        return answer(input);
      },
    },
    store: { read: async () => ({ ok: true, records }) },
    harnessLabel: harness => `${harness}-label`,
  });
  return { handle, sends };
}

describe('the bus HTTP verbs', () => {
  it('lists the other Agents in my Project, and who I am', async () => {
    const { handle } = handler();
    const answer = await handle('pty-1', 'agents', '');
    expect(answer.status).toBe(200);
    expect(answer.text).toContain('You are @claude-1 in Project app');
    expect(answer.text).toContain('@codex-2  codex-label  live');
    expect(answer.text).not.toContain('@other');
    expect(answer.text).not.toMatch(/^  @claude-1/m);
  });

  it('sends as the token’s Session, recipient on the first line, never as anyone it claims', async () => {
    const { handle, sends } = handler();
    const answer = await handle(
      'pty-1',
      'send',
      '@codex-2\nline one\nline two'
    );
    expect(answer).toEqual({
      status: 200,
      text: 'Sent to @codex-2: delivered.',
    });
    expect(sends).toEqual([
      {
        from: {
          sessionId: 'session-pty-1',
          name: 'claude-1',
          harness: 'claude',
          kind: 'agent',
        },
        projectId: '/work/app',
        to: ['@codex-2'],
        text: 'line one\nline two',
        senderSessionId: 'session-pty-1',
      },
    ]);
  });

  it('answers a refusal as a failure the command exits non-zero on, with the candidates', async () => {
    const { handle } = handler(() => ({
      ok: false,
      reason: '@reviewer could mean 2 Agents',
      candidates: [
        {
          sessionId: 'session-x',
          name: 'reviewer',
          harness: 'claude',
          projectId: '/work/app',
          projectName: 'app',
          handle: 'reviewer',
          state: 'live',
        },
      ],
    }));
    const answer = await handle('pty-1', 'send', '@reviewer\nhi');
    expect(answer.status).toBe(409);
    expect(answer.text).toContain('Not sent: @reviewer could mean 2 Agents.');
    expect(answer.text).toContain('session-x');
  });

  it('sends one message to every recipient the first line names, answering for each', async () => {
    const { handle, sends } = handler(input =>
      delivered(input, { '@gemini-1': 'queued' })
    );
    const answer = await handle(
      'pty-1',
      'send',
      '@codex-2, @gemini-1 @codex-2\ncompare notes'
    );
    expect(sends.map(input => input.to)).toEqual([['@codex-2', '@gemini-1']]);
    expect(answer.status).toBe(200);
    expect(answer.text.split('\n')).toEqual([
      'Sent to @codex-2: delivered.',
      'Sent to @gemini-1: queued: its turn is running.',
    ]);
  });

  it('shows my inbox and only my inbox, naming who else each message reached', async () => {
    const mine = {
      from: { name: 'codex-2', harness: 'codex', kind: 'agent' },
      to: [{ sessionId: 'session-pty-1', name: 'claude-1' }],
      at: 0,
      text: 'for you',
    } as MessageRecord;
    const shared = {
      ...mine,
      to: [
        { sessionId: 'session-pty-3', name: 'gemini-1' },
        { sessionId: 'session-pty-1', name: 'claude-1' },
      ],
      text: 'for you both',
    } as MessageRecord;
    const theirs = {
      ...mine,
      to: [{ sessionId: 'session-pty-2', name: 'codex-2' }],
      text: 'not yours',
    } as MessageRecord;
    const { handle } = handler(undefined, [mine, shared, theirs]);
    const answer = await handle('pty-1', 'inbox', '');
    expect(answer.text).toContain('from @codex-2 (codex-label):\nfor you');
    expect(answer.text).toContain(
      'from @codex-2 (codex-label), also to @gemini-1:\nfor you both'
    );
    expect(answer.text).not.toContain('not yours');
  });

  it('refuses a Session that has ended, and an unknown verb with the usage', async () => {
    const { handle } = handler();
    expect((await handle('pty-4', 'agents', '')).status).toBe(403);
    const unknown = await handle('pty-1', 'shout', '');
    expect(unknown.status).toBe(404);
    expect(unknown.text).toContain('exawatt send @name');
  });
});
