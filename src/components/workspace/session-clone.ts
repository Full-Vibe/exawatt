import type {
  AgentModelCatalog,
  AgentSourceRegistrySnapshot,
} from '@/types/electron';
import type { AgentSourceId } from './agent-sources';
import { AGENT_SOURCE_META, launchSourceSnapshots } from './agent-sources';
import type { WorkspaceTab } from './use-workspace-state';
import {
  launchConfigurationId,
  type AgentLaunchConfiguration,
} from '@exawatt/core';

const MAX_HANDOFF_CHARS = 2_400;
const MAX_FIELD_CHARS = 1_000;

export function tabCanClone(
  tab: WorkspaceTab,
  input: { engaged?: boolean; contextSummary?: string | null } = {}
): boolean {
  return (
    tab.harness !== 'shell' &&
    tab.lifecycle !== 'draft' &&
    (!!input.engaged ||
      !!input.contextSummary?.trim() ||
      !!tab.initialTask?.trim())
  );
}

export interface CloneSessionTarget {
  id: string;
  sourceId: string;
  source: AgentSourceId;
  modelId: string;
  effort: string | null;
  label: string;
}

export function availableSessionCloneTargets(
  registry: AgentSourceRegistrySnapshot,
  configurations: readonly AgentLaunchConfiguration[] = [],
  catalogs: Partial<Record<AgentSourceId, AgentModelCatalog>> = {}
): CloneSessionTarget[] {
  const sources = launchSourceSnapshots(registry).filter(
    source => source.launchable
  );
  const targets: CloneSessionTarget[] = [];
  const seen = new Set<string>();
  for (const configuration of configurations) {
    const source = sources.find(
      candidate => candidate.id === configuration.sourceId
    );
    if (!source) continue;
    const catalog = catalogs[source.harness];
    if (
      !catalog ||
      (configuration.modelId !== catalog.effectiveModel &&
        !catalog.models.some(model => model.id === configuration.modelId))
    ) {
      continue;
    }
    targets.push({
      id: configuration.id,
      sourceId: source.id,
      source: source.harness,
      modelId: configuration.modelId,
      effort: configuration.effort,
      label:
        configuration.name ??
        configuration.labels.model ??
        configuration.modelId,
    });
    seen.add(configuration.id);
  }
  for (const source of sources) {
    const catalog = catalogs[source.harness];
    if (!catalog?.effectiveModel) continue;
    const id = launchConfigurationId({
      sourceId: source.id,
      modelId: catalog.effectiveModel,
      effort: catalog.effectiveEffort,
    });
    if (seen.has(id)) continue;
    targets.push({
      id,
      sourceId: source.id,
      source: source.harness,
      modelId: catalog.effectiveModel,
      effort: catalog.effectiveEffort,
      label: catalog.effectiveModelLabel,
    });
  }
  return targets;
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
