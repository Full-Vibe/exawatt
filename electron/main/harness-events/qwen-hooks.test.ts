import { describe, expect, it } from 'vitest';
import {
  applyHarnessEvent,
  EMPTY_LEDGER,
  type DelegationLedger,
} from './delegation-state';
import {
  QWEN_HOOK_HEADER,
  qwenHookEvent,
  qwenHookSessionId,
  qwenHookSettings,
} from './qwen-hooks';

/**
 * The Qwen Code adapter (ENG-003 S5.2). Payloads are the shapes Qwen Code
 * 0.24.4 posted to a loopback listener during the S5.2 probe, trimmed of
 * paths and timestamps; none are invented.
 */

const SESSION = 'cccccccc-2222-4333-8444-555555555555';
const common = { session_id: SESSION, prompt_id: `${SESSION}########0` };

const payload = {
  submit: {
    ...common,
    hook_event_name: 'UserPromptSubmit',
    prompt: 'AGENT go',
    submitted_prompt: 'AGENT go',
  },
  continuation: { ...common, hook_event_name: 'UserPromptSubmit', prompt: '' },
  stop: {
    ...common,
    hook_event_name: 'Stop',
    stop_hook_active: false,
    background_tasks: [],
    crons: [],
  },
  stopFailure: {
    ...common,
    hook_event_name: 'StopFailure',
    error: 'rate_limit',
  },
  idle: {
    ...common,
    hook_event_name: 'Notification',
    message: 'Qwen Code is waiting for your input',
    notification_type: 'idle_prompt',
    title: 'Waiting for input',
  },
  permissionPrompt: {
    ...common,
    hook_event_name: 'Notification',
    message: 'Qwen Code needs your permission to use agent',
    notification_type: 'permission_prompt',
    title: 'Permission needed',
  },
  permissionRequest: {
    ...common,
    hook_event_name: 'PermissionRequest',
    tool_name: 'run_shell_command',
    tool_input: { command: 'ls' },
  },
  question: {
    ...common,
    hook_event_name: 'PermissionRequest',
    tool_name: 'ask_user_question',
    tool_input: { questions: [] },
  },
  batch: {
    ...common,
    hook_event_name: 'PostToolBatch',
    tool_calls: [{ tool_name: 'agent', tool_call_id: 'call_1' }],
  },
  spawn: {
    ...common,
    hook_event_name: 'PreToolUse',
    tool_name: 'agent',
    tool_use_id: 'toolu_1790223137605_x1',
    tool_call_id: 'call_1',
    tool_input: {
      description: 'Probe child label',
      prompt: 'SUBTASK: reply done',
      subagent_type: 'general-purpose',
    },
  },
  childStart: {
    ...common,
    hook_event_name: 'SubagentStart',
    agent_id: 'general-purpose-call_1',
    agent_type: 'general-purpose',
  },
  childStop: {
    ...common,
    hook_event_name: 'SubagentStop',
    agent_id: 'general-purpose-call_1',
    agent_type: 'general-purpose',
    stop_hook_active: false,
    background_tasks: [
      {
        id: 'general-purpose-call_1',
        status: 'running',
        agent_type: 'general-purpose',
        started_at: '2026-09-24T04:17:36.101Z',
        description: 'Probe child label',
      },
    ],
  },
  stopWithCompletedChild: {
    ...common,
    hook_event_name: 'Stop',
    stop_hook_active: false,
    background_tasks: [
      {
        id: 'general-purpose-call_1',
        status: 'completed',
        agent_type: 'general-purpose',
        started_at: '2026-09-24T04:17:36.101Z',
        description: 'Probe child label',
      },
    ],
  },
};

function replay(...payloads: unknown[]): DelegationLedger {
  let at = 1_000;
  return payloads.reduce<DelegationLedger>((state, next) => {
    at += 10;
    const event = qwenHookEvent(next, at);
    return event ? applyHarnessEvent(state, event) : state;
  }, EMPTY_LEDGER);
}

describe('qwenHookSettings', () => {
  const settings = JSON.parse(qwenHookSettings(51234, 'tok-abc'));

  it('posts every subscription to the loopback channel with a short timeout', () => {
    expect(Object.keys(settings.hooks).sort()).toEqual([
      'Notification',
      'PermissionRequest',
      'PostToolBatch',
      'PreToolUse',
      'Stop',
      'StopFailure',
      'SubagentStart',
      'SubagentStop',
      'UserPromptSubmit',
    ]);
    for (const groups of Object.values(settings.hooks) as Array<
      Array<{ hooks: Array<Record<string, unknown>> }>
    >) {
      for (const group of groups) {
        expect(group.hooks).toEqual([
          {
            type: 'http',
            name: 'exawatt',
            url: 'http://127.0.0.1:51234/hook',
            headers: { [QWEN_HOOK_HEADER]: 'tok-abc' },
            timeout: 2,
          },
        ]);
      }
    }
  });

  it('subscribes per-tool events only for the delegation tool', () => {
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0].matcher).toBe('^agent$');
    expect(settings.hooks.PostToolUse).toBeUndefined();
  });

  it('carries an administrator defaults document instead of replacing it', () => {
    const admin = JSON.stringify({
      general: { enableAutoUpdate: false },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'audit' }] }] },
    });
    const merged = JSON.parse(qwenHookSettings(1, 't', admin));
    expect(merged.general).toEqual({ enableAutoUpdate: false });
    expect(merged.hooks.Stop).toHaveLength(2);
    expect(merged.hooks.Stop[0].hooks[0].command).toBe('audit');
  });

  it('refuses to inject over an administrator document it cannot read', () => {
    expect(() => qwenHookSettings(1, 't', '[not an object]')).toThrow();
    expect(() => qwenHookSettings(1, 't', '[]')).toThrow();
  });
});

describe('qwenHookEvent', () => {
  it('starts a turn only for the operator submission, not a continuation', () => {
    expect(qwenHookEvent(payload.submit, 1)).toEqual({ kind: 'turn-start' });
    expect(qwenHookEvent(payload.continuation, 1)).toBeNull();
  });

  it('ends the turn on Stop, StopFailure, and the return to the prompt', () => {
    expect(qwenHookEvent(payload.stop, 5)).toEqual({
      kind: 'turn-end',
      census: { live: [], completed: [], at: 5, backgroundTasks: [] },
    });
    expect(qwenHookEvent(payload.stopFailure, 5)).toEqual({
      kind: 'turn-end',
    });
    expect(qwenHookEvent(payload.idle, 5)).toEqual({ kind: 'turn-end' });
  });

  it('tells a question from a permission by the requested tool', () => {
    expect(qwenHookEvent(payload.question, 1)).toEqual({
      kind: 'blocked',
      reason: 'question',
    });
    expect(qwenHookEvent(payload.permissionRequest, 1)).toEqual({
      kind: 'blocked',
      reason: 'permission',
    });
    expect(qwenHookEvent(payload.batch, 1)).toEqual({ kind: 'unblocked' });
  });

  it('keys a spawn label by the stable tool call id', () => {
    expect(qwenHookEvent(payload.spawn, 7)).toEqual({
      kind: 'child-label',
      toolUseId: 'call_1',
      agentType: 'general-purpose',
      description: 'Probe child label',
      at: 7,
    });
  });

  it('never reads a child boundary as the parent turn', () => {
    const inside = { ...payload.stop, agent_id: 'general-purpose-call_1' };
    expect(qwenHookEvent(inside, 1)).toBeNull();
    expect(
      qwenHookEvent(
        { ...payload.submit, agent_id: 'general-purpose-call_1' },
        1
      )
    ).toBeNull();
  });

  it('ignores what it does not model', () => {
    expect(
      qwenHookEvent({ ...common, hook_event_name: 'SessionStart' }, 1)
    ).toBeNull();
    expect(qwenHookEvent(null, 1)).toBeNull();
    expect(qwenHookEvent('Stop', 1)).toBeNull();
  });

  it('names the harness session a payload came from', () => {
    expect(qwenHookSessionId(payload.stop)).toBe(SESSION);
    expect(qwenHookSessionId({})).toBeNull();
  });
});

describe('Qwen Code sequences observed in the probe', () => {
  it('a normal turn ends available', () => {
    const state = replay(payload.submit, payload.stop, payload.idle);
    expect(state.ownTurn).toBe('available');
    expect(state.blockedOn).toBeNull();
  });

  it('an approved permission opens and closes one gate', () => {
    const waiting = replay(
      payload.submit,
      payload.permissionRequest,
      payload.permissionPrompt
    );
    expect(waiting.blockedOn).toBe('permission');
    const done = replay(
      payload.submit,
      payload.permissionRequest,
      payload.permissionPrompt,
      payload.batch,
      payload.continuation,
      payload.stop,
      payload.idle
    );
    expect(done.blockedOn).toBeNull();
    expect(done.ownTurn).toBe('available');
  });

  it('a question keeps its reason when the permission notice follows it', () => {
    const state = replay(
      payload.submit,
      payload.question,
      payload.permissionPrompt
    );
    expect(state.blockedOn).toBe('question');
  });

  it('a rejected permission, which sends no Stop, still ends the turn', () => {
    const state = replay(
      payload.submit,
      payload.permissionRequest,
      payload.permissionPrompt,
      payload.batch,
      payload.idle
    );
    expect(state.ownTurn).toBe('available');
    expect(state.blockedOn).toBeNull();
  });

  it('a cancel, which sends no Stop, still ends the turn', () => {
    expect(replay(payload.submit, payload.idle).ownTurn).toBe('available');
  });

  it('a delegated child is labeled, stays live past its own stop notice, and completes', () => {
    const running = replay(payload.submit, payload.spawn, payload.childStart);
    expect(running.children).toEqual([
      expect.objectContaining({
        id: 'general-purpose-call_1',
        agentType: 'general-purpose',
        description: 'Probe child label',
      }),
    ]);
    const finished = replay(
      payload.submit,
      payload.spawn,
      payload.childStart,
      payload.childStop,
      payload.stopWithCompletedChild,
      payload.idle
    );
    expect(finished.children).toEqual([]);
    expect(finished.ownTurn).toBe('available');
  });
});
