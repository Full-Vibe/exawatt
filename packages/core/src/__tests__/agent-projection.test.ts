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

  it('pins the authored two-Gateway topology and keeps Tyler distinct despite repeated bare native ids', () => {
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
    const tyler = result.projection.agents.find(
      agent => agent.displayName === 'Tyler'
    )!;

    expect(CONNECTED_OPENCLAW_TOPOLOGY_FIXTURES).toHaveLength(2);
    expect(
      CONNECTED_OPENCLAW_TOPOLOGY_FIXTURES.map(snapshot => ({
        source: snapshot.configuredSourceId,
        gateway: snapshot.gatewayId,
        coworkers: snapshot.agents.map(agent => ({
          name: agent.displayName,
          state: agent.discoveryState,
        })),
      }))
    ).toEqual([
      {
        source: 'fixture-openclaw-source-a',
        gateway: 'fixture-openclaw-gateway-a',
        coworkers: [
          { name: 'Marcus', state: 'configured' },
          { name: 'Scout', state: 'configured' },
        ],
      },
      {
        source: 'fixture-openclaw-source-b',
        gateway: 'fixture-openclaw-gateway-b',
        coworkers: [
          { name: 'Tyler', state: 'configured' },
          { name: 'Priya', state: 'retired' },
        ],
      },
    ]);

    expect(marcus.configuredSourceId).toBe(scout.configuredSourceId);
    expect(marcus.gatewayId).toBe(scout.gatewayId);
    expect(marcus.id).not.toBe(scout.id);
    expect(marcus.nativeAgentId).not.toBe(scout.nativeAgentId);
    expect(marcus.nativeAgentId).toBe('primary');
    expect(tyler.nativeAgentId).toBe('primary');
    expect(marcus.primaryConversation?.nativeContextId).toBe(
      'agent:primary:main'
    );
    expect(tyler.primaryConversation?.nativeContextId).toBe(
      'agent:primary:main'
    );
    expect(marcus.configuredSourceId).not.toBe(tyler.configuredSourceId);
    expect(marcus.gatewayId).not.toBe(tyler.gatewayId);
    expect(marcus.id).not.toBe(tyler.id);
  });

  it('can explicitly project retired Priya without erasing her source state', () => {
    const priyaMapping = {
      configuredSourceId: 'fixture-openclaw-source-b',
      nativeAgentId: 'legacy',
      exawattAgentId: 'fixture-agent-priya',
      projectId: 'fixture-project-reddit-priya',
      displayNameOverride: null,
    } as const;
    const result = successful(
      projectAgentTopology(
        CONNECTED_OPENCLAW_TOPOLOGY_FIXTURES,
        plan([...CONNECTED_OPENCLAW_PROJECTION_PLAN.mappings, priyaMapping])
      )
    );
    const priya = result.projection.agents.find(
      agent => agent.displayName === 'Priya'
    );

    expect(priya).toMatchObject({
      id: 'fixture-agent-priya',
      configuredSourceId: 'fixture-openclaw-source-b',
      nativeAgentId: 'legacy',
      discoveryState: 'retired',
      projectId: 'fixture-project-reddit-priya',
    });
    expect(result.projection.unprojectedAgents).toEqual([]);
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

  it.each(['observed', 'declared', 'simulated'] as const)(
    'projects %s evidence through the same source-neutral kernel',
    evidenceBasis => {
      const source = {
        ...topology(
          `source-evidence-${evidenceBasis}`,
          [agent(`source-evidence-${evidenceBasis}`, 'worker', 'Worker')],
          [context(`source-evidence-${evidenceBasis}`, 'worker', 'main')]
        ),
        evidenceBasis,
      } satisfies AgentSourceTopologySnapshot;
      const result = successful(
        projectAgentTopology(
          [source],
          plan([mapping(source.configuredSourceId, 'worker')])
        )
      );

      expect(result.projection.agents[0]!.evidenceBasis).toBe(evidenceBasis);
    }
  );

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

  it('reads an Agent as running when any one of its contexts is', () => {
    const result = successful(
      projectAgentTopology(
        CONNECTED_OPENCLAW_TOPOLOGY_FIXTURES,
        CONNECTED_OPENCLAW_PROJECTION_PLAN
      )
    );
    const byName = new Map(
      result.projection.agents.map(agent => [agent.displayName, agent])
    );

    // Marcus is conversationally quiet and his automation is mid-run. The
    // coworker is working; which context is doing it stays on the contexts.
    const marcus = byName.get('Marcus')!;
    expect(marcus.hasActiveRun).toBe(true);
    expect(marcus.primaryConversation?.hasActiveRun).toBe(false);
    expect(
      marcus.contexts
        .filter(context => context.hasActiveRun === true)
        .map(context => context.nativeContextId)
    ).toEqual(['fixture:cron:marcus:one']);

    // Tyler's source says every context of his is idle; Scout's says nothing
    // about any of them. Neither is running, and neither is stopped.
    expect(byName.get('Tyler')!.hasActiveRun).toBe(false);
    expect(byName.get('Scout')!.hasActiveRun).toBe(false);
    expect(
      byName
        .get('Scout')!
        .contexts.every(context => context.hasActiveRun === undefined)
    ).toBe(true);
  });

  it('never lets an unreported or non-boolean run signal read as running', () => {
    const sourceId = 'source-run-signal';
    const result = successful(
      projectAgentTopology(
        [
          topology(
            sourceId,
            [agent(sourceId, 'quiet'), agent(sourceId, 'busy')],
            [
              // The source declared nothing at all for this one.
              context(sourceId, 'quiet', 'agent:quiet:main'),
              context(sourceId, 'quiet', 'agent:quiet:cron', {
                kind: 'cron',
                nativeKind: 'cron',
                roles: [],
                hasActiveRun: false,
              }),
              context(sourceId, 'busy', 'agent:busy:main', {
                hasActiveRun: false,
              }),
              context(sourceId, 'busy', 'agent:busy:helper', {
                kind: 'helper',
                nativeKind: 'helper',
                roles: [],
                hasActiveRun: true,
              }),
            ]
          ),
        ],
        plan([mapping(sourceId, 'quiet'), mapping(sourceId, 'busy')])
      )
    );
    const byNative = new Map(
      result.projection.agents.map(agent => [agent.nativeAgentId, agent])
    );

    expect(byNative.get('quiet')!.hasActiveRun).toBe(false);
    expect(byNative.get('busy')!.hasActiveRun).toBe(true);
    // Absent survives as absent: the kernel never fills in a false the source
    // did not say, because unknown and idle are different answers.
    expect(
      byNative
        .get('quiet')!
        .contexts.find(
          context => context.nativeContextId === 'agent:quiet:main'
        )!.hasActiveRun
    ).toBeUndefined();
  });

  it('fails closed on a run signal that is not a boolean', () => {
    const sourceId = 'source-bad-run-signal';
    for (const hasActiveRun of ['running', 1, null, {}]) {
      const result = projectAgentTopology(
        [
          topology(
            sourceId,
            [agent(sourceId, 'worker')],
            [
              {
                ...context(sourceId, 'worker', 'agent:worker:main'),
                hasActiveRun,
              } as unknown as SourceContextRecord,
            ]
          ),
        ],
        plan([mapping(sourceId, 'worker')])
      );
      expect(result.ok).toBe(false);
      expect(issueCodes(result)).toContain('invalid-context');
    }
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

  it('rejects ambiguous primary conversations before an Agent is selected for projection', () => {
    const sourceId = 'source-unprojected-duplicate-primary';
    const result = projectAgentTopology(
      [
        topology(
          sourceId,
          [agent(sourceId, 'retired-worker')],
          [
            context(sourceId, 'retired-worker', 'main-a'),
            context(sourceId, 'retired-worker', 'main-b'),
          ]
        ),
      ],
      plan([])
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

  it('fails closed on duplicate configured sources and duplicate source-Agent mappings', () => {
    const snapshot = topology(
      'source-duplicate-boundary',
      [agent('source-duplicate-boundary', 'worker')],
      [context('source-duplicate-boundary', 'worker', 'main')]
    );
    const sourceMapping = mapping('source-duplicate-boundary', 'worker');

    const duplicateSourceResult = projectAgentTopology(
      [snapshot, clone(snapshot)],
      plan([sourceMapping])
    );
    const duplicateMappingResult = projectAgentTopology(
      [snapshot],
      plan([
        sourceMapping,
        {
          ...sourceMapping,
          exawattAgentId: 'exa-second-projection',
          projectId: 'project-second-projection',
        },
      ])
    );

    expect(duplicateSourceResult.ok).toBe(false);
    expect(issueCodes(duplicateSourceResult)).toContain('duplicate-source');
    expect(duplicateMappingResult.ok).toBe(false);
    expect(issueCodes(duplicateMappingResult)).toContain('duplicate-mapping');
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

  it.each([
    {
      label: 'self-parenting',
      contexts: [
        context('source-cyclic-self', 'worker', 'main', {
          parent: {
            configuredSourceId: 'source-cyclic-self',
            nativeAgentId: 'worker',
            nativeContextId: 'main',
          },
        }),
      ],
      sourceId: 'source-cyclic-self',
    },
    {
      label: 'a multi-context cycle',
      contexts: [
        context('source-cyclic-pair', 'worker', 'a', {
          parent: {
            configuredSourceId: 'source-cyclic-pair',
            nativeAgentId: 'worker',
            nativeContextId: 'b',
          },
        }),
        context('source-cyclic-pair', 'worker', 'b', {
          roles: [],
          parent: {
            configuredSourceId: 'source-cyclic-pair',
            nativeAgentId: 'worker',
            nativeContextId: 'a',
          },
        }),
      ],
      sourceId: 'source-cyclic-pair',
    },
  ])('fails closed on $label context lineage', ({ contexts, sourceId }) => {
    const result = projectAgentTopology(
      [topology(sourceId, [agent(sourceId, 'worker')], contexts)],
      plan([mapping(sourceId, 'worker')])
    );

    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('cyclic-context-lineage');
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

  it.each([
    {
      label: 'a BigInt context id',
      malformedId: BigInt(1),
    },
    {
      label: 'a circular-object context id',
      malformedId: (() => {
        const value: { self?: unknown } = {};
        value.self = value;
        return value;
      })(),
    },
  ])('fails closed instead of throwing on $label', ({ malformedId }) => {
    const sourceId = 'source-malformed-context-id';
    const malformedContext = {
      ...context(sourceId, 'worker', 'main'),
      nativeContextId: malformedId,
    } as unknown as SourceContextRecord;
    let result: AgentProjectionResult | undefined;

    expect(() => {
      result = projectAgentTopology(
        [topology(sourceId, [agent(sourceId, 'worker')], [malformedContext])],
        plan([mapping(sourceId, 'worker')])
      );
    }).not.toThrow();
    expect(result!.ok).toBe(false);
    expect(issueCodes(result!)).toContain('invalid-context');
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

  it('does not propagate unknown source, Agent, context, or mapping fields across the projection boundary', () => {
    const sourceId = 'source-allowlisted-copy';
    const sourceAgent = {
      ...agent(sourceId, 'worker', 'Worker'),
      endpointSentinel: 'sentinel-agent-endpoint-value',
    } as unknown as SourceAgentRecord;
    const sourceContext = {
      ...context(sourceId, 'worker', 'main'),
      credentialSentinel: 'sentinel-context-credential-value',
    } as unknown as SourceContextRecord;
    const source = {
      ...topology(sourceId, [sourceAgent], [sourceContext]),
      connectionSentinel: 'sentinel-source-connection-value',
    } as unknown as AgentSourceTopologySnapshot;
    const sourceMapping = {
      ...mapping(sourceId, 'worker'),
      privateKeySentinel: 'sentinel-mapping-private-key-value',
    } as unknown as AgentProjectionPlanV1['mappings'][number];

    const result = successful(
      projectAgentTopology([source], plan([sourceMapping]))
    );
    const serialized = JSON.stringify(result);

    expect(result.issues).toEqual([]);
    expect(serialized).not.toContain('Sentinel');
    expect(serialized).not.toContain('sentinel-');
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

  it('keeps the authored fixture inside an explicit public-safe schema and value boundary', () => {
    const fixture = {
      snapshots: CONNECTED_OPENCLAW_TOPOLOGY_FIXTURES,
      plan: CONNECTED_OPENCLAW_PROJECTION_PLAN,
    };
    const allowedKeys = new Set([
      'snapshots',
      'plan',
      'configuredSourceId',
      'adapterId',
      'placement',
      'gatewayId',
      'observedAt',
      'evidenceBasis',
      'agents',
      'contexts',
      'nativeAgentId',
      'displayName',
      'discoveryState',
      'nativeContextId',
      'kind',
      'nativeKind',
      'roles',
      'parent',
      'nativeRunId',
      'hasActiveRun',
      'createdAt',
      'lastActiveAt',
      'projectionVersion',
      'mappings',
      'exawattAgentId',
      'projectId',
      'displayNameOverride',
    ]);
    const keys = new Set<string>();
    const stringValues: string[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (typeof value === 'string') {
        stringValues.push(value);
        return;
      }
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        keys.add(key);
        visit(child);
      }
    };
    visit(fixture);

    for (const key of keys) {
      expect(allowedKeys.has(key), `unexpected fixture field: ${key}`).toBe(
        true
      );
    }

    const serializedValues = JSON.stringify(stringValues);
    const forbiddenValues: ReadonlyArray<readonly [string, RegExp]> = [
      ['URL', /\b(?:https?|wss?|ssh):\/\//i],
      ['domain', /\b(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}\b/i],
      [
        'host-and-port endpoint',
        /\b(?:localhost|[a-z][a-z\d-]*|(?:\d{1,3}\.){3}\d{1,3}):\d{2,5}\b/i,
      ],
      ['IPv4 address', /\b(?:\d{1,3}\.){3}\d{1,3}\b/],
      ['IPv6 address', /\b(?:[a-f\d]{1,4}:){2,}[a-f\d]{0,4}\b/i],
      ['PEM material', /-----BEGIN [A-Z ]+-----/],
      ['filesystem path', /(?:\/Users\/|\/home\/|\/root\/|~\/\.?|[a-z]:\\)/i],
      ['SSH key material', /\b(?:ssh-(?:rsa|ed25519)|sk-ssh-)\b/i],
      [
        'credential material',
        /\b(?:bearer\s+|api[_-]?key|password|passwd|secret|access[_-]?token)\b/i,
      ],
      ['user-qualified endpoint', /\b[^\s"']+@[^\s"']+\b/],
    ];

    for (const [label, pattern] of forbiddenValues) {
      expect(serializedValues, label).not.toMatch(pattern);
    }
  });
});
