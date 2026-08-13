import { describe, expect, it } from 'vitest';
import { defaultShortcuts, getDefaultShortcut } from './defaults';
import { effectiveSystemHotkeys, findSystemShortcutConflict } from './system-shortcuts';
import { reservedShortcutFamily } from './validation';
import { isChord, type KeyBinding, type ShortcutKeys } from '@/types/shortcuts';

function comboOf(keys: ShortcutKeys): string {
  const step = (binding: KeyBinding) =>
    `${[...(binding.modifiers ?? [])].sort().join('+')}|${binding.key.toLowerCase()}`;
  return isChord(keys) ? keys.map(step).join(' ') : step(keys);
}

/** The structural slice `reservedShortcutFamily` matches on. */
function eventOf(keys: KeyBinding) {
  const modifiers = keys.modifiers ?? [];
  const code = /^[a-z]$/i.test(keys.key)
    ? `Key${keys.key.toUpperCase()}`
    : /^[0-9]$/.test(keys.key)
      ? `Digit${keys.key}`
      : keys.key;
  return {
    code,
    metaKey: modifiers.includes('meta'),
    ctrlKey: modifiers.includes('ctrl'),
    altKey: modifiers.includes('alt'),
    shiftKey: modifiers.includes('shift'),
  };
}

describe('default shortcut bindings', () => {
  it('binds each default combo to exactly one command', () => {
    const seen = new Map<string, string>();
    for (const shortcut of defaultShortcuts) {
      const combo = comboOf(shortcut.keys);
      expect(seen.get(combo), `${combo} is bound twice`).toBeUndefined();
      seen.set(combo, shortcut.id);
    }
  });

  it('keeps every default off the reserved fixed families (D13)', () => {
    for (const shortcut of defaultShortcuts) {
      const steps = isChord(shortcut.keys) ? shortcut.keys : [shortcut.keys];
      for (const step of steps) {
        expect(
          reservedShortcutFamily(eventOf(step)),
          `${shortcut.id} lands on a reserved family`
        ).toBeNull();
      }
    }
  });

  // D19: system collisions are consulted from the machine's effective table,
  // never a hardcoded list. Apple's shipped defaults are the floor every
  // machine starts from, so a default binding must clear at least those.
  it('keeps every default off Apple default system hotkeys (D19)', () => {
    const hotkeys = effectiveSystemHotkeys({ AppleSymbolicHotKeys: {} });
    for (const shortcut of defaultShortcuts) {
      const conflict = findSystemShortcutConflict(shortcut.keys, hotkeys, {
        verified: false,
      });
      expect(conflict?.message ?? null, shortcut.id).toBeNull();
    }
  });

  // ENG-016 D36/D47, operator 2026-08-13: "there's no cmd+k or discoverable
  // keyboard shortcut for resume this agent."
  describe('relaunch recovery (ENG-016 D36)', () => {
    it('registers a rebindable chord for each of the two recovery scopes', () => {
      const agent = getDefaultShortcut('workspace-resume-agent');
      const scope = getDefaultShortcut('workspace-resume-scope');

      expect(agent?.keys).toEqual({ key: 'r', modifiers: ['meta', 'alt'] });
      expect(scope?.keys).toEqual({
        key: 'r',
        modifiers: ['meta', 'alt', 'shift'],
      });
      // The `workspace` context is what makes them executable from inside
      // xterm (the workspace key layer owns it) AND rebindable in Settings.
      for (const shortcut of [agent, scope]) {
        expect(shortcut?.contexts).toEqual(['workspace']);
        expect(shortcut?.category).toBe('workspace');
        expect(shortcut?.label.startsWith('Resume ')).toBe(true);
      }
    });

    it('does not overload ⌘⇧T, which restores a closed Session without starting it (D39)', () => {
      expect(getDefaultShortcut('workspace-reopen-closed-tab')?.keys).toEqual({
        key: 't',
        modifiers: ['meta', 'shift'],
      });
    });
  });
});
