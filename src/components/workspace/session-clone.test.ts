import { describe, expect, it } from 'vitest';
import {
  availableSessionCloneTargets,
  sessionClonePrompt,
  tabCanClone,
} from './session-clone';
import type { WorkspaceTab } from './use-workspace-state';
import { fallbackAgentSourceRegistry } from './agent-sources';

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
      }),
    ]);
  });
});
