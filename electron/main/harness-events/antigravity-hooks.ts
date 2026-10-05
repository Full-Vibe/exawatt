/**
 * Antigravity CLI adapter for the harness event channel (ENG-003 S5.3).
 *
 * Antigravity (`agy`) reports its execution loop through command hooks read
 * from `.agents/hooks.json` in any workspace directory, including one added
 * with `--add-dir`. Verified on 1.2.17 (2026-10-05): a hooks document in an
 * added directory fires exactly as the launch directory's own would, no trust
 * prompt appears, and the hooks fire even when the model call itself fails.
 * Exawatt therefore writes one directory per launch, owned by Exawatt, and
 * never touches `~/.gemini/config/hooks.json`, which the Antigravity IDE
 * shares.
 *
 * What differs from the Claude Code family, measured on 1.2.17:
 *
 * - Hooks are commands only, and the payload is one JSON object on stdin
 *   with NO event-name field. Each subscribed event gets its own command, and
 *   the command wraps the payload in an envelope naming the event before it
 *   posts, so one normalizer can tell them apart.
 * - Identity is not allocated by Exawatt: `agy` has no session-id flag. Every
 *   payload carries `conversationId`, and the first one names the Session's
 *   conversation (`--conversation=<id>` resumes it).
 * - `PreInvocation` fires before every model call, so it repeats within one
 *   turn; the reducer treats a repeated turn-start as the same turn.
 * - `Stop` fires when the execution loop terminates. Only `fullyIdle: true`
 *   is read as the turn's end. A `Stop` without it has not been observed to
 *   mean anything Exawatt can state, so it is dropped rather than guessed.
 * - There is no permission or question event. "Needs you" cannot be
 *   reported, and the source's declaration says so.
 * - `invoke_subagent` has a `PreToolUse` and no completion event, so
 *   delegation is declared unobservable rather than half-reported.
 */
import type { HarnessEvent } from './delegation-state';

/** Antigravity's own default is 30 seconds; a dead listener must cost the
 *  operator far less than that. curl bounds itself inside this. */
const HOOK_TIMEOUT_SECONDS = 3;
const POST_TIMEOUT_SECONDS = 2;

export const ANTIGRAVITY_HOOK_HEADER = 'x-exawatt-token';

/** The file Antigravity reads inside each workspace directory. */
export const ANTIGRAVITY_HOOKS_FILE = '.agents/hooks.json';

/** The events Exawatt subscribes to, by their Antigravity names. */
const SUBSCRIBED_EVENTS = ['PreInvocation', 'Stop'] as const;
type SubscribedEvent = (typeof SUBSCRIBED_EVENTS)[number];

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * One hook command: wrap stdin in an envelope naming the event, post it to
 * the channel, print nothing. Antigravity reads a hook's stdout as a decision
 * document (`Stop` may answer `continue`), so curl's answer goes to /dev/null
 * and the command always exits 0 — a dead listener must never change what the
 * Agent does.
 */
function hookCommand(event: SubscribedEvent, port: number, token: string) {
  const prefix = shellQuote(`{"event":${JSON.stringify(event)},"payload":`);
  const suffix = shellQuote('}');
  return (
    `{ printf '%s' ${prefix}; cat; printf '%s' ${suffix}; } | ` +
    `curl -s -m ${POST_TIMEOUT_SECONDS} -o /dev/null -X POST ` +
    `-H 'content-type: application/json' ` +
    `-H ${shellQuote(`${ANTIGRAVITY_HOOK_HEADER}: ${token}`)} ` +
    `--data-binary @- ${shellQuote(`http://127.0.0.1:${port}/hook`)} || true`
  );
}

/**
 * The hooks document Exawatt writes for one launch, in Antigravity's own
 * schema: hook names at the top level, each naming the events it handles.
 * Nothing else is configured, so it cannot disturb the operator's model,
 * permissions or their own hooks (every hooks.json in the workspace loads).
 */
export function antigravityHookSettings(port: number, token: string): string {
  const hooks: Record<string, unknown> = {};
  for (const event of SUBSCRIBED_EVENTS) {
    hooks[`exawatt-${event.toLowerCase()}`] = {
      [event]: [
        {
          type: 'command',
          command: hookCommand(event, port, token),
          timeout: HOOK_TIMEOUT_SECONDS,
        },
      ],
    };
  }
  return JSON.stringify(hooks, null, 2);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(
  source: Record<string, unknown>,
  key: string
): string | null {
  const value = source[key];
  return typeof value === 'string' && value ? value : null;
}

/** The conversation a posted envelope belongs to: the Session's identity on
 *  the first post, and the filter for every later one. */
export function antigravityHookConversationId(payload: unknown): string | null {
  const envelope = readRecord(payload);
  const inner = envelope ? readRecord(envelope['payload']) : null;
  return inner ? readString(inner, 'conversationId') : null;
}

/**
 * Normalize one posted envelope into the shared vocabulary. `null` means
 * "nothing this channel models": an unknown event, a `Stop` that did not
 * declare the loop fully idle, or a malformed post.
 */
export function antigravityHookEvent(
  payload: unknown,
  _at: number
): HarnessEvent | null {
  const envelope = readRecord(payload);
  if (!envelope) return null;
  const event = readString(envelope, 'event');
  const inner = readRecord(envelope['payload']);
  if (!event || !inner) return null;
  switch (event) {
    case 'PreInvocation':
      return { kind: 'turn-start' };
    case 'Stop':
      return inner['fullyIdle'] === true ? { kind: 'turn-end' } : null;
    default:
      return null;
  }
}
