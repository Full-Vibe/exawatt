// Named as a DOM suite because the renderer bridge is exposed on window.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fallbackAgentSourceRegistry,
  loadAgentSourceRegistry,
  recommendLaunchableAgentSource,
} from './agent-sources';

describe('renderer Agent Source boundary', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'electron');
  });

  it('fails closed when the Electron observation bridge is unavailable', async () => {
    const result = await loadAgentSourceRegistry('launch');
    expect(result.status).toBe('unavailable');
    expect(result.error?.code).toBe('bridge-unavailable');
    expect(result.snapshot.sources).not.toHaveLength(0);
    expect(result.snapshot.sources.every(source => !source.launchable)).toBe(
      true
    );
  });

  it('retains a last observation as visibly stale without making it live', async () => {
    const previous = fallbackAgentSourceRegistry('launch');
    previous.sources[0] = { ...previous.sources[0], launchable: true };
    window.electron = {
      isElectron: true,
      platform: 'darwin',
      agentSources: {
        list: vi.fn().mockRejectedValue(new Error('main unavailable')),
        act: vi.fn(),
      },
    } as unknown as NonNullable<Window['electron']>;
    const result = await loadAgentSourceRegistry('launch', true, previous);
    expect(result.status).toBe('stale');
    expect(result.snapshot).toBe(previous);
    expect(result.error?.code).toBe('observation-failed');
  });

  it('ranks only launchable sources for one-click roadmap launches', () => {
    const registry = fallbackAgentSourceRegistry('launch');
    registry.sources = registry.sources.map(source => ({
      ...source,
      state: 'action-required' as const,
      unobservedProbes: [],
      launchable: source.harness === 'codex',
    }));
    expect(
      recommendLaunchableAgentSource(
        {
          projectLastUsed: { '/repo': 'claude' },
          sourceRecency: { claude: 20, codex: 10 },
          projectPermissionModes: {},
        },
        '/repo',
        registry
      )
    ).toEqual({ kind: 'launchable', source: 'codex' });
  });

  // BUG-063. "No Agent Source is ready. Configure one in Agent Sources." is a
  // claim about the machine. On a cold start nothing has answered yet, and
  // sending the operator to configure a source he already has is the same
  // defect the main process shipped as "could not be verified (degraded)".
  it('does not report an unprobed registry as nothing being ready', () => {
    const registry = fallbackAgentSourceRegistry('launch');
    const choice = recommendLaunchableAgentSource(
      {
        projectLastUsed: { '/repo': 'claude' },
        sourceRecency: {},
        projectPermissionModes: {},
      },
      '/repo',
      registry
    );
    expect(choice.kind).toBe('unproven');
    expect(choice.kind !== 'none' && choice.source).toBe('claude');
  });

  it('says nothing is ready only once every source has been observed', () => {
    const registry = fallbackAgentSourceRegistry('launch');
    registry.sources = registry.sources.map(source => ({
      ...source,
      state: 'not-installed' as const,
      unobservedProbes: [],
      launchable: false,
    }));
    expect(
      recommendLaunchableAgentSource(
        {
          projectLastUsed: {},
          sourceRecency: {},
          projectPermissionModes: {},
        },
        '/repo',
        registry
      )
    ).toEqual({ kind: 'none' });
  });
});
