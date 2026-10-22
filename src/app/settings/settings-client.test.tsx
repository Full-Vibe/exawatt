import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultShortcuts, shortcutRegistry } from '@/lib/shortcuts';
import { PresentationProvider } from '@/components/presentation/presentation-provider';
import { GoalVisualPreferenceProvider } from '@/components/goal-visuals/goal-visual-preference-provider';
import { PERMISSIONS } from '@exawatt/core';
import { OUTBOUND_CONTROLS } from '@/lib/hosted-features/contract';
import { SettingsClient } from './settings-client';
import { SETTINGS_DESTINATIONS, settingsHref } from './settings-registry';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';

vi.mock('@/lib/goal-visuals/preference-source', () => ({
  createGoalVisualPreferenceSource: () => ({
    kind: 'web' as const,
    // Shortcut policy does not own preference hydration. Keep that unrelated
    // async update pending so it cannot escape the render act.
    load: () => new Promise<boolean>(() => undefined),
    save: async (enabled: boolean) => enabled,
    subscribe: () => () => undefined,
  }),
}));

// The Privacy section reads the goal-visual preference, mounted app-wide in
// layout.tsx — the test harness mirrors that mounting context.
async function renderSettings() {
  const view = render(
    <PresentationProvider>
      <GoalVisualPreferenceProvider>
        <SettingsClient />
      </GoalVisualPreferenceProvider>
    </PresentationProvider>
  );
  await act(async () => undefined);
  return view;
}

function outboundRow(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-outbound-control="${id}"]`);
}

// Overrides are per-device state, not account state (BUG-044): what a rebind
// has to reach is the device store, and the account sync behind it is
// best-effort. Asserting the store call is asserting the durable act.
const { saveShortcutOverrides } = vi.hoisted(() => ({
  saveShortcutOverrides: vi.fn(async () => undefined),
}));

vi.mock('@/lib/shortcuts/preference-source', () => ({
  loadShortcutOverrides: vi.fn(async () => []),
  saveShortcutOverrides,
  resetShortcutOverrides: vi.fn(async () => undefined),
}));

vi.mock('./appearance-settings', () => ({
  AppearanceSettings: () => <div data-appearance-settings />,
}));

// The section stands in for the real one, but it keeps the prop that matters
// here: whether Settings actually hands it a route to Connect a server.
// Without one, the empty state has nothing for an operator to press.
vi.mock('./agent-sources-settings', () => ({
  AgentSourcesSettings: ({
    onConnectExistingAgent,
  }: {
    onConnectExistingAgent?: () => void;
  }) => (
    <div data-agent-sources-settings>
      {onConnectExistingAgent ? (
        <button type="button" onClick={onConnectExistingAgent}>
          Connect a server
        </button>
      ) : (
        <span data-no-connect-route />
      )}
    </div>
  ),
}));

function editShortcut(label: string): HTMLElement {
  if (!screen.queryByText(label)) {
    fireEvent.click(screen.getByRole('link', { name: 'Keyboard shortcuts' }));
  }
  const row = screen.getByText(label).closest('.group');
  if (!(row instanceof HTMLElement)) throw new Error(`No row for ${label}`);
  fireEvent.click(within(row).getByRole('button'));
  const capture = document.querySelector<HTMLElement>(
    '[data-shortcut-capture]'
  );
  if (!capture) throw new Error('Shortcut capture surface did not open');
  return capture;
}

describe('shortcut settings policy', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/settings?section=keyboard');
    installBridgeDouble({ platform: 'darwin' });
    for (const definition of defaultShortcuts) {
      shortcutRegistry.register({ ...definition, action: vi.fn() });
    }
    saveShortcutOverrides.mockClear();
  });

  afterEach(() => {
    cleanup();
    shortcutRegistry.resetAllOverrides();
    for (const definition of defaultShortcuts) {
      shortcutRegistry.unregister(definition.id);
    }
    removeBridgeDouble();
  });

  it('rejects a bare universal binding and accepts a Command binding', async () => {
    await renderSettings();
    const capture = editShortcut('Agent');

    fireEvent.keyDown(capture, { key: 'm', code: 'KeyM' });
    expect(screen.getByText(/must include ⌘/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    // bare ⌘digit now belongs to the fixed Session-tab family (D18)
    fireEvent.keyDown(capture, {
      key: '4',
      code: 'Digit4',
      metaKey: true,
    });
    expect(
      screen.getByText(/reserved for Session tab switching/)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.keyDown(capture, {
      key: '&',
      code: 'Digit7',
      metaKey: true,
      shiftKey: true,
    });
    expect(screen.queryByText(/must include ⌘/)).not.toBeInTheDocument();
    expect(screen.queryByText(/reserved for/)).not.toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(saveShortcutOverrides).toHaveBeenCalledOnce());
    expect(shortcutRegistry.getEffectiveKeys('command-terminal')).toEqual({
      key: '7',
      modifiers: ['meta', 'shift'],
    });
  });

  it('blocks a combo the machine VERIFIABLY reserves, with the System Settings pointer', async () => {
    // Electron reports untouched prefs ({}), so Apple defaults are the
    // machine truth: ⇧⌘4 really is area-screenshot and can never fire here.
    installBridgeDouble({
      platform: 'darwin',
      shortcuts: { systemHotkeys: vi.fn(async () => ({})) },
    });
    await renderSettings();
    await waitFor(() =>
      expect(
        window.electron!.shortcuts!.systemHotkeys as ReturnType<typeof vi.fn>
      ).toHaveBeenCalled()
    );
    const capture = editShortcut('Agent');
    fireEvent.keyDown(capture, {
      key: '$',
      code: 'Digit4',
      metaKey: true,
      shiftKey: true,
    });
    // A real desktop also names System Settings in the Files and Folders
    // note, so the pointer is read from the conflict message itself.
    expect(screen.getByText(/Save picture of selected area/)).toHaveTextContent(
      /System Settings/
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('allows a system combo the user has freed in System Settings', async () => {
    // The operator scenario: area-screenshot (id 30) disabled in sysprefs —
    // ⇧⌘4 is genuinely free on this machine and must be bindable.
    installBridgeDouble({
      platform: 'darwin',
      shortcuts: {
        systemHotkeys: vi.fn(async () => ({
          AppleSymbolicHotKeys: {
            '30': { enabled: false },
            '31': { enabled: false },
          },
        })),
      },
    });
    await renderSettings();
    await waitFor(() =>
      expect(
        window.electron!.shortcuts!.systemHotkeys as ReturnType<typeof vi.fn>
      ).toHaveBeenCalled()
    );
    const capture = editShortcut('Agent');
    fireEvent.keyDown(capture, {
      key: '$',
      code: 'Digit4',
      metaKey: true,
      shiftKey: true,
    });
    expect(screen.queryByText(/Save picture/)).not.toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(saveShortcutOverrides).toHaveBeenCalledOnce());
    expect(shortcutRegistry.getEffectiveKeys('command-terminal')).toEqual({
      key: '4',
      modifiers: ['meta', 'shift'],
    });
  });

  it('warns without blocking when system prefs cannot be read (web fallback)', async () => {
    // No Electron bridge: Apple defaults are only a likelihood, so ⇧⌘4
    // shows the unverified warning but stays saveable.
    await renderSettings();
    const capture = editShortcut('Agent');
    fireEvent.keyDown(capture, {
      key: '$',
      code: 'Digit4',
      metaKey: true,
      shiftKey: true,
    });
    expect(screen.getByText(/usually reserved by macOS/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('gives data sharing its own section instead of a Preferences corner', async () => {
    installBridgeDouble({
      platform: 'darwin',
      settings: {
        get: vi.fn(async () => ({})),
        onChanged: vi.fn(() => () => undefined),
        setHostedConversationSummaries: vi.fn(async () => ({})),
        setHostedContextLabels: vi.fn(async () => ({})),
      },
    });
    await renderSettings();

    fireEvent.click(screen.getByRole('link', { name: 'Notifications' }));
    expect(
      screen.getByRole('switch', { name: 'Native macOS notifications' })
    ).toBeVisible();
    for (const control of Object.values(OUTBOUND_CONTROLS)) {
      expect(outboundRow(control.id)).toBeNull();
    }

    fireEvent.click(screen.getByRole('link', { name: 'Privacy' }));
    await act(async () => undefined);
    expect(screen.getByRole('heading', { name: 'Privacy' })).toBeVisible();
    // Every control gets its row and its disclosure here. WHETHER a row also
    // carries a switch is the distribution's business rather than this
    // section's — a capability this build does not configure renders as "not
    // configured" instead (BUG-060) — and `privacy-settings.test.tsx` owns
    // that distinction. This test is about which section is showing.
    for (const control of Object.values(OUTBOUND_CONTROLS)) {
      expect(outboundRow(control.id)).not.toBeNull();
    }
  });

  it('gives permissions their own section in the Settings navigation', async () => {
    await renderSettings();

    fireEvent.click(screen.getByRole('link', { name: 'Permissions' }));
    await act(async () => undefined);
    expect(screen.getByRole('heading', { name: 'Permissions' })).toBeVisible();
    for (const permission of PERMISSIONS) {
      expect(
        document.querySelector(`[data-permission="${permission.id}"]`)
      ).not.toBeNull();
    }
  });

  it('rejects a physical Project ordinal even when Option changes its character', async () => {
    await renderSettings();
    const capture = editShortcut('Agent');

    fireEvent.keyDown(capture, {
      key: '¢',
      code: 'Digit4',
      metaKey: true,
      altKey: true,
    });

    expect(
      screen.getByText(/reserved for Project switching/)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('Settings: the Connect route', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/settings');
    installBridgeDouble({ platform: 'darwin' });
  });

  afterEach(() => {
    cleanup();
    removeBridgeDouble();
  });

  /*
   * Agent Sources is where an operator with nothing connected lands, so the
   * route has to exist on this page rather than being named as a chord in its
   * empty state. Settings owns the dialog and hands the section an opener.
   */
  it('hands the sources section a route and opens the flow on it', async () => {
    await renderSettings();
    expect(document.querySelector('[data-no-connect-route]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Connect a server' }));
    await act(async () => undefined);

    const dialog = document.querySelector('[data-connect-source]');
    expect(dialog).not.toBeNull();
    expect(
      screen.getByRole('heading', { name: 'Connect a server' })
    ).toBeVisible();
  });
});

describe('Settings navigation contract', () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/settings');
  });
  it('restores deep links, finds a material by search vocabulary, and keeps browser history usable', async () => {
    window.history.replaceState(null, '', '/settings?section=appearance');
    await renderSettings();
    expect(screen.getByRole('link', { name: 'Appearance' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search Settings' }),
      { target: { value: 'anodized' } }
    );
    const results = screen.getByRole('region', {
      name: 'Settings search results',
    });
    fireEvent.click(
      within(results).getByRole('link', { name: 'Tile material' })
    );
    expect(window.location.search).toBe('?section=fleet');
    expect(window.location.hash).toBe('#fleet-material');
    expect(screen.getByRole('group', { name: 'Tile material' })).toBeVisible();
    act(() => {
      window.history.replaceState(null, '', '/settings?section=appearance');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByRole('link', { name: 'Appearance' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
  it('marks search results only while a search is running', async () => {
    await renderSettings();
    const search = document.querySelector<HTMLInputElement>(
      '[data-settings-shell] input[type="search"]'
    )!;
    expect(document.querySelector('[data-settings-search-results]')).toBeNull();
    fireEvent.change(search, { target: { value: 'anodized' } });
    expect(
      document.querySelector('[data-settings-search-results]')
    ).not.toBeNull();
    fireEvent.change(search, { target: { value: '' } });
    expect(document.querySelector('[data-settings-search-results]')).toBeNull();
  });
});

/*
 * BUG-306: the shell owns every page's frame. A page's header is drawn once,
 * from the registry, whichever module fills it; the page body never carries
 * a strip of links to its own rows; and a link that lands on a row marks it.
 */
describe('Settings page frame', () => {
  beforeEach(() => {
    installBridgeDouble({ platform: 'darwin' });
  });
  afterEach(() => {
    cleanup();
    removeBridgeDouble();
    vi.useRealTimers();
    window.history.replaceState(null, '', '/settings');
  });

  it('heads every destination once, from the registry, with no links to its own rows', async () => {
    for (const destination of SETTINGS_DESTINATIONS) {
      window.history.replaceState(null, '', settingsHref(destination.id));
      await renderSettings();
      const page = screen.getByRole('region', { name: destination.label });
      expect(
        screen.getAllByRole('heading', { name: destination.label })
      ).toHaveLength(1);
      expect(within(page).getByText(destination.description)).toBeVisible();
      expect(within(page).getByText(destination.group)).toBeVisible();
      expect(page.querySelector('a[href^="/settings"]')).toBeNull();
      cleanup();
    }
  });

  it('marks the row a link lands on, one row at a time, then lets it go', async () => {
    window.history.replaceState(
      null,
      '',
      settingsHref('fleet', 'fleet-material')
    );
    await renderSettings();
    const material = document.getElementById('fleet-material');
    expect(material).toHaveAttribute('data-settings-landed');
    expect(document.activeElement).toBe(material);

    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search Settings' }),
      { target: { value: 'fleet view' } }
    );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(
      within(
        screen.getByRole('region', { name: 'Settings search results' })
      ).getByRole('link', { name: 'Fleet view' })
    );
    const view = document.getElementById('fleet-view');
    expect(view).toHaveAttribute('data-settings-landed');
    expect(document.getElementById('fleet-material')).not.toHaveAttribute(
      'data-settings-landed'
    );

    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(document.getElementById('fleet-view')).not.toHaveAttribute(
      'data-settings-landed'
    );
  });
});
