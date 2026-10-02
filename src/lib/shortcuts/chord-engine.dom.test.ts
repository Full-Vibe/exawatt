// Named as a DOM suite because shortcut ownership depends on element types.
import { describe, expect, it, vi } from 'vitest';
import { chordEngine, shouldIgnoreShortcutEvent } from './chord-engine';
import { defaultShortcuts } from './defaults';
import { shortcutRegistry } from './registry';

function inspect(target: HTMLElement, init: KeyboardEventInit): boolean {
  let ignored = false;
  target.addEventListener('keydown', event => {
    ignored = shouldIgnoreShortcutEvent(event);
  });
  target.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  );
  return ignored;
}

describe('shortcut typing boundary', () => {
  it('keeps plain and Option-modified text inside inputs', () => {
    const input = document.createElement('input');
    expect(inspect(input, { key: 'g' })).toBe(true);
    expect(inspect(input, { key: 'å', altKey: true })).toBe(true);
  });

  it('allows global command modifiers from inputs', () => {
    const input = document.createElement('input');
    expect(inspect(input, { key: 'm', metaKey: true, shiftKey: true })).toBe(
      false
    );
    expect(inspect(input, { key: 'k', ctrlKey: true })).toBe(false);
  });

  it('always leaves command-palette input to cmdk', () => {
    const input = document.createElement('input');
    input.setAttribute('cmdk-input', '');
    expect(inspect(input, { key: 'k', metaKey: true })).toBe(true);
  });

  it('releases commands from retained closed palette content without stealing text', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-state', 'open');
    const root = document.createElement('div');
    root.setAttribute('cmdk-root', '');
    const input = document.createElement('input');
    input.setAttribute('cmdk-input', '');
    dialog.append(root);
    root.append(input);
    expect(inspect(input, { key: '2', metaKey: true, ctrlKey: true })).toBe(
      true
    );

    dialog.setAttribute('data-state', 'closed');
    expect(inspect(input, { key: '2', metaKey: true, ctrlKey: true })).toBe(
      false
    );
    expect(inspect(input, { key: 'g' })).toBe(true);
    expect(inspect(input, { key: 'å', altKey: true })).toBe(true);
  });

  it('runs a post-close modified command once through existing event ownership', () => {
    const definition = defaultShortcuts.find(
      item => item.id === 'command-sessions'
    );
    if (!definition) throw new Error('Missing Sessions command contract');
    const action = vi.fn();
    shortcutRegistry.register({ ...definition, action });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-state', 'closed');
    const input = document.createElement('input');
    input.setAttribute('cmdk-input', '');
    dialog.append(input);
    input.addEventListener('keydown', event => {
      expect(chordEngine.processKeyEvent(event)).toBe(true);
      expect(chordEngine.processKeyEvent(event)).toBe(false);
    });
    try {
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: '2',
          code: 'Digit2',
          metaKey: true,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
      expect(action).toHaveBeenCalledOnce();
    } finally {
      chordEngine.clear();
      shortcutRegistry.unregister(definition.id);
    }
  });
});
