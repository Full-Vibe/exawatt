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

  it('the marker speaks the app-wide token; the owner is tooltip-only, never visible text', () => {
    render(<ComingSoonMarker owner="ENG-033" />);
    const marker = screen.getByText('Coming soon');
    // provenance lives in docs — a roadmap ID must not render as chrome text
    expect(marker.textContent).toBe('Coming soon');
    expect(marker).toHaveAttribute('title', 'ENG-033');
    const style = marker.getAttribute('style') ?? '';
    expect(style).toContain('var(--exa-readiness-neutral, #77839A)');
    expect(style).toContain('var(--exa-readiness-surface)');
  });

  it('SurfaceReadinessMarker renders the marker for a preview surface and nothing for a live one', () => {
    // organization is still a vision preview; consumption flipped live at
    // ENG-008 E5 and must render NO marker — that disappearance IS the flip.
    const preview = render(<SurfaceReadinessMarker surfaceId="organization" />);
    expect(preview.getByText('Coming soon')).toBeInTheDocument();
    cleanup();

    const live = render(<SurfaceReadinessMarker surfaceId="consumption" />);
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

  it('the micro chip keeps the full announced contract at badge scale', () => {
    render(
      <AnnouncedChip size="micro" coming="portable Agent Types (ENG-028)">
        Type
      </AnnouncedChip>
    );
    const chip = screen.getByTitle(
      'Coming soon — portable Agent Types (ENG-028)'
    );
    expect(chip.getAttribute('data-readiness')).toBe('announced');
    expect(chip.className).toContain('text-chrome-micro');
    expect(chip.querySelector('[inert]')).not.toBeNull();
  });

  it('an unbuilt region carries the token, its tooltip-only owner, and inert contents', () => {
    render(
      <Unbuilt owner="ENG-014 · wattage allocation" note="Nothing here responds.">
        <button type="button">Rebalance</button>
      </Unbuilt>
    );
    const tag = screen.getByText('Coming soon');
    expect(tag.textContent).toBe('Coming soon');
    expect(tag).toHaveAttribute('title', 'ENG-014 · wattage allocation');
    expect(screen.getByText('Nothing here responds.')).toBeInTheDocument();
    const inertWrapper = screen
      .getByText('Rebalance')
      .closest('[inert]');
    expect(inertWrapper).not.toBeNull();
  });
});
