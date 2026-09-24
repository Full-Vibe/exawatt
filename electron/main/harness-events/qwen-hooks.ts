/**
 * Qwen Code adapter for the harness event channel (ENG-003 S5.2).
 *
 * Qwen Code reports its turns, gates and delegation through lifecycle hooks
 * whose names match Claude Code's, but whose meanings differ in ways that
 * would mislead Claude's normalizer. Each difference below was measured on
 * Qwen Code 0.24.4 against a local model, with every payload captured:
 *
 * - The turn does not always end with `Stop`. A cancel or a rejected
 *   permission returns to the prompt with no `Stop`, and an API failure ends
 *   with `StopFailure`. The one signal that fires on EVERY return to the
 *   prompt is `Notification[idle_prompt]`, so here it means "turn over". That
 *   is the opposite of Claude Code, where `idle_prompt` means "idle a while"
 *   and must never be read as a gate or a boundary.
 * - `UserPromptSubmit` repeats with `prompt: ""` on every tool continuation.
 *   Only the operator's real submission carries `submitted_prompt`.
 * - A question to the operator arrives as `PermissionRequest` for the
 *   `ask_user_question` tool, not as a tool call: the tool only runs after
 *   the answer. The `permission_prompt` notification that follows carries no
 *   tool name, so it cannot tell a question from a permission.
 * - Tool names are snake_case (`agent`, `ask_user_question`), and anchored
 *   matchers are tested against the canonical name only.
 * - `background_tasks` entries carry no `type`; a subagent is an entry with
 *   an `agent_type`.
 * - `tool_use_id` on `PreToolUse` is minted per delivery, so it cannot dedupe
 *   an at-least-once repost. `tool_call_id` is stable, and a child's id is
 *   `${subagent_type}-${tool_call_id}`.
 *
 * Exawatt injects these hooks through `QWEN_CODE_SYSTEM_DEFAULTS_PATH`, the
 * lowest-precedence settings layer. Hooks concatenate across layers, so the
 * user's own user- and project-level hooks keep firing and nothing under
 * `~/.qwen` is written.
 */
import type {
  CensusChild,
  HarnessEvent,
  ReportedChildCensus,
  SessionBlockedReason,
} from './delegation-state';

/** Every hook runs inside the harness turn, so this is the operator's
 *  latency. Qwen's own default for an http hook is 600 seconds, which would
 *  freeze a turn behind a dead listener; it must always be stated. */
const HOOK_TIMEOUT_SECONDS = 2;

/** The tool whose purpose is to stop and ask the operator. */
const ASK_TOOL = 'ask_user_question';

/** The delegation tool. Anchored so only the canonical name matches. */
const AGENT_TOOL = 'agent';
const AGENT_TOOL_MATCHER = `^${AGENT_TOOL}$`;

/** Labels measured 29–36 chars on the operator corpus; anything longer is
 *  prompt content, which never rides. Same bound as Claude's adapter. */
const MAX_LABEL_LENGTH = 140;

/** `idle_prompt` ends the turn here; `permission_prompt` is the backstop for
 *  a lost `PermissionRequest`, and only ever opens a permission gate. */
const NOTIFICATIONS = 'idle_prompt|permission_prompt';

interface Subscription {
  event: string;
  matcher?: string;
}

const SUBSCRIBED_EVENTS: readonly Subscription[] = [
  { event: 'UserPromptSubmit' },
  { event: 'Stop' },
  { event: 'StopFailure' },
  { event: 'SubagentStart' },
  { event: 'SubagentStop' },
  { event: 'PermissionRequest' },
  // One post per delegation, in the parent, carrying the spawn label. The
  // matcher keeps this from becoming a per-tool activity channel.
  { event: 'PreToolUse', matcher: AGENT_TOOL_MATCHER },
  { event: 'Notification', matcher: NOTIFICATIONS },
  // Releases whatever gate is open: a granted or rejected permission and an
  // answered question all resolve the tool batch that was waiting.
  { event: 'PostToolBatch' },
];

export const QWEN_HOOK_HEADER = 'x-exawatt-token';

/** Where Qwen Code reads machine-wide defaults when no override is set. */
export const QWEN_ADMIN_DEFAULTS_PATH =
  '/Library/Application Support/QwenCode/system-defaults.json';

/**
 * The settings document Exawatt points one launch at.
 *
 * The environment override REPLACES Qwen's machine-wide defaults file, so an
 * administrator's document, when one exists, is carried into this one rather
 * than silently dropped: its settings are kept and Exawatt's hooks are
 * appended to its own. A document that exists but cannot be read as an
 * object stops the injection, because launching without the administrator's
 * defaults would change the operator's configuration.
 */
export function qwenHookSettings(
  port: number,
  token: string,
  adminDefaults: string | null = null
): string {
  const endpoint = {
    type: 'http' as const,
    name: 'exawatt',
    url: `http://127.0.0.1:${port}/hook`,
    headers: { [QWEN_HOOK_HEADER]: token },
    timeout: HOOK_TIMEOUT_SECONDS,
  };
  const base = adminDefaults === null ? {} : parseObject(adminDefaults);
  if (!base) {
    throw new Error('Qwen Code system defaults are not a JSON object');
  }
  const inherited = base['hooks'];
  const hooks: Record<string, unknown[]> =
    inherited && typeof inherited === 'object' && !Array.isArray(inherited)
      ? Object.fromEntries(
          Object.entries(inherited as Record<string, unknown>).map(
            ([event, entries]) => [event, Array.isArray(entries) ? entries : []]
          )
        )
      : {};
  for (const { event, matcher } of SUBSCRIBED_EVENTS) {
    (hooks[event] ??= []).push(
      matcher ? { matcher, hooks: [endpoint] } : { hooks: [endpoint] }
    );
  }
  return JSON.stringify({ ...base, hooks }, null, 2);
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readString(
  source: Record<string, unknown>,
  key: string
): string | null {
  const value = source[key];
  return typeof value === 'string' && value ? value : null;
}

function readRecord(
  source: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  const value = source[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Truncate by code point so a clipped label never carries a lone surrogate. */
function clipLabel(label: string): string {
  const points = [...label];
  return points.length > MAX_LABEL_LENGTH
    ? `${points.slice(0, MAX_LABEL_LENGTH - 1).join('')}…`
    : label;
}

/** The harness session a payload belongs to. Exawatt's hooks travel in the
 *  launch environment, so a `qwen` the Agent runs inside its own shell
 *  inherits them; this is how its posts are told apart from the Session's. */
export function qwenHookSessionId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  return readString(payload as Record<string, unknown>, 'session_id');
}

/**
 * The live set Qwen Code attaches to `Stop` and `SubagentStop`.
 *
 * Measured on 0.24.4: entries carry `id`, `status`, `description`,
 * `started_at` and, for subagents, `agent_type`, but no `type`. As with
 * Claude Code, `SubagentStop` lists the stopping child as still `running`,
 * so its own id is excluded rather than resurrected. Only `completed` may
 * offer a result; any other non-running status is withdrawn. A payload
 * without the field carries no census.
 */
function qwenCensus(
  record: Record<string, unknown>,
  at: number,
  excludeId: string | null = null
): ReportedChildCensus | null {
  const tasks = record['background_tasks'];
  if (!Array.isArray(tasks)) return null;
  const live: CensusChild[] = [];
  const completed: string[] = [];
  const backgroundTasks: NonNullable<ReportedChildCensus['backgroundTasks']> =
    [];
  const seen = new Set<string>();
  for (const task of tasks) {
    if (!task || typeof task !== 'object') continue;
    const entry = task as Record<string, unknown>;
    const id = readString(entry, 'id');
    if (!id || id === excludeId || seen.has(id)) continue;
    seen.add(id);
    const status = readString(entry, 'status');
    const agentType = readString(entry, 'agent_type');
    if (!agentType) {
      if (status === 'running' || status === 'pending')
        backgroundTasks.push({ id, type: readString(entry, 'type') ?? 'task' });
      continue;
    }
    if (status === 'completed') {
      completed.push(id);
      continue;
    }
    if (status !== null && status !== 'running' && status !== 'pending')
      continue;
    const description = readString(entry, 'description');
    const startedAt = Date.parse(readString(entry, 'started_at') ?? '');
    live.push({
      id,
      agentType,
      description: description ? clipLabel(description) : null,
      startedAt: Number.isFinite(startedAt) ? startedAt : null,
    });
  }
  return { live, completed, at, backgroundTasks };
}

/**
 * Normalize one Qwen Code hook payload into the shared vocabulary.
 *
 * `null` means "nothing this channel models": an unknown event, a
 * continuation `UserPromptSubmit`, or a turn boundary inside a child.
 */
export function qwenHookEvent(
  payload: unknown,
  at: number
): HarnessEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const name = readString(record, 'hook_event_name');
  if (!name) return null;
  // A child's own boundaries are not its parent's. On the subagent events
  // themselves `agent_id` names the child, so they are handled before this
  // rule is consulted.
  const insideChild = !!readString(record, 'agent_id');

  switch (name) {
    case 'UserPromptSubmit':
      if (insideChild) return null;
      return typeof record['submitted_prompt'] === 'string'
        ? { kind: 'turn-start' }
        : null;
    case 'Stop': {
      if (insideChild) return null;
      const census = qwenCensus(record, at);
      return census ? { kind: 'turn-end', census } : { kind: 'turn-end' };
    }
    case 'StopFailure':
      return insideChild ? null : { kind: 'turn-end' };

    // Gates are not scoped to the parent: there is one terminal, and the
    // operator answers a child's question the same as the parent's.
    case 'PermissionRequest': {
      const reason: SessionBlockedReason =
        readString(record, 'tool_name') === ASK_TOOL
          ? 'question'
          : 'permission';
      return { kind: 'blocked', reason };
    }
    case 'PostToolBatch':
      return { kind: 'unblocked' };
    case 'Notification': {
      // Re-checked rather than trusted from the matcher, which is only
      // configuration.
      const type = readString(record, 'notification_type');
      if (type === 'permission_prompt')
        return { kind: 'blocked', reason: 'permission' };
      if (type === 'idle_prompt' && !insideChild) return { kind: 'turn-end' };
      return null;
    }

    case 'PreToolUse': {
      if (readString(record, 'tool_name') !== AGENT_TOOL || insideChild)
        return null;
      const toolCallId =
        readString(record, 'tool_call_id') ?? readString(record, 'tool_use_id');
      const input = readRecord(record, 'tool_input');
      const description = input ? readString(input, 'description') : null;
      if (!toolCallId || !input || !description) return null;
      return {
        kind: 'child-label',
        toolUseId: toolCallId,
        agentType: readString(input, 'subagent_type'),
        description: clipLabel(description),
        at,
      };
    }
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
      const census = qwenCensus(record, at, childId);
      return census
        ? { kind: 'child-end', childId, census }
        : { kind: 'child-end', childId };
    }
    default:
      return null;
  }
}
