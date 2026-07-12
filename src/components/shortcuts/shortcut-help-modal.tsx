'use client';

import {
  useSyncExternalStore,
  useMemo,
  useCallback,
  useState,
  useEffect,
} from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { shortcutRegistry } from '@/lib/shortcuts';
import { formatShortcutKeys } from '@/lib/shortcuts/format';
import { ShortcutBadge } from './shortcut-badge';
import type { KeyBinding, ShortcutCategory } from '@/types/shortcuts';

const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  workspace: 'Terminal Workspace',
  navigation: 'Navigation',
  actions: 'Actions',
  selection: 'Selection',
  view: 'View',
  help: 'Help',
};

const CATEGORY_ORDER: ShortcutCategory[] = [
  'workspace',
  'navigation',
  'actions',
  'selection',
  'view',
  'help',
];

/**
 * Fixed key families (ENG-016 D9): handled positionally by the workspace key
 * layer, deliberately not rebindable — listed statically for discoverability.
 * Every other workspace verb now lives in the registry and renders
 * dynamically with its effective (possibly rebound) combo.
 */
const FIXED_FAMILIES: Array<{
  category: ShortcutCategory;
  label: string;
  keys: KeyBinding;
}> = [
  {
    category: 'workspace',
    label: 'Jump to project 1–9',
    keys: { key: '1…9', modifiers: ['meta'] },
  },
  {
    category: 'workspace',
    label: 'Previous / next tab (global ring)',
    keys: { key: '[ / ]', modifiers: ['meta', 'shift'] },
  },
  {
    category: 'view',
    label: 'Spatial: open Project 1–9',
    keys: { key: '1…9' },
  },
  {
    category: 'view',
    label: 'Spatial: pan board',
    keys: { key: '← ↑ ↓ →' },
  },
  {
    category: 'view',
    label: 'Spatial: zoom board',
    keys: { key: '+ / −' },
  },
  {
    category: 'view',
    label: 'Spatial: toggle projection',
    keys: { key: 'V' },
  },
  {
    category: 'view',
    label: 'Spatial: recenter / overview',
    keys: { key: '0' },
  },
  {
    category: 'view',
    label: 'Spatial: next / previous attention',
    keys: { key: 'N / P' },
  },
  {
    category: 'view',
    label: 'Spatial: zoom out selection',
    keys: { key: 'Escape' },
  },
];

interface ShortcutHelpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Stable getter functions for useSyncExternalStore
const getSnapshot = () => shortcutRegistry.getByCategory();
const getServerSnapshot = () => shortcutRegistry.getByCategory();

export function ShortcutHelpModal({
  open,
  onOpenChange,
}: ShortcutHelpModalProps) {
  const subscribe = useCallback((callback: () => void) => {
    return shortcutRegistry.subscribe(callback);
  }, []);

  // Subscribe to registry changes
  const shortcuts = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  // type-to-filter (Linear made its shortcut panel searchable specifically
  // to grow shortcut adoption)
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);
  const q = query.trim().toLowerCase();
  const matches = useCallback(
    (label: string, keysText: string) =>
      !q ||
      label.toLowerCase().includes(q) ||
      keysText.toLowerCase().includes(q),
    [q]
  );

  const sections = useMemo(() => {
    return CATEGORY_ORDER.map(category => {
      const rows = (shortcuts[category] ?? []).flatMap(shortcut => {
        const effectiveKeys = shortcutRegistry.getEffectiveKeys(shortcut.id);
        if (!effectiveKeys) return [];
        if (!matches(shortcut.label, formatShortcutKeys(effectiveKeys))) {
          return [];
        }
        return [
          { id: shortcut.id, label: shortcut.label, keys: effectiveKeys },
        ];
      });
      const fixed = FIXED_FAMILIES.filter(
        family =>
          family.category === category && matches(family.label, family.keys.key)
      );
      return { category, rows, fixed };
    }).filter(s => s.rows.length > 0 || s.fixed.length > 0);
  }, [shortcuts, matches]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Use these shortcuts to navigate and take actions quickly.
          </DialogDescription>
        </DialogHeader>

        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter shortcuts…"
          aria-label="Filter shortcuts"
          autoFocus
        />

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-6 pr-4">
            {sections.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No shortcuts match “{query}”.
              </p>
            )}
            {sections.map(({ category, rows, fixed }) => (
              <div key={category} data-help-category={category}>
                <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                  {CATEGORY_LABELS[category]}
                </h3>
                <div className="space-y-2">
                  {rows.map(row => (
                    <div
                      key={row.id}
                      className="flex items-center justify-between py-1"
                    >
                      <span className="text-sm">{row.label}</span>
                      <ShortcutBadge keys={row.keys} size="md" />
                    </div>
                  ))}
                  {fixed.map(entry => (
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
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
