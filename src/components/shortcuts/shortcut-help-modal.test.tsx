import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultShortcuts, shortcutRegistry } from '@/lib/shortcuts';
import { ALL_FIXED_FAMILIES } from '@/lib/shortcuts/fixed-families';
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
      expect(screen.getAllByText(family.label).length).toBeGreaterThan(0);
    }
    for (const shortcut of defaultShortcuts) {
      expect(screen.getAllByText(shortcut.label).length).toBeGreaterThan(0);
    }
    view.unmount();
  });
});
