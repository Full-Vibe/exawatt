import { describe, expect, it } from 'vitest';
import {
  CLAUDE_HOOK_HEADER,
  claudeHookEvent,
  claudeHookSettings,
} from './claude-hooks';

/**
 * The Claude Code adapter (ENG-023 D1). Payload shapes here are the ones
 * observed from a live harness during the design pass, not invented.
 */

describe('claudeHookSettings', () => {
  const settings = JSON.parse(claudeHookSettings(51234, 'tok-abc'));

  it('subscribes to turn boundaries, child boundaries, and operator gates', () => {
    expect(Object.keys(settings.hooks).sort()).toEqual([
      'ElicitationResult',
      'Notification',
      'PostToolBatch',
      'PostToolUse',
      'PreToolUse',
      'Stop',
      'SubagentStart',
      'SubagentStop',
      'UserPromptSubmit',
    ]);
  });

  it('never subscribes to per-tool events UNMATCHED', () => {
    // An unmatched PreToolUse/PostToolUse fires inside every child for every
    // tool call and would turn delegation into an activity ticker, which
    // agent-state rules out. D4 needs exactly one tool — the one that stops
    // and asks the operator — so every registration must carry a matcher that
    // names it. This assertion is the guard on that decision.
    for (const event of ['PreToolUse', 'PostToolUse']) {
      for (const group of settings.hooks[event]) {
        expect(group.matcher).toBe('AskUserQuestion');
      }
    }
  });

  it('matches Notification to gates only, never to idle', () => {
    const matchers = settings.hooks.Notification.map(
      (group: { matcher: string }) => group.matcher
    ).join('|');
    expect(matchers).toContain('permission_prompt');
    expect(matchers).toContain('agent_needs_input');
    // every finished Session goes idle; it is not a request for the operator
    expect(matchers).not.toContain('idle_prompt');
  });

  it('posts to loopback with the launch token and a short timeout', () => {
    const endpoint = settings.hooks.SubagentStart[0].hooks[0];
    expect(endpoint.type).toBe('http');
    expect(endpoint.url).toBe('http://127.0.0.1:51234/hook');
    expect(endpoint.headers[CLAUDE_HOOK_HEADER]).toBe('tok-abc');
    // this runs inside the operator's turn — it must never be a long wait
    expect(endpoint.timeout).toBeLessThanOrEqual(2);
  });

  it('declares hooks and nothing else, so no other setting can be disturbed', () => {
    expect(Object.keys(settings)).toEqual(['hooks']);
  });
});

describe('claudeHookEvent', () => {
  it('maps the parent turn boundaries', () => {
    expect(claudeHookEvent({ hook_event_name: 'UserPromptSubmit' }, 1)).toEqual(
      { kind: 'turn-start' }
    );
    expect(claudeHookEvent({ hook_event_name: 'Stop' }, 1)).toEqual({
      kind: 'turn-end',
    });
  });

  it('maps a child start with its kind and start time', () => {
    expect(
      claudeHookEvent(
        {
          hook_event_name: 'SubagentStart',
          agent_id: 'ad3728ad7a78d6833',
          agent_type: 'Explore',
        },
        7_000
      )
    ).toEqual({
      kind: 'child-start',
      childId: 'ad3728ad7a78d6833',
      agentType: 'Explore',
      at: 7_000,
    });
  });

  it('maps a child stop and ignores the result text it carries', () => {
    const event = claudeHookEvent(
      {
        hook_event_name: 'SubagentStop',
        agent_id: 'ad3728ad7a78d6833',
        agent_type: 'Explore',
        // a real report runs to thousands of characters; D1 never reads it
        last_assistant_message: 'a very long report about private source',
        agent_transcript_path: '/somewhere/agent-ad3728ad7a78d6833.jsonl',
      },
      1
    );
    expect(event).toEqual({
      kind: 'child-end',
      childId: 'ad3728ad7a78d6833',
    });
    expect(JSON.stringify(event)).not.toContain('report');
  });

  it('never lets a CHILD turn boundary move the parent', () => {
    // `agent_id` marks a hook that fired inside a subagent. Honoring one of
    // these would flip the parent to generating every time a child stepped.
    expect(
      claudeHookEvent({ hook_event_name: 'Stop', agent_id: 'child-1' }, 1)
    ).toBeNull();
    expect(
      claudeHookEvent(
        { hook_event_name: 'UserPromptSubmit', agent_id: 'child-1' },
        1
      )
    ).toBeNull();
  });

  it('ignores everything it does not model', () => {
    expect(claudeHookEvent({ hook_event_name: 'PostToolUse' }, 1)).toBeNull();
    expect(claudeHookEvent({ hook_event_name: 'SubagentStart' }, 1)).toBeNull();
    expect(claudeHookEvent({}, 1)).toBeNull();
    expect(claudeHookEvent(null, 1)).toBeNull();
    expect(claudeHookEvent('nope', 1)).toBeNull();
    expect(claudeHookEvent({ hook_event_name: 42 }, 1)).toBeNull();
  });
});
