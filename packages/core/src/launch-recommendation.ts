/**
 * Launch setup recommendation (ENG-016 D49).
 *
 * The New Agent row shows the two-to-four setups the operator is most likely
 * to want. That choice is a real decision with real failure modes — a stale
 * row, a row full of engines the operator never uses, a row that changes under
 * the pointer — so it lives here as a pure function over explicit inputs
 * rather than inside a React component.
 *
 * The module is deliberately simulatable: `simulateLaunchHistory` replays an
 * ordered event stream into a pool, so a test or a design bench can ask "what
 * does the row look like after two weeks of this behaviour?" without a running
 * app, a clock, or an Electron bridge.
 *
 * Ordering contract (highest band first; ties never resolved randomly):
 *
 *   1. pinned      — Project pins, in the operator's pin order
 *   2. frecent     — successful launches in this Project, frecency-scored
 *   3. default     — smart-default seeds, one per launchable engine
 *
 * Within every band, available setups outrank unavailable ones, and an
 * unavailable setup is demoted rather than dropped: a configuration the
 * operator relies on must stay visible and inspectable with the exact reason
 * it cannot start (D46's no-silent-substitution rule, retained).
 */

import {
  launchTargetFrecencyScore,
  SHELL_LAUNCH_TARGET,
  recordLaunchConfigurationSuccess,
  setLaunchConfigurationPinned,
  emptyLaunchConfigurationPool,
  type AgentLaunchConfigurationInput,
  type LaunchConfigurationPoolV1,
  type LaunchTarget,
} from './launch-configurations';

/** Why a setup earned its place. Ranking state, not visible card copy. */
export type LaunchRecommendationReason = 'pinned' | 'frecent' | 'default';

export interface LaunchRecommendationAvailability {
  available: boolean;
  /** Exact missing fact, e.g. "Sonnet 4.6 is not available from OpenCode." */
  reason?: string;
}

export interface LaunchRecommendation {
  target: LaunchTarget;
  reason: LaunchRecommendationReason;
  availability: LaunchRecommendationAvailability;
  /** Successful launches of this setup in this Project. 0 for a seed. */
  launchCount: number;
  /** Last successful launch in this Project, or null for a seed. */
  lastLaunchedAt: number | null;
}

export interface LaunchRecommendationInput {
  pool: LaunchConfigurationPoolV1;
  project: string;
  /**
   * Smart defaults, in engine display order: each launchable engine's own
   * default model. They fill the row before the operator has taught it
   * anything, and they never outrank something actually launched here.
   */
  seeds: readonly LaunchTarget[];
  availability: (target: LaunchTarget) => LaunchRecommendationAvailability;
  /**
   * Shell is not an Agent setup. It keeps ⌘⌥T and a place in the full
   * catalog, but it does not consume one of the two-to-four row slots unless
   * the operator pins it. (D49 supersedes D46's "Shell participates in the
   * same Project ordering" as a ROW rule; the catalog rule is unchanged.)
   */
  includeShell?: boolean;
  rankedAt?: number;
}

export interface LaunchRecommendationResult {
  /** Every known setup, best first. The row renders as many as fit. */
  ordered: LaunchRecommendation[];
  /** True once the operator has taught the row at least one setup here. */
  trained: boolean;
}

function bandRank(reason: LaunchRecommendationReason): number {
  return reason === 'pinned' ? 0 : reason === 'frecent' ? 1 : 2;
}

function targetKey(target: LaunchTarget): string {
  return target.id;
}

/**
 * Order every known launch setup for one Project.
 *
 * Pure: the same inputs always produce the same order, including ties. The
 * caller owns freezing — this function is safe to call on every render, but
 * the row must not re-sort while the operator is interacting with it.
 */
export function recommendLaunchSetups(
  input: LaunchRecommendationInput
): LaunchRecommendationResult {
  const {
    pool,
    project,
    seeds,
    availability,
    includeShell = false,
    rankedAt = 0,
  } = input;

  const projectState = pool.projects[project];
  const pins = projectState?.pins ?? [];
  const usage = projectState?.usage ?? {};
  const pinIndex = new Map(pins.map((id, index) => [id, index]));

  const candidates = new Map<string, LaunchTarget>();
  for (const configuration of pool.configurations) {
    candidates.set(targetKey(configuration), configuration);
  }
  for (const seed of seeds) {
    if (seed.kind === 'shell' && !includeShell) continue;
    if (!candidates.has(targetKey(seed))) candidates.set(targetKey(seed), seed);
  }
  if (includeShell && !candidates.has(SHELL_LAUNCH_TARGET.id)) {
    candidates.set(SHELL_LAUNCH_TARGET.id, SHELL_LAUNCH_TARGET);
  }

  const rows: LaunchRecommendation[] = [];
  for (const target of candidates.values()) {
    if (target.kind === 'shell' && !includeShell) continue;
    const record = usage[target.id];
    const pinned = pinIndex.has(target.id);
    const reason: LaunchRecommendationReason = pinned
      ? 'pinned'
      : record
        ? 'frecent'
        : 'default';
    rows.push({
      target,
      reason,
      availability: availability(target),
      launchCount: record?.launchCount ?? 0,
      lastLaunchedAt: record?.lastLaunchedAt ?? null,
    });
  }

  rows.sort((left, right) => {
    const band = bandRank(left.reason) - bandRank(right.reason);
    if (band !== 0) return band;

    if (left.reason === 'pinned') {
      return (
        (pinIndex.get(left.target.id) ?? 0) -
        (pinIndex.get(right.target.id) ?? 0)
      );
    }

    // An unavailable setup is demoted inside its band, never dropped: the
    // operator must still see the setup they rely on, with the exact reason.
    const availabilityOrder =
      Number(right.availability.available) -
      Number(left.availability.available);
    if (availabilityOrder !== 0) return availabilityOrder;

    if (left.reason === 'frecent') {
      const score =
        launchTargetFrecencyScore(usage[right.target.id], rankedAt) -
        launchTargetFrecencyScore(usage[left.target.id], rankedAt);
      if (Math.abs(score) > Number.EPSILON) return score;
    } else {
      // Seeds carry the caller's declared engine display order.
      const leftSeed = seeds.findIndex(seed => seed.id === left.target.id);
      const rightSeed = seeds.findIndex(seed => seed.id === right.target.id);
      if (leftSeed !== rightSeed) {
        if (leftSeed < 0) return 1;
        if (rightSeed < 0) return -1;
        return leftSeed - rightSeed;
      }
    }

    const leftCreated =
      left.target.kind === 'agent' ? left.target.createdAt : 0;
    const rightCreated =
      right.target.kind === 'agent' ? right.target.createdAt : 0;
    if (leftCreated !== rightCreated) return leftCreated - rightCreated;
    return left.target.id.localeCompare(right.target.id);
  });

  return {
    ordered: rows,
    trained: rows.some(row => row.reason !== 'default'),
  };
}

/** One thing that happened, in the order it happened. */
export type LaunchHistoryEvent =
  | {
      kind: 'launch';
      at: number;
      project: string;
      configuration: AgentLaunchConfigurationInput;
    }
  | { kind: 'shell-launch'; at: number; project: string }
  | { kind: 'pin'; project: string; configurationId: string }
  | { kind: 'unpin'; project: string; configurationId: string };

/**
 * Replay an ordered event stream into a pool.
 *
 * This is how the recommendation row is exercised without a running app: a
 * test or the design bench declares "operator launched Opus five times and
 * GPT-5.3 once, three days ago" and gets exactly the pool the real runtime
 * would have written.
 */
export function simulateLaunchHistory(
  events: readonly LaunchHistoryEvent[],
  initial: LaunchConfigurationPoolV1 = emptyLaunchConfigurationPool()
): LaunchConfigurationPoolV1 {
  let pool = initial;
  for (const event of events) {
    if (event.kind === 'launch') {
      pool = recordLaunchConfigurationSuccess(
        pool,
        event.project,
        event.configuration,
        event.at
      );
    } else if (event.kind === 'shell-launch') {
      pool = recordLaunchConfigurationSuccess(
        pool,
        event.project,
        { kind: 'shell' },
        event.at
      );
    } else {
      pool = setLaunchConfigurationPinned(
        pool,
        event.project,
        event.configurationId,
        event.kind === 'pin'
      );
    }
  }
  return pool;
}
