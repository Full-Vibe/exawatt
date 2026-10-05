import { StrictMode } from 'react';
import { GoalVisualPreferenceProvider } from '@/components/goal-visuals/goal-visual-preference-provider';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  requestSessionJump,
  REOPEN_LAST_CLOSED_EVENT,
  SESSION_JUMP_EVENT,
} from '@/components/workspace/session-jump';
import { getWorkspaceCommandAvailability } from '@/components/workspace/workspace-command-availability';
import { demoShellAgents, demoShellProjects } from './model';
import {
  FleetProvider,
  useDemoFleetFrame,
  useFleet,
  useSessionAttentionSource,
} from '@/lib/fleet/fleet-provider';
import { DemoWorkspaceClient } from './demo-workspace-client';

const { replace, route } = vi.hoisted(() => ({
  replace: vi.fn(),
  route: { query: '' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(route.query),
}));

vi.mock('./demo-session-pane', () => ({
  DemoSessionPane: ({ agent }: { agent: { id: string } }) => (
    <div data-demo-pane-agent={agent.id}>Demo Session</div>
  ),
}));

afterEach(() => {
  replace.mockClear();
  route.query = '';
});

function view() {
  return render(
    <TooltipProvider>
      <FleetProvider demoSimulationTickMs={0}>
        <DemoWorkspaceClient />
      </FleetProvider>
    </TooltipProvider>
  );
}

/** Ribbon Project order, as the REAL TabStrip renders it (W6). */
function projectOrder(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-project]')
  ).map(element => element.dataset.project!);
}

describe('Demo workspace reads the tick frame (ENG-027 W14)', () => {
  it('projects the Demo transport frame where it used to read the still fixture', async () => {
    function FrameProbe() {
      const frame = useDemoFleetFrame();
      return (
        <output
          data-frame-agents={frame ? String(frame.agents.length) : 'none'}
          data-frame-elapsed={frame ? String(frame.elapsedMs) : 'none'}
        />
      );
    }
    const { container } = render(
      <TooltipProvider>
        <FleetProvider demoSimulationTickMs={0}>
          <DemoWorkspaceClient />
          <FrameProbe />
        </FleetProvider>
      </TooltipProvider>
    );
    const probe = () => container.querySelector('[data-frame-agents]');
    // frozen tick: frame zero IS the fixture the shell always rendered
    await waitFor(() =>
      expect(probe()?.getAttribute('data-frame-agents')).toBe(
        String(demoShellAgents().length + 146)
      )
    );
    expect(probe()?.getAttribute('data-frame-elapsed')).toBe('0');
    // every ribbon tab is one of the frame's base-tier Agents
    const tabIds = Array.from(
      container.querySelectorAll<HTMLElement>('[data-tab-id]')
    ).map(element => element.dataset.tabId);
    const base = new Set(demoShellAgents().map(agent => agent.id));
    for (const id of tabIds) expect(base.has(id!)).toBe(true);
  });
});

describe('Demo workspace on the real ribbon (W6)', () => {
  it('acknowledges only actual foreground inspection and acknowledges again on window return', async () => {
    const target = demoShellAgents().find(
      agent => agent.status === 'complete'
    )!;
    const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    function ReadProbe() {
      const { fleetState } = useFleet();
      const commands = useSessionAttentionSource();
      return (
        <>
          <output
            data-receipt={String(
              fleetState.agents[target.id]?.attention?.unread
            )}
          />
          <button
            data-test-mark
            onClick={() => void commands?.markUnread(target.id)}
          >
            mark
          </button>
        </>
      );
    }
    requestSessionJump(target.id);
    const { container } = render(
      <TooltipProvider>
        <FleetProvider demoSimulationTickMs={0}>
          <DemoWorkspaceClient />
          <ReadProbe />
        </FleetProvider>
      </TooltipProvider>
    );
    const receipt = () =>
      container.querySelector('[data-receipt]')?.getAttribute('data-receipt');
    await waitFor(() => expect(receipt()).toBe('true'));
    focused.mockReturnValue(true);
    fireEvent.focus(window);
    await waitFor(() => expect(receipt()).toBe('false'));
    fireEvent.click(container.querySelector('[data-test-mark]')!);
    await waitFor(() => expect(receipt()).toBe('true'));
    focused.mockReturnValue(false);
    fireEvent.blur(window);
    focused.mockReturnValue(true);
    fireEvent.focus(window);
    await waitFor(() => expect(receipt()).toBe('false'));
    focused.mockRestore();
  });

  it('keeps the obscured Session unread throughout Team overview and reads it on return', async () => {
    const target = demoShellAgents().find(
      agent => agent.status === 'complete'
    )!;
    const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    function ReadProbe() {
      const { fleetState } = useFleet();
      return (
        <output
          data-receipt={String(fleetState.agents[target.id]?.attention?.unread)}
        />
      );
    }
    const contents = () => (
      <TooltipProvider>
        <GoalVisualPreferenceProvider>
          <FleetProvider demoSimulationTickMs={0}>
            <DemoWorkspaceClient />
            <ReadProbe />
          </FleetProvider>
        </GoalVisualPreferenceProvider>
      </TooltipProvider>
    );
    route.query = 'view=sessions';
    requestSessionJump(target.id);
    const { container, rerender } = render(contents());
    const receipt = () =>
      container.querySelector('[data-receipt]')?.getAttribute('data-receipt');
    await waitFor(() => expect(receipt()).toBe('true'));
    fireEvent.blur(window);
    fireEvent.focus(window);
    expect(receipt()).toBe('true');
    route.query = '';
    rerender(contents());
    await waitFor(() => expect(receipt()).toBe('false'));
    focused.mockRestore();
  });

  it('consumes an exact cross-route handoff only after commit under render replay', async () => {
    const target = demoShellAgents().find(
      agent => agent.id !== 'vg-home-onboard'
    )!;
    requestSessionJump(target.id);
    const { container } = render(
      <StrictMode>
        <TooltipProvider>
          <FleetProvider demoSimulationTickMs={0}>
            <DemoWorkspaceClient />
          </FleetProvider>
        </TooltipProvider>
      </StrictMode>
    );
    await waitFor(() =>
      expect(
        container
          .querySelector('[data-demo-pane-agent]')
          ?.getAttribute('data-demo-pane-agent')
      ).toBe(target.id)
    );
  });

  it('pauses and resumes fixture Sessions through the same Project menu', async () => {
    const { container } = view();
    const project = demoShellProjects().find(item =>
      item.tabs.some(tab => tab.id === 'vg-home-onboard')
    )!;
    const token = container.querySelector<HTMLElement>(
      `[data-ribbon-key="project:${project.dir}"]`
    )!;
    fireEvent.contextMenu(token);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pause Agents' }));
    const dialog = await screen.findByRole('dialog', {
      name: `Pause ${project.name}?`,
    });
    expect(dialog).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pause now' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    fireEvent.contextMenu(token);
    expect(
      screen.queryByRole('menuitem', { name: 'Pause Agents' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Resume Agents' }));
    fireEvent.contextMenu(token);
    expect(
      screen.getByRole('menuitem', { name: 'Pause Agents' })
    ).toBeInTheDocument();
  });

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
