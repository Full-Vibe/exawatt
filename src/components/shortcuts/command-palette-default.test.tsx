/**
 * ⌘K opening highlight (2026-09-13). The real CommandPalette over the real
 * cmdk root: the row the cursor lands on when the palette opens is what a
 * reflex ⏎ presses, and it used to be the Demo tenant switch, because the
 * Workspaces group rendered first and its "current" row was disabled. Every
 * case here fails if a `[data-palette-workspace-switch]` row is the opening
 * highlight, in any data shape the palette can meet.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
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
import {
  COMMUNITY_DISTRIBUTION,
  type DistributionContractV2,
} from '@exawatt/core/distribution';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  BUILTIN_WORKSPACES,
  DEMO_WORKSPACE_ID,
  PERSONAL_WORKSPACE_ID,
} from '@/lib/tenancy/workspace-scope';
import { CommandPalette } from './command-palette';
import type { PtySessionInfo } from '@exawatt/core/desktop-bridge';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/components/nav/command-navigation-provider', () => ({
  useCommandNavigation: () => ({
    navigateCommandSurface: vi.fn(),
    activateCommandAltitude: vi.fn(),
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

let distribution: DistributionContractV2 = COMMUNITY_DISTRIBUTION;
let feedbackAuthenticated = false;
vi.mock('@/lib/distribution/resolved', () => ({
  resolvedDistribution: () => distribution,
}));
vi.mock('@/components/feedback/product-feedback-provider', () => ({
  useOptionalProductFeedback: () => ({
    isAuthenticated: feedbackAuthenticated,
  }),
}));

vi.mock('@/lib/projects/registry', () => ({
  listProjects: vi.fn(async () => []),
  rebindProjectPath: vi.fn(async () => undefined),
}));

const switchWorkspace = vi.fn();

// The real tenancy roster: Personal (current), Demo (switch), Organization
// (preview). Exactly the shape the operator opens ⌘K on.
vi.mock('@/lib/tenancy/tenancy-provider', () => ({
  useOptionalWorkspaceTenancy: () => ({
    hydrated: true,
    activeWorkspace: BUILTIN_WORKSPACES.find(
      workspace => workspace.id === PERSONAL_WORKSPACE_ID
    ),
    workspaces: BUILTIN_WORKSPACES,
    switchWorkspace,
  }),
}));

const LIVE_SESSION: PtySessionInfo = {
  id: 'pty-1',
  durableSessionId: 'dur-1',
  harness: 'claude',
  title: 'Wire telemetry export',
  cwd: '/Users/example/Code/exawatt',
  projectDir: '/Users/example/Code/exawatt',
  projectName: 'exawatt',
  cols: 80,
  rows: 24,
  startedAt: 1,
  exited: false,
  exitCode: null,
  lastDataAt: 1,
  harnessSessionId: null,
  exitSignal: null,
  contextSummary: null,
  goalVisual: null,
  attention: null,
  engaged: false,
  working: false,
  delegation: null,
};

let sessions: PtySessionInfo[] = [];

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
  sessions = [];
  distribution = COMMUNITY_DISTRIBUTION;
  feedbackAuthenticated = false;
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      pty: {
        list: vi.fn(async () => sessions),
        closedSessions: vi.fn(async () => []),
      },
      workspace: { load: vi.fn(async () => null) },
    },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(
    window as unknown as Record<string, unknown>,
    'electron'
  );
});

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

const visibleRows = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).filter(
    el => el.getAttribute('aria-hidden') !== 'true'
  );

/** The row cmdk has the cursor on once the list has settled. */
async function openingHighlight(): Promise<HTMLElement> {
  let selected: HTMLElement | null = null;
  await waitFor(() => {
    selected = document.querySelector<HTMLElement>(
      '[cmdk-item][aria-selected="true"]'
    );
    if (!selected) throw new Error('no row selected yet');
  });
  return selected!;
}

const headings = () =>
  Array.from(document.querySelectorAll('[cmdk-group-heading]')).map(
    el => el.textContent
  );

const groupOf = (row: HTMLElement) =>
  row.closest('[cmdk-group]')?.querySelector('[cmdk-group-heading]')
    ?.textContent ?? null;

describe('⌘K opening highlight', () => {
  it('never lands on a tenant switch, even with nothing else to offer', async () => {
    renderPalette();
    await waitFor(() => expect(visibleRows().length).toBeGreaterThan(0));

    const first = await openingHighlight();
    expect(first.hasAttribute('data-palette-workspace-switch')).toBe(false);
    expect(groupOf(first)).not.toBe('Workspaces');
    // The Demo switch is still offered, one group down, for a deliberate move.
    expect(
      document.querySelector(
        `[data-palette-workspace-switch="${DEMO_WORKSPACE_ID}"]`
      )
    ).not.toBeNull();
  });

  it('lands on the first live Session when there is one', async () => {
    sessions = [LIVE_SESSION];
    renderPalette();
    await waitFor(() =>
      expect(document.querySelector('[data-session-id]')).not.toBeNull()
    );

    const first = await openingHighlight();
    expect(first.getAttribute('data-session-id')).toBe(LIVE_SESSION.id);
  });

  it.each([
    { key: 'ArrowDown', ctrlKey: false },
    { key: 'ArrowUp', ctrlKey: false },
    ...['n', 'p', 'j', 'k'].map(key => ({ key, ctrlKey: true })),
  ])('keeps $key navigation when Sessions arrive later', async navigation => {
    let resolveSessions!: (rows: typeof sessions) => void;
    vi.mocked(window.electron!.pty!.list).mockReturnValueOnce(
      new Promise(resolve => {
        resolveSessions = resolve;
      })
    );
    renderPalette();
    await openingHighlight();
    const input = document.querySelector('[cmdk-input]')!;
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const previous = (await openingHighlight()).getAttribute('data-value');
    fireEvent.keyDown(input, navigation);
    const chosen = (await openingHighlight()).getAttribute('data-value');
    expect(chosen).not.toBe(previous);
    await act(async () => resolveSessions([LIVE_SESSION]));
    await waitFor(() =>
      expect(document.querySelector('[data-session-id]')).not.toBeNull()
    );
    expect((await openingHighlight()).getAttribute('data-value')).toBe(chosen);
  });

  it('lets an explicit search choose a tenant switch', async () => {
    renderPalette();
    await openingHighlight();
    const target = document.querySelector<HTMLElement>(
      `[data-palette-workspace-switch="${DEMO_WORKSPACE_ID}"]`
    )!;
    fireEvent.change(document.querySelector('[cmdk-input]')!, {
      target: {
        value: BUILTIN_WORKSPACES.find(
          workspace => workspace.id === DEMO_WORKSPACE_ID
        )!.name,
      },
    });
    await waitFor(() =>
      expect(target.getAttribute('aria-selected')).toBe('true')
    );
  });

  it('orders Sessions before Projects before Workspaces', async () => {
    sessions = [LIVE_SESSION];
    renderPalette();
    await waitFor(() =>
      expect(document.querySelector('[data-session-id]')).not.toBeNull()
    );

    const order = headings();
    expect(order.indexOf('Sessions')).toBeLessThan(order.indexOf('Projects'));
    expect(order.indexOf('Projects')).toBeLessThan(order.indexOf('Workspaces'));
  });

  it('keeps a recently used tenant switch out of Recent', async () => {
    window.localStorage.setItem(
      'exawatt:palette-recents',
      JSON.stringify([
        { id: `workspace:${DEMO_WORKSPACE_ID}`, at: Date.now(), count: 5 },
      ])
    );
    renderPalette();
    await waitFor(() => expect(visibleRows().length).toBeGreaterThan(0));

    expect(headings()).not.toContain('Recent');
    const first = await openingHighlight();
    expect(first.hasAttribute('data-palette-workspace-switch')).toBe(false);
  });
});

describe('command service availability', () => {
  const feedbackRows = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).filter(
      row => row.getAttribute('data-value')?.includes('action-feedback')
    );

  it('omits commands for an unconfigured service', async () => {
    renderPalette();
    await openingHighlight();
    expect(feedbackRows()).toHaveLength(0);
  });

  it('keeps an offered command disabled with its reason until authenticated', async () => {
    distribution = {
      ...COMMUNITY_DISTRIBUTION,
      services: {
        ...COMMUNITY_DISTRIBUTION.services,
        productFeedback: {
          protocolVersion: 1,
          url: 'https://feedback.example.test',
        },
      },
    };
    window.localStorage.setItem(
      'exawatt:palette-recents',
      JSON.stringify([{ id: 'action-feedback', at: Date.now(), count: 3 }])
    );
    const view = renderPalette();
    await openingHighlight();
    expect(document.querySelector('[data-palette-group="recent"]')).toBeNull();
    expect(feedbackRows().length).toBeGreaterThan(0);
    for (const row of feedbackRows()) {
      expect(row.getAttribute('aria-disabled')).toBe('true');
      expect(row.getAttribute('title')).toBeTruthy();
    }
    view.unmount();
    feedbackAuthenticated = true;
    renderPalette();
    await openingHighlight();
    for (const row of feedbackRows())
      expect(row.getAttribute('aria-disabled')).not.toBe('true');
  });
});
