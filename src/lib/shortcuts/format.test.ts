import { describe, expect, it } from 'vitest';
import { formatShortcutKeysAria } from './format';

describe('formatShortcutKeysAria', () => {
  it('formats a single shortcut with WAI-ARIA modifier names', () => {
    expect(
      formatShortcutKeysAria({
        key: 'm',
        modifiers: ['meta', 'shift'],
      })
    ).toBe('Meta+Shift+m');
  });

  it('omits multi-step chords without an interoperable representation', () => {
    expect(
      formatShortcutKeysAria([{ key: 'g' }, { key: 'w' }])
    ).toBeUndefined();
  });
});
