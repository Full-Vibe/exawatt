/**
 * The connected coworker's decision logic (ENG-033 H2).
 *
 * Every fixture value here is invented. No hostname, address, user, server
 * name, or key path in this file belongs to anyone's real infrastructure.
 * Nothing asserts on wall-clock time.
 */

import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_PAGE_SIZE,
  COMPOSER_WITHHELD_REASONS,
  EMPTY_WORK_STACK,
  LAST_KNOWN_BADGE,
  NO_CONVERSATION_NOTE,
  REMOTE_CONNECTION_STATES,
  SEND_REFUSALS,
  SEND_REFUSAL_COPY,
  WRITE_AUTHORITY_COPY,
  WRITE_AUTHORITY_STATES,
  applyConversationUpdate,
  boundTurns,
  composerTargetFor,
  describeRemoteAgent,
  historyCarries,
  mergeTurns,
  normalizeSendRefusal,
  outboxReducer,
  type ConversationLoad,
  type ConversationTurn,
  type OutboundMessage,
  type RemoteAgentInput,
  type RemoteConnectionState,
  type RemoteConnectionView,
  type RemoteWorkStack,
} from './remote-agent-model';

/* Fixed instants; nothing here reads a clock. */
const T0 = 1_700_000_000_000;
const MINUTE = 60_000;

const PRIMARY = 'context-main';

function turn(
  overrides: Partial<ConversationTurn> & { id: string }
): ConversationTurn {
  return {
    role: 'agent',
    text: 'Comparing three venue quotes.',
    timestamp: T0,
    ...overrides,
  };
}

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

function declared(
  turns: readonly ConversationTurn[] = [turn({ id: 'turn-1' })],
  olderAvailable = false
): ConversationLoad {
  return { kind: 'declared', contextId: PRIMARY, turns, olderAvailable };
}

function input(overrides: Partial<RemoteAgentInput> = {}): RemoteAgentInput {
  return {
    agent: { id: 'agent-scout', name: 'Scout' },
    connection: connection('live'),
    authority: 'granted',
    conversation: declared(),
    work: EMPTY_WORK_STACK,
    ...overrides,
  };
}

const WORK: RemoteWorkStack = {
  current: [
    { id: 'run-1', title: 'Comparing venue quotes', detail: 'Started today' },
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
  history: [
    { id: 'old-1', title: 'Venue shortlist', detail: null },
    { id: 'old-2', title: 'Budget check', detail: null },
  ],
};

/* -------------------------------------------------------------------------- */

describe('vocabulary', () => {
  it('keeps one exhaustive definition of every closed set', () => {
    expect([...REMOTE_CONNECTION_STATES]).toEqual([
      'live',
      'reconnecting',
      'stale',
      'unavailable',
    ]);
    expect([...WRITE_AUTHORITY_STATES]).toEqual([
      'granted',
      'approval-pending',
      'not-requested',
      'unobserved',
    ]);
    expect([...SEND_REFUSALS]).toEqual([
      'no-write-authority',
      'no-primary-conversation',
      'disconnected',
      'unknown-agent',
      'unrecognized',
    ]);
  });

  it('gives every refusal a headline and a next step', () => {
    for (const refusal of SEND_REFUSALS) {
      const copy = SEND_REFUSAL_COPY[refusal];
      expect(copy.headline.length).toBeGreaterThan(0);
      expect(copy.nextStep.length).toBeGreaterThan(0);
    }
  });

  it('gives every ungranted authority position what is true and what completes it', () => {
    for (const authority of WRITE_AUTHORITY_STATES) {
      if (authority === 'granted') continue;
      const copy = WRITE_AUTHORITY_COPY[authority];
      expect(copy.headline.length).toBeGreaterThan(0);
      expect(copy.detail.length).toBeGreaterThan(0);
    }
  });

  it('never phrases a state as something the operator cannot do', () => {
    const strings = [
      ...Object.values(WRITE_AUTHORITY_COPY).flatMap(copy => [
        copy.headline,
        copy.detail,
      ]),
      ...Object.values(SEND_REFUSAL_COPY).flatMap(copy => [
        copy.headline,
        copy.nextStep,
      ]),
      NO_CONVERSATION_NOTE,
      LAST_KNOWN_BADGE,
    ];
    for (const value of strings) {
      expect(value).not.toMatch(/cannot|can't|unable|not allowed|denied/i);
      expect(value).not.toMatch(/stopped|paused|lost/i);
      expect(value).not.toContain('—');
    }
  });
});

/* -------------------------------------------------------------------------- */

describe('the front door', () => {
  it('opens the primary conversation the source declared', () => {
    const view = describeRemoteAgent(input());
    expect(view.frontDoor.kind).toBe('conversation');
    if (view.frontDoor.kind !== 'conversation') throw new Error('unreachable');
    expect(view.frontDoor.contextId).toBe(PRIMARY);
    expect(view.frontDoor.heading).toBe('Conversation');
  });

  it('never adopts a busier context as the front door', () => {
    const view = describeRemoteAgent(
      input({ viewing: { contextId: 'context-cron', title: 'Morning digest' } })
    );
    if (view.frontDoor.kind !== 'conversation') throw new Error('unreachable');
    expect(view.frontDoor.contextId).toBe(PRIMARY);
    expect(view.subordinateOpen).toBe(true);
  });

  it('offers older turns only when the source says there are older turns', () => {
    const withMore = describeRemoteAgent(
      input({ conversation: declared([turn({ id: 'turn-1' })], true) })
    );
    if (withMore.frontDoor.kind !== 'conversation') {
      throw new Error('unreachable');
    }
    expect(withMore.frontDoor.olderAvailable).toBe(true);

    const withoutMore = describeRemoteAgent(input());
    if (withoutMore.frontDoor.kind !== 'conversation') {
      throw new Error('unreachable');
    }
    expect(withoutMore.frontDoor.olderAvailable).toBe(false);
  });

  it('waits rather than guessing while the conversation is being read', () => {
    const view = describeRemoteAgent(
      input({ conversation: { kind: 'loading' } })
    );
    expect(view.frontDoor.kind).toBe('loading');
  });

  it('leads with Automations when the source declares no conversation', () => {
    const view = describeRemoteAgent(
      input({ conversation: { kind: 'absent' }, work: WORK })
    );
    expect(view.frontDoor.kind).toBe('automations-lead');
    if (view.frontDoor.kind !== 'automations-lead') {
      throw new Error('unreachable');
    }
    expect(view.frontDoor.heading).toBe('Automations');
    expect(view.frontDoor.note).toBe(NO_CONVERSATION_NOTE);
    expect(view.sections.map(section => section.id)).toEqual([
      'automations',
      'work',
      'history',
    ]);
  });

  it('keeps last-known turns on screen when the read failed', () => {
    const view = describeRemoteAgent(
      input({
        conversation: {
          kind: 'unread',
          contextId: PRIMARY,
          turns: [turn({ id: 'turn-1' })],
          olderAvailable: false,
        },
        connection: connection('reconnecting'),
      })
    );
    if (view.frontDoor.kind !== 'conversation') throw new Error('unreachable');
    expect(view.frontDoor.turns).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */

describe('the composer target', () => {
  it('is the primary conversation, structurally', () => {
    const target = composerTargetFor(input());
    expect(target).toEqual({
      contextId: PRIMARY,
      agentName: 'Scout',
      label: 'Conversation',
      isPrimaryConversation: true,
    });
  });

  it('does not move when a subordinate context is on screen', () => {
    const view = describeRemoteAgent(
      input({ viewing: { contextId: 'context-subagent', title: 'Helper run' } })
    );
    expect(view.composer.kind).toBe('ready');
    if (view.composer.kind !== 'ready') throw new Error('unreachable');
    expect(view.composer.target.contextId).toBe(PRIMARY);
    expect(view.composer.target.isPrimaryConversation).toBe(true);
  });

  it('has no target at all when the Agent has no conversation', () => {
    expect(composerTargetFor(input({ conversation: { kind: 'absent' } }))).toBe(
      null
    );
  });
});

/* -------------------------------------------------------------------------- */

describe('honest composer states', () => {
  it('offers the composer only when the source granted write authority', () => {
    const view = describeRemoteAgent(input());
    expect(view.composer.kind).toBe('ready');
  });

  it('withholds it, and names the request, when nothing was requested yet', () => {
    const view = describeRemoteAgent(
      input({ authority: 'not-requested', canRequestWriteAccess: true })
    );
    if (view.composer.kind !== 'withheld') throw new Error('unreachable');
    expect(view.composer.reason).toBe('write-access-not-requested');
    expect(view.composer.headline).toBe(
      WRITE_AUTHORITY_COPY['not-requested'].headline
    );
    expect(view.composer.action).toEqual({
      id: 'request-send-access',
      label: 'Request send access',
    });
  });

  it('omits the request action when the host cannot carry one', () => {
    const view = describeRemoteAgent(input({ authority: 'not-requested' }));
    if (view.composer.kind !== 'withheld') throw new Error('unreachable');
    expect(view.composer.action).toBe(null);
  });

  it('treats an approval waiting on the source as a waiting state', () => {
    const view = describeRemoteAgent(
      input({ authority: 'approval-pending', canRequestWriteAccess: true })
    );
    if (view.composer.kind !== 'withheld') throw new Error('unreachable');
    expect(view.composer.reason).toBe('write-access-awaiting-approval');
    expect(view.composer.headline).toBe('Send access requested');
    expect(view.composer.detail).toBe(
      'Approve it on the machine that runs this Agent to finish.'
    );
    // Requesting again is not the next step; approving on the source is.
    expect(view.composer.action).toBe(null);
  });

  it('offers Reconnect when this device’s access has not been read', () => {
    const view = describeRemoteAgent(
      input({ authority: 'unobserved', canReconnect: true })
    );
    if (view.composer.kind !== 'withheld') throw new Error('unreachable');
    expect(view.composer.reason).toBe('write-access-unobserved');
    expect(view.composer.action).toEqual({
      id: 'reconnect',
      label: 'Reconnect',
    });
  });

  it('withholds it with no action when the Agent has no conversation', () => {
    const view = describeRemoteAgent(
      input({ conversation: { kind: 'absent' }, canRequestWriteAccess: true })
    );
    if (view.composer.kind !== 'withheld') throw new Error('unreachable');
    expect(view.composer.reason).toBe('no-primary-conversation');
    expect(view.composer.target).toBe(null);
    expect(view.composer.action).toBe(null);
    expect(view.composer.headline).toBe(NO_CONVERSATION_NOTE);
  });

  it('points at Reconnect when the connection is unavailable', () => {
    const view = describeRemoteAgent(
      input({ connection: connection('unavailable'), canReconnect: true })
    );
    if (view.composer.kind !== 'withheld') throw new Error('unreachable');
    expect(view.composer.reason).toBe('connection-unavailable');
    expect(view.composer.action?.id).toBe('reconnect');
  });

  it('keeps the composer live while Exawatt is reconnecting or stale', () => {
    for (const state of ['reconnecting', 'stale'] as const) {
      const view = describeRemoteAgent(
        input({ connection: connection(state) })
      );
      expect(view.composer.kind).toBe('ready');
    }
  });

  it('withholds it while the conversation is still being read', () => {
    const view = describeRemoteAgent(
      input({ conversation: { kind: 'loading' } })
    );
    if (view.composer.kind !== 'withheld') throw new Error('unreachable');
    expect(view.composer.reason).toBe('conversation-loading');
  });

  it('reaches every withheld reason across the state matrix', () => {
    const reached = new Set<string>();
    const cases: RemoteAgentInput[] = [
      input({ conversation: { kind: 'loading' } }),
      input({ conversation: { kind: 'absent' } }),
      input({ authority: 'not-requested' }),
      input({ authority: 'approval-pending' }),
      input({ authority: 'unobserved' }),
      input({ connection: connection('unavailable') }),
    ];
    for (const value of cases) {
      const view = describeRemoteAgent(value);
      if (view.composer.kind === 'withheld') reached.add(view.composer.reason);
    }
    expect([...reached].sort()).toEqual([...COMPOSER_WITHHELD_REASONS].sort());
  });

  it('authority outranks connection, so an ungranted device is not told to reconnect', () => {
    const view = describeRemoteAgent(
      input({
        authority: 'approval-pending',
        connection: connection('unavailable'),
        canReconnect: true,
      })
    );
    if (view.composer.kind !== 'withheld') throw new Error('unreachable');
    expect(view.composer.reason).toBe('write-access-awaiting-approval');
  });
});

/* -------------------------------------------------------------------------- */

describe('freshness marking', () => {
  it('marks nothing while the view is current', () => {
    const view = describeRemoteAgent(input());
    expect(view.freshness).toEqual({
      state: 'live',
      marked: false,
      badge: null,
      line: 'Live',
    });
  });

  it('marks last known for every state that is not live', () => {
    for (const state of ['reconnecting', 'stale', 'unavailable'] as const) {
      const view = describeRemoteAgent(
        input({ connection: connection(state) })
      );
      expect(view.freshness.marked).toBe(true);
      expect(view.freshness.badge).toBe(LAST_KNOWN_BADGE);
    }
  });

  it('carries the source’s own observation line and claims nothing more', () => {
    const view = describeRemoteAgent(
      input({ connection: connection('reconnecting') })
    );
    expect(view.freshness.line).toBe('Reconnecting');
    expect(view.freshness.line).not.toMatch(/stopped|paused|lost/i);
  });

  it('keeps last-known content on screen rather than hiding it', () => {
    const view = describeRemoteAgent(
      input({
        connection: connection('unavailable'),
        conversation: declared([
          turn({ id: 'turn-1' }),
          turn({ id: 'turn-2' }),
        ]),
      })
    );
    if (view.frontDoor.kind !== 'conversation') throw new Error('unreachable');
    expect(view.frontDoor.turns).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */

describe('the work stack', () => {
  it('orders Work, Automations, History beneath a conversation', () => {
    const view = describeRemoteAgent(input({ work: WORK }));
    expect(view.sections.map(section => section.id)).toEqual([
      'work',
      'automations',
      'history',
    ]);
  });

  it('collapses history and says how much it holds', () => {
    const view = describeRemoteAgent(input({ work: WORK }));
    const history = view.sections.find(section => section.id === 'history');
    expect(history?.collapsed).toBe(true);
    expect(history?.summary).toBe('2 records');
  });

  it('leaves current work and automations open', () => {
    const view = describeRemoteAgent(input({ work: WORK }));
    for (const id of ['work', 'automations'] as const) {
      expect(view.sections.find(section => section.id === id)?.collapsed).toBe(
        false
      );
    }
  });

  it('marks every entry subordinate, so nothing reads as a coworker', () => {
    const view = describeRemoteAgent(input({ work: WORK }));
    for (const section of view.sections) {
      for (const item of section.items) expect(item.subordinate).toBe(true);
    }
  });

  it('renders no empty section', () => {
    const view = describeRemoteAgent(input());
    expect(view.sections).toEqual([]);
  });

  it('folds an automation’s schedule and runs into one line', () => {
    const view = describeRemoteAgent(input({ work: WORK }));
    const automations = view.sections.find(
      section => section.id === 'automations'
    );
    expect(automations?.items[0]?.detail).toBe(
      'Every day at 07:00 · Last run finished · Next run tomorrow'
    );
  });
});

/* -------------------------------------------------------------------------- */

describe('turns', () => {
  it('orders by timestamp and breaks ties by id', () => {
    const merged = mergeTurns(
      [turn({ id: 'b', timestamp: T0 }), turn({ id: 'a', timestamp: T0 })],
      [turn({ id: 'c', timestamp: T0 - MINUTE })]
    );
    expect(merged.map(entry => entry.id)).toEqual(['c', 'a', 'b']);
  });

  it('revises a turn it already carries instead of adding a second one', () => {
    const merged = mergeTurns(
      [turn({ id: 'a', text: 'Working on it' })],
      [turn({ id: 'a', text: 'Working on it, two quotes back' })]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toBe('Working on it, two quotes back');
  });

  it('bounds the window to the newest page', () => {
    const many = Array.from({ length: CONVERSATION_PAGE_SIZE + 5 }, (_, i) =>
      turn({ id: `turn-${i}`, timestamp: T0 + i })
    );
    const bounded = boundTurns(many);
    expect(bounded).toHaveLength(CONVERSATION_PAGE_SIZE);
    expect(bounded[bounded.length - 1]?.id).toBe(
      `turn-${CONVERSATION_PAGE_SIZE + 4}`
    );
  });
});

/* -------------------------------------------------------------------------- */

describe('streamed updates', () => {
  const target = { agentId: 'agent-scout', primaryContextId: PRIMARY };

  it('absorbs an update for this Agent’s primary conversation', () => {
    const next = applyConversationUpdate(
      [turn({ id: 'turn-1' })],
      {
        agentId: 'agent-scout',
        contextId: PRIMARY,
        runId: 'run-9',
        turns: [turn({ id: 'turn-2', timestamp: T0 + MINUTE })],
      },
      target
    );
    expect(next.map(entry => entry.id)).toEqual(['turn-1', 'turn-2']);
  });

  it('ignores an update for another Agent', () => {
    const current = [turn({ id: 'turn-1' })];
    expect(
      applyConversationUpdate(
        current,
        {
          agentId: 'agent-other',
          contextId: PRIMARY,
          turns: [turn({ id: 'turn-2' })],
        },
        target
      )
    ).toBe(current);
  });

  it('ignores a subordinate context, which reports beneath the Agent', () => {
    const current = [turn({ id: 'turn-1' })];
    expect(
      applyConversationUpdate(
        current,
        {
          agentId: 'agent-scout',
          contextId: 'context-cron',
          turns: [turn({ id: 'turn-2' })],
        },
        target
      )
    ).toBe(current);
  });

  it('absorbs nothing when the Agent has no primary conversation', () => {
    const current: readonly ConversationTurn[] = [];
    expect(
      applyConversationUpdate(
        current,
        {
          agentId: 'agent-scout',
          contextId: 'context-cron',
          turns: [turn({ id: 'turn-2' })],
        },
        { agentId: 'agent-scout', primaryContextId: null }
      )
    ).toBe(current);
  });
});

/* -------------------------------------------------------------------------- */

describe('the outbox', () => {
  const message = {
    localId: 'out-1',
    text: 'Please check the November quote.',
  };

  function sent(): readonly OutboundMessage[] {
    return outboxReducer([], { type: 'send', ...message });
  }

  it('records a message as sending', () => {
    expect(sent()).toEqual([
      {
        localId: 'out-1',
        text: message.text,
        status: 'sending',
        refusal: null,
      },
    ]);
  });

  it('records the exact refusal the source gave', () => {
    const refused = outboxReducer(sent(), {
      type: 'refused',
      localId: 'out-1',
      refusal: 'no-write-authority',
    });
    expect(refused[0]?.status).toBe('refused');
    expect(refused[0]?.refusal).toBe('no-write-authority');
  });

  it('keeps the operator’s words through a refusal', () => {
    const refused = outboxReducer(sent(), {
      type: 'refused',
      localId: 'out-1',
      refusal: 'disconnected',
    });
    expect(refused[0]?.text).toBe(message.text);
  });

  it('retries under the same identity rather than as a second message', () => {
    const refused = outboxReducer(sent(), {
      type: 'refused',
      localId: 'out-1',
      refusal: 'disconnected',
    });
    const retried = outboxReducer(refused, { type: 'send', ...message });
    expect(retried).toHaveLength(1);
    expect(retried[0]?.status).toBe('sending');
    expect(retried[0]?.refusal).toBe(null);
  });

  it('does not treat acceptance as delivery evidence', () => {
    const accepted = outboxReducer(sent(), {
      type: 'accepted',
      localId: 'out-1',
    });
    expect(accepted).toHaveLength(1);
  });

  it('clears an entry the source’s own history now carries, by client id', () => {
    const reconciled = outboxReducer(sent(), {
      type: 'reconcile',
      turns: [
        turn({
          id: 'turn-9',
          role: 'operator',
          text: message.text,
          clientId: 'out-1',
        }),
      ],
    });
    expect(reconciled).toEqual([]);
  });

  it('clears it by text when the source echoes no client id', () => {
    const reconciled = outboxReducer(sent(), {
      type: 'reconcile',
      turns: [turn({ id: 'turn-9', role: 'operator', text: message.text })],
    });
    expect(reconciled).toEqual([]);
  });

  it('keeps an entry the history does not carry, so a reconnect resends nothing', () => {
    const reconciled = outboxReducer(sent(), {
      type: 'reconcile',
      turns: [turn({ id: 'turn-9', role: 'agent', text: message.text })],
    });
    expect(reconciled).toHaveLength(1);
  });

  it('never double-posts: a retry after the first attempt landed is dropped', () => {
    const refused = outboxReducer(sent(), {
      type: 'refused',
      localId: 'out-1',
      refusal: 'disconnected',
    });
    const history = [
      turn({
        id: 'turn-9',
        role: 'operator',
        text: message.text,
        clientId: 'out-1',
      }),
    ];
    expect(historyCarries(history, message)).toBe(true);
    expect(
      outboxReducer(refused, { type: 'reconcile', turns: history })
    ).toEqual([]);
  });

  it('discards an entry the operator abandoned', () => {
    expect(
      outboxReducer(sent(), { type: 'discard', localId: 'out-1' })
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe('refusal normalization', () => {
  it('passes every known refusal through', () => {
    for (const refusal of SEND_REFUSALS) {
      if (refusal === 'unrecognized') continue;
      expect(normalizeSendRefusal(refusal)).toBe(refusal);
    }
  });

  it('buckets anything else, so no raw code reaches the operator', () => {
    for (const value of [
      'kaboom',
      '',
      null,
      undefined,
      7,
      { refusal: 'no-write-authority' },
    ]) {
      expect(normalizeSendRefusal(value)).toBe('unrecognized');
    }
  });
});
