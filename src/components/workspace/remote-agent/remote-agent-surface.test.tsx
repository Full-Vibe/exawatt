/**
 * The connected coworker's front door, rendered (ENG-033 H2).
 *
 * Every fixture value here is invented. No hostname, address, user, server
 * name, or key path in this file belongs to anyone's real infrastructure.
 * Nothing asserts on wall-clock time.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteAgentSurface } from './remote-agent-surface';
import type {
  ConversationReply,
  RemoteAgentBridge,
  RemoteAgentSurfaceProps,
  SendReply,
} from './remote-agent-surface';
import {
  APPROVE_SEND_ACCESS_COMMANDS,
  CONVERSATION_UNREAD_COPY,
  EMPTY_CONVERSATION_NOTE,
  NO_CONVERSATION_NOTE,
  type ConversationTurn,
  type ConversationUpdate,
  type RemoteConnectionState,
  type RemoteConnectionView,
  type RemoteWorkStack,
} from './remote-agent-model';

afterEach(cleanup);

const T0 = 1_700_000_000_000;
const PRIMARY = 'context-main';

const TURNS: readonly ConversationTurn[] = [
  {
    id: 'turn-1',
    role: 'operator',
    text: 'Where did the venue comparison land?',
    timestamp: T0,
  },
  {
    id: 'turn-2',
    role: 'agent',
    text: 'Three quotes in, one waiting on a callback.',
    timestamp: T0 + 1_000,
  },
];

const WORK: RemoteWorkStack = {
  current: [
    { id: 'run-1', title: 'Comparing venue quotes', detail: 'Two of three' },
  ],
  automations: [
    {
      id: 'cron-1',
      name: 'Morning digest',
      schedule: 'Every day at 07:00',
      lastRun: 'Last run finished',
      nextRun: 'Next run tomorrow',
    },
  ],
  history: [{ id: 'old-1', title: 'Venue shortlist', detail: null }],
};

function connection(
  state: RemoteConnectionState,
  overrides: Partial<RemoteConnectionView> = {}
): RemoteConnectionView {
  const labels: Record<RemoteConnectionState, string> = {
    live: 'Live',
    reconnecting: 'Reconnecting',
    stale: 'Last seen 4 minutes ago',
    unavailable: 'Server unreachable',
  };
  return {
    state,
    label: labels[state],
    stalePresentation: state !== 'live',
    failure: state === 'unavailable' ? 'host-unreachable' : null,
    ...overrides,
  };
}

interface TestBridge extends RemoteAgentBridge {
  emit(update: ConversationUpdate): void;
}

function makeBridge(
  overrides: Partial<RemoteAgentBridge> = {},
  seed: readonly ConversationTurn[] = TURNS
): TestBridge {
  const handlers = new Set<(update: ConversationUpdate) => void>();
  const bridge: TestBridge = {
    conversation: vi.fn(
      async (): Promise<ConversationReply> => ({
        ok: true,
        contextId: PRIMARY,
        turns: seed,
        hasMore: false,
      })
    ),
    send: vi.fn(async (): Promise<SendReply> => ({ ok: true })),
    onConversation: handler => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    emit: update => {
      for (const handler of handlers) handler(update);
    },
    ...overrides,
  };
  return bridge;
}

function props(
  overrides: Partial<RemoteAgentSurfaceProps> = {}
): RemoteAgentSurfaceProps {
  return {
    agent: {
      id: 'agent-scout',
      name: 'Scout',
      project: 'Events',
      workState: 'active',
      placement: 'customer-hosted',
      sourceName: 'OpenClaw',
    },
    connection: connection('live'),
    authority: 'granted',
    bridge: makeBridge(),
    ...overrides,
  };
}

async function renderSurface(overrides: Partial<RemoteAgentSurfaceProps> = {}) {
  const resolved = props(overrides);
  const view = render(<RemoteAgentSurface {...resolved} />);
  await act(async () => {});
  return { ...view, resolved };
}

function composer(): HTMLTextAreaElement {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

/* -------------------------------------------------------------------------- */

describe('the front door', () => {
  it('renders the Agent’s own primary conversation', async () => {
    await renderSurface();
    const transcript = await screen.findByRole('log');
    expect(transcript).toHaveAttribute('data-transcript', PRIMARY);
    expect(screen.getByText(TURNS[0]!.text)).toBeInTheDocument();
    expect(screen.getByText(TURNS[1]!.text)).toBeInTheDocument();
  });

  it('asks the bridge for the conversation by Agent, not by latest context', async () => {
    const bridge = makeBridge();
    await renderSurface({ bridge });
    expect(bridge.conversation).toHaveBeenCalledWith('agent-scout');
  });

  it('offers older turns only when the source says it holds them', async () => {
    await renderSurface({
      bridge: makeBridge({
        conversation: vi.fn(async () => ({
          ok: true as const,
          contextId: PRIMARY,
          turns: TURNS,
          hasMore: true,
        })),
      }),
    });
    expect(await screen.findByText('Load earlier')).toBeInTheDocument();
  });

  it('loads older turns above the ones already on screen', async () => {
    const older: ConversationTurn = {
      id: 'turn-0',
      role: 'agent',
      text: 'Starting the venue search.',
      timestamp: T0 - 10_000,
    };
    let call = 0;
    const bridge = makeBridge({
      conversation: vi.fn(async () => {
        call += 1;
        return call === 1
          ? {
              ok: true as const,
              contextId: PRIMARY,
              turns: TURNS,
              hasMore: true,
            }
          : {
              ok: true as const,
              contextId: PRIMARY,
              turns: [older],
              hasMore: false,
            };
      }),
    });
    await renderSurface({ bridge });
    await act(async () => {
      fireEvent.click(screen.getByText('Load earlier'));
    });
    expect(await screen.findByText(older.text)).toBeInTheDocument();
    const rendered = screen.getByRole('log').querySelectorAll('[data-turn]');
    expect([...rendered].map(node => node.getAttribute('data-turn'))).toEqual([
      'turn-0',
      'turn-1',
      'turn-2',
    ]);
  });

  it('hides no last-known content while Exawatt is reconnecting', async () => {
    await renderSurface({ connection: connection('reconnecting') });
    expect(await screen.findByText(TURNS[1]!.text)).toBeInTheDocument();
    expect(screen.getByText('Last known')).toBeInTheDocument();
    expect(screen.getByText('Reconnecting')).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */

describe('a conversation that did not load', () => {
  it('says so instead of opening forever, and reads again on request (BUG-152)', async () => {
    const conversation = vi
      .fn<RemoteAgentBridge['conversation']>()
      .mockRejectedValueOnce(new Error('tunnel dropped'))
      .mockResolvedValue({
        ok: true,
        contextId: PRIMARY,
        turns: TURNS,
        hasMore: false,
      });
    await renderSurface({ bridge: makeBridge({ conversation }) });

    expect(
      document.querySelector('[data-conversation-state="unread"]')
    ).not.toBeNull();
    expect(screen.queryByText('Opening the conversation')).toBeNull();
    expect(screen.getByText(CONVERSATION_UNREAD_COPY.headline)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(TURNS[1]!.text);
    expect(conversation).toHaveBeenCalledTimes(2);
    expect(composer()).toBeVisible();
  });

  it('treats a refused read the same as a dropped one', async () => {
    const conversation = vi
      .fn<RemoteAgentBridge['conversation']>()
      .mockResolvedValue({ ok: false, reason: 'gateway-timeout' });
    await renderSurface({ bridge: makeBridge({ conversation }) });
    expect(screen.getByText(CONVERSATION_UNREAD_COPY.note)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('shows an empty conversation as empty, with the composer ready', async () => {
    await renderSurface({ bridge: makeBridge({}, []) });
    expect(screen.getByText(EMPTY_CONVERSATION_NOTE)).toBeVisible();
    expect(
      document.querySelector('[data-conversation-state="empty"]')
    ).not.toBeNull();
    expect(screen.queryByText('Opening the conversation')).toBeNull();
    expect(composer()).toBeVisible();
  });
});

describe('the composer', () => {
  it('addresses the primary conversation', async () => {
    const { container } = await renderSurface();
    await screen.findByRole('textbox');
    const form = container.querySelector('[data-composer-target]');
    expect(form).toHaveAttribute('data-composer-target', PRIMARY);
    expect(
      within(form as HTMLElement).getByText('Conversation')
    ).toHaveAttribute('data-composer-target-label');
  });

  it('still addresses it while a subordinate context is on screen', async () => {
    const { container } = await renderSurface({
      viewing: { contextId: 'context-cron', title: 'Morning digest run' },
    });
    await screen.findByRole('textbox');
    expect(
      container.querySelector('[data-subordinate-context]')
    ).toHaveAttribute('data-subordinate-context', 'context-cron');
    const form = container.querySelector('[data-composer-target]');
    expect(form).toHaveAttribute('data-composer-target', PRIMARY);
    // The target says the Agent's own conversation, not the run on screen.
    expect(within(form as HTMLElement).getByText('Scout')).toBeInTheDocument();
    expect(
      within(form as HTMLElement).queryByText('Morning digest run')
    ).not.toBeInTheDocument();
  });

  it('sends on Return and keeps Shift+Return for a new line', async () => {
    const bridge = makeBridge();
    await renderSurface({ bridge });
    const field = await screen.findByRole('textbox');
    fireEvent.change(field, { target: { value: 'Check the November quote' } });
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(bridge.send).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });
    expect(bridge.send).toHaveBeenCalledWith(
      'agent-scout',
      'Check the November quote',
      expect.objectContaining({ clientId: expect.any(String) })
    );
  });

  it('is absent, with the request named, before send access is asked for', async () => {
    const request = vi.fn();
    const { container } = await renderSurface({
      authority: 'not-requested',
      onRequestWriteAccess: request,
    });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(container.querySelector('[data-composer-withheld]')).toHaveAttribute(
      'data-composer-withheld',
      'write-access-not-requested'
    );
    fireEvent.click(screen.getByText('Request send access'));
    expect(request).toHaveBeenCalled();
  });

  it('gives a pending request a way to complete, and says what a check found (BUG-156)', async () => {
    const check = vi.fn(async () => ({
      outcome: 'approval-required' as const,
      message: 'Approve the device on the source.',
    }));
    const { container } = await renderSurface({
      authority: 'approval-pending',
      onRequestWriteAccess: check,
    });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(container.querySelector('[data-composer-withheld]')).toHaveAttribute(
      'data-composer-withheld',
      'write-access-awaiting-approval'
    );
    // What to run on the server is on screen, not left to memory.
    expect(
      container.querySelector('[data-approve-commands]')?.textContent
    ).toBe(APPROVE_SEND_ACCESS_COMMANDS.join('\n'));
    // Asking again is how a pending request completes once the server approved.
    const action = container.querySelector(
      '[data-composer-action="request-send-access"]'
    );
    expect(action).not.toBeNull();
    fireEvent.click(action as Element);
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    // A check that finds the request still waiting says so.
    await waitFor(() =>
      expect(container.querySelector('[data-access-note]')).not.toBeNull()
    );
  });

  it('approves on the server in one click, and says where a stop short left it (H2.4 P3)', async () => {
    let finish: (answer: {
      outcome: 'approval-required';
      message: string;
    }) => void = () => undefined;
    const approve = vi.fn(
      () =>
        new Promise<{ outcome: 'approval-required'; message: string }>(
          resolve => {
            finish = resolve;
          }
        )
    );
    const request = vi.fn();
    const { container } = await renderSurface({
      authority: 'not-requested',
      onRequestWriteAccess: request,
      onApproveWriteAccess: approve,
      sendAccess: { canApproveOnServer: true, commands: null },
    });
    const primary = container.querySelector(
      '[data-composer-action="approve-send-access"]'
    ) as HTMLButtonElement;
    const secondary = container.querySelector(
      '[data-composer-action-rank="secondary"]'
    ) as HTMLButtonElement;
    expect(primary).toHaveAttribute('data-composer-action-rank', 'primary');
    expect(secondary).toHaveTextContent('Show commands');

    fireEvent.click(primary);
    await waitFor(() => expect(primary).toHaveTextContent('Approving'));
    // One action at a time: the copy path cannot start under the one click.
    expect(secondary).toBeDisabled();
    expect(approve).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();

    await act(async () => {
      finish({
        outcome: 'approval-required',
        message: 'The server did not approve the request.',
      });
    });
    expect(container.querySelector('[data-access-note]')).toHaveTextContent(
      'The server did not approve the request.'
    );
  });

  it('asks without approving when the operator will run the commands', async () => {
    const approve = vi.fn(async () => null);
    const request = vi.fn(async () => ({
      outcome: 'approval-required' as const,
      message: 'Approve the device on the source.',
    }));
    const { container } = await renderSurface({
      authority: 'not-requested',
      onRequestWriteAccess: request,
      onApproveWriteAccess: approve,
      sendAccess: { canApproveOnServer: true, commands: null },
    });
    fireEvent.click(screen.getByText('Show commands'));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(approve).not.toHaveBeenCalled();
    // The pending state that follows carries the commands; asking said nothing.
    expect(container.querySelector('[data-access-note]')).toBeNull();
  });

  it('offers no one click on a server Exawatt cannot approve on', async () => {
    const { container } = await renderSurface({
      authority: 'not-requested',
      onRequestWriteAccess: vi.fn(),
      onApproveWriteAccess: vi.fn(async () => null),
      sendAccess: { canApproveOnServer: false, commands: null },
    });
    expect(
      container.querySelector('[data-composer-action="approve-send-access"]')
    ).toBeNull();
    expect(screen.getByText('Request send access')).toBeInTheDocument();
  });

  it('shows new commands as not yet copied', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { rerender, resolved } = await renderSurface({
      authority: 'approval-pending',
      onRequestWriteAccess: vi.fn(),
      sendAccess: { canApproveOnServer: true, commands: null },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Copy commands' }));
    await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());

    rerender(
      <RemoteAgentSurface
        {...resolved}
        sendAccess={{
          canApproveOnServer: true,
          commands: ['ssh north-box', 'openclaw devices approve abc'],
        }}
      />
    );
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(
      APPROVE_SEND_ACCESS_COMMANDS.join('\n')
    );
  });

  it('is absent, and offers Reconnect, when access has not been read', async () => {
    const reconnect = vi.fn();
    const { container } = await renderSurface({
      authority: 'unobserved',
      onReconnect: reconnect,
    });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(container.querySelector('[data-composer-withheld]')).toHaveAttribute(
      'data-composer-withheld',
      'write-access-unobserved'
    );
    fireEvent.click(screen.getByText('Reconnect'));
    expect(reconnect).toHaveBeenCalled();
  });

  it('is absent, and points at Reconnect, when the source is unreachable', async () => {
    const { container } = await renderSurface({
      connection: connection('unavailable'),
      onReconnect: vi.fn(),
    });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(container.querySelector('[data-composer-withheld]')).toHaveAttribute(
      'data-composer-withheld',
      'connection-unavailable'
    );
  });
});

/* -------------------------------------------------------------------------- */

describe('the connection chip', () => {
  /*
   * One fact, one colour, wherever it is shown.
   *
   * A connection Exawatt cannot see is not a D40 fault: the coworker on that
   * server may be working perfectly and Exawatt is the one that lost the
   * thread. So this chip wears the chrome attention role rather than the
   * fault role, and Settings paints the same state with `--settings-amber`,
   * which resolves to the same `--exa-hud-amber`. The two surfaces agree.
   */
  it('marks an unavailable connection with attention, never fault colour', async () => {
    const { container } = await renderSurface({
      connection: connection('unavailable'),
      onReconnect: vi.fn(),
    });
    const chip = container.querySelector<HTMLElement>(
      '[data-connection-chip="unavailable"]'
    );
    expect(chip).not.toBeNull();
    expect(chip!.style.color).toContain('--exa-hud-amber');
    expect(chip!.style.color).not.toContain('--exa-status-fault');
    expect(chip!.style.color).not.toContain('--exa-hud-red');
    // Hue never carries it alone: the state's own word is in the chip.
    expect(chip).toHaveTextContent('Server unreachable');
  });

  it('leaves the states Exawatt can still see in the quiet role', async () => {
    for (const state of ['live', 'reconnecting', 'stale'] as const) {
      cleanup();
      const { container } = await renderSurface({
        connection: connection(state),
      });
      const chip = container.querySelector<HTMLElement>(
        `[data-connection-chip="${state}"]`
      );
      expect(chip).not.toBeNull();
      expect(chip!.style.color).not.toContain('--exa-status-fault');
    }
  });
});

/* -------------------------------------------------------------------------- */

describe('the Agent whose source declares no conversation', () => {
  const noConversation = makeBridge({
    conversation: vi.fn(async () => ({ ok: true as const, contextId: null })),
  });

  it('leads with Automations and fabricates no Home', async () => {
    const { container } = await renderSurface({
      agent: {
        id: 'agent-vale',
        name: 'Vale',
        project: 'Growth',
        workState: 'off',
        placement: 'customer-hosted',
        sourceName: 'OpenClaw',
      },
      bridge: noConversation,
      work: WORK,
    });
    await screen.findByText(NO_CONVERSATION_NOTE);
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    const sections = [...container.querySelectorAll('[data-work-section]')].map(
      node => node.getAttribute('data-work-section')
    );
    expect(sections[0]).toBe('automations');
    expect(screen.getByText('Morning digest')).toBeInTheDocument();
  });

  it('offers no composer', async () => {
    const { container } = await renderSurface({
      bridge: noConversation,
      work: WORK,
    });
    await screen.findByText(NO_CONVERSATION_NOTE);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(container.querySelector('[data-composer-withheld]')).toHaveAttribute(
      'data-composer-withheld',
      'no-primary-conversation'
    );
  });
});

/* -------------------------------------------------------------------------- */

describe('sending feels answered', () => {
  it('shows the message on its way, then the streamed reply arriving', async () => {
    const bridge = makeBridge();
    await renderSurface({ bridge });
    const field = await screen.findByRole('textbox');
    fireEvent.change(field, { target: { value: 'Any update on the quote?' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });
    expect(screen.getByText('Any update on the quote?')).toBeInTheDocument();

    await act(async () => {
      bridge.emit({
        agentId: 'agent-scout',
        contextId: PRIMARY,
        runId: 'run-4',
        turns: [
          {
            id: 'turn-3',
            role: 'agent',
            text: 'The third quote just came back.',
            timestamp: T0 + 5_000,
          },
        ],
      });
    });
    expect(
      await screen.findByText('The third quote just came back.')
    ).toBeInTheDocument();
  });

  it('ignores a stream update aimed at a subordinate context', async () => {
    const bridge = makeBridge();
    await renderSurface({ bridge });
    await screen.findByRole('log');
    await act(async () => {
      bridge.emit({
        agentId: 'agent-scout',
        contextId: 'context-cron',
        turns: [
          {
            id: 'turn-9',
            role: 'agent',
            text: 'Digest run finished.',
            timestamp: T0 + 9_000,
          },
        ],
      });
    });
    expect(screen.queryByText('Digest run finished.')).not.toBeInTheDocument();
  });

  it('recovers a sent message from history rather than replaying events', async () => {
    const delivered: ConversationTurn = {
      id: 'turn-3',
      role: 'operator',
      text: 'Any update on the quote?',
      timestamp: T0 + 2_000,
    };
    let call = 0;
    const bridge = makeBridge({
      conversation: vi.fn(async () => {
        call += 1;
        return {
          ok: true as const,
          contextId: PRIMARY,
          turns: call === 1 ? TURNS : [...TURNS, delivered],
          hasMore: false,
        };
      }),
    });
    const { rerender, resolved } = await renderSurface({ bridge });
    const field = await screen.findByRole('textbox');
    fireEvent.change(field, { target: { value: delivered.text } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });

    // The connection drops and comes back. The surface resnapshots.
    await act(async () => {
      rerender(
        <RemoteAgentSurface
          {...resolved}
          connection={connection('reconnecting')}
        />
      );
    });
    await act(async () => {
      rerender(
        <RemoteAgentSurface {...resolved} connection={connection('live')} />
      );
    });

    await waitFor(() => expect(call).toBeGreaterThan(1));
    // Exactly one copy of the message: the one the source's own history has.
    await waitFor(() =>
      expect(screen.getAllByText(delivered.text)).toHaveLength(1)
    );
    expect(document.querySelector('[data-outbound]')).toBe(null);
  });
});

/* -------------------------------------------------------------------------- */

describe('a refused send', () => {
  const refusals = [
    ['no-write-authority', 'This device is paired for reading'],
    ['no-primary-conversation', 'This Agent has no conversation on its source'],
    ['disconnected', 'Exawatt is not connected to this source right now'],
    ['unknown-agent', 'The source no longer reports this Agent'],
    ['kaboom', 'The source refused the message'],
  ] as const;

  for (const [refusal, headline] of refusals) {
    it(`states the reason and the next step for ${refusal}`, async () => {
      const bridge = makeBridge({
        send: vi.fn(async () => ({ ok: false as const, refusal })),
      });
      await renderSurface({ bridge });
      const field = await screen.findByRole('textbox');
      fireEvent.change(field, {
        target: { value: 'Please retry the publish' },
      });
      await act(async () => {
        fireEvent.keyDown(field, { key: 'Enter' });
      });
      expect(await screen.findByText(headline)).toBeInTheDocument();
    });
  }

  it('keeps the operator’s typed text', async () => {
    const bridge = makeBridge({
      send: vi.fn(async () => ({
        ok: false as const,
        refusal: 'disconnected',
      })),
    });
    await renderSurface({ bridge });
    const field = await screen.findByRole('textbox');
    fireEvent.change(field, { target: { value: 'Please retry the publish' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });
    await waitFor(() =>
      expect(composer().value).toBe('Please retry the publish')
    );
  });

  it('keeps it beside a retry when the operator has started another message', async () => {
    let resolveSend: ((reply: SendReply) => void) | null = null;
    const bridge = makeBridge({
      send: vi.fn(
        () =>
          new Promise<SendReply>(resolve => {
            resolveSend = resolve;
          })
      ),
    });
    await renderSurface({ bridge });
    const field = await screen.findByRole('textbox');
    fireEvent.change(field, { target: { value: 'First message' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });
    fireEvent.change(field, { target: { value: 'Second message' } });
    await act(async () => {
      resolveSend?.({ ok: false, refusal: 'disconnected' });
      await Promise.resolve();
    });
    expect(composer().value).toBe('Second message');
    expect(screen.getByText('First message')).toBeInTheDocument();
    expect(screen.getByText('Send again')).toBeInTheDocument();
  });

  it('retries under the same identity, so nothing is posted twice', async () => {
    const bridge = makeBridge({
      send: vi.fn(async () => ({
        ok: false as const,
        refusal: 'disconnected',
      })),
    });
    await renderSurface({ bridge });
    const field = await screen.findByRole('textbox');
    fireEvent.change(field, { target: { value: 'Please retry the publish' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });
    await waitFor(() =>
      expect(composer().value).toBe('Please retry the publish')
    );
    await act(async () => {
      fireEvent.keyDown(composer(), { key: 'Enter' });
    });
    const calls = (bridge.send as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[2]?.clientId).toBe(calls[1]?.[2]?.clientId);
  });
});

/* -------------------------------------------------------------------------- */

describe('the work stack', () => {
  it('keeps history collapsed until the operator opens it', async () => {
    await renderSurface({ work: WORK });
    await screen.findByRole('log');
    expect(screen.queryByText('Venue shortlist')).not.toBeInTheDocument();
    const disclosure = screen.getByRole('button', { name: /History/ });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Venue shortlist')).toBeInTheDocument();
  });

  it('shows current work and automations without promoting either to a coworker', async () => {
    const { container } = await renderSurface({ work: WORK });
    await screen.findByRole('log');
    const sections = [...container.querySelectorAll('[data-work-section]')].map(
      node => node.getAttribute('data-work-section')
    );
    expect(sections).toEqual(['work', 'automations', 'history']);
    // One Agent header on the surface. Nothing beneath it claims to be one.
    expect(container.querySelectorAll('[data-remote-agent]')).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */

describe('voice', () => {
  const forbidden = /stopped|paused|lost/i;

  async function sweep(overrides: Partial<RemoteAgentSurfaceProps>) {
    cleanup();
    const { container } = await renderSurface(overrides);
    await act(async () => {});
    return container.textContent ?? '';
  }

  it('never uses an em dash and never says work ended', async () => {
    const states: Partial<RemoteAgentSurfaceProps>[] = [
      { work: WORK },
      { connection: connection('reconnecting'), work: WORK },
      { connection: connection('stale'), work: WORK },
      {
        connection: connection('unavailable'),
        onReconnect: vi.fn(),
        work: WORK,
      },
      { authority: 'not-requested', onRequestWriteAccess: vi.fn(), work: WORK },
      { authority: 'approval-pending', work: WORK },
      { authority: 'unobserved', onReconnect: vi.fn(), work: WORK },
      {
        bridge: makeBridge({
          conversation: vi.fn(async () => ({
            ok: true as const,
            contextId: null,
          })),
        }),
        work: WORK,
      },
      {
        bridge: makeBridge({
          send: vi.fn(async () => ({
            ok: false as const,
            refusal: 'no-write-authority',
          })),
        }),
        work: WORK,
      },
    ];
    for (const state of states) {
      const text = await sweep(state);
      expect(text).not.toContain('—');
      expect(text).not.toMatch(forbidden);
    }
  });

  it('says nothing about work ending when a send is refused', async () => {
    cleanup();
    const bridge = makeBridge({
      send: vi.fn(async () => ({
        ok: false as const,
        refusal: 'disconnected',
      })),
    });
    const { container } = await renderSurface({ bridge, work: WORK });
    const field = await screen.findByRole('textbox');
    fireEvent.change(field, { target: { value: 'Please retry the publish' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });
    expect(container.textContent ?? '').not.toMatch(forbidden);
    expect(container.textContent ?? '').not.toContain('—');
  });
});
