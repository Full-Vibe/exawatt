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

  if (
    event.altKey &&
    (event.code === 'BracketLeft' || event.code === 'BracketRight')
  ) {
    return event.shiftKey
      ? '⌘⌥⇧[ / ⌘⌥⇧] is reserved for arranging Projects.'
      : '⌘⌥[ / ⌘⌥] is reserved for arranging tabs.';
  }

  return null;
}

/** macOS registers ⇧⌘3/4/5/6 as system screenshot hot keys and consumes
 *  them before any app receives the keydown — a binding on one of them can
 *  never fire (D19: ⌘⇧3 Spatial was silently dead on real keyboards). */
function macScreenshotConflict(keys: ShortcutKeys): string | null {
  const bindings = isChord(keys) ? keys : [keys];
  for (const b of bindings) {
    const mods = new Set(b.modifiers ?? []);
    if (
      mods.has('meta') &&
      mods.has('shift') &&
      !mods.has('ctrl') &&
      !mods.has('alt') &&
      /^[3-6]$/.test(b.key)
    ) {
      return `⌘⇧${b.key} is captured by macOS for screenshots before Exawatt can see it.`;
    }
  }
  return null;
}

/** Validate that customization preserves the command's focus guarantee. */
export function validateShortcutBinding(
  shortcut: Pick<ShortcutDefinition, 'bindingPolicy'>,
  keys: ShortcutKeys,
  platform: ShortcutPlatform
): string | null {
  if (platform === 'darwin') {
    const screenshot = macScreenshotConflict(keys);
    if (screenshot) return screenshot;
  }

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
