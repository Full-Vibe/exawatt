import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/hud/webgl/scenes', () => ({
  WebglFramesScene: () => null,
  WebglBracketsScene: () => null,
  WebglLabelsScene: () => null,
  WebglStatBarsScene: () => null,
  WebglGaugesScene: () => null,
  WebglPillsScene: () => null,
  WebglComposedScene: () => null,
  WebglStatusLightsScene: () => null,
}));

vi.mock('@/components/hud/webgl/keyswitch-study', () => ({
  KeySwitchStudy: () => <div data-testid="keyswitch-material-workbench" />,
}));

vi.mock('@/components/hud/session-state-tile-study', () => ({
  SessionStateTileStudy: () => null,
}));

vi.mock('@/components/hud/project-ribbon-study', () => ({
  ProjectRibbonStudy: () => null,
}));

vi.mock('@/components/readiness/gallery-study', () => ({
  ReadinessGrammarStudy: () => null,
}));

import HudGallery from './page';

class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];
  disconnect = vi.fn();
  observe = vi.fn();
  takeRecords = vi.fn(() => []);
  unobserve = vi.fn();
}

describe('HUD gallery', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
  });

  it('does not let embedded studies steal focus on entry', () => {
    const invoker = document.createElement('button');
    document.body.append(invoker);
    invoker.focus();
    render(<HudGallery />);

    expect(invoker).toHaveFocus();
    invoker.remove();
  });

  it('keeps the R3F keyswitch material workbench reviewable', () => {
    render(<HudGallery />);

    expect(
      screen.getByRole('heading', { name: 'Keyswitch material studies' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('keyswitch-material-workbench')).toBeVisible();
    expect(
      screen.getByRole('link', { name: /Keyswitch material studies/ })
    ).toHaveAttribute('href', '#keyswitch-material-studies');
  });

  it('links the active Agent tile image geometry bench', () => {
    render(<HudGallery />);
    fireEvent.click(screen.getByText('Review workbenches'));

    expect(
      screen.getByRole('link', { name: 'Open the Agent tile image bench →' })
    ).toHaveAttribute('href', '/hud-gallery/goal-visuals');
  });
});
