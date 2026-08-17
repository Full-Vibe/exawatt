/**
 * The ONE Launch Target catalog (ENG-016 D49).
 *
 * ⌘T's composer, the Launch Configuration ribbon, the command palette and
 * Clone to… are all asking the same question — "which setups can start an
 * Agent here?" — so they read one catalog rather than each assembling their
 * own list. Clone to… used to hand-build a parallel list in
 * `session-clone.ts`: it ordered targets differently from the launcher, it
 * labelled them with the model name ALONE, and two setups that differ only by
 * reasoning effort therefore rendered as two rows reading `GPT-5.6 Codex`
 * with nothing to tell them apart (operator, 2026-08-17).
 *
 * Composition, availability and presentation live here so a change to what a
 * setup is CALLED lands on every surface at once. Nothing in this module
 * touches Electron, persistence or React; it is pure over the pool, the
 * source registry snapshot and the per-source model catalogs.
 */

import type { AgentModelCatalog, AgentSourceSnapshot } from '@/types/electron';
import type { AgentSourceId } from './agent-sources';
import {
  createAgentLaunchConfiguration,
  type AgentLaunchConfiguration,
  type LaunchTarget,
} from '@exawatt/core';

/** A source that can actually host an interactive launch. */
export type LaunchSourceSnapshot = AgentSourceSnapshot & {
  harness: AgentSourceId;
};

export type LaunchSourceCatalogs = Partial<
  Record<AgentSourceId, AgentModelCatalog>
>;

export interface LaunchTargetAvailability {
  available: boolean;
  /** Required whenever `available` is false: the exact missing fact. */
  reason?: string;
}

export interface LaunchTargetCatalogInput {
  /**
   * Frecency-ranked targets from the Launch Configuration pool, in the order
   * the operator should see them. Always `rankLaunchTargets(pool, projectDir)`
   * — never the pool's raw insertion order, which is not an order anyone
   * chose.
   */
  ranked?: readonly LaunchTarget[];
  /** `launchSourceSnapshots(registry)`, in registry order. */
  sources: readonly LaunchSourceSnapshot[];
  catalogs: LaunchSourceCatalogs;
}

/**
 * A target names its source by registry id, but a target restored from an
 * older pool may name it by harness, so both resolve.
 */
export function resolveLaunchSource(
  target: Pick<AgentLaunchConfiguration, 'sourceId'>,
  sources: readonly LaunchSourceSnapshot[]
): LaunchSourceSnapshot | undefined {
  return sources.find(
    candidate =>
      candidate.id === target.sourceId || candidate.harness === target.sourceId
  );
}

/**
 * Ranked pool targets first, then one source-owned default per launchable
 * engine that the pool has not already covered. Identity is the Launch
 * Configuration id, so a default and a saved preset for the same
 * source/model/effort/type collapse into one row.
 */
export function composeLaunchTargets({
  ranked = [],
  sources,
  catalogs,
}: LaunchTargetCatalogInput): AgentLaunchConfiguration[] {
  const targets: AgentLaunchConfiguration[] = [];
  const seen = new Set<string>();
  for (const target of ranked) {
    if (target.kind !== 'agent' || seen.has(target.id)) continue;
    targets.push(target);
    seen.add(target.id);
  }
  for (const source of sources) {
    if (!source.launchable) continue;
    const catalog = catalogs[source.harness];
    if (!catalog?.effectiveModel) continue;
    const option = catalog.models.find(
      candidate => candidate.id === catalog.effectiveModel
    );
    try {
      const target = createAgentLaunchConfiguration(
        {
          sourceId: source.id,
          modelId: catalog.effectiveModel,
          effort: catalog.effectiveEffort,
          labels: {
            source: source.label,
            model: option?.label ?? catalog.effectiveModelLabel,
            effort: catalog.effectiveEffortLabel,
          },
        },
        0
      );
      if (seen.has(target.id)) continue;
      targets.push(target);
      seen.add(target.id);
    } catch {
      // A malformed source-owned identity is not made selectable.
    }
  }
  return targets;
}

export function launchTargetAvailability(
  target: AgentLaunchConfiguration,
  {
    sources,
    catalogs,
  }: { sources: readonly LaunchSourceSnapshot[]; catalogs: LaunchSourceCatalogs }
): LaunchTargetAvailability {
  const snapshot = resolveLaunchSource(target, sources);
  if (!snapshot) {
    return {
      available: false,
      reason: `Agent Source ${target.labels.source ?? target.sourceId} is not installed.`,
    };
  }
  if (!snapshot.launchable) {
    return {
      available: false,
      reason: `${snapshot.label}: ${snapshot.stateLabel}`,
    };
  }
  const catalog = catalogs[snapshot.harness];
  if (!catalog) {
    return { available: false, reason: 'Checking model availability…' };
  }
  const exactModelAvailable =
    target.modelId === catalog.effectiveModel ||
    catalog.models.some(option => option.id === target.modelId);
  return exactModelAvailable
    ? { available: true }
    : {
        available: false,
        reason: `${target.labels.model ?? target.modelId} is not available from ${snapshot.label}.`,
      };
}

/**
 * How one target is named everywhere it appears.
 *
 * `label` is the anchor the eye lands on and is deliberately NOT unique on
 * its own — two setups on the same model share it. `detail` is what makes the
 * pair distinguishable, so any surface that renders `label` must render
 * `detail` beside it. `id` is the only thing keyboard state, React keys and
 * highlight are ever allowed to key on.
 */
export interface LaunchTargetPresentation {
  id: string;
  label: string;
  detail?: string;
  /** Full spoken identity; never derived from truncated visible copy. */
  accessibleLabel: string;
  source: AgentSourceId;
  named: boolean;
}

export function launchTargetPresentation(
  target: AgentLaunchConfiguration,
  sources: readonly LaunchSourceSnapshot[]
): LaunchTargetPresentation {
  const snapshot = resolveLaunchSource(target, sources);
  const sourceLabel = target.labels.source ?? snapshot?.label ?? target.sourceId;
  const modelDisplay = target.labels.model ?? target.modelId;
  const effortDisplay = target.labels.effort ?? target.effort;
  const identity = [sourceLabel, modelDisplay, effortDisplay, target.labels.type]
    .filter(Boolean)
    .join(', ');
  return {
    id: target.id,
    label: target.name ?? modelDisplay,
    detail: target.name
      ? [modelDisplay, effortDisplay].filter(Boolean).join(' · ')
      : effortDisplay || undefined,
    accessibleLabel: target.name ? `${target.name}: ${identity}` : identity,
    source: snapshot?.harness ?? 'claude',
    named: Boolean(target.name),
  };
}
