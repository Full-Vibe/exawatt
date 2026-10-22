/**
 * Right-click and ⌘K never diverge (operator, 2026-10-22: "Need cmd+k
 * keyboard shortcut for mark unread. For that and all such things in the
 * future - should never diverge right-click menu items and cmd+k
 * availability.").
 *
 * For every target a context menu can open on (each kind of tab, each
 * Project, the terminal), this renders the REAL menu and the REAL palette
 * with that target selected and compares what each offers: the same
 * commands, the same disabled states, the same labels. Both directions: a
 * menu row missing from ⌘K fails, and a ⌘K row missing from the menu fails.
 * The only rows allowed in one surface alone are the declared menu-only
 * commands, each with a written reason, and an announced row (which is not a
 * command and is never in ⌘K).
 */
import { useState } from 'react';
import {
  act,
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
import { TooltipProvider } from '@/components/ui/tooltip';
import { CommandPalette } from '@/components/shortcuts/command-palette';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';
import { fleetAttention, mergeFleetAttention } from './status-glyphs';
import { TabStrip } from './tab-strip';
import { TerminalPane } from './terminal-pane';
import {
  publishCommandSubjects,
  resetCommandSubjects,
} from './command-subjects';
import {
  findCommandTarget,
  MENU_ONLY_TARGET_COMMANDS,
  paletteTargetCommands,
  resolveTargetCommands,
  type CommandTarget,
  type TargetCommandOps,
  type TargetCommandScope,
} from './target-commands';
import type { CloneSessionTarget } from './session-clone';
import type {
  Project,
  RemoteAgentTab,
  SessionTab,
} from './use-workspace-state';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/components/nav/command-navigation-provider', () => ({
  useCommandNavigation: () => ({
    navigateCommandSurface: vi.fn(),
    activateCommandAltitude: vi.fn(),
  }),
}));
vi.mock('@/components/appearance/appearance-provider', async () => {
  const { THEME_REGISTRY } = await import('@/generated/theme-registry');
  const { DEFAULT_APPEARANCE_PREFERENCES, resolveAppearance } =
    await import('@/lib/appearance/resolve-appearance');
  const appearance = {
    preferences: DEFAULT_APPEARANCE_PREFERENCES,
    resolved: resolveAppearance(
      THEME_REGISTRY,
      DEFAULT_APPEARANCE_PREFERENCES,
      {
        dark: true,
        highContrast: false,
        forcedColors: false,
        invertedColors: false,
        reducedTransparency: false,
      }
    ),
    previewTheme: vi.fn(),
    cancelPreview: vi.fn(),
    commitPreferences: vi.fn(),
  };
  return { useAppearance: () => appearance };
});
vi.mock('@/components/feedback/product-feedback-provider', () => ({
  useOptionalProductFeedback: () => null,
}));
vi.mock('@/lib/projects/registry', () => ({
  listProjects: vi.fn(async () => []),
  rebindProjectPath: vi.fn(async () => undefined),
}));
vi.mock('@/lib/tenancy/tenancy-provider', () => ({
  useOptionalWorkspaceTenancy: () => ({
    hydrated: true,
    activeWorkspace: { id: 'personal' },
    workspaces: [],
    switchWorkspace: vi.fn(),
  }),
}));

// ── A workspace with one of everything a menu can open on ─────────────────

function session(overrides: Partial<SessionTab> & { id: string }): SessionTab {
  return {
    kind: 'session',
    durableSessionId: `durable-${overrides.id}`,
    harness: 'claude',
    title: overrides.id,
    titleKind: 'operator',
    cwd: '/repo',
    sessionId: `pty-${overrides.id}`,
    harnessSessionId: null,
    resumeState: 'live',
    lifecycle: 'running',
    exitCode: null,
    roadmapItemId: null,
    initialTask: null,
    ...overrides,
  };
}

const live = session({ id: 'live', initialTask: 'Fix the login race' });
const stopped = session({
  id: 'stopped',
  sessionId: null,
  harnessSessionId: 'provider-stopped',
  resumeState: 'ended-resumable',
  lifecycle: 'stopped-clean',
  exitCode: 0,
});
const shell = session({ id: 'shell', harness: 'shell', title: 'zsh' });
const draft = session({
  id: 'draft',
  sessionId: null,
  lifecycle: 'draft',
  titleKind: 'default',
});
const coworker: RemoteAgentTab = {
  kind: 'remote-agent',
  id: 'coworker',
  title: 'Scout',
  sourceId: 'source-1',
  nativeAgentId: 'native-1',
  agentId: 'agent-1',
  projectLabel: 'repo',
};

const PROJECTS: Project[] = [
  {
    dir: '/repo',
    name: 'repo',
    color: '#19E6FF',
    tabs: [live, stopped, shell, draft, coworker],
    activeTabId: live.id,
  },
  {
    dir: '/other',
    name: 'other',
    color: '#FF3B8B',
    tabs: [session({ id: 'other-agent', cwd: '/other' })],
    activeTabId: 'other-agent',
  },
  // A folderless Project: no Finder, no new local Agent.
  {
    dir: 'project:folderless',
    rootPath: null,
    name: 'notes',
    color: '#FFB02E',
    tabs: [],
    activeTabId: null,
  },
];

const CLONE_TARGETS: CloneSessionTarget[] = [
  {
    id: 'agent:codex:gpt:high',
    sourceId: 'codex-local',
    source: 'codex',
    modelId: 'gpt',
    effort: 'high',
    label: 'GPT Codex',
    detail: 'High',
    accessibleLabel: 'Codex, GPT Codex, High',
  },
];

/** Every operation present, so every command a target supports is offered. */
function everyOp(): Required<TargetCommandOps> {
  return {
    closeTab: vi.fn(),
    markUnread: vi.fn(),
    resumeTab: vi.fn(),
    cloneTab: vi.fn(),
    togglePinTab: vi.fn(),
    moveTab: vi.fn(),
    revealPath: vi.fn(),
    openCloud: vi.fn(),
    newAgent: vi.fn(),
    pauseProject: vi.fn(),
    resumeProject: vi.fn(),
    moveProject: vi.fn(),
    closeProject: vi.fn(),
  };
}

function scopeWith(ops: TargetCommandOps): TargetCommandScope {
  return {
    ops,
    facts: {
      projects: PROJECTS,
      pinnedTabId: stopped.id,
      summaries: {},
      engaged: { [live.sessionId!]: true },
      agentNames: new Map(),
      cloneTargets: CLONE_TARGETS,
    },
  };
}

// ── Reading each surface ──────────────────────────────────────────────────

interface Offered {
  id: string;
  disabled: boolean;
  /** null for a drill-in choice, which ⌘K names with its verb prefixed */
  label: string | null;
}

const byId = (rows: Offered[]) =>
  [...rows].sort((a, b) => a.id.localeCompare(b.id));

/** The open context menu's commands, drill-ins expanded to their choices. */
function readMenu(): Offered[] {
  const menu = screen.getByRole('menu');
  const rows = (): HTMLElement[] =>
    Array.from(menu.querySelectorAll<HTMLElement>('[data-command-id]'));
  const offered: Offered[] = [];
  for (const row of rows()) {
    const id = row.getAttribute('data-command-id')!;
    if (row.textContent?.includes('›')) {
      fireEvent.click(row);
      for (const child of rows()) {
        offered.push({
          id: child.getAttribute('data-command-id')!,
          disabled: child.getAttribute('aria-disabled') === 'true',
          label: null,
        });
      }
      fireEvent.click(screen.getByRole('menuitem', { name: /^Back from/ }));
      continue;
    }
    offered.push({
      id,
      disabled: row.getAttribute('aria-disabled') === 'true',
      label: row.querySelector('span > span.truncate')?.textContent ?? null,
    });
  }
  return offered.filter(row => !MENU_ONLY_TARGET_COMMANDS.has(row.id));
}

function readPalette(): Offered[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-palette-subject] [cmdk-item][data-command-id]'
    )
  ).map(row => {
    const id = row.getAttribute('data-command-id')!;
    return {
      id,
      disabled: row.getAttribute('aria-disabled') === 'true',
      label: id.includes(':')
        ? null
        : (row.querySelector('span.truncate')?.textContent ?? null),
    };
  });
}

function Palette() {
  const [open, setOpen] = useState(true);
  return (
    <CommandPalette
      open={open}
      onOpenChange={setOpen}
      onOpenHelpModal={() => undefined}
    />
  );
}

async function paletteOffers(
  target: CommandTarget,
  scope: TargetCommandScope
): Promise<Offered[]> {
  publishCommandSubjects({ subjects: [target], scope });
  render(
    <TooltipProvider>
      <Palette />
    </TooltipProvider>
  );
  await waitFor(() =>
    expect(
      document.querySelector('[cmdk-group][data-palette-group="navigation"]')
    ).not.toBeNull()
  );
  const rows = readPalette();
  cleanup();
  resetCommandSubjects();
  return rows;
}

function menuOffers(
  target: Exclude<CommandTarget, { kind: 'terminal' }>,
  ops: TargetCommandOps
): Offered[] {
  const { facts } = scopeWith(ops);
  const { container } = render(
    <TooltipProvider>
      <TabStrip
        projects={PROJECTS}
        activeDir={target.project.dir}
        pinnedTabId={facts.pinnedTabId}
        summaries={{}}
        engaged={facts.engaged}
        attention={mergeFleetAttention(fleetAttention('pty', {}))}
        commands={ops}
        cloneTargets={CLONE_TARGETS}
        onSelectProject={vi.fn()}
        onSelectTab={vi.fn()}
        onRenameTab={vi.fn()}
        onRenameProject={vi.fn()}
        onSetProjectColor={vi.fn()}
      />
    </TooltipProvider>
  );
  const anchor =
    target.kind === 'project'
      ? container.querySelector(
          `[data-ribbon-project-header="${target.project.dir}"]`
        )
      : container.querySelector(`[data-tab-id="${target.tab.id}"]`);
  fireEvent.contextMenu(anchor!);
  const rows = readMenu();
  cleanup();
  return rows;
}

const ALL_TARGETS = PROJECTS.flatMap(project => [
  findCommandTarget(PROJECTS, { kind: 'project', dir: project.dir })!,
  ...project.tabs.map(
    tab => findCommandTarget(PROJECTS, { kind: 'tab', tabId: tab.id })!
  ),
]);

const describeTarget = (target: CommandTarget) =>
  target.kind === 'project'
    ? `Project ${target.project.name}`
    : target.kind === 'terminal'
      ? 'terminal'
      : `${target.kind} ${target.tab.id}`;

// ── The contract ──────────────────────────────────────────────────────────

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
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/workspace');
  installBridgeDouble({
    pty: {
      list: vi.fn(async () => []),
      closedSessions: vi.fn(async () => []),
    },
    workspace: { load: vi.fn(async () => null) },
  });
});

afterEach(() => {
  cleanup();
  resetCommandSubjects();
  removeBridgeDouble();
  window.history.replaceState({}, '', '/');
});

describe('right-click and ⌘K offer the same commands for the same target', () => {
  it.each(ALL_TARGETS.map(target => [describeTarget(target), target]))(
    '%s',
    async (_name, target) => {
      const ops = everyOp();
      const menu = menuOffers(target, ops);
      const palette = await paletteOffers(target, scopeWith(ops));
      expect(menu.length, 'the menu offers something').toBeGreaterThan(0);
      expect(byId(palette)).toEqual(byId(menu));
    }
  );

  // One target per case: a case renders one menu and one palette, so its
  // cost does not grow with the workspace fixture.
  it.each(ALL_TARGETS.map(target => [describeTarget(target), target]))(
    'holds in a shell that lacks operations (the Demo has no Finder): %s',
    async (_name, target) => {
      const ops: TargetCommandOps = {
        closeTab: vi.fn(),
        markUnread: vi.fn(),
        moveTab: vi.fn(),
        pauseProject: vi.fn(),
      };
      const menu = menuOffers(target, ops);
      const palette = await paletteOffers(target, scopeWith(ops));
      expect(byId(palette)).toEqual(byId(menu));
    }
  );

  it('holds for the terminal', async () => {
    // Without a PTY bridge the pane mounts no xterm; its menu does not need one.
    removeBridgeDouble();
    const { container } = render(
      <TerminalPane sessionId="pty-live" cwd="/repo" active />
    );
    fireEvent.contextMenu(container.querySelector('.terminal-pane')!);
    const menu = readMenu();
    cleanup();
    installBridgeDouble({
      pty: {
        list: vi.fn(async () => []),
        closedSessions: vi.fn(async () => []),
      },
      workspace: { load: vi.fn(async () => null) },
    });
    const palette = await paletteOffers(
      { kind: 'terminal', sessionId: 'pty-live', link: null },
      scopeWith(everyOp())
    );
    expect(menu.length).toBeGreaterThan(0);
    expect(byId(palette)).toEqual(byId(menu));
  });

  it('writes down why each menu-only command cannot be in ⌘K', () => {
    // Expect none beyond the pointer's own link rows; a new entry here is a
    // product decision, not a test edit.
    expect([...MENU_ONLY_TARGET_COMMANDS.keys()].sort()).toEqual([
      'terminal.copy-link',
      'terminal.open-link',
    ]);
    for (const reason of MENU_ONLY_TARGET_COMMANDS.values()) {
      expect(reason.trim().length).toBeGreaterThanOrEqual(40);
      expect(reason.trim().endsWith('.')).toBe(true);
    }
  });
});

describe('Escape closes ⌘K from every command row', () => {
  const TERMINAL: CommandTarget = {
    kind: 'terminal',
    sessionId: 'pty-live',
    link: null,
  };
  // One row per case, enumerated from the projection ⌘K renders, so a case
  // opens the palette once and its cost does not grow with the row count.
  const ROWS = [...ALL_TARGETS, TERMINAL].flatMap(target =>
    paletteTargetCommands(
      resolveTargetCommands(target, scopeWith(everyOp()))
    ).map(
      row => [`${describeTarget(target)} › ${row.id}`, target, row.id] as const
    )
  );
  it.each(ROWS)('%s', async (_name, target, id) => {
    const ops = everyOp();
    publishCommandSubjects({ subjects: [target], scope: scopeWith(ops) });
    const changes: boolean[] = [];
    function Closable() {
      const [open, setOpen] = useState(true);
      return (
        <CommandPalette
          open={open}
          onOpenChange={next => {
            changes.push(next);
            setOpen(next);
          }}
          onOpenHelpModal={() => undefined}
        />
      );
    }
    render(
      <TooltipProvider>
        <Closable />
      </TooltipProvider>
    );
    const row = await waitFor(() => {
      const element = document.querySelector<HTMLElement>(
        `[data-palette-subject] [cmdk-item][data-command-id="${CSS.escape(id)}"]`
      );
      expect(element).not.toBeNull();
      return element!;
    });
    // the row under the pointer is the one Escape leaves from
    fireEvent.pointerMove(row);
    fireEvent.keyDown(
      screen.getByPlaceholderText('Type a command or search...'),
      {
        key: 'Escape',
      }
    );
    expect(changes).toEqual([false]);
    await waitFor(() =>
      expect(document.querySelector('[cmdk-root]')).toBeNull()
    );
    // Escape ran no command on the way out
    for (const [name, op] of Object.entries(ops)) {
      expect(op, name).not.toHaveBeenCalled();
    }
  });
});

describe('Mark unread from ⌘K', () => {
  it('marks the selected Agent unread through the shell’s own operation', async () => {
    const ops = everyOp();
    publishCommandSubjects({
      subjects: [findCommandTarget(PROJECTS, { kind: 'tab', tabId: live.id })!],
      scope: scopeWith(ops),
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        <TooltipProvider>
          <Palette />
        </TooltipProvider>
      );
      const input = screen.getByPlaceholderText('Type a command or search...');
      fireEvent.change(input, { target: { value: 'unread' } });
      await waitFor(() =>
        expect(
          document.querySelector(
            '[cmdk-item][data-command-id="session.mark-unread"][aria-selected="true"]'
          )
        ).not.toBeNull()
      );
      fireEvent.keyDown(input, { key: 'Enter' });
      await act(() => vi.advanceTimersByTimeAsync(100));
      expect(ops.markUnread).toHaveBeenCalledExactlyOnceWith(live.id);
    } finally {
      vi.useRealTimers();
    }
  });
});
