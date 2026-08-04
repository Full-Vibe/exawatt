import {
  AGENT_SOURCE_META,
  AGENT_SOURCE_ORDER,
} from '@/components/workspace/agent-sources';
import type {
  AgentComposerConfigurationRequest,
  AgentComposerConfigurationSnapshot,
} from '@/components/workspace/session-jump';

/** Render-ready configuration supplied by the shared launch selector. */
export interface CommandPaletteLaunchConfiguration {
  configurationId?: string;
  configuration: AgentComposerConfigurationSnapshot;
  label: string;
  searchValue?: string;
}

/**
 * The palette can consume the same ranked selector as the composer without
 * knowing where configurations are persisted. Until that selector is
 * supplied, the source defaults remain available and Shell is a peer row.
 */
export function commandPaletteLaunchConfigurations(
  supplied?: readonly CommandPaletteLaunchConfiguration[]
): CommandPaletteLaunchConfiguration[] {
  const rows: CommandPaletteLaunchConfiguration[] = supplied
    ? [...supplied]
    : AGENT_SOURCE_ORDER.map(source => ({
        configuration: {
          kind: 'agent' as const,
          source,
          model: null,
          effort: null,
        },
        label: AGENT_SOURCE_META[source].label,
        searchValue: `${AGENT_SOURCE_META[source].label} ${source}`,
      }));

  if (!rows.some(row => row.configuration.kind === 'shell')) {
    rows.push({
      configuration: { kind: 'shell' },
      label: 'Shell',
      searchValue: 'shell terminal command line',
    });
  }

  return rows;
}

export function commandPaletteConfigurationRequest(
  row: CommandPaletteLaunchConfiguration
): AgentComposerConfigurationRequest {
  return {
    ...(row.configurationId ? { configurationId: row.configurationId } : {}),
    configuration: row.configuration,
  };
}

export function commandPaletteConfigurationKey(
  row: CommandPaletteLaunchConfiguration
): string {
  if (row.configurationId) return row.configurationId;
  if (row.configuration.kind === 'shell') return 'shell';
  const { source, model, effort, agentTypeId } = row.configuration;
  if (!model && !effort && !agentTypeId) return source;
  return [source, model, effort, agentTypeId]
    .map(value => value ?? '')
    .join(':');
}
