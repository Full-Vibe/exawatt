// @scans none: entries are fixtures and the feed is a double
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMUNITY_DISTRIBUTION } from '@exawatt/core/distribution';
import type { DesktopBuildRead } from '@/lib/desktop-release/desktop-build';
import { parseChangelogEntry } from '@/lib/changelog/changelog.mjs';

const feed = vi.hoisted(() => ({
  read: { status: 'unconfigured' } as DesktopBuildRead,
}));

vi.mock('@/lib/desktop-release/desktop-build', () => ({
  readDesktopBuild: async () => feed.read,
}));

vi.mock('@/lib/distribution/resolved', () => ({
  resolvedDistribution: () => COMMUNITY_DISTRIBUTION,
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const entry = (version: string, title: string) =>
  parseChangelogEntry(
    `---\nversion: ${version}\ndate: 2026-10-19\ntitle: ${title}\n---\n\n${title} for everyone.\n`
  );

const PUBLISHED = entry('0.1.22', 'Shipped release');
const DRAFT = entry('0.1.23', 'Unshipped draft');

vi.mock('@/lib/changelog/entries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/changelog/entries')>()),
  changelogEntries: () => [DRAFT, PUBLISHED],
}));

function published(version: string): DesktopBuildRead {
  return {
    status: 'published',
    build: {
      version,
      releaseDate: null,
      downloadUrl: `https://updates.example.test/Exawatt-${version}-arm64.dmg`,
      fileName: `Exawatt-${version}-arm64.dmg`,
      size: null,
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  feed.read = published(PUBLISHED.version);
});

afterEach(cleanup);

describe('the changelog shows only published versions (ENG-031 W25)', () => {
  it('leaves an entry above the published version off /changelog', async () => {
    const { default: ChangelogPage } = await import('./page');
    render(await ChangelogPage());
    expect(screen.getByText(PUBLISHED.title)).toBeTruthy();
    expect(screen.queryByText(DRAFT.title)).toBeNull();
  });

  it("serves a 404 for the draft's page and builds only published pages", async () => {
    const page = await import('./[version]/page');
    expect(await page.generateStaticParams()).toEqual([
      { version: PUBLISHED.version },
    ]);
    await expect(
      page.default({ params: Promise.resolve({ version: DRAFT.version }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
    render(
      await page.default({
        params: Promise.resolve({ version: PUBLISHED.version }),
      })
    );
    expect(screen.getByText(PUBLISHED.title)).toBeTruthy();
  });

  it('leaves the draft out of the feed', async () => {
    const { GET } = await import('./feed.xml/route');
    const xml = await (await GET()).text();
    expect(xml).toContain(`/changelog/${PUBLISHED.version}`);
    expect(xml).not.toContain(`/changelog/${DRAFT.version}`);
  });

  it('lists published entry pages in the sitemap, and never the draft', async () => {
    const { default: sitemap } = await import('../sitemap');
    const urls = (await sitemap()).map(item => item.url);
    expect(
      urls.some(url => url.endsWith(`/changelog/${PUBLISHED.version}`))
    ).toBe(true);
    expect(urls.some(url => url.endsWith(`/changelog/${DRAFT.version}`))).toBe(
      false
    );
  });

  it('shows the draft once the feed publishes its version', async () => {
    feed.read = published(DRAFT.version);
    const { default: ChangelogPage } = await import('./page');
    render(await ChangelogPage());
    expect(screen.getByText(DRAFT.title)).toBeTruthy();
  });

  it('refuses to guess when the feed cannot be read', async () => {
    feed.read = { status: 'unreadable', reason: 'HTTP 503' };
    const { default: ChangelogPage } = await import('./page');
    await expect(ChangelogPage()).rejects.toThrow(
      /could not be read: HTTP 503/u
    );
  });

  it('revalidates every surface on the one published-version cadence', async () => {
    const { CHANGELOG_REVALIDATE_SECONDS } =
      await import('@/lib/changelog/published');
    for (const surface of await Promise.all([
      import('./page'),
      import('./[version]/page'),
      import('./feed.xml/route'),
      import('../sitemap'),
    ])) {
      expect(surface.revalidate).toBe(CHANGELOG_REVALIDATE_SECONDS);
    }
  });
});
