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
 * Deliberately NOT subscribed: UNMATCHED `PreToolUse`/`PostToolUse`. They fire
 * inside every child for every tool call and would turn a delegation surface
 * into an activity ticker, which `docs/product/reference/agent-state.md` rules
 * out. D2 needs child labels, not child keystrokes. D4 subscribes both, but
 * MATCHED to `AskUserQuestion` alone, so the harness posts for the one tool
 * whose entire purpose is to stop and wait for a human — and for nothing else.
 */
import type { HarnessEvent, SessionBlockedReason } from './delegation-state';

/** Kept low on purpose: every hook runs INSIDE the harness turn, so this is
 *  the operator's latency, not ours. A dead listener fails open. */
const HOOK_TIMEOUT_SECONDS = 2;

/**
 * The tool whose whole purpose is to stop and ask the operator. Subscribing
 * `PreToolUse`/`PostToolUse` MATCHED TO THIS ONE TOOL is what keeps the "no
 * activity exhaust" boundary intact: the harness never posts for Read, Bash,
 * or Edit, so this cannot decay into a child-by-child tool ticker.
 */
const ASK_TOOL = 'AskUserQuestion';

/**
 * The delegation tools (ENG-023 D3a). `PreToolUse` matched to these fires in
 * the PARENT once per spawn, carrying the operator-legible description the
 * child was launched with. Spawn IS the `Delegated` meaningful Event, so this
 * stays one POST per delegation — not an activity channel. Claude Code has
 * named this tool both `Task` and `Agent` across versions; match both.
 */
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const AGENT_TOOLS_MATCHER = [...AGENT_TOOLS].join('|');

/** Labels measured 29–36 chars on the operator corpus; this is generous
 *  headroom, and anything longer is prompt content, which never rides. */
const MAX_LABEL_LENGTH = 140;

/**
 * Notification types that mean "the Agent stopped and is waiting on a human".
 *
 * `idle_prompt` is deliberately EXCLUDED. It fires when a session has simply
 * been sitting at its prompt, which is true of every finished Session
 * eventually — treating it as a gate would light "needs you" on the whole
 * fleet and destroy the signal.
 */
const BLOCKING_NOTIFICATIONS: Record<string, SessionBlockedReason> = {
  permission_prompt: 'permission',
  agent_needs_input: 'question',
  elicitation_dialog: 'elicitation',
};

/** Notification types that report the gate closing again. */
const RELEASING_NOTIFICATIONS = new Set([
  'elicitation_complete',
  'elicitation_response',
]);

interface Subscription {
  event: string;
  /** Claude Code's hook matcher — absent means "every payload for this event" */
  matcher?: string;
}

const SUBSCRIBED_EVENTS: readonly Subscription[] = [
  { event: 'UserPromptSubmit' },
  { event: 'Stop' },
  { event: 'SubagentStart' },
  { event: 'SubagentStop' },
  // Operator gates (ENG-023 D4). Without these, an Agent parked on a question
  // is indistinguishable from one that is thinking: no `Stop` fires, so the
  // reported turn stays `generating` and byte quiescence is left to invent an
  // answer — which is how a pending question came to read "result ready".
  { event: 'PreToolUse', matcher: ASK_TOOL },
  { event: 'PostToolUse', matcher: ASK_TOOL },
  // Spawn labels (ENG-023 D3a): one post per delegation, in the parent, at
  // the moment of handoff. NOT a per-tool subscription — the matcher scopes
  // delivery to the delegation tools alone (a measured property, see D4).
  { event: 'PreToolUse', matcher: AGENT_TOOLS_MATCHER },
  { event: 'Notification', matcher: Object.keys(BLOCKING_NOTIFICATIONS).join('|') },
  { event: 'Notification', matcher: [...RELEASING_NOTIFICATIONS].join('|') },
  { event: 'ElicitationResult' },
  // The gate-release backstop for a granted permission, which reports no event
  // of its own. One post per resolved tool BATCH, not per tool call, and it is
  // normalized to exactly one meaning — `unblocked` — so it can never become
  // an activity channel for any surface to read.
  { event: 'PostToolBatch' },
];

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
  const hooks: Record<string, Array<Record<string, unknown>>> = {};
  for (const { event, matcher } of SUBSCRIBED_EVENTS) {
    (hooks[event] ??= []).push(
      matcher ? { matcher, hooks: [endpoint] } : { hooks: [endpoint] }
    );
  }
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

    // Operator gates are NOT gated on `insideChild`, unlike turn boundaries.
    // A child's turn is not its parent's, but a child's question is: there is
    // one terminal, and it is the operator who has to answer.
    case 'PreToolUse': {
      const tool = readString(record, 'tool_name');
      if (tool === ASK_TOOL) return { kind: 'blocked', reason: 'question' };
      if (tool && AGENT_TOOLS.has(tool)) {
        // A spawn INSIDE a child is a grandchild's label. The live model is a
        // flat parent→children list, so adopting it here would mislabel the
        // parent's next direct child; skipping it is the honest move.
        if (insideChild) return null;
        const toolUseId = readString(record, 'tool_use_id');
        const input = record['tool_input'];
        if (!toolUseId || !input || typeof input !== 'object') return null;
        const inputRecord = input as Record<string, unknown>;
        const description = readString(inputRecord, 'description');
        if (!description) return null;
        return {
          kind: 'child-label',
          toolUseId,
          agentType: readString(inputRecord, 'subagent_type'),
          description:
            description.length > MAX_LABEL_LENGTH
              ? `${description.slice(0, MAX_LABEL_LENGTH - 1)}…`
              : description,
          at,
        };
      }
      return null;
    }
    case 'PostToolUse':
      return readString(record, 'tool_name') === ASK_TOOL
        ? { kind: 'unblocked', reason: 'question' }
        : null;
    case 'Notification': {
      // Re-checked here rather than trusted from the matcher: the matcher is
      // configuration, and a version that widens what it delivers must not
      // silently start reporting gates that are not gates.
      const type = readString(record, 'notification_type');
      if (!type) return null;
      const reason = BLOCKING_NOTIFICATIONS[type];
      if (reason) return { kind: 'blocked', reason };
      return RELEASING_NOTIFICATIONS.has(type)
        ? { kind: 'unblocked', reason: 'elicitation' }
        : null;
    }
    case 'ElicitationResult':
      return { kind: 'unblocked', reason: 'elicitation' };
    // Scoped to permissions ONLY. A granted permission reports nothing of its
    // own, so this is its release; scoping it means a batch resolving for any
    // other reason cannot silently answer an open question.
    case 'PostToolBatch':
      return { kind: 'unblocked', reason: 'permission' };

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
