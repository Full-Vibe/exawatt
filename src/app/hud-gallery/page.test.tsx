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

vi.mock('@/components/hud/project-ribbon-study', () => ({
  ProjectRibbonStudy: () => null,
}));

vi.mock('@/components/hud/launch-configuration-ribbon-study', () => ({
  LaunchConfigurationRibbonStudy: () => (
    <div data-testid="launch-configuration-ribbon-study" />
  ),
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

  it('keeps the Launch Configuration ribbon reviewable before integration', () => {
    render(<HudGallery />);

    expect(
      screen.getByRole('heading', { name: 'Launch Configuration ribbon' })
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('launch-configuration-ribbon-study')
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: /Launch Configuration ribbon/ })
    ).toHaveAttribute('href', '#launch-configuration-ribbon');
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

  it('links the active Agent tile image geometry bench', () => {
    render(<HudGallery />);

    expect(
      screen.getByRole('link', { name: 'Open the Agent tile image bench →' })
    ).toHaveAttribute('href', '/hud-gallery/goal-visuals');
  });
});
