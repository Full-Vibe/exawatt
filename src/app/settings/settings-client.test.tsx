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
import { SettingsClient } from './settings-client';

const { updateKeyboardShortcuts } = vi.hoisted(() => ({
  updateKeyboardShortcuts: vi.fn(async () => undefined),
}));

vi.mock('@/app/actions/preferences', () => ({
  getKeyboardShortcuts: vi.fn(async () => []),
  updateKeyboardShortcuts,
  resetKeyboardShortcuts: vi.fn(async () => undefined),
}));

function editShortcut(label: string): HTMLElement {
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
    render(<SettingsClient />);
    const capture = editShortcut('Terminal');

    fireEvent.keyDown(capture, { key: 'm', code: 'KeyM' });
    expect(screen.getByText(/must include ⌘/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.keyDown(capture, {
      key: '4',
      code: 'Digit4',
      metaKey: true,
    });
    expect(screen.queryByText(/must include ⌘/)).not.toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(updateKeyboardShortcuts).toHaveBeenCalledOnce());
    expect(shortcutRegistry.getEffectiveKeys('command-terminal')).toEqual({
      key: '4',
      modifiers: ['meta'],
    });
  });

  it('rejects a physical Project ordinal even when Option changes its character', () => {
    render(<SettingsClient />);
    const capture = editShortcut('Terminal');

    fireEvent.keyDown(capture, {
      key: '¢',
      code: 'Digit4',
      metaKey: true,
      altKey: true,
    });

    expect(screen.getByText(/reserved for Project switching/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
