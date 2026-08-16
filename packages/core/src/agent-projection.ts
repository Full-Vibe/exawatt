import type {
  AgentSourceAdapterId,
  AgentSourceEvidenceBasis,
} from './agent-sources';

/**
 * Source-neutral Agent projection (ENG-010 C0).
 *
 * Source topology remains intact and source-qualified. The projection only
 * decides which source Agents become Exawatt coworkers and where they appear;
 * it never rewrites a source record or promotes a context into a coworker.
 */

export const AGENT_PROJECTION_VERSION = 1 as const;

export type AgentSourcePlacement =
  | 'local'
  | 'customer-hosted'
  | 'exawatt-hosted';

export type SourceAgentDiscoveryState = 'configured' | 'retired' | 'unknown';

export type SourceContextKind =
  | 'main'
  | 'channel'
  | 'cron'
  | 'helper'
  | 'spawned'
  | 'other';

export type SourceContextRole = 'primary-conversation';

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
const SOURCE_AGENT_DISCOVERY_STATES = new Set<SourceAgentDiscoveryState>([
  'configured',
  'retired',
  'unknown',
]);
const SOURCE_CONTEXT_KINDS = new Set<SourceContextKind>([
  'main',
  'channel',
  'cron',
  'helper',
  'spawned',
  'other',
]);
const SOURCE_CONTEXT_ROLES = new Set<SourceContextRole>([
  'primary-conversation',
]);
const EVIDENCE_BASES = new Set<AgentSourceEvidenceBasis>([
  'observed',
  'declared',
  'simulated',
]);
const AGENT_SOURCE_ADAPTER_IDS = new Set<AgentSourceAdapterId>([
  'claude',
  'codex',
  'opencode',
  'grok',
  'openclaw',
  'demo',
]);
const PLACEMENTS = new Set<AgentSourcePlacement>([
  'local',
  'customer-hosted',
  'exawatt-hosted',
]);

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
  return { ...agent };
}

function copyContext(context: SourceContextRecord): SourceContextRecord {
  return {
    ...context,
    parent: context.parent ? { ...context.parent } : null,
    roles: [...context.roles],
  };
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
        `Unsupported Agent projection version: ${String(projectionVersion)}`
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
  const orderedSnapshots = snapshotValues
    .map((snapshot, index) => ({ snapshot, index }))
    .sort((left, right) => {
      const leftId = isRecord(left.snapshot)
        ? String(left.snapshot.configuredSourceId ?? '')
        : '';
      const rightId = isRecord(right.snapshot)
        ? String(right.snapshot.configuredSourceId ?? '')
        : '';
      return compareText(leftId, rightId) || left.index - right.index;
    });

  for (const { snapshot: candidateSnapshot, index } of orderedSnapshots) {
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
    const snapshot =
      candidateSnapshot as unknown as AgentSourceTopologySnapshot;
    const sourcePath = validText(snapshot.configuredSourceId)
      ? `sources.${snapshot.configuredSourceId}`
      : `sources.${index}`;
    const sourceValid =
      validText(snapshot.configuredSourceId) &&
      AGENT_SOURCE_ADAPTER_IDS.has(snapshot.adapterId) &&
      PLACEMENTS.has(snapshot.placement) &&
      validText(snapshot.gatewayId) &&
      EVIDENCE_BASES.has(snapshot.evidenceBasis) &&
      validTimestamp(snapshot.observedAt) &&
      Array.isArray(snapshot.agents) &&
      Array.isArray(snapshot.contexts);
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

    const sourceAgents = Array.isArray(snapshot.agents) ? snapshot.agents : [];
    const sourceContexts = Array.isArray(snapshot.contexts)
      ? snapshot.contexts
      : [];

    const orderedAgents = sourceAgents
      .map((agent, index) => ({ agent, index }))
      .sort((left, right) => {
        const leftKey = isRecord(left.agent)
          ? `${String(left.agent.configuredSourceId ?? '')}\0${String(left.agent.nativeAgentId ?? '')}`
          : '';
        const rightKey = isRecord(right.agent)
          ? `${String(right.agent.configuredSourceId ?? '')}\0${String(right.agent.nativeAgentId ?? '')}`
          : '';
        return compareText(leftKey, rightKey) || left.index - right.index;
      });
    for (const { agent: candidateAgent, index } of orderedAgents) {
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
      const agent = candidateAgent as unknown as SourceAgentRecord;
      const agentValid =
        agent.configuredSourceId === snapshot.configuredSourceId &&
        validText(agent.nativeAgentId) &&
        validText(agent.displayName, MAX_LABEL_LENGTH) &&
        SOURCE_AGENT_DISCOVERY_STATES.has(agent.discoveryState);
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

    const orderedContexts = sourceContexts
      .map((context, index) => ({ context, index }))
      .sort((left, right) => {
        const leftKey = isRecord(left.context)
          ? `${String(left.context.configuredSourceId ?? '')}\0${String(left.context.nativeAgentId ?? '')}\0${String(left.context.nativeContextId ?? '')}`
          : '';
        const rightKey = isRecord(right.context)
          ? `${String(right.context.configuredSourceId ?? '')}\0${String(right.context.nativeAgentId ?? '')}\0${String(right.context.nativeContextId ?? '')}`
          : '';
        return compareText(leftKey, rightKey) || left.index - right.index;
      });
    for (const { context: candidateContext, index } of orderedContexts) {
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
      const context = candidateContext as unknown as SourceContextRecord;
      const key = sourceContextKey(context);
      const contextPath = `contexts.${key}`;
      const roles: readonly unknown[] = Array.isArray(context.roles)
        ? context.roles
        : [];
      const uniqueRoles = new Set(roles);
      const parentValid =
        context.parent === null || validContextRef(context.parent);
      const contextValid =
        context.configuredSourceId === snapshot.configuredSourceId &&
        validText(context.nativeAgentId) &&
        validText(context.nativeContextId) &&
        SOURCE_CONTEXT_KINDS.has(context.kind) &&
        validText(context.nativeKind, MAX_LABEL_LENGTH) &&
        Array.isArray(context.roles) &&
        uniqueRoles.size === roles.length &&
        roles.every(
          role =>
            typeof role === 'string' &&
            SOURCE_CONTEXT_ROLES.has(role as SourceContextRole)
        ) &&
        parentValid &&
        (context.nativeRunId === null || validText(context.nativeRunId)) &&
        (context.createdAt === undefined ||
          validTimestamp(context.createdAt)) &&
        (context.lastActiveAt === undefined ||
          validTimestamp(context.lastActiveAt));
      if (!contextValid) {
        issues.push(
          issue(
            'error',
            'invalid-context',
            contextPath,
            'Source context identity, kind, roles, or timestamps are invalid.'
          )
        );
        continue;
      }
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
  const orderedMappings = mappingValues
    .map((mapping, index) => ({ mapping, index }))
    .sort((left, right) => {
      const leftKey = isRecord(left.mapping)
        ? `${String(left.mapping.configuredSourceId ?? '')}\0${String(left.mapping.nativeAgentId ?? '')}\0${String(left.mapping.exawattAgentId ?? '')}`
        : '';
      const rightKey = isRecord(right.mapping)
        ? `${String(right.mapping.configuredSourceId ?? '')}\0${String(right.mapping.nativeAgentId ?? '')}\0${String(right.mapping.exawattAgentId ?? '')}`
        : '';
      return compareText(leftKey, rightKey) || left.index - right.index;
    });

  for (const { mapping: candidateMapping, index } of orderedMappings) {
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
    const mapping = candidateMapping as unknown as AgentProjectionMapping;
    const mappingValid =
      validText(mapping.configuredSourceId) &&
      validText(mapping.nativeAgentId) &&
      validText(mapping.exawattAgentId) &&
      validText(mapping.projectId) &&
      (mapping.displayNameOverride === null ||
        validText(mapping.displayNameOverride, MAX_LABEL_LENGTH));
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
      mappingByAgentKey.set(key, { ...mapping });
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
    if (primaryContexts.length > 1) {
      issues.push(
        issue(
          'error',
          'multiple-primary-conversations',
          `agents.${key}.primaryConversation`,
          'Source Agent declares more than one primary conversation.'
        )
      );
    } else if (primaryContexts.length === 0) {
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
