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
import {
  AttentionMarker,
  SessionStatusGlyph,
} from '@/components/workspace/status-glyphs';
import type { KeyBinding, ShortcutCategory } from '@/types/shortcuts';

/** the D30 status icon vocabulary, taught where operators already look */
const STATUS_LEGEND: Array<{
  glyph: React.ReactNode;
  label: string;
  meaning: string;
}> = [
  {
    glyph: <AttentionMarker />,
    label: 'unseen',
    meaning: 'finished or requested input — ⌘J jumps there',
  },
  {
    glyph: <SessionStatusGlyph state="working" />,
    label: 'working',
    meaning: 'output streaming right now',
  },
  {
    glyph: <SessionStatusGlyph state="done" />,
    label: 'finished',
    meaning: 'turn complete, resting',
  },
  {
    glyph: <SessionStatusGlyph state="fresh" />,
    label: 'new',
    meaning: 'not given a task yet',
  },
  {
    glyph: <SessionStatusGlyph state="quiet" />,
    label: 'quiet',
    meaning: 'shell between output',
  },
];

const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  workspace: 'Workspace',
  navigation: 'Navigation',
  actions: 'Actions',
  view: 'View',
  help: 'Help',
};

const CATEGORY_ORDER: ShortcutCategory[] = [
  'workspace',
  'navigation',
  'actions',
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
    label: 'Jump to Project 1–9',
    keys: { key: '1…9', modifiers: ['meta', 'alt'] },
  },
  {
    category: 'workspace',
    label: 'Previous / next tab (global ring)',
    keys: { key: '[ / ]', modifiers: ['meta', 'shift'] },
  },
  {
    category: 'view',
    label: 'Fleet: open Project 1–9',
    keys: { key: '1…9' },
  },
  {
    category: 'view',
    label: 'Fleet: pan board',
    keys: { key: '← ↑ ↓ →' },
  },
  {
    category: 'view',
    label: 'Fleet: zoom board',
    keys: { key: '+ / −' },
  },
  {
    category: 'view',
    label: 'Fleet: toggle projection',
    keys: { key: 'V' },
  },
  {
    category: 'view',
    label: 'Fleet: recenter / overview',
    keys: { key: '0' },
  },
  {
    category: 'view',
    label: 'Fleet: next / previous attention',
    keys: { key: 'N / P' },
  },
  {
    category: 'view',
    label: 'Fleet: zoom out selection',
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
            {/* the status icon vocabulary is learnable, so the cheat
                sheet TEACHES it (D30) — the text channel Carbon requires */}
            {(!query ||
              'agent status'.includes(query.toLowerCase().trim())) && (
              <div data-help-category="agent-status">
                <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                  Agent Status
                </h3>
                <div className="space-y-2">
                  {STATUS_LEGEND.map(entry => (
                    <div
                      key={entry.label}
                      className="flex items-center gap-3 py-1"
                    >
                      {entry.glyph}
                      <span className="text-sm">{entry.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {entry.meaning}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
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
