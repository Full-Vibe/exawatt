import type {
  ShortcutDefinition,
  ShortcutKeys,
} from '@/types/shortcuts';
import { isChord } from '@/types/shortcuts';

export type ShortcutPlatform = 'darwin' | 'win32' | 'linux' | 'other';

interface PhysicalKeyEvent {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Fixed workspace families are intentionally outside the rebindable registry. */
export function reservedShortcutFamily(
  event: PhysicalKeyEvent
): string | null {
  if (event.ctrlKey || !event.metaKey) return null;

  if (
    event.altKey &&
    !event.shiftKey &&
    /^Digit[1-9]$/.test(event.code)
  ) {
    return '⌘⌥1–9 is reserved for Project switching.';
  }

  if (
    !event.altKey &&
    !event.shiftKey &&
    /^Digit[1-9]$/.test(event.code)
  ) {
    return '⌘1–9 is reserved for Session tab switching.';
  }

  if (
    event.shiftKey &&
    !event.altKey &&
    (event.code === 'BracketLeft' || event.code === 'BracketRight')
  ) {
    return '⌘⇧[ / ⌘⇧] is reserved for terminal tab navigation.';
  }

  return null;
}

/** Validate that customization preserves the command's focus guarantee. */
export function validateShortcutBinding(
  shortcut: Pick<ShortcutDefinition, 'bindingPolicy'>,
  keys: ShortcutKeys,
  platform: ShortcutPlatform
): string | null {
  if (shortcut.bindingPolicy !== 'universal-command') return null;

  if (isChord(keys)) {
    return 'Universal navigation uses one key combination, not a chord.';
  }

  const primaryModifier = platform === 'darwin' ? 'meta' : 'ctrl';
  if (!keys.modifiers?.includes(primaryModifier)) {
    return platform === 'darwin'
      ? 'Universal navigation must include ⌘ so it works from Terminal and text fields.'
      : 'Universal navigation must include Ctrl so it works from Terminal and text fields.';
  }

  return null;
}
