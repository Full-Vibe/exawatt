import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  AgentComposer,
  composerReady,
  installComposerTestHarness,
  renderComposer,
  settled,
} from './launch-controls.test-support';

describe('Agent composer · recent conversations', () => {
  installComposerTestHarness();

  it('shows full recent IDs and resumes the selected conversation immediately', async () => {
    const conversation = {
      id: '6e3a2161-9d9c-445e-85a4-cca87896b071',
      harness: 'claude' as const,
      cwd: '/project',
      startedAt: Date.now() - 20_000,
      updatedAt: Date.now() - 10_000,
      title: 'client-side-deidentification-mmhc',
      description: 'Keep identifiers out of the browser boundary.',
      titleSource: 'native' as const,
      needsSummary: false,
      providerSessionId: '6e3a2161-9d9c-445e-85a4-cca87896b071',
      continuation: { kind: 'provider' as const },
    };
    window.electron!.pty!.listRecentConversations = vi
      .fn()
      .mockResolvedValue([conversation]);
    const onLaunch = vi.fn(async () => true);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={onLaunch}
      />
    );
    await settled(() =>
      expect(screen.getByText(conversation.id)).toBeInTheDocument()
    );
    await composerReady();

    const task = screen.getByLabelText('Initial task for the new Agent');
    fireEvent.keyDown(task, { key: 'ArrowDown' });
    expect(
      screen.getByRole('button', {
        name: `Resume ${conversation.title} in Claude Code`,
      })
    ).toHaveFocus();
    fireEvent.click(document.activeElement!);

    await settled(() =>
      expect(onLaunch).toHaveBeenCalledWith({
        harness: 'claude',
        dir: '/project',
        permissionMode: 'unrestricted',
        resumeSessionId: conversation.id,
        statedTask: conversation.description,
      })
    );
  });

  it('seeds only a validated generated label as the resumed goal subtitle', async () => {
    const conversation = {
      id: 'codex-provider-id',
      harness: 'codex' as const,
      cwd: '/project',
      startedAt: 1,
      updatedAt: 2,
      title: 'Verify E&M codes use AMA guidelines',
      description:
        'Are your E&M codes built on the premise of the AMA guidelines?',
      titleSource: 'generated' as const,
      needsSummary: false,
      continuation: { kind: 'provider' as const },
    };
    window.electron!.pty!.listRecentConversations = vi
      .fn()
      .mockResolvedValue([conversation]);
    const onLaunch = vi.fn(async () => true);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={onLaunch}
      />
    );

    await composerReady();
    fireEvent.click(
      await settled(() =>
        screen.getByRole('button', {
          name: `Resume ${conversation.title} in Codex`,
        })
      )
    );

    await settled(() =>
      expect(onLaunch).toHaveBeenCalledWith({
        harness: 'codex',
        dir: '/project',
        permissionMode: 'unrestricted',
        resumeSessionId: conversation.id,
        statedTask: conversation.description,
        restoredSubtitle: conversation.title,
      })
    );
  });

  it('reopens a Project Session recent without spawning another provider process', async () => {
    const conversation = {
      id: 'provider-session-id',
      harness: 'codex' as const,
      cwd: '/project',
      startedAt: 1,
      updatedAt: 2,
      title: 'Finalize website migration and App resubmit',
      description: 'Finish the existing Project handoff.',
      titleSource: 'generated' as const,
      needsSummary: false,
      providerSessionId: null,
      continuation: {
        kind: 'exawatt-session' as const,
        durableSessionId: 'durable-session-id',
      },
    };
    window.electron!.pty!.listRecentConversations = vi
      .fn()
      .mockResolvedValue([conversation]);
    const onLaunch = vi.fn(async () => true);
    const onReopenConversation = vi.fn(async () => true);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={onLaunch}
        onReopenConversation={onReopenConversation}
      />
    );

    const reopen = await settled(() =>
      screen.getByRole('button', {
        name: `Reopen ${conversation.title} in Exawatt`,
      })
    );
    await settled(() => expect(reopen).not.toBeDisabled());
    fireEvent.click(reopen);

    await settled(() =>
      expect(onReopenConversation).toHaveBeenCalledWith('durable-session-id')
    );
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it('migrates an exact saved Project Session into the current draft in one click', async () => {
    const conversation = {
      id: 'provider-session-id',
      providerSessionId: 'provider-session-id',
      harness: 'codex' as const,
      cwd: '/project-wt/privacy-pass',
      startedAt: 1,
      updatedAt: 2,
      title: 'Continue the privacy worktree',
      description: 'Verify the client boundary.',
      titleSource: 'generated' as const,
      needsSummary: false,
      continuation: {
        kind: 'exawatt-session' as const,
        durableSessionId: 'durable-session-id',
      },
    };
    window.electron!.pty!.listRecentConversations = vi
      .fn()
      .mockResolvedValue([conversation]);
    const onLaunch = vi.fn(async () => true);
    const onReopenConversation = vi.fn(async () => true);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={onLaunch}
        onReopenConversation={onReopenConversation}
      />
    );

    const resume = await settled(() =>
      screen.getByRole('button', {
        name: `Resume ${conversation.title} in Codex`,
      })
    );
    await settled(() => expect(resume).not.toBeDisabled());
    fireEvent.click(resume);

    await settled(() =>
      expect(onLaunch).toHaveBeenCalledWith({
        harness: 'codex',
        dir: conversation.cwd,
        permissionMode: 'unrestricted',
        resumeSessionId: conversation.providerSessionId,
        statedTask: conversation.description,
        restoredSubtitle: conversation.title,
        restoreSessionId: 'durable-session-id',
      })
    );
    expect(onReopenConversation).not.toHaveBeenCalled();
  });

  it('does not discover recents while a saved draft is hiding the browser', async () => {
    const list = vi.fn().mockResolvedValue([]);
    window.electron!.pty!.listRecentConversations = list;
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        initialTask="Already composing"
        onLaunch={vi.fn(async () => true)}
      />
    );
    await composerReady();
    expect(list).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Initial task for the new Agent'), {
      target: { value: '' },
    });
    await settled(() => expect(list).toHaveBeenCalledTimes(1));
  });

  it('renders every Project recent and traverses the full list with arrows', async () => {
    const conversations = Array.from({ length: 12 }, (_, index) => ({
      id: `recent-provider-id-${index}`,
      harness: (index % 2 === 0 ? 'claude' : 'codex') as 'claude' | 'codex',
      cwd: '/project',
      startedAt: Date.now() - index * 1_000,
      updatedAt: Date.now() - index * 1_000,
      title: `Recent conversation ${index + 1}`,
      description: `Handoff ${index + 1}`,
      titleSource: 'native' as const,
      needsSummary: false,
      providerSessionId: `recent-provider-id-${index}`,
      continuation: { kind: 'provider' as const },
    }));
    window.electron!.pty!.listRecentConversations = vi
      .fn()
      .mockResolvedValue(conversations);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={vi.fn(async () => true)}
      />
    );

    await settled(() => screen.getByText('recent-provider-id-11'));
    expect(screen.queryByText(/View all/i)).not.toBeInTheDocument();
    const filter = screen.getByLabelText('Filter recent conversations');
    expect(filter).toBeInTheDocument();

    const task = screen.getByLabelText('Initial task for the new Agent');
    fireEvent.keyDown(task, { key: 'ArrowDown' });
    const first = screen.getByRole('button', {
      name: 'Resume Recent conversation 1 in Claude Code',
    });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(task).toHaveFocus();

    fireEvent.keyDown(task, { key: 'ArrowDown' });
    for (let index = 1; index < conversations.length; index += 1) {
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    }
    const last = screen.getByRole('button', {
      name: 'Resume Recent conversation 12 in Codex',
    });
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: 'ArrowDown' });
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: 'Home' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'End' });
    expect(last).toHaveFocus();

    const lastFresh = screen.getByRole('button', {
      name: 'Start fresh from Recent conversation 12',
    });
    lastFresh.focus();
    fireEvent.keyDown(lastFresh, { key: 'Home' });
    expect(first).toHaveFocus();

    filter.focus();
    fireEvent.change(filter, { target: { value: 'conversation 12' } });
    fireEvent.keyDown(filter, { key: 'ArrowDown' });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: 'Escape' });
    expect(task).toHaveFocus();
  });

  it('makes a fresh handoff distinct and hides recents while composing', async () => {
    const conversation = {
      id: 'codex-session-id',
      harness: 'codex' as const,
      cwd: '/project',
      startedAt: 1,
      updatedAt: 2,
      title: 'Cortex Intake Refactor',
      description: 'Finish the consent-state cleanup.',
      titleSource: 'generated' as const,
      needsSummary: false,
      providerSessionId: 'codex-session-id',
      continuation: { kind: 'provider' as const },
    };
    window.electron!.pty!.listRecentConversations = vi
      .fn()
      .mockResolvedValue([conversation]);
    const onLaunch = vi.fn(async () => true);
    renderComposer(
      <AgentComposer
        projectDir="/project"
        projectName="Project"
        onLaunch={onLaunch}
      />
    );
    const fresh = await settled(() =>
      screen.getByRole('button', {
        name: `Start fresh from ${conversation.title}`,
      })
    );
    fireEvent.click(fresh);
    await settled(() =>
      expect(onLaunch).toHaveBeenCalledWith(
        expect.objectContaining({
          harness: 'codex',
          initialPrompt: expect.stringContaining('codex-session-id'),
        })
      )
    );

    fireEvent.change(screen.getByLabelText('Initial task for the new Agent'), {
      target: { value: 'Start an unrelated task' },
    });
    expect(screen.queryByText(conversation.id)).not.toBeInTheDocument();
  });
});
