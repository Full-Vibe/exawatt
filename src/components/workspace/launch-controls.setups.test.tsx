import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emptyLaunchConfigurationPool,
  launchConfigurationId,
  recordLaunchConfigurationSuccess,
  saveNamedLaunchConfiguration,
  type AgentLaunchConfigurationInput,
  type LaunchConfigurationPoolV1,
} from '@exawatt/core';
import type { AgentModelCatalog } from '@exawatt/core/desktop-bridge';
import { installBridgeDouble } from '@/test-support/desktop-bridge-double';
import { fallbackAgentSourceRegistry } from './agent-sources';
import {
  AgentComposer,
  CLAUDE_MODEL_CATALOG,
  CODEX_MODEL_CATALOG,
  GROK_MODEL_CATALOG,
  OPENCODE_MODEL_CATALOG,
  chooseLauncherAxis,
  installComposerTestHarness,
  launcherAxis,
  readyAgentSourceRegistry,
  renderComposer,
  settled,
} from './launch-controls.test-support';

/**
 * Setups and the effort axis in the New Agent window (BUG-334, amended
 * 2026-11-05): a named setup is its own identity, and the effort a model
 * change carries is only one the operator chose.
 */

const claudeSourceId = fallbackAgentSourceRegistry('launch').sources.find(
  source => source.harness === 'claude'
)!.id;

const effortOption = (id: string, label: string) => ({
  id,
  label,
  description: `${label} reasoning.`,
});

/** Claude with a third model, so a model change can land on one that no
 *  setup and no choice ever showed an effort for. */
const CLAUDE_THREE_MODELS: AgentModelCatalog = {
  ...CLAUDE_MODEL_CATALOG,
  models: [
    ...CLAUDE_MODEL_CATALOG.models,
    {
      id: 'haiku',
      label: 'Haiku',
      description: 'Fast Claude model.',
      defaultEffort: 'low',
      efforts: [
        effortOption('low', 'Low'),
        effortOption('medium', 'Medium'),
        effortOption('high', 'High'),
        effortOption('max', 'Max'),
      ],
    },
  ],
};

const sonnet = (effort: string): AgentLaunchConfigurationInput => ({
  sourceId: claudeSourceId,
  modelId: 'sonnet',
  effort,
});

function installPool(pool: LaunchConfigurationPoolV1) {
  const settings = {
    get: vi.fn().mockResolvedValue({ launchConfigurations: pool }),
    setAttentionNotifications: vi.fn(),
    recordAgentSourceUse: vi.fn().mockResolvedValue({}),
    setAgentPermissionMode: vi.fn().mockResolvedValue({}),
    onChanged: vi.fn(() => vi.fn()),
    recordLaunchConfigurationSuccess: vi
      .fn()
      .mockResolvedValue({ launchConfigurations: pool }),
    saveNamedLaunchConfiguration: vi.fn(
      async (configuration: AgentLaunchConfigurationInput, name: string) => ({
        launchConfigurations: saveNamedLaunchConfiguration(
          pool,
          configuration,
          name,
          5
        ),
      })
    ),
  };
  const catalogs: Record<string, AgentModelCatalog> = {
    claude: CLAUDE_THREE_MODELS,
    codex: CODEX_MODEL_CATALOG,
    opencode: OPENCODE_MODEL_CATALOG,
    grok: GROK_MODEL_CATALOG,
  };
  installBridgeDouble({
    platform: 'darwin',
    settings,
    pty: {
      listAgentModels: vi.fn(
        async (harness: string) => catalogs[harness] ?? CLAUDE_THREE_MODELS
      ),
      listRecentConversations: vi.fn().mockResolvedValue([]),
    },
    agentSources: {
      list: vi.fn(async () => readyAgentSourceRegistry()),
      remembered: vi.fn(async () => null),
      act: vi.fn(async () => ({ ok: true, message: 'Source action opened.' })),
    },
  });
  return settings;
}

function chip(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-setup-id="${CSS.escape(id)}"]`
  );
  if (!element) throw new Error(`No setup chip ${id}`);
  return element;
}

describe('Agent composer · setups and the effort axis', () => {
  installComposerTestHarness();
  let pool: LaunchConfigurationPoolV1;

  beforeEach(() => {
    pool = recordLaunchConfigurationSuccess(
      emptyLaunchConfigurationPool(),
      '/project',
      sonnet('medium'),
      1
    );
  });

  it('never carries an effort chosen for one setup into a model change after another setup was picked', async () => {
    installPool(pool);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        initialSource="claude"
        onLaunch={vi.fn(async () => true)}
      />
    );
    // Max is chosen on the Thinking axis for Fable.
    await chooseLauncherAxis('Thinking', /Max.*Maximum reasoning/i);
    await settled(() =>
      expect(launcherAxis('Thinking')).toHaveAccessibleName('Thinking: Max')
    );
    // Then the Sonnet · Medium setup is picked: Medium is showing.
    fireEvent.click(chip(launchConfigurationId(sonnet('medium'))));
    await settled(() =>
      expect(launcherAxis('Thinking')).toHaveAccessibleName('Thinking: Medium')
    );
    // A model change takes Haiku's own default, never the Max chosen for
    // the earlier setup (review finding 2).
    await chooseLauncherAxis('Model', /Haiku/);
    await settled(() =>
      expect(launcherAxis('Model')).toHaveAccessibleName('Model: Haiku')
    );
    expect(launcherAxis('Thinking')).toHaveAccessibleName('Thinking: Low');
  });

  it('credits a named setup only while the draft starts it exactly', async () => {
    pool = saveNamedLaunchConfiguration(pool, sonnet('high'), 'Deep work', 2);
    pool = recordLaunchConfigurationSuccess(
      pool,
      '/project',
      { ...sonnet('high'), name: 'Deep work' },
      3
    );
    const settings = installPool(pool);
    const onLaunch = vi.fn(async () => true);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        initialSource="claude"
        onLaunch={onLaunch}
      />
    );
    const deepWork = launchConfigurationId({
      ...sonnet('high'),
      name: 'Deep work',
    });
    await settled(() => expect(chip(deepWork)).toBeInTheDocument());
    fireEvent.click(chip(deepWork));
    await settled(() =>
      expect(chip(deepWork)).toHaveAttribute('aria-checked', 'true')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await settled(() =>
      expect(settings.recordLaunchConfigurationSuccess).toHaveBeenCalledWith(
        '/project',
        expect.objectContaining({
          modelId: 'sonnet',
          effort: 'high',
          name: 'Deep work',
        })
      )
    );

    // The same setup with its effort changed is the model's unnamed
    // configuration: the setup is no longer the selection, and the launch
    // names nothing, so it can never re-effort "Deep work".
    fireEvent.click(chip(deepWork));
    await chooseLauncherAxis('Thinking', /Low.*Fast/i);
    await settled(() =>
      expect(chip(deepWork)).toHaveAttribute('aria-checked', 'false')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await settled(() =>
      expect(settings.recordLaunchConfigurationSuccess).toHaveBeenLastCalledWith(
        '/project',
        expect.objectContaining({ modelId: 'sonnet', effort: 'low' })
      )
    );
    expect(
      settings.recordLaunchConfigurationSuccess.mock.lastCall?.[1]
    ).not.toHaveProperty('name');
  });

  it('names a setup in the app’s own dialog, never window.prompt', async () => {
    const settings = installPool(pool);
    const prompt = vi.spyOn(window, 'prompt');
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        initialSource="claude"
        onLaunch={vi.fn(async () => true)}
      />
    );
    const trigger = await settled(() => {
      const element = document.querySelector<HTMLButtonElement>(
        '[data-launch-options-trigger]'
      );
      expect(element).not.toBeNull();
      return element!;
    });
    fireEvent.click(trigger);
    const nameSetup = await settled(() =>
      screen.getByRole('button', { name: 'Name setup…' })
    );
    await settled(() => expect(nameSetup).toBeEnabled());
    fireEvent.click(nameSetup);
    const field = await settled(() =>
      screen.getByRole('textbox', { name: 'Name' })
    );
    fireEvent.change(field, { target: { value: 'Reviewer' } });
    fireEvent.submit(field.closest('form')!);
    await settled(() =>
      expect(settings.saveNamedLaunchConfiguration).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: claudeSourceId }),
        'Reviewer'
      )
    );
    await settled(() =>
      expect(document.querySelector('[data-setup-name-dialog]')).toBeNull()
    );
    expect(prompt).not.toHaveBeenCalled();
  });
});
