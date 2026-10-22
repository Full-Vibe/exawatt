// No 'use client' directive: only imported by the client workspace surface.

/**
 * The right-click (and ⇧F10) menu for a target, rendered from the target
 * command registry. A context menu names its TARGET; it never lists its own
 * rows. That is what keeps every menu and ⌘K in step: both resolve the same
 * commands for the same target (`target-commands.ts`), and
 * `one-menu-primitive.test.ts` refuses a file that opens a menu on
 * `contextmenu` any other way.
 */
import { useMemo } from 'react';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/option-menu';
import {
  formatShortcutKeys,
  formatShortcutKeysAria,
} from '@/lib/shortcuts/format';
import { useShortcutRegistryVersion } from '@/components/shortcuts/use-effective-shortcut';
import {
  resolveTargetCommands,
  type CommandTarget,
  type ResolvedTargetCommand,
  type TargetCommandScope,
} from './target-commands';

type ActionMenuProps = React.ComponentProps<typeof ActionMenu>;

function menuItems(rows: readonly ResolvedTargetCommand[]): ActionMenuItem[] {
  return rows.map(row => ({
    id: row.id,
    label: row.label,
    accessibleLabel: row.accessibleLabel,
    detail: row.detail,
    note: row.note,
    shortcut: row.shortcut ? formatShortcutKeys(row.shortcut) : undefined,
    ariaKeyShortcuts: row.shortcut
      ? formatShortcutKeysAria(row.shortcut)
      : undefined,
    danger: row.danger || undefined,
    disabled: row.disabledReason !== null || undefined,
    disabledReason: row.disabledReason ?? undefined,
    announcedComing: row.announced ?? undefined,
    section: row.section,
    focusAfterSelect: row.focusAfterSelect,
    attributes: { 'data-command-id': row.id, ...row.attributes },
    onSelect: row.run ?? undefined,
    children: row.children.length > 0 ? menuItems(row.children) : undefined,
  }));
}

export function CommandMenu({
  target,
  scope,
  ...menu
}: Omit<ActionMenuProps, 'items' | 'open'> & {
  /** null closes the menu */
  target: CommandTarget | null;
  scope: TargetCommandScope | null;
}) {
  // A rebind reprints the chords of a menu that is already open.
  const shortcutVersion = useShortcutRegistryVersion();
  const items = useMemo(() => {
    void shortcutVersion;
    return target ? menuItems(resolveTargetCommands(target, scope)) : [];
  }, [scope, shortcutVersion, target]);
  return <ActionMenu {...menu} open={target !== null} items={items} />;
}
