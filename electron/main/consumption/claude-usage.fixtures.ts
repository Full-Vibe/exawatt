/**
 * Real `claude -p "/usage" --no-session-persistence --output-format json`
 * output, captured 2026-10-04 on Claude Code 2.1.289 (`claude --version`).
 *
 * These are the format evidence the parser is pinned to. The ids are zeroed;
 * nothing else was edited. They are captured, not authored: when Claude Code
 * changes the report, capture a new one and add it beside these rather than
 * editing them, so a format change stays a visible event in the history.
 */

/** Signed in to a Max subscription: session, all-models week, and a
 *  model-scoped week, with the reset on the hour ("7pm", no minutes). */
export const SIGNED_IN_REAL = {
  is_error: false,
  duration_api_ms: 0,
  num_turns: 0,
  stop_reason: null,
  session_id: '00000000-0000-4000-8000-000000000000',
  total_cost_usd: 0,
  usage: {
    output_tokens_details: {
      thinking_tokens: 0,
    },
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
    server_tool_use: {
      web_search_requests: 0,
      web_fetch_requests: 0,
    },
    service_tier: 'standard',
    cache_creation: {
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
    inference_geo: '',
    iterations: [],
    speed: 'standard',
    fallback_credit: null,
  },
  modelUsage: {},
  permission_denials: [],
  fast_mode_state: 'off',
  fast_mode_disabled_reason: 'sdk_opt_in_required',
  subagent_stats: {
    spawned: 0,
    requested: {
      background: 0,
      foreground: 0,
      unset: 0,
    },
    started_in_background: 0,
    max_depth: 0,
    spawned_by_subagents: 0,
    completed: 0,
    failed: 0,
    killed: {
      parent: 0,
      user: 0,
      system: 0,
    },
    refused: {
      depth_limit: 0,
      concurrency_limit: 0,
      budget: 0,
    },
    by_type: {},
  },
  subtype: 'success',
  result:
    "You are currently using your subscription to power your Claude Code usage\n\nCurrent session: 4% used \u00b7 resets Oct 4 at 7pm (America/Los_Angeles)\nCurrent week (all models): 92% used \u00b7 resets Oct 5 at 2am (America/Los_Angeles)\nCurrent week (Fable): 58% used \u00b7 resets Oct 5 at 2am (America/Los_Angeles)\n\nWhat's contributing to your limits usage?\nApproximate, based on local sessions on this machine \u2014 does not include other devices or claude.ai. Behaviors are independent characteristics, not a breakdown.\n\nLast 24h \u00b7 733 requests \u00b7 43 sessions\n  79% of your usage came from subagent-heavy sessions\n  74% of your usage was at >150k context\n  55% of your usage was while 4+ sessions ran in parallel\n  Top subagents: general-purpose 34%, Explore 2%\n\nLast 7d \u00b7 15954 requests \u00b7 316 sessions\n  98% of your usage came from subagent-heavy sessions\n  85% of your usage was at >150k context\n  80% of your usage came from sessions active for 8+ hours\n  42% of your usage was while 4+ sessions ran in parallel\n  Top skills: /claude-in-chrome 1%\n  Top subagents: general-purpose 45%, fork 5%, Explore 1%, workflow-subagent 1%\n  Top MCP servers: claude-in-chrome 4%",
  local_command: 'usage',
  type: 'result',
  duration_ms: 3970,
  uuid: '00000000-0000-4000-8000-000000000001',
  queued_turn_count: 0,
  result_index: 0,
};

/** A scratch `CLAUDE_CONFIG_DIR` with no login (`claude auth status` read
 *  `loggedIn: false`). Exit 0, `is_error: false`, and no plan limits: the cost
 *  summary an API-key session also prints. */
export const SIGNED_OUT_REAL = {
  is_error: false,
  duration_api_ms: 0,
  num_turns: 0,
  stop_reason: null,
  session_id: '00000000-0000-4000-8000-000000000000',
  total_cost_usd: 0,
  usage: {
    output_tokens_details: {
      thinking_tokens: 0,
    },
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
    server_tool_use: {
      web_search_requests: 0,
      web_fetch_requests: 0,
    },
    service_tier: 'standard',
    cache_creation: {
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
    inference_geo: '',
    iterations: [],
    speed: 'standard',
    fallback_credit: null,
  },
  modelUsage: {},
  permission_denials: [],
  fast_mode_state: 'off',
  fast_mode_disabled_reason: 'sdk_opt_in_required',
  subagent_stats: {
    spawned: 0,
    requested: {
      background: 0,
      foreground: 0,
      unset: 0,
    },
    started_in_background: 0,
    max_depth: 0,
    spawned_by_subagents: 0,
    completed: 0,
    failed: 0,
    killed: {
      parent: 0,
      user: 0,
      system: 0,
    },
    refused: {
      depth_limit: 0,
      concurrency_limit: 0,
      budget: 0,
    },
    by_type: {},
  },
  subtype: 'success',
  result:
    'Total cost:            $0.0000\nTotal duration (API):  0s\nTotal duration (wall): 1s\nTotal code changes:    0 lines added, 0 lines removed\nUsage:                 0 input, 0 output, 0 cache read, 0 cache write',
  local_command: 'usage',
  type: 'result',
  duration_ms: 283,
  uuid: '00000000-0000-4000-8000-000000000001',
  queued_turn_count: 0,
  result_index: 0,
};

/** The earlier capture from the same day whose reset carried minutes
 *  ("6:59pm"). Only its `result` text is kept: the envelope is the one above. */
export const SIGNED_IN_WITH_MINUTES_RESULT =
  "You are currently using your subscription to power your Claude Code usage\n\nCurrent session: 2% used \u00b7 resets Oct 4 at 6:59pm (America/Los_Angeles)\nCurrent week (all models): 92% used \u00b7 resets Oct 5 at 1:59am (America/Los_Angeles)\nCurrent week (Fable): 58% used \u00b7 resets Oct 5 at 1:59am (America/Los_Angeles)\n\nWhat's contributing to your limits usage? \u2026";
