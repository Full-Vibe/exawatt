import { describe, expect, it } from 'vitest';
import {
  effectiveSystemHotkeys,
  findSystemShortcutConflict,
  type SymbolicHotkeysPlist,
} from './system-shortcuts';

const SHIFT = 1 << 17;
const CTRL = 1 << 18;
const OPT = 1 << 19;
const CMD = 1 << 20;
const FN = 1 << 23; // device bit that must be ignored in comparisons

function conflictOf(
  key: string,
  modifiers: string[],
  plist: SymbolicHotkeysPlist | null,
  verified = true
) {
  return findSystemShortcutConflict(
    { key, modifiers: modifiers as never },
    effectiveSystemHotkeys(plist),
    { verified }
  );
}

describe('effectiveSystemHotkeys', () => {
  it('reports Apple defaults for ids absent from the plist', () => {
    // untouched prefs: screenshots ⇧⌘3/4/5 and Spotlight ⌘Space are live
    const hotkeys = effectiveSystemHotkeys({ AppleSymbolicHotKeys: {} });
    const combos = hotkeys.map(
      hotkey =>
        `${(hotkey.binding.modifiers ?? []).sort().join('+')}+${hotkey.binding.key}`
    );
    expect(combos).toContain('meta+shift+3');
    expect(combos).toContain('meta+shift+4');
    expect(combos).toContain('meta+shift+5');
    expect(combos).toContain('meta+ ');
  });

  it('a user-DISABLED entry frees its combo (the operator scenario)', () => {
    // the operator really has ⌥⌘D Dock hiding and ⌃Space input-source
    // switching disabled in System Settings — those keys must be bindable
    const plist: SymbolicHotkeysPlist = {
      AppleSymbolicHotKeys: {
        '52': { enabled: false, value: { parameters: [100, 2, OPT | CMD] } },
        '60': { enabled: false, value: { parameters: [32, 49, CTRL] } },
      },
    };
    expect(conflictOf('d', ['alt', 'meta'], plist)).toBeNull();
    expect(conflictOf(' ', ['ctrl'], plist)).toBeNull();
    // untouched screenshots still conflict
    expect(conflictOf('3', ['meta', 'shift'], plist)).not.toBeNull();
  });

  it('a user-REBOUND entry moves the conflict to the new combo', () => {
    // screenshot moved from ⇧⌘3 to ⇧⌘9: old combo free, new combo taken
    const plist: SymbolicHotkeysPlist = {
      AppleSymbolicHotKeys: {
        '28': { enabled: true, value: { parameters: [65535, 25, SHIFT | CMD] } },
      },
    };
    expect(conflictOf('3', ['meta', 'shift'], plist)).toBeNull();
    const moved = conflictOf('9', ['meta', 'shift'], plist);
    expect(moved?.hotkey.label).toMatch(/Save picture of screen/);
  });

  it('ignores device bits (fn, numeric pad) in the modifier mask', () => {
    const plist: SymbolicHotkeysPlist = {
      AppleSymbolicHotKeys: {
        '79': {
          enabled: true,
          value: { parameters: [65535, 123, CTRL | FN | (1 << 21)] },
        },
      },
    };
    const conflict = conflictOf('ArrowLeft', ['ctrl'], plist);
    expect(conflict?.hotkey.label).toBe('Move left a space');
  });

  it('an enabled entry without parameters falls back to its default combo', () => {
    const plist: SymbolicHotkeysPlist = {
      AppleSymbolicHotKeys: { '64': { enabled: true } },
    };
    expect(conflictOf(' ', ['meta'], plist)?.hotkey.label).toBe(
      'Show Spotlight search'
    );
  });
});

describe('findSystemShortcutConflict', () => {
  it('matches modifier sets exactly', () => {
    // ⌃⌘3 is NOT ⇧⌘3 — the D19 altitude default stays clean…
    expect(conflictOf('3', ['ctrl', 'meta'], null)).toBeNull();
    expect(conflictOf('3', ['alt', 'meta'], null)).toBeNull();
    // …but ⌃⇧⌘3 really is a default hotkey (copy screenshot to clipboard)
    expect(conflictOf('3', ['ctrl', 'meta', 'shift'], null)?.hotkey.id).toBe(
      29
    );
  });

  it('flags any step of a chord', () => {
    const conflict = findSystemShortcutConflict(
      [{ key: 'g' }, { key: '3', modifiers: ['meta', 'shift'] }],
      effectiveSystemHotkeys(null),
      { verified: true }
    );
    expect(conflict).not.toBeNull();
  });

  it('verified conflicts point at System Settings; unverified ones hedge', () => {
    const verified = conflictOf('3', ['meta', 'shift'], null, true);
    expect(verified?.message).toMatch(/System Settings/);
    const unverified = conflictOf('3', ['meta', 'shift'], null, false);
    expect(unverified?.verified).toBe(false);
    expect(unverified?.message).toMatch(/usually reserved/);
  });

  it('labels unknown ids generically instead of guessing', () => {
    const plist: SymbolicHotkeysPlist = {
      AppleSymbolicHotKeys: {
        '9999': { enabled: true, value: { parameters: [65535, 40, CTRL | CMD] } },
      },
    };
    expect(conflictOf('k', ['ctrl', 'meta'], plist)?.hotkey.label).toBe(
      'a macOS system shortcut'
    );
  });
});
