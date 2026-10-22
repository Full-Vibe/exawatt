// @scans none: guides are fixtures and the update feed is a double
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMUNITY_DISTRIBUTION } from '@exawatt/core/distribution';
import type { DesktopBuildRead } from '@/lib/desktop-release/desktop-build';

vi.mock('@/lib/desktop-release/desktop-build', () => ({
  readDesktopBuild: async (): Promise<DesktopBuildRead> => ({
    status: 'unconfigured',
  }),
}));

vi.mock('@/lib/distribution/resolved', () => ({
  resolvedDistribution: () => COMMUNITY_DISTRIBUTION,
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const PUBLISHED = { slug: 'published-guide', title: 'A published guide' };
const DRAFT = { slug: 'draft-guide', title: 'An unpublished guide' };

vi.mock('@/lib/guides/guides', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/guides/guides')>();
  const file = (
    { slug, title }: { slug: string; title: string },
    published: boolean
  ) => ({
    name: `${slug}.md`,
    text: `---\ntitle: ${title}\ndescription: About it.\npublished: ${published}\norder: 1\n---\n\n${title} body.\n`,
  });
  return {
    ...actual,
    publishedGuides: () =>
      actual.parseGuides([file(PUBLISHED, true), file(DRAFT, false)]),
  };
});

afterEach(cleanup);

describe('only published guides are on the site (ENG-031 W26)', () => {
  it('lists the published guide on /guides, and never the unpublished one', async () => {
    const { default: GuidesPage } = await import('./page');
    render(GuidesPage());
    expect(screen.getByText(PUBLISHED.title)).toBeTruthy();
    expect(screen.queryByText(DRAFT.title)).toBeNull();
  });

  it("renders a published guide's page and answers 404 for an unpublished one", async () => {
    const page = await import('./[slug]/page');
    expect(page.dynamicParams).toBe(false);
    expect(page.generateStaticParams()).toEqual([{ slug: PUBLISHED.slug }]);
    await expect(
      page.default({ params: Promise.resolve({ slug: DRAFT.slug }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
    render(
      await page.default({ params: Promise.resolve({ slug: PUBLISHED.slug }) })
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      PUBLISHED.title
    );
  });

  it('lists the published guide in the sitemap, and never the unpublished one', async () => {
    const { default: sitemap } = await import('../sitemap');
    const urls = (await sitemap()).map(item => item.url);
    expect(urls.some(url => url.endsWith('/guides'))).toBe(true);
    expect(urls.some(url => url.endsWith(`/guides/${PUBLISHED.slug}`))).toBe(
      true
    );
    expect(urls.some(url => url.endsWith(`/guides/${DRAFT.slug}`))).toBe(false);
  });
});
