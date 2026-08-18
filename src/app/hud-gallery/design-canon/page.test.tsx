import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DesignCanonPage from './page';
import { LINK_GROUPS, SECTIONS, WORKBENCH_ROUTES } from './canon';

/** Words a reader actually confronts, which is the budget the operator set. */
function renderedWordCount(root: HTMLElement): number {
  return (root.textContent ?? '').trim().split(/\s+/).filter(Boolean).length;
}

describe('design canon briefing', () => {
  it('renders every declared section with an anchor the nav can reach', () => {
    const { container } = render(<DesignCanonPage />);

    for (const section of SECTIONS) {
      expect(container.querySelector(`#${section.id}`)).not.toBeNull();
      expect(
        screen.getByRole('heading', { name: section.title })
      ).toBeInTheDocument();
      expect(container.querySelector(`a[href="#${section.id}"]`)).not.toBeNull();
    }
  });

  it('stays sendable: the whole page is under 1,000 rendered words', () => {
    // The first version ran past 5,000 and the operator would not send it.
    // This is the guard, not a style preference: a briefing that has to be
    // read in full is not a briefing.
    const { container } = render(<DesignCanonPage />);

    expect(renderedWordCount(container)).toBeLessThan(1000);
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
