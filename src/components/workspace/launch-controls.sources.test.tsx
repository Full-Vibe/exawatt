import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AgentModelCatalog } from '@/types/electron';
import {
  AgentComposer,
  chooseLauncherAxis,
  CLAUDE_MODEL_CATALOG,
  CODEX_MODEL_CATALOG,
  expectSelectedSetup,
  FOCUS_AGENT_COMPOSER_EVENT,
  GROK_MODEL_CATALOG,
  installComposerTestHarness,
  launcherAxis,
  OPENCODE_MODEL_CATALOG,
  openSetupDrawer,
  readyAgentSourceRegistry,
  renderComposer,
} from './launch-controls.test-support';

describe('Agent composer · sources and policy', () => {
  installComposerTestHarness();

  it('renders one harness brand in the source trigger and each option', async () => {
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={vi.fn(async () => true)}
      />
    );

    await openSetupDrawer();
    const engine = launcherAxis('Engine');
    await expectSelectedSetup(/Claude Fable 5/);
    expect(engine.querySelectorAll('[data-engine-glyph]')).toHaveLength(1);

    fireEvent.click(engine);
    const claudeOption = screen.getByRole('option', { name: /^Claude Code/ });
    const codexOption = screen.getByRole('option', { name: /^Codex/ });
    const opencodeOption = screen.getByRole('option', { name: /^OpenCode/ });
    for (const option of [claudeOption, codexOption, opencodeOption]) {
      expect(option.querySelectorAll('[data-engine-glyph]')).toHaveLength(1);
    }
    expect(codexOption).not.toHaveStyle({ color: '#ECECEC' });
    expect(codexOption.querySelector('[data-engine-glyph]')).toHaveStyle({
      color: '#ECECEC',
    });
    fireEvent.click(codexOption);

    await waitFor(() =>
      expect(launcherAxis('Engine')).toHaveTextContent('Codex')
    );
    await expectSelectedSetup(/GPT-5\.6-Sol/);
    expect(
      launcherAxis('Engine').querySelectorAll('[data-engine-glyph]')
    ).toHaveLength(1);
    expect(launcherAxis('Engine')).not.toHaveStyle({ color: '#ECECEC' });
  });

  it('shows model and effort together and scopes both overrides to this Agent', async () => {
    const onLaunch = vi.fn(async () => true);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        initialSource="codex"
        onLaunch={onLaunch}
      />
    );

    const drawer = screen.getByRole('button', {
      name: 'Adjust engine, model, thinking, permission',
    });
    await waitFor(() => expect(drawer).not.toBeDisabled());
    fireEvent.click(drawer);
    const modelTrigger = await screen.findByRole('button', {
      name: 'Model: GPT-5.6-Sol',
    });
    const effortTrigger = screen.getByRole('button', {
      name: 'Thinking: Extra high',
    });
    expect(
      screen.getByText('Changes apply to this Agent until you start it.')
    ).toBeInTheDocument();

    fireEvent.click(modelTrigger);
    fireEvent.click(
      screen.getByRole('option', {
        name: /GPT-5\.6-Terra.*Balanced coding model/i,
      })
    );
    await waitFor(() =>
      expect(modelTrigger).toHaveAccessibleName('Model: GPT-5.6-Terra')
    );
    expect(modelTrigger).toHaveTextContent('GPT-5.6-Terra');
    await waitFor(() =>
      expect(effortTrigger).toHaveAccessibleName('Thinking: Medium')
    );

    fireEvent.click(effortTrigger);
    fireEvent.click(
      screen.getByRole('option', {
        name: /Max.*Maximum reasoning/i,
      })
    );
    await waitFor(() =>
      expect(effortTrigger).toHaveAccessibleName('Thinking: Max')
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() =>
      expect(onLaunch).toHaveBeenCalledWith(
        expect.objectContaining({
          harness: 'codex',
          model: 'gpt-5.6-terra',
          effort: 'max',
        })
      )
    );
  });

  it('keeps an unknown Claude account default honest and routes selection to Claude Code', async () => {
    const sourceAction = vi.fn(async () => ({
      ok: true,
      message: 'Claude Code opened in Terminal.',
    }));
    window.electron!.agentSources = {
      list: vi.fn(async () => readyAgentSourceRegistry()),
      act: sourceAction,
    };
    const sourceOwnedClaude: AgentModelCatalog = {
      ...CLAUDE_MODEL_CATALOG,
      effectiveModel: null,
      effectiveModelLabel: 'Account default',
      effectiveModelSource: 'account-default',
      effectiveEffort: null,
      effectiveEffortLabel: 'Model default',
      effectiveEffortSource: 'unavailable',
      models: [],
      catalogMode: 'source-owned',
      selectionAction: 'choose-in-source',
    };
    window.electron!.pty!.listAgentModels = vi.fn(async harness =>
      harness === 'claude'
        ? sourceOwnedClaude
        : harness === 'codex'
          ? CODEX_MODEL_CATALOG
          : harness === 'grok'
            ? GROK_MODEL_CATALOG
            : OPENCODE_MODEL_CATALOG
    );
    const onLaunch = vi.fn(async () => true);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={onLaunch}
      />
    );

    const drawer = screen.getByRole('button', {
      name: 'Adjust engine, model, thinking, permission',
    });
    await waitFor(() => expect(drawer).not.toBeDisabled());
    fireEvent.click(drawer);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Model: Account default' })
    );
    const modelAction = await screen.findByRole('button', {
      name: 'Choose in Claude Code',
    });
    fireEvent.click(modelAction);
    await waitFor(() =>
      expect(sourceAction).toHaveBeenCalledWith('claude', 'choose-model')
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() =>
      expect(onLaunch).toHaveBeenCalledWith(
        expect.objectContaining({ model: undefined, effort: undefined })
      )
    );
  });

  it('shows OpenCode without a default and blocks launch until a model is chosen', async () => {
    const openCodeWithoutDefault: AgentModelCatalog = {
      ...OPENCODE_MODEL_CATALOG,
      effectiveModel: null,
      effectiveModelLabel: 'Source default',
      effectiveModelSource: 'unavailable',
      effectiveEffort: null,
      effectiveEffortLabel: 'Model default',
      effectiveEffortSource: 'unavailable',
    };
    window.electron!.pty!.listAgentModels = vi.fn(async harness =>
      harness === 'claude'
        ? CLAUDE_MODEL_CATALOG
        : harness === 'codex'
          ? CODEX_MODEL_CATALOG
          : harness === 'grok'
            ? GROK_MODEL_CATALOG
            : openCodeWithoutDefault
    );
    const onLaunch = vi.fn(async () => true);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        initialSource="opencode"
        onLaunch={onLaunch}
      />
    );

    const openCode = await screen.findByRole('radio', {
      name: /OpenCode/i,
    });
    await waitFor(() =>
      expect(openCode).toHaveAttribute('aria-checked', 'true')
    );
    expect(openCode).toHaveTextContent('Choose a model');
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(
      screen.getByText('Choose a model for OpenCode before starting.')
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Adjust engine, model, thinking, permission',
      })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Model: Choose a model' })
    );
    fireEvent.click(
      await screen.findByRole('option', { name: /Kimi K3.*OpenRouter/i })
    );
    const start = screen.getByRole('button', { name: 'Start' });
    await waitFor(() => expect(start).not.toBeDisabled());
    fireEvent.click(start);

    await waitFor(() =>
      expect(onLaunch).toHaveBeenCalledWith(
        expect.objectContaining({
          harness: 'opencode',
          model: 'openrouter/moonshotai/kimi-k3',
        })
      )
    );
  });

  it('restores and reports a model choice with the durable draft', async () => {
    const onDraftChange = vi.fn();
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        initialSource="codex"
        initialModel="gpt-5.6-terra"
        initialEffort="high"
        onLaunch={vi.fn(async () => true)}
        onDraftChange={onDraftChange}
      />
    );

    await openSetupDrawer();
    await waitFor(() =>
      expect(launcherAxis('Model')).toHaveTextContent('GPT-5.6-Terra')
    );
    expect(onDraftChange).toHaveBeenCalledWith({
      draftModel: 'gpt-5.6-terra',
      draftEffort: 'high',
    });
    expect(launcherAxis('Thinking')).toHaveTextContent('High');
  });

  it('does not carry pending model or effort choices across Agent Sources', async () => {
    let resolveCodex!: (catalog: AgentModelCatalog) => void;
    const pendingCodex = new Promise<AgentModelCatalog>(resolve => {
      resolveCodex = resolve;
    });
    vi.mocked(window.electron!.pty!.listAgentModels).mockImplementation(
      async harness =>
        harness === 'codex' ? pendingCodex : CLAUDE_MODEL_CATALOG
    );
    const onDraftChange = vi.fn();
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        initialSource="codex"
        initialModel="gpt-5.6-terra"
        initialEffort="max"
        onLaunch={vi.fn(async () => true)}
        onDraftChange={onDraftChange}
      />
    );

    // Codex's catalog never arrives, so the launcher never settles: the whole
    // setup row stays placeholders and the drawer stays shut. ⌥arrows are the
    // engine control that survives that state, and the reported draft is what
    // the composer would hand back — which is the thing that must not be
    // overwritten by a catalog that lands late.
    await screen.findByText(
      /No Claude Code, Codex, or OpenCode conversations found/
    );
    // The engine order only exists once the other sources have published their
    // catalogs, and nothing on screen announces that while the row is still
    // placeholders — so press the chord until the composer reports the move.
    await waitFor(() => {
      fireEvent.keyDown(
        screen.getByLabelText('Initial task for the new Agent'),
        { key: 'ArrowUp', altKey: true }
      );
      expect(
        onDraftChange.mock.calls.some(
          ([patch]) => patch?.draftSource && patch.draftSource !== 'codex'
        )
      ).toBe(true);
    });

    onDraftChange.mockClear();
    await act(async () => resolveCodex(CODEX_MODEL_CATALOG));
    expect(onDraftChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ draftSource: 'codex' })
    );
    expect(onDraftChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ draftModel: 'gpt-5.6-terra' })
    );
  });

  it('restores the selected harness policy when the palette focuses the composer', async () => {
    window.electron!.settings!.get = vi.fn().mockResolvedValue({
      agentSources: {
        projectLastUsed: { '/project': 'claude' },
        projectPermissionModes: {
          '/project': { claude: 'prompt', codex: 'auto' },
        },
      },
    });
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={vi.fn(async () => true)}
      />
    );
    await openSetupDrawer();
    await waitFor(() =>
      expect(launcherAxis('Permission')).toHaveTextContent('Ask first')
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(FOCUS_AGENT_COMPOSER_EVENT, { detail: 'codex' })
      );
    });

    await waitFor(() =>
      expect(launcherAxis('Engine')).toHaveTextContent('Codex')
    );
    expect(launcherAxis('Permission')).toHaveTextContent('Auto-review');
    await waitFor(() =>
      expect(
        screen.getByLabelText('Initial task for the new Agent')
      ).toHaveFocus()
    );
  });
});
