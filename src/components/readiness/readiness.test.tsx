import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AnnouncedChip,
  ComingSoonMarker,
  SurfaceReadinessMarker,
  Unbuilt,
} from '@/components/readiness';

describe('readiness grammar (ENG-026 N0)', () => {
  afterEach(cleanup);

  it('the marker speaks the app-wide token, optionally naming its owner', () => {
    render(<ComingSoonMarker owner="ENG-033" />);
    const marker = screen.getByText('Coming soon');
    expect(marker.parentElement?.textContent).toContain('ENG-033');
  });

  it('SurfaceReadinessMarker renders the marker for a preview surface and nothing for a live one', () => {
    const preview = render(<SurfaceReadinessMarker surfaceId="consumption" />);
    expect(preview.getByText('Coming soon')).toBeInTheDocument();
    cleanup();

    const live = render(<SurfaceReadinessMarker surfaceId="settings" />);
    expect(live.container).toBeEmptyDOMElement();
  });

  it('an announced chip names what is coming and cannot be operated', () => {
    render(
      <AnnouncedChip coming="one-click hosted agents (ENG-033)">
        Push to cloud
      </AnnouncedChip>
    );
    const chip = screen.getByTitle(
      'Coming soon — one-click hosted agents (ENG-033)'
    );
    expect(chip).toHaveAttribute(
      'aria-label',
      'one-click hosted agents (ENG-033) — coming soon'
    );
    // contents are inert: unreachable and unclickable, not merely disabled
    const inner = chip.querySelector('[inert]');
    expect(inner).not.toBeNull();
    expect(inner?.textContent).toContain('Push to cloud');
  });

  it('an unbuilt region carries the token, its owner, and inert contents', () => {
    render(
      <Unbuilt owner="ENG-014 · wattage allocation" note="Nothing here responds.">
        <button type="button">Rebalance</button>
      </Unbuilt>
    );
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(screen.getByText('· ENG-014 · wattage allocation')).toBeInTheDocument();
    expect(screen.getByText('Nothing here responds.')).toBeInTheDocument();
    const inertWrapper = screen
      .getByText('Rebalance')
      .closest('[inert]');
    expect(inertWrapper).not.toBeNull();
  });
});
