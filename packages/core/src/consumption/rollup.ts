/**
 * Rollups: samples -> scoped totals. Pure, deterministic, order-independent.
 *
 * A rollup never invents a scope. A sample with no `cwd` cannot be attributed
 * to a Project and is excluded from Project rollups rather than being bucketed
 * into an "unknown" that would later be read as a real project — but it is
 * still counted in `unattributedSamples` so a surface can say how much of the
 * total it is failing to place.
 */
import { addUsage, subtractUsage } from './merge';
import { resolveModelWeight, weightUsage } from './model-weights';
import { intersectAssurance } from './assurance';
import type {
  ConsumptionAssurance,
  ConsumptionRollup,
  ConsumptionSample,
  ConsumptionScope,
  ConsumptionScopeKind,
  ConsumptionSourceId,
  RawUsage,
} from './types';
import { SOURCE_CAPABILITIES, ZERO_USAGE } from './types';

/** Resolves a sample's launch directory to a Project. Injectable and pure. */
export type ProjectResolver = (
  cwd: string
) => { id: string; label: string } | null;

/**
 * Default resolver: the launch directory itself is the Project, labelled by its
 * last path segment. Deliberately naive — worktrees and nested packages need
 * the Electron-side git worktree resolution, which does not belong in a pure
 * layer. Callers that have it should inject a better resolver.
 */
export const directoryProjectResolver: ProjectResolver = cwd => {
  const trimmed = cwd.replace(/[/\\]+$/, '');
  if (!trimmed) return null;
  const segments = trimmed.split(/[/\\]/);
  return { id: trimmed, label: segments[segments.length - 1] || trimmed };
};

export interface RollupOptions {
  /** Restrict to samples inside this window (ISO 8601, inclusive). */
  from?: string;
  to?: string;
  projectResolver?: ProjectResolver;
}

interface Bucket {
  scope: ConsumptionScope;
  totals: RawUsage;
  weightedTokens: number;
  weightedTokensFromFallback: number;
  modelsWithoutWeight: Set<string>;
  sessions: Set<string>;
  sources: Set<ConsumptionSourceId>;
  assurances: ConsumptionAssurance[];
  samples: number;
  from: string;
  to: string;
  delegatedSamples: number;
  delegatedTotals: RawUsage;
  delegatedWeighted: number;
  delegatedAgents: Set<string>;
  delegatedAgentTypes: Set<string>;
}

function newBucket(scope: ConsumptionScope, at: string): Bucket {
  return {
    scope,
    totals: { ...ZERO_USAGE },
    weightedTokens: 0,
    weightedTokensFromFallback: 0,
    modelsWithoutWeight: new Set(),
    sessions: new Set(),
    sources: new Set(),
    assurances: [],
    samples: 0,
    from: at,
    to: at,
    delegatedSamples: 0,
    delegatedTotals: { ...ZERO_USAGE },
    delegatedWeighted: 0,
    delegatedAgents: new Set(),
    delegatedAgentTypes: new Set(),
  };
}

function finish(bucket: Bucket): ConsumptionRollup {
  return {
    scope: bucket.scope,
    window: { from: bucket.from, to: bucket.to },
    totals: bucket.totals,
    weightedTokens: bucket.weightedTokens,
    weightedTokensFromFallback: bucket.weightedTokensFromFallback,
    modelsWithoutWeight: [...bucket.modelsWithoutWeight].sort(),
    sessionCount: bucket.sessions.size,
    samples: bucket.samples,
    sources: [...bucket.sources].sort(),
    assurance: intersectAssurance(bucket.assurances),
    delegated: {
      samples: bucket.delegatedSamples,
      totals: bucket.delegatedTotals,
      weightedTokens: bucket.delegatedWeighted,
      agents: bucket.delegatedAgents.size,
      agentTypes: [...bucket.delegatedAgentTypes].sort(),
    },
    delegationBlindSources: [...bucket.sources]
      .filter(source => !SOURCE_CAPABILITIES[source].delegation)
      .sort(),
  };
}

/**
 * The scope's OWN usage: inclusive totals minus the delegated portion. Exposed
 * as a helper rather than a stored field so the two can never disagree.
 */
export function ownTotals(rollup: ConsumptionRollup): RawUsage {
  return subtractUsage(rollup.totals, rollup.delegated.totals);
}

/** Weighted tokens the scope spent on its own turns. */
export function ownWeightedTokens(rollup: ConsumptionRollup): number {
  return rollup.weightedTokens - rollup.delegated.weightedTokens;
}

function withinWindow(
  sample: ConsumptionSample,
  options: RollupOptions
): boolean {
  if (options.from && sample.at < options.from) return false;
  if (options.to && sample.at > options.to) return false;
  return true;
}

export interface RollupResult {
  rollups: ConsumptionRollup[];
  /** Samples inside the window that the keying function could not place. */
  unattributedSamples: number;
  /** Usage from those unattributable samples, so nothing vanishes silently. */
  unattributedTotals: RawUsage;
}

/**
 * Generic grouping. `key` returns the scope a sample belongs to, or null when
 * the sample cannot honestly be placed in any scope of this kind.
 */
export function rollupBy(
  samples: Iterable<ConsumptionSample>,
  key: (sample: ConsumptionSample) => ConsumptionScope | null,
  options: RollupOptions = {}
): RollupResult {
  const buckets = new Map<string, Bucket>();
  let unattributedSamples = 0;
  let unattributedTotals: RawUsage = { ...ZERO_USAGE };

  for (const sample of samples) {
    if (!withinWindow(sample, options)) continue;
    const scope = key(sample);
    if (!scope) {
      unattributedSamples += 1;
      unattributedTotals = addUsage(unattributedTotals, sample.usage);
      continue;
    }
    const bucketKey = `${scope.kind}:${scope.id}`;
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = newBucket(scope, sample.at);
      buckets.set(bucketKey, bucket);
    }

    const { weight, explicit } = resolveModelWeight(sample.model);
    const weighted = weightUsage(sample.usage, weight);
    bucket.totals = addUsage(bucket.totals, sample.usage);
    bucket.weightedTokens += weighted;
    if (!explicit) {
      bucket.weightedTokensFromFallback += weighted;
      if (sample.model) bucket.modelsWithoutWeight.add(sample.model);
    }
    bucket.sessions.add(`${sample.source}:${sample.providerSessionId}`);
    bucket.sources.add(sample.source);
    bucket.assurances.push(sample.assurance);
    bucket.samples += 1;
    if (sample.delegation) {
      bucket.delegatedSamples += 1;
      bucket.delegatedTotals = addUsage(bucket.delegatedTotals, sample.usage);
      bucket.delegatedWeighted += weighted;
      bucket.delegatedAgents.add(sample.delegation.agentId);
      if (sample.delegation.agentType) {
        bucket.delegatedAgentTypes.add(sample.delegation.agentType);
      }
    }
    if (sample.at < bucket.from) bucket.from = sample.at;
    if (sample.at > bucket.to) bucket.to = sample.at;
  }

  const rollups = [...buckets.values()]
    .map(finish)
    .sort((left, right) =>
      right.weightedTokens - left.weightedTokens ||
      (left.scope.id < right.scope.id ? -1 : 1)
    );
  return { rollups, unattributedSamples, unattributedTotals };
}

export function rollupBySession(
  samples: Iterable<ConsumptionSample>,
  options: RollupOptions = {}
): RollupResult {
  return rollupBy(
    samples,
    sample => ({
      kind: 'session',
      id: `${sample.source}:${sample.providerSessionId}`,
      label: sample.providerSessionId,
    }),
    options
  );
}

export function rollupByProject(
  samples: Iterable<ConsumptionSample>,
  options: RollupOptions = {}
): RollupResult {
  const resolve = options.projectResolver ?? directoryProjectResolver;
  return rollupBy(
    samples,
    sample => {
      if (!sample.cwd) return null;
      const project = resolve(sample.cwd);
      if (!project) return null;
      return { kind: 'project', id: project.id, label: project.label };
    },
    options
  );
}

/** UTC calendar days. Local-day bucketing is a presentation concern. */
export function rollupByDay(
  samples: Iterable<ConsumptionSample>,
  options: RollupOptions = {}
): RollupResult {
  return rollupBy(
    samples,
    sample => {
      const day = sample.at.slice(0, 10);
      return day.length === 10
        ? { kind: 'day', id: day, label: day }
        : null;
    },
    options
  );
}

export function rollupByModel(
  samples: Iterable<ConsumptionSample>,
  options: RollupOptions = {}
): RollupResult {
  return rollupBy(
    samples,
    sample =>
      sample.model
        ? { kind: 'model', id: sample.model, label: sample.model }
        : null,
    options
  );
}

export function rollupBySource(
  samples: Iterable<ConsumptionSample>,
  options: RollupOptions = {}
): RollupResult {
  return rollupBy(
    samples,
    sample => ({ kind: 'source', id: sample.source, label: sample.source }),
    options
  );
}

/** One rollup over everything in scope. */
export function rollupWorkspace(
  samples: Iterable<ConsumptionSample>,
  workspace: { id: string; label: string },
  options: RollupOptions = {}
): ConsumptionRollup | null {
  const { rollups } = rollupBy(
    samples,
    () => ({ kind: 'workspace', id: workspace.id, label: workspace.label }),
    options
  );
  return rollups[0] ?? null;
}

/**
 * Roadmap-item rollups need the session -> roadmap link, which lives in
 * `roadmap/link` and is evidence-based rather than derivable from a usage
 * record. The link is injected; sessions with no confident link stay
 * unattributed instead of being guessed into an item.
 */
export function rollupByRoadmapItem(
  samples: Iterable<ConsumptionSample>,
  link: (
    sample: ConsumptionSample
  ) => { id: string; label: string } | null,
  options: RollupOptions = {}
): RollupResult {
  return rollupBy(
    samples,
    sample => {
      const item = link(sample);
      return item
        ? { kind: 'roadmapItem', id: item.id, label: item.label }
        : null;
    },
    options
  );
}

/** Scope kinds this module can key by today. */
export const SUPPORTED_ROLLUP_KINDS: readonly ConsumptionScopeKind[] = [
  'workspace',
  'project',
  'session',
  'roadmapItem',
  'day',
  'model',
  'source',
];
