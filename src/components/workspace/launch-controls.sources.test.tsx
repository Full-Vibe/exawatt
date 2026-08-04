import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AgentModelCatalog } from '@/types/electron';
import {
  AgentComposer,
  CLAUDE_MODEL_CATALOG,
  CODEX_MODEL_CATALOG,
  FOCUS_AGENT_COMPOSER_EVENT,
  installComposerTestHarness,
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

    const sourceTrigger = screen.getByLabelText('Agent Source');
    await waitFor(() => expect(sourceTrigger).not.toBeDisabled());
    await waitFor(() =>
      expect(screen.getByLabelText('Agent model')).toHaveTextContent(
        'Claude Fable 5 · 1M'
      )
    );
    expect(
      sourceTrigger.querySelectorAll('[data-slot="harness-glyph"]')
    ).toHaveLength(1);

    fireEvent.click(sourceTrigger);
    const claudeOption = screen.getByRole('option', { name: 'Claude Code' });
    const codexOption = screen.getByRole('option', { name: 'Codex' });
    const opencodeOption = screen.getByRole('option', { name: 'OpenCode' });
    for (const option of [claudeOption, codexOption, opencodeOption]) {
      expect(
        option.querySelectorAll('[data-slot="harness-glyph"]')
      ).toHaveLength(1);
      expect(
        option.querySelectorAll('[data-source-identity-mark]')
      ).toHaveLength(1);
    }
    expect(codexOption).not.toHaveStyle({ color: '#ECECEC' });
    expect(
      codexOption.querySelector('[data-source-identity-mark]')
    ).toHaveStyle({ color: '#ECECEC', background: '#111820' });
    fireEvent.click(codexOption);

    await waitFor(() => expect(sourceTrigger).toHaveTextContent('Codex'));
    await waitFor(() =>
      expect(screen.getByLabelText('Agent model')).toHaveTextContent(
        'GPT-5.6-Sol'
      )
    );
    expect(
      sourceTrigger.querySelectorAll('[data-slot="harness-glyph"]')
    ).toHaveLength(1);
    expect(sourceTrigger).not.toHaveStyle({ color: '#ECECEC' });
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

    const modelTrigger = screen.getByLabelText('Agent model');
    const effortTrigger = screen.getByLabelText('Agent effort');
    await waitFor(() => expect(modelTrigger).toHaveTextContent('GPT-5.6-Sol'));
    await waitFor(() => expect(effortTrigger).toHaveTextContent('Extra high'));
    expect(modelTrigger).toHaveAttribute(
      'title',
      expect.stringContaining('Default from Codex config')
    );

    fireEvent.click(modelTrigger);
    fireEvent.click(
      screen.getByRole('option', {
        name: /GPT-5\.6-Terra.*Balanced coding model/i,
      })
    );
    expect(modelTrigger).toHaveTextContent('GPT-5.6-Terra');
    expect(effortTrigger).toHaveTextContent('Medium');
    fireEvent.click(modelTrigger);
    expect(
      screen.getByText('This override applies only to this Agent.')
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.click(effortTrigger);
    fireEvent.click(
      screen.getByRole('option', {
        name: /Max.*Maximum reasoning/i,
      })
    );
    expect(effortTrigger).toHaveTextContent('Max');
    fireEvent.click(effortTrigger);
    expect(
      screen.getByText('This override applies only to this Agent.')
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });

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
    window.electron!.pty!.listAgentModels = vi.fn(
      async () => sourceOwnedClaude
    );
    const onLaunch = vi.fn(async () => true);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={onLaunch}
      />
    );

    const modelAction = await screen.findByRole('button', {
      name: 'Agent model: Account default. Choose in Claude Code',
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

    const modelTrigger = screen.getByLabelText('Agent model');
    await waitFor(() =>
      expect(modelTrigger).toHaveTextContent('GPT-5.6-Terra')
    );
    expect(onDraftChange).toHaveBeenCalledWith({
      draftModel: 'gpt-5.6-terra',
      draftEffort: 'high',
    });
    expect(screen.getByLabelText('Agent effort')).toHaveTextContent('High');
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
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        initialSource="codex"
        initialModel="gpt-5.6-terra"
        initialEffort="max"
        onLaunch={vi.fn(async () => true)}
      />
    );

    const sourceTrigger = screen.getByLabelText('Agent Source');
    await waitFor(() => {
      expect(sourceTrigger).not.toBeDisabled();
      expect(sourceTrigger).toHaveTextContent('Codex');
    });
    fireEvent.click(sourceTrigger);
    fireEvent.click(screen.getByRole('option', { name: 'Claude Code' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Agent model')).toHaveTextContent(
        'Claude Fable 5 · 1M'
      )
    );

    await act(async () => resolveCodex(CODEX_MODEL_CATALOG));
    expect(screen.getByLabelText('Agent Source')).toHaveTextContent(
      'Claude Code'
    );
    expect(screen.getByLabelText('Agent model')).toHaveTextContent(
      'Claude Fable 5 · 1M'
    );
    expect(screen.getByLabelText('Agent effort')).toHaveTextContent(
      'Extra high'
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
    await waitFor(() =>
      expect(screen.getByLabelText('Agent permissions')).toHaveTextContent(
        'Ask'
      )
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(FOCUS_AGENT_COMPOSER_EVENT, { detail: 'codex' })
      );
    });

    await waitFor(() =>
      expect(screen.getByLabelText('Agent Source')).toHaveTextContent('Codex')
    );
    expect(screen.getByLabelText('Agent permissions')).toHaveTextContent(
      'Auto'
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText('Initial task for the new Agent')
      ).toHaveFocus()
    );
  });

});
