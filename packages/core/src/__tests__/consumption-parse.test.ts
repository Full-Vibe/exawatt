import { describe, expect, it } from 'vitest';
import { splitCompleteLines } from '../consumption/lines';
import { mergeSamples, totalTokens } from '../consumption/merge';
import { parseClaudeTranscript } from '../consumption/parse-claude';
import {
  latestPlanWindows,
  parseCodexRollout,
} from '../consumption/parse-codex';
import { assuranceLevel } from '../consumption/assurance';
import { isOperatorEntrypoint } from '../consumption/types';
import { SOURCE_CAPABILITIES } from '../consumption/types';
import {
  CLAUDE_DAMAGED_JSONL,
  CLAUDE_DELEGATED_JSONL,
  CLAUDE_DELEGATED_META_JSON,
  CLAUDE_SDK_INVOCATION_JSONL,
  CLAUDE_INTERACTIVE_HAIKU_JSONL,
  CLAUDE_DELEGATED_NO_META_JSONL,
  CLAUDE_MIXED_MODELS_JSONL,
  CLAUDE_NO_CWD_JSONL,
  CLAUDE_ORDINARY_JSONL,
  CODEX_DAMAGED_JSONL,
  CODEX_NO_META_JSONL,
  CODEX_NO_RATE_LIMITS_JSONL,
  CODEX_RATE_LIMITED_JSONL,
  CODEX_RESET_AND_INTERLEAVED_JSONL,
  fixtureLines,
} from './consumption-fixtures';

describe('splitCompleteLines', () => {
  it('returns only writer-finished lines and reports the truncated tail', () => {
    const split = splitCompleteLines('{"a":1}\n{"b":2}\n{"c":');
    expect(split.lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(split.truncatedTail).toBe('{"c":');
    expect(split.consumedBytes).toBe('{"a":1}\n{"b":2}\n'.length);
  });

  it('consumes nothing when no line has been terminated yet', () => {
    const split = splitCompleteLines('{"partial"');
    expect(split.lines).toEqual([]);
    expect(split.consumedBytes).toBe(0);
    expect(split.truncatedTail).toBe('{"partial"');
  });

  it('counts bytes, not code units, so multibyte content resumes correctly', () => {
    const split = splitCompleteLines('{"t":"café"}\n');
    expect(split.consumedBytes).toBe(14);
  });
});

describe('parseClaudeTranscript', () => {
  it('extracts cache-read-dominant usage and normalizes the cache fields', () => {
    const { samples } = parseClaudeTranscript(
      fixtureLines(CLAUDE_ORDINARY_JSONL)
    );
    const first = samples[0];
    expect(first.usage).toEqual({
      inputTokens: 12,
      cacheReadTokens: 96_000,
      cacheWriteTokens: 4_000,
      outputTokens: 250,
      reasoningTokens: 0,
      webSearches: 1,
      webFetches: 2,
    });
    expect(first.cwd).toBe('/w/acme');
    expect(first.gitBranch).toBe('main');
    expect(first.effort).toBe('high');
    expect(first.model).toBe('claude-sonnet-5');
    expect(first.providerSessionId).toBe('sess-claude-1');
  });

  it('counts every non-usage line rather than dropping it silently', () => {
    const { samples, diagnostics } = parseClaudeTranscript(
      fixtureLines(CLAUDE_ORDINARY_JSONL)
    );
    expect(diagnostics.linesRead).toBe(6);
    expect(diagnostics.linesWithoutUsage).toBe(1);
    expect(diagnostics.linesUnparsable).toBe(0);
    expect(samples).toHaveLength(5);
    expect(
      diagnostics.samplesEmitted + diagnostics.linesWithoutUsage
    ).toBe(diagnostics.linesRead);
  });

  it('keys idempotency on requestId', () => {
    const { samples } = parseClaudeTranscript(
      fixtureLines(CLAUDE_ORDINARY_JSONL)
    );
    const keys = samples.map(sample => sample.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
    expect(keys[0]).toBe('claude-code:req:req_fixture_a');
  });

  it('reports a missing cwd instead of inventing one', () => {
    const { samples, diagnostics } = parseClaudeTranscript(
      fixtureLines(CLAUDE_NO_CWD_JSONL)
    );
    expect(samples[0].cwd).toBeNull();
    expect(samples[0].gitBranch).toBeNull();
    expect(diagnostics.recordsWithoutCwd).toBe(1);
  });

  it('treats <synthetic> as no model and counts it', () => {
    const { samples, diagnostics } = parseClaudeTranscript(
      fixtureLines(CLAUDE_MIXED_MODELS_JSONL)
    );
    expect(samples.map(sample => sample.model)).toEqual([
      'claude-opus-5',
      null,
    ]);
    expect(diagnostics.recordsWithoutModel).toBe(1);
  });

  it('never throws on a corrupt, non-object, or truncated file', () => {
    const split = splitCompleteLines(CLAUDE_DAMAGED_JSONL);
    const { samples, diagnostics } = parseClaudeTranscript(split.lines);
    expect(split.truncatedTail).not.toBeNull();
    expect(diagnostics.linesUnparsable).toBe(2);
    expect(samples).toHaveLength(1);
    expect(samples[0].providerSessionId).toBe('sess-claude-4');
  });

  it('claims reported and observed assurance, never verified', () => {
    const { samples } = parseClaudeTranscript(
      fixtureLines(CLAUDE_ORDINARY_JSONL)
    );
    const assurance = samples[0].assurance;
    expect(assurance.reported.held).toBe(true);
    expect(assurance.observed.held).toBe(true);
    expect(assurance.authorized.held).toBe(false);
    expect(assurance.enforced.held).toBe(false);
    expect(assurance.verified.held).toBe(false);
    expect(assurance.verified.by).toBeNull();
    expect(assurance.verified.note).toBeTruthy();
    expect(assuranceLevel(assurance)).toBe('observed');
  });
});

describe('delegated (subagent) attribution', () => {
  it('attributes a delegated record to its parent Session and marks it delegated', () => {
    const { samples, diagnostics } = parseClaudeTranscript(
      fixtureLines(CLAUDE_DELEGATED_JSONL),
      { delegationMeta: JSON.parse(CLAUDE_DELEGATED_META_JSON) }
    );
    expect(diagnostics.delegatedRecords).toBe(3);
    expect(samples[0].providerSessionId).toBe('sess-claude-1');
    expect(samples[0].delegation).toEqual({
      agentId: 'agent-fixture-1',
      parentSessionId: 'sess-claude-1',
      agentType: 'Explore',
      spawnDepth: 1,
      skill: null,
      background: true,
      parentAgentId: null,
    });
    expect(samples[1].delegation?.skill).toBe('find-skills');
  });

  it('records a child model that differs from the parent', () => {
    const { samples } = parseClaudeTranscript(
      fixtureLines(CLAUDE_DELEGATED_JSONL)
    );
    expect(samples[0].model).toBe('claude-opus-4-8');
  });

  it('leaves spawnDepth null when no sidecar exists rather than assuming 1', () => {
    const { samples } = parseClaudeTranscript(
      fixtureLines(CLAUDE_DELEGATED_NO_META_JSONL)
    );
    expect(samples[0].delegation?.agentType).toBe('general-purpose');
    expect(samples[0].delegation?.spawnDepth).toBeNull();
  });

  it('marks a parent turn as not delegated', () => {
    const { samples, diagnostics } = parseClaudeTranscript(
      fixtureLines(CLAUDE_ORDINARY_JSONL)
    );
    expect(samples.every(s => s.delegation === null)).toBe(true);
    expect(diagnostics.delegatedRecords).toBe(0);
  });

  it('never merges a delegated run into a parent turn that reused its requestId', () => {
    const parent = parseClaudeTranscript(fixtureLines(CLAUDE_ORDINARY_JSONL));
    const child = parseClaudeTranscript(fixtureLines(CLAUDE_DELEGATED_JSONL));
    const merged = mergeSamples([...parent.samples, ...child.samples]);
    const forRequestA = merged.samples.filter(sample =>
      sample.idempotencyKey.includes('req_fixture_a')
    );
    expect(forRequestA).toHaveLength(2);
    expect(forRequestA.filter(s => s.delegation !== null)).toHaveLength(1);
    // Both survive, so the delegated share is not corrupted by the collision.
    expect(
      forRequestA.map(s => s.usage.outputTokens).sort((a, b) => a - b)
    ).toEqual([9, 250]);
  });

  it('separates two delegated runs inside one transcript', () => {
    const { samples } = parseClaudeTranscript(
      fixtureLines(CLAUDE_DELEGATED_JSONL)
    );
    expect(new Set(samples.map(s => s.delegation?.agentId))).toEqual(
      new Set(['agent-fixture-1', 'agent-fixture-2'])
    );
  });

  it('reports delegation as an absent capability for Codex, never as zero', () => {
    const { samples } = parseCodexRollout(
      fixtureLines(CODEX_RATE_LIMITED_JSONL)
    );
    expect(samples[0].delegation).toBeNull();
    expect(SOURCE_CAPABILITIES.codex.delegation).toBe(false);
    expect(SOURCE_CAPABILITIES['claude-code'].delegation).toBe(true);
    // The mirror case: Claude cannot report plan windows.
    expect(SOURCE_CAPABILITIES['claude-code'].planWindows).toBe(false);
    expect(SOURCE_CAPABILITIES.codex.planWindows).toBe(true);
  });
});

describe('Claude duplicate handling', () => {
  it('collapses repeated lines for one request instead of summing them', () => {
    const { samples } = parseClaudeTranscript(
      fixtureLines(CLAUDE_ORDINARY_JSONL)
    );
    const merged = mergeSamples(samples);
    expect(merged.samples).toHaveLength(2);
    expect(merged.duplicatesMerged).toBe(3);

    const naive = samples.reduce(
      (sum, sample) => sum + totalTokens(sample.usage),
      0
    );
    const deduped = merged.samples.reduce(
      (sum, sample) => sum + totalTokens(sample.usage),
      0
    );
    expect(naive).toBeGreaterThan(deduped * 1.5);
    expect(deduped).toBe(100_262 + 101_645);
  });

  it('keeps the largest snapshot of a streaming request, not the first', () => {
    const { samples } = parseClaudeTranscript(
      fixtureLines(CLAUDE_ORDINARY_JSONL)
    );
    const merged = mergeSamples(samples);
    const streamed = merged.samples.find(
      sample => sample.idempotencyKey === 'claude-code:req:req_fixture_b'
    );
    expect(streamed?.usage.outputTokens).toBe(640);
    // The earliest observed instant is kept as the start of the unit of work.
    expect(streamed?.at).toBe('2026-07-01T10:05:00.000Z');
  });

  it('is order-independent and idempotent', () => {
    const { samples } = parseClaudeTranscript(
      fixtureLines(CLAUDE_ORDINARY_JSONL)
    );
    const forward = mergeSamples(samples).samples;
    const reversed = mergeSamples([...samples].reverse()).samples;
    const sortKey = (a: { idempotencyKey: string }) => a.idempotencyKey;
    expect([...reversed].sort((a, b) => sortKey(a).localeCompare(sortKey(b))))
      .toEqual([...forward].sort((a, b) => sortKey(a).localeCompare(sortKey(b))));
    // Re-merging an already-merged set changes nothing.
    expect(mergeSamples(forward).samples).toEqual(forward);
    expect(mergeSamples(forward).duplicatesMerged).toBe(0);
  });
});

describe('parseCodexRollout', () => {
  it('normalizes Codex prompt tokens, which include the cached ones', () => {
    const { samples } = parseCodexRollout(
      fixtureLines(CODEX_RATE_LIMITED_JSONL)
    );
    expect(samples[0].usage).toEqual({
      inputTokens: 17_569 - 11_008,
      cacheReadTokens: 11_008,
      cacheWriteTokens: 0,
      outputTokens: 214,
      reasoningTokens: 69,
      webSearches: 0,
      webFetches: 0,
    });
    // reasoningTokens is a subset of outputTokens and is not double counted.
    expect(totalTokens(samples[0].usage)).toBe(17_569 + 214);
  });

  it('takes model and effort from turn_context, and cwd from session_meta', () => {
    const { samples } = parseCodexRollout(
      fixtureLines(CODEX_RATE_LIMITED_JSONL)
    );
    expect(samples[0].model).toBe('gpt-5.6-sol');
    expect(samples[0].effort).toBe('xhigh');
    expect(samples[0].cwd).toBe('/w/acme');
    expect(samples[0].contextWindow).toBe(258_400);
  });

  it('drops duplicate token_count events instead of summing them twice', () => {
    const { samples, diagnostics } = parseCodexRollout(
      fixtureLines(CODEX_RATE_LIMITED_JSONL)
    );
    expect(samples).toHaveLength(2);
    expect(diagnostics.duplicatesMerged).toBe(2);
    // The reconstruction equals the final cumulative total for a clean session.
    const reconstructed = samples.reduce(
      (sum, sample) => sum + totalTokens(sample.usage),
      0
    );
    expect(reconstructed).toBe(45_486);
  });

  it('never sums the cumulative counter, which would be catastrophic', () => {
    const { samples } = parseCodexRollout(
      fixtureLines(CODEX_RATE_LIMITED_JSONL)
    );
    const reconstructed = samples.reduce(
      (sum, sample) => sum + totalTokens(sample.usage),
      0
    );
    // Summing every cumulative snapshot (including the duplicates) would give
    // 126,538 for a session that actually used 45,486.
    expect(reconstructed).toBeLessThan(126_538 / 2);
  });

  it('survives a compaction reset and two interleaved cumulative series', () => {
    const { samples } = parseCodexRollout(
      fixtureLines(CODEX_RESET_AND_INTERLEAVED_JSONL)
    );
    const reconstructed = samples.reduce(
      (sum, sample) => sum + totalTokens(sample.usage),
      0
    );
    // Deltas telescope correctly across the reset and across both series;
    // max(total_token_usage) would report only 93,000.
    expect(reconstructed).toBe(51_000 + 8_200 + 10_300 + 42_000 + 8_300);
    expect(reconstructed).toBeGreaterThan(93_000);
  });

  it('emits plan windows for a rate-limited session', () => {
    const { planWindows, diagnostics } = parseCodexRollout(
      fixtureLines(CODEX_RATE_LIMITED_JSONL)
    );
    expect(diagnostics.planWindowsEmitted).toBe(10);
    const latest = latestPlanWindows(planWindows);
    expect(latest).toHaveLength(2);
    const primary = latest.find(window => window.scope === 'primary');
    expect(primary).toMatchObject({
      source: 'codex',
      limitId: 'codex',
      usedPercent: 59,
      windowMinutes: 10_080,
      planType: 'pro',
    });
    expect(primary?.resetsAt).toBe(
      new Date(1_785_262_479 * 1000).toISOString()
    );
  });

  it('leaves capacity absent, not zero, when a session has no rate limits', () => {
    const { samples, planWindows } = parseCodexRollout(
      fixtureLines(CODEX_NO_RATE_LIMITS_JSONL)
    );
    expect(samples).toHaveLength(2);
    expect(planWindows).toEqual([]);
  });

  it('still records capacity from an info-less heartbeat', () => {
    const { planWindows } = parseCodexRollout(
      fixtureLines(CODEX_RATE_LIMITED_JSONL)
    );
    const observed = planWindows.map(window => window.observedAt);
    expect(observed).toContain('2026-07-05T19:07:00.000Z');
  });

  it('falls back to the filename for session identity', () => {
    const { samples } = parseCodexRollout(fixtureLines(CODEX_NO_META_JSONL), {
      fallbackSessionId: 'codex-sess-5',
    });
    expect(samples[0].providerSessionId).toBe('codex-sess-5');
    expect(samples[0].cwd).toBe('/w/acme');
  });

  it('drops usage it cannot attribute to a session, and counts it', () => {
    const { samples, diagnostics } = parseCodexRollout(
      fixtureLines(CODEX_NO_META_JSONL)
    );
    expect(samples).toHaveLength(0);
    expect(diagnostics.recordsWithoutSessionId).toBe(1);
  });

  it('never throws on a corrupt, non-object, or truncated file', () => {
    const split = splitCompleteLines(CODEX_DAMAGED_JSONL);
    const { samples, diagnostics } = parseCodexRollout(split.lines);
    expect(split.truncatedTail).not.toBeNull();
    expect(diagnostics.linesUnparsable).toBe(2);
    expect(samples).toHaveLength(1);
    expect(samples[0].providerSessionId).toBe('codex-sess-4');
  });

  it('carries session context across an incremental tail read', () => {
    const lines = fixtureLines(CODEX_RATE_LIMITED_JSONL);
    const head = parseCodexRollout(lines.slice(0, 3));
    const tail = parseCodexRollout(lines.slice(3), {
      session: head.session,
    });
    // The tail never saw session_meta or turn_context, but still attributes.
    expect(tail.samples[0].cwd).toBe('/w/acme');
    expect(tail.samples[0].model).toBe('gpt-5.6-sol');
    expect(tail.samples[0].providerSessionId).toBe('codex-sess-1');
    // The duplicate that straddles the split is still suppressed.
    expect(head.samples.length + tail.samples.length).toBe(2);
  });
});

describe('entrypoint (operator work vs machine-invoked)', () => {
  it('captures Claude Code entrypoint verbatim', () => {
    const interactive = parseClaudeTranscript(fixtureLines(CLAUDE_ORDINARY_JSONL));
    expect(interactive.samples.every(s => s.entrypoint === 'cli')).toBe(true);

    const programmatic = parseClaudeTranscript(fixtureLines(CLAUDE_SDK_INVOCATION_JSONL));
    expect(programmatic.samples).toHaveLength(1);
    expect(programmatic.samples[0].entrypoint).toBe('sdk-cli');
  });

  it('captures Codex originator as the entrypoint analogue', () => {
    const result = parseCodexRollout(fixtureLines(CODEX_RATE_LIMITED_JSONL));
    expect(result.samples.length).toBeGreaterThan(0);
    expect(result.samples[0].entrypoint).toBe('codex-tui');

    // No session_meta means the source cannot say. null, not a guess.
    const noMeta = parseCodexRollout(fixtureLines(CODEX_NO_META_JSONL), {
      fallbackSessionId: 'sess-codex-fallback',
    });
    expect(noMeta.samples.every(s => s.entrypoint === null)).toBe(true);
  });

  it('classifies sdk entrypoints as machine-invoked and everything else as operator work', () => {
    expect(isOperatorEntrypoint('cli')).toBe(true);
    expect(isOperatorEntrypoint('claude-desktop')).toBe(true);
    expect(isOperatorEntrypoint('codex-tui')).toBe(true);
    expect(isOperatorEntrypoint('sdk-cli')).toBe(false);
  });

  it('treats an unknown entrypoint as operator work so usage is never lost', () => {
    // Under-reporting is the worse failure: an entrypoint this parser has never
    // seen must still count toward a total rather than silently vanishing.
    expect(isOperatorEntrypoint(null)).toBe(true);
    expect(isOperatorEntrypoint('some-future-entrypoint')).toBe(true);
  });

  it('does not use the model as a proxy for machine invocation', () => {
    // A haiku turn in an INTERACTIVE session is operator work. Filtering on
    // model rather than entrypoint would wrongly discard it.
    const result = parseClaudeTranscript(fixtureLines(CLAUDE_INTERACTIVE_HAIKU_JSONL));
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0].model).toContain('haiku');
    expect(result.samples[0].entrypoint).toBe('cli');
    expect(isOperatorEntrypoint(result.samples[0].entrypoint)).toBe(true);
  });
});
