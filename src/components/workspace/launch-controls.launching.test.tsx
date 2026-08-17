import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ExawattSettings } from '@/types/electron';
import {
  AgentComposer,
  FOCUS_AGENT_COMPOSER_EVENT,
  chooseLauncherAxis,
  composerReady,
  installComposerTestHarness,
  launcherAxis,
  openSetupDrawer,
  renderComposer,
  setupDrawerHandle,
  startButton,
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

    await openSetupDrawer();
    await waitFor(() =>
      expect(launcherAxis('Model')).toHaveTextContent('Claude Fable 5 · 1M')
    );
    fireEvent.change(screen.getByLabelText('Initial task for the new Agent'), {
      target: { value: 'Review the auth flow' },
    });
    const start = startButton();
    expect(start).toHaveAttribute('data-launcher-start');
    expect(start).toHaveAttribute('type', 'submit');
    expect(start).not.toHaveAttribute('data-r3f-keyswitch-control');
    expect(start).not.toHaveAttribute('tabindex', '-1');
    start.focus();
    expect(start).toHaveFocus();
    fireEvent.click(start);

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
    const catalog = screen.getByRole('button', {
      name: 'All engines and models',
    });
    await waitFor(() => expect(catalog).not.toBeDisabled());
    fireEvent.click(catalog);
    fireEvent.click(screen.getByRole('button', { name: 'Shell in Project' }));
    await waitFor(() =>
      expect(onLaunch).toHaveBeenCalledWith({
        harness: 'shell',
        dir: '/project',
      })
    );
  });

  it('opens Shell immediately when the command palette requests it', async () => {
    const onLaunch = vi.fn(async () => true);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={onLaunch}
      />
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(FOCUS_AGENT_COMPOSER_EVENT, {
          detail: { configuration: { kind: 'shell' } },
        })
      );
    });

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
    await composerReady();
    fireEvent.change(screen.getByLabelText('Initial task for the new Agent'), {
      target: { value: '   ' },
    });
    fireEvent.click(startButton());

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

    await openSetupDrawer();
    await waitFor(() =>
      expect(launcherAxis('Permission')).toHaveTextContent('Ask first')
    );
    await chooseLauncherAxis('Engine', /^Codex/);
    await waitFor(() =>
      expect(launcherAxis('Model')).toHaveTextContent('GPT-5.6-Sol')
    );
    expect(launcherAxis('Permission')).toHaveTextContent('Auto-review');
    fireEvent.click(startButton());

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

    // An unsettled launcher offers no setup to adjust and no Start to press.
    // The pre-D49 row said this with a `···` permission chip; D49 says it by
    // refusing both controls, which is the contract that ships.
    expect(setupDrawerHandle()).toBeDisabled();
    expect(startButton()).toBeDisabled();

    resolveSettings?.({
      agentSources: {
        projectLastUsed: {},
        sourceRecency: {},
        projectPermissionModes: {
          '/project': { claude: 'prompt' },
        },
      },
    });

    // Permission resolution and the readiness gate are distinct state
    // updates. Wait for the user-visible control contract, not its first paint.
    await waitFor(() => expect(startButton()).not.toBeDisabled());
    expect(onLaunch).not.toHaveBeenCalled();

    // The restored policy is the one that launches — asserted through the
    // launch itself rather than a chip, because the launch is the contract.
    fireEvent.click(startButton());
    await waitFor(() =>
      expect(onLaunch).toHaveBeenCalledWith(
        expect.objectContaining({ permissionMode: 'prompt' })
      )
    );
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

    await openSetupDrawer();
    await waitFor(() =>
      expect(launcherAxis('Permission')).toHaveTextContent('Ask first')
    );

    fireEvent.click(startButton());
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

    await openSetupDrawer();
    await waitFor(() =>
      expect(launcherAxis('Permission')).toHaveTextContent('Ask first')
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
    await openSetupDrawer();
    await waitFor(() =>
      expect(launcherAxis('Model')).toHaveTextContent('Claude Fable 5 · 1M')
    );

    await chooseLauncherAxis('Permission', /Auto-review/);
    await waitFor(() =>
      expect(setAgentPermissionMode).toHaveBeenCalledWith(
        '/project',
        'claude',
        'auto'
      )
    );

    await chooseLauncherAxis('Engine', /^Codex/);
    await waitFor(() =>
      expect(launcherAxis('Model')).toHaveTextContent('GPT-5.6-Sol')
    );
    expect(launcherAxis('Permission')).toHaveTextContent('YOLO');
    await chooseLauncherAxis('Permission', /Ask first/);
    await waitFor(() =>
      expect(setAgentPermissionMode).toHaveBeenCalledWith(
        '/project',
        'codex',
        'prompt'
      )
    );

    await chooseLauncherAxis('Engine', /^Claude Code/);
    await waitFor(() =>
      expect(launcherAxis('Model')).toHaveTextContent('Claude Fable 5 · 1M')
    );
    expect(launcherAxis('Permission')).toHaveTextContent('Auto-review');
    await chooseLauncherAxis('Engine', /^Codex/);
    await waitFor(() =>
      expect(launcherAxis('Model')).toHaveTextContent('GPT-5.6-Sol')
    );
    expect(launcherAxis('Permission')).toHaveTextContent('Ask first');
    expect(onLaunch).not.toHaveBeenCalled();
  });
});
