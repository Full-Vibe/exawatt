/**
 * End-to-end turn-truth contract (ENG-023 D4).
 *
 * The per-module unit tests each passed while the product lied, because the
 * lie lived BETWEEN them: the attention monitor inferred one thing, the
 * delegation monitor reported another, and the render derivation picked a
 * winner that changed the moment the operator focused the tab. So this file
 * wires the real main-process monitors to the real renderer derivation and
 * asserts on the only thing that matters — the light the operator sees.
 *
 * The governing invariant, stated once: **focusing a tab may change what the
 * operator has SEEN, never what is true.** Every case below reads the light
 * before and after focus and requires them to agree.
 */
import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import { AttentionMonitor } from '../../../electron/main/pty/attention-monitor';
import type { PtySessionManager } from '../../../electron/main/pty/session-manager';
import { DelegationMonitor } from '../../../electron/main/harness-events/delegation-monitor';
import { claudeHookEvent } from '../../../electron/main/harness-events/claude-hooks';
import type { HarnessEvent } from '../../../electron/main/harness-events/delegation-state';
import {
  CENSUS_EXPIRED_EVENT,
  wireReportedTurnTruth,
} from '../../../electron/main/harness-events/turn-truth';
import type { StatusLightState } from '@/components/status-light/protocol';
import {
  sessionGlyphState,
  sessionStatusLightState,
  sessionDelegationBusy,
} from './session-status';

const SESSION = 'a';
const OTHER = 'b';

class FakeManager extends EventEmitter {
  sessions = [
    { id: SESSION, harness: 'claude', startedAt: 0, exited: false },
    { id: OTHER, harness: 'claude', startedAt: 0, exited: false },
  ];
  list() {
    return this.sessions.map(s => ({ ...s }));
  }
}

/** The real wiring from `pty-ipc`, minus Electron: the same
 *  `wireReportedTurnTruth` the app runs, over the same monitors. */
function harness() {
  let clock = 100_000;
  const manager = new FakeManager();
  const delegation = new DelegationMonitor();
  const attention = new AttentionMonitor({
    quietMs: 4000,
    minBurstBytes: 600,
    spawnGraceMs: 20_000,
    now: () => clock,
  });
  attention.attach(manager as unknown as PtySessionManager);
  /** what `logs/main.jsonl` would hold */
  const expiries: Array<Record<string, unknown>> = [];
  wireReportedTurnTruth({
    attention,
    delegation,
    now: () => clock,
    record: (event, fields) => expiries.push({ event, ...fields }),
    harnessOf: () => 'claude',
  });
  attention.setWindowFocused(true);
  attention.setFocus(OTHER);

  /** Replay one Claude Code hook payload through the real adapter into the
   *  real channel entry point, which runs the real subscriber order. */
  const hook = (payload: Record<string, unknown>) => {
    const event = claudeHookEvent(payload, clock);
    if (!event) return null;
    delegation.report(SESSION, event);
    return event;
  };

  /** What the tab strip, the ⌘K row, and exposé all render from. */
  const light = (): StatusLightState => {
    const reported = delegation.getLive(SESSION);
    return sessionStatusLightState({
      state: sessionGlyphState({
        working: attention.isWorking(SESSION),
        agent: true,
        started: true,
        delegatedBusy: sessionDelegationBusy(reported),
        blocked: !!reported?.blockedOn,
        ownTurn: reported?.ownTurn,
      }),
      attention: attention.get(SESSION),
    });
  };

  return {
    attention,
    delegation,
    expiries,
    manager,
    hook,
    light,
    stream: (bytes: number) => manager.emit('data', SESSION, 'x'.repeat(bytes)),
    advance: (ms: number) => {
      clock += ms;
      attention.sweepNow();
    },
    /** The harness rendering its running team: a footer tick every second,
     *  the smallest of the byte rates measured on Claude Code 2.1.270 with a
     *  child live (87 B/s), for `seconds` seconds. */
    render: (seconds: number) => {
      for (let s = 0; s < seconds; s += 1) {
        clock += 1000;
        manager.emit('data', SESSION, 'x'.repeat(87));
        attention.sweepNow();
      }
    },
    /** the operator presses ⌘4 */
    focus: () => attention.setFocus(SESSION),
    unfocus: () => attention.setFocus(OTHER),
  };
}

const ask = { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' };
const answered = {
  hook_event_name: 'PostToolUse',
  tool_name: 'AskUserQuestion',
};
const submit = { hook_event_name: 'UserPromptSubmit' };
const stop = { hook_event_name: 'Stop' };

/** Payload shapes measured on Claude Code 2.1.270 (2026-09-13): every `Stop`
 *  and `SubagentStop` carries `background_tasks`, the harness's own census of
 *  what is running, and a `SubagentStop`'s census still names the child it
 *  reports ending. */
const running = (...ids: string[]) =>
  ids.map(id => ({
    id,
    type: 'subagent',
    status: 'running',
    description: `Explore ${id}`,
    agent_type: 'Explore',
  }));
const spawn = (id: string) => ({
  hook_event_name: 'SubagentStart',
  agent_id: id,
  agent_type: 'Explore',
});
const stopWith = (...live: string[]) => ({
  ...stop,
  background_tasks: running(...live),
});
const childStop = (id: string, ...stillListed: string[]) => ({
  hook_event_name: 'SubagentStop',
  agent_id: id,
  agent_type: 'Explore',
  background_tasks: running(id, ...stillListed),
});

describe('turn truth: what the operator sees', () => {
  it('an Agent parked on a question reads needs-you, focused or not', () => {
    const h = harness();
    h.hook(submit);
    h.stream(2000);
    h.hook(ask);
    // long enough for BOTH sweeps that used to misread this pause: the
    // working→quiet transition at 3s and the turn-boundary raise at 4s
    h.advance(5000);

    const before = h.light();
    h.focus();
    const after = h.light();

    // Regression: this was `result` then `active` — a green check that became
    // a blue spinner purely because the operator looked at it.
    expect({ before, after }).toEqual({
      before: 'needs-you',
      after: 'needs-you',
    });
  });

  it('answering the question returns the Session to working', () => {
    const h = harness();
    h.hook(submit);
    h.hook(ask);
    h.advance(5000);
    expect(h.light()).toBe('needs-you');

    h.hook(answered);
    h.stream(2000);
    expect(h.light()).toBe('active');
  });

  it('a finished turn still reads as a ready result', () => {
    const h = harness();
    h.hook(submit);
    h.stream(2000);
    h.hook(stop);

    const before = h.light();
    h.focus();
    expect({ before, after: h.light() }).toEqual({
      before: 'result',
      after: 'result',
    });
  });

  it('never claims a result while the harness reports the turn open', () => {
    const h = harness();
    h.hook(submit);
    h.stream(2000);
    // quiescence alone used to conclude "turn finished" here; the harness has
    // reported no Stop, so it must not
    h.advance(5000);

    expect(h.attention.get(SESSION)).toBeNull();
    expect(h.light()).toBe('active');
  });

  it('reclaims an aborted turn the harness never closes', () => {
    // Measured on Claude Code 2.1.220 against every documented hook: an
    // aborted turn emits NO boundary. `UserPromptSubmit` is the last word the
    // harness will ever say about it, so trusting `generating` forever would
    // spin this tab until the operator's next prompt.
    const h = harness();
    h.hook(submit);
    h.stream(2000);

    // Still deferring to the report while it could plausibly be live.
    h.advance(5000);
    expect(h.light()).toBe('active');
    expect(h.attention.get(SESSION)).toBeNull();

    // Past the point where silence with no gate and no children can be
    // explained by anything but a turn that ended without saying so.
    h.advance(9000);
    expect(h.delegation.get(SESSION)?.ownTurn).toBe('available');
    expect(h.attention.get(SESSION)?.kind).toBe('turn-end');

    const before = h.light();
    h.focus();
    expect({ before, after: h.light() }).toEqual({
      before: 'result',
      after: 'result',
    });
  });

  it('never reclaims a turn parked on a gate, however long the silence', () => {
    // A question is silent for exactly as long as the operator takes, and its
    // release is guaranteed (with turn boundaries as the backstop).
    const h = harness();
    h.hook(submit);
    h.stream(2000);
    h.hook(ask);
    h.advance(60_000);
    expect(h.delegation.get(SESSION)?.ownTurn).toBe('generating');
    expect(h.delegation.get(SESSION)?.blockedOn).toBe('question');
    expect(h.attention.get(SESSION)?.kind).not.toBe('turn-end');
  });

  it('a child keeps the turn open for as long as the harness keeps rendering it', () => {
    // The premature-green guard (the BUG-008 family). A parent with a live
    // child is never byte-silent — measured on 2.1.270, the task footer ticks
    // every second for the whole life of the child — so three minutes of
    // that rendering must hold `active` with no result offered, and the
    // child's own reported end is what finally settles it.
    const h = harness();
    h.hook(submit);
    h.stream(2000);
    h.hook(spawn('c1'));
    h.hook(stopWith('c1'));
    for (let minute = 0; minute < 3; minute += 1) {
      h.render(60);
      expect(h.light()).toBe('active');
      expect(h.attention.get(SESSION)).toBeNull();
      expect(h.delegation.get(SESSION)?.children.map(c => c.id)).toEqual([
        'c1',
      ]);
    }
    expect(h.expiries).toEqual([]);

    h.hook(childStop('c1'));
    expect(h.attention.get(SESSION)?.kind).toBe('turn-end');
    const before = h.light();
    h.focus();
    expect({ before, after: h.light() }).toEqual({
      before: 'result',
      after: 'result',
    });
  });

  it('a child whose end the harness never reports cannot spin the tab forever (BUG-081)', () => {
    // The operator's tab: "looks pretty finished; yet the tab shows as blue
    // spinning with two subagent dots." An interrupted parent emits no
    // boundary, and a child that dies with it emits no `SubagentStop`. Before
    // this contract those two dots were trusted until the process exited.
    const h = harness();
    h.hook(submit);
    h.stream(2000);
    h.hook(spawn('c1'));
    h.hook(spawn('c2'));
    expect(h.light()).toBe('active');

    // Inside the stale bound the report is still honored.
    h.advance(5000);
    expect(h.light()).toBe('active');
    expect(h.delegation.get(SESSION)?.children).toHaveLength(2);

    // Past it, with no gate and no bytes, nothing vouches for the census.
    h.advance(9000);
    expect(h.delegation.get(SESSION)?.children).toEqual([]);
    expect(h.delegation.get(SESSION)?.ownTurn).toBe('available');
    const before = h.light();
    h.focus();
    expect({ before, after: h.light() }).toEqual({
      before: 'result',
      after: 'result',
    });
    // ...and the next report is a file read: which children, and why.
    expect(h.expiries).toEqual([
      expect.objectContaining({
        event: CENSUS_EXPIRED_EVENT,
        sessionId: SESSION,
        harness: 'claude',
        childIds: ['c1', 'c2'],
        ownTurn: 'generating',
        staleMs: 12_000,
      }),
    ]);
    expect(h.expiries[0].quietMs).toBeGreaterThanOrEqual(12_000);
  });

  it('withdrawing an expired census delivers the result the parent already reported', () => {
    // The parent's Stop was real; only the children held its result back.
    const h = harness();
    h.hook(submit);
    h.stream(2000);
    h.hook(spawn('c1'));
    h.hook(stopWith('c1'));
    expect(h.attention.get(SESSION)).toBeNull();
    h.advance(13_000);
    expect(h.attention.get(SESSION)?.kind).toBe('turn-end');
    expect(h.light()).toBe('result');
    expect(h.expiries[0]).toMatchObject({
      childIds: ['c1'],
      ownTurn: 'available',
    });
  });

  it("a lost SubagentStop cannot outlive the parent's next boundary", () => {
    // The harness re-proves its census on every boundary it emits. When c2's
    // stop never reaches the loopback, the turn its result reopens ends with
    // a census that no longer names it — healed by the harness, not by
    // inference, so nothing is logged as expired.
    const h = harness();
    h.hook(submit);
    h.stream(2000);
    h.hook(spawn('c1'));
    h.hook(spawn('c2'));
    h.hook(stopWith('c1', 'c2'));
    h.render(30);
    h.hook(childStop('c1', 'c2'));
    expect(h.delegation.get(SESSION)?.children.map(c => c.id)).toEqual(['c2']);
    h.render(30);
    // c2's SubagentStop is lost; its result still reopens the parent's turn
    h.hook(submit);
    h.stream(1500);
    h.hook(stopWith());
    expect(h.delegation.get(SESSION)?.children).toEqual([]);
    expect(h.light()).toBe('result');
    expect(h.attention.get(SESSION)?.kind).toBe('turn-end');
    expect(h.expiries).toEqual([]);
  });

  it('a census admits a child whose start was lost', () => {
    const h = harness();
    h.hook(submit);
    h.stream(2000);
    h.hook(stopWith('c9'));
    expect(h.delegation.get(SESSION)?.children).toEqual([
      expect.objectContaining({
        id: 'c9',
        agentType: 'Explore',
        description: 'Explore c9',
      }),
    ]);
    expect(h.light()).toBe('active');
    expect(h.attention.get(SESSION)).toBeNull();
  });

  it("a SubagentStop's census still names the child it ends, and must not resurrect it", () => {
    const h = harness();
    h.hook(submit);
    h.hook(spawn('c1'));
    h.hook(spawn('c2'));
    h.hook(childStop('c1', 'c2'));
    expect(h.delegation.get(SESSION)?.children.map(c => c.id)).toEqual(['c2']);
  });

  it('an interrupted parent whose children outlive it lands when they return (2.1.270)', () => {
    // Measured 2026-09-13: ESC mid-turn emits nothing and the background
    // children survive it, still rendered every second; each one's return
    // reopens the parent's turn, whose Stop carries the shrinking census.
    const h = harness();
    h.hook(submit);
    h.stream(2000);
    h.hook(spawn('c1'));
    h.hook(spawn('c2'));
    // ESC: no boundary. The team is genuinely still working, and says so.
    h.render(70);
    expect(h.light()).toBe('active');
    expect(h.expiries).toEqual([]);
    h.hook(childStop('c2', 'c1'));
    h.hook(submit);
    h.stream(1500);
    h.hook(stopWith('c1'));
    expect(h.light()).toBe('active');
    h.render(10);
    h.hook(childStop('c1'));
    h.hook(submit);
    h.stream(1500);
    h.hook(stopWith());
    expect(h.light()).toBe('result');
    expect(h.attention.get(SESSION)?.kind).toBe('turn-end');
    expect(h.expiries).toEqual([]);
  });

  it('the queue and the light never disagree about a finished turn', () => {
    // The reclaim and the inferred raise are gated on ONE condition, so there
    // is no window where ⌘J offers a ready result the strip is not showing.
    const h = harness();
    h.hook(submit);
    h.stream(2000);
    for (let elapsed = 0; elapsed < 20_000; elapsed += 1000) {
      h.advance(1000);
      const queued = h.attention.get(SESSION)?.kind === 'turn-end';
      const shown = h.light() === 'result';
      expect(queued).toBe(shown);
    }
  });

  it('never reclaims a turn that is still streaming (BUG-008)', () => {
    // Measured on a real long Session, 2026-08-07: the tab showed a green
    // result for minutes while the Agent was visibly working, then corrected
    // itself to the working spinner only when a delegated child spawned.
    //
    // The pause is what did it. A slow first token is longer than the 3s
    // working window, so the sweep latched the Session `settled`; the latch
    // then dropped every subsequent byte in `onData` — including the
    // quiescence clock — so no amount of streaming could look like speech,
    // and at 12s the stale-report reclaim ended a turn the harness had never
    // stopped reporting as open.
    const h = harness();
    h.hook(submit);
    h.advance(5000); // thinking longer than the working window before output
    expect(h.light()).toBe('active');

    for (let elapsed = 0; elapsed < 60_000; elapsed += 1000) {
      h.stream(2000);
      h.advance(1000);
      expect(h.light()).toBe('active');
    }
    // and the Agent's own output is what says so, not just the report
    expect(h.attention.isWorking(SESSION)).toBe(true);
    expect(h.delegation.get(SESSION)?.ownTurn).toBe('generating');

    // the reported boundary still settles it the instant it arrives
    h.hook(stop);
    expect(h.light()).toBe('result');
  });

  it('still infers a turn boundary for a source that reports nothing', () => {
    const h = harness();
    h.stream(2000);
    h.advance(5000);

    // no hooks at all — inference is the whole channel and must stay live
    expect(h.attention.get(SESSION)?.kind).toBe('turn-end');
    expect(h.light()).toBe('result');
  });

  it('a question raised after a result displaces it', () => {
    const h = harness();
    h.stream(2000);
    h.advance(5000);
    expect(h.attention.get(SESSION)?.kind).toBe('turn-end');

    h.hook(ask);
    expect(h.attention.get(SESSION)?.kind).toBe('blocked');
    expect(h.light()).toBe('needs-you');
  });

  it('a turn boundary releases a gate whose own release went missing', () => {
    const h = harness();
    h.hook(ask);
    expect(h.light()).toBe('needs-you');

    // no PostToolUse ever arrives — a dropped hook, a killed listener
    h.hook(stop);
    expect(h.delegation.get(SESSION)?.blockedOn).toBeNull();
    expect(h.light()).toBe('result');
  });

  it('survives the double report a real AskUserQuestion makes', () => {
    // The observed sequence from Claude Code 2.1.220, verbatim: one question,
    // announced twice, six seconds apart, under two different names.
    const h = harness();
    h.hook(submit);
    h.hook(ask);
    h.hook({
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
    });
    expect(h.delegation.get(SESSION)?.blockedOn).toBe('question');
    expect(h.light()).toBe('needs-you');

    // the release is scoped to the reason the FIRST report set
    h.hook(answered);
    expect(h.delegation.get(SESSION)?.blockedOn).toBeNull();
    h.stream(2000);
    expect(h.light()).toBe('active');
  });

  it('a resolved tool batch cannot answer an open question', () => {
    const h = harness();
    h.hook(submit);
    h.hook(ask);
    // PostToolBatch is the release for a GRANTED PERMISSION and nothing else.
    // Ordering it against an open question must not matter.
    h.hook({ hook_event_name: 'PostToolBatch' });
    expect(h.light()).toBe('needs-you');
  });

  it('releases a permission gate when the batch it blocked resolves', () => {
    const h = harness();
    h.hook(submit);
    h.hook({
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
    });
    expect(h.light()).toBe('needs-you');

    h.hook({ hook_event_name: 'PostToolBatch' });
    h.stream(2000);
    expect(h.light()).toBe('active');
  });

  it('an idle prompt is not an operator gate', () => {
    const h = harness();
    h.hook(submit);
    h.hook({
      hook_event_name: 'Notification',
      notification_type: 'idle_prompt',
    });
    // every finished Session goes idle eventually; treating that as "needs
    // you" would light the whole fleet
    expect(h.delegation.get(SESSION)?.blockedOn).toBeNull();
  });

  it('a delegating parent never reads as finished (ENG-023 D1 holds)', () => {
    const h = harness();
    h.hook(submit);
    h.hook({
      hook_event_name: 'SubagentStart',
      agent_id: 'child-1',
      agent_type: 'Explore',
    });
    h.hook(stop);
    h.advance(5000);

    const before = h.light();
    h.focus();
    expect({ before, after: h.light() }).toEqual({
      before: 'active',
      after: 'active',
    });
  });
});

describe('claudeHookEvent normalization', () => {
  const cases: Array<[string, Record<string, unknown>, HarnessEvent | null]> = [
    ['question opens a gate', ask, { kind: 'blocked', reason: 'question' }],
    [
      'the answer closes exactly that gate',
      answered,
      { kind: 'unblocked', reason: 'question' },
    ],
    [
      'permission prompts are gates',
      {
        hook_event_name: 'Notification',
        notification_type: 'permission_prompt',
      },
      { kind: 'blocked', reason: 'permission' },
    ],
    [
      'MCP elicitation is a gate',
      {
        hook_event_name: 'Notification',
        notification_type: 'elicitation_dialog',
      },
      { kind: 'blocked', reason: 'elicitation' },
    ],
    [
      'idle is not a gate',
      { hook_event_name: 'Notification', notification_type: 'idle_prompt' },
      null,
    ],
    [
      'an unknown notification type is not a gate',
      { hook_event_name: 'Notification', notification_type: 'auth_success' },
      null,
    ],
    [
      'ordinary tools report nothing',
      { hook_event_name: 'PreToolUse', tool_name: 'Bash' },
      null,
    ],
    [
      'ordinary tool completions report nothing',
      { hook_event_name: 'PostToolUse', tool_name: 'Edit' },
      null,
    ],
    [
      'a question inside a child is still the operator’s question',
      { ...ask, agent_id: 'child-1' },
      { kind: 'blocked', reason: 'question' },
    ],
  ];

  it.each(cases)('%s', (_name, payload, expected) => {
    expect(claudeHookEvent(payload, 1)).toEqual(expected);
  });
});

describe('source-reported background work (BUG-145)', () => {
  const monitor = { id: 'monitor-1', type: 'monitor', status: 'running' };
  it('keeps a silent monitor active without inventing an Agent, until the source withdraws it', () => {
    const h = harness();
    h.hook({ hook_event_name: 'UserPromptSubmit' });
    h.stream(2000);
    h.manager.emit('data', SESSION, '\x07');
    expect(h.attention.get(SESSION)?.kind).toBe('bell');
    h.hook({ hook_event_name: 'Stop', background_tasks: [monitor] });
    expect(h.delegation.getLive(SESSION)?.children).toEqual([]);
    expect(h.light()).toBe('active');
    h.advance(600_000);
    h.manager.emit('data', SESSION, '\x07');
    expect(h.attention.get(SESSION)).toBeNull();
    expect(h.light()).toBe('active');
    h.focus();
    expect(h.light()).toBe('active');
    h.unfocus();
    h.hook({ hook_event_name: 'Stop', background_tasks: [] });
    expect(h.light()).toBe('result');
    expect(h.delegation.getLive(SESSION)).toBeNull();
    expect(h.expiries).toEqual([]);
  });

  it('keeps actual questions visible while a background monitor runs', () => {
    const h = harness();
    h.hook({ hook_event_name: 'Stop', background_tasks: [monitor] });
    h.hook(ask);
    expect(h.light()).toBe('needs-you');
    h.focus();
    expect(h.light()).toBe('needs-you');
    h.hook({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion' });
    expect(h.light()).toBe('active');
  });

  it('does not lose background evidence to a legacy boundary, and drops it with the Session', () => {
    const h = harness();
    h.hook({ hook_event_name: 'Stop', background_tasks: [monitor] });
    h.hook({ hook_event_name: 'Stop' });
    expect(h.light()).toBe('active');
    h.delegation.drop(SESSION);
    expect(h.delegation.getLive(SESSION)).toBeNull();
  });
});

it('lets protocol snapshots correct an ambient bell without a synthetic turn boundary', () => {
  const h = harness();
  h.manager.emit('data', SESSION, '\x07');
  expect(h.attention.get(SESSION)?.kind).toBe('bell');
  h.delegation.reconcileReportedChildren(SESSION, [
    { id: 'remote-child', agentType: null, description: null, startedAt: 1 },
  ]);
  expect(h.attention.get(SESSION)).toBeNull();
  expect(h.light()).toBe('active');
});
