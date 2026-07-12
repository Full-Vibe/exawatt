import { describe, expect, it } from 'vitest';
import { getDefaultShortcut } from './defaults';
import {
  reservedShortcutFamily,
  validateShortcutBinding,
} from './validation';

const universal = { bindingPolicy: 'universal-command' as const };
const event = (
  overrides: Partial<Parameters<typeof reservedShortcutFamily>[0]> = {}
) => ({
  code: 'KeyA',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe('shortcut binding policy', () => {
  it('marks only the absolute altitude destinations as universal', () => {
    expect(getDefaultShortcut('command-terminal')?.bindingPolicy).toBe(
      'universal-command'
    );
    expect(getDefaultShortcut('command-sessions')?.bindingPolicy).toBe(
      'universal-command'
    );
    expect(getDefaultShortcut('command-spatial')?.bindingPolicy).toBe(
      'universal-command'
    );
    expect(getDefaultShortcut('go-spatial')?.bindingPolicy).toBeUndefined();
  });

  it('requires one Command-modified combination on macOS', () => {
    expect(
      validateShortcutBinding(
        universal,
        { key: '4', modifiers: ['meta', 'shift'] },
        'darwin'
      )
    ).toBeNull();
    expect(validateShortcutBinding(universal, { key: 'm' }, 'darwin')).toMatch(
      /must include ⌘/
    );
    expect(
      validateShortcutBinding(
        universal,
        { key: 'm', modifiers: ['alt'] },
        'darwin'
      )
    ).toMatch(/must include ⌘/);
    expect(
      validateShortcutBinding(
        universal,
        { key: 'm', modifiers: ['ctrl'] },
        'darwin'
      )
    ).toMatch(/must include ⌘/);
    expect(
      validateShortcutBinding(universal, [{ key: 'g' }, { key: 'm' }], 'darwin')
    ).toMatch(/not a chord/);
  });

  it('uses Control as the primary modifier off macOS', () => {
    expect(
      validateShortcutBinding(
        universal,
        { key: '4', modifiers: ['ctrl'] },
        'win32'
      )
    ).toBeNull();
    expect(
      validateShortcutBinding(
        universal,
        { key: '4', modifiers: ['meta'] },
        'linux'
      )
    ).toMatch(/must include Ctrl/);
  });

  it('leaves contextual shortcuts flexible', () => {
    expect(
      validateShortcutBinding(
        {},
        [{ key: 'g' }, { key: 'm' }],
        'darwin'
      )
    ).toBeNull();
  });

  it('reserves Project ordinals by physical digit code', () => {
    expect(
      reservedShortcutFamily(
        event({ code: 'Digit4', metaKey: true, altKey: true })
      )
    ).toMatch(/Project switching/);
    expect(
      reservedShortcutFamily(
        event({ code: 'Digit4', metaKey: true, altKey: false })
      )
    ).toBeNull();
  });

  it('reserves the shifted-bracket terminal tab ring', () => {
    expect(
      reservedShortcutFamily(
        event({ code: 'BracketLeft', metaKey: true, shiftKey: true })
      )
    ).toMatch(/terminal tab navigation/);
    expect(
      reservedShortcutFamily(
        event({ code: 'BracketRight', metaKey: true, shiftKey: true })
      )
    ).toMatch(/terminal tab navigation/);
  });
});
