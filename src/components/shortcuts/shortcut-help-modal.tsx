'use client';

import { useSyncExternalStore, useMemo, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { shortcutRegistry } from '@/lib/shortcuts';
import { ShortcutBadge } from './shortcut-badge';
import type { ShortcutCategory } from '@/types/shortcuts';

const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  navigation: 'Navigation',
  actions: 'Actions',
  selection: 'Selection',
  view: 'View',
  help: 'Help',
};

const CATEGORY_ORDER: ShortcutCategory[] = [
  'navigation',
  'actions',
  'selection',
  'view',
  'help',
];

interface ShortcutHelpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Stable getter functions for useSyncExternalStore
const getSnapshot = () => shortcutRegistry.getByCategory();
const getServerSnapshot = () => shortcutRegistry.getByCategory();

export function ShortcutHelpModal({ open, onOpenChange }: ShortcutHelpModalProps) {
  const subscribe = useCallback((callback: () => void) => {
    return shortcutRegistry.subscribe(callback);
  }, []);

  // Subscribe to registry changes
  const shortcuts = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const categories = useMemo(() => {
    return CATEGORY_ORDER.filter(
      (cat) => shortcuts[cat] && shortcuts[cat].length > 0
    );
  }, [shortcuts]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Use these shortcuts to navigate and take actions quickly.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-6 pr-4">
            {categories.map((category) => {
              const categoryShortcuts = shortcuts[category];

              return (
                <div key={category}>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                    {CATEGORY_LABELS[category]}
                  </h3>
                  <div className="space-y-2">
                    {categoryShortcuts.map((shortcut) => {
                      const effectiveKeys = shortcutRegistry.getEffectiveKeys(
                        shortcut.id
                      );
                      if (!effectiveKeys) return null;

                      return (
                        <div
                          key={shortcut.id}
                          className="flex items-center justify-between py-1"
                        >
                          <span className="text-sm">{shortcut.label}</span>
                          <ShortcutBadge keys={effectiveKeys} size="md" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
