/**
 * ⌘K ranking acceptance (ENG-016): the real CommandPalette over the real cmdk
 * root with the structural-band filter. The regression this pins: typing a
 * navigation surface's name ("usage") used to rank a fuzzy Session match above
 * the Navigation row, and "go to usage" returned nothing.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { SessionRow } from '@/components/workspace/switcher-rows';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DEMO_WORKSPACE_ID } from '@/lib/tenancy/workspace-scope';
import { CommandPalette } from './command-palette';

const navigateCommandSurface = vi.fn();
const activateCommandAltitude = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/components/nav/command-navigation-provider', () => ({
  useCommandNavigation: () => ({
    navigateCommandSurface,
    activateCommandAltitude,
  }),
}));

vi.mock('@/components/appearance/appearance-provider', () => ({
  useAppearance: () => ({
    preferences: { mode: 'system' },
    resolved: { themeId: 'exawatt-classic-dark' },
    previewTheme: vi.fn(),
    cancelPreview: vi.fn(),
    commitPreferences: vi.fn(),
  }),
}));

vi.mock('@/components/feedback/product-feedback-provider', () => ({
  useOptionalProductFeedback: () => null,
}));

vi.mock('@/lib/projects/registry', () => ({
  listProjects: vi.fn(async () => []),
  rebindProjectPath: vi.fn(async () => undefined),
}));

// Demo tenant: the palette lists these rows as its Sessions group without a
// PTY. Titles are chosen to reproduce the diagnosed collisions.
const SESSION_FIXTURES: SessionRow[] = [
  {
    id: 'sess-metering',
    title: 'Refactor usage metering',
    harness: 'claude',
    projectName: 'Exawatt',
    subtitle: 'metering pass',
    color: '#50E6FF',
    status: 'working',
    roadmapItemId: 'ENG-008',
    searchValue: 'Refactor usage metering Exawatt metering pass ENG-008',
  },
  {
    id: 'sess-prometheus',
    title: 'Prometheus exporter',
    harness: 'claude',
    projectName: 'Exawatt',
    subtitle: null,
    color: '#50E6FF',
    status: 'needs-you',
    roadmapItemId: null,
    searchValue: 'Prometheus exporter Exawatt',
  },
  {
    id: 'sess-cloudburst',
    title: 'Cloud burst simulation',
    harness: 'codex',
    projectName: 'Voltaic',
    subtitle: null,
    color: '#FFB86B',
    status: 'quiet',
    roadmapItemId: null,
    searchValue: 'Cloud burst simulation Voltaic',
  },
];

vi.mock('@/lib/demo-workspace/model', () => ({
  demoSessionRows: () => SESSION_FIXTURES,
}));

vi.mock('@/lib/tenancy/tenancy-provider', () => ({
  useOptionalWorkspaceTenancy: () => ({
    hydrated: true,
    activeWorkspace: { id: DEMO_WORKSPACE_ID },
    workspaces: [],
    switchWorkspace: vi.fn(),
  }),
}));

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: originalScrollIntoView,
    });
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});

beforeEach(() => {
  window.localStorage.clear();
  navigateCommandSurface.mockClear();
  activateCommandAltitude.mockClear();
});

afterEach(cleanup);

function renderPalette() {
  return render(
    <TooltipProvider>
      <CommandPalette
        open
        onOpenChange={() => undefined}
        onOpenHelpModal={() => undefined}
      />
    </TooltipProvider>
  );
}

function paletteInput(): HTMLElement {
  return screen.getByPlaceholderText('Type a command or search...');
}

/** Visible cmdk rows in rendered (= ranked) order. */
function visibleRows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[cmdk-item]')
  ).filter(el => el.getAttribute('aria-hidden') !== 'true');
}

async function typeQuery(query: string) {
  fireEvent.change(paletteInput(), { target: { value: query } });
  await waitFor(() => {
    if (visibleRows().length === 0 && !screen.queryByText('No results found.'))
      throw new Error('list not settled');
  });
}

describe('⌘K ranking (ENG-016)', () => {
  it('ranks the Usage nav row first for "usage" and selects it on Enter', async () => {
    renderPalette();
    await typeQuery('usage');

    const rows = visibleRows();
    expect(rows[0].textContent).toContain('Go to Usage');
    // the fuzzy Session hit is still findable, just no longer first
    expect(
      rows.some(r => r.textContent?.includes('Refactor usage metering'))
    ).toBe(true);

    // Enter activates the top-ranked row
    await waitFor(() =>
      expect(rows[0].getAttribute('aria-selected')).toBe('true')
    );
    fireEvent.keyDown(paletteInput(), { key: 'Enter' });
    await waitFor(() =>
      expect(navigateCommandSurface).toHaveBeenCalledWith('/usage')
    );
  });

  it.each(['go to usage', 'go usage'])(
    'resolves "%s" to the Usage nav row instead of an empty list',
    async query => {
      renderPalette();
      await typeQuery(query);

      const rows = visibleRows();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].textContent).toContain('Go to Usage');
    }
  );

  it('ranks a newly added surface first by its own name', async () => {
    renderPalette();
    await typeQuery('coordination');

    expect(visibleRows()[0].textContent).toContain('Go to Coordination');
  });

  it('ranks the public Leaderboard destination first by its own name', async () => {
    // Leaderboard is a marketing route that joins ⌘K through the manifest's
    // commandPalette eligibility (ENG-035); ranking must treat it exactly
    // like an app surface.
    renderPalette();
    await typeQuery('leaderboard');

    const rows = visibleRows();
    expect(rows[0].textContent).toContain('Go to Leaderboard');
    await waitFor(() =>
      expect(rows[0].getAttribute('aria-selected')).toBe('true')
    );
    fireEvent.keyDown(paletteInput(), { key: 'Enter' });
    await waitFor(() =>
      expect(navigateCommandSurface).toHaveBeenCalledWith('/leaderboard')
    );
  });

  it('ranks a Session first for a partial session-name query', async () => {
    renderPalette();
    await typeQuery('promet');

    expect(visibleRows()[0].textContent).toContain('Prometheus exporter');
  });

  it('keeps a same-band session prefix ahead of a nav prefix via DOM order', async () => {
    renderPalette();
    // "clo" is a prefix of BOTH the "Cloud burst simulation" Session and the
    // Cloud nav row: same band, Sessions group renders first, Session wins.
    await typeQuery('clo');

    const rows = visibleRows();
    expect(rows[0].textContent).toContain('Cloud burst simulation');
    expect(rows.some(r => r.textContent?.includes('Go to Cloud'))).toBe(true);
  });

  it('gives the nav row the win when its name is the exact query', async () => {
    renderPalette();
    await typeQuery('cloud');

    expect(visibleRows()[0].textContent).toContain('Go to Cloud');
  });

  it('keeps the authored group order on an empty query', async () => {
    renderPalette();
    await waitFor(() => expect(visibleRows().length).toBeGreaterThan(0));

    const headings = Array.from(
      document.querySelectorAll('[cmdk-group-heading]')
    ).map(el => el.textContent);
    expect(headings).toEqual(['Sessions', 'Navigation', 'Actions']);
  });

  it('leaves frecency Recents untouched (shown on empty query only)', async () => {
    window.localStorage.setItem(
      'exawatt:palette-recents',
      JSON.stringify([{ id: 'nav-settings', at: Date.now(), count: 3 }])
    );
    renderPalette();
    await waitFor(() => expect(visibleRows().length).toBeGreaterThan(0));

    const headings = () =>
      Array.from(document.querySelectorAll('[cmdk-group-heading]')).map(
        el => el.textContent
      );
    expect(headings()[0]).toBe('Recent');

    await typeQuery('usage');
    expect(headings()).not.toContain('Recent');
    expect(visibleRows()[0].textContent).toContain('Go to Usage');
  });
});
