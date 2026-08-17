import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AgentModelCatalog } from '@/types/electron';
import {
  AgentComposer,
  chooseLauncherAxis,
  CLAUDE_MODEL_CATALOG,
  composerReady,
  expectSelectedSetup,
  installComposerTestHarness,
  launcherAxis,
  openSetupDrawer,
  renderComposer,
  settled,
  setupDrawerHandle,
} from './launch-controls.test-support';

describe('Agent composer · interactions and drafts', () => {
  installComposerTestHarness();

  it('recovers the controls when a launch request rejects', async () => {
    let rejectLaunch: ((error: Error) => void) | undefined;
    const onLaunch = vi.fn(
      () =>
        new Promise<boolean>((_resolve, reject) => {
          rejectLaunch = reject;
        })
    );
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={onLaunch}
      />
    );
    await composerReady();
    await expectSelectedSetup(/Claude Fable 5/);

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    const startingButton = screen.getByRole('button', { name: 'Starting…' });
    expect(startingButton).toBeDisabled();
    expect(startingButton).toHaveAttribute('aria-busy', 'true');
    rejectLaunch?.(new Error('IPC unavailable'));

    await settled(() =>
      expect(screen.getByRole('button', { name: 'Start' })).not.toBeDisabled()
    );
  });

  /**
   * BUG-041, the composer half. The workspace answers the first draft intent
   * by materialising the draft tab, which hands this composer the draft's
   * seeds IN PLACE — one element, reconciled, never remounted. The drawer the
   * operator is standing in has to survive that, seeds and all; it used to
   * close because the hand-off was a remount, and it must not start closing
   * again because some later effect resets on `initialSource` arriving.
   */
  it('keeps the open drawer and the chosen axis when the draft tab takes over the composer', async () => {
    const onDraftIntent = vi.fn();
    const view = renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={vi.fn(async () => true)}
        onDraftIntent={onDraftIntent}
      />
    );
    await composerReady();
    await openSetupDrawer();
    await chooseLauncherAxis('Engine', /^Codex/);
    await settled(() =>
      expect(launcherAxis('Model')).toHaveTextContent('GPT-5.6-Sol')
    );
    expect(onDraftIntent).toHaveBeenCalledWith(
      expect.objectContaining({ draftSource: 'codex', draftTouched: true })
    );
    expect(setupDrawerHandle()).toHaveAttribute('aria-expanded', 'true');

    view.rerender(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        initialSource="codex"
        initialModel="gpt-5.6-sol"
        initialEffort="low"
        onLaunch={vi.fn(async () => true)}
        onDraftChange={vi.fn()}
        onDraftIntent={vi.fn()}
      />
    );

    await settled(() =>
      expect(launcherAxis('Engine')).toHaveTextContent('Codex')
    );
    expect(setupDrawerHandle()).toHaveAttribute('aria-expanded', 'true');
    expect(launcherAxis('Model')).toHaveTextContent('GPT-5.6-Sol');
    expect(screen.getByLabelText('Initial task for the new Agent')).toHaveValue(
      ''
    );
  });

  it('focuses the goal field on mount (D21/D24)', async () => {
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={vi.fn(async () => true)}
      />
    );
    await settled(() =>
      expect(
        screen.getByLabelText('Initial task for the new Agent')
      ).toHaveFocus()
    );
  });

  it('launches the recommended source on a bare Enter (⌘T → ⏎)', async () => {
    let resolveModels: ((catalog: AgentModelCatalog) => void) | undefined;
    window.electron!.pty!.listAgentModels = vi.fn(
      () =>
        new Promise<AgentModelCatalog>(resolve => {
          resolveModels = resolve;
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
    // Models are still detecting on purpose: the launcher has NOT settled, so
    // the setup drawer stays shut while Start already accepts a bare Enter on
    // the recommended source.
    await settled(() =>
      expect(screen.getByRole('button', { name: 'Start' })).not.toBeDisabled()
    );
    fireEvent.keyDown(screen.getByLabelText('Initial task for the new Agent'), {
      key: 'Enter',
    });
    await settled(() =>
      expect(onLaunch).toHaveBeenCalledWith(
        expect.objectContaining({
          harness: 'claude',
          dir: '/project',
          initialPrompt: undefined,
          model: undefined,
          effort: undefined,
        })
      )
    );
    await act(async () => {
      resolveModels?.(CLAUDE_MODEL_CATALOG);
      await Promise.resolve();
    });
  });

  it('cycles the Agent Source with Option+arrows while the goal field is empty', async () => {
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={vi.fn(async () => true)}
      />
    );
    await composerReady();
    await expectSelectedSetup(/Claude Fable 5/);
    await settled(() =>
      screen.getByText(
        'No Claude Code, Codex, or OpenCode conversations found for this Project.'
      )
    );
    const task = screen.getByLabelText('Initial task for the new Agent');
    const selected = (name: RegExp) =>
      expect(screen.getByRole('radio', { name })).toHaveAttribute(
        'aria-checked',
        'true'
      );

    fireEvent.keyDown(task, { key: 'ArrowDown', altKey: true });
    selected(/Codex/);
    fireEvent.keyDown(task, { key: 'ArrowDown', altKey: true });
    selected(/OpenCode/);
    fireEvent.keyDown(task, { key: 'ArrowDown', altKey: true });
    selected(/Claude Code/);
    fireEvent.keyDown(task, { key: 'ArrowUp', altKey: true });
    selected(/OpenCode/);
    fireEvent.keyDown(task, { key: 'ArrowUp', altKey: true });
    selected(/Codex/);
    await expectSelectedSetup(/GPT-5\.6-Sol/);

    // with text present, arrows are caret keys — the source stays put
    fireEvent.change(task, { target: { value: 'Fix the intake flow' } });
    fireEvent.keyDown(task, { key: 'ArrowDown' });
    selected(/Codex/);
  });

  it('does not launch when Enter is confirming IME composition', async () => {
    const onLaunch = vi.fn(async () => true);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={onLaunch}
      />
    );
    await composerReady();
    await expectSelectedSetup(/Claude Fable 5/);
    const task = screen.getByLabelText('Initial task for the new Agent');

    fireEvent.keyDown(task, { key: 'Enter', isComposing: true });
    expect(onLaunch).not.toHaveBeenCalled();
    fireEvent.keyDown(task, { key: 'Enter' });
    await settled(() => expect(onLaunch).toHaveBeenCalledTimes(1));
  });

  it('restores a saved draft task on mount and survives the preferences load (D28)', async () => {
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        initialTask="Half-written task brief"
        onLaunch={vi.fn(async () => true)}
      />
    );
    const task = screen.getByLabelText('Initial task for the new Agent');
    expect(task).toHaveValue('Half-written task brief');
    // the preferences-load reset must restore the draft, not blank it
    await composerReady();
    expect(task).toHaveValue('Half-written task brief');
  });

  it('reports task and source edits to the draft tab (D28)', async () => {
    const onDraftChange = vi.fn();
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={vi.fn(async () => true)}
        onDraftChange={onDraftChange}
      />
    );
    await composerReady();
    await expectSelectedSetup(/Claude Fable 5/);
    await settled(() =>
      screen.getByText(
        'No Claude Code, Codex, or OpenCode conversations found for this Project.'
      )
    );
    const task = screen.getByLabelText('Initial task for the new Agent');
    fireEvent.change(task, { target: { value: 'Refactor the intake flow' } });
    expect(onDraftChange).toHaveBeenCalledWith({
      draftTask: 'Refactor the intake flow',
    });

    fireEvent.change(task, { target: { value: '' } });
    fireEvent.keyDown(task, { key: 'ArrowUp', altKey: true });
    fireEvent.keyDown(task, { key: 'ArrowUp', altKey: true });
    await settled(() =>
      expect(onDraftChange).toHaveBeenCalledWith(
        expect.objectContaining({
          draftSource: 'codex',
          draftModel: 'gpt-5.6-sol',
        })
      )
    );
    await settled(() =>
      screen.getByText(
        'No Claude Code, Codex, or OpenCode conversations found for this Project.'
      )
    );
  });

  it('separates operator intent from background composer hydration', async () => {
    const onDraftIntent = vi.fn();
    const onUserInteraction = vi.fn();
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={vi.fn(async () => true)}
        onDraftIntent={onDraftIntent}
        onUserInteraction={onUserInteraction}
      />
    );
    await expectSelectedSetup(/Claude Fable 5/);
    expect(onDraftIntent).not.toHaveBeenCalled();

    const task = screen.getByLabelText('Initial task for the new Agent');
    fireEvent.pointerDown(task);
    expect(onUserInteraction).toHaveBeenCalledTimes(1);
    fireEvent.change(task, { target: { value: 'Preserve this intent' } });
    expect(onDraftIntent).toHaveBeenCalledWith({
      draftTask: 'Preserve this intent',
      draftTouched: true,
    });
  });

  it('restores the complete draft launch configuration', async () => {
    const onLaunch = vi.fn(async () => true);
    const onDraftIntent = vi.fn();
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        initialWorktree
        initialBranch="agent/preserved-branch"
        initialRoadmapItemId="ENG-017"
        roadmapItems={[{ id: 'ENG-017', label: 'ENG-017 · UX hardening' }]}
        onLaunch={onLaunch}
        onDraftIntent={onDraftIntent}
      />
    );

    await composerReady();

    const catalogButton = screen.getByRole('button', {
      name: 'All engines and models',
    });
    // Settling deliberately disables the catalog trigger. Under suite load,
    // permissions can become ready first; clicking a disabled button is a
    // no-op, so wait for the interaction boundary rather than the unrelated
    // permission boundary (D52: a flaky check stops being trusted).
    await settled(() => expect(catalogButton).not.toBeDisabled());
    fireEvent.click(catalogButton);
    expect(
      await settled(() =>
        screen.getByRole('checkbox', { name: 'New git worktree' })
      )
    ).toBeChecked();
    expect(
      screen.getByLabelText('Branch name for the new worktree')
    ).toHaveValue('agent/preserved-branch');
    expect(
      screen.getByLabelText('Roadmap item this session will work on')
    ).toHaveValue('ENG-017');
    fireEvent.change(
      screen.getByLabelText('Branch name for the new worktree'),
      { target: { value: 'agent/revised-branch' } }
    );
    expect(onDraftIntent).toHaveBeenCalledWith({
      draftBranch: 'agent/revised-branch',
      draftTouched: true,
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'All engines and models' })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await settled(() =>
      expect(onLaunch).toHaveBeenCalledWith(
        expect.objectContaining({
          worktreeBranch: 'agent/revised-branch',
          roadmapItemId: 'ENG-017',
        })
      )
    );
  });

  // BUG-017: the composer carried two hint lines — the launcher's and an older
  // copy in launch-controls, same chords under drifted words. Counted over the
  // whole rendered surface, so hiding one would not satisfy it either.
  it('states each composer chord exactly once', async () => {
    const { container } = renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={vi.fn(async () => true)}
      />
    );
    await settled(() =>
      expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
    );
    const surface = container.textContent ?? '';
    for (const chord of [
      '⏎ start',
      '↓ recent',
      '⌥↑↓',
      '⇥ adjust',
      '⌘⌥T shell',
      '⌘V image',
      '⇧⏎ newline',
    ]) {
      expect(surface.split(chord).length - 1, chord).toBe(1);
    }
  });
});
