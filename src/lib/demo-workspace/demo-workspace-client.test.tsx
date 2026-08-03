import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  REOPEN_LAST_CLOSED_EVENT,
  SESSION_JUMP_EVENT,
} from '@/components/workspace/session-jump';
import { getWorkspaceCommandAvailability } from '@/components/workspace/workspace-command-availability';
import { demoShellAgents, demoShellProjects } from './model';
import { DemoWorkspaceClient } from './demo-workspace-client';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
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

function view() {
  return render(
    <TooltipProvider>
      <DemoWorkspaceClient />
    </TooltipProvider>
  );
}

/** Ribbon Project order, as the REAL TabStrip renders it (W6). */
function projectOrder(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-project]')
  ).map(element => element.dataset.project!);
}

describe('Demo workspace on the real ribbon (W6)', () => {
  it('renders the live TabStrip chrome, not a demo-only navigation surface', () => {
    const { container } = view();
    expect(
      container.querySelector(
        '[data-workspace-chrome] [data-workspace-tab-strip]'
      )
    ).toBeInTheDocument();
    // every Project rides the ribbon as a real token (open, mini, or folded)
    for (const project of demoShellProjects()) {
      expect(
        container.querySelector(`[data-ribbon-key="project:${project.dir}"]`)
      ).toBeInTheDocument();
    }
    // the active Project's Sessions are real chips with the live close verb
    const activeProject = demoShellProjects().find(project =>
      project.tabs.some(tab => tab.id === 'vg-home-onboard')
    )!;
    for (const tab of activeProject.tabs) {
      expect(
        container.querySelector(`[data-tab-id="${tab.id}"]`)
      ).toBeInTheDocument();
    }
    // the W2 rail is gone
    expect(container.querySelector('[data-demo-session]')).toBeNull();
    expect(
      container.querySelector('[data-active-session-initiative="init-home-ga"]')
    ).toHaveTextContent('Voltaic Home GA');
  });

  it('runs Project movement through the shared fixed layer and publishes directional availability', () => {
    const authored = demoShellProjects();
    const defaultAgent = demoShellAgents().find(
      agent => agent.id === 'vg-home-onboard'
    );
    const activeIndex = authored.findIndex(project =>
      project.tabs.some(tab => tab.id === defaultAgent?.id)
    );
    const delta: 1 | -1 = activeIndex < authored.length - 1 ? 1 : -1;
    const rendered = view();

    const availability = getWorkspaceCommandAvailability().commands;
    expect(availability['move-project-left'].available).toBe(activeIndex > 0);
    expect(availability['move-project-right'].available).toBe(
      activeIndex < authored.length - 1
    );

    const before = projectOrder(rendered.container);
    fireEvent.keyDown(window, {
      key: delta === 1 ? '}' : '{',
      code: delta === 1 ? 'BracketRight' : 'BracketLeft',
      metaKey: true,
      altKey: true,
      shiftKey: true,
    });
    const after = projectOrder(rendered.container);

    expect(after).not.toEqual(before);
    expect(after[activeIndex + delta]).toBe(before[activeIndex]);
    expect(screen.getByRole('status')).toHaveTextContent('Moved Project');
  });

  it('supports ordinal selection and F6/Escape focus movement in Demo Mode', () => {
    const authoredTabs = demoShellProjects().flatMap(project => project.tabs);
    const rendered = view();
    const sessionPane = rendered.container.querySelector<HTMLElement>(
      '[data-workspace-session-focus-owner]'
    )!;

    fireEvent.keyDown(window, {
      key: '2',
      code: 'Digit2',
      metaKey: true,
    });
    expect(
      rendered.container.querySelector(
        `[data-demo-pane-agent="${authoredTabs[1].id}"]`
      )
    ).toBeInTheDocument();

    sessionPane.focus();
    fireEvent.keyDown(sessionPane, { key: 'F6', code: 'F6' });
    const activeChip = rendered.container.querySelector(
      `[data-tab-id="${authoredTabs[1].id}"] [data-tab-chrome]`
    );
    expect(document.activeElement).toBe(activeChip);

    fireEvent.keyDown(document.activeElement!, {
      key: 'Escape',
      code: 'Escape',
    });
    expect(document.activeElement).toBe(sessionPane);
    expect(screen.getByText('Demo Session')).toBeVisible();
  });

  it('closes a quiet Session for real and reopens it from the close ledger', () => {
    const agents = demoShellAgents();
    const quiet = agents.find(
      agent => agent.status !== 'working' && agent.status !== 'reviewing'
    )!;
    const rendered = view();

    // an exiting chip lingers inert through the ribbon's exit motion, so
    // "present" means a live, interactive token
    const liveChipFor = (id: string) =>
      rendered.container.querySelector(`[data-tab-id="${id}"]:not([inert])`);

    // jump there through the real session-jump contract; its Project opens
    // and the chip gains the live close affordance
    fireEvent(
      window,
      new CustomEvent(SESSION_JUMP_EVENT, { detail: quiet.id })
    );
    expect(liveChipFor(quiet.id)).toBeInTheDocument();

    // close via the ribbon's close affordance (the live TabStrip verb)
    const closeButton = rendered.container.querySelector<HTMLElement>(
      `[data-tab-id="${quiet.id}"]:not([inert]) button[aria-label^="Close"]`
    );
    expect(closeButton).not.toBeNull();
    fireEvent.click(closeButton!);
    expect(liveChipFor(quiet.id)).toBeNull();
    expect(
      getWorkspaceCommandAvailability().commands['reopen-closed-tab'].available
    ).toBe(true);

    // reopen restores the chip where it lived
    fireEvent(window, new CustomEvent(REOPEN_LAST_CLOSED_EVENT));
    expect(liveChipFor(quiet.id)).toBeInTheDocument();
  });
});
