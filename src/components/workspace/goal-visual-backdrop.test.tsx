import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  GoalVisualBackdrop,
  goalVisualFallbackBackground,
  goalVisualHash,
} from './goal-visual-backdrop';

const RASTER = 'data:image/webp;base64,UklGRg==';

describe('GoalVisualBackdrop', () => {
  it('derives a stable, identity-specific Project-tinted fallback', () => {
    const first = goalVisualFallbackBackground('goal:alpha', '#19e6ff');
    expect(first).toBe(goalVisualFallbackBackground('goal:alpha', '#19e6ff'));
    expect(first).not.toBe(
      goalVisualFallbackBackground('goal:beta', '#19e6ff')
    );
    expect(first).toContain('#19e6ff');
    expect(goalVisualHash('goal:alpha')).toBe(goalVisualHash('goal:alpha'));
  });

  it('keeps generation and rejection on the quiet fallback', () => {
    const { container, rerender } = render(
      <GoalVisualBackdrop
        fallbackIdentity="session:a"
        projectColor="#19e6ff"
        visual={{
          identityKey: 'goal:alpha',
          revision: 2,
          state: 'generating',
          dataUrl: RASTER,
        }}
      />
    );
    expect(
      container.querySelector('[data-goal-visual-backdrop]')
    ).toHaveAttribute('data-goal-visual-state', 'generating');
    expect(
      container.querySelector('[data-goal-visual-image]')
    ).not.toBeInTheDocument();

    rerender(
      <GoalVisualBackdrop
        fallbackIdentity="session:a"
        projectColor="#19e6ff"
        visual={{
          identityKey: 'goal:alpha',
          revision: 2,
          state: 'rejected',
          dataUrl: RASTER,
        }}
      />
    );
    expect(
      container.querySelector('[data-goal-visual-backdrop]')
    ).toHaveAttribute('data-goal-visual-state', 'rejected');
    expect(
      container.querySelector('[data-goal-visual-image]')
    ).not.toBeInTheDocument();
  });

  it('renders only a validated ready raster as decorative imagery', () => {
    const { container, rerender } = render(
      <GoalVisualBackdrop
        fallbackIdentity="session:a"
        projectColor="#19e6ff"
        visual={{
          identityKey: 'goal:alpha',
          revision: 3,
          state: 'ready',
          dataUrl: RASTER,
        }}
      />
    );
    const backdrop = container.querySelector('[data-goal-visual-backdrop]');
    const image = container.querySelector('[data-goal-visual-image]');
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    expect(backdrop).toHaveAttribute('data-goal-visual-state', 'ready');
    expect(backdrop).toHaveAttribute('data-goal-visual-revision', '3');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('src', RASTER);
    expect(image).toHaveAttribute('draggable', 'false');
    const loadingClass = image?.className;
    fireEvent.load(image!);
    expect(image?.className).not.toBe(loadingClass);

    rerender(
      <GoalVisualBackdrop
        fallbackIdentity="session:a"
        projectColor="#19e6ff"
        visual={{
          identityKey: 'goal:alpha',
          revision: 4,
          state: 'ready',
          dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
        }}
      />
    );
    expect(
      container.querySelector('[data-goal-visual-image]')
    ).not.toBeInTheDocument();
  });
});
