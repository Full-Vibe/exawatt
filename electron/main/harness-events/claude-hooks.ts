/**
 * Claude Code adapter for the harness event channel (ENG-023 D1).
 *
 * Claude Code reports its own delegation through documented lifecycle hooks.
 * Exawatt subscribes by passing `--settings <file>` on the launch command, which
 * was verified during the design pass to MERGE with the user's own project and
 * local hooks rather than replace them. Nothing under `~/.claude` is written,
 * read, or assumed on this path — which is what makes the feature safe to ship
 * to users whose machines look nothing like the author's.
 *
 * Deliberately NOT subscribed: `PostToolUse`. It fires inside every child for
 * every tool call and would turn a delegation surface into an activity ticker,
 * which `docs/product/reference/agent-state.md` rules out. D2 needs child
 * labels, not child keystrokes.
 */
import type { HarnessEvent } from './delegation-state';

/** Kept low on purpose: every hook runs INSIDE the harness turn, so this is
 *  the operator's latency, not ours. A dead listener fails open. */
const HOOK_TIMEOUT_SECONDS = 2;

const SUBSCRIBED_EVENTS = [
  'UserPromptSubmit',
  'Stop',
  'SubagentStart',
  'SubagentStop',
] as const;

export const CLAUDE_HOOK_HEADER = 'x-exawatt-token';

/**
 * The settings document Exawatt injects for one launch.
 *
 * Additional settings only — it names hooks and nothing else, so it cannot
 * disturb the user's model, permissions, or any other configuration.
 */
export function claudeHookSettings(port: number, token: string): string {
  const endpoint = {
    type: 'http' as const,
    url: `http://127.0.0.1:${port}/hook`,
    headers: { [CLAUDE_HOOK_HEADER]: token },
    timeout: HOOK_TIMEOUT_SECONDS,
  };
  const hooks = Object.fromEntries(
    SUBSCRIBED_EVENTS.map(event => [event, [{ hooks: [endpoint] }]])
  );
  return JSON.stringify({ hooks }, null, 2);
}

function readString(
  source: Record<string, unknown>,
  key: string
): string | null {
  const value = source[key];
  return typeof value === 'string' && value ? value : null;
}

/**
 * Normalize one hook payload into the source-agnostic event vocabulary.
 *
 * `null` means "nothing this channel models" and is the expected outcome for
 * plenty of traffic — an unknown event name, or a turn boundary belonging to a
 * child rather than to the Session itself.
 */
export function claudeHookEvent(
  payload: unknown,
  at: number
): HarnessEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const name = readString(record, 'hook_event_name');
  if (!name) return null;
  // `agent_id` on a payload means the hook fired INSIDE a subagent. A child's
  // own turn boundary is not its parent's: honoring one would flip the parent
  // to `generating` every time any child took a step. Observed behavior today
  // is that Stop does not fire for children, but the model must not depend on
  // that staying true.
  const insideChild = !!readString(record, 'agent_id');

  switch (name) {
    case 'UserPromptSubmit':
      return insideChild ? null : { kind: 'turn-start' };
    case 'Stop':
      return insideChild ? null : { kind: 'turn-end' };
    case 'SubagentStart': {
      const childId = readString(record, 'agent_id');
      if (!childId) return null;
      return {
        kind: 'child-start',
        childId,
        agentType: readString(record, 'agent_type'),
        at,
      };
    }
    case 'SubagentStop': {
      const childId = readString(record, 'agent_id');
      if (!childId) return null;
      return { kind: 'child-end', childId };
    }
    default:
      return null;
  }
}
