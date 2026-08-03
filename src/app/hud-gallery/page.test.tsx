import { render, screen } from '@testing-library/react';
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

vi.mock('@/components/hud/board-tile-study', () => ({
  BoardTileStudy: () => null,
}));

vi.mock('@/components/hud/project-ribbon-study', () => ({
  ProjectRibbonStudy: () => null,
}));

vi.mock('@/components/readiness/gallery-study', () => ({
  ReadinessGrammarStudy: () => null,
}));

vi.mock('@/components/consumption/meter/gallery-study', () => ({
  AmbientMeterStudy: () => null,
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

  it('retires the shipped application-theme study from the workbench', () => {
    render(<HudGallery />);

    expect(
      screen.queryByRole('heading', { name: 'Application themes' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Application themes/ })
    ).not.toBeInTheDocument();
  });

  it('keeps the Fleet board composition review candidate in the workbench', () => {
    render(<HudGallery />);

    expect(
      screen.getByRole('heading', { name: 'Fleet board composition' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Fleet board composition/ })
    ).toHaveAttribute('href', '#board-tiles');
  });
});
