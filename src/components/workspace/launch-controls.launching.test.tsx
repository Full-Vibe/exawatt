import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ExawattSettings } from '@/types/electron';
import {
  AgentComposer,
  installComposerTestHarness,
  renderComposer,
} from './launch-controls.test-support';

describe('Agent composer · launching', () => {
  const { recordAgentSourceUse, setAgentPermissionMode } =
    installComposerTestHarness();

  it('starts an Agent with an optional first task and remembers the source', async () => {
    const onLaunch = vi.fn(async () => true);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={onLaunch}
      />
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Agent permissions')).not.toBeDisabled()
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Agent model')).toHaveTextContent(
        'Claude Fable 5 · 1M'
      )
    );
    fireEvent.change(screen.getByLabelText('Initial task for the new Agent'), {
      target: { value: 'Review the auth flow' },
    });
    const startButton = screen.getByRole('button', { name: 'Start' });
    expect(startButton).toHaveAttribute('data-agent-start-button');
    expect(startButton).toHaveAttribute('type', 'submit');
    expect(startButton).not.toHaveAttribute('data-r3f-keyswitch-control');
    expect(startButton).not.toHaveAttribute('tabindex', '-1');
    startButton.focus();
    expect(startButton).toHaveFocus();
    fireEvent.click(startButton);

    await waitFor(() =>
      expect(onLaunch).toHaveBeenCalledWith({
        harness: 'claude',
        dir: '/project',
        permissionMode: 'unrestricted',
        model: 'claude-fable-5[1m]',
        effort: 'xhigh',
        initialPrompt: 'Review the auth flow',
        worktreeBranch: undefined,
        roadmapItemId: undefined,
      })
    );
    expect(recordAgentSourceUse).toHaveBeenCalledWith(
      '/project',
      'claude',
      expect.any(Number)
    );
    await waitFor(() =>
      expect(setAgentPermissionMode).toHaveBeenCalledWith(
        '/project',
        'claude',
        'unrestricted'
      )
    );
    // the task draft clears after a successful launch (D24: the composer
    // is the pane of a draft tab — the surface itself stays)
    expect(screen.getByLabelText('Initial task for the new Agent')).toHaveValue(
      ''
    );
  });

  it('keeps a shell launch separate from the Agent task', async () => {
    const onLaunch = vi.fn(async () => true);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={onLaunch}
      />
    );
    fireEvent.change(screen.getByLabelText('Initial task for the new Agent'), {
      target: { value: 'Do not send this to a shell' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Shell in Project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open shell' }));
    await waitFor(() =>
      expect(onLaunch).toHaveBeenCalledWith({
        harness: 'shell',
        dir: '/project',
      })
    );
  });

  it('starts an interactive Agent without an initial task argument', async () => {
    const onLaunch = vi.fn(async () => true);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={onLaunch}
      />
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Agent permissions')).not.toBeDisabled()
    );
    fireEvent.change(screen.getByLabelText('Initial task for the new Agent'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() =>
      expect(onLaunch).toHaveBeenCalledWith({
        harness: 'claude',
        dir: '/project',
        permissionMode: 'unrestricted',
        model: 'claude-fable-5[1m]',
        effort: 'xhigh',
        initialPrompt: undefined,
        worktreeBranch: undefined,
        roadmapItemId: undefined,
      })
    );
  });

  it('restores a distinct permission mode for each Project and harness', async () => {
    window.electron!.settings!.get = vi.fn().mockResolvedValue({
      agentSources: {
        projectLastUsed: { '/project': 'claude' },
        sourceRecency: { claude: 2, codex: 1 },
        projectPermissionModes: {
          '/project': { claude: 'prompt', codex: 'auto' },
        },
      },
    });
    const onLaunch = vi.fn(async () => true);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={onLaunch}
      />
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Agent permissions')).toHaveTextContent(
        'Ask'
      )
    );
    fireEvent.click(screen.getByLabelText('Agent Source'));
    fireEvent.click(screen.getByRole('option', { name: 'Codex' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Agent model')).toHaveTextContent(
        'GPT-5.6-Sol'
      )
    );
    expect(screen.getByLabelText('Agent permissions')).toHaveTextContent(
      'Auto'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() =>
      expect(onLaunch).toHaveBeenCalledWith(
        expect.objectContaining({
          harness: 'codex',
          dir: '/project',
          permissionMode: 'auto',
        })
      )
    );
    expect(setAgentPermissionMode).toHaveBeenCalledWith(
      '/project',
      'codex',
      'auto'
    );
  });

  it('blocks launch until the remembered Project policy is ready', async () => {
    let resolveSettings: ((value: ExawattSettings) => void) | undefined;
    window.electron!.settings!.get = vi.fn(
      () =>
        new Promise<ExawattSettings>(resolve => {
          resolveSettings = resolve;
        })
    );
    const onLaunch = vi.fn(async () => true);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={onLaunch}
      />
    );

    expect(screen.getByLabelText('Agent Source')).toBeDisabled();
    expect(screen.getByLabelText('Agent permissions')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(screen.getByLabelText('Agent permissions')).toHaveTextContent('···');

    resolveSettings?.({
      agentSources: {
        projectLastUsed: {},
        sourceRecency: {},
        projectPermissionModes: {
          '/project': { claude: 'prompt' },
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Agent permissions')).toHaveTextContent(
        'Ask'
      );
      // Permission copy and the readiness gate are distinct state updates.
      // Wait for the user-visible control contract, not only its first paint.
      expect(screen.getByRole('button', { name: 'Start' })).not.toBeDisabled();
    });
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it('uses a visible Ask first fallback when saved preferences cannot load', async () => {
    window.electron!.settings!.get = vi
      .fn()
      .mockRejectedValue(new Error('settings unavailable'));
    const onLaunch = vi.fn(async () => true);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={onLaunch}
      />
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Agent permissions')).toHaveTextContent(
        'Ask'
      )
    );
    expect(screen.getByLabelText('Agent permissions')).toHaveAttribute(
      'title',
      expect.stringContaining('Saved preferences were unavailable')
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() =>
      expect(onLaunch).toHaveBeenCalledWith(
        expect.objectContaining({ permissionMode: 'prompt' })
      )
    );
  });

  it('uses the same safe fallback when the settings bridge is unavailable', async () => {
    Reflect.deleteProperty(window.electron!.settings!, 'get');
    const onLaunch = vi.fn(async () => true);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={onLaunch}
      />
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Agent permissions')).toHaveTextContent(
        'Ask'
      )
    );
    expect(screen.getByLabelText('Agent permissions')).toHaveAttribute(
      'title',
      expect.stringContaining('Saved preferences were unavailable')
    );
  });

  it('persists permission changes immediately and keeps drafts per harness', async () => {
    const onLaunch = vi.fn(async () => true);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={onLaunch}
      />
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Agent permissions')).not.toBeDisabled()
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Agent model')).toHaveTextContent(
        'Claude Fable 5 · 1M'
      )
    );

    fireEvent.click(screen.getByLabelText('Agent permissions'));
    fireEvent.click(
      screen.getByRole('option', { name: /Auto-review.*routine work/i })
    );
    await waitFor(() =>
      expect(setAgentPermissionMode).toHaveBeenCalledWith(
        '/project',
        'claude',
        'auto'
      )
    );

    fireEvent.click(screen.getByLabelText('Agent Source'));
    fireEvent.click(screen.getByRole('option', { name: 'Codex' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Agent model')).toHaveTextContent(
        'GPT-5.6-Sol'
      )
    );
    expect(screen.getByLabelText('Agent permissions')).toHaveTextContent(
      'YOLO'
    );
    fireEvent.click(screen.getByLabelText('Agent permissions'));
    fireEvent.click(
      screen.getByRole('option', {
        name: /Ask first.*ask before sensitive actions/i,
      })
    );
    await waitFor(() =>
      expect(setAgentPermissionMode).toHaveBeenCalledWith(
        '/project',
        'codex',
        'prompt'
      )
    );

    fireEvent.click(screen.getByLabelText('Agent Source'));
    fireEvent.click(screen.getByRole('option', { name: 'Claude Code' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Agent model')).toHaveTextContent(
        'Claude Fable 5 · 1M'
      )
    );
    expect(screen.getByLabelText('Agent permissions')).toHaveTextContent(
      'Auto'
    );
    fireEvent.click(screen.getByLabelText('Agent Source'));
    fireEvent.click(screen.getByRole('option', { name: 'Codex' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Agent model')).toHaveTextContent(
        'GPT-5.6-Sol'
      )
    );
    expect(screen.getByLabelText('Agent permissions')).toHaveTextContent('Ask');
    expect(onLaunch).not.toHaveBeenCalled();
  });
});
