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
import { GoalVisualPreferenceProvider } from '@/components/goal-visuals/goal-visual-preference-provider';
import { OUTBOUND_CONTROLS } from '@/lib/hosted-features/contract';
import { SettingsClient } from './settings-client';

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
    <GoalVisualPreferenceProvider>
      <SettingsClient />
    </GoalVisualPreferenceProvider>
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

vi.mock('./agent-sources-settings', () => ({
  AgentSourcesSettings: () => <div data-agent-sources-settings />,
}));

function editShortcut(label: string): HTMLElement {
  if (!screen.queryByText(label)) {
    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
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
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { platform: 'darwin' },
    });
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
    Reflect.deleteProperty(window, 'electron');
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
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        platform: 'darwin',
        shortcuts: { systemHotkeys: vi.fn(async () => ({})) },
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
    expect(
      screen.getByText(/Save picture of selected area/)
    ).toBeInTheDocument();
    expect(screen.getByText(/System Settings/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('allows a system combo the user has freed in System Settings', async () => {
    // The operator scenario: area-screenshot (id 30) disabled in sysprefs —
    // ⇧⌘4 is genuinely free on this machine and must be bindable.
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        platform: 'darwin',
        shortcuts: {
          systemHotkeys: vi.fn(async () => ({
            AppleSymbolicHotKeys: {
              '30': { enabled: false },
              '31': { enabled: false },
            },
          })),
        },
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
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        isElectron: true,
        platform: 'darwin',
        settings: {
          get: vi.fn(async () => ({})),
          onChanged: vi.fn(() => () => undefined),
          setHostedConversationSummaries: vi.fn(async () => ({})),
          setHostedContextLabels: vi.fn(async () => ({})),
        },
      },
    });
    await renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    expect(
      screen.getByRole('switch', { name: 'Native macOS notifications' })
    ).toBeVisible();
    for (const control of Object.values(OUTBOUND_CONTROLS)) {
      expect(outboundRow(control.id)).toBeNull();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Privacy' }));
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
