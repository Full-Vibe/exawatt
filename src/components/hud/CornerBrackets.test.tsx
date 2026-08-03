import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CornerBrackets } from './CornerBrackets';

describe('CornerBrackets theme override', () => {
  it('uses a generated DOM color without changing the legacy tone fallback', () => {
    const color = 'var(--exa-hud-cyan, #19e6ff)';
    const { container, rerender } = render(
      <CornerBrackets active color={color} />
    );

    expect(container.querySelector('path')).toHaveAttribute('stroke', color);
    expect(container.querySelector('svg')?.style.filter).toContain(
      '--exa-hud-cyan'
    );

    rerender(<CornerBrackets tone="magenta" />);
    expect(container.querySelector('path')).toHaveAttribute(
      'stroke',
      '#FF3B8B'
    );
  });
});
