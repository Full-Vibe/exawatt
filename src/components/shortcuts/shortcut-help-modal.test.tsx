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

  // FIX-001: the sheet exists to answer "what is this chord bound to?"
  it('finds a command by its key combination, typed either way', async () => {
    const view = render(
      <TooltipProvider>
        <ShortcutHelpModal open onOpenChange={vi.fn()} />
      </TooltipProvider>
    );
    const filter = () => screen.getByLabelText('Filter shortcuts');
    const search = async (value: string) => {
      await act(async () => {
        fireEvent.change(filter(), { target: { value } });
      });
    };
    const shown = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>('[data-shortcut-id]')
      ).map(el => el.getAttribute('data-shortcut-id'));

    await search('⌘[');
    expect(shown()).toEqual(['history-back']);

    // the same question, typed in words
    await search('cmd [');
    expect(shown()).toEqual(['history-back']);

    // a partial chord lists the family under it, not everything with a T
    await search('cmd opt t');
    expect(shown()).toEqual(['workspace-new-shell']);

    // and prose containing a modifier word is still a label search
    await search('shell');
    expect(shown()).toContain('workspace-new-shell');
    expect(shown().length).toBeGreaterThan(0);
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
