import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultShortcuts, shortcutRegistry } from '@/lib/shortcuts';
import { ALL_FIXED_FAMILIES } from '@/lib/shortcuts/fixed-families';
import { formatShortcutKeys } from '@/lib/shortcuts/format';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ShortcutHelpModal } from './shortcut-help-modal';

describe('shortcut help manifest coverage', () => {
  beforeEach(() => {
    for (const definition of defaultShortcuts) {
      shortcutRegistry.register({ ...definition, action: vi.fn() });
    }
  });

  afterEach(() => {
    for (const definition of defaultShortcuts) {
      shortcutRegistry.unregister(definition.id);
    }
  });

  it('renders every fixed-family and registry command label', () => {
    const view = render(
      <TooltipProvider>
        <ShortcutHelpModal open onOpenChange={vi.fn()} />
      </TooltipProvider>
    );

    for (const family of ALL_FIXED_FAMILIES) {
      const row = document.querySelector(`[data-shortcut-id="${family.id}"]`);
      expect(row).toHaveTextContent(family.label);
      expect(row).toHaveTextContent(formatShortcutKeys(family.keys));
    }
    for (const shortcut of defaultShortcuts) {
      const row = document.querySelector(`[data-shortcut-id="${shortcut.id}"]`);
      expect(row).toHaveTextContent(shortcut.label);
      expect(row).toHaveTextContent(formatShortcutKeys(shortcut.keys));
    }
    view.unmount();
  });

  it('searches the status vocabulary as well as shortcuts', async () => {
    const view = render(
      <TooltipProvider>
        <ShortcutHelpModal open onOpenChange={vi.fn()} />
      </TooltipProvider>
    );

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Filter shortcuts'), {
        target: { value: 'output streaming' },
      });
    });
    expect(screen.getByText('working')).toBeVisible();
    expect(screen.getByText('output streaming right now')).toBeVisible();
    view.unmount();
  });
});
