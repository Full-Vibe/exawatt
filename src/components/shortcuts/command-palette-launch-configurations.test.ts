import { describe, expect, it } from 'vitest';
import {
  commandPaletteConfigurationKey,
  commandPaletteConfigurationRequest,
  commandPaletteLaunchConfigurationCatalog,
  commandPaletteLaunchConfigurations,
} from './command-palette-launch-configurations';

describe('command palette launch configurations', () => {
  it('offers source defaults and Shell when no shared selector is supplied', () => {
    const rows = commandPaletteLaunchConfigurations();

    expect(rows.map(row => row.configuration.kind)).toEqual([
      'agent',
      'agent',
      'agent',
      'shell',
    ]);
    expect(
      rows.flatMap(row =>
        row.configuration.kind === 'agent' ? [row.configuration.source] : []
      )
    ).toEqual(['claude', 'codex', 'opencode']);
    expect(rows.map(commandPaletteConfigurationKey)).toEqual([
      'claude',
      'codex',
      'opencode',
      'shell',
    ]);
  });

  it('preserves a supplied exact identity and snapshot', () => {
    const exact = {
      configurationId: 'project:reviewer',
      label: 'Reviewer',
      configuration: {
        kind: 'agent' as const,
        source: 'codex' as const,
        model: 'gpt-5',
        effort: 'high',
        agentTypeId: 'reviewer',
      },
    };
    const rows = commandPaletteLaunchConfigurations([exact]);

    expect(commandPaletteConfigurationKey(rows[0])).toBe('project:reviewer');
    expect(commandPaletteConfigurationRequest(rows[0])).toEqual({
      configurationId: 'project:reviewer',
      configuration: exact.configuration,
    });
  });

  it('adds Shell exactly once to shared selector rows', () => {
    const shell = {
      configurationId: 'project:shell',
      label: 'Terminal',
      configuration: { kind: 'shell' as const },
    };

    expect(commandPaletteLaunchConfigurations([shell])).toEqual([shell]);
  });

  it('preserves exact dynamic rows from the active Project catalog event', () => {
    const rows = [
      {
        configurationId: 'project:reviewer',
        label: 'Reviewer',
        configuration: {
          kind: 'agent' as const,
          source: 'codex' as const,
          model: 'gpt-5',
          effort: 'high',
          agentTypeId: 'reviewer',
        },
      },
      {
        configurationId: 'project:shell',
        label: 'Shell',
        configuration: { kind: 'shell' as const },
      },
    ];
    const event = new CustomEvent('catalog', { detail: rows });

    expect(commandPaletteLaunchConfigurationCatalog(event)).toBe(rows);
    expect(commandPaletteLaunchConfigurations(rows)).toEqual(rows);
  });

  it('clears empty or malformed catalog events', () => {
    expect(
      commandPaletteLaunchConfigurationCatalog(
        new CustomEvent('catalog', { detail: [] })
      )
    ).toBeUndefined();
    expect(
      commandPaletteLaunchConfigurationCatalog(
        new CustomEvent('catalog', { detail: null })
      )
    ).toBeUndefined();
  });
});
