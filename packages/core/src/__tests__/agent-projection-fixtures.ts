import {
  AGENT_PROJECTION_VERSION,
  type AgentProjectionPlanV1,
  type AgentSourceTopologySnapshot,
} from '../agent-projection';

/**
 * Public-safe, authored simulation based only on the operator-confirmed
 * conceptual shape of the first ENG-010 topology: two Gateways, the active
 * coworkers Marcus, Scout, and Tyler, plus retired Priya.
 *
 * Every technical identifier, timestamp, context/run lineage relationship,
 * and payload value is invented. Nothing here was copied from a live
 * installation, endpoint, credential, filesystem, or source payload.
 */
const FIXTURE_OBSERVED_AT = 1_800_000_000_000;
const MINUTE_MS = 60_000;

const SOURCE_A = 'fixture-openclaw-source-a';
const SOURCE_B = 'fixture-openclaw-source-b';

export const CONNECTED_OPENCLAW_TOPOLOGY_FIXTURES = [
  {
    configuredSourceId: SOURCE_A,
    adapterId: 'openclaw',
    placement: 'customer-hosted',
    gatewayId: 'fixture-openclaw-gateway-a',
    observedAt: FIXTURE_OBSERVED_AT,
    evidenceBasis: 'simulated',
    agents: [
      {
        configuredSourceId: SOURCE_A,
        nativeAgentId: 'primary',
        displayName: 'Marcus',
        discoveryState: 'configured',
      },
      {
        configuredSourceId: SOURCE_A,
        nativeAgentId: 'calendar',
        displayName: 'Scout',
        discoveryState: 'configured',
      },
    ],
    contexts: [
      {
        configuredSourceId: SOURCE_A,
        nativeAgentId: 'primary',
        nativeContextId: 'agent:primary:main',
        kind: 'main',
        nativeKind: 'main',
        roles: ['primary-conversation'],
        parent: null,
        nativeRunId: null,
        hasActiveRun: false,
        createdAt: FIXTURE_OBSERVED_AT - 180 * MINUTE_MS,
        lastActiveAt: FIXTURE_OBSERVED_AT - 30 * MINUTE_MS,
      },
      {
        configuredSourceId: SOURCE_A,
        nativeAgentId: 'primary',
        nativeContextId: 'fixture:channel:marcus:one',
        kind: 'channel',
        nativeKind: 'channel',
        roles: [],
        parent: null,
        nativeRunId: 'fixture-run-marcus-channel',
        createdAt: FIXTURE_OBSERVED_AT - 75 * MINUTE_MS,
        lastActiveAt: FIXTURE_OBSERVED_AT - 8 * MINUTE_MS,
      },
      {
        configuredSourceId: SOURCE_A,
        nativeAgentId: 'primary',
        nativeContextId: 'fixture:cron:marcus:one',
        kind: 'cron',
        nativeKind: 'cron',
        roles: [],
        parent: null,
        nativeRunId: 'fixture-run-marcus-cron',
        hasActiveRun: true,
        createdAt: FIXTURE_OBSERVED_AT - 45 * MINUTE_MS,
        lastActiveAt: FIXTURE_OBSERVED_AT - 5 * MINUTE_MS,
      },
      {
        configuredSourceId: SOURCE_A,
        nativeAgentId: 'primary',
        nativeContextId: 'fixture:helper:marcus:one',
        kind: 'helper',
        nativeKind: 'helper',
        roles: [],
        parent: {
          configuredSourceId: SOURCE_A,
          nativeAgentId: 'primary',
          nativeContextId: 'fixture:cron:marcus:one',
        },
        nativeRunId: 'fixture-run-marcus-helper',
        createdAt: FIXTURE_OBSERVED_AT - 12 * MINUTE_MS,
        lastActiveAt: FIXTURE_OBSERVED_AT - 2 * MINUTE_MS,
      },
      {
        configuredSourceId: SOURCE_A,
        nativeAgentId: 'calendar',
        nativeContextId: 'agent:calendar:main',
        kind: 'main',
        nativeKind: 'main',
        roles: ['primary-conversation'],
        parent: null,
        nativeRunId: null,
        createdAt: FIXTURE_OBSERVED_AT - 240 * MINUTE_MS,
        lastActiveAt: FIXTURE_OBSERVED_AT - 18 * MINUTE_MS,
      },
      {
        configuredSourceId: SOURCE_A,
        nativeAgentId: 'calendar',
        nativeContextId: 'fixture:spawned:scout:one',
        kind: 'spawned',
        nativeKind: 'spawned',
        roles: [],
        parent: {
          configuredSourceId: SOURCE_A,
          nativeAgentId: 'calendar',
          nativeContextId: 'agent:calendar:main',
        },
        nativeRunId: 'fixture-run-scout-spawned',
        createdAt: FIXTURE_OBSERVED_AT - 15 * MINUTE_MS,
        lastActiveAt: FIXTURE_OBSERVED_AT - MINUTE_MS,
      },
    ],
    automations: [
      // Marcus schedules one job and its last run was fine.
      {
        configuredSourceId: SOURCE_A,
        nativeAgentId: 'primary',
        nativeAutomationId: 'fixture-automation-marcus-sweep',
        enabled: true,
        lastOutcome: 'succeeded',
        lastRunAt: FIXTURE_OBSERVED_AT - 45 * MINUTE_MS,
        targetContextId: 'fixture:cron:marcus:one',
      },
      // Scout's job failed and the operator switched it off. A failure the
      // operator already answered is history, not the coworker's state.
      {
        configuredSourceId: SOURCE_A,
        nativeAgentId: 'calendar',
        nativeAutomationId: 'fixture-automation-scout-digest',
        enabled: false,
        lastOutcome: 'failed',
        lastRunAt: FIXTURE_OBSERVED_AT - 900 * MINUTE_MS,
        targetContextId: null,
      },
    ],
  },
  {
    configuredSourceId: SOURCE_B,
    adapterId: 'openclaw',
    placement: 'customer-hosted',
    gatewayId: 'fixture-openclaw-gateway-b',
    observedAt: FIXTURE_OBSERVED_AT - MINUTE_MS,
    evidenceBasis: 'simulated',
    agents: [
      {
        configuredSourceId: SOURCE_B,
        nativeAgentId: 'primary',
        displayName: 'Tyler',
        discoveryState: 'configured',
      },
      {
        configuredSourceId: SOURCE_B,
        nativeAgentId: 'legacy',
        displayName: 'Priya',
        discoveryState: 'retired',
      },
    ],
    contexts: [
      {
        configuredSourceId: SOURCE_B,
        nativeAgentId: 'primary',
        nativeContextId: 'agent:primary:main',
        kind: 'main',
        nativeKind: 'main',
        roles: ['primary-conversation'],
        parent: null,
        nativeRunId: null,
        hasActiveRun: false,
        createdAt: FIXTURE_OBSERVED_AT - 210 * MINUTE_MS,
        lastActiveAt: FIXTURE_OBSERVED_AT - 25 * MINUTE_MS,
      },
      {
        configuredSourceId: SOURCE_B,
        nativeAgentId: 'primary',
        nativeContextId: 'fixture:channel:tyler:one',
        kind: 'channel',
        nativeKind: 'channel',
        roles: [],
        parent: null,
        nativeRunId: 'fixture-run-tyler-channel',
        createdAt: FIXTURE_OBSERVED_AT - 40 * MINUTE_MS,
        lastActiveAt: FIXTURE_OBSERVED_AT - 7 * MINUTE_MS,
      },
      {
        configuredSourceId: SOURCE_B,
        nativeAgentId: 'primary',
        nativeContextId: 'fixture:cron:tyler:one',
        kind: 'cron',
        nativeKind: 'cron',
        roles: [],
        parent: null,
        nativeRunId: 'fixture-run-tyler-cron',
        hasActiveRun: false,
        createdAt: FIXTURE_OBSERVED_AT - 20 * MINUTE_MS,
        lastActiveAt: FIXTURE_OBSERVED_AT - 3 * MINUTE_MS,
      },
      {
        configuredSourceId: SOURCE_B,
        nativeAgentId: 'legacy',
        nativeContextId: 'agent:legacy:main',
        kind: 'main',
        nativeKind: 'main',
        roles: ['primary-conversation'],
        parent: null,
        nativeRunId: null,
        createdAt: FIXTURE_OBSERVED_AT - 4_800 * MINUTE_MS,
        lastActiveAt: FIXTURE_OBSERVED_AT - 3_600 * MINUTE_MS,
      },
      {
        configuredSourceId: SOURCE_B,
        nativeAgentId: 'legacy',
        nativeContextId: 'fixture:cron:priya:historical',
        kind: 'cron',
        nativeKind: 'cron',
        roles: [],
        parent: null,
        nativeRunId: 'fixture-run-priya-historical',
        createdAt: FIXTURE_OBSERVED_AT - 4_200 * MINUTE_MS,
        lastActiveAt: FIXTURE_OBSERVED_AT - 3_900 * MINUTE_MS,
      },
    ],
    automations: [
      // Tyler's only automation is scheduled and its last run failed. Nothing
      // of his is running, so this is the one thing his source knows about his
      // work, and it is a fault someone has to answer.
      {
        configuredSourceId: SOURCE_B,
        nativeAgentId: 'primary',
        nativeAutomationId: 'fixture-automation-tyler-interval',
        enabled: true,
        lastOutcome: 'failed',
        lastRunAt: FIXTURE_OBSERVED_AT - 21 * MINUTE_MS,
        targetContextId: 'fixture:cron:tyler:one',
      },
    ],
    /*
     * The Gateway's own totals. Two failures somewhere on this box, and
     * deliberately not attributable: the payload buckets by status and
     * runtime, never by Agent, so no coworker is blamed for them.
     */
    taskFacts: {
      total: 14,
      active: 1,
      terminal: 13,
      failures: 2,
      byStatus: { running: 1, succeeded: 11, failed: 2 },
      byRuntime: { cron: 12, subagent: 2 },
      auditWarnings: 1,
      auditErrors: 0,
    },
  },
] as const satisfies readonly AgentSourceTopologySnapshot[];

export const CONNECTED_OPENCLAW_PROJECTION_PLAN = {
  projectionVersion: AGENT_PROJECTION_VERSION,
  mappings: [
    {
      configuredSourceId: SOURCE_A,
      nativeAgentId: 'primary',
      exawattAgentId: 'fixture-agent-marcus',
      projectId: 'fixture-project-reddit-marcus',
      displayNameOverride: null,
    },
    {
      configuredSourceId: SOURCE_A,
      nativeAgentId: 'calendar',
      exawattAgentId: 'fixture-agent-scout',
      projectId: 'fixture-project-calendar-scout',
      displayNameOverride: null,
    },
    {
      configuredSourceId: SOURCE_B,
      nativeAgentId: 'primary',
      exawattAgentId: 'fixture-agent-tyler',
      projectId: 'fixture-project-reddit-tyler',
      displayNameOverride: null,
    },
  ],
} as const satisfies AgentProjectionPlanV1;
