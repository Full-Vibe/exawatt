import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CONSUMPTION_CHROME, FLUX_CSS } from '@/components/consumption/flux';
import { UsageClient } from './usage-client';

afterEach(() => {
  document.documentElement.style.removeProperty('--exa-foundation-canvas');
  document.documentElement.style.removeProperty('--exa-consumption-panel');
  document.documentElement.style.removeProperty('--exa-consumption-unknown');
});

describe('Usage theme percolation', () => {
  it('keeps one mounted surface on generated root variables', () => {
    const view = render(<UsageClient />);
    const surface = view.container.querySelector<HTMLElement>(
      '[data-consumption-surface]'
    );
    expect(surface).not.toBeNull();
    expect(surface?.style.background).toBe(CONSUMPTION_CHROME.canvas);

    const firstPanel = view.container.querySelector<HTMLElement>(
      '[data-consumption-surface] section'
    );
    expect(firstPanel?.style.background).toBe(CONSUMPTION_CHROME.surface);

    document.documentElement.style.setProperty(
      '--exa-foundation-canvas',
      '#f3f5f2'
    );
    document.documentElement.style.setProperty(
      '--exa-consumption-panel',
      '#f4f1f8'
    );
    expect(view.container.querySelector('[data-consumption-surface]')).toBe(
      surface
    );
    expect(surface?.style.background).toBe('var(--exa-foundation-canvas)');
    expect(firstPanel?.style.background).toBe('var(--exa-consumption-panel)');
  });

  it('renders unknown Consumption state from its own channel, not readiness', () => {
    const view = render(<UsageClient />);
    const unknown = screen.getAllByText(/no plan record/i)[0];
    expect(unknown.style.color).toBe(FLUX_CSS.unknown);
    expect(unknown.getAttribute('style')).not.toContain('readiness');
    expect(FLUX_CSS.unknown).not.toBe('var(--exa-readiness-neutral)');
    fireEvent.click(screen.getByRole('button', { name: 'raw tokens' }));
    expect(view.container.innerHTML).toContain('--exa-consumption-units-');
  });
});
