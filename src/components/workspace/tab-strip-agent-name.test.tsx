import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { assignAgentNames } from '@exawatt/core';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { TabStrip } from './tab-strip';
import { NO_FLEET_ATTENTION } from './session-status';
import type { Project, SessionTab } from './use-workspace-state';

/**
 * ENG-029 C4: an Agent's tab wears its name, with the context label beside
 * it, and the tab's rename edits that name; a name another Agent in the
 * Project wears is refused with the reason and the editor stays open.
 */
function tab(id: string, harness: string): SessionTab {
  return {
    kind: 'session',
    id,
    durableSessionId: `durable-${id}`,
    harness,
    title: harness,
    titleKind: 'default',
    cwd: '/repo',
    sessionId: `session-${id}`,
    harnessSessionId: null,
    resumeState: 'live',
    lifecycle: 'running',
    exitCode: null,
    roadmapItemId: null,
    initialTask: null,
  };
}

const tabs = [tab('a', 'claude'), tab('b', 'codex')];
const projects: Project[] = [
  {
    dir: '/repo',
    name: 'repo',
    color: '#19E6FF',
    activeTabId: 'a',
    tabs,
  },
];
const names = new Map(
  assignAgentNames(
    [],
    tabs.map(item => ({
      durableSessionId: item.durableSessionId,
      projectKey: '/repo',
      harness: item.harness,
    })),
    0
  ).records.map(record => [record.durableSessionId, record])
);

function renderStrip(onRenameTab = vi.fn(async () => null as string | null)) {
  render(
    <TooltipProvider>
      <TabStrip
        projects={projects}
        activeDir="/repo"
        pinnedTabId={null}
        summaries={{ 'durable-a': 'Fix the login redirect' }}
        agentNames={names}
        attention={NO_FLEET_ATTENTION}
        onSelectProject={vi.fn()}
        onSelectTab={vi.fn()}
        commands={{ closeTab: vi.fn() }}
        onRenameTab={onRenameTab}
        onRenameProject={vi.fn()}
        onSetProjectColor={vi.fn()}
      />
    </TooltipProvider>
  );
  return onRenameTab;
}

describe('Agent names on the tab strip', () => {
  it('shows the name with the context label beside it', () => {
    renderStrip();
    const names = [...document.querySelectorAll('[data-agent-name]')].map(
      node => node.textContent
    );
    expect(names).toEqual(['claude-1', 'codex-1']);
    expect(document.querySelector('[data-tab-context]')?.textContent).toBe(
      'Fix the login redirect'
    );
  });

  it('edits the name, refusing a taken one with the reason', async () => {
    const onRenameTab = renderStrip();
    fireEvent.doubleClick(
      document.querySelector('[data-tab-id="a"] [data-tab-chrome]')!
    );
    const input = screen.getByRole('textbox', { name: 'Rename' });
    expect(input).toHaveValue('claude-1');

    fireEvent.change(input, { target: { value: 'codex-1' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Another Agent in this Project is named codex-1'
    );
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRenameTab).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Rename' })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'reviewer' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onRenameTab).toHaveBeenCalledWith('a', 'reviewer');
  });

  it('reopens on what was typed when main refuses the name', async () => {
    renderStrip(
      vi.fn(async () => 'Another Agent in this Project is named lead')
    );
    fireEvent.doubleClick(
      document.querySelector('[data-tab-id="a"] [data-tab-chrome]')!
    );
    const input = screen.getByRole('textbox', { name: 'Rename' });
    fireEvent.change(input, { target: { value: 'lead' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Rename' })).toHaveValue(
        'lead'
      )
    );
    expect(screen.getByRole('status')).toHaveTextContent('named lead');
  });
});
