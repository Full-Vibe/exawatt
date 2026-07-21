import type { KeyBinding, ModifierKey, ShortcutKeys } from '@/types/shortcuts';
import { isChord } from '@/types/shortcuts';
import { formatKeyBinding } from './format';

/**
 * macOS system-shortcut truth (ENG-016 D19 amendment, 2026-07-21).
 *
 * The original D19 fix hardcoded "⌘⇧3–6 are screenshots — refuse", but every
 * system shortcut is user-configurable in System Settings → Keyboard: the
 * operator's own machine has Mission Control ⌃↑/⌃↓, input-source ⌃Space, and
 * Dock-hiding ⌥⌘D DISABLED (all genuinely free), while the screenshot keys
 * are absent from the prefs file entirely (absent = Apple default = enabled).
 *
 * So instead of a hardcoded refusal, this module computes the EFFECTIVE
 * system hotkey table: `~/Library/Preferences/com.apple.symbolichotkeys.plist`
 * (only the entries the user has ever touched) merged over a table of Apple
 * defaults. Electron reads the plist and ships the parsed JSON here; the
 * merge, key mapping, and conflict lookup stay pure and unit-tested. Without
 * plist access (web build) the defaults alone act as an unverified hint.
 *
 * Third-party apps' global hotkeys are NOT detectable without private APIs
 * and are deliberately out of scope; in-app conflicts are handled by the
 * registry's findConflict.
 */

/** parameters: [asciiChar (65535 = none), virtualKeyCode, modifierMask] */
export interface RawSymbolicHotkey {
  enabled?: boolean | number;
  value?: { parameters?: ReadonlyArray<number> };
}

export interface SymbolicHotkeysPlist {
  AppleSymbolicHotKeys?: Record<string, RawSymbolicHotkey>;
}

export interface SystemHotkey {
  id: number;
  label: string;
  binding: KeyBinding;
}

/** NSEvent modifier-flag bits used by the plist's modifierMask. Masks also
 *  carry device bits (fn 1<<23, numeric-pad 1<<21) that must be ignored. */
const MASK_BITS: ReadonlyArray<[number, ModifierKey]> = [
  [1 << 17, 'shift'],
  [1 << 18, 'ctrl'],
  [1 << 19, 'alt'],
  [1 << 20, 'meta'],
];

function maskToModifiers(mask: number): ModifierKey[] {
  return MASK_BITS.filter(([bit]) => (mask & bit) !== 0).map(
    ([, modifier]) => modifier
  );
}

/** macOS (ANSI) virtual key code → the key name our bindings use
 *  (eventToBinding: layout character, physical digits, DOM names). */
const VK_TO_KEY: Record<number, string> = {
  0: 'a', 1: 's', 2: 'd', 3: 'f', 4: 'h', 5: 'g', 6: 'z', 7: 'x',
  8: 'c', 9: 'v', 11: 'b', 12: 'q', 13: 'w', 14: 'e', 15: 'r',
  16: 'y', 17: 't', 31: 'o', 32: 'u', 34: 'i', 35: 'p', 37: 'l',
  38: 'j', 40: 'k', 45: 'n', 46: 'm',
  18: '1', 19: '2', 20: '3', 21: '4', 23: '5', 22: '6', 26: '7',
  28: '8', 25: '9', 29: '0',
  24: '=', 27: '-', 30: ']', 33: '[', 39: "'", 41: ';', 42: '\\',
  43: ',', 44: '/', 47: '.', 50: '`',
  49: ' ', 36: 'Enter', 48: 'Tab', 51: 'Backspace', 53: 'Escape',
  117: 'Delete', 115: 'Home', 119: 'End', 116: 'PageUp', 121: 'PageDown',
  123: 'ArrowLeft', 124: 'ArrowRight', 125: 'ArrowDown', 126: 'ArrowUp',
  122: 'F1', 120: 'F2', 99: 'F3', 118: 'F4', 96: 'F5', 97: 'F6',
  98: 'F7', 100: 'F8', 101: 'F9', 109: 'F10', 103: 'F11', 111: 'F12',
};

interface HotkeyDefault {
  label: string;
  /** default state when the id is absent from the plist */
  enabled: boolean;
  vk: number;
  mask: number;
}

const SHIFT = 1 << 17;
const CTRL = 1 << 18;
const OPT = 1 << 19;
const CMD = 1 << 20;

/** Apple's defaults for the hotkeys that are ENABLED out of the box (plus
 *  labels for common ids that only appear once a user touches them). An id
 *  absent from the user's plist takes exactly this state. */
const HOTKEY_DEFAULTS: Record<number, HotkeyDefault> = {
  27: { label: 'Move focus to next window', enabled: true, vk: 50, mask: CMD },
  28: {
    label: 'Save picture of screen as a file',
    enabled: true,
    vk: 20,
    mask: SHIFT | CMD,
  },
  29: {
    label: 'Copy picture of screen to the clipboard',
    enabled: true,
    vk: 20,
    mask: CTRL | SHIFT | CMD,
  },
  30: {
    label: 'Save picture of selected area as a file',
    enabled: true,
    vk: 21,
    mask: SHIFT | CMD,
  },
  31: {
    label: 'Copy picture of selected area to the clipboard',
    enabled: true,
    vk: 21,
    mask: CTRL | SHIFT | CMD,
  },
  184: {
    label: 'Screenshot and recording options',
    enabled: true,
    vk: 23,
    mask: SHIFT | CMD,
  },
  32: { label: 'Mission Control', enabled: true, vk: 126, mask: CTRL },
  33: { label: 'Application windows', enabled: true, vk: 125, mask: CTRL },
  52: {
    label: 'Turn Dock hiding on/off',
    enabled: true,
    vk: 2,
    mask: OPT | CMD,
  },
  60: {
    label: 'Select the previous input source',
    enabled: true,
    vk: 49,
    mask: CTRL,
  },
  61: {
    label: 'Select next source in Input menu',
    enabled: true,
    vk: 49,
    mask: CTRL | OPT,
  },
  64: { label: 'Show Spotlight search', enabled: true, vk: 49, mask: CMD },
  65: {
    label: 'Show Finder search window',
    enabled: true,
    vk: 49,
    mask: OPT | CMD,
  },
  79: { label: 'Move left a space', enabled: true, vk: 123, mask: CTRL },
  81: { label: 'Move right a space', enabled: true, vk: 124, mask: CTRL },
  98: { label: 'Show Help menu', enabled: true, vk: 44, mask: SHIFT | CMD },
};

/** Labels for ids that are default-OFF but may be enabled by the user. */
const HOTKEY_LABELS: Record<number, string> = {
  118: 'Switch to Desktop 1',
  119: 'Switch to Desktop 2',
  120: 'Switch to Desktop 3',
  121: 'Switch to Desktop 4',
  190: 'Quick Note',
  222: 'Show Notification Center',
  175: 'Show Launchpad',
  36: 'Move focus to the Dock',
  57: 'Move focus to the menu bar',
};

function hotkeyLabel(id: number): string {
  return (
    HOTKEY_DEFAULTS[id]?.label ??
    HOTKEY_LABELS[id] ??
    'a macOS system shortcut'
  );
}

function toBinding(vk: number, mask: number): KeyBinding | null {
  const key = VK_TO_KEY[vk];
  if (!key) return null;
  const modifiers = maskToModifiers(mask);
  return modifiers.length > 0 ? { key, modifiers } : { key };
}

/**
 * The effective system hotkey table: plist entries (user truth) merged over
 * Apple defaults for absent ids. `plist` null/undefined ⇒ defaults only
 * (the unverified web fallback).
 */
export function effectiveSystemHotkeys(
  plist: SymbolicHotkeysPlist | null | undefined
): SystemHotkey[] {
  const entries = plist?.AppleSymbolicHotKeys ?? {};
  const result: SystemHotkey[] = [];
  const seen = new Set<number>();

  for (const [rawId, entry] of Object.entries(entries)) {
    const id = Number(rawId);
    if (!Number.isFinite(id)) continue;
    seen.add(id);
    if (!entry?.enabled) continue;
    const parameters = entry.value?.parameters;
    const vk =
      typeof parameters?.[1] === 'number' ? parameters[1] : undefined;
    const mask =
      typeof parameters?.[2] === 'number' ? parameters[2] : undefined;
    // enabled but no usable combo recorded: fall back to the default combo
    const fallback = HOTKEY_DEFAULTS[id];
    const binding =
      vk !== undefined && mask !== undefined
        ? toBinding(vk, mask)
        : fallback
          ? toBinding(fallback.vk, fallback.mask)
          : null;
    if (!binding) continue;
    result.push({ id, label: hotkeyLabel(id), binding });
  }

  for (const [rawId, preset] of Object.entries(HOTKEY_DEFAULTS)) {
    const id = Number(rawId);
    if (seen.has(id) || !preset.enabled) continue;
    const binding = toBinding(preset.vk, preset.mask);
    if (!binding) continue;
    result.push({ id, label: preset.label, binding });
  }

  return result;
}

function bindingsEqual(a: KeyBinding, b: KeyBinding): boolean {
  if (a.key.toLowerCase() !== b.key.toLowerCase()) return false;
  const aMods = new Set(a.modifiers ?? []);
  const bMods = new Set(b.modifiers ?? []);
  if (aMods.size !== bMods.size) return false;
  for (const modifier of aMods) if (!bMods.has(modifier)) return false;
  return true;
}

export interface SystemShortcutConflict {
  hotkey: SystemHotkey;
  /** true when computed from the machine's real prefs; false when only the
   *  Apple-defaults fallback was available (web — cannot verify) */
  verified: boolean;
  message: string;
}

/**
 * Does any step of `keys` collide with an effective system hotkey? (A chord
 * whose FIRST keystroke the system consumes is dead too, so every step is
 * checked.) Returns a user-actionable description, not a bare boolean: the
 * fix lives in System Settings, and the message says so.
 */
export function findSystemShortcutConflict(
  keys: ShortcutKeys,
  hotkeys: ReadonlyArray<SystemHotkey>,
  options: { verified: boolean }
): SystemShortcutConflict | null {
  const steps = isChord(keys) ? keys : [keys];
  for (const step of steps) {
    for (const hotkey of hotkeys) {
      if (!bindingsEqual(step, hotkey.binding)) continue;
      const combo = formatKeyBinding(hotkey.binding);
      const message = options.verified
        ? `macOS uses ${combo} for “${hotkey.label}” — it never reaches Exawatt. Free it in System Settings → Keyboard → Keyboard Shortcuts, then rebind here.`
        : `${combo} is usually reserved by macOS for “${hotkey.label}”. If that shortcut is still enabled in System Settings, Exawatt will never receive it.`;
      return { hotkey, verified: options.verified, message };
    }
  }
  return null;
}
