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
import type { StatusLightState } from '@/components/status-light/protocol';
import { sessionGlyphState, sessionStatusLightState } from './session-status';

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

/** The real wiring from `pty-ipc`, minus Electron. */
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
  attention.setReportedTurnSource(id => delegation.get(id));
  attention.setWindowFocused(true);
  attention.setFocus(OTHER);

  /** Replay one Claude Code hook payload through the real adapter and the
   *  real subscriber order (delegation first, then attention). */
  const hook = (payload: Record<string, unknown>) => {
    const event = claudeHookEvent(payload, clock);
    if (!event) return null;
    delegation.apply(SESSION, event);
    if (event.kind === 'turn-start') attention.noteHarnessTurnStart(SESSION);
    if (event.kind === 'turn-end') attention.noteHarnessTurnEnd(SESSION);
    if (event.kind === 'blocked') attention.noteHarnessBlocked(SESSION);
    if (event.kind === 'unblocked') attention.noteHarnessUnblocked(SESSION);
    return event;
  };
  // exactly what `pty-ipc` wires: inference reclaiming a stale report
  attention.on('reported-turn-stale', (id: string) => {
    delegation.apply(id, { kind: 'turn-end' });
  });

  /** What the tab strip, the ⌘K row, and exposé all render from. */
  const light = (): StatusLightState => {
    const reported = delegation.getLive(SESSION);
    return sessionStatusLightState({
      state: sessionGlyphState({
        working: attention.isWorking(SESSION),
        agent: true,
        started: true,
        delegatedBusy: (reported?.children.length ?? 0) > 0,
        blocked: !!reported?.blockedOn,
        ownTurn: reported?.ownTurn,
      }),
      attention: attention.get(SESSION),
    });
  };

  return {
    attention,
    delegation,
    hook,
    light,
    stream: (bytes: number) =>
      manager.emit('data', SESSION, 'x'.repeat(bytes)),
    advance: (ms: number) => {
      clock += ms;
      attention.sweepNow();
    },
    /** the operator presses ⌘4 */
    focus: () => attention.setFocus(SESSION),
    unfocus: () => attention.setFocus(OTHER),
  };
}

const ask = { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' };
const answered = { hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion' };
const submit = { hook_event_name: 'UserPromptSubmit' };
const stop = { hook_event_name: 'Stop' };

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

  it('never reclaims a turn whose silence is explained', () => {
    // A question and a running child are both silent for as long as they need
    // to be, and both end with an event the harness guarantees.
    for (const explain of [
      () => ask,
      () => ({
        hook_event_name: 'SubagentStart',
        agent_id: 'c1',
        agent_type: 'Explore',
      }),
    ]) {
      const h = harness();
      h.hook(submit);
      h.stream(2000);
      h.hook(explain());
      h.advance(60_000);
      expect(h.delegation.get(SESSION)?.ownTurn).toBe('generating');
      expect(h.attention.get(SESSION)?.kind).not.toBe('turn-end');
    }
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
      { hook_event_name: 'Notification', notification_type: 'permission_prompt' },
      { kind: 'blocked', reason: 'permission' },
    ],
    [
      'MCP elicitation is a gate',
      { hook_event_name: 'Notification', notification_type: 'elicitation_dialog' },
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
