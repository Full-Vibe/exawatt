import type { ReactNode } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_ROADMAP_MARKDOWN } from '@exawatt/core';
import type { MessageRecord } from '@exawatt/core';
import { TooltipProvider } from '@/components/ui/tooltip';
import { GoalVisualPreferenceProvider } from '@/components/goal-visuals/goal-visual-preference-provider';
import { BusClientProvider } from '@/lib/bus/use-bus';
import { refusedSend, type BusClient } from '@/lib/bus/client';
import { busMessage } from '@/lib/bus/bus.test-support';
import { resetTeamDockTabForTest } from '@/components/team/team-dock';
import { ExposeOverlay } from './expose-overlay';
import { NO_FLEET_ATTENTION } from './session-status';
import type { Project, SessionTab } from './use-workspace-state';

/**
 * Every Team focus position answers Escape (BUG-302).
 *
 * The defect was a dead key: Escape on a dock tab was handled by nobody,
 * because three handlers each yielded keys born in the others' territory.
 * This walks every element a Team operator can focus, in every state the
 * dock can be in, presses Escape there, and fails on any position where
 * nothing took the key. It names the positions, so a new control that
 * swallows or ignores Escape fails here by name.
 */

vi.mock('@/lib/goal-visuals/preference-source', () => ({
  createGoalVisualPreferenceSource: () => ({
    kind: 'web' as const,
    load: () => new Promise<boolean>(() => undefined),
    save: async (enabled: boolean) => enabled,
    subscribe: () => () => undefined,
  }),
}));

const DIR = '/one';

function tab(id: string, title: string, harness: string): SessionTab {
  return {
    id,
    kind: 'session',
    durableSessionId: `durable-${id}`,
    harness,
    title,
    titleKind: 'operator',
    cwd: DIR,
    sessionId: `session-${id}`,
    harnessSessionId: null,
    resumeState: 'live',
    lifecycle: 'running',
    exitCode: null,
    roadmapItemId: null,
    initialTask: null,
  };
}

const projects: Project[] = [
  {
    dir: DIR,
    name: 'One',
    color: '#19E6FF',
    activeTabId: 'a',
    tabs: [tab('a', 'Alpha', 'claude'), tab('b', 'Beta', 'codex')],
  },
];

const ROADMAP = Object.values(DEMO_ROADMAP_MARKDOWN)[0];
const roadmapRead = () => ({
  status: 'ok' as const,
  text: ROADMAP,
  file: `${DIR}/ROADMAP.md`,
  mtimeMs: 1,
});

const messages: MessageRecord[] = [
  busMessage('q', 'session-a', 'session-b', 10, { projectId: DIR }),
  busMessage('r', 'session-b', 'session-a', 20, { projectId: DIR }),
];

const bus: BusClient = {
  kind: 'live',
  unavailableReason: () => null,
  list: async () => ({ ok: true, records: messages }),
  thread: async () => ({ ok: true, records: messages }),
  send: async () => refusedSend('Not in this test'),
  subscribe: () => () => undefined,
};

function Harness({ children }: { children: ReactNode }) {
  return (
    <GoalVisualPreferenceProvider>
      <TooltipProvider>
        <BusClientProvider client={bus}>{children}</BusClientProvider>
      </TooltipProvider>
    </GoalVisualPreferenceProvider>
  );
}

const FOCUSABLE =
  'button, a[href], input, select, textarea, [tabindex], [role="tab"]';

function team(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-expose]')!;
}

/** Every element an operator can put focus on, Team's own region first. */
function positions(): HTMLElement[] {
  const root = team();
  return [root, ...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    element =>
      !element.closest('[hidden]') && !(element as HTMLButtonElement).disabled
  );
}

function describePosition(element: HTMLElement): string {
  const marks = [...element.attributes]
    .filter(attribute => attribute.name.startsWith('data-'))
    .map(attribute => attribute.name)
    .join(' ');
  const name =
    element.getAttribute('aria-label') ??
    element.textContent?.trim().slice(0, 32) ??
    '';
  return `<${element.tagName.toLowerCase()} ${marks}> "${name}"`;
}

/** Escape at `element`: true when something took the key. */
function escapeAt(element: HTMLElement): boolean {
  act(() => element.focus());
  let notPrevented = true;
  act(() => {
    notPrevented = fireEvent.keyDown(element, {
      key: 'Escape',
      code: 'Escape',
    });
  });
  return !notPrevented;
}

async function showTab(id: 'roadmap' | 'chatter') {
  const tabButton = document.querySelector<HTMLElement>(
    `[data-team-dock-tab="${id}"]`
  )!;
  if (tabButton.getAttribute('aria-selected') !== 'true') {
    act(() => tabButton.click());
  }
  await waitFor(() =>
    expect(document.querySelector('[data-team-dock-active]')).toHaveAttribute(
      'data-team-dock-active',
      id
    )
  );
}

async function openRoadmapItem() {
  await showTab('roadmap');
  const panel = document.querySelector<HTMLElement>('[data-roadmap-panel]')!;
  if (panel.getAttribute('data-roadmap-mode') === 'item') return;
  const row = await waitFor(() => {
    const element = panel.querySelector<HTMLElement>('[data-roadmap-row]');
    expect(element).toBeTruthy();
    return element!;
  });
  act(() => row.click());
  await waitFor(() =>
    expect(panel).toHaveAttribute('data-roadmap-mode', 'item')
  );
}

async function openChatterThread() {
  await showTab('chatter');
  const chatter = document.querySelector<HTMLElement>('[data-chatter]')!;
  if (chatter.getAttribute('data-chatter-mode') === 'thread') return;
  const row = await screen.findByText(/q first line/);
  act(() => row.click());
  await waitFor(() =>
    expect(chatter).toHaveAttribute('data-chatter-mode', 'thread')
  );
}

const STATES: Array<[string, () => Promise<void>]> = [
  ['the roadmap queue', () => showTab('roadmap')],
  ['an open roadmap item', openRoadmapItem],
  ['the Chatter list', () => showTab('chatter')],
  ['a Chatter thread', openChatterThread],
];

describe('Team back-out ladder', () => {
  const scrollIntoView = Element.prototype.scrollIntoView;
  beforeEach(() => {
    window.localStorage.clear();
    resetTeamDockTabForTest();
    // jsdom lays nothing out; the panels keep their selection in view
    Element.prototype.scrollIntoView = () => undefined;
  });
  afterEach(() => {
    window.localStorage.clear();
    resetTeamDockTabForTest();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  async function renderTeam() {
    const onClose = vi.fn();
    render(
      <ExposeOverlay
        projects={projects}
        summaries={{}}
        attention={NO_FLEET_ATTENTION}
        activeTabId="a"
        roadmapRead={roadmapRead}
        onPick={vi.fn()}
        onClose={onClose}
      />,
      { wrapper: Harness }
    );
    await screen.findByRole('button', { name: /^Alpha, One/ });
    return onClose;
  }

  it('climbs one rung per Escape: reply, thread, list, tiles, then out of Team', async () => {
    const onClose = await renderTeam();
    await openChatterThread();
    const chatter = document.querySelector<HTMLElement>('[data-chatter]')!;
    const field = document.querySelector<HTMLElement>('[data-chatter-field]')!;
    fireEvent.change(field, { target: { value: 'kept' } });

    expect(escapeAt(field)).toBe(true);
    await waitFor(() => expect(chatter).toHaveFocus());
    expect(chatter).toHaveAttribute('data-chatter-mode', 'thread');

    expect(escapeAt(chatter)).toBe(true);
    expect(chatter).toHaveAttribute('data-chatter-mode', 'list');

    expect(escapeAt(chatter)).toBe(true);
    const tile = document.querySelector<HTMLElement>(
      '[data-expose-tile][data-selected="true"]'
    )!;
    await waitFor(() => expect(tile).toHaveFocus());
    expect(onClose).not.toHaveBeenCalled();

    expect(escapeAt(tile)).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Escape on a dock tab returns to the tiles, not out of Team', async () => {
    const onClose = await renderTeam();
    const dockTab = document.querySelector<HTMLElement>(
      '[data-team-dock-tab][aria-selected="true"]'
    )!;
    expect(escapeAt(dockTab)).toBe(true);
    await waitFor(() =>
      expect(
        document.querySelector('[data-expose-tile][data-selected="true"]')
      ).toHaveFocus()
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('an open roadmap item folds before the dock lets go', async () => {
    const onClose = await renderTeam();
    await openRoadmapItem();
    const panel = document.querySelector<HTMLElement>('[data-roadmap-panel]')!;
    const inside = panel.querySelector<HTMLElement>('button')!;
    expect(escapeAt(inside)).toBe(true);
    expect(panel).toHaveAttribute('data-roadmap-mode', 'queue');
    expect(panel).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(STATES)(
    'every focus position answers Escape in %s',
    async (_label, enter) => {
      await renderTeam();
      await enter();
      const count = positions().length;
      expect(count).toBeGreaterThan(4);

      const dead: string[] = [];
      for (let index = 0; index < count; index++) {
        // Escape moves state (a thread closes, an item folds), so each
        // position is measured from the same starting state.
        await enter();
        const element = positions()[index];
        if (!element) continue;
        if (!escapeAt(element)) dead.push(describePosition(element));
      }
      expect(dead).toEqual([]);
    }
  );
});
