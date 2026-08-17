import { describe, expect, it } from 'vitest';
import {
  availableSessionCloneTargets,
  sessionClonePrompt,
  tabCanClone,
} from './session-clone';
import type { WorkspaceTab } from './use-workspace-state';
import {
  fallbackAgentSourceRegistry,
  launchSourceSnapshots,
} from './agent-sources';
import { composeLaunchTargets } from './launch-target-catalog';
import { createAgentLaunchConfiguration } from '@exawatt/core';

function tab(overrides: Partial<WorkspaceTab> = {}): WorkspaceTab {
  return {
    id: 'tab-a',
    durableSessionId: 'durable-a',
    harness: 'claude',
    title: 'Claude',
    titleKind: 'default',
    cwd: '/repo',
    sessionId: 'pty-a',
    harnessSessionId: 'provider-a',
    resumeState: 'live',
    lifecycle: 'running',
    exitCode: null,
    roadmapItemId: null,
    initialTask: null,
    ...overrides,
  };
}

describe('sessionClonePrompt', () => {
  it('builds a fresh-session handoff without provider resume identity', () => {
    const prompt = sessionClonePrompt({
      target: 'codex',
      initialTask: 'Ship the launch ribbon',
      contextSummary: 'Tests pass; visual QA remains.',
    });

    expect(prompt).toContain('fresh Codex Agent Session');
    expect(prompt).toContain('Goal: Ship the launch ribbon');
    expect(prompt).toContain('Handoff: Tests pass; visual QA remains.');
    expect(prompt).toContain('Do not assume access');
    expect(prompt).not.toMatch(/session[- ]?id|providerSessionId/i);
  });

  it('bounds untrusted Session context before launch', () => {
    const prompt = sessionClonePrompt({
      target: 'claude',
      initialTask: `goal-${'g'.repeat(5_000)}`,
      contextSummary: `context-${'c'.repeat(5_000)}`,
    });

    expect(prompt.length).toBeLessThanOrEqual(2_400);
    expect(prompt).toContain('…');
  });

  it('allows only started Agent Sessions', () => {
    expect(tabCanClone(tab(), { engaged: true })).toBe(true);
    expect(
      tabCanClone(tab({ sessionId: null }), { contextSummary: 'Done' })
    ).toBe(true);
    expect(tabCanClone(tab())).toBe(false);
    expect(tabCanClone(tab({ harness: 'shell' }), { engaged: true })).toBe(
      false
    );
    expect(tabCanClone(tab({ lifecycle: 'draft' }), { engaged: true })).toBe(
      false
    );
  });

  it('exposes only currently launchable Agent targets', () => {
    const registry = fallbackAgentSourceRegistry('launch');
    registry.sources = registry.sources.map(source => ({
      ...source,
      launchable: source.harness === 'codex',
    }));

    expect(
      availableSessionCloneTargets(registry, [], {
        codex: {
          harness: 'codex',
          effectiveModel: 'gpt-5.6-sol',
          effectiveModelLabel: 'GPT-5.6-Sol',
          effectiveModelSource: 'config',
          effectiveEffort: 'high',
          effectiveEffortLabel: 'High',
          effectiveEffortSource: 'config',
          effortLocked: false,
          models: [],
          catalogMode: 'configured-values',
          catalogProvenance: 'test',
          observedAt: 1,
          selectionAction: null,
        },
      })
    ).toEqual([
      expect.objectContaining({
        source: 'codex',
        modelId: 'gpt-5.6-sol',
        effort: 'high',
        label: 'GPT-5.6-Sol',
        detail: 'High',
        accessibleLabel: 'Codex, GPT-5.6-Sol, High',
      }),
    ]);
  });

  // BUG-051: a saved High setup plus the engine's own Medium default are two
  // real targets on one model, so they share a label. The operator saw them as
  // two identical rows; what separates them is the effort on `detail` and the
  // Launch Configuration id, never the words.
  it('separates two setups that differ only by reasoning effort', () => {
    const registry = fallbackAgentSourceRegistry('launch');
    registry.sources = registry.sources.map(source => ({
      ...source,
      launchable: source.harness === 'codex',
    }));
    const codex = registry.sources.find(source => source.harness === 'codex')!;
    const saved = createAgentLaunchConfiguration(
      {
        sourceId: codex.id,
        modelId: 'gpt-5.6-sol',
        effort: 'high',
        labels: { source: 'Codex', model: 'GPT-5.6 Codex', effort: 'High' },
      },
      0
    );

    const targets = availableSessionCloneTargets(registry, [saved], {
      codex: {
        harness: 'codex',
        effectiveModel: 'gpt-5.6-sol',
        effectiveModelLabel: 'GPT-5.6 Codex',
        effectiveModelSource: 'config',
        effectiveEffort: 'medium',
        effectiveEffortLabel: 'Medium',
        effectiveEffortSource: 'config',
        effortLocked: false,
        models: [],
        catalogMode: 'configured-values',
        catalogProvenance: 'test',
        observedAt: 1,
        selectionAction: null,
      },
    });

    expect(targets.map(target => target.label)).toEqual([
      'GPT-5.6 Codex',
      'GPT-5.6 Codex',
    ]);
    expect(targets.map(target => target.detail)).toEqual(['High', 'Medium']);
    expect(new Set(targets.map(target => target.id)).size).toBe(2);
    expect(new Set(targets.map(target => target.accessibleLabel)).size).toBe(2);
  });

  it('offers the composer catalog in the composer order, availability aside', () => {
    const registry = fallbackAgentSourceRegistry('launch');
    registry.sources = registry.sources.map(source => ({
      ...source,
      launchable: source.harness === 'codex',
    }));
    const codex = registry.sources.find(source => source.harness === 'codex')!;
    const catalogs = {
      codex: {
        harness: 'codex' as const,
        effectiveModel: 'gpt-5.6-sol',
        effectiveModelLabel: 'GPT-5.6 Codex',
        effectiveModelSource: 'config' as const,
        effectiveEffort: 'medium',
        effectiveEffortLabel: 'Medium',
        effectiveEffortSource: 'config' as const,
        effortLocked: false,
        models: [],
        catalogMode: 'configured-values' as const,
        catalogProvenance: 'test',
        observedAt: 1,
        selectionAction: null,
      },
    };
    const sources = launchSourceSnapshots(registry);
    const composed = composeLaunchTargets({
      ranked: [
        createAgentLaunchConfiguration(
          { sourceId: codex.id, modelId: 'gpt-5.6-sol', effort: 'high' },
          0
        ),
      ],
      sources,
      catalogs,
    });

    expect(
      availableSessionCloneTargets(
        registry,
        [
          createAgentLaunchConfiguration(
            { sourceId: codex.id, modelId: 'gpt-5.6-sol', effort: 'high' },
            0
          ),
        ],
        catalogs
      ).map(target => target.id)
    ).toEqual(composed.map(target => target.id));
  });
});
