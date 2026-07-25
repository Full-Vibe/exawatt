/**
 * Sanitized consumption fixtures.
 *
 * Shapes are copied from the operator's real local corpus; VALUES are not.
 * Every prompt, tool result, file path, session id, request id, and branch name
 * here is invented. Directory names are generic (`/w/acme`, `/w/beta`) and no
 * content field carries anything resembling operator work or a secret.
 *
 * The set deliberately includes the cases the real corpus throws at a parser:
 *
 * - cache-read-dominant usage (the normal steady state, not an edge case)
 * - a Claude session whose usage records carry no `cwd`
 * - duplicate lines repeating an identical `usage` block for one `requestId`
 * - a streaming request whose usage GROWS across lines with one `requestId`
 * - a `<synthetic>` model record
 * - a Codex session with `rate_limits` and one without
 * - Codex duplicate `token_count` events, an `info: null` heartbeat, a
 *   cumulative reset, and two interleaved cumulative series
 * - a truncated final line (crash mid-write)
 * - a corrupt line and a non-object line
 */

const jsonl = (records: unknown[]): string =>
  records.map(record => JSON.stringify(record)).join('\n') + '\n';

// ---------------------------------------------------------------- Claude Code

const claudeAssistant = (
  overrides: Record<string, unknown> & { usage?: Record<string, unknown> }
) => {
  const { usage, ...rest } = overrides;
  return {
    parentUuid: 'fixture-parent',
    isSidechain: false,
    type: 'assistant',
    userType: 'external',
    entrypoint: 'cli',
    version: '2.1.219',
    cwd: '/w/acme',
    gitBranch: 'main',
    sessionId: 'sess-claude-1',
    ...rest,
    message: {
      model: 'claude-sonnet-5',
      id: 'msg_fixture',
      type: 'message',
      role: 'assistant',
      content: [],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
        service_tier: 'standard',
        cache_creation: {
          ephemeral_1h_input_tokens: 0,
          ephemeral_5m_input_tokens: 0,
        },
        ...(usage ?? {}),
      },
    },
  };
};

/**
 * Ordinary session: cache-read-dominant, one duplicated request (three lines,
 * identical usage), one streaming request whose usage grows across lines, and
 * a non-assistant line that must be counted as `linesWithoutUsage`.
 */
export const CLAUDE_ORDINARY_JSONL = jsonl([
  {
    type: 'user',
    sessionId: 'sess-claude-1',
    cwd: '/w/acme',
    timestamp: '2026-07-01T10:00:00.000Z',
    message: { role: 'user', content: 'fixture turn' },
  },
  claudeAssistant({
    requestId: 'req_fixture_a',
    uuid: 'u1',
    timestamp: '2026-07-01T10:00:01.000Z',
    effort: 'high',
    usage: {
      input_tokens: 12,
      cache_creation_input_tokens: 4_000,
      cache_read_input_tokens: 96_000,
      output_tokens: 250,
      server_tool_use: { web_search_requests: 1, web_fetch_requests: 2 },
    },
  }),
  // Identical repeat: same requestId, byte-identical usage.
  claudeAssistant({
    requestId: 'req_fixture_a',
    uuid: 'u2',
    timestamp: '2026-07-01T10:00:01.400Z',
    effort: 'high',
    usage: {
      input_tokens: 12,
      cache_creation_input_tokens: 4_000,
      cache_read_input_tokens: 96_000,
      output_tokens: 250,
      server_tool_use: { web_search_requests: 1, web_fetch_requests: 2 },
    },
  }),
  claudeAssistant({
    requestId: 'req_fixture_a',
    uuid: 'u3',
    timestamp: '2026-07-01T10:00:01.900Z',
    effort: 'high',
    usage: {
      input_tokens: 12,
      cache_creation_input_tokens: 4_000,
      cache_read_input_tokens: 96_000,
      output_tokens: 250,
      server_tool_use: { web_search_requests: 1, web_fetch_requests: 2 },
    },
  }),
  // Streaming growth: one request, usage rises across lines.
  claudeAssistant({
    requestId: 'req_fixture_b',
    uuid: 'u4',
    timestamp: '2026-07-01T10:05:00.000Z',
    usage: {
      input_tokens: 5,
      cache_creation_input_tokens: 1_000,
      cache_read_input_tokens: 100_000,
      output_tokens: 1,
    },
  }),
  claudeAssistant({
    requestId: 'req_fixture_b',
    uuid: 'u5',
    timestamp: '2026-07-01T10:05:02.000Z',
    usage: {
      input_tokens: 5,
      cache_creation_input_tokens: 1_000,
      cache_read_input_tokens: 100_000,
      output_tokens: 640,
    },
  }),
]);

/**
 * A session whose usage records carry no `cwd`. This is the shape that decides
 * Project attribution: no cwd means no honest Project, and the parser must say
 * so rather than guessing.
 */
export const CLAUDE_NO_CWD_JSONL = jsonl([
  {
    ...claudeAssistant({
      requestId: 'req_fixture_c',
      uuid: 'u6',
      timestamp: '2026-07-02T09:00:00.000Z',
      sessionId: 'sess-claude-2',
      usage: {
        input_tokens: 40,
        cache_read_input_tokens: 12_000,
        output_tokens: 300,
      },
    }),
    cwd: undefined,
    gitBranch: undefined,
  },
]);

/** Opus-tier record plus a `<synthetic>` record, which has no real model. */
export const CLAUDE_MIXED_MODELS_JSONL = jsonl([
  {
    ...claudeAssistant({
      requestId: 'req_fixture_d',
      uuid: 'u7',
      timestamp: '2026-07-03T08:00:00.000Z',
      sessionId: 'sess-claude-3',
      cwd: '/w/beta',
      usage: {
        input_tokens: 100,
        cache_creation_input_tokens: 20_000,
        cache_read_input_tokens: 500_000,
        output_tokens: 2_000,
      },
    }),
    message: {
      ...claudeAssistant({}).message,
      model: 'claude-opus-5',
      usage: {
        input_tokens: 100,
        cache_creation_input_tokens: 20_000,
        cache_read_input_tokens: 500_000,
        output_tokens: 2_000,
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      },
    },
  },
  {
    ...claudeAssistant({
      requestId: 'req_fixture_e',
      uuid: 'u8',
      timestamp: '2026-07-03T08:01:00.000Z',
      sessionId: 'sess-claude-3',
      cwd: '/w/beta',
    }),
    message: {
      ...claudeAssistant({}).message,
      model: '<synthetic>',
      usage: {
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      },
    },
  },
]);

/**
 * A damaged file: a corrupt line, a bare non-object line, a valid record, and a
 * final line the writer never finished. Nothing here may throw, and every
 * dropped line must land in a counter.
 */
export const CLAUDE_DAMAGED_JSONL =
  '{"type":"assistant","requestId":"req_bad",\n' +
  '42\n' +
  jsonl([
    claudeAssistant({
      requestId: 'req_fixture_f',
      uuid: 'u9',
      timestamp: '2026-07-04T11:00:00.000Z',
      sessionId: 'sess-claude-4',
      cwd: '/w/acme',
      usage: {
        input_tokens: 7,
        cache_read_input_tokens: 33_000,
        output_tokens: 120,
      },
    }),
  ]) +
  '{"type":"assistant","requestId":"req_truncated","message":{"model":"claude-sonnet-5","usa';

/**
 * A DELEGATED transcript, as written to
 * `<slug>/<sessionId>/subagents/agent-<agentId>.jsonl`.
 *
 * `sessionId` is the PARENT session, `agentId` is the delegated run, and the
 * child runs a different (frontier) model than the parent — all three are the
 * real corpus's shape. The last record deliberately reuses `req_fixture_a`, the
 * request id the parent session also used: 18 requests in the real corpus do
 * exactly this for context-inheriting `fork` runs, and the parser must keep the
 * parent turn and the delegated run separate rather than merging them.
 */
export const CLAUDE_DELEGATED_JSONL = jsonl([
  {
    ...claudeAssistant({
      requestId: 'req_fixture_g',
      uuid: 'd1',
      timestamp: '2026-07-01T10:02:00.000Z',
      sessionId: 'sess-claude-1',
      cwd: '/w/acme',
      usage: {
        input_tokens: 3,
        cache_creation_input_tokens: 8_000,
        cache_read_input_tokens: 200_000,
        output_tokens: 1_500,
      },
    }),
    agentId: 'agent-fixture-1',
    attributionAgent: 'Explore',
    sessionKind: 'bg',
    message: {
      ...claudeAssistant({}).message,
      model: 'claude-opus-4-8',
      usage: {
        input_tokens: 3,
        cache_creation_input_tokens: 8_000,
        cache_read_input_tokens: 200_000,
        output_tokens: 1_500,
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      },
    },
  },
  {
    ...claudeAssistant({
      requestId: 'req_fixture_h',
      uuid: 'd2',
      timestamp: '2026-07-01T10:03:00.000Z',
      sessionId: 'sess-claude-1',
      cwd: '/w/acme',
      usage: {
        input_tokens: 1,
        cache_read_input_tokens: 210_000,
        output_tokens: 400,
      },
    }),
    agentId: 'agent-fixture-1',
    attributionAgent: 'Explore',
    attributionSkill: 'find-skills',
    sessionKind: 'bg',
  },
  {
    ...claudeAssistant({
      requestId: 'req_fixture_a',
      uuid: 'd3',
      timestamp: '2026-07-01T10:04:00.000Z',
      sessionId: 'sess-claude-1',
      cwd: '/w/acme',
      usage: {
        input_tokens: 12,
        cache_creation_input_tokens: 4_000,
        cache_read_input_tokens: 96_000,
        output_tokens: 9,
      },
    }),
    agentId: 'agent-fixture-2',
    attributionAgent: 'fork',
  },
]);

/** The spawn-time sidecar. `spawnDepth` is present here but often is not. */
export const CLAUDE_DELEGATED_META_JSON = JSON.stringify({
  agentType: 'Explore',
  description: 'fixture delegated run',
  toolUseId: 'toolu_fixture',
  spawnDepth: 1,
});

/** A delegated transcript with NO sidecar, so `spawnDepth` must stay null. */
export const CLAUDE_DELEGATED_NO_META_JSONL = jsonl([
  {
    ...claudeAssistant({
      requestId: 'req_fixture_i',
      uuid: 'd4',
      timestamp: '2026-07-01T10:06:00.000Z',
      sessionId: 'sess-claude-1',
      cwd: '/w/acme',
      usage: { input_tokens: 2, cache_read_input_tokens: 5_000, output_tokens: 50 },
    }),
    agentId: 'agent-fixture-3',
    attributionAgent: 'general-purpose',
  },
]);

// ----------------------------------------------------------------------- Codex

const codexMeta = (sessionId: string, cwd: string | null, at: string) => ({
  timestamp: at,
  type: 'session_meta',
  payload: {
    session_id: sessionId,
    id: sessionId,
    timestamp: at,
    ...(cwd === null ? {} : { cwd }),
    originator: 'codex-tui',
    cli_version: '0.145.0',
    source: 'cli',
    model_provider: 'openai',
  },
});

const codexTurnContext = (at: string, model: string, effort: string) => ({
  timestamp: at,
  type: 'turn_context',
  payload: {
    turn_id: 'fixture-turn',
    cwd: '/w/acme',
    model,
    collaboration_mode: { mode: 'default', settings: { reasoning_effort: effort } },
  },
});

const codexTokenCount = (
  at: string,
  total: [number, number, number, number, number, number],
  last: [number, number, number, number, number, number],
  rateLimits: unknown = null
) => ({
  timestamp: at,
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: {
      total_token_usage: {
        input_tokens: total[0],
        cached_input_tokens: total[1],
        cache_write_input_tokens: total[2],
        output_tokens: total[3],
        reasoning_output_tokens: total[4],
        total_tokens: total[5],
      },
      last_token_usage: {
        input_tokens: last[0],
        cached_input_tokens: last[1],
        cache_write_input_tokens: last[2],
        output_tokens: last[3],
        reasoning_output_tokens: last[4],
        total_tokens: last[5],
      },
      model_context_window: 258_400,
    },
    ...(rateLimits === null ? {} : { rate_limits: rateLimits }),
  },
});

const RATE_LIMITS = {
  limit_id: 'codex',
  limit_name: null,
  primary: { used_percent: 59, window_minutes: 10_080, resets_at: 1_785_262_479 },
  secondary: { used_percent: 12.5, window_minutes: 300, resets_at: 1_784_950_000 },
  credits: { has_credits: false, unlimited: false, balance: '0' },
  plan_type: 'pro',
};

/**
 * Rate-limited session with the pathologies that break naive summing:
 * a duplicated `token_count` pair, an `info: null` heartbeat that still carries
 * rate limits, and normal telescoping deltas.
 */
export const CODEX_RATE_LIMITED_JSONL = jsonl([
  codexMeta('codex-sess-1', '/w/acme', '2026-07-05T19:05:01.545Z'),
  codexTurnContext('2026-07-05T19:05:01.900Z', 'gpt-5.6-sol', 'xhigh'),
  codexTokenCount(
    '2026-07-05T19:05:06.000Z',
    [17_569, 11_008, 0, 214, 69, 17_783],
    [17_569, 11_008, 0, 214, 69, 17_783],
    RATE_LIMITS
  ),
  // Exact duplicate emission: same cumulative snapshot, different instant.
  codexTokenCount(
    '2026-07-05T19:05:06.400Z',
    [17_569, 11_008, 0, 214, 69, 17_783],
    [17_569, 11_008, 0, 214, 69, 17_783],
    RATE_LIMITS
  ),
  codexTokenCount(
    '2026-07-05T19:06:10.000Z',
    [44_700, 33_000, 0, 786, 250, 45_486],
    [27_131, 21_992, 0, 572, 181, 27_703],
    RATE_LIMITS
  ),
  codexTokenCount(
    '2026-07-05T19:06:10.500Z',
    [44_700, 33_000, 0, 786, 250, 45_486],
    [27_131, 21_992, 0, 572, 181, 27_703],
    RATE_LIMITS
  ),
  // Rate-limit-only heartbeat: no usage at all.
  {
    timestamp: '2026-07-05T19:07:00.000Z',
    type: 'event_msg',
    payload: { type: 'token_count', info: null, rate_limits: RATE_LIMITS },
  },
]);

/** No `rate_limits` anywhere: capacity is simply unavailable for this session. */
export const CODEX_NO_RATE_LIMITS_JSONL = jsonl([
  codexMeta('codex-sess-2', '/w/beta', '2026-07-06T08:00:00.000Z'),
  codexTurnContext('2026-07-06T08:00:01.000Z', 'gpt-5.5', 'high'),
  codexTokenCount(
    '2026-07-06T08:00:20.000Z',
    [9_000, 6_000, 0, 400, 120, 9_400],
    [9_000, 6_000, 0, 400, 120, 9_400]
  ),
  codexTokenCount(
    '2026-07-06T08:01:20.000Z',
    [21_000, 16_000, 0, 900, 300, 21_900],
    [12_000, 10_000, 0, 500, 180, 12_500]
  ),
]);

/**
 * Cumulative reset mid-file (compaction) plus two interleaved cumulative series
 * (concurrent turns). `max(total_token_usage)` is wrong on both counts; the
 * dedupe-then-sum-deltas reconstruction is not.
 */
export const CODEX_RESET_AND_INTERLEAVED_JSONL = jsonl([
  codexMeta('codex-sess-3', '/w/acme', '2026-07-07T12:00:00.000Z'),
  codexTurnContext('2026-07-07T12:00:01.000Z', 'gpt-5.5', 'medium'),
  codexTokenCount(
    '2026-07-07T12:00:10.000Z',
    [50_000, 40_000, 0, 1_000, 400, 51_000],
    [50_000, 40_000, 0, 1_000, 400, 51_000]
  ),
  // Compaction: cumulative total drops back.
  codexTokenCount(
    '2026-07-07T12:10:00.000Z',
    [8_000, 2_000, 0, 200, 50, 8_200],
    [8_000, 2_000, 0, 200, 50, 8_200]
  ),
  // Series A and series B interleaved from here on.
  codexTokenCount(
    '2026-07-07T12:11:00.000Z',
    [18_000, 9_000, 0, 500, 150, 18_500],
    [10_000, 7_000, 0, 300, 100, 10_300]
  ),
  codexTokenCount(
    '2026-07-07T12:11:05.000Z',
    [90_000, 70_000, 0, 3_000, 900, 93_000],
    [40_000, 30_000, 0, 2_000, 500, 42_000]
  ),
  codexTokenCount(
    '2026-07-07T12:12:00.000Z',
    [26_000, 15_000, 0, 800, 240, 26_800],
    [8_000, 6_000, 0, 300, 90, 8_300]
  ),
]);

/** No `session_meta`: session identity has to come from the filename. */
export const CODEX_NO_META_JSONL = jsonl([
  codexTurnContext('2026-07-08T07:00:00.000Z', 'gpt-5.5', 'low'),
  codexTokenCount(
    '2026-07-08T07:00:30.000Z',
    [4_000, 1_000, 0, 100, 20, 4_100],
    [4_000, 1_000, 0, 100, 20, 4_100]
  ),
]);

/** Corrupt line, bare array line, valid record, then a mid-write truncation. */
export const CODEX_DAMAGED_JSONL =
  jsonl([codexMeta('codex-sess-4', '/w/acme', '2026-07-09T06:00:00.000Z')]) +
  '{"timestamp":"2026-07-09T06:00:01.000Z","type":"event_msg","payload":\n' +
  '[1,2,3]\n' +
  jsonl([
    codexTokenCount(
      '2026-07-09T06:00:05.000Z',
      [2_000, 500, 0, 60, 10, 2_060],
      [2_000, 500, 0, 60, 10, 2_060]
    ),
  ]) +
  '{"timestamp":"2026-07-09T06:00:09.000Z","type":"event_msg","payload":{"type":"token_c';

export const CLAUDE_FIXTURE_FILES = {
  '/root/claude/-w-acme/sess-claude-1.jsonl': CLAUDE_ORDINARY_JSONL,
  '/root/claude/-w-acme/sess-claude-2.jsonl': CLAUDE_NO_CWD_JSONL,
  '/root/claude/-w-beta/sess-claude-3.jsonl': CLAUDE_MIXED_MODELS_JSONL,
  '/root/claude/-w-acme/sess-claude-4.jsonl': CLAUDE_DAMAGED_JSONL,
  '/root/claude/-w-acme/sess-claude-1/subagents/agent-fixture-1.jsonl':
    CLAUDE_DELEGATED_JSONL,
  '/root/claude/-w-acme/sess-claude-1/subagents/agent-fixture-1.meta.json':
    CLAUDE_DELEGATED_META_JSON,
  '/root/claude/-w-acme/sess-claude-1/subagents/agent-fixture-3.jsonl':
    CLAUDE_DELEGATED_NO_META_JSONL,
} as const;

export const CODEX_FIXTURE_FILES = {
  '/root/codex/2026/07/05/rollout-2026-07-05T19-05-01-codex-sess-1.jsonl':
    CODEX_RATE_LIMITED_JSONL,
  '/root/codex/2026/07/06/rollout-2026-07-06T08-00-00-codex-sess-2.jsonl':
    CODEX_NO_RATE_LIMITS_JSONL,
  '/root/codex/2026/07/07/rollout-2026-07-07T12-00-00-codex-sess-3.jsonl':
    CODEX_RESET_AND_INTERLEAVED_JSONL,
  '/root/codex/2026/07/08/rollout-2026-07-08T07-00-00-codex-sess-5.jsonl':
    CODEX_NO_META_JSONL,
  '/root/codex/2026/07/09/rollout-2026-07-09T06-00-00-codex-sess-4.jsonl':
    CODEX_DAMAGED_JSONL,
} as const;

/** Splits a fixture the way `splitCompleteLines` would, for parser tests. */
export function fixtureLines(text: string): string[] {
  const lastNewline = text.lastIndexOf('\n');
  const complete = lastNewline === -1 ? '' : text.slice(0, lastNewline + 1);
  return complete.split('\n').filter(line => line.trim().length > 0);
}
