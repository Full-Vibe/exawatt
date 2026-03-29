'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from '@/components/ui/command';
import { shortcutRegistry, formatShortcutKeys } from '@/lib/shortcuts';
import {
  LayoutDashboard,
  LayoutGrid,
  FolderKanban,
  Settings,
  HelpCircle,
  Server,
} from 'lucide-react';
import type { ShortcutKeys } from '@/types/shortcuts';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenHelpModal: () => void;
}

interface CommandItem {
  id: string;
  label: string;
  shortcut?: ShortcutKeys;
  icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
  keywords?: string[];
}

export function CommandPalette({
  open,
  onOpenChange,
  onOpenHelpModal,
}: CommandPaletteProps) {
  const router = useRouter();
  const [search, setSearch] = useState('');

  // Reset search when closing
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const handleSelect = useCallback(
    (callback: () => void) => {
      onOpenChange(false);
      // Small delay to let the dialog close animation start
      setTimeout(callback, 50);
    },
    [onOpenChange]
  );

  // Build command items
  const items = useMemo<CommandItem[]>(() => {
    return [
      {
        id: 'nav-dashboard',
        label: 'Go to Dashboard',
        icon: LayoutDashboard,
        shortcut: shortcutRegistry.getEffectiveKeys('go-dashboard'),
        onSelect: () => handleSelect(() => router.push('/dashboard')),
        keywords: ['home', 'overview', 'metrics'],
      },
      {
        id: 'nav-board',
        label: 'Go to Board',
        icon: LayoutGrid,
        shortcut: shortcutRegistry.getEffectiveKeys('go-board'),
        onSelect: () => handleSelect(() => router.push('/board')),
        keywords: ['kanban', 'tasks', 'swimlane'],
      },
      {
        id: 'nav-projects',
        label: 'Go to Projects',
        icon: FolderKanban,
        shortcut: shortcutRegistry.getEffectiveKeys('go-projects'),
        onSelect: () => handleSelect(() => router.push('/projects')),
        keywords: ['folders', 'organize'],
      },
      {
        id: 'nav-fleet',
        label: 'Go to Fleet',
        icon: Server,
        shortcut: shortcutRegistry.getEffectiveKeys('go-fleet'),
        onSelect: () => handleSelect(() => router.push('/fleet')),
        keywords: ['agents', 'bots', 'ai'],
      },
      {
        id: 'nav-settings',
        label: 'Go to Settings',
        icon: Settings,
        shortcut: shortcutRegistry.getEffectiveKeys('go-settings'),
        onSelect: () => handleSelect(() => router.push('/settings')),
        keywords: ['preferences', 'config', 'customize'],
      },
      {
        id: 'action-help',
        label: 'Keyboard Shortcuts',
        icon: HelpCircle,
        shortcut: shortcutRegistry.getEffectiveKeys('help-modal'),
        onSelect: () => handleSelect(onOpenHelpModal),
        keywords: ['help', 'keys', 'hotkeys'],
      },
    ];
  }, [router, handleSelect, onOpenHelpModal]);

  // Group items
  const navigationItems = items.filter(i => i.id.startsWith('nav-'));
  const actionItems = items.filter(i => i.id.startsWith('action-'));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Type a command or search..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          {navigationItems.map(item => (
            <CommandItem key={item.id} onSelect={item.onSelect}>
              <item.icon className="mr-2 h-4 w-4" />
              <span>{item.label}</span>
              {item.shortcut && (
                <CommandShortcut>
                  {formatShortcutKeys(item.shortcut)}
                </CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          {actionItems.map(item => (
            <CommandItem key={item.id} onSelect={item.onSelect}>
              <item.icon className="mr-2 h-4 w-4" />
              <span>{item.label}</span>
              {item.shortcut && (
                <CommandShortcut>
                  {formatShortcutKeys(item.shortcut)}
                </CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
