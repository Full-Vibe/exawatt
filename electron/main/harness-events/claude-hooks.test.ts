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
    // agent-state rules out. Every registration must carry a matcher naming
    // the tools it wants: the operator gate (D4), and the delegation tools
    // whose PreToolUse is the spawn label — one post per handoff, not an
    // activity stream (D3a). This assertion is the guard on that decision.
    const allowed = new Set(['AskUserQuestion', 'Agent|Task']);
    for (const group of settings.hooks.PreToolUse) {
      expect(allowed.has(group.matcher)).toBe(true);
    }
    for (const group of settings.hooks.PostToolUse) {
      expect(group.matcher).toBe('AskUserQuestion');
    }
  });

  it('subscribes the spawn label matched to the delegation tools alone', () => {
    const matchers = settings.hooks.PreToolUse.map(
      (group: { matcher: string }) => group.matcher
    );
    expect(matchers).toContain('Agent|Task');
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

  it('maps a spawn label from the parent into child-label (D3a)', () => {
    expect(
      claudeHookEvent(
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'Agent',
          tool_use_id: 'toolu_spawn1',
          tool_input: {
            description: 'Map Sessions tab + subagent viz',
            subagent_type: 'Explore',
            prompt: 'a very long private prompt that must not ride along',
          },
        },
        5_000
      )
    ).toEqual({
      kind: 'child-label',
      toolUseId: 'toolu_spawn1',
      agentType: 'Explore',
      description: 'Map Sessions tab + subagent viz',
      at: 5_000,
    });
  });

  it('accepts the Task spelling of the delegation tool', () => {
    const event = claudeHookEvent(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Task',
        tool_use_id: 'toolu_spawn2',
        tool_input: { description: 'Fix flaky test' },
      },
      1
    );
    expect(event).toMatchObject({ kind: 'child-label', agentType: null });
  });

  it('never carries the child prompt, only the label', () => {
    const event = claudeHookEvent(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Agent',
        tool_use_id: 'toolu_spawn3',
        tool_input: {
          description: 'Short label',
          prompt: 'PRIVATE_PROMPT_BODY',
        },
      },
      1
    );
    expect(JSON.stringify(event)).not.toContain('PRIVATE_PROMPT_BODY');
  });

  it('truncates an oversized label at ingestion', () => {
    const event = claudeHookEvent(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Agent',
        tool_use_id: 'toolu_spawn4',
        tool_input: { description: 'x'.repeat(400) },
      },
      1
    );
    expect(event?.kind).toBe('child-label');
    if (event?.kind === 'child-label') {
      expect(event.description.length).toBeLessThanOrEqual(140);
      expect(event.description.endsWith('…')).toBe(true);
    }
  });

  it("ignores a grandchild's spawn label — it is not this Session's child", () => {
    expect(
      claudeHookEvent(
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'Agent',
          tool_use_id: 'toolu_spawn5',
          agent_id: 'child-1',
          tool_input: { description: 'Grandchild work' },
        },
        1
      )
    ).toBeNull();
  });

  it('drops a spawn label with no description rather than inventing one', () => {
    expect(
      claudeHookEvent(
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'Agent',
          tool_use_id: 'toolu_spawn6',
          tool_input: {},
        },
        1
      )
    ).toBeNull();
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
