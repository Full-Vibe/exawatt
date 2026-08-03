import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getWorkspaceCommandAvailability } from '@/components/workspace/workspace-command-availability';
import { demoShellAgents, demoShellProjects } from './model';
import { DemoWorkspaceClient } from './demo-workspace-client';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('./demo-session-pane', () => ({
  DemoSessionPane: ({ agent }: { agent: { id: string } }) => (
    <div data-demo-pane-agent={agent.id}>Demo Session</div>
  ),
}));

afterEach(() => {
  replace.mockClear();
});

function projectOrder(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-demo-project]')
  ).map(element => element.dataset.demoProject!);
}

describe('Demo workspace fixed command parity', () => {
  it('runs Project movement through the shared fixed layer and publishes directional availability', () => {
    const authored = demoShellProjects();
    const defaultAgent = demoShellAgents().find(
      agent => agent.id === 'vg-home-onboard'
    );
    const activeIndex = authored.findIndex(project =>
      project.tabs.some(tab => tab.id === defaultAgent?.id)
    );
    const delta: 1 | -1 = activeIndex < authored.length - 1 ? 1 : -1;
    const view = render(<DemoWorkspaceClient />);

    const availability = getWorkspaceCommandAvailability().commands;
    expect(availability['move-project-left'].available).toBe(activeIndex > 0);
    expect(availability['move-project-right'].available).toBe(
      activeIndex < authored.length - 1
    );

    const before = projectOrder(view.container);
    fireEvent.keyDown(window, {
      key: delta === 1 ? '}' : '{',
      code: delta === 1 ? 'BracketRight' : 'BracketLeft',
      metaKey: true,
      altKey: true,
      shiftKey: true,
    });
    const after = projectOrder(view.container);

    expect(after).not.toEqual(before);
    expect(after[activeIndex + delta]).toBe(before[activeIndex]);
    expect(screen.getByRole('status')).toHaveTextContent('Moved Project');
  });

  it('supports ordinal selection and F6/Escape focus movement in Demo Mode', () => {
    const authoredTabs = demoShellProjects().flatMap(project => project.tabs);
    const view = render(<DemoWorkspaceClient />);
    const sessionPane = view.container.querySelector<HTMLElement>(
      '[data-workspace-session-focus-owner]'
    )!;

    fireEvent.keyDown(window, {
      key: '2',
      code: 'Digit2',
      metaKey: true,
    });
    expect(
      view.container.querySelector(
        `[data-demo-pane-agent="${authoredTabs[1].id}"]`
      )
    ).toBeInTheDocument();

    sessionPane.focus();
    fireEvent.keyDown(sessionPane, { key: 'F6', code: 'F6' });
    expect(document.activeElement).toBe(
      view.container.querySelector('[data-demo-session][data-selected]')
    );

    fireEvent.keyDown(document.activeElement!, {
      key: 'Escape',
      code: 'Escape',
    });
    expect(document.activeElement).toBe(sessionPane);
    expect(screen.getByText('Demo Session')).toBeVisible();
  });
});
