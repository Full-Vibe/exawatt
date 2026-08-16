import { describe, it, expect } from 'vitest';
import { bindingToAccelerator } from '@exawatt/core';

describe('bindingToAccelerator', () => {
  it('converts registry bindings to Electron accelerator strings', () => {
    expect(bindingToAccelerator({ key: 'e', modifiers: ['meta'] })).toBe(
      'Command+E'
    );
    expect(
      bindingToAccelerator({ key: 'm', modifiers: ['meta', 'shift'] })
    ).toBe('Command+Shift+M');
    expect(bindingToAccelerator({ key: '[', modifiers: ['meta'] })).toBe(
      'Command+['
    );
  });

  it('returns null for keys a menu cannot express', () => {
    expect(bindingToAccelerator({ key: '§', modifiers: ['meta'] })).toBeNull();
    expect(bindingToAccelerator({ key: 'Dead' })).toBeNull();
  });
});
