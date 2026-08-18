import {
  AGENT_SOURCE_ADAPTER_IDS,
  AGENT_SOURCE_EVIDENCE_BASES,
  type AgentSourceAdapterId,
  type AgentSourceEvidenceBasis,
} from './agent-sources';

/** Runtime vocabularies are also the source of their compile-time unions. */
export const AGENT_SOURCE_PLACEMENTS = [
  'local',
  'customer-hosted',
  'exawatt-hosted',
] as const;
export type AgentSourcePlacement = (typeof AGENT_SOURCE_PLACEMENTS)[number];

export const SOURCE_AGENT_DISCOVERY_STATES = [
  'configured',
  'retired',
  'unknown',
] as const;
export type SourceAgentDiscoveryState =
  (typeof SOURCE_AGENT_DISCOVERY_STATES)[number];

export const SOURCE_CONTEXT_KINDS = [
  'main',
  'channel',
  'cron',
  'helper',
  'spawned',
  'other',
] as const;
export type SourceContextKind = (typeof SOURCE_CONTEXT_KINDS)[number];

export const SOURCE_CONTEXT_ROLES = ['primary-conversation'] as const;
export type SourceContextRole = (typeof SOURCE_CONTEXT_ROLES)[number];

/*
 * Sets make untrusted boundary checks cheap; their values come only from the
 * exported tuples above, so runtime validation cannot drift from the unions.
 */
const AGENT_SOURCE_ADAPTER_ID_SET: ReadonlySet<string> = new Set(
  AGENT_SOURCE_ADAPTER_IDS
);
const AGENT_SOURCE_EVIDENCE_BASIS_SET: ReadonlySet<string> = new Set(
  AGENT_SOURCE_EVIDENCE_BASES
);
const AGENT_SOURCE_PLACEMENT_SET: ReadonlySet<string> = new Set(
  AGENT_SOURCE_PLACEMENTS
);
const SOURCE_AGENT_DISCOVERY_STATE_SET: ReadonlySet<string> = new Set(
  SOURCE_AGENT_DISCOVERY_STATES
);
const SOURCE_CONTEXT_KIND_SET: ReadonlySet<string> = new Set(
  SOURCE_CONTEXT_KINDS
);
const SOURCE_CONTEXT_ROLE_SET: ReadonlySet<string> = new Set(
  SOURCE_CONTEXT_ROLES
);

/**
 * Source-neutral Agent projection (ENG-010 C0).
 *
 * Source topology remains intact and source-qualified. The projection only
 * decides which source Agents become Exawatt coworkers and where they appear;
 * it never rewrites a source record or promotes a context into a coworker.
 */

export const AGENT_PROJECTION_VERSION = 1 as const;

export interface SourceAgentRef {
  configuredSourceId: string;
  nativeAgentId: string;
}

export interface SourceContextRef extends SourceAgentRef {
  nativeContextId: string;
}

export interface SourceAgentRecord extends SourceAgentRef {
  displayName: string;
  discoveryState: SourceAgentDiscoveryState;
}

export interface SourceContextRecord extends SourceContextRef {
  /** Normalized context kind used by Exawatt without discarding nativeKind. */
  kind: SourceContextKind;
  /** The source's own kind label, retained for diagnostics and re-projection. */
  nativeKind: string;
  /** Full source-qualified lineage; null means the source declared no parent. */
  parent: SourceContextRef | null;
  roles: readonly SourceContextRole[];
  /** Optional stable source run identity for reconnect reconciliation. */
  nativeRunId: string | null;
  /**
   * Whether the source reported a run in flight in this context at
   * `AgentSourceTopologySnapshot.observedAt`.
   *
   * Three states on purpose: `true` is running, `false` is the source saying
   * it is not, and absent is the source saying nothing at all. Absent is
   * unknown, never "not running" and never "stopped" — a surface may only
   * claim work it was actually told about. This is a work fact observed at a
   * moment; how current that moment is belongs to the connection, not here.
   */
  hasActiveRun?: boolean;
  createdAt?: number;
  lastActiveAt?: number;
}

export interface AgentSourceTopologySnapshot {
  configuredSourceId: string;
  adapterId: AgentSourceAdapterId;
  placement: AgentSourcePlacement;
  /** Safe Gateway identity only; never an endpoint or connection secret. */
  gatewayId: string;
  observedAt: number;
  evidenceBasis: AgentSourceEvidenceBasis;
  agents: readonly SourceAgentRecord[];
  contexts: readonly SourceContextRecord[];
}

export interface AgentProjectionMapping extends SourceAgentRef {
  exawattAgentId: string;
  projectId: string;
  displayNameOverride: string | null;
}

export interface AgentProjectionPlanV1 {
  projectionVersion: typeof AGENT_PROJECTION_VERSION;
  mappings: readonly AgentProjectionMapping[];
}

export interface ProjectedAgent extends SourceAgentRef {
  id: string;
  displayName: string;
  discoveryState: SourceAgentDiscoveryState;
  projectId: string;
  adapterId: AgentSourceAdapterId;
  placement: AgentSourcePlacement;
  gatewayId: string;
  evidenceBasis: AgentSourceEvidenceBasis;
  projectionVersion: typeof AGENT_PROJECTION_VERSION;
  primaryConversation: SourceContextRecord | null;
  /**
   * True when any of this Agent's contexts has a run in flight.
   *
   * A derived boolean rather than a list of the running contexts: `contexts`
   * already carries every record, each with its own `hasActiveRun`, so a work
   * stack filters what it needs without the kernel shipping the same records
   * twice under a second name. What the kernel owes its callers here is the
   * product rule stated exactly once — an Agent is working when any context of
   * its is — so that no surface re-invents it and none can drift.
   *
   * False therefore covers both "no context is running" and "the source said
   * nothing about any of them". Neither is a claim that work stopped.
   */
  hasActiveRun: boolean;
  contexts: readonly SourceContextRecord[];
}

export interface AgentProjectionV1 {
  projectionVersion: typeof AGENT_PROJECTION_VERSION;
  agents: readonly ProjectedAgent[];
  /** Source Agents intentionally not mapped into the coworker roster. */
  unprojectedAgents: readonly SourceAgentRecord[];
}

export type AgentProjectionIssueSeverity = 'warning' | 'error';

export type AgentProjectionIssueCode =
  | 'unsupported-projection-version'
  | 'invalid-source'
  | 'duplicate-source'
  | 'invalid-agent'
  | 'duplicate-agent'
  | 'invalid-context'
  | 'duplicate-context'
  | 'orphan-context-agent'
  | 'cross-source-parent'
  | 'cross-agent-parent'
  | 'orphan-parent-context'
  | 'cyclic-context-lineage'
  | 'multiple-primary-conversations'
  | 'primary-conversation-missing'
  | 'invalid-mapping'
  | 'duplicate-mapping'
  | 'duplicate-exawatt-agent'
  | 'missing-mapped-agent';

export interface AgentProjectionIssue {
  severity: AgentProjectionIssueSeverity;
  code: AgentProjectionIssueCode;
  /** Stable structural location; never contains a serialized source record. */
  path: string;
  message: string;
}

export type AgentProjectionResult =
  | {
      ok: true;
      projection: AgentProjectionV1;
      /** Non-fatal projection warnings, deterministically ordered. */
      issues: readonly AgentProjectionIssue[];
    }
  | {
      ok: false;
      issues: readonly AgentProjectionIssue[];
    };

const MAX_ID_LENGTH = 4096;
const MAX_LABEL_LENGTH = 512;

/** Collision-safe, deterministic key for one source-native Agent. */
export function sourceAgentKey(ref: SourceAgentRef): string {
  return `source-agent:v1:${JSON.stringify([
    ref.configuredSourceId,
    ref.nativeAgentId,
  ])}`;
}

/** Collision-safe, deterministic key for one source-native context. */
export function sourceContextKey(ref: SourceContextRef): string {
  return `source-context:v1:${JSON.stringify([
    ref.configuredSourceId,
    ref.nativeAgentId,
    ref.nativeContextId,
  ])}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validText(value: unknown, maxLength = MAX_ID_LENGTH): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    !value.includes('\0')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validContextRef(value: unknown): value is SourceContextRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ref = value as Partial<SourceContextRef>;
  return (
    validText(ref.configuredSourceId) &&
    validText(ref.nativeAgentId) &&
    validText(ref.nativeContextId)
  );
}

function issue(
  severity: AgentProjectionIssueSeverity,
  code: AgentProjectionIssueCode,
  path: string,
  message: string
): AgentProjectionIssue {
  return { severity, code, path, message };
}

function sortedIssues(
  issues: readonly AgentProjectionIssue[]
): AgentProjectionIssue[] {
  return [...issues].sort(
    (left, right) =>
      compareText(left.severity, right.severity) ||
      compareText(left.code, right.code) ||
      compareText(left.path, right.path) ||
      compareText(left.message, right.message)
  );
}

function copyAgent(agent: SourceAgentRecord): SourceAgentRecord {
  return {
    configuredSourceId: agent.configuredSourceId,
    nativeAgentId: agent.nativeAgentId,
    displayName: agent.displayName,
    discoveryState: agent.discoveryState,
  };
}

function copyContextRef(ref: SourceContextRef): SourceContextRef {
  return {
    configuredSourceId: ref.configuredSourceId,
    nativeAgentId: ref.nativeAgentId,
    nativeContextId: ref.nativeContextId,
  };
}

function copyContext(context: SourceContextRecord): SourceContextRecord {
  return {
    configuredSourceId: context.configuredSourceId,
    nativeAgentId: context.nativeAgentId,
    nativeContextId: context.nativeContextId,
    kind: context.kind,
    nativeKind: context.nativeKind,
    parent: context.parent ? copyContextRef(context.parent) : null,
    roles: [...context.roles],
    nativeRunId: context.nativeRunId,
    ...(context.hasActiveRun === undefined
      ? {}
      : { hasActiveRun: context.hasActiveRun }),
    ...(context.createdAt === undefined
      ? {}
      : { createdAt: context.createdAt }),
    ...(context.lastActiveAt === undefined
      ? {}
      : { lastActiveAt: context.lastActiveAt }),
  };
}

function copyMapping(mapping: AgentProjectionMapping): AgentProjectionMapping {
  return {
    configuredSourceId: mapping.configuredSourceId,
    nativeAgentId: mapping.nativeAgentId,
    exawattAgentId: mapping.exawattAgentId,
    projectId: mapping.projectId,
    displayNameOverride: mapping.displayNameOverride,
  };
}

/**
 * Find cycles in the valid same-source, same-Agent parent graph. Each context
 * has at most one parent, so an iterative walk remains safe for deep lineage.
 */
function contextLineageCycles(
  contexts: ReadonlyMap<string, SourceContextRecord>
): string[][] {
  const processed = new Set<string>();
  const cycles: string[][] = [];
  const keys = [...contexts.keys()].sort(compareText);

  for (const startKey of keys) {
    if (processed.has(startKey)) continue;

    const path: string[] = [];
    const positionByKey = new Map<string, number>();
    let currentKey: string | null = startKey;

    while (
      currentKey !== null &&
      !processed.has(currentKey) &&
      !positionByKey.has(currentKey)
    ) {
      positionByKey.set(currentKey, path.length);
      path.push(currentKey);

      const current = contexts.get(currentKey);
      const parent = current?.parent;
      if (
        !current ||
        !parent ||
        parent.configuredSourceId !== current.configuredSourceId ||
        parent.nativeAgentId !== current.nativeAgentId
      ) {
        currentKey = null;
        break;
      }

      const parentKey = sourceContextKey(parent);
      currentKey = contexts.has(parentKey) ? parentKey : null;
    }

    if (currentKey !== null) {
      const cycleStart = positionByKey.get(currentKey);
      if (cycleStart !== undefined) {
        cycles.push(path.slice(cycleStart).sort(compareText));
      }
    }

    for (const key of path) processed.add(key);
  }

  return cycles.sort((left, right) => compareText(left[0]!, right[0]!));
}

/**
 * Validate and apply an explicit source-Agent to Exawatt-Agent projection.
 * Structural errors fail closed. A missing primary conversation is valid but
 * remains explicit as `null` plus a warning; Exawatt never guesses by recency.
 */
export function projectAgentTopology(
  snapshots: readonly AgentSourceTopologySnapshot[],
  plan: {
    readonly projectionVersion: number;
    readonly mappings: readonly AgentProjectionMapping[];
  }
): AgentProjectionResult {
  const issues: AgentProjectionIssue[] = [];
  const planRecord = isRecord(plan) ? plan : null;
  const projectionVersion = planRecord?.projectionVersion;

  if (projectionVersion !== AGENT_PROJECTION_VERSION) {
    issues.push(
      issue(
        'error',
        'unsupported-projection-version',
        'plan.projectionVersion',
        `Agent projection version must be ${AGENT_PROJECTION_VERSION}.`
      )
    );
  }

  const sourceIds = new Set<string>();
  const sourceById = new Map<string, AgentSourceTopologySnapshot>();
  const agentByKey = new Map<string, SourceAgentRecord>();
  const contextByKey = new Map<string, SourceContextRecord>();

  const snapshotValues: readonly unknown[] = Array.isArray(snapshots)
    ? snapshots
    : [];
  if (!Array.isArray(snapshots)) {
    issues.push(
      issue(
        'error',
        'invalid-source',
        'sources',
        'Agent source snapshots must be an array.'
      )
    );
  }
  for (const [index, candidateSnapshot] of snapshotValues.entries()) {
    if (!isRecord(candidateSnapshot)) {
      issues.push(
        issue(
          'error',
          'invalid-source',
          `sources.${index}`,
          'Agent source snapshot must be a record.'
        )
      );
      continue;
    }
    const sourcePath = validText(candidateSnapshot.configuredSourceId)
      ? `sources.${candidateSnapshot.configuredSourceId}`
      : `sources.${index}`;
    const sourceValid =
      validText(candidateSnapshot.configuredSourceId) &&
      typeof candidateSnapshot.adapterId === 'string' &&
      AGENT_SOURCE_ADAPTER_ID_SET.has(candidateSnapshot.adapterId) &&
      typeof candidateSnapshot.placement === 'string' &&
      AGENT_SOURCE_PLACEMENT_SET.has(candidateSnapshot.placement) &&
      validText(candidateSnapshot.gatewayId) &&
      typeof candidateSnapshot.evidenceBasis === 'string' &&
      AGENT_SOURCE_EVIDENCE_BASIS_SET.has(candidateSnapshot.evidenceBasis) &&
      validTimestamp(candidateSnapshot.observedAt) &&
      Array.isArray(candidateSnapshot.agents) &&
      Array.isArray(candidateSnapshot.contexts);
    if (!sourceValid) {
      issues.push(
        issue(
          'error',
          'invalid-source',
          sourcePath,
          'Configured source identity, placement, Gateway, or evidence is invalid.'
        )
      );
      continue;
    }
    const snapshot =
      candidateSnapshot as unknown as AgentSourceTopologySnapshot;
    if (sourceIds.has(snapshot.configuredSourceId)) {
      issues.push(
        issue(
          'error',
          'duplicate-source',
          sourcePath,
          'Configured source identity appears more than once.'
        )
      );
      continue;
    } else {
      sourceIds.add(snapshot.configuredSourceId);
      sourceById.set(snapshot.configuredSourceId, snapshot);
    }

    const sourceAgents: readonly unknown[] = snapshot.agents;
    const sourceContexts: readonly unknown[] = snapshot.contexts;

    for (const [index, candidateAgent] of sourceAgents.entries()) {
      if (!isRecord(candidateAgent)) {
        issues.push(
          issue(
            'error',
            'invalid-agent',
            `${sourcePath}.agents.${index}`,
            'Source Agent must be a record.'
          )
        );
        continue;
      }
      const agentValid =
        candidateAgent.configuredSourceId === snapshot.configuredSourceId &&
        validText(candidateAgent.nativeAgentId) &&
        validText(candidateAgent.displayName, MAX_LABEL_LENGTH) &&
        typeof candidateAgent.discoveryState === 'string' &&
        SOURCE_AGENT_DISCOVERY_STATE_SET.has(candidateAgent.discoveryState);
      if (!agentValid) {
        issues.push(
          issue(
            'error',
            'invalid-agent',
            `${sourcePath}.agents.${index}`,
            'Source Agent identity, name, or discovery state is invalid.'
          )
        );
        continue;
      }
      const agent = candidateAgent as unknown as SourceAgentRecord;
      const key = sourceAgentKey(agent);
      const agentPath = `agents.${key}`;
      if (agentByKey.has(key)) {
        issues.push(
          issue(
            'error',
            'duplicate-agent',
            agentPath,
            'Source-qualified Agent identity appears more than once.'
          )
        );
      } else {
        agentByKey.set(key, copyAgent(agent));
      }
    }

    for (const [index, candidateContext] of sourceContexts.entries()) {
      if (!isRecord(candidateContext)) {
        issues.push(
          issue(
            'error',
            'invalid-context',
            `${sourcePath}.contexts.${index}`,
            'Source context must be a record.'
          )
        );
        continue;
      }
      const roles: readonly unknown[] = Array.isArray(candidateContext.roles)
        ? candidateContext.roles
        : [];
      const uniqueRoles = new Set(roles);
      const parentValid =
        candidateContext.parent === null ||
        validContextRef(candidateContext.parent);
      const contextValid =
        candidateContext.configuredSourceId === snapshot.configuredSourceId &&
        validText(candidateContext.nativeAgentId) &&
        validText(candidateContext.nativeContextId) &&
        typeof candidateContext.kind === 'string' &&
        SOURCE_CONTEXT_KIND_SET.has(candidateContext.kind) &&
        validText(candidateContext.nativeKind, MAX_LABEL_LENGTH) &&
        Array.isArray(candidateContext.roles) &&
        uniqueRoles.size === roles.length &&
        roles.every(
          role => typeof role === 'string' && SOURCE_CONTEXT_ROLE_SET.has(role)
        ) &&
        parentValid &&
        (candidateContext.nativeRunId === null ||
          validText(candidateContext.nativeRunId)) &&
        // Absent is unknown and allowed; anything present must be a boolean,
        // so a truthy string can never be read as a run in flight.
        (candidateContext.hasActiveRun === undefined ||
          typeof candidateContext.hasActiveRun === 'boolean') &&
        (candidateContext.createdAt === undefined ||
          validTimestamp(candidateContext.createdAt)) &&
        (candidateContext.lastActiveAt === undefined ||
          validTimestamp(candidateContext.lastActiveAt));
      if (!contextValid) {
        issues.push(
          issue(
            'error',
            'invalid-context',
            `${sourcePath}.contexts.${index}`,
            'Source context identity, kind, roles, or timestamps are invalid.'
          )
        );
        continue;
      }
      const context = candidateContext as unknown as SourceContextRecord;
      const key = sourceContextKey(context);
      const contextPath = `contexts.${key}`;
      if (contextByKey.has(key)) {
        issues.push(
          issue(
            'error',
            'duplicate-context',
            contextPath,
            'Source-qualified context identity appears more than once.'
          )
        );
      } else {
        contextByKey.set(key, copyContext(context));
      }
    }
  }

  for (const [key, context] of contextByKey) {
    const contextPath = `contexts.${key}`;
    if (!agentByKey.has(sourceAgentKey(context))) {
      issues.push(
        issue(
          'error',
          'orphan-context-agent',
          contextPath,
          'Context refers to a source Agent that is absent from the snapshot.'
        )
      );
    }
    if (context.parent) {
      if (context.parent.configuredSourceId !== context.configuredSourceId) {
        issues.push(
          issue(
            'error',
            'cross-source-parent',
            `${contextPath}.parent`,
            'Context lineage cannot cross a configured source boundary.'
          )
        );
      } else if (context.parent.nativeAgentId !== context.nativeAgentId) {
        issues.push(
          issue(
            'error',
            'cross-agent-parent',
            `${contextPath}.parent`,
            'Context lineage cannot cross a source Agent boundary.'
          )
        );
      } else if (!contextByKey.has(sourceContextKey(context.parent))) {
        issues.push(
          issue(
            'error',
            'orphan-parent-context',
            `${contextPath}.parent`,
            'Context parent is absent from the source snapshot.'
          )
        );
      }
    }
  }

  for (const cycle of contextLineageCycles(contextByKey)) {
    const representativeKey = cycle[0]!;
    issues.push(
      issue(
        'error',
        'cyclic-context-lineage',
        `contexts.${representativeKey}.parent`,
        cycle.length === 1
          ? 'Context lineage cannot make a context its own parent.'
          : `Context lineage contains a cycle across ${cycle.length} contexts.`
      )
    );
  }

  const mappingByAgentKey = new Map<string, AgentProjectionMapping>();
  const exawattAgentIds = new Set<string>();
  const mappingValues: readonly unknown[] =
    planRecord && Array.isArray(planRecord.mappings) ? planRecord.mappings : [];
  if (!planRecord || !Array.isArray(planRecord.mappings)) {
    issues.push(
      issue(
        'error',
        'invalid-mapping',
        'plan.mappings',
        'Agent projection mappings must be an array.'
      )
    );
  }
  for (const [index, candidateMapping] of mappingValues.entries()) {
    if (!isRecord(candidateMapping)) {
      issues.push(
        issue(
          'error',
          'invalid-mapping',
          `plan.mappings.${index}`,
          'Agent projection mapping must be a record.'
        )
      );
      continue;
    }
    const mappingValid =
      validText(candidateMapping.configuredSourceId) &&
      validText(candidateMapping.nativeAgentId) &&
      validText(candidateMapping.exawattAgentId) &&
      validText(candidateMapping.projectId) &&
      (candidateMapping.displayNameOverride === null ||
        validText(candidateMapping.displayNameOverride, MAX_LABEL_LENGTH));
    if (!mappingValid) {
      issues.push(
        issue(
          'error',
          'invalid-mapping',
          `plan.mappings.${index}`,
          'Agent projection identity, Project, or display-name override is invalid.'
        )
      );
      continue;
    }
    const mapping = candidateMapping as unknown as AgentProjectionMapping;
    const key = sourceAgentKey(mapping);
    const mappingPath = `mappings.${key}`;
    if (mappingByAgentKey.has(key)) {
      issues.push(
        issue(
          'error',
          'duplicate-mapping',
          mappingPath,
          'Source-qualified Agent has more than one projection mapping.'
        )
      );
    } else {
      mappingByAgentKey.set(key, copyMapping(mapping));
    }
    if (exawattAgentIds.has(mapping.exawattAgentId)) {
      issues.push(
        issue(
          'error',
          'duplicate-exawatt-agent',
          `mappings.exawatt.${mapping.exawattAgentId}`,
          'Exawatt Agent identity is assigned to more than one source Agent.'
        )
      );
    } else {
      exawattAgentIds.add(mapping.exawattAgentId);
    }
    if (!agentByKey.has(key)) {
      issues.push(
        issue(
          'error',
          'missing-mapped-agent',
          mappingPath,
          'Projection mapping refers to a source Agent absent from the snapshots.'
        )
      );
    }
  }

  const contextsByAgent = new Map<string, SourceContextRecord[]>();
  for (const context of contextByKey.values()) {
    const key = sourceAgentKey(context);
    const contexts = contextsByAgent.get(key) ?? [];
    contexts.push(copyContext(context));
    contextsByAgent.set(key, contexts);
  }
  for (const contexts of contextsByAgent.values()) {
    contexts.sort((left, right) =>
      compareText(sourceContextKey(left), sourceContextKey(right))
    );
  }
  for (const [key, contexts] of contextsByAgent) {
    const primaryContextCount = contexts.filter(context =>
      context.roles.includes('primary-conversation')
    ).length;
    if (primaryContextCount > 1) {
      issues.push(
        issue(
          'error',
          'multiple-primary-conversations',
          `agents.${key}.primaryConversation`,
          'Source Agent declares more than one primary conversation.'
        )
      );
    }
  }

  const projectedAgents: ProjectedAgent[] = [];
  for (const [key, mapping] of [...mappingByAgentKey.entries()].sort(
    ([left], [right]) => compareText(left, right)
  )) {
    const sourceAgent = agentByKey.get(key);
    const source = sourceById.get(mapping.configuredSourceId);
    if (!sourceAgent || !source) continue;
    const contexts = contextsByAgent.get(key) ?? [];
    const primaryContexts = contexts.filter(context =>
      context.roles.includes('primary-conversation')
    );
    if (primaryContexts.length === 0) {
      issues.push(
        issue(
          'warning',
          'primary-conversation-missing',
          `agents.${key}.primaryConversation`,
          'Source Agent declares no primary conversation; Agent summary must open instead.'
        )
      );
    }
    projectedAgents.push({
      id: mapping.exawattAgentId,
      configuredSourceId: mapping.configuredSourceId,
      nativeAgentId: mapping.nativeAgentId,
      displayName:
        mapping.displayNameOverride?.trim() || sourceAgent.displayName,
      discoveryState: sourceAgent.discoveryState,
      projectId: mapping.projectId,
      adapterId: source.adapterId,
      placement: source.placement,
      gatewayId: source.gatewayId,
      evidenceBasis: source.evidenceBasis,
      projectionVersion: AGENT_PROJECTION_VERSION,
      primaryConversation:
        primaryContexts.length === 1 ? copyContext(primaryContexts[0]!) : null,
      hasActiveRun: contexts.some(context => context.hasActiveRun === true),
      contexts: contexts.map(copyContext),
    });
  }

  const finalIssues = sortedIssues(issues);
  if (finalIssues.some(candidate => candidate.severity === 'error')) {
    return { ok: false, issues: finalIssues };
  }

  projectedAgents.sort((left, right) => compareText(left.id, right.id));
  const unprojectedAgents = [...agentByKey.entries()]
    .filter(([key]) => !mappingByAgentKey.has(key))
    .sort(([left], [right]) => compareText(left, right))
    .map(([, agent]) => copyAgent(agent));

  return {
    ok: true,
    projection: {
      projectionVersion: AGENT_PROJECTION_VERSION,
      agents: projectedAgents,
      unprojectedAgents,
    },
    issues: finalIssues,
  };
}
