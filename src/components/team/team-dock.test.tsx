import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUS_OPERATOR } from '@/lib/bus/operator';
import { resetSeenThroughForTest, seenThrough } from '@/lib/bus/read-state';
import type { BusDeliveryState, BusMessage } from '@/lib/bus/types';
import type { BusMessagesState } from '@/lib/bus/use-bus';
import { ChatterView } from './chatter/chatter-view';
import { TeamDock, resetTeamDockTabForTest, useTeamDockTab } from './team-dock';
import {
  TEAM_DOCK_FOCUS_EVENT,
  requestTeamDockSummon,
} from './team-dock-summon';

const PROJECT = '/work/alpha';
const STATES: BusDeliveryState[] = [
  'delivered',
  'queued',
  'held',
  'terminal',
  'undeliverable',
  'expired',
  'unknown',
];

function message(
  id: string,
  from: string,
  to: string,
  at: number,
  state: BusDeliveryState = 'delivered',
  kind: BusMessage['kind'] = 'agent'
): BusMessage {
  return {
    id,
    projectId: PROJECT,
    from:
      kind === 'operator'
        ? BUS_OPERATOR
        : { sessionId: from, name: from, harness: 'claude' },
    to: { sessionId: to, name: to, harness: 'codex' },
    kind,
    at,
    text: `${id} first line\nsecond line`,
    delivery: { state, reason: `${state} because` },
  };
}

function renderChatter(
  state: BusMessagesState,
  props: Partial<React.ComponentProps<typeof ChatterView>> = {}
) {
  return render(
    <ChatterView
      projectId={PROJECT}
      projectName="Alpha"
      projectColor="#50e6ff"
      state={state}
      send={async () => ({ status: 'refused', reason: 'Demo cannot send' })}
      participants={new Map()}
      visible={false}
      onSelectSession={() => {}}
      {...props}
    />
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetSeenThroughForTest();
  resetTeamDockTabForTest();
});
afterEach(() => vi.useRealTimers());

describe('Chatter states', () => {
  it('says unavailable in one line and never renders a list', () => {
    const { container } = renderChatter({
      status: 'unavailable',
      reason: 'No bus here.',
    });
    expect(
      container.querySelector('[data-chatter-unavailable]')?.textContent
    ).toBe('No bus here.');
    expect(container.querySelector('[data-chatter-empty]')).toBeNull();
    expect(container.querySelector('[data-chatter-list]')).toBeNull();
  });

  it('tells an empty Project apart from unavailable and from a failed read', () => {
    const empty = renderChatter({ status: 'ok', messages: [] });
    expect(
      empty.container.querySelector('[data-chatter-empty]')
    ).not.toBeNull();
    expect(
      empty.container.querySelector('[data-chatter-unavailable]')
    ).toBeNull();
    empty.unmount();
    const failed = renderChatter({ status: 'error', message: 'disk' });
    expect(
      failed.container.querySelector('[data-chatter-error]')
    ).not.toBeNull();
    expect(failed.container.querySelector('[data-chatter-empty]')).toBeNull();
  });

  it('renders one row per message, newest first, with its delivery result', () => {
    const messages = STATES.map((state, i) =>
      message(`m${i}`, 'a', 'b', i + 1, state)
    );
    const { container } = renderChatter({ status: 'ok', messages });
    const rows = [...container.querySelectorAll('[data-chatter-row]')];
    expect(rows.map(r => r.getAttribute('data-chatter-row'))).toEqual(
      messages.map(m => m.id).reverse()
    );
    for (const row of rows) {
      const state = row.getAttribute('data-delivery');
      expect(
        row.querySelector(`[data-delivery-glyph="${state}"]`)
      ).not.toBeNull();
      expect(
        row.querySelector('[data-delivery-glyph]')?.getAttribute('aria-label')
      ).toContain(`${state} because`);
    }
  });

  it('marks what arrived since the last look and moves the reading position when shown', () => {
    const messages = [
      message('old', 'a', 'b', 10),
      message('new', 'b', 'a', 20),
      message('mine', 'op', 'a', 30, 'delivered', 'operator'),
    ];
    const hidden = renderChatter({ status: 'ok', messages });
    const unread = () =>
      [
        ...hidden.container.querySelectorAll('[data-chatter-row][data-unread]'),
      ].map(r => r.getAttribute('data-chatter-row'));
    expect(unread()).toEqual(['new', 'old']);
    expect(seenThrough(PROJECT)).toBe(0);
    hidden.rerender(
      <ChatterView
        projectId={PROJECT}
        projectName="Alpha"
        projectColor={null}
        state={{ status: 'ok', messages }}
        send={async () => ({ status: 'refused', reason: 'x' })}
        participants={new Map()}
        visible
        onSelectSession={() => {}}
      />
    );
    expect(seenThrough(PROJECT)).toBe(30);
    // still marked until the operator looks away and back
    expect(unread()).toEqual(['new', 'old']);
  });
});

describe('Chatter keyboard and thread', () => {
  it('opens a thread with Enter, backs out with Escape, then leaves the panel', () => {
    const onExitFocus = vi.fn();
    const messages = [
      message('q', 'a', 'b', 10),
      message('r', 'b', 'a', 20),
      message('other', 'c', 'd', 30),
    ];
    const { container } = renderChatter(
      { status: 'ok', messages },
      { onExitFocus }
    );
    const root = container.querySelector('[data-chatter]') as HTMLElement;
    fireEvent.keyDown(root, { key: 'ArrowDown' });
    fireEvent.keyDown(root, { key: 'Enter' });
    expect(root.getAttribute('data-chatter-mode')).toBe('thread');
    expect(
      [...container.querySelectorAll('[data-chatter-thread-message]')].map(m =>
        m.getAttribute('data-chatter-thread-message')
      )
    ).toEqual(['q', 'r']);
    // the opened message and the newest are open in place, with the stamp
    expect(container.querySelectorAll('[data-chatter-stamp]').length).toBe(1);
    fireEvent.keyDown(root, { key: 'Escape' });
    expect(root.getAttribute('data-chatter-mode')).toBe('list');
    expect(onExitFocus).not.toHaveBeenCalled();
    fireEvent.keyDown(root, { key: 'Escape' });
    expect(onExitFocus).toHaveBeenCalledOnce();
  });

  it('sends as operator to the chosen Session and shows the result', async () => {
    const send = vi.fn(async (to: string, text: string) => ({
      status: 'sent' as const,
      message: { ...message('sent', 'op', to, 40, 'queued', 'operator'), text },
    }));
    const messages = [message('q', 'a', 'b', 10)];
    const { container } = renderChatter({ status: 'ok', messages }, { send });
    fireEvent.click(container.querySelector('[data-chatter-row="q"]')!);
    fireEvent.click(container.querySelector('[data-chatter-recipient="b"]')!);
    const field = container.querySelector(
      '[data-chatter-field]'
    ) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'hold on' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
    });
    expect(send).toHaveBeenCalledWith('b', 'hold on');
    expect(
      container
        .querySelector('[data-chatter-send-result]')
        ?.getAttribute('data-chatter-send-result')
    ).toBe('queued');
  });

  it('shows a refusal as the reason', async () => {
    const { container } = renderChatter({
      status: 'ok',
      messages: [message('q', 'a', 'b', 10)],
    });
    fireEvent.click(container.querySelector('[data-chatter-row="q"]')!);
    const field = container.querySelector(
      '[data-chatter-field]'
    ) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'x' } });
    await act(async () => {
      fireEvent.submit(container.querySelector('[data-chatter-composer]')!);
    });
    const result = container.querySelector('[data-chatter-send-result]');
    expect(result?.getAttribute('data-chatter-send-result')).toBe('refused');
    expect(result?.textContent).toBe('Demo cannot send');
  });
});

function Dock() {
  const [tab, setTab] = useTeamDockTab();
  return (
    <TeamDock
      overlay={false}
      tab={tab}
      onTabChange={setTab}
      panels={[
        {
          id: 'roadmap',
          label: 'Roadmap',
          content: <div data-dock-focus tabIndex={-1} data-testid="roadmap" />,
        },
        {
          id: 'chatter',
          label: 'Chatter',
          badge: 3,
          badgeLabel: '3 unread',
          content: <div data-dock-focus tabIndex={-1} data-testid="chatter" />,
        },
      ]}
    />
  );
}

describe('Team dock', () => {
  it('shows one panel at a time and remembers the last tab across opens', () => {
    const first = render(<Dock />);
    expect(
      screen
        .getByTestId('chatter')
        .closest('[role="tabpanel"]')
        ?.hasAttribute('hidden')
    ).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: /Chatter/ }));
    expect(
      screen
        .getByTestId('roadmap')
        .closest('[role="tabpanel"]')
        ?.hasAttribute('hidden')
    ).toBe(true);
    first.unmount();
    resetTeamDockTabForTest();
    render(<Dock />);
    expect(
      screen
        .getByRole('tab', { selected: true })
        .getAttribute('data-team-dock-tab')
    ).toBe('chatter');
  });

  it('switches tabs with the arrow keys and badges a tab with its count', () => {
    render(<Dock />);
    const roadmap = screen.getByRole('tab', { name: /Roadmap/ });
    fireEvent.keyDown(roadmap, { key: 'ArrowRight' });
    expect(
      screen
        .getByRole('tab', { selected: true })
        .getAttribute('data-team-dock-tab')
    ).toBe('chatter');
    expect(screen.getByLabelText('3 unread')).toBeTruthy();
  });

  it('a plain summon keeps the remembered tab; a roadmap drill opens Roadmap', () => {
    render(<Dock />);
    fireEvent.click(screen.getByRole('tab', { name: /Chatter/ }));
    act(() => {
      requestTeamDockSummon();
      window.dispatchEvent(new CustomEvent(TEAM_DOCK_FOCUS_EVENT));
    });
    expect(
      screen
        .getByRole('tab', { selected: true })
        .getAttribute('data-team-dock-tab')
    ).toBe('chatter');
    act(() => {
      requestTeamDockSummon({ drillId: 'ENG-1' });
      window.dispatchEvent(new CustomEvent(TEAM_DOCK_FOCUS_EVENT));
    });
    expect(
      screen
        .getByRole('tab', { selected: true })
        .getAttribute('data-team-dock-tab')
    ).toBe('roadmap');
  });
});
