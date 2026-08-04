import {
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
import { SettingsClient } from './settings-client';

// Notifications settings read the goal-visual preference, mounted app-wide
// in layout.tsx — the test harness mirrors that mounting context.
function renderSettings() {
  return render(
    <GoalVisualPreferenceProvider>
      <SettingsClient />
    </GoalVisualPreferenceProvider>
  );
}

const { updateKeyboardShortcuts } = vi.hoisted(() => ({
  updateKeyboardShortcuts: vi.fn(async () => undefined),
}));

vi.mock('@/app/actions/preferences', () => ({
  getKeyboardShortcuts: vi.fn(async () => []),
  updateKeyboardShortcuts,
  resetKeyboardShortcuts: vi.fn(async () => undefined),
}));

vi.mock('./appearance-settings', () => ({
  AppearanceSettings: () => <div data-appearance-settings />,
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
    updateKeyboardShortcuts.mockClear();
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
    renderSettings();
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

    await waitFor(() => expect(updateKeyboardShortcuts).toHaveBeenCalledOnce());
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
    renderSettings();
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
    renderSettings();
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
    await waitFor(() => expect(updateKeyboardShortcuts).toHaveBeenCalledOnce());
    expect(shortcutRegistry.getEffectiveKeys('command-terminal')).toEqual({
      key: '4',
      modifiers: ['meta', 'shift'],
    });
  });

  it('warns without blocking when system prefs cannot be read (web fallback)', () => {
    // No Electron bridge: Apple defaults are only a likelihood, so ⇧⌘4
    // shows the unverified warning but stays saveable.
    renderSettings();
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

  it('rejects a physical Project ordinal even when Option changes its character', () => {
    renderSettings();
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
