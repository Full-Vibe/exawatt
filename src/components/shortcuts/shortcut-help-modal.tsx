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

/**
 * Terminal-workspace chords (ENG-002/ENG-015). Static: these are handled by
 * the workspace's own key layer (the chord engine cannot see keystrokes
 * inside xterm), so registering them would double-fire — they are listed
 * here for discoverability only.
 */
const WORKSPACE_KEYS: Array<{ label: string; keys: { key: string; modifiers?: Array<'meta' | 'shift'> } }> = [
  { label: 'Session switcher / commands', keys: { key: 'k', modifiers: ['meta'] } },
  { label: 'Overview of all sessions', keys: { key: 'o', modifiers: ['meta'] } },
  { label: 'New shell in the active project', keys: { key: 't', modifiers: ['meta'] } },
  { label: 'Close the active tab', keys: { key: 'w', modifiers: ['meta'] } },
  { label: 'Jump to initiative 1–9', keys: { key: '1…9', modifiers: ['meta'] } },
  { label: 'Previous / next tab (global ring)', keys: { key: '[ / ]', modifiers: ['meta', 'shift'] } },
  { label: 'Jump to the session needing you', keys: { key: 'j', modifiers: ['meta'] } },
  { label: 'Split: pin / unpin the active tab', keys: { key: 'd', modifiers: ['meta'] } },
  { label: 'Rename the active tab', keys: { key: 'e', modifiers: ['meta'] } },
  { label: 'Switch regime (workspace ↔ map)', keys: { key: 'm', modifiers: ['meta', 'shift'] } },
  { label: 'This cheat-sheet', keys: { key: '/', modifiers: ['meta'] } },
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
            <div data-workspace-keys>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                Terminal Workspace
              </h3>
              <div className="space-y-2">
                {WORKSPACE_KEYS.map((entry) => (
                  <div
                    key={entry.label}
                    className="flex items-center justify-between py-1"
                  >
                    <span className="text-sm">{entry.label}</span>
                    <ShortcutBadge keys={entry.keys} size="md" />
                  </div>
                ))}
              </div>
            </div>

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
