import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultShortcuts, shortcutRegistry } from '@/lib/shortcuts';
import {
  ResumeRecoveryBar,
  type ResumeRecoveryBarProps,
} from './resume-recovery-bar';

function props(
  overrides: Partial<ResumeRecoveryBarProps> = {}
): ResumeRecoveryBarProps {
  return {
    readyAgentCount: 5,
    reconnectableAgentCount: 0,
    activeProjectName: 'Exawatt',
    activeProjectReadyCount: 2,
    activeTabCanResume: true,
    progress: null,
    onResumeActiveTab: vi.fn(),
    onResumeActiveProject: vi.fn(),
    onResumeAll: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
}

describe('ResumeRecoveryBar', () => {
  beforeEach(() => {
    for (const definition of defaultShortcuts) {
      shortcutRegistry.register({ ...definition, action: vi.fn() });
    }
  });

  afterEach(() => {
    for (const definition of defaultShortcuts) {
      shortcutRegistry.unregister(definition.id);
    }
  });

  it('makes the selected Project the one-click relaunch scope', () => {
    const value = props();
    render(<ResumeRecoveryBar {...value} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      '5 agents paused · 2 in Exawatt'
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Resume 2 agents in Exawatt' })
    );

    expect(value.onResumeActiveProject).toHaveBeenCalledOnce();
    expect(value.onResumeAll).not.toHaveBeenCalled();
  });

  it('keeps Agent and all-Project recovery behind one scope menu', async () => {
    const value = props();
    render(<ResumeRecoveryBar {...value} />);

    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Choose resume scope' }),
      { button: 0, ctrlKey: false }
    );

    const agent = await screen.findByRole('menuitem', {
      name: 'Resume this agent',
    });
    expect(
      screen.getByRole('menuitem', {
        name: 'Resume 2 agents in this project',
      })
    ).toBeTruthy();
    expect(
      screen.getByRole('menuitem', { name: 'Resume all 5 agents' })
    ).toBeTruthy();

    fireEvent.click(agent);
    expect(value.onResumeActiveTab).toHaveBeenCalledOnce();

    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Choose resume scope' }),
      { button: 0, ctrlKey: false }
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Resume all 5 agents' })
    );
    expect(value.onResumeAll).toHaveBeenCalledOnce();
  });

  it('falls back to the remaining all-Project action after this Project resumes', () => {
    const value = props({
      readyAgentCount: 3,
      activeProjectReadyCount: 0,
      activeTabCanResume: false,
    });
    render(<ResumeRecoveryBar {...value} />);

    expect(
      screen.queryByRole('button', { name: 'Choose resume scope' })
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Resume all 3 agents' })
    );
    expect(value.onResumeAll).toHaveBeenCalledOnce();
  });

  // ENG-016 D36/D47 keyboard surface (operator, 2026-08-13). The bar is the
  // visible affordance; it must also TEACH the chord, or the chord is only
  // discoverable by reading the cheat sheet you did not know to open.
  it('teaches each scope its chord from the registry', async () => {
    const value = props();
    render(<ResumeRecoveryBar {...value} />);

    expect(
      screen.getByRole('button', { name: 'Resume 2 agents in Exawatt' })
    ).toHaveTextContent('⌘⌥⇧R');

    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Choose resume scope' }),
      { button: 0, ctrlKey: false }
    );
    expect(
      await screen.findByRole('menuitem', { name: 'Resume this agent' })
    ).toHaveTextContent('⌘⌥R');
    expect(
      screen.getByRole('menuitem', {
        name: 'Resume 2 agents in this project',
      })
    ).toHaveTextContent('⌘⌥⇧R');
  });

  it('follows a rebind instead of advertising a stale chord (D9)', () => {
    shortcutRegistry.setOverride('workspace-resume-scope', {
      key: 'y',
      modifiers: ['meta', 'alt', 'shift'],
    });
    render(<ResumeRecoveryBar {...props()} />);

    expect(
      screen.getByRole('button', { name: 'Resume 2 agents in Exawatt' })
    ).toHaveTextContent('⌘⌥⇧Y');
    shortcutRegistry.removeOverride('workspace-resume-scope');
  });

  it('reports reconnection separately and disables recovery during a batch', () => {
    render(
      <ResumeRecoveryBar
        {...props({
          reconnectableAgentCount: 1,
          progress: { completed: 1, total: 2 },
        })}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Resuming 1 of 2 agents…'
    );
    expect(
      screen.getByRole('button', { name: 'Resume 2 agents in Exawatt' })
    ).toBeDisabled();
  });
});
