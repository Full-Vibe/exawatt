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
import { defaultShortcuts, shortcutRegistry } from '@/lib/shortcuts';
import {
  deriveWorkspaceCommandAvailability,
  publishWorkspaceCommandAvailability,
  resetWorkspaceCommandAvailability,
  type WorkspaceCommandAvailabilityInput,
} from '@/components/workspace/workspace-command-availability';
import {
  RESUME_ACTIVE_AGENT_EVENT,
  RESUME_PARKED_SCOPE_EVENT,
} from '@/components/workspace/session-jump';
import { DEMO_WORKSPACE_ID } from '@/lib/tenancy/workspace-scope';
import { CommandPalette } from './command-palette';
import type { CommandPaletteLaunchConfiguration } from './command-palette-launch-configurations';

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

let projectFixtures: Array<{
  id: string;
  name: string;
  root_path: string;
  color: string | null;
}> = [];

vi.mock('@/lib/projects/registry', () => ({
  listProjects: vi.fn(async () => projectFixtures),
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

let activeWorkspaceId: string = DEMO_WORKSPACE_ID;

vi.mock('@/lib/tenancy/tenancy-provider', () => ({
  useOptionalWorkspaceTenancy: () => ({
    hydrated: true,
    activeWorkspace: { id: activeWorkspaceId },
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
  activeWorkspaceId = DEMO_WORKSPACE_ID;
  projectFixtures = [];
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

// ── FIX-007 (2026-08-06 operator quick capture, two rows, one defect).
// cmdk ranks items INSIDE a group; sibling group order was whatever the JSX
// authored. Projects sat seventh, so an exact-substring Project name lost to
// a fuzzy `Start Codex` in the fifth group and to an unrelated Session in the
// fourth. Group order is now derived from what the rows actually score.
describe('⌘K cross-group ranking (FIX-007)', () => {
  const PROJECTS = [
    {
      id: 'p-atlas',
      name: 'atlas-notes',
      root_path: '/Users/example/Code/atlas-notes',
      color: '#50E6FF',
    },
    {
      id: 'p-lumen',
      name: 'lumen-agent',
      root_path: '/Users/example/Code/lumen-agent',
      color: '#FFB86B',
    },
  ];

  // A Session whose title merely CONTAINS the query, in the group authored
  // above Projects — the `lumen-agent` fixture's collision.
  const PTY_SESSIONS = [
    {
      id: 'pty-1',
      durableSessionId: 'dur-1',
      harness: 'claude' as const,
      title: 'Wire lumen-agent telemetry export',
      cwd: '/Users/example/Code/other',
      projectDir: '/Users/example/Code/other',
      projectName: 'other',
      cols: 80,
      rows: 24,
      startedAt: 1,
      exited: false,
      exitCode: null,
      lastDataAt: 1,
      harnessSessionId: null,
    },
  ];

  const LAUNCH_CONFIGURATIONS: CommandPaletteLaunchConfiguration[] = [
    {
      configurationId: 'launch-codex',
      label: 'Start Codex',
      searchValue: 'Start Codex',
      configuration: {
        kind: 'agent' as const,
        source: 'codex' as const,
        model: 'gpt-5',
        effort: null,
      },
    },
  ];

  beforeEach(() => {
    activeWorkspaceId = 'personal';
    projectFixtures = PROJECTS;
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        pty: {
          list: vi.fn(async () => PTY_SESSIONS),
          closedSessions: vi.fn(async () => []),
        },
        workspace: { load: vi.fn(async () => null) },
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'electron');
  });

  function renderPersonalPalette() {
    return render(
      <TooltipProvider>
        <CommandPalette
          open
          onOpenChange={() => undefined}
          onOpenHelpModal={() => undefined}
          launchConfigurations={LAUNCH_CONFIGURATIONS}
        />
      </TooltipProvider>
    );
  }

  it('ranks the Project above a fuzzy Start row for "atlas"', async () => {
    renderPersonalPalette();
    await waitFor(() => expect(visibleRows().length).toBeGreaterThan(0));
    await typeQuery('atlas');

    const rows = visibleRows();
    expect(rows[0].textContent).toContain('atlas-notes');
    const codex = rows.findIndex(r => r.textContent?.includes('Start Codex'));
    if (codex !== -1) expect(codex).toBeGreaterThan(0);
  });

  it('ranks the exactly-named Project above a Session that contains it', async () => {
    renderPersonalPalette();
    await waitFor(() => expect(visibleRows().length).toBeGreaterThan(0));
    await typeQuery('lumen-agent');

    const rows = visibleRows();
    expect(rows[0].textContent).toContain('lumen-agent');
    // the Session is still findable, just no longer ahead of an exact match
    const session = rows.findIndex(r =>
      r.textContent?.includes('Wire lumen-agent telemetry export')
    );
    if (session !== -1) expect(session).toBeGreaterThan(0);
  });
});

// ── ENG-016 D36/D47 keyboard surface (feedback row f05da191, operator on
// dogfood 0.1.9): "There's no cmd+k or discoverable keyboard shortcut for
// resume this agent." Resume is CONTEXTUAL — absent with nothing parked —
// and both rows lead with the word so the D48 name-prefix band ranks the
// verb over a Session that merely fuzzy-matches it.
describe('⌘K relaunch recovery rows (ENG-016 D36/D47)', () => {
  // Fuzzy-matches "resume" (r·e·s·u·m·e in order) without prefixing it, and
  // renders in the Sessions group ABOVE Workspace — the collision the bands
  // exist to settle.
  const PTY_SESSIONS = [
    {
      id: 'pty-parked',
      durableSessionId: 'dur-parked',
      harness: 'claude' as const,
      title: 'Rebuild the consumer metrics',
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
    },
  ];

  const parked = (
    overrides: Partial<WorkspaceCommandAvailabilityInput> = {}
  ) =>
    deriveWorkspaceCommandAvailability({
      activeProjectName: 'exawatt',
      hasActiveTab: true,
      canToggleSplit: false,
      canClose: true,
      canMoveTabLeft: false,
      canMoveTabRight: false,
      canMoveProjectLeft: false,
      canMoveProjectRight: false,
      hasAttentionTarget: false,
      closedSessionCount: 0,
      resumableAgentCount: 0,
      activeProjectResumableCount: 0,
      activeTabCanResume: false,
      ...overrides,
    });

  beforeEach(() => {
    activeWorkspaceId = 'personal';
    window.history.replaceState({}, '', '/workspace');
    for (const definition of defaultShortcuts) {
      shortcutRegistry.register({ ...definition, action: vi.fn() });
    }
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        pty: {
          list: vi.fn(async () => PTY_SESSIONS),
          closedSessions: vi.fn(async () => []),
        },
        workspace: { load: vi.fn(async () => null) },
      },
    });
  });

  afterEach(() => {
    resetWorkspaceCommandAvailability();
    for (const definition of defaultShortcuts) {
      shortcutRegistry.unregister(definition.id);
    }
    window.history.replaceState({}, '', '/');
    Reflect.deleteProperty(
      window as unknown as Record<string, unknown>,
      'electron'
    );
  });

  function renderWorkspacePalette() {
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

  it('offers no resume verb while nothing is parked', async () => {
    publishWorkspaceCommandAvailability(parked());
    renderWorkspacePalette();
    await waitFor(() => expect(visibleRows().length).toBeGreaterThan(0));
    await typeQuery('resume');

    const rows = visibleRows();
    expect(rows.some(r => r.textContent?.includes('Resume'))).toBe(false);
    // and the verbs are ABSENT, not greyed: no disabled row either
    const disabled = Array.from(
      document.querySelectorAll('[cmdk-item][aria-disabled="true"]')
    ).map(el => el.textContent ?? '');
    expect(disabled.some(text => text.includes('Resume'))).toBe(false);
  });

  it('ranks both recovery verbs above a fuzzy Session for "resume"', async () => {
    publishWorkspaceCommandAvailability(
      parked({
        resumableAgentCount: 4,
        activeProjectResumableCount: 2,
        activeTabCanResume: true,
      })
    );
    renderWorkspacePalette();
    await waitFor(() => expect(visibleRows().length).toBeGreaterThan(0));
    await typeQuery('resume');

    const rows = visibleRows();
    expect(rows[0].textContent).toContain('Resume this Agent');
    expect(rows[1].textContent).toContain('Resume 2 parked Agents in exawatt');
    const session = rows.findIndex(r =>
      r.textContent?.includes('Rebuild the consumer metrics')
    );
    if (session !== -1) expect(session).toBeGreaterThan(1);
  });

  it('shows the rebindable chord beside each row', async () => {
    publishWorkspaceCommandAvailability(
      parked({
        resumableAgentCount: 4,
        activeProjectResumableCount: 2,
        activeTabCanResume: true,
      })
    );
    renderWorkspacePalette();
    await waitFor(() => expect(visibleRows().length).toBeGreaterThan(0));
    await typeQuery('resume');

    const rows = visibleRows();
    expect(rows[0].textContent).toContain('⌘⌥R');
    expect(rows[1].textContent).toContain('⌘⌥⇧R');
  });

  it('names the recovery bar’s own scope when this Project has nothing parked', async () => {
    publishWorkspaceCommandAvailability(
      parked({ resumableAgentCount: 3, activeProjectResumableCount: 0 })
    );
    renderWorkspacePalette();
    await waitFor(() => expect(visibleRows().length).toBeGreaterThan(0));
    await typeQuery('resume');

    const rows = visibleRows();
    expect(rows[0].textContent).toContain('Resume all 3 parked Agents');
    // the selected Agent is live — its verb is not offered
    expect(rows.some(r => r.textContent?.includes('Resume this Agent'))).toBe(
      false
    );
  });

  it('asks the workspace to resume, carrying no identity of its own', async () => {
    publishWorkspaceCommandAvailability(
      parked({
        resumableAgentCount: 4,
        activeProjectResumableCount: 2,
        activeTabCanResume: true,
      })
    );
    const requests: string[] = [];
    const onAgent = () => requests.push(RESUME_ACTIVE_AGENT_EVENT);
    const onScope = () => requests.push(RESUME_PARKED_SCOPE_EVENT);
    window.addEventListener(RESUME_ACTIVE_AGENT_EVENT, onAgent);
    window.addEventListener(RESUME_PARKED_SCOPE_EVENT, onScope);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderWorkspacePalette();
      await waitFor(() => expect(visibleRows().length).toBeGreaterThan(0));
      await typeQuery('resume this agent');

      fireEvent.keyDown(paletteInput(), { key: 'Enter' });
      await vi.advanceTimersByTimeAsync(100);
      expect(requests).toEqual([RESUME_ACTIVE_AGENT_EVENT]);
    } finally {
      vi.useRealTimers();
      window.removeEventListener(RESUME_ACTIVE_AGENT_EVENT, onAgent);
      window.removeEventListener(RESUME_PARKED_SCOPE_EVENT, onScope);
    }
  });
});
