import { act, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shortcutRegistry } from '@/lib/shortcuts';
import { useEffectiveShortcut } from './use-effective-shortcut';

const TEST_SHORTCUT = 'hydration-shortcut';

function ShortcutProbe() {
  const keys = useEffectiveShortcut(TEST_SHORTCUT);
  return (
    <span data-testid="keys">
      {keys && !Array.isArray(keys) ? keys.key : ''}
    </span>
  );
}

describe('useEffectiveShortcut', () => {
  afterEach(() => act(() => shortcutRegistry.unregister(TEST_SHORTCUT)));

  it('keeps server markup stable, then exposes registered client keys', () => {
    shortcutRegistry.register({
      id: TEST_SHORTCUT,
      keys: { key: 'h', modifiers: ['meta'] },
      label: 'Hydration test',
      category: 'help',
      contexts: ['global'],
      action: vi.fn(),
    });

    expect(renderToString(<ShortcutProbe />)).not.toContain('>h<');
    render(<ShortcutProbe />);
    expect(screen.getByTestId('keys')).toHaveTextContent('h');
  });
});
