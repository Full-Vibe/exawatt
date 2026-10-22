#!/usr/bin/env node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';

const base = process.env.EXA_BASE || 'http://localhost:7000';
const userData = mkdtempSync(join(tmpdir(), 'exawatt-operator-stats-eval-'));

// The pipeline under test is scan, Run derivation and publication planning,
// so the app reads a two-Session fixture history, never this Mac's (BUG-315).
// Line shapes follow packages/core/src/__tests__/consumption-fixtures.ts; the
// instants sit inside the last hour, on one operator-local date.
const TIMEZONE = 'America/Los_Angeles';
const localDate = ms =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ms);
const SPAN_MS = 6 * 60_000;
let end = Date.now() - 2 * 60_000;
while (localDate(end - SPAN_MS) !== localDate(end)) end -= 60_000;
const start = end - SPAN_MS;
const at = offsetMs => new Date(start + offsetMs).toISOString();
const jsonl = records => records.map(r => JSON.stringify(r)).join('\n') + '\n';

const history = mkdtempSync(join(tmpdir(), 'exawatt-operator-stats-history-'));
const claudeRoot = join(history, 'claude-projects');
const codexRoot = join(history, 'codex-sessions');
const grokRoot = join(history, 'grok-sessions');
for (const dir of [
  join(claudeRoot, '-w-acme'),
  join(codexRoot, 'day'),
  grokRoot,
]) {
  mkdirSync(dir, { recursive: true });
}
const claudeTurn = (requestId, uuid, offsetMs, usage) => ({
  parentUuid: 'fixture-parent',
  isSidechain: false,
  type: 'assistant',
  userType: 'external',
  entrypoint: 'cli',
  version: '2.1.219',
  cwd: '/w/acme',
  gitBranch: 'main',
  sessionId: 'sess-op-claude',
  requestId,
  uuid,
  timestamp: at(offsetMs),
  message: {
    model: 'claude-sonnet-5',
    id: `msg_${requestId}`,
    type: 'message',
    role: 'assistant',
    content: [],
    stop_reason: 'end_turn',
    usage: {
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      service_tier: 'standard',
      ...usage,
    },
  },
});
const REQUEST_A = {
  input_tokens: 12,
  cache_creation_input_tokens: 4_000,
  cache_read_input_tokens: 96_000,
  output_tokens: 250,
};
writeFileSync(
  join(claudeRoot, '-w-acme', 'sess-op-claude.jsonl'),
  jsonl([
    {
      type: 'user',
      sessionId: 'sess-op-claude',
      cwd: '/w/acme',
      timestamp: at(0),
      message: { role: 'user', content: 'fixture turn' },
    },
    // One request written three times: counted once.
    claudeTurn('req_op_a', 'u1', 1_000, REQUEST_A),
    claudeTurn('req_op_a', 'u2', 1_400, REQUEST_A),
    claudeTurn('req_op_a', 'u3', 1_900, REQUEST_A),
    // One streaming request whose usage grows: counted at its final size.
    claudeTurn('req_op_b', 'u4', 300_000, {
      input_tokens: 5,
      cache_creation_input_tokens: 1_000,
      cache_read_input_tokens: 100_000,
      output_tokens: 1,
    }),
    claudeTurn('req_op_b', 'u5', 302_000, {
      input_tokens: 5,
      cache_creation_input_tokens: 1_000,
      cache_read_input_tokens: 100_000,
      output_tokens: 640,
    }),
  ])
);
const codexUsage = ([input, cached, write, output, reasoning, total]) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  cache_write_input_tokens: write,
  output_tokens: output,
  reasoning_output_tokens: reasoning,
  total_tokens: total,
});
const codexTokens = (offsetMs, total, last) => ({
  timestamp: at(offsetMs),
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: {
      total_token_usage: codexUsage(total),
      last_token_usage: codexUsage(last),
      model_context_window: 258_400,
    },
  },
});
const FIRST = [17_569, 11_008, 0, 214, 69, 17_783];
const SECOND_TOTAL = [44_700, 33_000, 0, 786, 250, 45_486];
const SECOND = [27_131, 21_992, 0, 572, 181, 27_703];
writeFileSync(
  join(codexRoot, 'day', 'rollout-2026-01-01T00-00-00-codex-op-1.jsonl'),
  jsonl([
    {
      timestamp: at(60_000),
      type: 'session_meta',
      payload: {
        session_id: 'codex-op-1',
        id: 'codex-op-1',
        timestamp: at(60_000),
        cwd: '/w/acme',
        originator: 'codex-tui',
        cli_version: '0.145.0',
        source: 'cli',
        model_provider: 'openai',
      },
    },
    {
      timestamp: at(61_000),
      type: 'turn_context',
      payload: {
        turn_id: 'fixture-turn',
        cwd: '/w/acme',
        model: 'gpt-5.6-sol',
        collaboration_mode: {
          mode: 'default',
          settings: { reasoning_effort: 'high' },
        },
      },
    },
    // Each cumulative snapshot is emitted twice: counted once.
    codexTokens(65_000, FIRST, FIRST),
    codexTokens(65_400, FIRST, FIRST),
    codexTokens(130_000, SECOND_TOTAL, SECOND),
    codexTokens(130_500, SECOND_TOTAL, SECOND),
  ])
);
// What the fixture implies. Tokens are input + cache read + cache write +
// output (reasoning is part of output); Codex's input includes its cache.
const CLAUDE_TOKENS = 12 + 96_000 + 4_000 + 250 + (5 + 100_000 + 1_000 + 640); // 201,907
const CODEX_TOKENS = 17_783 + 27_703; // 45,486
const FIXTURE_DATE = localDate(start);

try {
  await withElectronApp(
    {
      args: ['.'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'development',
        EXAWATT_TEST: '1',
        EXAWATT_USER_DATA: userData,
        EXAWATT_DEV_URL: `${base}/leaderboard`,
        EXAWATT_CLAUDE_PROJECTS_ROOT: claudeRoot,
        EXAWATT_CODEX_SESSIONS_ROOT: codexRoot,
        EXAWATT_GROK_SESSIONS_ROOT: grokRoot,
      },
    },
    async (_app, page) => {
      page.setDefaultTimeout(30_000);
      // Every board outcome (unconfigured, unavailable, empty, ranked) marks
      // itself, so this waits for the route to render whichever it is.
      await page.locator('[data-board-state]').waitFor();

      const result = await page.evaluate(async timezone => {
        const api = window.electron?.operatorStats;
        if (!api) throw new Error('Operator Stats IPC is unavailable');
        const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const plan = await api.plan({ since, timezone, cursor: null });
        return {
          plan,
          serialized: JSON.stringify(plan),
        };
      }, TIMEZONE);

      const forbidden = [
        'localKey',
        'providerSessionId',
        'sourceFile',
        'cwd',
        'gitBranch',
        'prompt',
        'response',
        'transcript',
      ];
      for (const field of forbidden) {
        if (result.serialized.includes(field)) {
          throw new Error(`Renderer plan leaked forbidden field: ${field}`);
        }
      }
      const { plan } = result;
      const DAY_MS = 86_400_000;
      for (const publication of plan.publications) {
        const span =
          (Date.parse(publication.coverage.through) -
            Date.parse(publication.coverage.from)) /
            DAY_MS +
          1;
        if (
          publication.schemaVersion !== 2 ||
          publication.consentVersion !== 1 ||
          publication.enabled !== true ||
          publication.timezone !== TIMEZONE ||
          span < 1 ||
          span > 31 ||
          publication.runs.length > 500 ||
          [...publication.days, ...publication.runs].some(
            row =>
              row.localDate < publication.coverage.from ||
              row.localDate > publication.coverage.through
          )
        ) {
          throw new Error('Operator Stats publication contract was malformed');
        }
      }
      if (plan.excluded.length > 0) {
        throw new Error(
          `Operator Stats quarantined rows: ${JSON.stringify(plan.excluded)}`
        );
      }

      // Exactly what the fixture implies: one publication, one day, one Run
      // per Session, each counting its Session's tokens once.
      const [publication, ...extra] = plan.publications;
      const runs = (publication?.runs ?? [])
        .map(run => ({ tokens: run.rawTokens, sources: run.sources }))
        .sort((a, b) => a.tokens - b.tokens);
      const days = (publication?.days ?? []).map(day => ({
        localDate: day.localDate,
        runCount: day.runCount,
        tokens: day.rawTokens,
        sources: [...day.sources].sort(),
      }));
      const expected = {
        publications: 1,
        runs: [
          { tokens: CODEX_TOKENS, sources: ['codex'] },
          { tokens: CLAUDE_TOKENS, sources: ['claude-code'] },
        ],
        days: [
          {
            localDate: FIXTURE_DATE,
            runCount: 2,
            tokens: CLAUDE_TOKENS + CODEX_TOKENS,
            sources: ['claude-code', 'codex'],
          },
        ],
      };
      const actual = { publications: 1 + extra.length, runs, days };
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(
          `Operator Stats plan did not match its fixture:\n` +
            `  expected ${JSON.stringify(expected)}\n` +
            `  actual   ${JSON.stringify(actual)}`
        );
      }
      console.log(
        `PASS Electron operator stats: 1 publication, 2 sanitized Runs ` +
          `(${CODEX_TOKENS} and ${CLAUDE_TOKENS} tokens), 1 day`
      );
    },
    { maxMs: 120_000 }
  );
} finally {
  rmSync(userData, { recursive: true, force: true });
  rmSync(history, { recursive: true, force: true });
}
