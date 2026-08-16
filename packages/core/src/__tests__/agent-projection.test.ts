import { describe, expect, it } from 'vitest';
import {
  AGENT_PROJECTION_VERSION,
  projectAgentTopology,
  sourceAgentKey,
  sourceContextKey,
  type AgentProjectionPlanV1,
  type AgentProjectionResult,
  type AgentSourceTopologySnapshot,
  type SourceAgentRecord,
  type SourceContextRecord,
} from '../index';
import {
  CONNECTED_OPENCLAW_PROJECTION_PLAN,
  CONNECTED_OPENCLAW_TOPOLOGY_FIXTURES,
} from './agent-projection-fixtures';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function successful(result: AgentProjectionResult) {
  if (!result.ok) {
    throw new Error(
      `Expected projection success, got: ${result.issues
        .map(issue => issue.code)
        .join(', ')}`
    );
  }
  return result;
}

function issueCodes(result: AgentProjectionResult): string[] {
  return result.issues.map(issue => issue.code);
}

function agent(
  configuredSourceId: string,
  nativeAgentId: string,
  displayName = nativeAgentId
): SourceAgentRecord {
  return {
    configuredSourceId,
    nativeAgentId,
    displayName,
    discoveryState: 'configured',
  };
}

function context(
  configuredSourceId: string,
  nativeAgentId: string,
  nativeContextId: string,
  overrides: Partial<SourceContextRecord> = {}
): SourceContextRecord {
  return {
    configuredSourceId,
    nativeAgentId,
    nativeContextId,
    kind: 'main',
    nativeKind: 'main',
    roles: ['primary-conversation'],
    parent: null,
    nativeRunId: null,
    createdAt: 1_000,
    lastActiveAt: 2_000,
    ...overrides,
  };
}

function topology(
  configuredSourceId: string,
  agents: SourceAgentRecord[],
  contexts: SourceContextRecord[]
): AgentSourceTopologySnapshot {
  return {
    configuredSourceId,
    adapterId: 'openclaw',
    placement: 'customer-hosted',
    gatewayId: `gateway-${configuredSourceId}`,
    observedAt: 10_000,
    evidenceBasis: 'observed',
    agents,
    contexts,
  };
}

function plan(
  mappings: AgentProjectionPlanV1['mappings']
): AgentProjectionPlanV1 {
  return {
    projectionVersion: AGENT_PROJECTION_VERSION,
    mappings,
  };
}

function mapping(
  configuredSourceId: string,
  nativeAgentId: string,
  exawattAgentId = `exa-${configuredSourceId}-${nativeAgentId}`
) {
  return {
    configuredSourceId,
    nativeAgentId,
    exawattAgentId,
    projectId: `project-${nativeAgentId}`,
    displayNameOverride: null,
  };
}

describe('agent topology projection (ENG-010 C0)', () => {
  it('projects exactly Marcus, Scout, and Tyler while retaining retired Priya outside the roster', () => {
    const result = successful(
      projectAgentTopology(
        CONNECTED_OPENCLAW_TOPOLOGY_FIXTURES,
        CONNECTED_OPENCLAW_PROJECTION_PLAN
      )
    );

    expect(result.projection.projectionVersion).toBe(AGENT_PROJECTION_VERSION);
    expect(
      result.projection.agents.map(agent => agent.displayName).sort()
    ).toEqual(['Marcus', 'Scout', 'Tyler']);
    expect(
      result.projection.unprojectedAgents.map(agent => ({
        name: agent.displayName,
        state: agent.discoveryState,
      }))
    ).toEqual([{ name: 'Priya', state: 'retired' }]);
  });

  it('keeps two coworkers distinct when one Gateway exposes both', () => {
    const result = successful(
      projectAgentTopology(
        CONNECTED_OPENCLAW_TOPOLOGY_FIXTURES,
        CONNECTED_OPENCLAW_PROJECTION_PLAN
      )
    );
    const marcus = result.projection.agents.find(
      agent => agent.displayName === 'Marcus'
    )!;
    const scout = result.projection.agents.find(
      agent => agent.displayName === 'Scout'
    )!;

    expect(marcus.configuredSourceId).toBe(scout.configuredSourceId);
    expect(marcus.gatewayId).toBe(scout.gatewayId);
    expect(marcus.id).not.toBe(scout.id);
    expect(marcus.nativeAgentId).not.toBe(scout.nativeAgentId);
  });

  it('qualifies repeated native Agent and context ids without delimiter collisions', () => {
    expect(
      sourceAgentKey({ configuredSourceId: 'a:b', nativeAgentId: 'c' })
    ).not.toBe(
      sourceAgentKey({ configuredSourceId: 'a', nativeAgentId: 'b:c' })
    );
    expect(
      sourceContextKey({
        configuredSourceId: 'a:b',
        nativeAgentId: 'c',
        nativeContextId: 'main',
      })
    ).not.toBe(
      sourceContextKey({
        configuredSourceId: 'a',
        nativeAgentId: 'b:c',
        nativeContextId: 'main',
      })
    );

    const snapshots = [
      topology(
        'source-one',
        [agent('source-one', 'worker')],
        [context('source-one', 'worker', 'main')]
      ),
      topology(
        'source-two',
        [agent('source-two', 'worker')],
        [context('source-two', 'worker', 'main')]
      ),
    ];
    const result = successful(
      projectAgentTopology(
        snapshots,
        plan([mapping('source-one', 'worker'), mapping('source-two', 'worker')])
      )
    );

    expect(result.projection.agents).toHaveLength(2);
    expect(
      new Set(
        result.projection.agents.map(projected =>
          sourceContextKey(projected.contexts[0]!)
        )
      ).size
    ).toBe(2);
  });

  it('uses the declared primary conversation even when subordinate work is newer', () => {
    const source = topology(
      'source-primary',
      [agent('source-primary', 'marcus', 'Marcus')],
      [
        context('source-primary', 'marcus', 'agent:marcus:main', {
          lastActiveAt: 2_000,
        }),
        context('source-primary', 'marcus', 'cron:newer', {
          kind: 'cron',
          nativeKind: 'cron-run',
          roles: [],
          lastActiveAt: 9_000,
        }),
      ]
    );
    const result = successful(
      projectAgentTopology(
        [source],
        plan([mapping('source-primary', 'marcus')])
      )
    );

    expect(
      result.projection.agents[0]!.primaryConversation?.nativeContextId
    ).toBe('agent:marcus:main');
  });

  it('preserves context kind and lineage without promoting contexts into Agents', () => {
    expect(
      [
        ...new Set(
          CONNECTED_OPENCLAW_TOPOLOGY_FIXTURES.flatMap(snapshot =>
            snapshot.contexts.map(context => context.kind)
          )
        ),
      ].sort()
    ).toEqual(['channel', 'cron', 'helper', 'main', 'spawned']);

    const main = context('source-lineage', 'scout', 'main');
    const helper = context('source-lineage', 'scout', 'helper-1', {
      kind: 'helper',
      nativeKind: 'calendar-research',
      roles: [],
      parent: {
        configuredSourceId: 'source-lineage',
        nativeAgentId: 'scout',
        nativeContextId: 'main',
      },
    });
    const result = successful(
      projectAgentTopology(
        [
          topology(
            'source-lineage',
            [agent('source-lineage', 'scout', 'Scout')],
            [main, helper]
          ),
        ],
        plan([mapping('source-lineage', 'scout')])
      )
    );

    expect(result.projection.agents).toHaveLength(1);
    expect(result.projection.agents[0]!.contexts).toHaveLength(2);
    expect(
      result.projection.agents[0]!.contexts.find(
        item => item.nativeContextId === 'helper-1'
      )
    ).toMatchObject({
      kind: 'helper',
      nativeKind: 'calendar-research',
      parent: {
        configuredSourceId: 'source-lineage',
        nativeAgentId: 'scout',
        nativeContextId: 'main',
      },
    });
  });

  it('keeps a mapped Agent open with a warning when no primary is declared', () => {
    const result = successful(
      projectAgentTopology(
        [
          topology(
            'source-no-primary',
            [agent('source-no-primary', 'worker')],
            [
              context('source-no-primary', 'worker', 'channel-1', {
                kind: 'channel',
                nativeKind: 'channel',
                roles: [],
              }),
            ]
          ),
        ],
        plan([mapping('source-no-primary', 'worker')])
      )
    );

    expect(result.projection.agents[0]!.primaryConversation).toBeNull();
    expect(result.issues).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'primary-conversation-missing',
      }),
    ]);
  });

  it('fails closed on multiple primary conversations', () => {
    const result = projectAgentTopology(
      [
        topology(
          'source-duplicate-primary',
          [agent('source-duplicate-primary', 'worker')],
          [
            context('source-duplicate-primary', 'worker', 'main-a'),
            context('source-duplicate-primary', 'worker', 'main-b'),
          ]
        ),
      ],
      plan([mapping('source-duplicate-primary', 'worker')])
    );

    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('multiple-primary-conversations');
  });

  it.each([
    {
      label: 'native Agent identity',
      mutate(snapshot: AgentSourceTopologySnapshot) {
        snapshot.agents = [...snapshot.agents, clone(snapshot.agents[0]!)];
      },
      code: 'duplicate-agent',
    },
    {
      label: 'native context identity',
      mutate(snapshot: AgentSourceTopologySnapshot) {
        snapshot.contexts = [
          ...snapshot.contexts,
          clone(snapshot.contexts[0]!),
        ];
      },
      code: 'duplicate-context',
    },
  ])('fails closed on duplicate $label', ({ mutate, code }) => {
    const snapshot = topology(
      'source-duplicate',
      [agent('source-duplicate', 'worker')],
      [context('source-duplicate', 'worker', 'main')]
    );
    mutate(snapshot);

    const result = projectAgentTopology(
      [snapshot],
      plan([mapping('source-duplicate', 'worker')])
    );
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain(code);
  });

  it('fails closed when two source Agents map to one Exawatt Agent id', () => {
    const snapshot = topology(
      'source-collision',
      [agent('source-collision', 'one'), agent('source-collision', 'two')],
      [
        context('source-collision', 'one', 'main'),
        context('source-collision', 'two', 'main'),
      ]
    );
    const result = projectAgentTopology(
      [snapshot],
      plan([
        mapping('source-collision', 'one', 'exa-shared'),
        mapping('source-collision', 'two', 'exa-shared'),
      ])
    );

    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('duplicate-exawatt-agent');
  });

  it('fails closed when a mapping names a missing source Agent', () => {
    const result = projectAgentTopology(
      [topology('source-missing', [], [])],
      plan([mapping('source-missing', 'not-there')])
    );

    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('missing-mapped-agent');
  });

  it('fails closed on orphaned contexts and parents outside the owning Agent', () => {
    const orphanedAgent = topology(
      'source-orphan-agent',
      [],
      [context('source-orphan-agent', 'ghost', 'main')]
    );
    const orphanedParent = topology(
      'source-orphan-parent',
      [agent('source-orphan-parent', 'worker')],
      [
        context('source-orphan-parent', 'worker', 'main'),
        context('source-orphan-parent', 'worker', 'helper', {
          kind: 'helper',
          roles: [],
          parent: {
            configuredSourceId: 'source-orphan-parent',
            nativeAgentId: 'worker',
            nativeContextId: 'missing-parent',
          },
        }),
      ]
    );
    const crossSourceParent = topology(
      'source-cross-parent',
      [agent('source-cross-parent', 'worker')],
      [
        context('source-cross-parent', 'worker', 'main'),
        context('source-cross-parent', 'worker', 'helper', {
          kind: 'helper',
          roles: [],
          parent: {
            configuredSourceId: 'some-other-source',
            nativeAgentId: 'worker',
            nativeContextId: 'main',
          },
        }),
      ]
    );
    const crossAgentParent = topology(
      'source-cross-agent-parent',
      [
        agent('source-cross-agent-parent', 'worker'),
        agent('source-cross-agent-parent', 'other'),
      ],
      [
        context('source-cross-agent-parent', 'worker', 'main'),
        context('source-cross-agent-parent', 'other', 'main'),
        context('source-cross-agent-parent', 'worker', 'helper', {
          kind: 'helper',
          roles: [],
          parent: {
            configuredSourceId: 'source-cross-agent-parent',
            nativeAgentId: 'other',
            nativeContextId: 'main',
          },
        }),
      ]
    );

    expect(
      issueCodes(projectAgentTopology([orphanedAgent], plan([])))
    ).toContain('orphan-context-agent');
    expect(
      issueCodes(
        projectAgentTopology(
          [orphanedParent],
          plan([mapping('source-orphan-parent', 'worker')])
        )
      )
    ).toContain('orphan-parent-context');
    expect(
      issueCodes(
        projectAgentTopology(
          [crossSourceParent],
          plan([mapping('source-cross-parent', 'worker')])
        )
      )
    ).toContain('cross-source-parent');
    expect(
      issueCodes(
        projectAgentTopology(
          [crossAgentParent],
          plan([mapping('source-cross-agent-parent', 'worker')])
        )
      )
    ).toContain('cross-agent-parent');
  });

  it('fails closed on an unsupported projection version', () => {
    const unsupported = {
      ...CONNECTED_OPENCLAW_PROJECTION_PLAN,
      projectionVersion: 2,
    } as unknown as AgentProjectionPlanV1;
    const result = projectAgentTopology(
      CONNECTED_OPENCLAW_TOPOLOGY_FIXTURES,
      unsupported
    );

    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toEqual(['unsupported-projection-version']);
  });

  it('fails closed instead of throwing on malformed adapter collections, roles, and parent refs', () => {
    const malformedCollections = {
      ...topology('source-bad-arrays', [], []),
      agents: null,
      contexts: null,
    } as unknown as AgentSourceTopologySnapshot;
    const malformedContext = {
      ...context('source-bad-context', 'worker', 'main'),
      roles: null,
      parent: false,
    } as unknown as SourceContextRecord;

    expect(() =>
      projectAgentTopology([malformedCollections], plan([]))
    ).not.toThrow();
    expect(
      issueCodes(projectAgentTopology([malformedCollections], plan([])))
    ).toContain('invalid-source');

    const malformedResult = projectAgentTopology(
      [
        topology(
          'source-bad-context',
          [agent('source-bad-context', 'worker')],
          [malformedContext]
        ),
      ],
      plan([mapping('source-bad-context', 'worker')])
    );
    expect(malformedResult.ok).toBe(false);
    expect(issueCodes(malformedResult)).toContain('invalid-context');
  });

  it('fails closed instead of throwing on malformed source, Agent, context, and mapping members', () => {
    const source = topology(
      'source-malformed-members',
      [agent('source-malformed-members', 'worker')],
      [context('source-malformed-members', 'worker', 'main')]
    );
    const invalidAgentSource = {
      ...source,
      agents: [null],
    } as unknown as AgentSourceTopologySnapshot;
    const invalidContextSource = {
      ...source,
      contexts: [null],
    } as unknown as AgentSourceTopologySnapshot;
    const invalidMappingPlan = {
      projectionVersion: AGENT_PROJECTION_VERSION,
      mappings: [null],
    } as unknown as AgentProjectionPlanV1;
    const cases: Array<{
      code: string;
      run: () => AgentProjectionResult;
    }> = [
      {
        code: 'invalid-source',
        run: () =>
          projectAgentTopology(
            [null] as unknown as readonly AgentSourceTopologySnapshot[],
            plan([])
          ),
      },
      {
        code: 'invalid-agent',
        run: () => projectAgentTopology([invalidAgentSource], plan([])),
      },
      {
        code: 'invalid-context',
        run: () => projectAgentTopology([invalidContextSource], plan([])),
      },
      {
        code: 'invalid-mapping',
        run: () => projectAgentTopology([source], invalidMappingPlan),
      },
    ];

    for (const testCase of cases) {
      let result: AgentProjectionResult | undefined;
      expect(() => {
        result = testCase.run();
      }).not.toThrow();
      expect(issueCodes(result!)).toContain(testCase.code);
    }
  });

  it('rejects an adapter id outside the declared Agent Source contract', () => {
    const snapshot = {
      ...topology(
        'source-unknown-adapter',
        [agent('source-unknown-adapter', 'worker')],
        [context('source-unknown-adapter', 'worker', 'main')]
      ),
      adapterId: 'invented-adapter',
    } as unknown as AgentSourceTopologySnapshot;
    const result = projectAgentTopology(
      [snapshot],
      plan([mapping('source-unknown-adapter', 'worker')])
    );

    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('invalid-source');
  });

  it('applies display-name and Project remaps without mutating source truth or its plan', () => {
    const snapshots: AgentSourceTopologySnapshot[] = clone([
      ...CONNECTED_OPENCLAW_TOPOLOGY_FIXTURES,
    ]);
    const originalPlan: AgentProjectionPlanV1 = clone(
      CONNECTED_OPENCLAW_PROJECTION_PLAN
    );
    const snapshotsBefore = clone(snapshots);
    const planBefore = clone(originalPlan);
    const marcusMapping = originalPlan.mappings.find(mapping => {
      const record = snapshots
        .flatMap(snapshot => snapshot.agents)
        .find(
          agent =>
            agent.configuredSourceId === mapping.configuredSourceId &&
            agent.nativeAgentId === mapping.nativeAgentId &&
            agent.displayName === 'Marcus'
        );
      return Boolean(record);
    })!;
    const remappedPlan: AgentProjectionPlanV1 = {
      ...originalPlan,
      mappings: originalPlan.mappings.map(item =>
        item === marcusMapping
          ? {
              ...item,
              displayNameOverride: 'Marcus Prime',
              projectId: 'project-reddit-operations',
            }
          : item
      ),
    };

    const before = successful(projectAgentTopology(snapshots, originalPlan));
    const after = successful(projectAgentTopology(snapshots, remappedPlan));
    const beforeMarcus = before.projection.agents.find(
      agent => agent.nativeAgentId === marcusMapping.nativeAgentId
    )!;
    const afterMarcus = after.projection.agents.find(
      agent => agent.nativeAgentId === marcusMapping.nativeAgentId
    )!;

    expect(afterMarcus).toMatchObject({
      id: beforeMarcus.id,
      displayName: 'Marcus Prime',
      projectId: 'project-reddit-operations',
      configuredSourceId: beforeMarcus.configuredSourceId,
      nativeAgentId: beforeMarcus.nativeAgentId,
    });
    expect(snapshots).toEqual(snapshotsBefore);
    expect(originalPlan).toEqual(planBefore);
  });

  it('is deterministic across repeated calls and reordered source input', () => {
    const reordered: AgentSourceTopologySnapshot[] = clone([
      ...CONNECTED_OPENCLAW_TOPOLOGY_FIXTURES,
    ])
      .reverse()
      .map(snapshot => ({
        ...snapshot,
        agents: [...snapshot.agents].reverse(),
        contexts: [...snapshot.contexts].reverse(),
      }));
    const reorderedPlan: AgentProjectionPlanV1 = {
      ...CONNECTED_OPENCLAW_PROJECTION_PLAN,
      mappings: [...CONNECTED_OPENCLAW_PROJECTION_PLAN.mappings].reverse(),
    };
    const baseline = projectAgentTopology(
      CONNECTED_OPENCLAW_TOPOLOGY_FIXTURES,
      CONNECTED_OPENCLAW_PROJECTION_PLAN
    );

    expect(
      projectAgentTopology(
        CONNECTED_OPENCLAW_TOPOLOGY_FIXTURES,
        CONNECTED_OPENCLAW_PROJECTION_PLAN
      )
    ).toEqual(baseline);
    expect(projectAgentTopology(reordered, reorderedPlan)).toEqual(baseline);
  });

  it('keeps the dogfood fixture free of connection and operator payload material', () => {
    const fixture = {
      snapshots: CONNECTED_OPENCLAW_TOPOLOGY_FIXTURES,
      plan: CONNECTED_OPENCLAW_PROJECTION_PLAN,
    };
    const keys: string[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        keys.push(key.toLowerCase().replaceAll('-', '').replaceAll('_', ''));
        visit(child);
      }
    };
    visit(fixture);

    for (const forbidden of [
      'endpoint',
      'ip',
      'credential',
      'secret',
      'password',
      'token',
      'path',
      'prompt',
      'schedule',
    ]) {
      expect(
        keys.filter(key => key.includes(forbidden)),
        forbidden
      ).toEqual([]);
    }

    const serialized = JSON.stringify(fixture);
    expect(serialized).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    expect(serialized).not.toMatch(/(?:[a-f\d]{1,4}:){2,}[a-f\d]{0,4}/i);
    expect(serialized).not.toMatch(/(?:\/Users\/|~\/\.|ssh-|@|\.com\b)/i);
  });
});
