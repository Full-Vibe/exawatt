import type { AgentSourceRegistrySnapshot } from '@/types/electron';
import type { AgentSourceId } from './agent-sources';
import { AGENT_SOURCE_META, launchSourceSnapshots } from './agent-sources';
import {
  composeLaunchTargets,
  launchTargetAvailability,
  launchTargetPresentation,
  resolveLaunchSource,
  type LaunchSourceCatalogs,
} from './launch-target-catalog';
import type { WorkspaceTab } from './use-workspace-state';
import type { LaunchTarget } from '@exawatt/core';

const MAX_HANDOFF_CHARS = 2_400;
const MAX_FIELD_CHARS = 1_000;

/**
 * Clone starts a NEW local Agent from bounded Exawatt-owned context.
 *
 * A connected coworker is never a clone source: its context belongs to its
 * source, and Exawatt holds no authority to spawn anything there. Handing its
 * conversation to a local Agent would also copy someone else's work into this
 * machine under a name the source never agreed to.
 */
export function tabCanClone(
  tab: WorkspaceTab,
  input: { engaged?: boolean; contextSummary?: string | null } = {}
): boolean {
  if (tab.kind === 'remote-agent') return false;
  return (
    tab.harness !== 'shell' &&
    tab.lifecycle !== 'draft' &&
    (!!input.engaged ||
      !!input.contextSummary?.trim() ||
      !!tab.initialTask?.trim())
  );
}

/**
 * One row of the Clone to… menu. Identity is the Launch Configuration id, and
 * `label` alone is NOT identity: two setups on the same model share it, which
 * is exactly what `detail` exists to separate.
 */
export interface CloneSessionTarget {
  id: string;
  sourceId: string;
  source: AgentSourceId;
  modelId: string;
  effort: string | null;
  label: string;
  /** Secondary line, e.g. `High`. Present whenever the engine reports one. */
  detail?: string;
  /** Full spoken identity: source, model, effort, type. */
  accessibleLabel: string;
}

/**
 * Clone to… is a FILTER over the one Launch Target catalog (⌘T's), never a
 * second list: the same setups, in the same frecency order, under the same
 * names. The only narrowing is availability — cloning into a setup the
 * operator cannot start is not an offer worth making, whereas the composer
 * still shows it with the missing fact attached because that surface is where
 * you go to fix it.
 */
export function availableSessionCloneTargets(
  registry: AgentSourceRegistrySnapshot,
  ranked: readonly LaunchTarget[] = [],
  catalogs: LaunchSourceCatalogs = {}
): CloneSessionTarget[] {
  const sources = launchSourceSnapshots(registry);
  return composeLaunchTargets({ ranked, sources, catalogs })
    .filter(
      target => launchTargetAvailability(target, { sources, catalogs }).available
    )
    .map(target => {
      const presented = launchTargetPresentation(target, sources);
      return {
        id: target.id,
        // The launch path matches a Session against the REGISTRY source id, so
        // a target that names its source by harness is normalised here.
        sourceId: resolveLaunchSource(target, sources)?.id ?? target.sourceId,
        source: presented.source,
        modelId: target.modelId,
        effort: target.effort,
        label: presented.label,
        detail: presented.detail,
        accessibleLabel: presented.accessibleLabel,
      };
    });
}

function bounded(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, ' ') ?? '';
  if (!normalized) return null;
  if (normalized.length <= MAX_FIELD_CHARS) return normalized;
  return `${normalized.slice(0, MAX_FIELD_CHARS - 1).trimEnd()}…`;
}

/**
 * A Clone handoff is deliberately fresh-session context, never a provider
 * resume request. It carries only bounded operator/context truth that Exawatt
 * already owns and cannot leak a provider conversation identity into the new
 * Agent.
 */
export function sessionClonePrompt(input: {
  target: AgentSourceId;
  initialTask?: string | null;
  contextSummary?: string | null;
}): string {
  const goal = bounded(input.initialTask);
  const context = bounded(input.contextSummary);
  const target = AGENT_SOURCE_META[input.target].label;
  const parts = [
    `Continue this work in a fresh ${target} Agent Session.`,
    goal ? `Goal: ${goal}` : null,
    context ? `Handoff: ${context}` : null,
    'Inspect the current Project state, then continue from this bounded handoff. Do not assume access to the previous provider conversation.',
  ].filter((part): part is string => part !== null);
  const prompt = parts.join('\n\n');
  if (prompt.length <= MAX_HANDOFF_CHARS) return prompt;
  return `${prompt.slice(0, MAX_HANDOFF_CHARS - 1).trimEnd()}…`;
}
