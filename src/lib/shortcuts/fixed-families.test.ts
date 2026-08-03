import { describe, expect, it } from 'vitest';
import { WORKSPACE_PALETTE_ROW_IDS } from '@/components/shortcuts/command-palette';
import { WORKSPACE_MENU_AVAILABILITY_COMMAND_IDS } from '@/components/shortcuts/shortcut-provider';
import {
  FIXED_SESSION_MENU_COMMANDS,
  FIXED_SESSION_MENU_COMMAND_IDS,
} from '../../../electron/main/fixed-session-menu';
import {
  ALL_FIXED_FAMILIES,
  WORKSPACE_KEY_FAMILIES,
  fixedFamilyBindings,
  matchFixedFamily,
  type FixedFamilyAction,
  type FixedFamilyKeyEvent,
} from './fixed-families';
import type { KeyBinding, ModifierKey } from '@/types/shortcuts';

function keyEvent(
  overrides: Partial<FixedFamilyKeyEvent>
): FixedFamilyKeyEvent {
  return {
    key: '',
    code: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

interface MatchCase {
  familyId: string;
  event: FixedFamilyKeyEvent;
  action: FixedFamilyAction;
}

const MATCH_CASES: MatchCase[] = [
  {
    familyId: 'fixed-focus-toggle',
    event: keyEvent({ key: 'F6', code: 'F6' }),
    action: { kind: 'toggle-focus' },
  },
  {
    familyId: 'fixed-tab-ring',
    event: keyEvent({
      key: '{',
      code: 'BracketLeft',
      metaKey: true,
      shiftKey: true,
    }),
    action: { kind: 'cycle-tab', delta: -1 },
  },
  {
    familyId: 'fixed-tab-ring',
    event: keyEvent({
      key: '}',
      code: 'BracketRight',
      metaKey: true,
      shiftKey: true,
    }),
    action: { kind: 'cycle-tab', delta: 1 },
  },
  {
    familyId: 'fixed-move-tab',
    event: keyEvent({
      key: '[',
      code: 'BracketLeft',
      metaKey: true,
      altKey: true,
    }),
    action: { kind: 'move-tab', delta: -1 },
  },
  {
    familyId: 'fixed-move-tab',
    event: keyEvent({
      key: ']',
      code: 'BracketRight',
      metaKey: true,
      altKey: true,
    }),
    action: { kind: 'move-tab', delta: 1 },
  },
  {
    familyId: 'fixed-move-project',
    event: keyEvent({
      key: '{',
      code: 'BracketLeft',
      metaKey: true,
      altKey: true,
      shiftKey: true,
    }),
    action: { kind: 'move-project', delta: -1 },
  },
  {
    familyId: 'fixed-move-project',
    event: keyEvent({
      key: '}',
      code: 'BracketRight',
      metaKey: true,
      altKey: true,
      shiftKey: true,
    }),
    action: { kind: 'move-project', delta: 1 },
  },
  {
    familyId: 'fixed-project-ordinals',
    event: keyEvent({
      key: '¢',
      code: 'Digit4',
      metaKey: true,
      altKey: true,
    }),
    action: { kind: 'select-project', index: 3 },
  },
  {
    familyId: 'fixed-tab-ordinals',
    event: keyEvent({ key: '9', code: 'Digit9', metaKey: true }),
    action: { kind: 'select-tab', index: 8 },
  },
  {
    familyId: 'fixed-focus-terminal',
    event: keyEvent({ key: 'Escape', code: 'Escape' }),
    action: { kind: 'focus-terminal' },
  },
];

const MODIFIER_ORDER: ModifierKey[] = ['ctrl', 'meta', 'alt', 'shift'];

function bindingSignature(binding: KeyBinding): string {
  const modifiers = [...(binding.modifiers ?? [])].sort(
    (a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b)
  );
  return [...modifiers, binding.key].join('+');
}

function acceleratorSignature(accelerator: string): string {
  const names: Record<string, ModifierKey> = {
    Control: 'ctrl',
    Command: 'meta',
    Alt: 'alt',
    Shift: 'shift',
  };
  const parts = accelerator.split('+');
  const key = parts.pop() ?? '';
  return bindingSignature({
    key,
    modifiers: parts.map(part => names[part]),
  });
}

describe('fixed shortcut family contract', () => {
  it('requires unique ids, labels, and display keys', () => {
    const ids = ALL_FIXED_FAMILIES.map(family => family.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const family of ALL_FIXED_FAMILIES) {
      expect(family.label.trim()).not.toBe('');
      expect(family.keys.key.trim()).not.toBe('');
    }
  });

  it('records a substantive reason for every intentionally unsurfaced family', () => {
    for (const family of WORKSPACE_KEY_FAMILIES) {
      if (family.paletteRowIds !== null) continue;
      expect(family.menuCommandIds).toBeNull();
      expect(family.discoverability.trim().length).toBeGreaterThanOrEqual(40);
    }
  });

  it('joins surfaced families to real palette rows and menu availability ids', () => {
    for (const family of WORKSPACE_KEY_FAMILIES) {
      if (family.paletteRowIds === null) continue;
      expect(family.paletteRowIds.length).toBeGreaterThan(0);
      expect(family.menuCommandIds.length).toBeGreaterThan(0);
      for (const rowId of family.paletteRowIds) {
        expect(WORKSPACE_PALETTE_ROW_IDS.has(rowId), rowId).toBe(true);
      }
      for (const commandId of family.menuCommandIds) {
        expect(
          WORKSPACE_MENU_AVAILABILITY_COMMAND_IDS.has(commandId),
          commandId
        ).toBe(true);
        expect(FIXED_SESSION_MENU_COMMAND_IDS.has(commandId), commandId).toBe(
          true
        );
      }

      const bindings = fixedFamilyBindings(family);
      expect(family.menuCommandIds).toHaveLength(bindings.length);
      family.menuCommandIds.forEach((commandId, index) => {
        const menu = FIXED_SESSION_MENU_COMMANDS.find(
          command => command.id === commandId
        );
        expect(menu, commandId).toBeDefined();
        expect(acceleratorSignature(menu!.accelerator)).toBe(
          bindingSignature(bindings[index])
        );
      });
    }
  });

  it.each(MATCH_CASES)('$familyId owns only its declared chord', testCase => {
    const matches = WORKSPACE_KEY_FAMILIES.flatMap(family => {
      const action = matchFixedFamily(family, testCase.event);
      return action ? [{ familyId: family.id, action }] : [];
    });
    expect(matches).toEqual([
      { familyId: testCase.familyId, action: testCase.action },
    ]);
  });

  it('keeps the absolute altitude modifier family out of fixed ordinals', () => {
    const altitude = keyEvent({
      key: '1',
      code: 'Digit1',
      metaKey: true,
      ctrlKey: true,
    });
    expect(
      WORKSPACE_KEY_FAMILIES.every(
        family => matchFixedFamily(family, altitude) === null
      )
    ).toBe(true);
  });

  it('does not widen bare F6 or Escape into undeclared modifier chords', () => {
    for (const event of [
      keyEvent({ key: 'F6', code: 'F6', metaKey: true }),
      keyEvent({ key: 'Escape', code: 'Escape', altKey: true }),
    ]) {
      expect(
        WORKSPACE_KEY_FAMILIES.every(
          family => matchFixedFamily(family, event) === null
        )
      ).toBe(true);
    }
  });
});
