/**
 * Renderer-safe Launch Configuration domain.
 *
 * A configuration's identity is deliberately narrower than a launch request:
 * permissions, worktrees, branches, prompts, and roadmap links do not belong
 * here. Shell is a peer launch target, but never an Agent configuration.
 */

export const LAUNCH_CONFIGURATION_SCHEMA_VERSION = 1 as const;
export const SHELL_LAUNCH_TARGET_ID = 'shell' as const;
export const SHELL_LAUNCH_TARGET = Object.freeze({
  kind: 'shell' as const,
  id: SHELL_LAUNCH_TARGET_ID,
  fingerprint: 'launch-target:shell:v1',
});

const MAX_IDENTITY_PART_LENGTH = 512;
const MAX_LABEL_LENGTH = 160;
const MAX_NAME_LENGTH = 80;
const MAX_PROJECT_KEY_LENGTH = 4096;
const FRECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

export interface AgentLaunchConfigurationInput {
  kind?: 'agent';
  sourceId: string;
  modelId: string;
  /** Omitted/null means the source-owned default, not an empty effort id. */
  effort?: string | null;
  /** Optional portable Agent Type identity. A friendly name is not a Type. */
  typeId?: string | null;
  labels?: AgentLaunchConfigurationLabels;
}

export interface AgentLaunchConfigurationLabels {
  source?: string;
  model?: string;
  effort?: string;
  type?: string;
}

export interface AgentLaunchConfiguration {
  kind: 'agent';
  id: string;
  fingerprint: string;
  sourceId: string;
  modelId: string;
  effort: string | null;
  typeId: string | null;
  /** Source-observed presentation snapshots; never part of identity. */
  labels: AgentLaunchConfigurationLabels;
  /** Friendly preset label; never part of identity and never a Type. */
  name: string | null;
  createdAt: number;
}

export type LaunchTarget =
  | AgentLaunchConfiguration
  | typeof SHELL_LAUNCH_TARGET;
export type LaunchTargetId =
  | AgentLaunchConfiguration['id']
  | typeof SHELL_LAUNCH_TARGET_ID;

export interface LaunchTargetUsage {
  launchCount: number;
  lastLaunchedAt: number;
}

export interface ProjectLaunchConfigurationState {
  usage: Record<string, LaunchTargetUsage>;
  /** Array order is the operator's explicit pin order. */
  pins: string[];
}

export interface LaunchConfigurationPoolV1 {
  schemaVersion: typeof LAUNCH_CONFIGURATION_SCHEMA_VERSION;
  configurations: AgentLaunchConfiguration[];
  projects: Record<string, ProjectLaunchConfigurationState>;
}

export interface LegacyAgentSourceMemory {
  projectLastUsed: Record<string, string>;
  sourceRecency: Record<string, number>;
}

function boundedNonEmptyString(
  value: unknown,
  maxLength: number
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized &&
    normalized.length <= maxLength &&
    !normalized.includes('\0')
    ? normalized
    : null;
}

function optionalIdentityPart(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return boundedNonEmptyString(value, MAX_IDENTITY_PART_LENGTH) ?? undefined;
}

function finiteTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function parseLabels(value: unknown): AgentLaunchConfigurationLabels {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const labels: AgentLaunchConfigurationLabels = {};
  for (const key of ['source', 'model', 'effort', 'type'] as const) {
    const label = boundedNonEmptyString(raw[key], MAX_LABEL_LENGTH);
    if (label) labels[key] = label;
  }
  return labels;
}

function normalizeLabels(
  labels: AgentLaunchConfigurationLabels | undefined
): AgentLaunchConfigurationLabels {
  return parseLabels(labels);
}

export function launchConfigurationFingerprint(
  input: AgentLaunchConfigurationInput
): string {
  if (
    !input ||
    typeof input !== 'object' ||
    (input.kind !== undefined && input.kind !== 'agent')
  ) {
    throw new Error('Invalid Launch Configuration identity');
  }
  const sourceId = boundedNonEmptyString(
    input.sourceId,
    MAX_IDENTITY_PART_LENGTH
  );
  const modelId = boundedNonEmptyString(
    input.modelId,
    MAX_IDENTITY_PART_LENGTH
  );
  const effort = optionalIdentityPart(input.effort);
  const typeId = optionalIdentityPart(input.typeId);
  if (!sourceId || !modelId || effort === undefined || typeId === undefined) {
    throw new Error('Invalid Launch Configuration identity');
  }
  // A fixed-position tuple avoids object-key-order and delimiter ambiguity.
  return `launch-configuration:v1:${JSON.stringify([
    sourceId,
    modelId,
    effort,
    typeId,
  ])}`;
}

export function launchConfigurationId(
  input: AgentLaunchConfigurationInput
): string {
  // The complete canonical fingerprint makes the id deterministic and
  // collision-free without depending on Node-only hashing in renderer code.
  return `agent:${encodeURIComponent(launchConfigurationFingerprint(input))}`;
}

export function createAgentLaunchConfiguration(
  input: AgentLaunchConfigurationInput,
  createdAt = Date.now(),
  name: string | null = null
): AgentLaunchConfiguration {
  const fingerprint = launchConfigurationFingerprint(input);
  const normalizedCreatedAt = finiteTimestamp(createdAt);
  if (normalizedCreatedAt === null)
    throw new Error('Invalid configuration timestamp');
  const normalizedName =
    name === null ? null : normalizeConfigurationName(name);
  return {
    kind: 'agent',
    id: `agent:${encodeURIComponent(fingerprint)}`,
    fingerprint,
    sourceId: input.sourceId.trim(),
    modelId: input.modelId.trim(),
    effort: input.effort?.trim() || null,
    typeId: input.typeId?.trim() || null,
    labels: normalizeLabels(input.labels),
    name: normalizedName,
    createdAt: normalizedCreatedAt,
  };
}

export function normalizeConfigurationName(value: unknown): string {
  const name = boundedNonEmptyString(value, MAX_NAME_LENGTH);
  if (!name) throw new Error('Invalid Launch Configuration name');
  return name;
}

export function emptyLaunchConfigurationPool(): LaunchConfigurationPoolV1 {
  return {
    schemaVersion: LAUNCH_CONFIGURATION_SCHEMA_VERSION,
    configurations: [],
    projects: {},
  };
}

function clonePool(pool: LaunchConfigurationPoolV1): LaunchConfigurationPoolV1 {
  return {
    schemaVersion: LAUNCH_CONFIGURATION_SCHEMA_VERSION,
    configurations: pool.configurations.map(configuration => ({
      ...configuration,
      labels: { ...configuration.labels },
    })),
    projects: Object.fromEntries(
      Object.entries(pool.projects).map(([project, state]) => [
        project,
        {
          usage: Object.fromEntries(
            Object.entries(state.usage).map(([id, usage]) => [id, { ...usage }])
          ),
          pins: [...state.pins],
        },
      ])
    ),
  };
}

function validProjectKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_PROJECT_KEY_LENGTH &&
    !value.includes('\0')
  );
}

function targetExists(pool: LaunchConfigurationPoolV1, id: string): boolean {
  return (
    id === SHELL_LAUNCH_TARGET_ID ||
    pool.configurations.some(configuration => configuration.id === id)
  );
}

function projectState(
  pool: LaunchConfigurationPoolV1,
  project: string
): ProjectLaunchConfigurationState {
  return pool.projects[project] ?? { usage: {}, pins: [] };
}

function upsertConfiguration(
  pool: LaunchConfigurationPoolV1,
  input: AgentLaunchConfigurationInput,
  createdAt: number,
  name?: string
): AgentLaunchConfiguration {
  const candidate = createAgentLaunchConfiguration(
    input,
    createdAt,
    name ?? null
  );
  const existingIndex = pool.configurations.findIndex(
    configuration => configuration.fingerprint === candidate.fingerprint
  );
  if (existingIndex < 0) {
    pool.configurations.push(candidate);
    return candidate;
  }
  const existing = pool.configurations[existingIndex];
  const updated: AgentLaunchConfiguration = {
    ...existing,
    labels:
      Object.keys(candidate.labels).length > 0
        ? { ...existing.labels, ...candidate.labels }
        : existing.labels,
    name: name === undefined ? existing.name : candidate.name,
  };
  pool.configurations[existingIndex] = updated;
  return updated;
}

export function recordLaunchConfigurationSuccess(
  current: LaunchConfigurationPoolV1,
  project: string,
  target: AgentLaunchConfigurationInput | { kind: 'shell' },
  launchedAt: number
): LaunchConfigurationPoolV1 {
  if (!validProjectKey(project)) throw new Error('Invalid Project identity');
  const timestamp = finiteTimestamp(launchedAt);
  if (timestamp === null) throw new Error('Invalid launch timestamp');
  if (!target || typeof target !== 'object') {
    throw new Error('Invalid launch target');
  }
  const pool = clonePool(current);
  let id: string;
  if (target.kind === 'shell') {
    if (
      'sourceId' in target ||
      'modelId' in target ||
      'effort' in target ||
      'typeId' in target
    ) {
      throw new Error('Shell cannot carry Agent configuration axes');
    }
    id = SHELL_LAUNCH_TARGET_ID;
  } else {
    id = upsertConfiguration(pool, target, timestamp).id;
  }
  const state = projectState(pool, project);
  const previous = state.usage[id];
  state.usage[id] = {
    launchCount: (previous?.launchCount ?? 0) + 1,
    lastLaunchedAt: Math.max(previous?.lastLaunchedAt ?? 0, timestamp),
  };
  pool.projects[project] = state;
  return pool;
}

export function saveNamedLaunchConfiguration(
  current: LaunchConfigurationPoolV1,
  input: AgentLaunchConfigurationInput,
  name: string,
  savedAt = Date.now()
): LaunchConfigurationPoolV1 {
  const pool = clonePool(current);
  upsertConfiguration(pool, input, savedAt, normalizeConfigurationName(name));
  return pool;
}

export function renameLaunchConfiguration(
  current: LaunchConfigurationPoolV1,
  id: string,
  name: string
): LaunchConfigurationPoolV1 {
  const normalizedName = normalizeConfigurationName(name);
  if (id === SHELL_LAUNCH_TARGET_ID) throw new Error('Shell cannot be renamed');
  const pool = clonePool(current);
  const index = pool.configurations.findIndex(
    configuration => configuration.id === id
  );
  if (index < 0) throw new Error('Launch Configuration not found');
  pool.configurations[index] = {
    ...pool.configurations[index],
    name: normalizedName,
  };
  return pool;
}

export function deleteLaunchConfiguration(
  current: LaunchConfigurationPoolV1,
  id: string
): LaunchConfigurationPoolV1 {
  if (id === SHELL_LAUNCH_TARGET_ID) throw new Error('Shell cannot be deleted');
  const pool = clonePool(current);
  const nextConfigurations = pool.configurations.filter(
    configuration => configuration.id !== id
  );
  if (nextConfigurations.length === pool.configurations.length) {
    throw new Error('Launch Configuration not found');
  }
  pool.configurations = nextConfigurations;
  for (const state of Object.values(pool.projects)) {
    delete state.usage[id];
    state.pins = state.pins.filter(pin => pin !== id);
  }
  return pool;
}

export function setLaunchConfigurationPinned(
  current: LaunchConfigurationPoolV1,
  project: string,
  id: string,
  pinned: boolean
): LaunchConfigurationPoolV1 {
  if (!validProjectKey(project)) throw new Error('Invalid Project identity');
  if (typeof id !== 'string' || !targetExists(current, id)) {
    throw new Error('Launch target not found');
  }
  const pool = clonePool(current);
  const state = projectState(pool, project);
  const withoutTarget = state.pins.filter(pin => pin !== id);
  state.pins = pinned ? [...withoutTarget, id] : withoutTarget;
  pool.projects[project] = state;
  return pool;
}

export function launchTargetFrecencyScore(
  usage: LaunchTargetUsage | undefined,
  rankedAt: number
): number {
  if (!usage) return 0;
  const age = Math.max(0, rankedAt - usage.lastLaunchedAt);
  const recency = Math.exp((-Math.LN2 * age) / FRECENCY_HALF_LIFE_MS);
  return Math.log2(usage.launchCount + 1) + recency * 4;
}

export function rankLaunchTargets(
  pool: LaunchConfigurationPoolV1,
  project: string,
  rankedAt = Date.now()
): LaunchTarget[] {
  if (!validProjectKey(project)) throw new Error('Invalid Project identity');
  if (finiteTimestamp(rankedAt) === null)
    throw new Error('Invalid ranking timestamp');
  const targets: LaunchTarget[] = [...pool.configurations, SHELL_LAUNCH_TARGET];
  const state = projectState(pool, project);
  const pinIndex = new Map(state.pins.map((id, index) => [id, index]));
  return targets.sort((left, right) => {
    const leftPin = pinIndex.get(left.id);
    const rightPin = pinIndex.get(right.id);
    if (leftPin !== undefined || rightPin !== undefined) {
      if (leftPin === undefined) return 1;
      if (rightPin === undefined) return -1;
      return leftPin - rightPin;
    }
    const scoreDifference =
      launchTargetFrecencyScore(state.usage[right.id], rankedAt) -
      launchTargetFrecencyScore(state.usage[left.id], rankedAt);
    if (Math.abs(scoreDifference) > Number.EPSILON) return scoreDifference;
    const leftCreated = left.kind === 'agent' ? left.createdAt : 0;
    const rightCreated = right.kind === 'agent' ? right.createdAt : 0;
    if (leftCreated !== rightCreated) return leftCreated - rightCreated;
    return left.id.localeCompare(right.id);
  });
}

/**
 * Migrate old source-only memory once exact default configurations are known.
 * A source without a resolved model is intentionally skipped: migration must
 * never invent or silently substitute an identity axis.
 */
export function migrateAgentSourceMemory(
  current: LaunchConfigurationPoolV1,
  memory: LegacyAgentSourceMemory,
  defaultsBySource: Record<string, AgentLaunchConfigurationInput>
): LaunchConfigurationPoolV1 {
  let pool = current;
  for (const [project, sourceId] of Object.entries(memory.projectLastUsed)) {
    const configuration = defaultsBySource[sourceId];
    const usedAt = memory.sourceRecency[sourceId];
    if (
      !configuration ||
      configuration.sourceId !== sourceId ||
      !validProjectKey(project) ||
      finiteTimestamp(usedAt) === null
    ) {
      continue;
    }
    const id = launchConfigurationId(configuration);
    if (pool.projects[project]?.usage[id]) continue;
    pool = recordLaunchConfigurationSuccess(
      pool,
      project,
      configuration,
      usedAt
    );
  }
  return pool;
}

function parseConfiguration(
  raw: unknown,
  fallbackCreatedAt: number
): AgentLaunchConfiguration | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.kind !== undefined && candidate.kind !== 'agent') return null;
  const effort = optionalIdentityPart(candidate.effort);
  const typeId = optionalIdentityPart(candidate.typeId);
  const sourceId = boundedNonEmptyString(
    candidate.sourceId,
    MAX_IDENTITY_PART_LENGTH
  );
  const modelId = boundedNonEmptyString(
    candidate.modelId,
    MAX_IDENTITY_PART_LENGTH
  );
  if (!sourceId || !modelId || effort === undefined || typeId === undefined)
    return null;
  const createdAt = finiteTimestamp(candidate.createdAt) ?? fallbackCreatedAt;
  const name =
    candidate.name === null || candidate.name === undefined
      ? null
      : boundedNonEmptyString(candidate.name, MAX_NAME_LENGTH);
  if (candidate.name !== null && candidate.name !== undefined && !name)
    return null;
  try {
    return createAgentLaunchConfiguration(
      {
        sourceId,
        modelId,
        effort,
        typeId,
        labels: parseLabels(candidate.labels),
      },
      createdAt,
      name
    );
  } catch {
    return null;
  }
}

function parseUsage(value: unknown): LaunchTargetUsage | null {
  // V0 stored a last-used timestamp directly.
  const legacyTimestamp = finiteTimestamp(value);
  if (legacyTimestamp !== null) {
    return { launchCount: 1, lastLaunchedAt: legacyTimestamp };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const count = candidate.launchCount;
  const lastLaunchedAt = finiteTimestamp(candidate.lastLaunchedAt);
  if (
    typeof count !== 'number' ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    lastLaunchedAt === null
  ) {
    return null;
  }
  return { launchCount: count, lastLaunchedAt };
}

/** Parse V1 and the narrow pre-versioned prototype shape, dropping bad rows. */
export function parseLaunchConfigurationPool(
  raw: unknown
): LaunchConfigurationPoolV1 {
  const empty = emptyLaunchConfigurationPool();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const candidate = raw as Record<string, unknown>;
  if (
    candidate.schemaVersion !== undefined &&
    candidate.schemaVersion !== LAUNCH_CONFIGURATION_SCHEMA_VERSION
  ) {
    return empty;
  }
  const rawConfigurations = Array.isArray(candidate.configurations)
    ? candidate.configurations
    : Array.isArray(candidate.items)
      ? candidate.items
      : [];
  const aliases = new Map<string, string>();
  rawConfigurations.forEach((rawConfiguration, index) => {
    const parsed = parseConfiguration(rawConfiguration, index);
    if (!parsed) return;
    const rawId =
      rawConfiguration && typeof rawConfiguration === 'object'
        ? (rawConfiguration as Record<string, unknown>).id
        : undefined;
    if (typeof rawId === 'string') aliases.set(rawId, parsed.id);
    const existing = empty.configurations.find(
      configuration => configuration.fingerprint === parsed.fingerprint
    );
    if (!existing) {
      empty.configurations.push(parsed);
    } else {
      existing.labels = { ...existing.labels, ...parsed.labels };
      if (!existing.name && parsed.name) existing.name = parsed.name;
      existing.createdAt = Math.min(existing.createdAt, parsed.createdAt);
    }
  });

  const rawProjects =
    candidate.projects && typeof candidate.projects === 'object'
      ? candidate.projects
      : undefined;
  const legacyUsage =
    candidate.projectUsage && typeof candidate.projectUsage === 'object'
      ? (candidate.projectUsage as Record<string, unknown>)
      : {};
  const legacyPins =
    candidate.projectPins && typeof candidate.projectPins === 'object'
      ? (candidate.projectPins as Record<string, unknown>)
      : {};
  const projectEntries = rawProjects
    ? Object.entries(rawProjects)
    : Array.from(
        new Set([...Object.keys(legacyUsage), ...Object.keys(legacyPins)])
      ).map(project => [
        project,
        { usage: legacyUsage[project], pins: legacyPins[project] },
      ]);
  const validIds = new Set([
    SHELL_LAUNCH_TARGET_ID,
    ...empty.configurations.map(configuration => configuration.id),
  ]);
  for (const [project, rawState] of projectEntries) {
    if (!validProjectKey(project) || !rawState || typeof rawState !== 'object')
      continue;
    const stateCandidate = rawState as Record<string, unknown>;
    const usage: Record<string, LaunchTargetUsage> = {};
    if (stateCandidate.usage && typeof stateCandidate.usage === 'object') {
      for (const [rawId, rawUsage] of Object.entries(stateCandidate.usage)) {
        const id = aliases.get(rawId) ?? rawId;
        const parsedUsage = parseUsage(rawUsage);
        if (validIds.has(id) && parsedUsage) {
          const existing = usage[id];
          usage[id] = existing
            ? {
                launchCount: existing.launchCount + parsedUsage.launchCount,
                lastLaunchedAt: Math.max(
                  existing.lastLaunchedAt,
                  parsedUsage.lastLaunchedAt
                ),
              }
            : parsedUsage;
        }
      }
    }
    const pins: string[] = [];
    if (Array.isArray(stateCandidate.pins)) {
      for (const rawId of stateCandidate.pins) {
        const id =
          typeof rawId === 'string' ? (aliases.get(rawId) ?? rawId) : '';
        if (validIds.has(id) && !pins.includes(id)) pins.push(id);
      }
    }
    if (Object.keys(usage).length > 0 || pins.length > 0) {
      empty.projects[project] = { usage, pins };
    }
  }
  return empty;
}
