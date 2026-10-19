import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  HarnessProjectSuggestion,
  HarnessStoreRead,
} from '@exawatt/core/desktop-bridge';
import type { AgentSourceRegistrySnapshot } from '@exawatt/core';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';
import { localAgentSourceDeclaration } from '@/generated/agent-source-declarations';
import { LAUNCH_EVENT, consumePendingLaunch } from '../session-jump';
import { StartScreen } from './start-screen';
import { YourProjects, type SuggestionOpen } from './your-projects';
import { installedEngines } from './agents-you-can-run';
import {
  FIXTURE_NOW,
  registryWith,
  storeReads,
  suggestionFixture,
} from './start-screen-fixtures';

afterEach(() => {
  cleanup();
  removeBridgeDouble();
});

function bridge({
  registry,
  suggestions = [],
  stores = storeReads(),
}: {
  registry: AgentSourceRegistrySnapshot;
  suggestions?: HarnessProjectSuggestion[];
  stores?: HarnessStoreRead[];
}) {
  const read = vi.fn(async () => ({
    ok: true as const,
    suggestions,
    stores,
    readAt: FIXTURE_NOW,
  }));
  installBridgeDouble({
    agentSources: {
      list: async () => registry,
      remembered: async () => registry,
    },
    projects: { suggestions: read },
  });
  return read;
}

function renderStart() {
  const props = {
    connectSupported: true,
    onOpenSuggestion: vi.fn(async () => true),
    onOpenAllSuggestions: vi.fn(async (_opens: SuggestionOpen[]) => true),
    onBrowse: vi.fn(),
    onImport: vi.fn(),
    onConnect: vi.fn(),
  };
  render(<StartScreen {...props} />);
  return props;
}

async function settle() {
  await act(async () => {});
  await act(async () => {});
}

describe('Agents you can run', () => {
  it('shows a card for each installed engine only, plus one way to add more', async () => {
    const registry = registryWith({
      claude: 'ready',
      antigravity: 'action-required',
    });
    bridge({ registry });
    renderStart();
    await settle();

    const cards = [
      ...document.querySelectorAll<HTMLElement>('[data-source-card]'),
    ].map(card => card.dataset.sourceCard);
    expect(cards.sort()).toEqual(
      installedEngines(registry)
        .map(source => source.adapterId)
        .sort()
    );
    expect(document.querySelectorAll('[data-add-engine]')).toHaveLength(1);
  });

  it('gives an installed engine that is not ready exactly one next step', async () => {
    bridge({
      registry: registryWith({
        claude: 'ready',
        antigravity: 'action-required',
      }),
    });
    renderStart();
    await settle();
    const ready = document.querySelector('[data-source-card="claude"]')!;
    const signedOut = document.querySelector(
      '[data-source-card="antigravity"]'
    )!;
    expect(ready.querySelectorAll('[data-source-step]')).toHaveLength(0);
    expect(signedOut.querySelectorAll('[data-source-step]')).toHaveLength(1);
  });

  it('signs an engine in through an Exawatt Shell, never through main (BUG-275)', async () => {
    const act_ = vi.fn();
    installBridgeDouble({
      agentSources: {
        list: async () => registryWith({ claude: 'action-required' }),
        remembered: async () => registryWith({ claude: 'action-required' }),
        act: act_,
      },
      projects: {
        suggestions: vi.fn(async () => ({
          ok: true as const,
          suggestions: [],
          stores: storeReads(),
          readAt: FIXTURE_NOW,
        })),
      },
    });
    const launches: unknown[] = [];
    const onLaunch = (event: Event) =>
      launches.push((event as CustomEvent).detail);
    window.addEventListener(LAUNCH_EVENT, onLaunch);
    renderStart();
    await settle();
    const card = document.querySelector('[data-source-card="claude"]')!;
    fireEvent.click(card.querySelector('[data-source-step]')!);
    window.removeEventListener(LAUNCH_EVENT, onLaunch);
    consumePendingLaunch();
    expect(launches).toEqual([
      {
        harness: 'shell',
        shellCommand: localAgentSourceDeclaration('claude').signIn.command,
      },
    ]);
    expect(act_).not.toHaveBeenCalled();
  });

  it('with no engine installed, the Add an engine card is the whole remediation', async () => {
    bridge({ registry: registryWith({}) });
    renderStart();
    await settle();
    expect(document.querySelectorAll('[data-source-card]')).toHaveLength(0);
    expect(
      document
        .querySelector('[data-add-engine]')
        ?.getAttribute('data-add-engine')
    ).toBe('alone');
  });
});

describe('Your projects on the Start screen', () => {
  const rows = [
    suggestionFixture('northwind', ['codex', 'claude'], 1),
    suggestionFixture('ledger', ['antigravity'], 4),
    suggestionFixture('legacy', ['claude'], 60),
  ];

  it('opens a row through the caller with the engine it recommends', async () => {
    bridge({ registry: registryWith({ claude: 'ready' }), suggestions: rows });
    const props = renderStart();
    await settle();
    fireEvent.click(
      document.querySelector(`[data-project-suggestion="${rows[0].path}"]`)!
    );
    await settle();
    // Codex knows the folder first but is not installed; Claude Code is.
    expect(props.onOpenSuggestion).toHaveBeenCalledWith({
      suggestion: rows[0],
      source: 'claude',
    });
  });

  it('keeps older rows behind Show older and opens only recent ones together', async () => {
    bridge({ registry: registryWith({ claude: 'ready' }), suggestions: rows });
    const props = renderStart();
    await settle();
    const listed = () =>
      [...document.querySelectorAll('[data-project-suggestion]')].map(row =>
        row.getAttribute('data-project-suggestion')
      );
    const recent = rows.filter(row => row.recent).map(row => row.path);
    expect(listed()).toEqual(recent);

    fireEvent.click(document.querySelector('[data-open-all-recent]')!);
    await settle();
    expect(
      props.onOpenAllSuggestions.mock.calls[0]?.[0].map(
        open => open.suggestion.path
      )
    ).toEqual(recent);

    fireEvent.click(document.querySelector('[data-show-older]')!);
    expect(listed()).toEqual(rows.map(row => row.path));
  });

  it('asks for a folder when no store suggests anything, with every route', async () => {
    bridge({ registry: registryWith({ claude: 'ready' }), suggestions: [] });
    const props = renderStart();
    await settle();
    expect(
      document
        .querySelector('[data-your-projects]')
        ?.getAttribute('data-your-projects')
    ).toBe('empty');
    const routes = document.querySelector('[data-project-routes]')!;
    fireEvent.click(within(routes as HTMLElement).getByText(/Browse/));
    fireEvent.click(within(routes as HTMLElement).getByText(/Import/));
    fireEvent.click(within(routes as HTMLElement).getByText(/Connect/));
    expect(props.onBrowse).toHaveBeenCalledOnce();
    expect(props.onImport).toHaveBeenCalledOnce();
    expect(props.onConnect).toHaveBeenCalledOnce();
  });
});

describe('a store that could not be read', () => {
  it('is named beside the rows the other stores still give, never folded into an empty list', async () => {
    const codexRow = suggestionFixture('ops', ['codex'], 2);
    bridge({
      registry: registryWith({ codex: 'ready' }),
      suggestions: [codexRow],
      stores: storeReads({
        'claude-code-config': {
          status: 'unreadable',
          reason: 'not valid JSON',
        },
      }),
    });
    renderStart();
    await settle();
    expect(document.querySelectorAll('[data-project-suggestion]')).toHaveLength(
      1
    );
    expect(
      document.querySelectorAll('[data-suggestion-diagnostic]')
    ).toHaveLength(1);
  });
});

describe('Your projects in the chooser', () => {
  it('lists nothing a library row already carries, and nothing at all when empty', async () => {
    const rows = [
      suggestionFixture('northwind', ['claude'], 1),
      suggestionFixture('ledger', ['codex'], 2),
    ];
    bridge({ registry: registryWith({ claude: 'ready' }), suggestions: rows });
    const view = render(
      <YourProjects
        registry={registryWith({ claude: 'ready' })}
        hiddenPaths={new Set([rows[0].path])}
        onOpen={async () => true}
        onOpenAll={async () => true}
      />
    );
    await settle();
    expect(
      [...document.querySelectorAll('[data-project-suggestion]')].map(row =>
        row.getAttribute('data-project-suggestion')
      )
    ).toEqual([rows[1].path]);

    view.rerender(
      <YourProjects
        registry={registryWith({ claude: 'ready' })}
        hiddenPaths={new Set(rows.map(row => row.path))}
        onOpen={async () => true}
        onOpenAll={async () => true}
      />
    );
    expect(document.querySelector('[data-your-projects]')).toBeNull();
  });

  it('is absent outside the desktop app rather than an empty list', async () => {
    removeBridgeDouble();
    render(
      <YourProjects
        registry={registryWith({})}
        onOpen={async () => true}
        onOpenAll={async () => true}
      />
    );
    await settle();
    expect(document.querySelector('[data-your-projects]')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
