import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DesignCanonPage from './page';
import { LINK_GROUPS, SECTIONS, WORKBENCH_ROUTES } from './canon';

describe('design canon briefing', () => {
  it('renders every declared section with an anchor the nav can reach', () => {
    const { container } = render(<DesignCanonPage />);

    for (const section of SECTIONS) {
      expect(container.querySelector(`#${section.id}`)).not.toBeNull();
      expect(
        screen.getByRole('heading', { name: section.title })
      ).toBeInTheDocument();
      expect(
        container.querySelector(`a[href="#${section.id}"]`)
      ).not.toBeNull();
    }
  });

  it('marks the deliberately unshaped work rather than implying it is decided', () => {
    render(<DesignCanonPage />);

    // The page is only useful to a design partner if `Open` is visible state,
    // not a reading exercise: every open item carries the chip.
    expect(screen.getAllByText('Open').length).toBeGreaterThan(5);
    expect(screen.getAllByText('Decided').length).toBeGreaterThan(20);
  });

  it('keeps every external reference an absolute https link that opens away', () => {
    const { container } = render(<DesignCanonPage />);

    const urls = LINK_GROUPS.flatMap(group => group.links.map(l => l.url));
    expect(urls.length).toBeGreaterThan(50);
    expect(new Set(urls).size).toBe(urls.length);

    for (const url of urls) {
      expect(url.startsWith('https://')).toBe(true);
      const anchor = container.querySelector<HTMLAnchorElement>(
        `a[href="${url}"]`
      );
      expect(anchor).not.toBeNull();
      expect(anchor?.rel).toContain('noreferrer');
      expect(anchor?.target).toBe('_blank');
    }
  });

  it('routes to the live studies as in-app paths', () => {
    const { container } = render(<DesignCanonPage />);

    for (const route of WORKBENCH_ROUTES) {
      expect(route.href.startsWith('/')).toBe(true);
      expect(container.querySelector(`a[href="${route.href}"]`)).not.toBeNull();
    }
  });
});
