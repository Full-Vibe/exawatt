import { render } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';

import { fallbackAgentSourceRegistry } from './agent-sources';
import { AgentComposer } from './launch-controls';
import { FOCUS_AGENT_COMPOSER_EVENT } from './session-jump';
import type { AgentModelCatalog } from '@/types/electron';

export { AgentComposer, FOCUS_AGENT_COMPOSER_EVENT };

/** The composer is the always-open pane of a draft tab or empty Project
 *  (D24) — render is enough. */
export function renderComposer(ui: React.ReactElement) {
  return render(ui);
}

export function readyAgentSourceRegistry() {
  const registry = fallbackAgentSourceRegistry('launch');
  return {
    ...registry,
    observedAt: 1,
    sources: registry.sources.map(source => ({
      ...source,
      configured: true,
      launchable: true,
      state: 'ready' as const,
      stateLabel: 'Ready',
      observedAt: 1,
      actions: {
        ...source.actions,
        recheck: true,
      },
    })),
  };
}

const TEST_EFFORTS = [
  { id: 'low', label: 'Low', description: 'Fast responses.' },
  { id: 'medium', label: 'Medium', description: 'Balanced reasoning.' },
  { id: 'high', label: 'High', description: 'Deeper reasoning.' },
  { id: 'xhigh', label: 'Extra high', description: 'Very deep reasoning.' },
  { id: 'max', label: 'Max', description: 'Maximum reasoning.' },
];

export const CODEX_MODEL_CATALOG: AgentModelCatalog = {
  harness: 'codex',
  effectiveModel: 'gpt-5.6-sol',
  effectiveModelLabel: 'GPT-5.6-Sol',
  effectiveModelSource: 'config',
  effectiveEffort: 'xhigh',
  effectiveEffortLabel: 'Extra high',
  effectiveEffortSource: 'config',
  effortLocked: false,
  models: [
    {
      id: 'gpt-5.6-sol',
      label: 'GPT-5.6-Sol',
      description: 'Frontier coding model.',
      defaultEffort: 'low',
      efforts: TEST_EFFORTS,
    },
    {
      id: 'gpt-5.6-terra',
      label: 'GPT-5.6-Terra',
      description: 'Balanced coding model.',
      defaultEffort: 'medium',
      efforts: TEST_EFFORTS,
    },
  ],
  catalogMode: 'live-catalog',
  catalogProvenance: 'Installed Codex CLI',
  observedAt: 1,
  selectionAction: null,
};

export const CLAUDE_MODEL_CATALOG: AgentModelCatalog = {
  harness: 'claude',
  effectiveModel: 'claude-fable-5[1m]',
  effectiveModelLabel: 'Claude Fable 5 · 1M',
  effectiveModelSource: 'config',
  effectiveEffort: 'xhigh',
  effectiveEffortLabel: 'Extra high',
  effectiveEffortSource: 'config',
  effortLocked: false,
  models: [
    {
      id: 'claude-fable-5[1m]',
      label: 'Claude Fable 5 · 1M',
      description: 'Configured Claude model.',
      defaultEffort: 'auto',
      efforts: [
        {
          id: 'auto',
          label: 'Auto',
          description: 'Use the model default.',
        },
        ...TEST_EFFORTS,
      ],
    },
    {
      id: 'sonnet',
      label: 'Sonnet',
      description: 'Balanced Claude model.',
      defaultEffort: 'auto',
      efforts: [
        {
          id: 'auto',
          label: 'Auto',
          description: 'Use the model default.',
        },
        ...TEST_EFFORTS,
      ],
    },
  ],
  catalogMode: 'configured-values',
  catalogProvenance: 'Claude Code layered configuration',
  observedAt: 1,
  selectionAction: null,
};

export function installComposerTestHarness() {
  const recordAgentSourceUse = vi.fn();
  const setAgentPermissionMode = vi.fn();

  beforeEach(() => {
    recordAgentSourceUse.mockReset().mockResolvedValue({});
    setAgentPermissionMode.mockReset().mockResolvedValue({});
    window.electron = {
      isElectron: true,
      platform: 'darwin',
      settings: {
        get: vi.fn().mockResolvedValue({}),
        setAttentionNotifications: vi.fn(),
        recordAgentSourceUse,
        setAgentPermissionMode,
        onChanged: vi.fn(() => vi.fn()),
      },
      pty: {
        listAgentModels: vi.fn(async harness =>
          harness === 'codex' ? CODEX_MODEL_CATALOG : CLAUDE_MODEL_CATALOG
        ),
        listRecentConversations: vi.fn().mockResolvedValue([]),
      },
      agentSources: {
        list: vi.fn(async () => readyAgentSourceRegistry()),
        act: vi.fn(async () => ({
          ok: true,
          message: 'Source action opened.',
        })),
      },
    } as unknown as NonNullable<Window['electron']>;
  });

  return { recordAgentSourceUse, setAgentPermissionMode };
}
