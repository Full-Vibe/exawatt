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

describe('claudeHookSettings with safety controls (ENG-044)', () => {
  const guarded = JSON.parse(
    claudeHookSettings(51234, 'tok-abc', { processKillGuard: true })
  );
  const guardGroups = (document: {
    hooks: {
      PreToolUse: Array<{ matcher: string; hooks: Array<{ url: string }> }>;
    };
  }) =>
    document.hooks.PreToolUse.filter(group =>
      group.hooks.some(hook => hook.url.endsWith('/guard'))
    );

  it('carries no deciding hook unless the operator turned a control on', () => {
    for (const safety of [undefined, {}, { processKillGuard: false }]) {
      const document = JSON.parse(claudeHookSettings(51234, 'tok-abc', safety));
      expect(guardGroups(document)).toEqual([]);
    }
  });

  it('adds one deciding hook, matched to shell commands, on the guard path', () => {
    const [group, ...rest] = guardGroups(guarded);
    expect(rest).toEqual([]);
    expect(group.matcher).toBe('Bash');
    expect(group.hooks).toEqual([
      expect.objectContaining({
        type: 'http',
        url: 'http://127.0.0.1:51234/guard',
        headers: { 'x-exawatt-token': 'tok-abc' },
      }),
    ]);
  });

  it('leaves every event subscription exactly as it was', () => {
    const plain = JSON.parse(claudeHookSettings(51234, 'tok-abc'));
    const withoutGuard = {
      hooks: {
        ...guarded.hooks,
        PreToolUse: guarded.hooks.PreToolUse.filter(
          (group: { matcher: string }) => group.matcher !== 'Bash'
        ),
      },
    };
    expect(withoutGuard).toEqual(plain);
  });
});

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
    const allowed = new Set(['AskUserQuestion', '^(Agent|Task)$']);
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
    expect(matchers).toContain('^(Agent|Task)$');
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

/**
 * The census Claude Code attaches to its boundaries (ENG-023 D7). Shapes
 * measured on 2.1.270, 2026-09-13: `background_tasks` on every `Stop` and
 * `SubagentStop`, subagents and background shells alike, and a
 * `SubagentStop`'s list still naming the child it reports ending.
 */
describe('claudeHookEvent census', () => {
  const tasks = [
    {
      id: 'ad50fdae07f15e180',
      type: 'subagent',
      status: 'running',
      description: 'Count .md files after sleep',
      agent_type: 'Explore',
    },
    {
      id: 'a1d18df24598be411',
      type: 'subagent',
      status: 'running',
      description: 'Count .txt files after sleep',
      agent_type: 'Explore',
    },
    {
      id: 'b45hgpvbg',
      type: 'shell',
      status: 'running',
      description: 'Wait 60 seconds in background',
      command: 'sleep 60',
    },
    {
      id: 'done1',
      type: 'subagent',
      status: 'completed',
      agent_type: 'Explore',
    },
    { id: 'dead1', type: 'subagent', status: 'failed', agent_type: 'Explore' },
  ];

  it('reads the running subagents off a Stop as the live census, shells excluded', () => {
    expect(
      claudeHookEvent({ hook_event_name: 'Stop', background_tasks: tasks }, 7)
    ).toEqual({
      kind: 'turn-end',
      census: {
        live: [
          {
            id: 'ad50fdae07f15e180',
            agentType: 'Explore',
            description: 'Count .md files after sleep',
            startedAt: null,
          },
          {
            id: 'a1d18df24598be411',
            agentType: 'Explore',
            description: 'Count .txt files after sleep',
            startedAt: null,
          },
        ],
        completed: ['done1'],
        backgroundTasks: [{ id: 'b45hgpvbg', type: 'shell' }],
        at: 7,
      },
    });
  });

  it('excludes from a SubagentStop census the child that payload reports ending', () => {
    const event = claudeHookEvent(
      {
        hook_event_name: 'SubagentStop',
        agent_id: 'ad50fdae07f15e180',
        agent_type: 'Explore',
        background_tasks: tasks,
        last_assistant_message: 'PRIVATE_REPORT_BODY',
      },
      7
    );
    expect(event).toMatchObject({
      kind: 'child-end',
      childId: 'ad50fdae07f15e180',
    });
    expect(
      event && 'census' in event ? event.census?.live.map(c => c.id) : null
    ).toEqual(['a1d18df24598be411']);
    expect(JSON.stringify(event)).not.toContain('PRIVATE_REPORT_BODY');
  });

  it('carries no census when the harness sent none', () => {
    const event = claudeHookEvent({ hook_event_name: 'Stop' }, 1);
    expect(event).toEqual({ kind: 'turn-end' });
    expect(event && 'census' in event).toBe(false);
    expect(
      claudeHookEvent({ hook_event_name: 'Stop', background_tasks: 'nope' }, 1)
    ).toEqual({ kind: 'turn-end' });
  });

  it('never invents a child from a malformed entry, and clips a census label', () => {
    const event = claudeHookEvent(
      {
        hook_event_name: 'Stop',
        background_tasks: [
          null,
          'string',
          { type: 'subagent' },
          { id: 'ok', type: 'subagent', description: 'x'.repeat(500) },
          { id: 'ok', type: 'subagent' },
        ],
      },
      1
    );
    const live = event && 'census' in event ? event.census?.live : undefined;
    expect(live?.map(c => c.id)).toEqual(['ok']);
    expect([...(live?.[0].description ?? '')].length).toBe(140);
  });
});

it('keeps only non-Agent identity and type, including future running task kinds', () => {
  const event = claudeHookEvent(
    {
      hook_event_name: 'Stop',
      background_tasks: [
        {
          id: 'watch',
          type: 'monitor',
          status: 'running',
          description: 'PRIVATE',
          command: 'PRIVATE',
        },
        { id: 'next', type: 'future-kind', status: 'pending' },
        { id: 'ended', type: 'monitor', status: 'completed' },
        { id: 'failed', type: 'shell', status: 'failed' },
        { id: 'watch', type: 'monitor', status: 'running' },
      ],
    },
    1
  );
  expect(event).toEqual({
    kind: 'turn-end',
    census: {
      live: [],
      completed: [],
      at: 1,
      backgroundTasks: [
        { id: 'watch', type: 'monitor' },
        { id: 'next', type: 'future-kind' },
      ],
    },
  });
});
