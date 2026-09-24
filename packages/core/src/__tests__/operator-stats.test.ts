import { describe, expect, it } from 'vitest';
import {
  activityGraphLevel,
  addCalendarDays,
  deriveOperatorRun,
  deriveOperatorStatsSnapshot,
  MAX_PUBLICATION_DAYS,
  MAX_PUBLIC_RUN_MS,
  OperatorStatsContractError,
  parseOperatorStatsPublishPayload,
  rankOperators,
  consumptionSamplesToRunFacts,
  type OperatorRunFacts,
  type OperatorStatsPublishPayload,
} from '../operator-stats';
import { localLogAssurance } from '../consumption/assurance';
import type { ConsumptionSample } from '../consumption/types';

const hour = 3_600_000;

function iso(offsetHours: number): string {
  return new Date(Date.UTC(2026, 7, 3) + offsetHours * hour).toISOString();
}

function run(overrides: Partial<OperatorRunFacts> = {}): OperatorRunFacts {
  return {
    localKey: 'local-only-key',
    startedAt: iso(0),
    endedAt: iso(2),
    activity: [
      {
        startedAt: iso(0),
        endedAt: iso(2),
        activeMembers: 1,
        assurance: 'observed',
      },
    ],
    operatorInterventionsAt: [],
    rawTokens: 100,
    normalizedTokens: 140,
    sources: ['codex'],
    assurance: ['observed'],
    outcome: 'settled',
    ...overrides,
  };
}

describe('operator stats derivation', () => {
  it('integrates twelve agents for two hours as 24 agent-hours', () => {
    const derived = deriveOperatorRun(
      run({
        activity: [
          {
            startedAt: iso(0),
            endedAt: iso(2),
            activeMembers: 12,
            assurance: 'reported',
          },
        ],
      })
    );
    expect(derived.agentMs).toBe(24 * hour);
    expect(derived.activeMs).toBe(2 * hour);
    expect(derived.peakActiveMembers).toBe(12);
  });

  it('keeps steering inside one run and resets hands-off duration', () => {
    const derived = deriveOperatorRun(
      run({ operatorInterventionsAt: [iso(0.5), iso(1.25)] })
    );
    expect(derived.interventionCount).toBe(2);
    expect(derived.longestHandsOffMs).toBe(0.75 * hour);
  });

  it('pauses active time at a question gate while preserving elapsed time', () => {
    const derived = deriveOperatorRun(
      run({
        activity: [
          {
            startedAt: iso(0),
            endedAt: iso(0.75),
            activeMembers: 1,
            assurance: 'observed',
          },
          {
            startedAt: iso(1.25),
            endedAt: iso(2),
            activeMembers: 1,
            assurance: 'observed',
          },
        ],
      })
    );
    expect(derived.elapsedMs).toBe(2 * hour);
    expect(derived.activeMs).toBe(1.5 * hour);
    expect(derived.longestHandsOffMs).toBe(0.75 * hour);
  });

  it('continues after a root yields while a child stays live', () => {
    const derived = deriveOperatorRun(
      run({
        activity: [
          {
            startedAt: iso(0),
            endedAt: iso(1),
            activeMembers: 1,
            assurance: 'observed',
          },
          {
            startedAt: iso(0.5),
            endedAt: iso(2),
            activeMembers: 1,
            assurance: 'reported',
          },
        ],
      })
    );
    expect(derived.elapsedMs).toBe(2 * hour);
    expect(derived.agentMs).toBe(2.5 * hour);
    expect(derived.peakActiveMembers).toBe(2);
  });

  it('keeps overlapping top-level runs separate while snapshot totals command', () => {
    const snapshot = deriveOperatorStatsSnapshot(
      [
        run({ localKey: 'a' }),
        run({
          localKey: 'b',
          startedAt: iso(1),
          endedAt: iso(3),
          activity: [
            {
              startedAt: iso(1),
              endedAt: iso(3),
              activeMembers: 1,
              assurance: 'observed',
            },
          ],
        }),
      ],
      'America/Los_Angeles',
      iso(4)
    );
    expect(snapshot.runs).toHaveLength(2);
    expect(snapshot.runs.map(item => item.peakActiveMembers)).toEqual([2, 2]);
    expect(snapshot.records.agentMs).toBe(4 * hour);
    expect(snapshot.records.peakFleet).toBe(2);
    expect(snapshot.days[0].peakFleet).toBe(2);
  });

  it('pins timezone day assignment and graph thresholds', () => {
    const snapshot = deriveOperatorStatsSnapshot(
      [run()],
      'America/Los_Angeles',
      iso(4)
    );
    expect(snapshot.days[0].localDate).toBe('2026-08-02');
    expect(activityGraphLevel(24 * hour)).toBe(5);
    expect(activityGraphLevel(12 * hour)).toBe(4);
  });
});

describe('leaderboard ordering', () => {
  it('breaks rank ties by join time and then handle', () => {
    const ranked = rankOperators(
      [
        {
          handle: 'z',
          displayName: 'Z',
          joinedAt: iso(1),
          agentMs: hour,
          longestHandsOffMs: 0,
          peakFleet: 1,
          normalizedTokens: 1,
        },
        {
          handle: 'b',
          displayName: 'B',
          joinedAt: iso(0),
          agentMs: hour,
          longestHandsOffMs: 0,
          peakFleet: 1,
          normalizedTokens: 1,
        },
        {
          handle: 'a',
          displayName: 'A',
          joinedAt: iso(0),
          agentMs: hour,
          longestHandsOffMs: 0,
          peakFleet: 1,
          normalizedTokens: 1,
        },
      ],
      'agent-hours'
    );
    expect(ranked.map(row => row.handle)).toEqual(['a', 'b', 'z']);
  });
});

describe('publish payload privacy boundary', () => {
  const valid: OperatorStatsPublishPayload = {
    schemaVersion: 2,
    consentVersion: 1,
    enabled: true,
    timezone: 'America/Los_Angeles',
    coverage: { from: '2026-08-01', through: '2026-08-03' },
    identity: {
      provider: 'github',
      providerHandle: 'operator-fixture',
      handle: 'operator-fixture',
      displayName: 'Jake',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
      links: ['https://github.com/operator-fixture'],
    },
    days: [],
    runs: [
      {
        publicId: 'run_abcdefghijklmnop',
        localDate: '2026-08-03',
        idempotencyKey: 'a'.repeat(64),
        elapsedMs: hour,
        activeMs: hour,
        longestHandsOffMs: hour,
        interventionCount: 0,
        peakActiveMembers: 1,
        agentMs: hour,
        rawTokens: 100,
        normalizedTokens: 140,
        sources: ['codex'],
        assurance: ['observed'],
        outcome: 'settled',
      },
    ],
  };

  it('accepts only the allowlisted aggregate', () => {
    expect(parseOperatorStatsPublishPayload(valid)).toEqual(valid);
  });

  it('rejects unknown content fields recursively', () => {
    expect(() =>
      parseOperatorStatsPublishPayload({
        ...valid,
        identity: { ...valid.identity, prompt: 'secret' },
      })
    ).toThrow(/unknown or missing/);
  });

  it('rejects unbounded values', () => {
    expect(() =>
      parseOperatorStatsPublishPayload({
        ...valid,
        runs: [{ ...valid.runs[0], peakActiveMembers: 1_000_000 }],
      })
    ).toThrow(/out of bounds/);
  });

  it('refuses the whole-history body it replaced', () => {
    const { coverage: _coverage, ...legacy } = valid;
    expect(() =>
      parseOperatorStatsPublishPayload({ ...legacy, schemaVersion: 1 })
    ).toThrow(OperatorStatsContractError);
  });

  it('refuses rows outside the dates the body claims to replace', () => {
    expect(() =>
      parseOperatorStatsPublishPayload({
        ...valid,
        runs: [{ ...valid.runs[0], localDate: '2026-08-04' }],
      })
    ).toThrow(/outside coverage/);
  });

  it('refuses a coverage wider than one publication may carry', () => {
    expect(() =>
      parseOperatorStatsPublishPayload({
        ...valid,
        coverage: {
          from: '2026-08-01',
          through: addCalendarDays('2026-08-01', MAX_PUBLICATION_DAYS),
        },
      })
    ).toThrow(/too many days/);
  });

  it('refuses a date that is not on the calendar', () => {
    expect(() =>
      parseOperatorStatsPublishPayload({
        ...valid,
        coverage: { from: '2026-02-30', through: '2026-03-01' },
        runs: [],
      })
    ).toThrow(/coverage.from/);
  });
});

describe('timestamped consumption adapter', () => {
  function sample(
    at: string,
    overrides: Partial<ConsumptionSample> = {}
  ): ConsumptionSample {
    return {
      at,
      source: 'codex',
      model: 'gpt-5',
      effort: null,
      providerSessionId: 'provider-secret',
      cwd: '/private/project',
      gitBranch: null,
      usage: {
        inputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 5,
        reasoningTokens: 2,
        webSearches: 0,
        webFetches: 0,
      },
      assurance: localLogAssurance('codex'),
      idempotencyKey: `key-${at}`,
      contextWindow: null,
      sourceFile: '/private/transcript.jsonl',
      delegation: null,
      entrypoint: 'codex-tui',
      ...overrides,
    };
  }

  it('emits sanitized derived intervals and excludes pre-consent samples', () => {
    const facts = consumptionSamplesToRunFacts(
      [sample(iso(0)), sample(iso(1)), sample(iso(1.25))],
      { since: iso(0.5), inactivityCeilingMs: hour }
    );
    expect(facts).toHaveLength(1);
    expect(facts[0].activity).toHaveLength(1);
    expect(facts[0].activity[0].assurance).toBe('derived');
    expect(JSON.stringify(facts[0])).not.toContain('/private');
    expect(facts[0].rawTokens).toBe(30);
  });

  it('keeps reported delegated members separate from the root', () => {
    const facts = consumptionSamplesToRunFacts(
      [
        sample(iso(0)),
        sample(iso(1)),
        sample(iso(0), {
          source: 'claude-code',
          delegation: {
            agentId: 'child',
            parentSessionId: 'provider-secret',
            agentType: null,
            spawnDepth: 1,
            skill: null,
            background: true,
            parentAgentId: null,
          },
        }),
        sample(iso(1), {
          source: 'claude-code',
          delegation: {
            agentId: 'child',
            parentSessionId: 'provider-secret',
            agentType: null,
            spawnDepth: 1,
            skill: null,
            background: true,
            parentAgentId: null,
          },
        }),
      ],
      { since: iso(0), inactivityCeilingMs: hour }
    );
    expect(facts).toHaveLength(2); // Source identities are honest and separate.
    expect(
      facts
        .flatMap(value => value.activity)
        .some(value => value.assurance === 'reported')
    ).toBe(true);
  });

  // BUG-164: one Session resumed across seven weeks was one 47-day Run. It
  // credited a week of work to the day the Session opened, and no
  // publication could carry it.
  it('splits a resumed Session into Runs credited to the days they ran', () => {
    const facts = consumptionSamplesToRunFacts(
      [
        sample(iso(0)),
        sample(iso(0.5)),
        sample(iso(24 * 9 + 3)),
        sample(iso(24 * 9 + 3.5)),
      ],
      { since: iso(0) }
    );
    const snapshot = deriveOperatorStatsSnapshot(facts, 'UTC', iso(24 * 10));
    expect(snapshot.runs).toHaveLength(2);
    expect(snapshot.days.map(day => day.localDate)).toEqual([
      '2026-08-03',
      '2026-08-12',
    ]);
    expect(Math.max(...snapshot.runs.map(run => run.elapsedMs))).toBeLessThan(
      hour
    );
  });

  it('counts exactly the same activity however a Session is split', () => {
    const at = [0, 0.1, 0.2, 2, 2.05, 30, 30.1, 30.15, 80, 80.2];
    const delegated = {
      agentId: 'child',
      parentSessionId: 'provider-secret',
      agentType: null,
      spawnDepth: 1,
      skill: null,
      background: true,
      parentAgentId: null,
    };
    const samples = [
      ...at.map(offset => sample(iso(offset))),
      ...at.map(offset =>
        sample(iso(offset + 0.05), {
          idempotencyKey: `child-${offset}`,
          source: 'claude-code',
          providerSessionId: 'provider-secret',
          delegation: delegated,
        })
      ),
    ];
    const agentMs = (facts: OperatorRunFacts[]) =>
      deriveOperatorStatsSnapshot(facts, 'UTC', iso(100)).records.agentMs;
    const whole = consumptionSamplesToRunFacts(samples, {
      since: iso(0),
      idleSplitMs: Number.POSITIVE_INFINITY,
      maxRunMs: Number.POSITIVE_INFINITY,
    });
    const split = consumptionSamplesToRunFacts(samples, { since: iso(0) });
    const tight = consumptionSamplesToRunFacts(samples, {
      since: iso(0),
      maxRunMs: 0.12 * hour,
    });
    expect(split.length).toBeGreaterThan(whole.length);
    expect(tight.length).toBeGreaterThan(split.length);
    expect(agentMs(split)).toBe(agentMs(whole));
    expect(agentMs(tight)).toBe(agentMs(whole));
  });

  it('never derives a Run longer than one publication may carry', () => {
    // Forty days of an Agent that never pauses for an hour.
    const samples = Array.from({ length: 40 * 24 * 6 }, (_, index) =>
      sample(iso(index / 6))
    );
    const facts = consumptionSamplesToRunFacts(samples, { since: iso(0) });
    const runs = facts.map(deriveOperatorRun);
    expect(runs.length).toBeGreaterThan(1);
    expect(runs.every(run => run.elapsedMs <= MAX_PUBLIC_RUN_MS)).toBe(true);
  });

  it("keeps the first Run on the Session's own key so shared receipts resolve", () => {
    const facts = consumptionSamplesToRunFacts(
      [sample(iso(0)), sample(iso(0.5)), sample(iso(5)), sample(iso(5.5))],
      { since: iso(0) }
    );
    expect(facts.map(fact => fact.localKey)).toEqual([
      'codex:provider-secret',
      `codex:provider-secret@${iso(5)}`,
    ]);
  });

  it('keeps unobservable interventions unavailable instead of reporting zero', () => {
    const facts = consumptionSamplesToRunFacts(
      [sample(iso(0)), sample(iso(1))],
      { since: iso(0), inactivityCeilingMs: hour }
    );
    const derived = deriveOperatorRun(facts[0]);
    expect(derived.interventionCount).toBeNull();
    expect(derived.assurance).toContain('unavailable');
  });
});
