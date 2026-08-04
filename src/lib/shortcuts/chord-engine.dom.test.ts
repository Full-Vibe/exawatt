// Named as a DOM suite because shortcut ownership depends on element types.
import { describe, expect, it } from 'vitest';
import { shouldIgnoreShortcutEvent } from './chord-engine';

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
});
